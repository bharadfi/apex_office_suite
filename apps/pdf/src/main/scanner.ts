/**
 * Scan with the scanner Windows already knows.
 *
 * No scanner library is shipped. On Windows a hidden PowerShell opens the system's own scan
 * window (Windows Image Acquisition, WIA) and saves what the scanner returned as a PNG file, which is
 * read back. The user picks the scanner, the colour mode and the resolution in that window, as in
 * any other Windows program. Other systems answer `unsupported`.
 */
import { spawn as nodeSpawn } from 'node:child_process'
import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ScanResult } from '../shared/ipc'

/** The exit status the script uses for "the scan window was closed without scanning" */
const EXIT_CANCELLED = 2
/** A pictures bigger than this is not a document page: refuse rather than hold it in memory */
export const MAX_SCAN_BYTES = 200 * 1024 * 1024

/**
 * Opens the scan window asking for a colour PNG, and saves the picture where GENOFFICE_SCAN_OUT
 * says. The path travels in the environment, not in the script, so no character in it is ever
 * read as code. Exit 2: closed without scanning. Exit 3: failed, with the reason on standard output.
 */
const SCRIPT =
  "$ErrorActionPreference = 'Stop'; " +
  'try { ' +
  '$dialog = New-Object -ComObject WIA.CommonDialog; ' +
  "$image = $dialog.ShowAcquireImage(1, 1, 131072, '{B96B3CAF-0728-11D3-9D7B-0000F81EF32E}', $false, $true, $false); " +
  'if ($null -eq $image) { exit 2 }; ' +
  '$image.SaveFile($env:GENOFFICE_SCAN_OUT); ' +
  'exit 0 ' +
  '} catch { [Console]::Out.Write($_.Exception.Message); exit 3 }'

export interface ScannerOptions {
  /** defaults to the running platform */
  platform?: NodeJS.Platform
  /** defaults to child_process.spawn (a test double stands in for it in unit tests) */
  spawn?: typeof nodeSpawn
  /** where the picture is written before it is read back; defaults to the temporary folder */
  tempDir?: string
}

let sequence = 0

/** One scan window at a time */
export class Scanner {
  private running = false

  constructor(private readonly options: ScannerOptions = {}) {}

  /** whether a scan window is open */
  get busy(): boolean {
    return this.running
  }

  /** Open the scan window and wait for a picture. */
  async scan(): Promise<ScanResult> {
    if (this.running) return { ok: false, reason: 'busy' }
    const platform = this.options.platform ?? process.platform
    if (platform !== 'win32') return { ok: false, reason: 'unsupported' }
    this.running = true
    const out = join(
      this.options.tempDir ?? tmpdir(),
      `genoffice-scan-${process.pid}-${sequence++}.png`,
    )
    try {
      await rm(out, { force: true })
      const outcome = await this.run(out)
      if (outcome.kind === 'cancelled') return { ok: false, reason: 'cancelled' }
      if (outcome.kind === 'failed') return failure(outcome.said)
      const png = await readFile(out).catch(() => null)
      if (!png || png.length === 0) return { ok: false, reason: 'failed', detail: 'no picture' }
      if (png.length > MAX_SCAN_BYTES) return { ok: false, reason: 'failed', detail: 'too large' }
      return { ok: true, png: new Uint8Array(png) }
    } finally {
      this.running = false
      await rm(out, { force: true })
    }
  }

  private run(
    out: string,
  ): Promise<{ kind: 'done' } | { kind: 'cancelled' } | { kind: 'failed'; said: string }> {
    const spawn = this.options.spawn ?? nodeSpawn
    return new Promise((resolve) => {
      let said = ''
      let child
      try {
        child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', SCRIPT], {
          env: { ...process.env, GENOFFICE_SCAN_OUT: out },
          stdio: ['ignore', 'pipe', 'ignore'],
          windowsHide: true,
        })
      } catch (err) {
        resolve({ kind: 'failed', said: err instanceof Error ? err.message : String(err) })
        return
      }
      child.stdout?.on('data', (chunk: Buffer) => (said += chunk.toString('utf8')))
      child.once('error', (err) => resolve({ kind: 'failed', said: err.message }))
      child.once('close', (code) => {
        if (code === EXIT_CANCELLED) resolve({ kind: 'cancelled' })
        else if (code === 0) resolve({ kind: 'done' })
        else resolve({ kind: 'failed', said: said.trim() })
      })
    })
  }
}

/** What Windows said, as a result: "no scanner" is the common case worth its own reason */
function failure(said: string): ScanResult {
  if (/no wia device/i.test(said)) return { ok: false, reason: 'no-scanner' }
  return { ok: false, reason: 'failed', ...(said ? { detail: said } : {}) }
}
