/** `readline.createInterface` over a stream of 'data' chunks: emits one 'line' per newline */
type Source = { on(event: string, fn: (chunk: unknown) => void): unknown; off?(event: string, fn: (chunk: unknown) => void): unknown }

export function createInterface(options: { input: Source }) {
  const lineListeners = new Set<(line: string) => void>()
  let buffer = ''
  const onData = (chunk: unknown): void => {
    buffer += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk as Uint8Array)
    let at: number
    while ((at = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, at).replace(/\r$/, '')
      buffer = buffer.slice(at + 1)
      for (const fn of lineListeners) fn(line)
    }
  }
  options.input.on('data', onData)
  const api = {
    on(event: string, fn: (line: string) => void) {
      if (event === 'line') lineListeners.add(fn)
      return api
    },
    once(event: string, fn: (line: string) => void) {
      return api.on(event, fn)
    },
    close() {
      options.input.off?.('data', onData)
      lineListeners.clear()
    },
  }
  return api
}

export type Interface = ReturnType<typeof createInterface>
export default { createInterface }
