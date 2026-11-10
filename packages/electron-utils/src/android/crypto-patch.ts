// crypto-browserify lacks a few calls the desktop code uses; add them to the module's exports
import nodeCrypto from 'node:crypto'
Object.assign(nodeCrypto as unknown as Record<string, unknown>, {
  randomUUID: (): string => globalThis.crypto.randomUUID(),
  getRandomValues: <T extends ArrayBufferView>(a: T): T => globalThis.crypto.getRandomValues(a),
  webcrypto: globalThis.crypto,
  subtle: globalThis.crypto.subtle,
})
