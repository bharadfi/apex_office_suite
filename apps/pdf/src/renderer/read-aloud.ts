import type { PDFDocumentProxy } from 'pdfjs-dist'

/** the part of a pdf.js text item that matters for speaking */
interface SpeechItem {
  str?: string
  hasEOL?: boolean
}

/** A page's text for the voice: the runs in reading order, a line break wherever pdf.js says a line ended. */
export function itemsToSpeechText(items: readonly SpeechItem[]): string {
  let text = ''
  for (const item of items) {
    if (typeof item.str !== 'string') continue
    text += item.str
    if (item.hasEOL) text += '\n'
  }
  return text
}

/**
 * The text to read for `pageIndexes` (original, zero-based page indexes, in the
 * order they should be read). Pages are separated by a blank line so the voice
 * pauses between them. Indexes past the end of the file (inserted blank pages
 * that are not saved yet) have no text and are skipped. `isCancelled` is checked
 * between pages so a long document can be abandoned while its text is gathered.
 */
export async function collectSpeechText(
  doc: Pick<PDFDocumentProxy, 'numPages' | 'getPage'>,
  pageIndexes: readonly number[],
  isCancelled: () => boolean = () => false,
): Promise<string> {
  const parts: string[] = []
  for (const index of pageIndexes) {
    if (isCancelled()) return ''
    if (index < 0 || index >= doc.numPages) continue
    const page = await doc.getPage(index + 1)
    const content = await page.getTextContent()
    const text = itemsToSpeechText(content.items as SpeechItem[]).trim()
    if (text !== '') parts.push(text)
  }
  return parts.join('\n\n')
}
