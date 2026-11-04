import {
  PDFArray,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFString,
  type PDFDocument,
  type PDFObject,
} from 'pdf-lib'
import { normalizeRanges, type PageLabelRange, type PageLabelStyle } from '../shared/page-labels'

const PAGE_LABELS = PDFName.of('PageLabels')

/** the /S names of the PDF specification, and ours */
const STYLE_OF_NAME: Record<string, PageLabelStyle> = {
  D: 'decimal',
  R: 'upperRoman',
  r: 'lowerRoman',
  A: 'upperAlpha',
  a: 'lowerAlpha',
}
const NAME_OF_STYLE: Partial<Record<PageLabelStyle, string>> = {
  decimal: 'D',
  upperRoman: 'R',
  lowerRoman: 'r',
  upperAlpha: 'A',
  lowerAlpha: 'a',
}

/** A number tree can nest; a hostile file can nest it without end, or loop it back on itself */
const MAX_DEPTH = 16
const MAX_RANGES = 10_000

/**
 * The document's page-label ranges, read from the /PageLabels number tree (both the flat
 * /Nums form and /Kids nesting). Entries that do not make sense are skipped rather than
 * failing the read; a document without labels gives no ranges.
 */
export function readPageLabelRanges(pdf: PDFDocument): PageLabelRange[] {
  const root = pdf.catalog.lookupMaybe(PAGE_LABELS, PDFDict)
  if (!root) return []
  const found: PageLabelRange[] = []
  const seen = new Set<PDFDict>()

  const visit = (node: PDFDict, depth: number): void => {
    if (depth > MAX_DEPTH || seen.has(node) || found.length >= MAX_RANGES) return
    seen.add(node)
    const nums = node.lookupMaybe(PDFName.of('Nums'), PDFArray)
    if (nums) {
      for (let i = 0; i + 1 < nums.size() && found.length < MAX_RANGES; i += 2) {
        const key = nums.lookup(i)
        const value = nums.lookup(i + 1)
        if (!(key instanceof PDFNumber) || !(value instanceof PDFDict)) continue
        const range = rangeOf(key.asNumber(), value)
        if (range) found.push(range)
      }
    }
    const kids = node.lookupMaybe(PDFName.of('Kids'), PDFArray)
    if (kids) {
      for (let i = 0; i < kids.size(); i++) {
        const kid = kids.lookup(i)
        if (kid instanceof PDFDict) visit(kid, depth + 1)
      }
    }
  }
  visit(root, 0)
  return normalizeRanges(found)
}

function rangeOf(start: number, dict: PDFDict): PageLabelRange | null {
  if (!Number.isInteger(start) || start < 0) return null
  const s = dict.lookup(PDFName.of('S'))
  const style: PageLabelStyle =
    s instanceof PDFName ? (STYLE_OF_NAME[s.decodeText()] ?? 'none') : 'none'
  const p = dict.lookup(PDFName.of('P'))
  const prefix = p instanceof PDFString || p instanceof PDFHexString ? p.decodeText() : ''
  const st = dict.lookup(PDFName.of('St'))
  const firstNumber = st instanceof PDFNumber ? Math.floor(st.asNumber()) : 1
  return { start, style, prefix, firstNumber: firstNumber >= 1 ? firstNumber : 1 }
}

/**
 * Write `ranges` as the document's page labels, replacing any that were there. Ranges that start
 * past the last page are dropped (they label nothing); no ranges removes the labels altogether.
 * The tree is written flat, in the order the specification requires, starting at page 0.
 */
export function applyPageLabels(pdf: PDFDocument, ranges: readonly PageLabelRange[]): void {
  const pageCount = pdf.getPageCount()
  const usable = normalizeRanges(ranges.filter((range) => range.start < pageCount))
  if (usable.length === 0) {
    pdf.catalog.delete(PAGE_LABELS)
    return
  }
  const { context } = pdf
  const nums: PDFObject[] = []
  for (const range of usable) {
    const entry = context.obj({}) as PDFDict
    const name = NAME_OF_STYLE[range.style]
    if (name) entry.set(PDFName.of('S'), PDFName.of(name))
    if (range.prefix !== '') entry.set(PDFName.of('P'), PDFHexString.fromText(range.prefix))
    if (range.firstNumber !== 1) entry.set(PDFName.of('St'), PDFNumber.of(range.firstNumber))
    nums.push(PDFNumber.of(range.start), entry)
  }
  pdf.catalog.set(PAGE_LABELS, context.obj({ Nums: nums }))
}
