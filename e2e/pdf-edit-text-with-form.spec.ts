import { test, expect } from '@playwright/test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { launchShell, waitForPageWithUrl, closeAndSaveVideo } from './helpers'

test('Edit text opens on text in a PDF that also has a form field', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'genoffice-pdf-edit-form-'))
  const pdfPath = join(dir, 'form-and-text.pdf')
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const page = doc.addPage([400, 300])
  page.drawText("Insured's Name", { x: 40, y: 220, size: 14, font })
  doc
    .getForm()
    .createTextField('far.away')
    .addToPage(page, { x: 40, y: 60, width: 120, height: 20 })
  await writeFile(pdfPath, await doc.save({ useObjectStreams: false }))

  const launched = await launchShell({
    onboardingSeen: true,
    videoDir: 'pdf-edit-text-with-form',
    openFile: pdfPath,
  })
  try {
    const viewer = await waitForPageWithUrl(launched.app, '://pdf/')
    await viewer.locator('.ribbon-tab', { hasText: 'Edit' }).first().click()
    await viewer.getByRole('button', { name: 'Edit text', exact: true }).click()
    const span = viewer.locator('.textLayer span', { hasText: 'Insured' }).first()
    await expect(span).toBeVisible()
    // the form layer spans the page: clicks on the text must go through it
    await span.click()
    await expect(viewer.getByText('Original font')).toBeVisible()
  } finally {
    await closeAndSaveVideo(launched, 'pdf-edit-text-with-form-problems')
  }
})
