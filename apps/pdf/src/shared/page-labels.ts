/**
 * Page labels (PDF 32000-1 §12.4.2): the names a viewer shows for pages, such as
 * "i, ii, iii" for a preface and "1, 2, 3" for the body. They are defined by ranges
 * of consecutive pages, counted by POSITION in the document (not tied to a page
 * object), so they follow the pages as they are reordered or deleted.
 */

export type PageLabelStyle =
  | 'decimal'
  | 'upperRoman'
  | 'lowerRoman'
  | 'upperAlpha'
  | 'lowerAlpha'
  /** no number at all: the label is just the prefix */
  | 'none'

export const PAGE_LABEL_STYLES: readonly PageLabelStyle[] = [
  'decimal',
  'lowerRoman',
  'upperRoman',
  'lowerAlpha',
  'upperAlpha',
  'none',
]

/** One run of pages that share a numbering */
export interface PageLabelRange {
  /** Zero-based position of the first page of the run; the run lasts until the next range starts */
  start: number
  style: PageLabelStyle
  /** Text put in front of the number ("A-" gives A-1, A-2…); may be empty */
  prefix: string
  /** The number of the first page of the run, 1 or more */
  firstNumber: number
}

const ROMAN: ReadonlyArray<[number, string]> = [
  [1000, 'M'],
  [900, 'CM'],
  [500, 'D'],
  [400, 'CD'],
  [100, 'C'],
  [90, 'XC'],
  [50, 'L'],
  [40, 'XL'],
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
]

/**
 * `n` (1 or more) written in `style`. Letters repeat rather than carry, as the PDF
 * specification says: 1-26 are A-Z, 27-52 are AA-ZZ, 53-78 are AAA-ZZZ. Roman numerals
 * are the usual subtractive ones; the PDF has no numeral for 4000 or more, so those
 * fall back to digits instead of a string of M's.
 */
export function formatPageNumber(n: number, style: PageLabelStyle): string {
  const value = Math.max(1, Math.floor(n))
  switch (style) {
    case 'decimal':
      return String(value)
    case 'upperRoman':
    case 'lowerRoman': {
      if (value >= 4000) return String(value)
      let rest = value
      let out = ''
      for (const [size, glyph] of ROMAN) {
        while (rest >= size) {
          out += glyph
          rest -= size
        }
      }
      return style === 'lowerRoman' ? out.toLowerCase() : out
    }
    case 'upperAlpha':
    case 'lowerAlpha': {
      const letter = String.fromCharCode(65 + ((value - 1) % 26))
      const out = letter.repeat(Math.floor((value - 1) / 26) + 1)
      return style === 'lowerAlpha' ? out.toLowerCase() : out
    }
    case 'none':
      return ''
  }
}

/**
 * Ranges in order, one per start, each start a whole non-negative number: what the writer and
 * the lookup below rely on. A document with labels must have a range at page 0 (the
 * specification requires it), so one is added, numbered plainly, when the first starts later.
 * No ranges stay none: that means "no labels", which viewers show as 1, 2, 3.
 */
export function normalizeRanges(ranges: readonly PageLabelRange[]): PageLabelRange[] {
  const byStart = new Map<number, PageLabelRange>()
  for (const range of ranges) {
    if (!Number.isInteger(range.start) || range.start < 0) continue
    byStart.set(range.start, {
      start: range.start,
      style: PAGE_LABEL_STYLES.includes(range.style) ? range.style : 'decimal',
      prefix: range.prefix,
      firstNumber:
        Number.isInteger(range.firstNumber) && range.firstNumber >= 1 ? range.firstNumber : 1,
    })
  }
  const sorted = [...byStart.values()].sort((a, b) => a.start - b.start)
  if (sorted.length > 0 && sorted[0]!.start !== 0) {
    sorted.unshift({ start: 0, style: 'decimal', prefix: '', firstNumber: 1 })
  }
  return sorted
}

/** The label of the page at zero-based `index`; plain 1, 2, 3… when there are no ranges */
export function labelOf(ranges: readonly PageLabelRange[], index: number): string {
  let owner: PageLabelRange | undefined
  for (const range of ranges) {
    if (range.start <= index) owner = range
    else break
  }
  if (!owner) return String(index + 1)
  return owner.prefix + formatPageNumber(owner.firstNumber + (index - owner.start), owner.style)
}

/** Every page's label, for `count` pages */
export function labelsFor(ranges: readonly PageLabelRange[], count: number): string[] {
  return Array.from({ length: count }, (_, i) => labelOf(ranges, i))
}

/** Whether the pages are labelled any other way than plain 1, 2, 3 */
export function hasCustomLabels(ranges: readonly PageLabelRange[], count: number): boolean {
  return labelsFor(ranges, count).some((label, i) => label !== String(i + 1))
}
