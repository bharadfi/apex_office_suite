/**
 * Stand-in for Node modules that have no meaning on the phone (child processes, worker threads,
 * sockets). Importing them works; using them throws a clear error or does nothing.
 */
const unavailable = (what: string) => () => {
  throw new Error(`${what} is not available on Android`)
}

export const spawn = unavailable('Starting a program')
export const spawnSync = unavailable('Starting a program')
export const exec = unavailable('Starting a program')
export const execSync = unavailable('Starting a program')
export const execFile = unavailable('Starting a program')
export const execFileSync = unavailable('Starting a program')
export const fork = unavailable('Starting a program')
export const isMainThread = true
export const parentPort = null
export const workerData = null
export class Worker {
  constructor() {
    throw new Error('Worker threads are not available on Android')
  }
}
export const createServer = unavailable('A network server')
export const request = unavailable('A raw network request')
export const get = unavailable('A raw network request')
export const connect = unavailable('A raw network connection')
export const Agent = class {}
export const createRequire = () => unavailable('require')
export const builtinModules: string[] = []
export const fileURLToPath = (u: string | URL): string => decodeURIComponent((typeof u === 'string' ? new URL(u) : u).pathname)
export const pathToFileURL = (p: string): URL => new URL('file://' + p)

export default { spawn, spawnSync, exec, execSync, execFile, execFileSync, fork, isMainThread, parentPort, workerData, Worker, createServer, request, get, connect, Agent, createRequire, builtinModules }

export const pipeline = async (): Promise<void> => { throw new Error('Streaming pipelines are not available on Android') }
export const finished = async (): Promise<void> => undefined

export class BlockList { addAddress(): void {} addRange(): void {} addSubnet(): void {} check(): boolean { return false } }
export const isIP = (s: string): number => (/^\d+\.\d+\.\d+\.\d+$/.test(s) ? 4 : s.includes(':') ? 6 : 0)
export const isIPv4 = (s: string): boolean => isIP(s) === 4
export const isIPv6 = (s: string): boolean => isIP(s) === 6
export const lookup = async (): Promise<never> => { throw new Error('DNS lookups are not available on Android') }
export const createInterface = unavailable('A line reader')

export const MessageChannel = globalThis.MessageChannel
export const receiveMessageOnPort = (): undefined => undefined
