import { describe, expect, it } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { readPdfText } from '../src/main/read-text'
import type { PdfTextDoc } from '../src/main/read-text'
import {
  compareDocuments,
  compareSelected,
  diffLines,
  normalizePageText,
  parsePageSelection,
  type PageText,
} from '../src/renderer/compare-text'

describe('normalizePageText', () => {
  it('collapses whitespace, trims and drops blank lines', () => {
    expect(normalizePageText('  a   b  \n\n\tc\td\n   \n')).toEqual(['a b', 'c d'])
  })
})

describe('diffLines', () => {
  it('reports an insertion with its index in the new page', () => {
    const { added, removed } = diffLines(['a', 'c'], ['a', 'b', 'c'])
    expect(removed).toEqual([])
    expect(added).toEqual([{ line: 'b', index: 1 }])
  })

  it('reports a deletion with its index in the old page', () => {
    const { added, removed } = diffLines(['a', 'b', 'c'], ['a', 'c'])
    expect(added).toEqual([])
    expect(removed).toEqual([{ line: 'b', index: 1 }])
  })

  it('reads a swapped line as one removal plus one addition', () => {
    const { added, removed } = diffLines(['old'], ['new'])
    expect(removed).toEqual([{ line: 'old', index: 0 }])
    expect(added).toEqual([{ line: 'new', index: 0 }])
  })

  it('returns nothing for identical pages', () => {
    const { added, removed } = diffLines(['a', 'b'], ['a', 'b'])
    expect(added).toEqual([])
    expect(removed).toEqual([])
  })
})

describe('compareDocuments', () => {
  const page = (text: string): PageText => ({ pageIndex: 0, text })

  it('calls identical documents equal', () => {
    const result = compareDocuments([page('a\nb')], [page('a\nb')])
    expect(result.equal).toBe(true)
    expect(result.pages).toHaveLength(1)
  })

  it('adds the extra pages of the longer document as wholes', () => {
    const result = compareDocuments([page('a')], [page('a'), page('extra\nlines')])
    expect(result.equal).toBe(false)
    expect(result.pages[1]!.addedCount).toBe(2)
    expect(result.pages[1]!.removedCount).toBe(0)
    expect(result.pages[1]!.added.map((l) => l.line)).toEqual(['extra', 'lines'])
  })

  it('counts per-page changes independently', () => {
    const result = compareDocuments(
      [page('same\nold'), page('untouched')],
      [page('same\nnew'), page('untouched')],
    )
    expect(result.pages[0]!.removedCount).toBe(1)
    expect(result.pages[0]!.addedCount).toBe(1)
    expect(result.pages[1]!.addedCount).toBe(0)
  })

  it('flags past-cap pages as truncated instead of diffing', () => {
    const big = Array.from({ length: 4001 }, (_, i) => `line${i}`).join('\n')
    const small = 'one line'
    const result = compareDocuments([page(big)], [page(small)])
    expect(result.pages[0]!.truncated).toBe(true)
    expect(result.pages[0]!.removedCount).toBe(4001)
    expect(result.pages[0]!.addedCount).toBe(1)
    expect(result.pages[0]!.removed).toEqual([])
  })

  it('calls identical past-cap pages equal instead of truncating them', () => {
    const big = Array.from({ length: 4001 }, (_, i) => `line${i}`).join('\n')
    const result = compareDocuments([page(big)], [page(big)])
    expect(result.pages[0]!.truncated).toBeUndefined()
    expect(result.pages[0]!.addedCount).toBe(0)
    expect(result.pages[0]!.removedCount).toBe(0)
    expect(result.equal).toBe(true)
  })

  it('still truncates a past-cap page that differs only past the cap window', () => {
    const left = Array.from({ length: 4001 }, (_, i) => `line${i}`).join('\n')
    const right = Array.from({ length: 4001 }, (_, i) => `line${i === 3000 ? 'changed' : i}`).join(
      '\n',
    )
    const result = compareDocuments([page(left)], [page(right)])
    expect(result.pages[0]!.truncated).toBe(true)
    expect(result.pages[0]!.addedCount).toBe(4001)
    expect(result.pages[0]!.removedCount).toBe(4001)
    expect(result.equal).toBe(false)
  })
})

