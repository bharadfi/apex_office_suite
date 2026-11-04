// @vitest-environment node
import forge from 'node-forge'
import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFRawStream,
  StandardFonts,
  decodePDFRawStream,
  type PDFObject,
} from 'pdf-lib'
import { beforeAll, describe, expect, it } from 'vitest'
import { signPdf } from '../src/main/pdf-sign'
import { buildPrintCopy, pagesToPrint } from '../src/main/print-copy'
import { certifiedCaption, signatureDisplayCopy, verdictOf } from '../src/main/signature-display'

/** pages are told apart by their width: 100, 110, 120… */
async function textPdf(count: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 0; i < count; i++) {
    doc.addPage([100 + i * 10, 100]).drawText(`Page ${i + 1}`, { x: 10, y: 50, size: 12, font })
  }
  return doc.save({ useObjectStreams: false })
}

/** a page's drawing commands, whether its /Contents is one stream or several */
function pageDrawing(doc: PDFDocument, contents: PDFObject | undefined): string {
  const found = contents ? doc.context.lookup(contents) : undefined
  const streams =
    found instanceof PDFArray ? found.asArray().map((c) => doc.context.lookup(c)) : [found]
  return streams
    .filter((s): s is PDFRawStream => s instanceof PDFRawStream)
    .map((s) => Buffer.from(decodePDFRawStream(s).decode()).toString('latin1'))
    .join('\n')
}

const widths = async (bytes: Uint8Array): Promise<number[]> =>
  (await PDFDocument.load(bytes)).getPages().map((p) => p.getWidth())

describe('pagesToPrint', () => {
  it('means every page when none are asked for', () => {
    expect(pagesToPrint(undefined, 3)).toEqual([1, 2, 3])
    expect(pagesToPrint([], 2)).toEqual([1, 2])
  })

  it('keeps whole numbers inside the document, once each, in page order', () => {
    expect(pagesToPrint([3, 1, 3, 9, 0, -2, 1.5], 4)).toEqual([1, 3])
  })
})

describe('buildPrintCopy', () => {
  it('prints the file as it is when every page is wanted and nothing is signed', async () => {
    const original = await textPdf(3)
    expect(await buildPrintCopy(original, undefined)).toBe(original)
    expect(await buildPrintCopy(original, [1, 2, 3])).toBe(original)
  })

  it('keeps only the chosen pages, in order, and keeps their text as text', async () => {
    const copy = await buildPrintCopy(await textPdf(5), [2, 4, 5])
    expect(await widths(copy)).toEqual([110, 130, 140])
    const doc = await PDFDocument.load(copy)
    // each page still draws its text with text operators and no picture: it was not rasterised
    for (const page of doc.getPages()) {
      const drawing = pageDrawing(doc, page.node.get(PDFName.of('Contents')))
      expect(drawing).toContain('Tj')
      expect(drawing).not.toMatch(/\bDo\b/)
    }
  })

  it('refuses a request for pages the document does not have', async () => {
    await expect(buildPrintCopy(await textPdf(2), [7, 9])).rejects.toThrow(
      'none of the requested pages',
    )
  })

  it('does not change the bytes it was given', async () => {
    const original = await textPdf(3)
    const snapshot = Buffer.from(original)
    await buildPrintCopy(original, [1])
    expect(Buffer.from(original).equals(snapshot)).toBe(true)
  })
})

describe('verdictOf and certifiedCaption', () => {
  it('shows a tick only for a valid signature and a cross only for one that does not verify', () => {
    expect(verdictOf({ status: 'valid' })).toBe('valid')
    expect(verdictOf({ status: 'invalid' })).toBe('invalid')
    expect(verdictOf({ status: 'untrusted' })).toBe('unknown')
    expect(verdictOf({ status: 'warning' })).toBe('unknown')
  })

  const signer = (over: Record<string, unknown> = {}) => ({ commonName: 'Alice', ...over }) as never

  it('names the certifier of a certifying signature that verifies', () => {
    const base = { certifiedLevel: 2 as const, signerName: undefined }
    expect(
      certifiedCaption({ ...base, status: 'valid', signer: signer({ email: 'a@b.org' }) }),
    ).toBe('Document certified by Alice <a@b.org>.')
    expect(certifiedCaption({ ...base, status: 'untrusted', signer: signer() })).toBe(
      'Document certified by Alice.',
    )
  })

  it('names no one for an ordinary signature, a broken one, or one with no name', () => {
    expect(
      certifiedCaption({ status: 'valid', certifiedLevel: undefined, signer: signer() }),
    ).toBeUndefined()
    expect(
      certifiedCaption({ status: 'invalid', certifiedLevel: 1, signer: signer() }),
    ).toBeUndefined()
    expect(
      certifiedCaption({ status: 'warning', certifiedLevel: 1, signer: signer() }),
    ).toBeUndefined()
    expect(
      certifiedCaption({
        status: 'valid',
        certifiedLevel: 1,
        signer: undefined,
        signerName: undefined,
      }),
    ).toBeUndefined()
  })
})

describe('signatureDisplayCopy', () => {
  let p12: Uint8Array
  beforeAll(() => {
    const keys = forge.pki.rsa.generateKeyPair(2048)
    const cert = forge.pki.createCertificate()
    cert.publicKey = keys.publicKey
    cert.serialNumber = '01' + forge.util.bytesToHex(forge.random.getBytesSync(8))
    cert.validity.notBefore = new Date(Date.now() - 86_400_000)
    cert.validity.notAfter = new Date(Date.now() + 86_400_000)
    cert.setSubject([{ name: 'commonName', value: 'Alice' }])
    cert.setIssuer([{ name: 'commonName', value: 'Alice' }])
    cert.sign(keys.privateKey, forge.md.sha256.create())
    const asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], 'pw', { algorithm: '3des' })
    p12 = Buffer.from(forge.asn1.toDer(asn1).getBytes(), 'binary')
  }, 60_000)

  it('has nothing to redraw in an unsigned file, or in a signature with no mark layer of its own', async () => {
    expect(await signatureDisplayCopy(await textPdf(1))).toBeNull()
    const signed = await signPdf(await textPdf(1), { p12, password: 'pw' })
    expect(await signatureDisplayCopy(signed)).toBeNull()
  })

  it('prints a signed file unchanged when there is no mark to redraw', async () => {
    const signed = await signPdf(await textPdf(2), { p12, password: 'pw' })
    expect(await buildPrintCopy(signed, undefined)).toBe(signed)
  })

  it('returns null for something that is not a PDF instead of throwing', async () => {
    expect(await signatureDisplayCopy(new Uint8Array([1, 2, 3]))).toBeNull()
  })
})
