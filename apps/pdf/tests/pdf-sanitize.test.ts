// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString } from 'pdf-lib'
import { SANITIZE_CATEGORIES, inspectHidden, sanitizeHidden } from '../src/main/pdf-sanitize'
import type { SanitizeCategory } from '../src/shared/ipc'

const N = (name: string) => PDFName.of(name)

/** A PDF that holds one or more of every kind of hidden thing */
async function loaded(): Promise<PDFDocument> {
  const doc = await PDFDocument.create()
  doc.setTitle('Secret plan')
  doc.setAuthor('Someone')
  const page = doc.addPage([300, 300])
  const ctx = doc.context

  const comment = ctx.obj({
    Type: 'Annot',
    Subtype: 'Text',
    Rect: [10, 10, 30, 30],
    Contents: PDFString.of('note'),
  })
  const link = ctx.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: [40, 10, 90, 30],
    A: { S: 'JavaScript', JS: PDFString.of('app.alert(1)') },
  })
  const attach = ctx.obj({
    Type: 'Annot',
    Subtype: 'FileAttachment',
    Rect: [100, 10, 120, 30],
  })
  const widget = ctx.obj({
    Type: 'Annot',
    Subtype: 'Widget',
    Rect: [130, 10, 200, 30],
    AA: { C: { S: 'JavaScript', JS: PDFString.of('calc()') } },
  })
  page.node.set(
    N('Annots'),
    ctx.obj([
      ctx.register(comment),
      ctx.register(link),
      ctx.register(attach),
      ctx.register(widget),
    ]),
  )
  page.node.set(N('Thumb'), ctx.register(ctx.stream('x')))

  doc.catalog.set(N('OpenAction'), ctx.obj({ S: 'JavaScript', JS: PDFString.of('go()') }))
  doc.catalog.set(
    N('Names'),
    ctx.obj({
      EmbeddedFiles: {
        Names: [PDFString.of('a.txt'), ctx.obj({}), PDFString.of('b.txt'), ctx.obj({})],
      },
      JavaScript: {
        Names: [PDFString.of('boot'), ctx.obj({ S: 'JavaScript', JS: PDFString.of('1') })],
      },
    }),
  )
  const item2 = ctx.register(ctx.obj({ Title: PDFString.of('Two') }))
  const item1 = ctx.register(ctx.obj({ Title: PDFString.of('One'), Next: item2 }))
  doc.catalog.set(N('Outlines'), ctx.obj({ Type: 'Outlines', First: item1, Last: item2, Count: 2 }))
  doc.catalog.set(
    N('Metadata'),
    ctx.register(ctx.stream('<x:xmpmeta/>', { Type: 'Metadata', Subtype: 'XML' })),
  )
  return PDFDocument.load(await doc.save({ useObjectStreams: false }), { updateMetadata: false })
}

describe('inspectHidden', () => {
  it('counts what the file really holds', async () => {
    const counts = inspectHidden(await loaded())
    expect(counts.attachments).toBe(3) // two embedded files and one attached-file annotation
    expect(counts.comments).toBe(1)
    expect(counts.links).toBe(1)
    expect(counts.bookmarks).toBe(2)
    expect(counts.thumbnails).toBe(1)
    // the open action, the name-tree script, the link's action and the field's calculation
    expect(counts.scripts).toBe(4)
    expect(counts.metadata).toBeGreaterThanOrEqual(3) // title, author, XMP
  })

  it('changes nothing', async () => {
    const doc = await loaded()
    const before = (await doc.save({ useObjectStreams: false })).length
    inspectHidden(doc)
    expect((await doc.save({ useObjectStreams: false })).length).toBe(before)
  })

  it('finds nothing in a plain file', async () => {
    const doc = await PDFDocument.create()
    doc.addPage()
    const plain = await PDFDocument.load(await doc.save(), { updateMetadata: false })
    for (const key of SANITIZE_CATEGORIES) {
      expect(inspectHidden(plain)[key], key).toBe(
        key === 'metadata' ? inspectHidden(plain).metadata : 0,
      )
    }
  })
})

describe('sanitizeHidden', () => {
  const run = async (kinds: SanitizeCategory[]) => {
    const doc = await loaded()
    const removed = sanitizeHidden(doc, new Set(kinds), true)
    const again = await PDFDocument.load(await doc.save({ useObjectStreams: false }), {
      updateMetadata: false,
    })
    return { removed, after: inspectHidden(again), doc: again }
  }

  it('removes only the categories asked for', async () => {
    const { after } = await run(['comments', 'thumbnails'])
    expect(after.comments).toBe(0)
    expect(after.thumbnails).toBe(0)
    expect(after.attachments).toBe(3)
    expect(after.links).toBe(1)
    expect(after.bookmarks).toBe(2)
  })

  it('removes every script, wherever it sat, and keeps the form field itself', async () => {
    const { after, doc } = await run(['scripts'])
    expect(after.scripts).toBe(0)
    const annots = doc.getPage(0).node.lookup(N('Annots'), PDFArray)
    const subtypes = annots
      .asArray()
      .map((a) => (doc.context.lookup(a, PDFDict).get(N('Subtype')) as PDFName).decodeText())
    expect(subtypes).toContain('Widget')
    expect(subtypes).toContain('Link')
  })

  it('removes attachments of both kinds', async () => {
    const { after, doc } = await run(['attachments'])
    expect(after.attachments).toBe(0)
    const subtypes = doc
      .getPage(0)
      .node.lookup(N('Annots'), PDFArray)
      .asArray()
      .map((a) => (doc.context.lookup(a, PDFDict).get(N('Subtype')) as PDFName).decodeText())
    expect(subtypes).not.toContain('FileAttachment')
  })

  it('removes metadata and bookmarks, and resets the side panel', async () => {
    const { after, doc } = await run(['metadata', 'bookmarks'])
    expect(after.metadata).toBe(0)
    expect(after.bookmarks).toBe(0)
    expect(doc.catalog.get(N('Outlines'))).toBeUndefined()
  })

  it('reports what it removed, and does nothing when applying is off', async () => {
    const doc = await loaded()
    const dry = sanitizeHidden(doc, new Set(SANITIZE_CATEGORIES), false)
    expect(inspectHidden(doc)).toEqual(dry)
    const { removed } = await run([...SANITIZE_CATEGORIES])
    expect(removed.comments).toBe(1)
    expect(removed.links).toBe(1)
  })
})
