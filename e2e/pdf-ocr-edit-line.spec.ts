import { test, expect } from '@playwright/test'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { launchShell, waitForPageWithUrl, closeAndSaveVideo } from './helpers'

const SHOTS = process.env.OCR_EDIT_SHOTS

test('a recognised line of a picture-only page can be edited in place', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'genoffice-pdf-ocr-edit-'))
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
    videoDir: 'pdf-ocr-edit-line',
    openFile: pdfPath,
  })
  try {
    const viewer = await waitForPageWithUrl(launched.app, '://pdf/')
    await expect(viewer.locator('.pdf-ocr-layer')).toContainText('quick', { timeout: 90_000 })
    await viewer.locator('.ribbon-tab', { hasText: 'Edit' }).first().click()
    await viewer.getByRole('button', { name: 'Edit text', exact: true }).click()
    await viewer.locator('.pdf-ocr-layer span', { hasText: 'quick' }).first().click()
    if (SHOTS) await viewer.screenshot({ path: join(SHOTS, 'ocr-edit-1.png') })
    // the line is a serif face: the editor opens on Times New Roman, not a default sans
    await expect(viewer.locator('.pdf-textedit-bar')).toContainText('Times New Roman')
    await viewer.keyboard.press('End')
    await viewer.keyboard.type(' ZEBRA')
    // leaving the editor commits it
    await viewer.locator('.ribbon-tab', { hasText: 'Home' }).first().click()
    if (SHOTS) await viewer.screenshot({ path: join(SHOTS, 'ocr-edit-2.png') })
    await expect(
      viewer.locator('.pdf-page .pdf-textinsert-preview', { hasText: 'ZEBRA' }),
    ).toBeVisible()
    await expect(viewer.locator('.pdf-textinsert-cover')).toHaveCount(1)

    // saved, the new words are real text in the file and the old picture words are hidden under a box
    await viewer.keyboard.press('Control+s')
    await expect(viewer.getByText('Unsaved')).toHaveCount(0, { timeout: 30_000 })
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const saved = await pdfjs.getDocument({ data: new Uint8Array(await readFile(pdfPath)) }).promise
    const text = (await (await saved.getPage(1)).getTextContent()).items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
    expect(text).toContain('ZEBRA')
    expect(text).toContain('Reference number')
  } finally {
    await closeAndSaveVideo(launched, 'pdf-ocr-edit-line-problems')
  }
})
