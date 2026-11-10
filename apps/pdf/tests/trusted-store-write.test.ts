// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

// A folder that refuses to replace a file by rename: an EFS-encrypted profile folder on Windows
// answers EXDEV, a locked target answers EPERM.
const { renameFails } = vi.hoisted(() => ({ renameFails: { code: 'EXDEV' } }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...real,
    rename: vi.fn(async () => {
      throw Object.assign(new Error(`${renameFails.code}: rename refused`), { code: renameFails.code })
    }),
  }
})

import { loadTrusted, saveTrusted } from '../src/main/trusted-certificate-store'
import { loadSignatures, saveSignatures } from '../src/main/signature-store'

const dir = mkdtempSync(join(tmpdir(), 'trust-write-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('saving the trusted list where the folder refuses a rename', () => {
  const entry = {
    fingerprint: Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, '0').toUpperCase()).join(':'),
    commonName: 'Alice',
    addedAt: 1,
  }

  it.each(['EXDEV', 'EPERM'])('still writes the list when the rename answers %s', async (code) => {
    renameFails.code = code
    const file = join(dir, `trusted-${code}.json`)
    writeFileSync(file, '[]') // a list already exists, so the write has to replace it
    await saveTrusted(file, [entry])
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual([entry])
    expect(await loadTrusted(file)).toEqual([entry])
  })

  it('does the same for the saved signatures', async () => {
    renameFails.code = 'EXDEV'
    const file = join(dir, 'signatures.json')
    writeFileSync(file, '[]')
    await saveSignatures(file, [])
    expect(await loadSignatures(file)).toEqual([])
  })
})
