import { test, expect } from '@playwright/test'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { launchShell, waitForPageWithUrl, closeAndSaveVideo } from './helpers'

test('a PDF that is only a picture of text gets a text layer from the built-in OCR', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'genoffice-pdf-ocr-'))
  const pdfPath = join(dir, 'picture-only.pdf')
  const picture = await readFile(
    join(__dirname, '../packages/pdf2docx/ocr-helper/fixtures/smoke-en.png'),
  )
  const doc = await PDFDocument.create()
  const image = await doc.embedPng(picture)
  const page = doc.addPage([image.width, image.height])
  page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height })
  await writeFile(pdfPath, await doc.save({ useObjectStreams: false }))

  const launched = await launchShell({
    onboardingSeen: true,
    videoDir: 'pdf-ocr-tesseract',
    openFile: pdfPath,
  })
  try {
    const viewer = await waitForPageWithUrl(launched.app, '://pdf/')
    // the page has no text of its own, so the OCR pass runs on its own and lays words over it
    const layer = viewer.locator('.pdf-ocr-layer')
    await expect(layer).toContainText('quick', { timeout: 90_000 })
    await expect(layer).toContainText('12345')
    // no "no engine" notice: the engine ships with the app on every platform
    await expect(viewer.getByText('Text recognition is not available')).toHaveCount(0)
  } finally {
    await closeAndSaveVideo(launched, 'pdf-ocr-tesseract-problems')
  }
})
