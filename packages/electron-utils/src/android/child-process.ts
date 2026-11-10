/**
 * `child_process` for the Android WebView. The only program the apps start is the workbook engine
 * (the Rust xlsx-sidecar); the Android app runs it as a real process and this module hands its
 * lines to the page and the page's lines to it.
 */

type Listener = (...args: unknown[]) => void

class Emitter {
  private listeners = new Map<string, Set<Listener>>()
  on(event: string, fn: Listener): this {
    const set = this.listeners.get(event) ?? new Set<Listener>()
    set.add(fn)
    this.listeners.set(event, set)
    return this
  }
  once(event: string, fn: Listener): this {
    const wrapper: Listener = (...args) => {
      this.off(event, wrapper)
      fn(...args)
    }
    return this.on(event, wrapper)
  }
  off(event: string, fn: Listener): this {
    this.listeners.get(event)?.delete(fn)
    return this
  }
  removeListener(event: string, fn: Listener): this {
    return this.off(event, fn)
  }
  removeAllListeners(event?: string): this {
    if (event) this.listeners.delete(event)
    else this.listeners.clear()
    return this
  }
  emit(event: string, ...args: unknown[]): boolean {
    const set = this.listeners.get(event)
    if (!set?.size) return false
    for (const fn of [...set]) fn(...args)
    return true
  }
  setEncoding(): this {
    return this
  }
}

interface SidecarHost {
  sidecarStart(): boolean
  sidecarWrite(line: string): void
  sidecarKill(): void
}

const host = (window as unknown as { AndroidHost?: SidecarHost }).AndroidHost

class Child extends Emitter {
  readonly stdout = new Emitter()
  readonly stderr = new Emitter()
  readonly stdin = Object.assign(new Emitter(), {
    write: (chunk: string | Uint8Array, cb?: () => void): boolean => {
      const text = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
      for (const line of text.split('\n')) if (line) host?.sidecarWrite(line)
      cb?.()
      return true
    },
    end: (): void => undefined,
  })
  killed = false
  pid = 1
  kill(): boolean {
    this.killed = true
    host?.sidecarKill()
    this.emit('exit', 0, 'SIGTERM')
    return true
  }
}

let current: Child | undefined

Object.assign(window, {
  /** the engine wrote a line to its standard output */
  __sidecarOut: (line: string) => current?.stdout.emit('data', line + '\n'),
  __sidecarErr: (text: string) => current?.stderr.emit('data', text),
  __sidecarExit: (code: number) => {
    const child = current
    current = undefined
    child?.emit('exit', code, null)
  },
})

export function spawn(_command: string): Child {
  if (!host?.sidecarStart()) throw new Error('The workbook engine could not be started')
  current = new Child()
  return current
}

const unavailable = (what: string) => () => {
  throw new Error(`${what} is not available on Android`)
}
export const spawnSync = unavailable('Starting a program')
export const exec = unavailable('Starting a program')
export const execSync = unavailable('Starting a program')
export const execFile = unavailable('Starting a program')
export const execFileSync = unavailable('Starting a program')
export const fork = unavailable('Starting a program')

export default { spawn, spawnSync, exec, execSync, execFile, execFileSync, fork }
