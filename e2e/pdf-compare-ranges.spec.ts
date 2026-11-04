import { test, expect } from '@playwright/test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { launchShell, waitForPageWithUrl, closeAndSaveVideo } from './helpers'

async function textPdf(path: string, pages: string[]): Promise<void> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (const text of pages) {
    doc.addPage([400, 300]).drawText(text, { x: 40, y: 200, size: 18, font })
  }
  await writeFile(path, await doc.save({ useObjectStreams: false }))
}

test('Compare can look at chosen pages of each file and pairs them by position', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'genoffice-pdf-compare-'))
  const mine = join(dir, 'mine.pdf')
  const other = join(dir, 'other.pdf')
  await textPdf(mine, ['alpha page', 'beta page', 'gamma page', 'delta page'])
  await textPdf(other, ['intro page', 'beta page', 'gamma CHANGED', 'delta other'])

  const launched = await launchShell({
    onboardingSeen: true,
    videoDir: 'pdf-compare-ranges',
    openFile: mine,
  })
  try {
    const page = await waitForPageWithUrl(launched.app, '://pdf/')
    // the picker is a native dialog: answer it with the second file
    await launched.app.evaluate(({ dialog }, otherPath) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [otherPath],
      })) as unknown as typeof dialog.showOpenDialog
    }, other)

    await page.locator('.ribbon-tab', { hasText: 'View' }).first().click()
    await page.locator('.rb-big', { hasText: 'Compare' }).first().click()
    await page.locator('.pdf-compare-pick').click()

    const rows = page.locator('.pdf-compare-row')
    // every page: 1, 3 and 4 differ, page 2 is the same
    await expect(rows).toHaveCount(3)
    await expect(page.locator('.pdf-compare-range')).toHaveCount(2)

    const [thisFile, otherFile] = await page.locator('.pdf-compare-range input').all()

    // pages 2-3 against pages 2-3: only page 3 differs
    await thisFile!.fill('2-3')
    await otherFile!.fill('2-3')
    await expect(rows).toHaveCount(1)
    await expect(rows.first().locator('.pdf-compare-page')).toHaveText('Page 3')

    // page 2 of this file against page 3 of the other: they pair, and the row says so
    await thisFile!.fill('2')
    await otherFile!.fill('3')
    await expect(rows).toHaveCount(1)
    await expect(rows.first().locator('.pdf-compare-page')).toContainText('Page 2')
    await expect(rows.first().locator('.pdf-compare-page')).toContainText('↔ 3')

    // a page that does not exist: a message, and the last result stays on screen
    await thisFile!.fill('9')
    await expect(page.locator('.pdf-compare-range-error')).toContainText('4 pages')
    await expect(rows).toHaveCount(1)

    // blank again: back to every page
    await thisFile!.fill('')
    await otherFile!.fill('')
    await expect(page.locator('.pdf-compare-range-error')).toHaveCount(0)
    await expect(rows).toHaveCount(3)
  } finally {
    await closeAndSaveVideo(launched, 'pdf-compare-ranges')
  }
})
