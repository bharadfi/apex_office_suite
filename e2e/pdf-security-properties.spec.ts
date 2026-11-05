import { test, expect } from '@playwright/test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument, PDFName, PDFString } from 'pdf-lib'
import { launchShell, waitForPageWithUrl, closeAndSaveVideo } from './helpers'

test('Properties shows the security of the file as it states it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'genoffice-pdf-security-'))
  const pdfPath = join(dir, 'plain.pdf')
  const doc = await PDFDocument.create()
  doc.addPage([300, 300])
  doc.catalog.set(
    PDFName.of('OpenAction'),
    doc.context.obj({ S: 'JavaScript', JS: PDFString.of('go()') }),
  )
  await writeFile(pdfPath, await doc.save({ useObjectStreams: false }))

  const launched = await launchShell({
    onboardingSeen: true,
    videoDir: 'pdf-security-properties',
    openFile: pdfPath,
  })
  try {
    const viewer = await waitForPageWithUrl(launched.app, '://pdf/')
    await viewer.getByRole('button', { name: 'Properties', exact: true }).click()
    const security = viewer.getByRole('group', { name: 'Security' })
    await expect(security.locator('.pdf-prop-row', { hasText: 'Encryption' })).toContainText('None')
    await expect(security.locator('.pdf-prop-row', { hasText: 'Signatures' })).toContainText('0')
    // the open action runs a script: the file says so
    await expect(
      security.locator('.pdf-prop-row', { hasText: 'Scripts and actions' }),
    ).toContainText('1')
  } finally {
    await closeAndSaveVideo(launched, 'pdf-security-properties-problems')
  }
})
