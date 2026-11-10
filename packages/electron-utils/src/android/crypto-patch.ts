// crypto-browserify lacks a few calls the desktop code uses; add them to the module's exports
import nodeCrypto from 'node:crypto'
Object.assign(nodeCrypto as unknown as Record<string, unknown>, {
  randomUUID: (): string => globalThis.crypto.randomUUID(),
  getRandomValues: <T extends ArrayBufferView>(a: T): T => globalThis.crypto.getRandomValues(a),
  webcrypto: globalThis.crypto,
  subtle: globalThis.crypto.subtle,
})

// the temp and home folders must be real folders on the phone, since the workbook engine process writes into them
import nodeOs from 'node:os'
import { realRoot } from './fs'
if (realRoot) {
  Object.assign(nodeOs as unknown as Record<string, unknown>, {
    tmpdir: (): string => realRoot + '/tmp',
    homedir: (): string => realRoot + '/home',
  })
}
