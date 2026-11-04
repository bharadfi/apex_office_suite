import { test, expect } from '@playwright/test'
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { PNG } from 'pngjs'
import { launchShell, waitForPageWithUrl, closeAndSaveVideo } from './helpers'

/** a small solid PNG: what the scan window would hand back */
function scannedPicture(width: number, height: number): number[] {
  const image = new PNG({ width, height })
  image.data.fill(200)
  return [...PNG.sync.write(image)]
}

test('Scan to PDF turns scanned pictures into pages of a new PDF', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'genoffice-pdf-scan-'))
  const saveDir = await mkdtemp(join(tmpdir(), 'genoffice-pdf-scan-out-'))
  const pdfPath = join(dir, 'open.pdf')
  const doc = await PDFDocument.create()
  doc.addPage([300, 200])
  await writeFile(pdfPath, await doc.save({ useObjectStreams: false }))

  const launched = await launchShell({
    onboardingSeen: true,
    videoDir: 'pdf-scan-to-pdf',
    openFile: pdfPath,
    settings: { defaultSaveDir: saveDir },
  })
  try {
    const page = await waitForPageWithUrl(launched.app, '://pdf/')

    // No scanner is attached to a test machine: the scan window is stood in for. Everything after
    // it (the dialog, the new PDF, the file written) is the real thing.
    await launched.app.evaluate(
      ({ ipcMain }, pictures) => {
        ipcMain.removeHandler('pdf:scan-page')
        let n = 0
        ipcMain.handle('pdf:scan-page', () => {
          const next = pictures[n++ % pictures.length]!
          return { ok: true, png: new Uint8Array(next) }
        })
      },
      [scannedPicture(120, 80), scannedPicture(60, 90)],
    )

    await page.locator('.ribbon-tab', { hasText: 'Page' }).first().click()
    await page.getByRole('button', { name: 'Scan to PDF', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Scan to PDF' })

    // nothing scanned yet: nothing to create
    await expect(dialog.getByRole('button', { name: 'Create PDF' })).toBeDisabled()
    await dialog.getByRole('button', { name: 'Scan a page' }).click()
    await expect(dialog.locator('.pdf-scan-page')).toHaveCount(1)

    // the button now offers another page; scan two more, then drop the first
    await dialog.getByRole('button', { name: 'Scan another page' }).click()
    await expect(dialog.locator('.pdf-scan-page')).toHaveCount(2)
    await dialog.getByRole('button', { name: 'Scan another page' }).click()
    await expect(dialog.locator('.pdf-scan-page')).toHaveCount(3)
    await dialog.getByRole('button', { name: 'Remove page 1' }).click()
    await expect(dialog.locator('.pdf-scan-page')).toHaveCount(2)

    await dialog.getByRole('button', { name: 'Create PDF' }).click()
    await expect(dialog).toHaveCount(0)

    // a new PDF with the two remaining pages is in the save folder
    await expect
      .poll(async () => (await readdir(saveDir)).filter((f) => /^Scan .*\.pdf$/.test(f)).length)
      .toBe(1)
    const [name] = (await readdir(saveDir)).filter((f) => /^Scan .*\.pdf$/.test(f))
    const created = await PDFDocument.load(await readFile(join(saveDir, name!)))
    expect(created.getPageCount()).toBe(2)
    // sizes follow the pictures at the default 150 dpi: 60x90 px (the second scan) is 28.8 x 43.2 pt
    const [first, second] = created.getPages()
    expect(first!.getWidth()).toBeCloseTo(60 * (72 / 150), 0)
    expect(second!.getWidth()).toBeCloseTo(120 * (72 / 150), 0)
  } finally {
    await closeAndSaveVideo(launched, 'pdf-scan-to-pdf')
  }
})

test('Scan to PDF says so when there is no scanner, and when the window is just closed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'genoffice-pdf-scan-'))
  const pdfPath = join(dir, 'open.pdf')
  const doc = await PDFDocument.create()
  doc.addPage([300, 200])
  await writeFile(pdfPath, await doc.save({ useObjectStreams: false }))

  const launched = await launchShell({
    onboardingSeen: true,
    videoDir: 'pdf-scan-to-pdf-problems',
    openFile: pdfPath,
  })
  try {
    const page = await waitForPageWithUrl(launched.app, '://pdf/')
    await page.locator('.ribbon-tab', { hasText: 'Page' }).first().click()
    await page.getByRole('button', { name: 'Scan to PDF', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Scan to PDF' })

    const answerWith = (result: object) =>
      launched.app.evaluate(({ ipcMain }, answer) => {
        ipcMain.removeHandler('pdf:scan-page')
        ipcMain.handle('pdf:scan-page', () => answer)
      }, result)

    await answerWith({ ok: false, reason: 'no-scanner' })
    await dialog.getByRole('button', { name: 'Scan a page' }).click()
    await expect(dialog.getByRole('alert')).toContainText('No scanner was found')
    await expect(dialog.locator('.pdf-scan-page')).toHaveCount(0)

    // closing the scan window without scanning is not an error
    await answerWith({ ok: false, reason: 'cancelled' })
    await dialog.getByRole('button', { name: 'Scan a page' }).click()
    await expect(dialog.getByRole('alert')).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Scan a page' })).toBeEnabled()
  } finally {
    await closeAndSaveVideo(launched, 'pdf-scan-to-pdf-problems')
  }
})
