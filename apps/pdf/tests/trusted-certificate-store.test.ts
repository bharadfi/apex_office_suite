// @vitest-environment node
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  addTrusted,
  loadTrusted,
  MAX_TRUSTED_CERTIFICATES,
  normalizeFingerprint,
  removeTrusted,
  sanitizeTrusted,
  saveTrusted,
  trustedFingerprints,
} from '../src/main/trusted-certificate-store'

/** a distinct, well-formed fingerprint for every n */
const fp = (n: number): string =>
  (n.toString(16).padStart(64, '0').toUpperCase().match(/../g) ?? []).join(':')

describe('normalizeFingerprint', () => {
  it('accepts a SHA-256 fingerprint in any case and rejects anything else', () => {
    expect(normalizeFingerprint(fp(1).toLowerCase())).toBe(fp(1))
    expect(normalizeFingerprint(`  ${fp(2)}  `)).toBe(fp(2))
    for (const bad of ['', 'AA:BB', fp(3).replace(/:/g, ''), fp(4) + ':00', 42, null, undefined]) {
      expect(normalizeFingerprint(bad)).toBeNull()
    }
  })
})

describe('trusted list', () => {
  it('adds newest first and does not duplicate a certificate', () => {
    let list = addTrusted([], fp(1), 'Alice', 100)
    list = addTrusted(list, fp(2), 'Bob', 200)
    expect(list.map((c) => c.commonName)).toEqual(['Bob', 'Alice'])
    list = addTrusted(list, fp(1).toLowerCase(), 'Alice again', 300)
    expect(list.map((c) => c.commonName)).toEqual(['Alice again', 'Bob'])
    expect(list).toHaveLength(2)
  })

  it('ignores something that is not a fingerprint', () => {
    expect(addTrusted([], 'not-a-fingerprint', 'x')).toEqual([])
  })

  it('removes by fingerprint, in any case', () => {
    const list = addTrusted(addTrusted([], fp(1), 'A', 1), fp(2), 'B', 2)
    expect(removeTrusted(list, fp(1).toLowerCase()).map((c) => c.commonName)).toEqual(['B'])
    expect(removeTrusted(list, 'junk')).toEqual(list)
  })

  it('exposes the fingerprints as a set', () => {
    const set = trustedFingerprints(addTrusted([], fp(5), 'A', 1))
    expect(set.has(fp(5))).toBe(true)
    expect(set.has(fp(6))).toBe(false)
  })

  it('is capped, dropping the oldest', () => {
    let list: ReturnType<typeof addTrusted> = []
    for (let i = 0; i < MAX_TRUSTED_CERTIFICATES + 5; i++)
      list = addTrusted(list, fp(i), `c${i}`, i)
    expect(list).toHaveLength(MAX_TRUSTED_CERTIFICATES)
    expect(list[0]!.commonName).toBe(`c${MAX_TRUSTED_CERTIFICATES + 4}`)
  })
})

describe('sanitizeTrusted', () => {
  it('keeps good entries and drops malformed or repeated ones', () => {
    const list = sanitizeTrusted([
      { fingerprint: fp(1), commonName: 'A', addedAt: 5 },
      { fingerprint: fp(1), commonName: 'dup' },
      { fingerprint: 'junk', commonName: 'bad' },
      'text',
      null,
      { fingerprint: fp(2.0), commonName: 7, addedAt: 'x' },
    ])
    expect(list).toEqual([
      { fingerprint: fp(1), commonName: 'A', addedAt: 5 },
      { fingerprint: fp(2), commonName: '', addedAt: 0 },
    ])
  })

  it('reads a non-list as empty', () => {
    expect(sanitizeTrusted({ a: 1 })).toEqual([])
    expect(sanitizeTrusted(null)).toEqual([])
  })
})

describe('on disk', () => {
  it('round-trips, and a missing or broken file is an empty list', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'genoffice-trusted-'))
    const file = join(dir, 'sub', 'trusted.json')
    expect(await loadTrusted(file)).toEqual([])
    const list = addTrusted([], fp(9), 'Carol', 42)
    await saveTrusted(file, list)
    expect(await loadTrusted(file)).toEqual(list)
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(list)
    await writeFile(file, '{ broken')
    expect(await loadTrusted(file)).toEqual([])
  })
})
