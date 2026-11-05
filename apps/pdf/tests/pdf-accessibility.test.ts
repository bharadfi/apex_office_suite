// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { PDFDocument, PDFName, PDFString } from 'pdf-lib'
import { checkAccessibility } from '../src/main/pdf-accessibility'

const N = (name: string) => PDFName.of(name)
const statusOf = (doc: PDFDocument, id: string) => checkAccessibility(doc).find((c) => c.id === id)!

async function bare(): Promise<PDFDocument> {
  const doc = await PDFDocument.create()
  doc.addPage([200, 200])
  return PDFDocument.load(await doc.save(), { updateMetadata: false })
}

describe('checkAccessibility', () => {
  it('fails an untagged file with no language or title', async () => {
    const doc = await bare()
    expect(statusOf(doc, 'tagged').status).toBe('fail')
    expect(statusOf(doc, 'language').status).toBe('fail')
    expect(statusOf(doc, 'title').status).toBe('fail')
    expect(statusOf(doc, 'figureAlt').status).toBe('fail')
    // nothing that needs bookmarks, fields or a tab order here
    expect(statusOf(doc, 'bookmarks').status).toBe('pass')
    expect(statusOf(doc, 'fieldTips').status).toBe('pass')
    expect(statusOf(doc, 'screenReaderAccess').status).toBe('pass')
  })

  it('passes tagging, language and title once they are set, and counts figures without alternate text', async () => {
    const doc = await bare()
    const ctx = doc.context
    const withAlt = ctx.register(
      ctx.obj({ Type: 'StructElem', S: 'Figure', Alt: PDFString.of('A chart') }),
    )
    const without = ctx.register(ctx.obj({ Type: 'StructElem', S: 'Figure' }))
    const root = ctx.register(ctx.obj({ Type: 'StructTreeRoot', K: [withAlt, without] }))
    doc.catalog.set(N('StructTreeRoot'), root)
    doc.catalog.set(N('MarkInfo'), ctx.obj({ Marked: true }))
    doc.catalog.set(N('Lang'), PDFString.of('en-US'))
    doc.setTitle('Annual report')
    doc.catalog.set(N('ViewerPreferences'), ctx.obj({ DisplayDocTitle: true }))
    const out = checkAccessibility(doc)
    const get = (id: string) => out.find((c) => c.id === id)!
    expect(get('tagged').status).toBe('pass')
    expect(get('language').status).toBe('pass')
    expect(get('title').status).toBe('pass')
    expect(get('figureAlt')).toEqual({ id: 'figureAlt', status: 'fail', count: 1 })
  })

  it('wants bookmarks only from long documents, and descriptions on form fields', async () => {
    const doc = await PDFDocument.create()
    for (let i = 0; i < 20; i++) doc.addPage([100, 100])
    const ctx = doc.context
    const widget = ctx.register(
      ctx.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Tx', Rect: [0, 0, 10, 10] }),
    )
    doc.getPage(0).node.set(N('Annots'), ctx.obj([widget]))
    const long = await PDFDocument.load(await doc.save(), { updateMetadata: false })
    expect(statusOf(long, 'bookmarks').status).toBe('fail')
    expect(statusOf(long, 'fieldTips')).toEqual({ id: 'fieldTips', status: 'fail', count: 1 })
    expect(statusOf(long, 'tabOrder')).toEqual({ id: 'tabOrder', status: 'fail', count: 1 })
  })
})