describe('one engine on both sides', () => {
  it('a document compared against itself through readPdfText reports equal', async () => {
    // The two sides of a compare are extracted by two independent readPdfText
    // calls now (the open document via the renderer asking main for its own
    // path). Two engines split lines differently and normalizePageText cannot
    // repair a different split — this is the regression the split protected.
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    for (const [index, heading] of ['Quarterly summary', 'Appendix'].entries()) {
      const page = doc.addPage([300, 300])
      page.drawText(heading, { x: 24, y: 260, size: 14, font })
      page.drawText(`Body line one of page ${index + 1}.`, { x: 24, y: 240, size: 10, font })
      page.drawText(`Body line two of page ${index + 1}.`, { x: 24, y: 226, size: 10, font })
    }
    const bytes = await doc.save()

    const mine = await readPdfText(new Uint8Array(bytes))
    const theirs = await readPdfText(new Uint8Array(bytes))
    expect(mine.pages.every((p) => p.hasTextLayer)).toBe(true)
    expect(theirs.pages).toHaveLength(mine.pages.length)

    const toSide = (doc0: PdfTextDoc): PageText[] =>
      doc0.pages.map((p) => ({ pageIndex: p.page - 1, text: p.text }))
    const result = compareDocuments(toSide(mine), toSide(theirs))
    expect(result.equal).toBe(true)
    expect(result.pages.every((p) => p.addedCount === 0 && p.removedCount === 0)).toBe(true)
  })
})

describe('parsePageSelection', () => {
  it('reads a blank selection as every page', () => {
    expect(parsePageSelection('', 4)).toEqual([0, 1, 2, 3])
    expect(parsePageSelection('   ', 2)).toEqual([0, 1])
  })

  it('reads single pages, ranges and lists as zero-based indexes', () => {
    expect(parsePageSelection('3', 10)).toEqual([2])
    expect(parsePageSelection('3-5', 10)).toEqual([2, 3, 4])
    expect(parsePageSelection('2, 4-6', 10)).toEqual([1, 3, 4, 5])
    expect(parsePageSelection('3–5', 10)).toEqual([2, 3, 4])
  })

  it('keeps the order written, including a backwards range', () => {
    expect(parsePageSelection('6-4', 10)).toEqual([5, 4, 3])
    expect(parsePageSelection('5,1', 10)).toEqual([4, 0])
  })

  it('rejects text that is not a selection or names a missing page', () => {
    for (const bad of ['abc', '0', '1-0', '3-', '-3', '1,,2', '11', '2-11', '1;2']) {
      expect(parsePageSelection(bad, 10)).toBeNull()
    }
  })
})

describe('compareSelected', () => {
  const doc = (...texts: string[]): PageText[] =>
    texts.map((text, pageIndex) => ({ pageIndex, text }))

  it('pairs the chosen pages of each side and reports the page numbers of the open document', () => {
    const mine = doc('a', 'b', 'c', 'd', 'e')
    const theirs = doc('x', 'y', 'c', 'D')
    // pages 3-4 of mine against pages 3-4 of theirs: c = c, d != D
    const result = compareSelected(mine, [2, 3], theirs, [2, 3], false)
    expect(result.equal).toBe(false)
    const changed = result.pages.filter((p) => p.addedCount > 0 || p.removedCount > 0)
    expect(changed.map((p) => [p.pageIndex, p.otherPageIndex])).toEqual([[3, 3]])
  })

  it('compares pages that sit at different positions in the two files', () => {
    const mine = doc('intro', 'same text', 'tail')
    const theirs = doc('cover', 'cover 2', 'same text')
    const result = compareSelected(mine, [1], theirs, [2], false)
    expect(result.equal).toBe(true)
    expect(result.pages[0]).toMatchObject({ pageIndex: 1, otherPageIndex: 2 })
  })

  it('does not look at pages outside the selection', () => {
    const mine = doc('same', 'ONLY IN MINE')
    const theirs = doc('same', 'different')
    expect(compareSelected(mine, [0], theirs, [0], false).equal).toBe(true)
  })

  it('treats extra chosen pages on one side as wholly added or removed', () => {
    const result = compareSelected(doc('a', 'b'), [0], doc('a', 'b'), [0, 1], false)
    expect(result.equal).toBe(false)
    expect(result.pages[1]).toMatchObject({ addedCount: 1, removedCount: 0 })
    // the extra row points at the last chosen page of the open document
    expect(result.pages[1]!.pageIndex).toBe(0)
  })

  it('keeps old and new the right way round when swapped', () => {
    const mine = doc('new line')
    const theirs = doc('old line')
    const normal = compareSelected(mine, [0], theirs, [0], false).pages[0]!
    const swapped = compareSelected(mine, [0], theirs, [0], true).pages[0]!
    expect(normal.added[0]?.line).toBe('old line')
    expect(swapped.added[0]?.line).toBe('new line')
  })
})
