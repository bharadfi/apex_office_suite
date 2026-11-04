// @vitest-environment node
import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { Scanner } from '../src/main/scanner'

interface FakeRun {
  /** exit status the "script" ends with */
  code: number
  /** what it writes to standard output */
  said?: string
  /** a picture it saves where GENOFFICE_SCAN_OUT says, as the real script does on success */
  picture?: Uint8Array
  /** delay before it finishes, ms */
  after?: number
}

async function scanner(run: FakeRun, platform: NodeJS.Platform = 'win32') {
  const tempDir = await mkdtemp(join(tmpdir(), 'genoffice-scan-test-'))
  const seen: { args: string[]; out: string }[] = []
  const spawn = vi.fn((_command: string, args: string[], opts: { env: NodeJS.ProcessEnv }) => {
    const child = new EventEmitter() as EventEmitter & { stdout: PassThrough }
    child.stdout = new PassThrough()
    const out = opts.env.GENOFFICE_SCAN_OUT!
    seen.push({ args, out })
    setTimeout(async () => {
      if (run.picture) await writeFile(out, run.picture)
      if (run.said) child.stdout.write(run.said)
      child.emit('close', run.code)
    }, run.after ?? 0)
    return child
  })
  return { s: new Scanner({ platform, spawn: spawn as never, tempDir }), seen, spawn, tempDir }
}

describe('Scanner', () => {
  it('returns the picture the scan window saved, and cleans up the file', async () => {
    const { s, seen } = await scanner({ code: 0, picture: new Uint8Array([1, 2, 3, 4]) })
    const result = await s.scan()
    expect(result).toEqual({ ok: true, png: new Uint8Array([1, 2, 3, 4]) })
    expect(existsSync(seen[0]!.out)).toBe(false)
    expect(s.busy).toBe(false)
  })

  it('keeps the file path out of the script text', async () => {
    const { s, seen } = await scanner({ code: 0, picture: new Uint8Array([1]) })
    await s.scan()
    expect(seen[0]!.args.join(' ')).not.toContain(seen[0]!.out)
    expect(seen[0]!.out).toMatch(/genoffice-scan-.*\.png$/)
  })

  it('reports a window closed without scanning as cancelled', async () => {
    const { s } = await scanner({ code: 2 })
    expect(await s.scan()).toEqual({ ok: false, reason: 'cancelled' })
  })

  it('reports no scanner when Windows knows of none', async () => {
    const { s } = await scanner({
      code: 3,
      said: 'No WIA device of the selected type is available.',
    })
    expect(await s.scan()).toEqual({ ok: false, reason: 'no-scanner' })
  })

  it('passes on what Windows said when a scan fails another way', async () => {
    const { s } = await scanner({ code: 3, said: 'The device is busy.' })
    expect(await s.scan()).toEqual({ ok: false, reason: 'failed', detail: 'The device is busy.' })
  })

  it('reports a success that left no picture as a failure', async () => {
    const { s } = await scanner({ code: 0 })
    expect(await s.scan()).toMatchObject({ ok: false, reason: 'failed' })
  })

  it('allows one scan window at a time', async () => {
    const { s, spawn } = await scanner({ code: 0, picture: new Uint8Array([9]), after: 50 })
    const first = s.scan()
    expect(s.busy).toBe(true)
    expect(await s.scan()).toEqual({ ok: false, reason: 'busy' })
    expect((await first).ok).toBe(true)
    expect(spawn).toHaveBeenCalledTimes(1)
    // and the next one is free to start
    expect((await s.scan()).ok).toBe(true)
  })

  it('says it is not available outside Windows, without starting anything', async () => {
    const { s, spawn } = await scanner({ code: 0 }, 'darwin')
    expect(await s.scan()).toEqual({ ok: false, reason: 'unsupported' })
    expect(spawn).not.toHaveBeenCalled()
  })

  it('reports a process that could not start', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'genoffice-scan-test-'))
    const s = new Scanner({
      platform: 'win32',
      tempDir,
      spawn: (() => {
        const child = new EventEmitter() as EventEmitter & { stdout: PassThrough }
        child.stdout = new PassThrough()
        setTimeout(() => child.emit('error', new Error('spawn powershell.exe ENOENT')), 0)
        return child
      }) as never,
    })
    expect(await s.scan()).toMatchObject({ ok: false, reason: 'failed' })
    expect(s.busy).toBe(false)
  })
})
