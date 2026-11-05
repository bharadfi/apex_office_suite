import { test, expect } from '@playwright/test'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString } from 'pdf-lib'
import { launchShell, waitForPageWithUrl, closeAndSaveVideo } from './helpers'

test('Remove hidden information writes a copy without the ticked kinds', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'genoffice-pdf-hidden-'))
  const pdfPath = join(dir, 'source.pdf')
  const outPath = join(dir, 'clean.pdf')
  const doc = await PDFDocument.create()
  doc.setTitle('Board minutes')
  doc.setAuthor('Finance team')
  const page = doc.addPage([300, 300])
  const note = doc.context.obj({
    Type: 'Annot',
    Subtype: 'Text',
    Rect: [10, 10, 30, 30],
    Contents: PDFString.of('private note'),
  })
  const link = doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [40, 10, 90, 30] })
  page.node.set(
    PDFName.of('Annots'),
    doc.context.obj([doc.context.register(note), doc.context.register(link)]),
  )
  await writeFile(pdfPath, await doc.save({ useObjectStreams: false }))

  const launched = await launchShell({
    onboardingSeen: true,
    videoDir: 'pdf-remove-hidden-info',
    openFile: pdfPath,
  })
  try {
    const viewer = await waitForPageWithUrl(launched.app, '://pdf/')
    // the save box is the only part of the system the test stands in for
    await launched.app.evaluate(({ dialog }, target) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: target })) as never
    }, outPath)
    await viewer.locator('.ribbon-tab', { hasText: 'Pages' }).first().click()
    await viewer.getByRole('button', { name: 'Remove hidden information' }).click()

    const dialog = viewer.getByRole('dialog', { name: 'Remove hidden information' })
    const comments = dialog.locator('.pdf-hidden-row', { hasText: 'Comments and markups' })
    await expect(comments.locator('.pdf-hidden-count')).toHaveText('1')
    // links are listed but off until ticked; kinds the file does not hold cannot be ticked
    await expect(
      dialog.locator('.pdf-hidden-row', { hasText: 'Links' }).locator('input'),
    ).not.toBeChecked()
    await expect(
      dialog.locator('.pdf-hidden-row', { hasText: 'Attached files' }).locator('input'),
    ).toBeDisabled()
    await dialog.getByRole('button', { name: 'Remove and save a copy' }).click()
    await expect(viewer.getByText(/Saved clean\.pdf without \d+ hidden items\./)).toBeVisible({
      timeout: 30_000,
    })

    const clean = await PDFDocument.load(await readFile(outPath), { updateMetadata: false })
    expect(clean.getTitle()).toBeUndefined()
    expect(clean.getAuthor()).toBeUndefined()
    const annots = clean.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray)
    const kinds = annots
      .asArray()
      .map((a) =>
        (clean.context.lookup(a, PDFDict).get(PDFName.of('Subtype')) as PDFName).decodeText(),
      )
    expect(kinds).toEqual(['Link']) // the comment went; the link stayed because it was not ticked
    // the open file is untouched
    const original = await PDFDocument.load(await readFile(pdfPath), { updateMetadata: false })
    expect(original.getTitle()).toBe('Board minutes')
  } finally {
    await closeAndSaveVideo(launched, 'pdf-remove-hidden-info-problems')
  }
})
