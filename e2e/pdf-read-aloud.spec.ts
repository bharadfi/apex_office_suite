import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { launchShell, waitForPageWithUrl, closeAndSaveVideo } from './helpers'

/**
 * How many hidden PowerShell speakers are running: their command line carries the
 * speaking script. The query goes in as an encoded command, so its own command
 * line does not contain the marker it looks for and can never count itself.
 */
function speakerProcesses(): number {
  const query =
    "@(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('Register-ObjectEvent') }).Count"
  const out = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-EncodedCommand', Buffer.from(query, 'utf16le').toString('base64')],
    // stderr carries only PowerShell's progress text
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  )
  return Number.parseInt(out.trim() || '0', 10)
}

test.skip(process.platform !== 'win32', 'Read Out Loud drives the Windows voice')

test('Read Out Loud reads a page, pauses, resumes and stops, and says so when a page has no text', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'genoffice-pdf-read-'))
  const pdfPath = join(dir, 'read.pdf')
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const sentence = 'The quick brown fox jumps over the lazy dog. '
  doc
    .addPage([400, 300])
    .drawText(sentence.repeat(3), { x: 20, y: 200, size: 10, font, maxWidth: 360, lineHeight: 12 })
  doc.addPage([400, 300]) // a page with no text layer
  await writeFile(pdfPath, await doc.save({ useObjectStreams: false }))

  const launched = await launchShell({
    onboardingSeen: true,
    videoDir: 'pdf-read-aloud',
    openFile: pdfPath,
    // volume 0: the real Windows voice runs, but makes no sound
    env: { GENOFFICE_SPEECH_VOLUME: '0' },
  })
  try {
    const page = await waitForPageWithUrl(launched.app, '://pdf/')
    await page.locator('.ribbon-tab', { hasText: 'View' }).first().click()
    const read = page.getByRole('button', { name: 'Read page', exact: true })
    const pause = page.getByRole('button', { name: 'Pause', exact: true })
    const stop = page.getByRole('button', { name: 'Stop', exact: true })

    // nothing is being read yet: Pause and Stop are not available
    await expect(pause).toBeDisabled()
    await expect(stop).toBeDisabled()

    await read.click()
    await expect(stop).toBeEnabled()
    await expect(pause).toBeEnabled()
    expect(await page.evaluate(() => window.pdfApi.speechState())).toBe('reading')
    await expect.poll(() => speakerProcesses()).toBe(1)

    await pause.click()
    await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible()
    expect(await page.evaluate(() => window.pdfApi.speechState())).toBe('paused')

    await page.getByRole('button', { name: 'Resume', exact: true }).click()
    await expect(pause).toBeVisible()
    expect(await page.evaluate(() => window.pdfApi.speechState())).toBe('reading')

    await stop.click()
    await expect(stop).toBeDisabled()
    expect(await page.evaluate(() => window.pdfApi.speechState())).toBe('idle')
    await expect.poll(() => speakerProcesses()).toBe(0)

    // page 2 has no text layer: a notice that points at OCR, and no speaker is started
    await page.evaluate(() => {
      document.querySelectorAll('.pdf-page')[1]?.scrollIntoView()
    })
    await page.locator('.tb-page-input').fill('2')
    await page.locator('.tb-page-input').press('Enter')
    await read.click()
    await expect(page.locator('.pdf-toast-notice')).toContainText('no text to read')
    expect(await page.evaluate(() => window.pdfApi.speechState())).toBe('idle')
    expect(speakerProcesses()).toBe(0)
  } finally {
    await closeAndSaveVideo(launched, 'pdf-read-aloud')
  }
})
