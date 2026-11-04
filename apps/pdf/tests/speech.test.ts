import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { limitSpeechText, Speaker, SPEECH_MAX_CHARS } from '../src/main/speech'

/** A stand-in for the PowerShell child: records what is written to it and when it is killed. */
function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdin: PassThrough
    exitCode: number | null
    kill: ReturnType<typeof vi.fn>
    written: string
  }
  child.stdin = new PassThrough()
  child.exitCode = null
  child.written = ''
  child.stdin.on('data', (chunk: Buffer) => (child.written += chunk.toString('utf8')))
  child.kill = vi.fn(() => {
    child.exitCode = 1
    child.emit('exit', 1)
    return true
  })
  return child
}

async function speaker(platform: NodeJS.Platform = 'win32') {
  const children: ReturnType<typeof fakeChild>[] = []
  const calls: { command: string; args: string[]; env: NodeJS.ProcessEnv }[] = []
  const tempDir = await mkdtemp(join(tmpdir(), 'genoffice-speech-test-'))
  const spawn = vi.fn((command: string, args: string[], opts: { env: NodeJS.ProcessEnv }) => {
    const child = fakeChild()
    children.push(child)
    calls.push({ command, args, env: opts.env })
    return child
  })
  const s = new Speaker({ platform, spawn: spawn as never, tempDir, volume: '0' })
  return { s, children, calls, tempDir }
}

describe('limitSpeechText', () => {
  it('leaves short text alone and cuts long text without splitting a surrogate pair', () => {
    expect(limitSpeechText('short')).toBe('short')
    const long = '😀'.repeat(SPEECH_MAX_CHARS)
    const cut = limitSpeechText(long)
    expect(cut.length).toBeLessThanOrEqual(SPEECH_MAX_CHARS)
    const last = cut.charCodeAt(cut.length - 1)
    expect(last >= 0xd800 && last <= 0xdbff).toBe(false)
  })
})

describe('Speaker', () => {
  it('hands the text to PowerShell over standard input, never on the command line', async () => {
    const { s, children, calls } = await speaker()
    const text = 'Hello "world" $(Get-Process) `n; rm -rf /'
    expect(await s.start(text)).toEqual({ ok: true })
    expect(calls[0]!.command).toBe('powershell.exe')
    expect(calls[0]!.args.join(' ')).not.toContain('Get-Process')
    expect(children[0]!.written).toBe(text)
    expect(calls[0]!.env.GENOFFICE_SPEECH_CONTROL).toMatch(/genoffice-speech-.*\.ctl$/)
    expect(calls[0]!.env.GENOFFICE_SPEECH_VOLUME).toBe('0')
    expect(s.state()).toBe('reading')
  })

  it('reports nothing to read, and a system without a voice', async () => {
    const win = await speaker()
    expect(await win.s.start('   \n ')).toEqual({ ok: false, reason: 'no-text' })
    expect(win.children).toHaveLength(0)
    const mac = await speaker('darwin')
    expect(await mac.s.start('hello')).toEqual({ ok: false, reason: 'unsupported' })
    expect(mac.children).toHaveLength(0)
    expect(mac.s.state()).toBe('idle')
  })

  it('pauses and resumes through the control file', async () => {
    const { s, calls } = await speaker()
    await s.start('hello')
    const control = calls[0]!.env.GENOFFICE_SPEECH_CONTROL!
    expect(await s.togglePause()).toBe('paused')
    expect(await readFile(control, 'utf8')).toBe('pause')
    expect(s.state()).toBe('paused')
    expect(await s.togglePause()).toBe('reading')
    expect(await readFile(control, 'utf8')).toBe('resume')
  })

  it('stopping ends the process and removes the control file', async () => {
    const { s, children, calls } = await speaker()
    await s.start('hello')
    const control = calls[0]!.env.GENOFFICE_SPEECH_CONTROL!
    await s.togglePause()
    s.stop()
    expect(children[0]!.kill).toHaveBeenCalled()
    expect(s.state()).toBe('idle')
    await vi.waitFor(() => expect(existsSync(control)).toBe(false))
  })

  it('a new reading replaces the one in progress', async () => {
    const { s, children } = await speaker()
    await s.start('first')
    await s.start('second')
    expect(children[0]!.kill).toHaveBeenCalled()
    expect(children[1]!.written).toBe('second')
    expect(s.state()).toBe('reading')
  })

  it('goes idle by itself when the voice finishes, and pause then says so', async () => {
    const { s, children } = await speaker()
    await s.start('hello')
    children[0]!.exitCode = 0
    children[0]!.emit('exit', 0)
    expect(s.state()).toBe('idle')
    expect(await s.togglePause()).toBe('idle')
  })

  it('a finished reading does not disturb the reading that replaced it', async () => {
    const { s, children } = await speaker()
    await s.start('first')
    await s.start('second')
    // the first process reports its exit late
    children[0]!.emit('exit', 1)
    expect(s.state()).toBe('reading')
  })

  it('reports a start that failed, and stays idle', async () => {
    const { s, children } = await speaker()
    const pending = s.start('hello')
    // no PowerShell: the process reports an error before the text is taken
    await Promise.resolve()
    children[0]!.emit('error', new Error('spawn powershell.exe ENOENT'))
    const result = await pending
    expect(result).toMatchObject({ ok: false, reason: 'failed' })
    expect(s.state()).toBe('idle')
  })
})

// The real thing, silently: Windows' own voice at volume 0, a hidden PowerShell.
describe.skipIf(process.platform !== 'win32')('Speaker with Windows speech (muted)', () => {
  it('starts, pauses, resumes and stops a real reading', async () => {
    const s = new Speaker({ volume: '0' })
    const long = 'The quick brown fox jumps over the lazy dog. '.repeat(40)
    expect(await s.start(long)).toEqual({ ok: true })
    expect(s.state()).toBe('reading')
    expect(await s.togglePause()).toBe('paused')
    // the speaking process picks the control file up within a fraction of a second
    await new Promise((r) => setTimeout(r, 1200))
    expect(s.state()).toBe('paused')
    expect(await s.togglePause()).toBe('reading')
    s.stop()
    expect(s.state()).toBe('idle')
  }, 30_000)
})
