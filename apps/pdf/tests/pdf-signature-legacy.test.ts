// @vitest-environment node
import forge from 'node-forge'
import { beforeAll, describe, expect, it } from 'vitest'
import { readPdfSignatures } from '../src/main/pdf-signatures'

/** A key and a self-signed certificate that is valid only between the given years */
function identity(commonName: string, fromYear: number, toYear: number) {
  const keys = forge.pki.rsa.generateKeyPair(2048)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = '01'
  cert.validity.notBefore = new Date(Date.UTC(fromYear, 0, 1))
  cert.validity.notAfter = new Date(Date.UTC(toYear, 0, 1))
  cert.setSubject([{ name: 'commonName', value: commonName }])
  cert.setIssuer([{ name: 'commonName', value: commonName }])
  cert.sign(keys.privateKey, forge.md.sha256.create())
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes()
  return { keys, certHex: forge.util.bytesToHex(der), fingerprint: sha256Colon(der) }
}

function sha256Colon(der: string): string {
  const md = forge.md.sha256.create()
  md.update(der)
  return md.digest().toHex().toUpperCase().match(/../g)!.join(':')
}

const CONTENTS_BYTES = 512
const pad = (n: number) => String(n).padStart(10, '0')

/**
 * A PDF signed the original way (SubFilter adbe.x509.rsa_sha1): /Contents is a DER OCTET STRING
 * holding a bare RSA PKCS#1 v1.5 signature over the SHA-1 of the signed ranges, and the signer's
 * certificate sits in /Cert. `claimed` is the signing time the signature dictionary states.
 */
function legacySignedPdf(who: ReturnType<typeof identity>, claimed: string): Buffer {
  const before =
    '%PDF-1.4\n' +
    '1 0 obj\n<</Type/Catalog/Pages 2 0 R/AcroForm<</Fields[4 0 R]/SigFlags 3>>>>\nendobj\n' +
    '2 0 obj\n<</Type/Pages/Kids[3 0 R]/Count 1>>\nendobj\n' +
    '3 0 obj\n<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Annots[4 0 R]>>\nendobj\n' +
    '4 0 obj\n<</Type/Annot/Subtype/Widget/FT/Sig/T(Signature1)/Rect[0 0 0 0]/F 132/P 3 0 R/V 5 0 R>>\nendobj\n' +
    `5 0 obj\n<</Type/Sig/Filter/Adobe.PPKLite/SubFilter/adbe.x509.rsa_sha1/M(D:${claimed})/Cert<${who.certHex}>/ByteRange[0 `
  const after = '>>\nendobj\ntrailer\n<</Root 1 0 R/Size 6>>\nstartxref\n0\n%%EOF\n'
  const hexLength = CONTENTS_BYTES * 2
  // the ByteRange numbers are fixed-width, so they can be written before the signature exists
  const head1 = `${before}${pad(0)} ${pad(0)} ${pad(0)}]/Contents`
  const length1 = head1.length
  const start2 = length1 + 1 + hexLength + 1
  const ranges = `${pad(length1)} ${pad(start2)} ${pad(after.length)}]/Contents`
  const first = `${before}${ranges}`
  const second = after
  const md = forge.md.sha1.create()
  md.update(first + second)
  const signature = who.keys.privateKey.sign(md)
  const octets = forge.asn1.toDer(
    forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OCTETSTRING, false, signature),
  ).getBytes()
  const hex = forge.util.bytesToHex(octets).padEnd(hexLength, '0')
  return Buffer.from(`${first}<${hex}>${second}`, 'latin1')
}

describe('signatures written the original way (adbe.x509.rsa_sha1)', () => {
  let alice: ReturnType<typeof identity>
  beforeAll(() => {
    alice = identity('Alice', 2009, 2010)
  }, 60_000)

  it('verifies the signature instead of calling it damaged', async () => {
    const [info] = await readPdfSignatures(legacySignedPdf(alice, "20091004164208+06'00'"))
    expect(info?.subFilter).toBe('adbe.x509.rsa_sha1')
    expect(info?.problems).not.toContain('malformed')
    expect(info?.problems).not.toContain('signature-invalid')
    // intact; only the issuer is unknown, because the certificate vouches for itself
    expect(info?.status).toBe('untrusted')
    expect(info?.problems).toEqual(['self-signed'])
    expect(info?.signer?.commonName).toBe('Alice')
    expect(info?.coversWholeDocument).toBe(true)
  })

  it('is valid once the signer is trusted', async () => {
    const [info] = await readPdfSignatures(
      legacySignedPdf(alice, "20091004164208+06'00'"),
      new Set([alice.fingerprint]),
    )
    expect(info?.status).toBe('valid')
    expect(info?.trustedByUser).toBe(true)
  })

  it('judges the certificate at the signing time the signature claims, as other readers do', async () => {
    // valid in 2009: signed in 2009 it is fine today; claimed for 2012 it had already expired
    const [late] = await readPdfSignatures(legacySignedPdf(alice, "20120101000000Z"))
    expect(late?.problems).toContain('certificate-expired')
    const [early] = await readPdfSignatures(legacySignedPdf(alice, "20091004164208+06'00'"))
    expect(early?.problems).not.toContain('certificate-expired')
  })

  it('rejects a document changed after it was signed', async () => {
    const signed = legacySignedPdf(alice, "20091004164208+06'00'")
    const tampered = Buffer.from(signed)
    const at = tampered.indexOf('MediaBox[0 0 200 200]')
    tampered.write('MediaBox[0 0 201 200]', at, 'latin1') // same length: only the signed bytes change
    const [info] = await readPdfSignatures(tampered)
    expect(info?.status).toBe('invalid')
    expect(info?.problems).toContain('signature-invalid')
  })

  it('reports a legacy signature with no certificate as unreadable, not as valid', async () => {
    const signed = legacySignedPdf(alice, "20091004164208+06'00'")
    const stripped = Buffer.from(signed.toString('latin1').replace(/\/Cert<[0-9a-f]+>/, '/Cert<00>'), 'latin1')
    const [info] = await readPdfSignatures(stripped)
    expect(info?.status).toBe('invalid')
  })
})
