/**
 * A small in-memory file system standing in for Node's `fs` inside the Android WebView.
 *
 * The desktop main-process code reads and writes ordinary paths. Here a path lives in memory; the
 * Android host puts the opened document at its path before the code asks for it, and is told when
 * that file is written so it can store the bytes back to the real file.
 */

type Bytes = Uint8Array
interface Entry {
  kind: 'file' | 'dir'
  data?: Bytes
  mtimeMs: number
}

const files = new Map<string, Entry>([['/', { kind: 'dir', mtimeMs: Date.now() }]])
let writeHook: ((path: string, data: Bytes) => void) | undefined

/** called after every file write; the host uses it to persist the opened document */
export function onFileWritten(hook: (path: string, data: Bytes) => void): void {
  writeHook = hook
}

/** put a file in the memory file system without notifying the host */
export function seedFile(path: string, data: Bytes): void {
  const p = norm(path)
  ensureDirs(p)
  files.set(p, { kind: 'file', data, mtimeMs: Date.now() })
}

function norm(path: string | URL): string {
  let p = typeof path === 'string' ? path : path.pathname
  p = p.replace(/\\/g, '/')
  if (!p.startsWith('/')) p = '/' + p
  const out: string[] = []
  for (const part of p.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return '/' + out.join('/')
}

function ensureDirs(path: string): void {
  const parts = path.split('/').filter(Boolean)
  let current = ''
  for (let i = 0; i < parts.length - 1; i++) {
    current += '/' + parts[i]
    if (!files.has(current)) files.set(current, { kind: 'dir', mtimeMs: Date.now() })
  }
}

function enoent(path: string, op: string): Error {
  const e = new Error(`ENOENT: no such file or directory, ${op} '${path}'`) as Error & { code: string; errno: number; path: string }
  e.code = 'ENOENT'
  e.errno = -2
  e.path = path
  return e
}

function toBytes(data: string | Bytes, encoding?: string): Bytes {
  if (typeof data === 'string') return Buffer.from(data, (encoding as BufferEncoding) || 'utf8')
  return data
}

function out(data: Bytes, options?: string | { encoding?: string | null }): Buffer | string {
  const encoding = typeof options === 'string' ? options : options?.encoding
  const buf = Buffer.from(data)
  return encoding ? buf.toString(encoding as BufferEncoding) : buf
}

class Stats {
  constructor(private entry: Entry) {}
  get size(): number { return this.entry.data?.byteLength ?? 0 }
  get mtimeMs(): number { return this.entry.mtimeMs }
  get ctimeMs(): number { return this.entry.mtimeMs }
  get atimeMs(): number { return this.entry.mtimeMs }
  get birthtimeMs(): number { return this.entry.mtimeMs }
  get mtime(): Date { return new Date(this.entry.mtimeMs) }
  get ctime(): Date { return new Date(this.entry.mtimeMs) }
  get atime(): Date { return new Date(this.entry.mtimeMs) }
  get birthtime(): Date { return new Date(this.entry.mtimeMs) }
  get mode(): number { return 0o644 }
  get ino(): number { return 0 }
  get dev(): number { return 0 }
  isFile(): boolean { return this.entry.kind === 'file' }
  isDirectory(): boolean { return this.entry.kind === 'dir' }
  isSymbolicLink(): boolean { return false }
}

class Dirent {
  constructor(public name: string, private dir: boolean) {}
  isFile(): boolean { return !this.dir }
  isDirectory(): boolean { return this.dir }
  isSymbolicLink(): boolean { return false }
}

function entryOf(path: string | URL, op: string): { p: string; entry: Entry } {
  const p = norm(path)
  const entry = files.get(p)
  if (!entry) throw enoent(p, op)
  return { p, entry }
}

export function existsSync(path: string | URL): boolean {
  return files.has(norm(path))
}

export function readFileSync(path: string | URL, options?: string | { encoding?: string | null }): Buffer | string {
  const { entry, p } = entryOf(path, 'open')
  if (entry.kind !== 'file') throw enoent(p, 'read')
  return out(entry.data ?? new Uint8Array(), options)
}

export function writeFileSync(path: string | URL, data: string | Bytes, options?: string | { encoding?: string }): void {
  const p = norm(path)
  ensureDirs(p)
  const bytes = toBytes(data, typeof options === 'string' ? options : options?.encoding)
  files.set(p, { kind: 'file', data: Buffer.from(bytes), mtimeMs: Date.now() })
  writeHook?.(p, bytes)
}

export function appendFileSync(path: string | URL, data: string | Bytes): void {
  const p = norm(path)
  const old = files.get(p)?.data ?? new Uint8Array()
  writeFileSync(p, Buffer.concat([Buffer.from(old), Buffer.from(toBytes(data))]))
}

export function mkdirSync(path: string | URL, options?: { recursive?: boolean }): string | undefined {
  const p = norm(path)
  if (options?.recursive) ensureDirs(p + '/x')
  if (!files.has(p)) files.set(p, { kind: 'dir', mtimeMs: Date.now() })
  return undefined
}

export function readdirSync(path: string | URL, options?: { withFileTypes?: boolean }): Array<string | Dirent> {
  const { p, entry } = entryOf(path, 'scandir')
  if (entry.kind !== 'dir') throw enoent(p, 'scandir')
  const prefix = p === '/' ? '/' : p + '/'
  const names = new Map<string, boolean>()
  for (const [key, e] of files) {
    if (key === p || !key.startsWith(prefix)) continue
    const rest = key.slice(prefix.length)
    const first = rest.split('/')[0]!
    names.set(first, rest.includes('/') ? true : e.kind === 'dir')
  }
  return [...names].map(([name, dir]) => (options?.withFileTypes ? new Dirent(name, dir) : name))
}

export function statSync(path: string | URL, options?: { throwIfNoEntry?: boolean }): Stats | undefined {
  const p = norm(path)
  const entry = files.get(p)
  if (!entry) {
    if (options?.throwIfNoEntry === false) return undefined
    throw enoent(p, 'stat')
  }
  return new Stats(entry)
}
export const lstatSync = statSync

export function unlinkSync(path: string | URL): void {
  const { p } = entryOf(path, 'unlink')
  files.delete(p)
}

export function rmSync(path: string | URL, options?: { recursive?: boolean; force?: boolean }): void {
  const p = norm(path)
  if (!files.has(p)) {
    if (options?.force) return
    throw enoent(p, 'rm')
  }
  for (const key of [...files.keys()]) if (key === p || key.startsWith(p + '/')) files.delete(key)
}
export const rmdirSync = rmSync

export function renameSync(from: string | URL, to: string | URL): void {
  const a = norm(from)
  const entry = files.get(a)
  if (!entry) throw enoent(a, 'rename')
  const b = norm(to)
  ensureDirs(b)
  files.delete(a)
  files.set(b, { ...entry, mtimeMs: Date.now() })
  if (entry.kind === 'file' && entry.data) writeHook?.(b, entry.data)
}

export function copyFileSync(from: string | URL, to: string | URL): void {
  const { entry } = entryOf(from, 'copyfile')
  writeFileSync(to, entry.data ?? new Uint8Array())
}

export function accessSync(path: string | URL): void {
  entryOf(path, 'access')
}

export function mkdtempSync(prefix: string): string {
  const p = norm(prefix + Math.random().toString(36).slice(2, 8))
  mkdirSync(p, { recursive: true })
  return p
}

export function realpathSync(path: string | URL): string {
  return norm(path)
}
export const utimesSync = (): void => undefined
export const chmodSync = (): void => undefined
export const fsyncSync = (): void => undefined
interface Fd { path: string; flags: string; pos: number }
const descriptors = new Map<number, Fd>()
let nextFd = 3
export const openSync = (path: string | URL, flags: string | number = 'r'): number => {
  const p = norm(path)
  const f = String(flags)
  if (!files.has(p)) {
    if (f.startsWith('r')) throw enoent(p, 'open')
    writeFileSync(p, new Uint8Array())
  } else if (f.startsWith('w')) writeFileSync(p, new Uint8Array())
  const fd = nextFd++
  descriptors.set(fd, { path: p, flags: f, pos: 0 })
  return fd
}
export const closeSync = (fd: number): void => {
  descriptors.delete(fd)
}
export const readSync = (fd: number, buffer: Bytes, offset = 0, length = buffer.byteLength - offset, position: number | null = null): number => {
  const d = descriptors.get(fd)
  if (!d) throw new Error('EBADF: bad file descriptor')
  const data = files.get(d.path)?.data ?? new Uint8Array()
  const at = position ?? d.pos
  const slice = data.subarray(at, at + length)
  buffer.set(slice, offset)
  if (position === null) d.pos += slice.length
  return slice.length
}
export const writeSync = (fd: number, data: string | Bytes, a?: number, b?: number, c?: number | null): number => {
  const d = descriptors.get(fd)
  if (!d) throw new Error('EBADF: bad file descriptor')
  const bytes = typeof data === 'string' ? Buffer.from(data) : (data as Bytes).subarray(a ?? 0, (a ?? 0) + (b ?? (data as Bytes).byteLength))
  const old = files.get(d.path)?.data ?? new Uint8Array()
  const at = (typeof data === 'string' ? (a as number | undefined) : c) ?? d.pos
  const next = new Uint8Array(Math.max(old.byteLength, at + bytes.byteLength))
  next.set(old)
  next.set(bytes, at)
  writeFileSync(d.path, next)
  d.pos = at + bytes.byteLength
  return bytes.byteLength
}
export const watch = () => ({ close: () => undefined, on: () => undefined })
export const watchFile = () => undefined
export const unwatchFile = () => undefined

const wrap = <A extends unknown[], R>(fn: (...args: A) => R) => async (...args: A): Promise<R> => fn(...args)

export const promises = {
  readFile: wrap(readFileSync),
  writeFile: wrap(writeFileSync),
  appendFile: wrap(appendFileSync),
  mkdir: wrap(mkdirSync),
  readdir: wrap(readdirSync),
  stat: wrap(statSync),
  lstat: wrap(lstatSync),
  unlink: wrap(unlinkSync),
  rm: wrap(rmSync),
  rmdir: wrap(rmSync),
  rename: wrap(renameSync),
  copyFile: wrap(copyFileSync),
  access: wrap(accessSync),
  mkdtemp: wrap(mkdtempSync),
  realpath: wrap(realpathSync),
  utimes: wrap(utimesSync),
  chmod: wrap(chmodSync),
  open: async (path: string | URL, flags: string | number = 'r') => {
    const fd = openSync(path, flags)
    return {
      fd,
      readFile: async (o?: string | { encoding?: string | null }) => readFileSync(path, o),
      writeFile: async (d: string | Bytes) => writeFileSync(path, d),
      stat: async () => statSync(path),
      read: async (buffer: Bytes, offset = 0, length = buffer.byteLength - offset, position: number | null = null) => {
        const bytesRead = readSync(fd, buffer, offset, length, position)
        return { bytesRead, buffer }
      },
      write: async (data: string | Bytes, a?: number, b?: number, c?: number | null) => ({ bytesWritten: writeSync(fd, data, a, b, c), buffer: data }),
      truncate: async () => undefined,
      sync: async () => undefined,
      close: async () => closeSync(fd),
    }
  },
}

// callback style: fs.readFile(path, opts?, cb)
type Cb<T> = (err: Error | null, value?: T) => void
function callbackify<A extends unknown[], R>(fn: (...args: A) => R) {
  return (...args: unknown[]): void => {
    const cb = args.pop() as Cb<R>
    try {
      cb(null, fn(...(args as A)))
    } catch (e) {
      cb(e as Error)
    }
  }
}
export const readFile = callbackify(readFileSync)
export const writeFile = callbackify(writeFileSync)
export const mkdir = callbackify(mkdirSync)
export const readdir = callbackify(readdirSync)
export const stat = callbackify(statSync)
export const unlink = callbackify(unlinkSync)
export const rename = callbackify(renameSync)
export const access = callbackify(accessSync)
export const exists = (path: string, cb: (e: boolean) => void): void => cb(existsSync(path))

export const constants = { F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1, COPYFILE_EXCL: 1 }
export { Stats, Dirent }

export default {
  existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync, readdirSync, statSync, lstatSync, unlinkSync,
  rmSync, rmdirSync, renameSync, copyFileSync, accessSync, mkdtempSync, realpathSync, utimesSync, chmodSync,
  fsyncSync, closeSync, openSync, readSync, writeSync, watch, watchFile, unwatchFile, promises, readFile, writeFile, mkdir, readdir,
  stat, unlink, rename, access, exists, constants, Stats, Dirent,
}
