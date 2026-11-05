import { PDFDocument } from 'pdf-lib'
import { signatureDisplayCopy } from './signature-display'

/**
 * The 1-based pages to print, as the print dialog gave them: whole numbers inside the document,
 * each once, in page order. Anything outside is dropped. `undefined` or an empty list means
 * every page.
 */
export function pagesToPrint(
  requested: readonly number[] | undefined,
  pageCount: number,
): number[] {
  if (!requested || requested.length === 0) {
    return Array.from({ length: pageCount }, (_, i) => i + 1)
  }
  return [...new Set(requested)]
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= pageCount)
    .sort((a, b) => a - b)
}

/**
 * The PDF to hand to the printer: the file itself, so text stays text and fonts stay fonts, with
 * two changes for the printed copy only. Each signature box shows its own verdict mark, as on the
 * screen (the file on disk is never changed, and a signature covers its own bytes). And only the
 * chosen pages are kept. Pages are removed, not copied, so everything the kept pages use comes
 * through exactly as it is.
 *
 * `pages` are 1-based; none means all of them. Throws when none of the requested pages exist.
 */
export async function buildPrintCopy(
  bytes: Uint8Array,
  pages: readonly number[] | undefined,
  userTrusted: ReadonlySet<string> = new Set(),
): Promise<Uint8Array> {
  const base = (await signatureDisplayCopy(bytes, userTrusted)) ?? bytes
  if (!pages || pages.length === 0) return base
  const doc = await PDFDocument.load(base, { updateMetadata: false, throwOnInvalidObject: false })
  const count = doc.getPageCount()
  const keep = pagesToPrint(pages, count)
  if (keep.length === 0) {
    throw new Error(
      `none of the requested pages (${pages.join(', ')}) exist in this ${count}-page document`,
    )
  }
  if (keep.length === count) return base
  const kept = new Set(keep)
  for (let n = count; n >= 1; n--) {
    if (!kept.has(n)) doc.removePage(n - 1)
  }
  return doc.save({ useObjectStreams: false })
}

/** The first page's size in inches as the page is shown (rotation applied), for a print job that
    must lay its sheets out at the document's own paper size. Null when no page can be read. */
export async function firstPageSizeIn(
  bytes: Uint8Array,
): Promise<{ width: number; height: number } | null> {
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
    const page = doc.getPages()[0]
    if (!page) return null
    const { width, height } = page.getSize()
    const turned = Math.abs(page.getRotation().angle) % 180 === 90
    const w = (turned ? height : width) / 72
    const h = (turned ? width : height) / 72
    return w > 0 && h > 0 ? { width: w, height: h } : null
  } catch {
    return null
  }
}
