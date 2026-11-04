import { test, expect } from '@playwright/test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import forge from 'node-forge'
import { PDFDocument } from 'pdf-lib'
import { signPdf } from '../apps/pdf/src/main/pdf-sign'
import { launchShell, waitForPageWithUrl, closeAndSaveVideo } from './helpers'

const PASSWORD = 'pw'
/** a 1×1 PNG: the picture a visible signature carries */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

function selfMadeP12(commonName: string): Uint8Array {
  const keys = forge.pki.rsa.generateKeyPair(2048)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = '01' + forge.util.bytesToHex(forge.random.getBytesSync(8))
  cert.validity.notBefore = new Date(Date.now() - 86_400_000)
  cert.validity.notAfter = new Date(Date.now() + 365 * 86_400_000)
  const attrs = [{ name: 'commonName', value: commonName }]
  cert.setSubject(attrs)
  cert.setIssuer(attrs)
  cert.sign(keys.privateKey, forge.md.sha256.create())
  const asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], PASSWORD, { algorithm: '3des' })
  return Buffer.from(forge.asn1.toDer(asn1).getBytes(), 'binary')
}

test('a signature shows its verdict on the page, and trusting the signer is remembered', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'genoffice-pdf-sigtrust-'))
  const pdfPath = join(dir, 'signed.pdf')
  const doc = await PDFDocument.create()
  doc.addPage([400, 300])
  const signed = await signPdf(await doc.save(), {
    p12: selfMadeP12('Trust Test Signer'),
    password: PASSWORD,
    visible: { pageIndex: 0, position: 'bottom-right', width: 160, height: 60, png: PNG },
  })
  await writeFile(pdfPath, signed)

  const first = await launchShell({
    onboardingSeen: true,
    videoDir: 'pdf-signature-trust',
    openFile: pdfPath,
  })
  const userDataDir = first.userDataDir
  try {
    const page = await waitForPageWithUrl(first.app, '://pdf/')
    const mark = page.locator('.pdf-sig-mark')

    // intact, but the signer is not known: an amber question mark
    await expect(mark).toHaveCount(1)
    await expect(mark).toHaveClass(/untrusted/)
    await expect(page.locator('.pdf-sig-banner')).toContainText('signer not trusted')

    // trust the signer from the signatures list: the mark and the banner follow at once
    await page.getByRole('button', { name: 'View signatures' }).click()
    await page.getByRole('button', { name: 'Add to trusted certificates', exact: true }).click()
    await expect(mark).toHaveClass(/valid/)
    await expect(
      page.getByRole('button', { name: 'Remove from trusted certificates' }),
    ).toBeVisible()
    await expect(page.locator('.pdf-sig-trusted-by-you')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.pdf-sig-banner')).toContainText('Signature is valid')
  } finally {
    await closeAndSaveVideo(first, 'pdf-signature-trust')
  }

  // a new run with the same settings folder: the choice was saved
  const second = await launchShell({
    onboardingSeen: true,
    videoDir: 'pdf-signature-trust-2',
    openFile: pdfPath,
    userDataDir,
  })
  try {
    const page = await waitForPageWithUrl(second.app, '://pdf/')
    const mark = page.locator('.pdf-sig-mark')
    await expect(mark).toHaveClass(/valid/)

    // take the trust away again
    await page.getByRole('button', { name: 'View signatures' }).click()
    await page.getByRole('button', { name: 'Remove from trusted certificates' }).click()
    await expect(mark).toHaveClass(/untrusted/)
    await expect(page.getByRole('button', { name: 'Add to trusted certificates' })).toBeVisible()
  } finally {
    await closeAndSaveVideo(second, 'pdf-signature-trust-2')
  }
})
