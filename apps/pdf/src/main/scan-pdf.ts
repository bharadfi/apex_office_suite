import { PDFDocument } from 'pdf-lib'

/** the eight bytes every PNG starts with */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** Used when the picture does not say how sharp it is: a common scan setting */
export const DEFAULT_SCAN_DPI = 150
/** Resolutions outside this are a bad header, not a scanner: they would make a page too big or too small */
const MIN_DPI = 50
const MAX_DPI = 1200

const isPng = (bytes: Uint8Array): boolean =>
  bytes.length > 8 && PNG_SIGNATURE.every((b, i) => bytes[i] === b)

/**
 * The resolution a PNG records in its pHYs chunk (pixels per metre, read as dots per inch), or
 * the default when it records none or something implausible. A page is as large as the picture
 * is at that resolution, so a 300 dpi A4 scan makes an A4 page, not a poster.
 */
export function pngDpi(bytes: Uint8Array): number {
  if (!isPng(bytes)) return DEFAULT_SCAN_DPI
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let at = 8
  while (at + 12 <= bytes.length) {
    const length = view.getUint32(at)
    const type = String.fromCharCode(bytes[at + 4]!, bytes[at + 5]!, bytes[at + 6]!, bytes[at + 7]!)
    if (type === 'pHYs' && length >= 9 && at + 8 + 9 <= bytes.length) {
      const perMetreX = view.getUint32(at + 8)
      const unit = bytes[at + 16]
      if (unit === 1 && perMetreX > 0) {
        const dpi = (perMetreX * 25.4) / 1000
        return dpi >= MIN_DPI && dpi <= MAX_DPI ? dpi : DEFAULT_SCAN_DPI
      }
      return DEFAULT_SCAN_DPI
    }
    if (type === 'IDAT' || type === 'IEND') break
    at += 12 + length
  }
  return DEFAULT_SCAN_DPI
}

/** The most pages one scanned document may hold */
export const MAX_SCAN_PAGES = 500

/**
 * One PDF with a page per scanned picture, in order, each page sized to its picture at the
 * picture's own resolution. Anything that is not a PNG is refused: these come from a scan
 * window that was asked for PNG, so something else is a bug or a hostile caller.
 */
export async function scansToPdf(pictures: readonly Uint8Array[]): Promise<Uint8Array> {
  if (pictures.length === 0) throw new Error('scan: there are no pages')
  if (pictures.length > MAX_SCAN_PAGES) throw new Error('scan: too many pages')
  const doc = await PDFDocument.create()
  for (const picture of pictures) {
    if (!isPng(picture)) throw new Error('scan: a page is not a PNG picture')
    const image = await doc.embedPng(picture)
    const factor = 72 / pngDpi(picture)
    const width = image.width * factor
    const height = image.height * factor
    const page = doc.addPage([width, height])
    page.drawImage(image, { x: 0, y: 0, width, height })
  }
  return doc.save({ useObjectStreams: false })
}
