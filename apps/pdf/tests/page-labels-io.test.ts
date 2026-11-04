// @vitest-environment node
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFString } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { applyPageLabels, readPageLabelRanges } from '../src/main/page-labels-io'
import { labelsFor, type PageLabelRange } from '../src/shared/page-labels'

async function pdfWithPages(count: number): Promise<PDFDocument> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < count; i++) doc.addPage([200, 200])
  return PDFDocument.load(await doc.save({ useObjectStreams: false }))
}

const range = (over: Partial<PageLabelRange> & { start: number }): PageLabelRange => ({
  style: 'decimal',
  prefix: '',
  firstNumber: 1,
  ...over,
})

describe('page labels in a file', () => {
  it('writes ranges and reads the same ranges back, through a save and a reload', async () => {
    const doc = await pdfWithPages(6)
    const ranges = [
      range({ start: 0, style: 'lowerRoman' }),
      range({ start: 2, prefix: 'A-', firstNumber: 5 }),
      range({ start: 4, style: 'none', prefix: 'Annex' }),
    ]
    applyPageLabels(doc, ranges)
    const reloaded = await PDFDocument.load(await doc.save({ useObjectStreams: false }))
    expect(readPageLabelRanges(reloaded)).toEqual(ranges)
    expect(labelsFor(readPageLabelRanges(reloaded), 6)).toEqual([
      'i',
      'ii',
      'A-5',
      'A-6',
      'Annex',
      'Annex',
    ])
  })

  it('keeps a prefix with non-Latin text intact', async () => {
    const doc = await pdfWithPages(2)
    applyPageLabels(doc, [range({ start: 0, prefix: '附录' })])
    const reloaded = await PDFDocument.load(await doc.save({ useObjectStreams: false }))
    expect(readPageLabelRanges(reloaded)[0]!.prefix).toBe('附录')
  })

  it('replaces labels that were there, and removes them when given none', async () => {
    const doc = await pdfWithPages(3)
    applyPageLabels(doc, [range({ start: 0, style: 'upperRoman' })])
    applyPageLabels(doc, [range({ start: 0, style: 'upperAlpha' })])
    expect(readPageLabelRanges(doc).map((r) => r.style)).toEqual(['upperAlpha'])
    applyPageLabels(doc, [])
    expect(doc.catalog.has(PDFName.of('PageLabels'))).toBe(false)
    expect(readPageLabelRanges(doc)).toEqual([])
  })

  it('drops a range that starts past the last page and adds the page-0 range', async () => {
    const doc = await pdfWithPages(2)
    applyPageLabels(doc, [range({ start: 1, style: 'upperRoman' }), range({ start: 9 })])
    const out = readPageLabelRanges(doc)
    expect(out.map((r) => r.start)).toEqual([0, 1])
    expect(out[0]!.style).toBe('decimal')
  })

  it('writes only what differs from the default', async () => {
    const doc = await pdfWithPages(2)
    applyPageLabels(doc, [range({ start: 0 })])
    const labels = doc.catalog.lookup(PDFName.of('PageLabels'), PDFDict)
    const nums = labels.lookup(PDFName.of('Nums'), PDFArray)
    const entry = nums.lookup(1, PDFDict)
    expect(nums.lookup(0, PDFNumber).asNumber()).toBe(0)
    expect(entry.has(PDFName.of('P'))).toBe(false)
    expect(entry.has(PDFName.of('St'))).toBe(false)
    expect((entry.lookup(PDFName.of('S')) as PDFName).decodeText()).toBe('D')
  })
})

describe('reading labels written by other programs', () => {
  it('follows a number tree that nests its entries under /Kids', async () => {
    const doc = await pdfWithPages(4)
    const ctx = doc.context
    const leafA = ctx.obj({ Nums: [0, ctx.obj({ S: 'r' })] })
    const leafB = ctx.obj({ Nums: [2, ctx.obj({ S: 'D', St: 7 })] })
    doc.catalog.set(
      PDFName.of('PageLabels'),
      ctx.obj({ Kids: [ctx.register(leafA), ctx.register(leafB)] }),
    )
    expect(labelsFor(readPageLabelRanges(doc), 4)).toEqual(['i', 'ii', '7', '8'])
  })

  it('reads a range with no /S as a prefix-only label', async () => {
    const doc = await pdfWithPages(2)
    const ctx = doc.context
    doc.catalog.set(
      PDFName.of('PageLabels'),
      ctx.obj({ Nums: [0, ctx.obj({ P: PDFString.of('Cover') })] }),
    )
    expect(labelsFor(readPageLabelRanges(doc), 2)).toEqual(['Cover', 'Cover'])
  })

  it('skips entries that make no sense instead of failing', async () => {
    const doc = await pdfWithPages(3)
    const ctx = doc.context
    doc.catalog.set(
      PDFName.of('PageLabels'),
      ctx.obj({
        Nums: [0, ctx.obj({ S: 'r' }), 'junk', 5, -3, ctx.obj({ S: 'D' }), 2, 'not a dict'],
      }),
    )
    expect(labelsFor(readPageLabelRanges(doc), 3)).toEqual(['i', 'ii', 'iii'])
  })

  it('survives a tree that loops back on itself', async () => {
    const doc = await pdfWithPages(2)
    const ctx = doc.context
    const loop = ctx.obj({}) as PDFDict
    const ref = ctx.register(loop)
    loop.set(PDFName.of('Kids'), ctx.obj([ref]))
    loop.set(PDFName.of('Nums'), ctx.obj([0, ctx.obj({ S: 'R' })]))
    doc.catalog.set(PDFName.of('PageLabels'), ref)
    expect(readPageLabelRanges(doc).map((r) => r.style)).toEqual(['upperRoman'])
  })

  it('gives no ranges for a document without labels', async () => {
    expect(readPageLabelRanges(await pdfWithPages(2))).toEqual([])
  })
})
