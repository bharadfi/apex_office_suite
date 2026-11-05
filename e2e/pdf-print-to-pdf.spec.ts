import { test, expect } from '@playwright/test'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { launchShell, waitForPageWithUrl, closeAndSaveVideo } from './helpers'

test('Print > Save as PDF writes the pages with their text kept as whole runs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'genoffice-pdf-print-'))
  const pdfPath = join(dir, 'source.pdf')
  const outPath = join(dir, 'printed.pdf')
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (const n of [1, 2]) {
    const page = doc.addPage([595.28, 841.89])
    page.drawText(`The Oriental Insurance Company Limited page ${n}`, {
      x: 60,
      y: 760,
      size: 14,
      font,
    })
  }
  await writeFile(pdfPath, await doc.save({ useObjectStreams: false }))

  const launched = await launchShell({
    onboardingSeen: true,
    videoDir: 'pdf-print-to-pdf',
    openFile: pdfPath,
  })
  try {
    const viewer = await waitForPageWithUrl(launched.app, '://pdf/')
    // the save box is the only part of the system the test stands in for
    await launched.app.evaluate(({ dialog }, target) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: target })) as never
    }, outPath)
    await viewer.getByRole('button', { name: 'Print', exact: true }).first().click()
    await viewer
      .locator('.pdf-modal select.pdf-modal-input')
      .first()
      .selectOption({ label: 'Save as PDF (built in)' })
    await expect(viewer.locator('.pdf-print-hint')).toBeVisible()
    await viewer.locator('.pdf-modal-btn.primary').click()
    await expect(viewer.getByText('Saved printed.pdf.')).toBeVisible({ timeout: 60_000 })

    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const printed = await pdfjs.getDocument({ data: new Uint8Array(await readFile(outPath)) })
      .promise
    expect(printed.numPages).toBe(2)
    const items = (await (await printed.getPage(2)).getTextContent()).items.map((i) =>
      'str' in i ? i.str : '',
    )
    // a driver would give 'The Orie nta l ...'; the built-in writer keeps the line in one piece
    expect(items.join('')).toContain('The Oriental Insurance Company Limited page 2')
    expect(items.filter((s) => s.trim() !== '').length).toBeLessThanOrEqual(2)
  } finally {
    await closeAndSaveVideo(launched, 'pdf-print-to-pdf-problems')
  }
})
