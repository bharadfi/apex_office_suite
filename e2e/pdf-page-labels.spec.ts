import { test, expect } from '@playwright/test'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { readPageLabelRanges } from '../apps/pdf/src/main/page-labels-io'
import { labelsFor } from '../apps/pdf/src/shared/page-labels'
import { launchShell, waitForPageWithUrl, closeAndSaveVideo } from './helpers'

test('Page labels can be set, undone, saved into the file and read back on reopening', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'genoffice-pdf-labels-'))
  const pdfPath = join(dir, 'book.pdf')
  const doc = await PDFDocument.create()
  for (let i = 0; i < 4; i++) doc.addPage([400, 300])
  await writeFile(pdfPath, await doc.save({ useObjectStreams: false }))

  const first = await launchShell({
    onboardingSeen: true,
    videoDir: 'pdf-page-labels',
    openFile: pdfPath,
  })
  try {
    const page = await waitForPageWithUrl(first.app, '://pdf/')
    const thumbNumbers = page.locator('.pdf-thumb-no')
    await expect(thumbNumbers).toHaveText(['1', '2', '3', '4'])
    // plain numbering: no separate label beside the page box
    await expect(page.locator('.tb-page-label')).toHaveCount(0)

    await page.locator('.ribbon-tab', { hasText: 'Page' }).first().click()
    await page.getByRole('button', { name: 'Page labels', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Page labels' })

    // pages 1-2 in lower-case roman numerals, from page 3 plain numbers again from 1
    await dialog.getByLabel('Numbering').first().selectOption('lowerRoman')
    await dialog.getByRole('button', { name: 'Add range' }).click()
    await dialog.getByLabel('From page').nth(1).fill('3')
    await expect(dialog).toContainText('i, ii, 1, 2')
    await dialog.getByRole('button', { name: 'Apply' }).click()
    await expect(dialog).toHaveCount(0)

    // the labels are a pending edit: shown at once, not yet in the file
    await expect(thumbNumbers).toHaveText(['i', 'ii', '1', '2'])
    // the page box (on the View tab) names the label of the current page
    await page.locator('.ribbon-tab', { hasText: 'View' }).first().click()
    await expect(page.locator('.tb-page-label')).toHaveText('i')
    await page.locator('.ribbon-tab', { hasText: 'Page' }).first().click()
    await expect(page.locator('.tb-save-pending')).toBeVisible()
    expect(readPageLabelRanges(await PDFDocument.load(await readFile(pdfPath)))).toEqual([])

    // undo and redo
    await page.keyboard.press('ControlOrMeta+z')
    await expect(thumbNumbers).toHaveText(['1', '2', '3', '4'])
    await page.keyboard.press('ControlOrMeta+Shift+z')
    await expect(thumbNumbers).toHaveText(['i', 'ii', '1', '2'])

    // an invalid row says so and cannot be applied
    await page.getByRole('button', { name: 'Page labels', exact: true }).click()
    await dialog.getByLabel('From page').first().fill('9')
    await expect(dialog.getByRole('alert')).toContainText('between 1 and 4')
    await expect(dialog.getByRole('button', { name: 'Apply' })).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(thumbNumbers).toHaveText(['i', 'ii', '1', '2'])

    // saving writes them into the file, and they stay on screen
    await page.keyboard.press('ControlOrMeta+s')
    await expect(page.locator('.tb-save-pending')).toHaveCount(0)
    await expect(thumbNumbers).toHaveText(['i', 'ii', '1', '2'])
    const saved = await PDFDocument.load(await readFile(pdfPath))
    expect(labelsFor(readPageLabelRanges(saved), 4)).toEqual(['i', 'ii', '1', '2'])
  } finally {
    await closeAndSaveVideo(first, 'pdf-page-labels')
  }

  // a fresh run reads the labels back out of the file
  const second = await launchShell({
    onboardingSeen: true,
    videoDir: 'pdf-page-labels-2',
    openFile: pdfPath,
  })
  try {
    const page = await waitForPageWithUrl(second.app, '://pdf/')
    await expect(page.locator('.pdf-thumb-no')).toHaveText(['i', 'ii', '1', '2'])
  } finally {
    await closeAndSaveVideo(second, 'pdf-page-labels-2')
  }
})
