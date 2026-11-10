import { describe, expect, it } from 'vitest'
import type { PdfSignatureInfo } from '../src/shared/ipc'
import { marksForPage } from '../src/renderer/SignatureMarks'
import { trustAction } from '../src/renderer/SignaturesDialog'

const signer = (over: Partial<NonNullable<PdfSignatureInfo['signer']>> = {}) => ({
  commonName: 'Alice',
  subject: 'CN=Alice',
  issuerCommonName: 'Alice',
  issuer: 'CN=Alice',
  serialNumber: '01',
  validFrom: '2020-01-01T00:00:00.000Z',
  validTo: '2040-01-01T00:00:00.000Z',
  fingerprint: 'AA:BB',
  keyAlgorithm: 'RSA 2048',
  selfSigned: true,
  ...over,
})

function sig(over: Partial<PdfSignatureInfo> = {}): PdfSignatureInfo {
  return {
    fieldName: 'Signature1',
    pageIndex: 0,
    kind: 'signature',
    status: 'valid',
    problems: [],
    subFilter: 'adbe.pkcs7.detached',
    signingTimeSigned: true,
    coversWholeDocument: true,
    signer: signer(),
    chain: [],
    trusted: true,
    rect: [100, 50, 260, 110],
    ...over,
  }
}

describe('marksForPage', () => {
  const certified = (over: Partial<PdfSignatureInfo> = {}) =>
    sig({ certifiedLevel: 2, signer: signer({ email: 'alice@example.org' }), ...over })

  it('captions a certified signature on its own page only', () => {
    const list = [certified(), certified({ fieldName: 'S2', pageIndex: 1 })]
    expect(marksForPage(list, 0)).toHaveLength(1)
    expect(marksForPage(list, 1)).toHaveLength(1)
    expect(marksForPage(list, 2)).toEqual([])
  })

  it('gives the box as it is', () => {
    expect(marksForPage([certified()], 0)[0]).toMatchObject({ rect: [100, 50, 260, 110] })
  })

  it('skips an invisible signature, a time stamp and a signature with no page', () => {
    expect(marksForPage([certified({ rect: undefined })], 0)).toEqual([])
    expect(marksForPage([certified({ kind: 'timestamp' })], 0)).toEqual([])
    expect(marksForPage([certified({ pageIndex: -1 })], 0)).toEqual([])
  })

  it('names the certifier of a certified signature that verifies', () => {
    expect(marksForPage([certified()], 0)[0]!.certifiedBy).toEqual({
      name: 'Alice',
      email: 'alice@example.org',
    })
    // intact but not trusted yet still says who certified it
    expect(
      marksForPage([certified({ status: 'untrusted', trusted: false })], 0)[0]!.certifiedBy,
    ).toEqual({ name: 'Alice', email: 'alice@example.org' })
  })

  it('leaves the email out when the certificate has none', () => {
    expect(marksForPage([sig({ certifiedLevel: 1 })], 0)[0]!.certifiedBy).toEqual({ name: 'Alice' })
  })

  it('has no caption for an ordinary signature or one that does not verify (the mark is in the copy)', () => {
    expect(marksForPage([sig()], 0)).toEqual([])
    for (const status of ['warning', 'invalid'] as const) {
      expect(marksForPage([certified({ status })], 0)).toEqual([])
    }
  })

  it('leaves the caption of a box with its own validity layers to the redrawn copy', () => {
    expect(marksForPage([certified({ validityLayer: true })], 0)).toEqual([])
  })
})
describe('trustAction', () => {
  it('offers to add a signer that is not trusted yet', () => {
    expect(trustAction(sig({ status: 'untrusted', trusted: false }))).toBe('add')
    expect(trustAction(sig({ status: 'warning', trusted: false }))).toBe('add')
  })

  it('offers to remove a signer the user trusts', () => {
    expect(trustAction(sig({ trusted: true, trustedByUser: true }))).toBe('remove')
  })

  it('offers nothing when the system already vouches for the signer', () => {
    expect(trustAction(sig({ trusted: true }))).toBeNull()
  })

  it('offers nothing for a signature that no longer verifies, or one with no certificate', () => {
    expect(trustAction(sig({ status: 'invalid', trusted: false }))).toBeNull()
    expect(trustAction(sig({ signer: undefined, trusted: false }))).toBeNull()
  })
})
