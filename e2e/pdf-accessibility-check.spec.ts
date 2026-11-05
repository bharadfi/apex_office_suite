import { test, expect } from '@playwright/test'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument, PDFName, PDFString } from 'pdf-lib'
import { launchShell, waitForPageWithUrl, closeAndSaveVideo } from './helpers'

test('Accessibility check lists what a screen reader would miss', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'genoffice-pdf-a11y-'))
  const pdfPath = join(dir, 'plain.pdf')
  const doc = await PDFDocument.create()
  doc.addPage([300, 300])
  doc.catalog.set(PDFName.of('Lang'), PDFString.of('en-US'))
  await writeFile(pdfPath, await doc.save({ useObjectStreams: false }))

  const launched = await launchShell({
    onboardingSeen: true,
    videoDir: 'pdf-accessibility-check',
    openFile: pdfPath,
  })
  try {
    const viewer = await waitForPageWithUrl(launched.app, '://pdf/')
    await viewer.locator('.ribbon-tab', { hasText: 'Pages' }).first().click()
    await viewer.getByRole('button', { name: 'Accessibility check' }).click()
    const dialog = viewer.getByRole('dialog', { name: 'Accessibility check' })
    await expect(dialog.getByRole('status')).toContainText('checks failed')
    // the language was set, so it passes; the file is untagged, so that fails and says why
    await expect(
      dialog.locator('.pdf-a11y-row.is-pass', { hasText: 'Document language' }),
    ).toBeVisible()
    const tagged = dialog.locator('.pdf-a11y-row.is-fail', { hasText: 'Tagged PDF' })
    await expect(tagged).toContainText('no structure tree')
    await expect(dialog).toContainText('Not tested here')

    // fix what can be fixed: the copy gets a title, and the check passes it
    const outPath = join(dir, 'accessible.pdf')
    await launched.app.evaluate(({ dialog: box }, target) => {
      box.showSaveDialog = (async () => ({ canceled: false, filePath: target })) as never
    }, outPath)
    await dialog.getByRole('button', { name: 'Fix and save a copy' }).click()
    await expect(
      viewer.getByText('Saved accessible.pdf with the accessibility fixes.'),
    ).toBeVisible()
    const fixed = await PDFDocument.load(await readFile(outPath), { updateMetadata: false })
    expect(fixed.getTitle()).toBe('plain')
  } finally {
    await closeAndSaveVideo(launched, 'pdf-accessibility-check-problems')
  }
})
