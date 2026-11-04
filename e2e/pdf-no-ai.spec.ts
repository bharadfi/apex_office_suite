import { test, expect } from '@playwright/test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { launchShell, waitForPageWithUrl, closeAndSaveVideo } from './helpers'

test('the PDF app has no AI assistant: no panel, no ribbon buttons, no Ask AI on a selection', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'genoffice-pdf-noai-'))
  const pdfPath = join(dir, 'plain.pdf')
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  doc
    .addPage([400, 300])
    .drawText('Select this sentence of real text', { x: 20, y: 200, size: 14, font })
  await writeFile(pdfPath, await doc.save({ useObjectStreams: false }))

  const launched = await launchShell({
    onboardingSeen: true,
    videoDir: 'pdf-no-ai',
    openFile: pdfPath,
  })
  try {
    const page = await waitForPageWithUrl(launched.app, '://pdf/')
    await expect(page.locator('.pdf-page').first()).toBeVisible()

    // no assistant dock, no rail to open it, nothing named after the assistant
    await expect(page.locator('.ai-dock, .ai-rail, .ai-entry')).toHaveCount(0)
    await expect(page.getByText(/genspark/i)).toHaveCount(0)

    // the ribbon tabs that used to carry AI buttons carry none now
    for (const tab of ['Home', 'Annotate', 'Fill Form']) {
      const tabButton = page.locator('.ribbon-tab', { hasText: tab }).first()
      if ((await tabButton.count()) === 0) continue
      await tabButton.click()
      await expect(page.locator('.ai-entry')).toHaveCount(0)
      await expect(
        page.getByRole('button', { name: /summari[sz]e|key points|AI fill|process notes/i }),
      ).toHaveCount(0)
    }

    // selecting text offers the markup tools only: no "Ask AI"
    await page.locator('.ribbon-tab', { hasText: 'Home' }).first().click()
    // triple-click the line of text: it selects the whole line, as a reader would
    await page.getByText('Select this sentence', { exact: false }).first().click({ clickCount: 3 })
    await expect(page.locator('.pdf-sel-popup')).toBeVisible()
    await expect(page.locator('.pdf-sel-ask')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /ask ai|ask/i })).toHaveCount(0)
  } finally {
    await closeAndSaveVideo(launched, 'pdf-no-ai')
  }
})
