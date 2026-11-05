// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PDFDocument, PDFName } from 'pdf-lib'
import { encryptDocument } from '../src/main/pdf-crypt'
import { encryptionMethod, readSecurity } from '../src/main/pdf-security'

const open = (name: string) =>
  PDFDocument.load(new Uint8Array(readFileSync(join(__dirname, 'fixtures', name))), {
    ignoreEncryption: true,
    updateMetadata: false,
  })

describe('readSecurity on real producer files', () => {
  it('says a plain file is not encrypted and holds nothing hidden', async () => {
    const info = readSecurity(await open('plain-sample.pdf'))
    expect(info.encryption).toBeNull()
    expect(info.signatures).toBe(0)
    expect(info.certified).toBe(false)
  })

  it.each([
    ['enc-r3-rc4.pdf', 'RC4 128-bit'],
    ['enc-r4-aes128.pdf', 'AES 128-bit'],
    ['enc-r5-aes256.pdf', 'AES 256-bit'],
  ])('names the method of %s as %s', async (file, method) => {
    const info = readSecurity(await open(file))
    expect(info.encryption?.method).toBe(method)
  })
})

describe('readSecurity on a file this app encrypts', () => {
  it('reads back the permissions that were written', async () => {
    const doc = await PDFDocument.create()
    doc.addPage()
    encryptDocument(doc, {
      userPassword: 'u',
      ownerPassword: 'o',
      permissions: { printing: true, modifying: false, annotating: false, copying: true },
    })
    const bytes = await doc.save({ useObjectStreams: false })
    const info = readSecurity(
      await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false }),
    )
    expect(info.encryption).toEqual({
      method: 'AES 256-bit',
      permissions: { printing: true, modifying: false, annotating: false, copying: true },
    })
  })
})

describe('readSecurity on signatures', () => {
  it('counts signed fields only, and sees a certifying signature', async () => {
    const doc = await PDFDocument.create()
    doc.addPage()
    const ctx = doc.context
    const signed = ctx.register(ctx.obj({ FT: 'Sig', V: ctx.register(ctx.obj({ Type: 'Sig' })) }))
    const empty = ctx.register(ctx.obj({ FT: 'Sig' }))
    doc.catalog.set(PDFName.of('AcroForm'), ctx.obj({ Fields: [signed, empty] }))
    doc.catalog.set(PDFName.of('Perms'), ctx.obj({ DocMDP: signed }))
    const info = readSecurity(doc)
    expect(info.signatures).toBe(1)
    expect(info.certified).toBe(true)
  })
})

describe('encryptionMethod', () => {
  it('keeps what it cannot name as unknown', () => {
    expect(encryptionMethod(1, undefined, undefined)).toBe('RC4 40-bit')
    expect(encryptionMethod(2, undefined, 128)).toBe('RC4 128-bit')
    expect(encryptionMethod(4, 'Identity', undefined)).toBeNull()
    expect(encryptionMethod(9, undefined, undefined)).toBeNull()
  })
})
