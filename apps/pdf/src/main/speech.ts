/**
 * Read Out Loud: speaks text with the voice the operating system already has.
 *
 * On Windows the text goes, over standard input, to a hidden PowerShell that hands
 * it to the built-in System.Speech synthesizer; stopping ends that process.
 * Standard input keeps the document's text out of the command line, so no
 * character in it is ever read as part of a command. Pausing and resuming go
 * through a small control file the speaking process looks at a few times a
 * second. Other systems answer `unsupported`, and the renderer then falls back
 * to the browser's own speech where it has a voice.
 */
import { spawn as nodeSpawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SpeechStartResult, SpeechState } from '../shared/ipc'

/** The most characters read in one go (about a 400-page novel) */
export const SPEECH_MAX_CHARS = 1_500_000

/**
 * Reads the text as UTF-8 from standard input and speaks it in the background
 * with the voice Windows has chosen, then looks every 150 ms for a `pause` or
 * `resume` written to the control file until the voice is done. The control
 * path and the volume travel in the environment, not in the script.
 */
const SCRIPT =
  '[Console]::InputEncoding = [Text.Encoding]::UTF8; Add-Type -AssemblyName System.Speech; ' +
  '$text = [Console]::In.ReadToEnd(); ' +
  '$voice = New-Object System.Speech.Synthesis.SpeechSynthesizer; ' +
  'if ($env:GENOFFICE_SPEECH_VOLUME) { $voice.Volume = [int]$env:GENOFFICE_SPEECH_VOLUME }; ' +
  'Register-ObjectEvent -InputObject $voice -EventName SpeakCompleted -SourceIdentifier Done | Out-Null; ' +
  '$voice.SpeakAsync($text) | Out-Null; ' +
  '$control = $env:GENOFFICE_SPEECH_CONTROL; ' +
  'while ($null -eq (Wait-Event -SourceIdentifier Done -Timeout 0.15)) { ' +
  'if ($control -and (Test-Path -LiteralPath $control)) { ' +
  '$command = (Get-Content -LiteralPath $control -Raw).Trim(); ' +
  'Remove-Item -LiteralPath $control -ErrorAction SilentlyContinue; ' +
  "if ($command -eq 'pause') { $voice.Pause() } elseif ($command -eq 'resume') { $voice.Resume() } " +
  '} }'

export interface SpeakerOptions {
  /** defaults to the running platform */
  platform?: NodeJS.Platform
  /** defaults to child_process.spawn (a test double stands in for it in unit tests) */
  spawn?: typeof nodeSpawn
  /** where control files go; defaults to the temporary folder */
  tempDir?: string
  /** 0-100; tests set 0 so they make no noise. Unset leaves the voice at the system setting */
  volume?: string | undefined
}

let sequence = 0

/** `text` limited to SPEECH_MAX_CHARS, cut at a character boundary rather than inside a surrogate pair */
export function limitSpeechText(text: string): string {
  if (text.length <= SPEECH_MAX_CHARS) return text
  const cut = text.slice(0, SPEECH_MAX_CHARS)
  const last = cut.charCodeAt(cut.length - 1)
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut
}

/** One reading at a time: starting another ends the one in progress */
export class Speaker {
  private child: ChildProcess | null = null
  private control: string | null = null
  private paused = false
  /** changes whenever a reading is stopped or replaced, so a slow start can tell it was overtaken */
  private generation = 0

  constructor(private readonly options: SpeakerOptions = {}) {}

  state(): SpeechState {
    if (!this.child) return 'idle'
    return this.paused ? 'paused' : 'reading'
  }

  /** Stop what is being read (if anything) and start reading `text`. */
  async start(text: string): Promise<SpeechStartResult> {
    this.stop()
    const generation = this.generation
    const limited = limitSpeechText(text)
    if (limited.trim() === '') return { ok: false, reason: 'no-text' }
    const platform = this.options.platform ?? process.platform
    if (platform !== 'win32') return { ok: false, reason: 'unsupported' }

    const control = join(
      this.options.tempDir ?? tmpdir(),
      `genoffice-speech-${process.pid}-${sequence++}.ctl`,
    )
    const spawn = this.options.spawn ?? nodeSpawn
    const volume =
      'volume' in this.options ? this.options.volume : process.env.GENOFFICE_SPEECH_VOLUME
    let child: ChildProcess
    try {
      child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', SCRIPT], {
        env: {
          ...process.env,
          GENOFFICE_SPEECH_CONTROL: control,
          ...(volume ? { GENOFFICE_SPEECH_VOLUME: volume } : {}),
        },
        stdio: ['pipe', 'ignore', 'ignore'],
        windowsHide: true,
      })
    } catch (err) {
      return {
        ok: false,
        reason: 'failed',
        detail: err instanceof Error ? err.message : String(err),
      }
    }

    // a start that failed after this point (no PowerShell) shows as an error event
    const failed = new Promise<string>((resolve) => {
      child.once('error', (err) => resolve(err.message))
    })
    child.once('exit', () => {
      if (this.child === child) this.reset()
    })
    if (generation !== this.generation) {
      // stopped, or replaced by another reading, while this one was starting
      child.kill()
      return { ok: true }
    }
    this.child = child
    this.control = control
    this.paused = false

    const written = await new Promise<string | null>((resolve) => {
      child.stdin?.once('error', (err) => resolve(err.message))
      child.stdin?.end(limited, 'utf8', () => resolve(null))
      void failed.then((message) => resolve(message))
    })
    if (written !== null) {
      this.stop()
      return { ok: false, reason: 'failed', detail: written }
    }
    return { ok: true }
  }

  /** Pause a reading, or resume a paused one; `idle` when nothing is being read (it may just have finished). */
  async togglePause(): Promise<SpeechState> {
    if (!this.child || !this.control) {
      this.reset()
      return 'idle'
    }
    await writeFile(this.control, this.paused ? 'resume' : 'pause')
    this.paused = !this.paused
    return this.state()
  }

  /** Stop reading. Safe when nothing is being read. */
  stop(): void {
    this.generation++
    const child = this.child
    const control = this.control
    this.child = null
    this.control = null
    this.paused = false
    if (child && child.exitCode === null) child.kill()
    if (control) void rm(control, { force: true })
  }

  /** the speaking process is gone: back to idle without touching a newer reading */
  private reset(): void {
    const control = this.control
    this.child = null
    this.control = null
    this.paused = false
    if (control) void rm(control, { force: true })
  }
}
