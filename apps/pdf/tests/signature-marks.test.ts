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
  it('marks a visible signature on its own page only', () => {
    const list = [sig(), sig({ fieldName: 'S2', pageIndex: 1, status: 'invalid' })]
    expect(marksForPage(list, 0).map((m) => m.status)).toEqual(['valid'])
    expect(marksForPage(list, 1).map((m) => m.status)).toEqual(['invalid'])
    expect(marksForPage(list, 2)).toEqual([])
  })

  it('gives the box and the verdict as they are, whatever the status', () => {
    for (const status of ['valid', 'untrusted', 'warning', 'invalid'] as const) {
      expect(marksForPage([sig({ status })], 0)[0]).toMatchObject({
        status,
        rect: [100, 50, 260, 110],
      })
    }
  })

  it('skips an invisible signature, a time stamp and a signature with no page', () => {
    expect(marksForPage([sig({ rect: undefined })], 0)).toEqual([])
    expect(marksForPage([sig({ kind: 'timestamp' })], 0)).toEqual([])
    expect(marksForPage([sig({ pageIndex: -1 })], 0)).toEqual([])
  })

  it('names the certifier of a certified signature that verifies', () => {
    const certified = sig({
      certifiedLevel: 2,
      signer: signer({ email: 'alice@example.org' }),
    })
    expect(marksForPage([certified], 0)[0]!.certifiedBy).toEqual({
      name: 'Alice',
      email: 'alice@example.org',
    })
    // intact but not trusted yet still says who certified it
    expect(
      marksForPage([{ ...certified, status: 'untrusted', trusted: false }], 0)[0]!.certifiedBy,
    ).toEqual({ name: 'Alice', email: 'alice@example.org' })
  })

  it('leaves the email out when the certificate has none', () => {
    expect(marksForPage([sig({ certifiedLevel: 1 })], 0)[0]!.certifiedBy).toEqual({ name: 'Alice' })
  })

  it('names no certifier for an ordinary signature or one that does not verify', () => {
    expect(marksForPage([sig()], 0)[0]!.certifiedBy).toBeUndefined()
    for (const status of ['warning', 'invalid'] as const) {
      expect(marksForPage([sig({ certifiedLevel: 2, status })], 0)[0]!.certifiedBy).toBeUndefined()
    }
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
