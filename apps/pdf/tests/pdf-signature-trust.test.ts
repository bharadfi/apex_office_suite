// @vitest-environment node
import forge from 'node-forge'
import { PDFDocument } from 'pdf-lib'
import { beforeAll, describe, expect, it } from 'vitest'
import { signPdf } from '../src/main/pdf-sign'
import { certificateEmail, readPdfSignatures } from '../src/main/pdf-signatures'

const PASSWORD = 'pw'

interface MadeP12 {
  p12: Uint8Array
  /** SHA-256 fingerprint as Node prints it */
  fingerprint: string
}

/** A self-made certificate; `email` goes in the subject, `altEmail` in the alternative names */
function makeP12(commonName: string, opts: { email?: string; altEmail?: string } = {}): MadeP12 {
  const keys = forge.pki.rsa.generateKeyPair(2048)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = '01' + forge.util.bytesToHex(forge.random.getBytesSync(8))
  cert.validity.notBefore = new Date(Date.now() - 86_400_000)
  cert.validity.notAfter = new Date(Date.now() + 365 * 86_400_000)
  const attrs = [
    { name: 'commonName', value: commonName },
    ...(opts.email ? [{ name: 'emailAddress', value: opts.email }] : []),
  ]
  cert.setSubject(attrs)
  cert.setIssuer(attrs)
  if (opts.altEmail) {
    cert.setExtensions([{ name: 'subjectAltName', altNames: [{ type: 1, value: opts.altEmail }] }])
  }
  cert.sign(keys.privateKey, forge.md.sha256.create())
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes()
  const sha = forge.md.sha256.create().update(der).digest().toHex().toUpperCase()
  const asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], PASSWORD, { algorithm: '3des' })
  return {
    p12: Buffer.from(forge.asn1.toDer(asn1).getBytes(), 'binary'),
    fingerprint: (sha.match(/../g) ?? []).join(':'),
  }
}

async function samplePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.addPage([400, 300]).drawText('Hello', { x: 40, y: 200, size: 24 })
  // the default (compressed) layout: flipping a byte near the start then lands in compressed
  // data, which a signature check reports as altered, not in object syntax a parser rejects
  return doc.save()
}

let alice: MadeP12
let bob: MadeP12

beforeAll(() => {
  alice = makeP12('Alice', { email: 'alice@example.org' })
  bob = makeP12('Bob', { altEmail: 'bob@example.net' })
}, 60_000)

describe('trusting a signer', () => {
  it('judges a self-made certificate untrusted until the user trusts it', async () => {
    const signed = await signPdf(await samplePdf(), { p12: alice.p12, password: PASSWORD })
    const [before] = await readPdfSignatures(signed)
    expect(before!.status).toBe('untrusted')
    expect(before!.trusted).toBe(false)
    expect(before!.trustedByUser).toBeUndefined()
    expect(before!.signer?.fingerprint).toBe(alice.fingerprint)

    const [after] = await readPdfSignatures(signed, new Set([alice.fingerprint]))
    expect(after!.status).toBe('valid')
    expect(after!.trusted).toBe(true)
    expect(after!.trustedByUser).toBe(true)
    expect(after!.problems).toEqual([])
  })

  it('does not change the verdict when the trusted certificate is someone else', async () => {
    const signed = await signPdf(await samplePdf(), { p12: alice.p12, password: PASSWORD })
    const [sig] = await readPdfSignatures(signed, new Set([bob.fingerprint]))
    expect(sig!.status).toBe('untrusted')
    expect(sig!.trustedByUser).toBeUndefined()
  })

  it('never rescues a signature that no longer verifies', async () => {
    const signed = Buffer.from(
      await signPdf(await samplePdf(), { p12: alice.p12, password: PASSWORD }),
    )
    const at = signed.indexOf('%PDF-') + 20
    signed[at] = signed[at]! ^ 0xff
    const [sig] = await readPdfSignatures(signed, new Set([alice.fingerprint]))
    expect(sig!.status).toBe('invalid')
    expect(sig!.problems).toContain('digest-mismatch')
  })

  it('keeps a change made after signing a warning even for a trusted signer', async () => {
    const first = await signPdf(await samplePdf(), { p12: alice.p12, password: PASSWORD })
    const second = await signPdf(first, { p12: bob.p12, password: PASSWORD })
    const sigs = await readPdfSignatures(second, new Set([alice.fingerprint, bob.fingerprint]))
    expect(sigs[0]!.status).toBe('warning')
    expect(sigs[0]!.problems).toContain('document-changed-after-signing')
    expect(sigs[1]!.status).toBe('valid')
  })
})

describe('the signer, as the signature box sees it', () => {
  it('reads the email from the subject, or else from the alternative names', async () => {
    const [a] = await readPdfSignatures(
      await signPdf(await samplePdf(), { p12: alice.p12, password: PASSWORD }),
    )
    expect(a!.signer?.email).toBe('alice@example.org')
    const [b] = await readPdfSignatures(
      await signPdf(await samplePdf(), { p12: bob.p12, password: PASSWORD }),
    )
    expect(b!.signer?.email).toBe('bob@example.net')
  })

  it('gives the box of a visible signature, and none for an invisible one', async () => {
    const invisible = await signPdf(await samplePdf(), { p12: alice.p12, password: PASSWORD })
    expect((await readPdfSignatures(invisible))[0]!.rect).toBeUndefined()

    const png = forge.util.decode64(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    )
    const visible = await signPdf(await samplePdf(), {
      p12: alice.p12,
      password: PASSWORD,
      visible: {
        pageIndex: 0,
        position: 'bottom-right',
        width: 160,
        height: 60,
        png: new Uint8Array(Buffer.from(png, 'binary')),
      },
    })
    const [sig] = await readPdfSignatures(visible)
    expect(sig!.pageIndex).toBe(0)
    const [x0, y0, x1, y1] = sig!.rect!
    expect(x1 - x0).toBeCloseTo(160, 0)
    expect(y1 - y0).toBeCloseTo(60, 0)
    expect(x0).toBeLessThan(x1)
    expect(y0).toBeLessThan(y1)
  })
})

describe('certificateEmail', () => {
  it('prefers the subject, falls back to the alternative names, and may find none', () => {
    expect(certificateEmail('CN=A\nemailAddress=a@x.org', 'email:b@y.org')).toBe('a@x.org')
    expect(certificateEmail('CN=A', 'DNS:x.org, email:b@y.org, URI:https://x.org')).toBe('b@y.org')
    expect(certificateEmail('CN=A', undefined)).toBeUndefined()
    expect(certificateEmail('CN=A\nemailAddress=', 'DNS:x.org')).toBeUndefined()
  })
})
