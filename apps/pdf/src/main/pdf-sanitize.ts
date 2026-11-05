import { PDFArray, PDFDict, PDFDocument, PDFName } from 'pdf-lib'

/**
 * Remove Hidden Information: what a PDF carries that is not on the page.
 *
 * Each category is found by walking the document's own structures (the catalog, every page's
 * annotations, the name trees), so a count says how many of that thing the file really holds.
 * `inspectHidden` only counts; `sanitizeHidden` removes the categories asked for and reports what it removed.
 * Page content, fonts and images are never touched.
 */

import type { HiddenInfoCounts, SanitizeCategory } from '../shared/ipc'

export const SANITIZE_CATEGORIES: readonly SanitizeCategory[] = [
  'metadata',
  'attachments',
  'scripts',
  'comments',
  'bookmarks',
  'links',
  'thumbnails',
]

const emptyCounts = (): HiddenInfoCounts => ({
  metadata: 0,
  attachments: 0,
  scripts: 0,
  comments: 0,
  bookmarks: 0,
  links: 0,
  thumbnails: 0,
})

const N = (name: string) => PDFName.of(name)

function dictOf(doc: PDFDocument, value: unknown): PDFDict | undefined {
  const resolved = doc.context.lookup(value as never)
  return resolved instanceof PDFDict ? resolved : undefined
}

function arrayOf(doc: PDFDocument, value: unknown): PDFArray | undefined {
  const resolved = doc.context.lookup(value as never)
  return resolved instanceof PDFArray ? resolved : undefined
}

function nameOf(doc: PDFDocument, value: unknown): string | undefined {
  const resolved = doc.context.lookup(value as never)
  return resolved instanceof PDFName ? resolved.decodeText() : undefined
}

/** An action dictionary (or the chain it continues with /Next) that runs a script */
function isScriptAction(doc: PDFDocument, action: unknown, depth = 0): boolean {
  const dict = dictOf(doc, action)
  if (!dict || depth > 8) return false
  if (nameOf(doc, dict.get(N('S'))) === 'JavaScript') return true
  const next = doc.context.lookup(dict.get(N('Next')) as never)
  if (next instanceof PDFArray) {
    return next.asArray().some((a) => isScriptAction(doc, a, depth + 1))
  }
  return isScriptAction(doc, next, depth + 1)
}

/** Remove the script parts of an annotation/field/page/catalog dictionary; returns how many it held */
function stripScripts(doc: PDFDocument, dict: PDFDict, apply: boolean): number {
  let found = 0
  if (isScriptAction(doc, dict.get(N('A')))) {
    found += 1
    if (apply) dict.delete(N('A'))
  }
  const aa = dictOf(doc, dict.get(N('AA')))
  if (aa) {
    for (const key of aa.keys()) {
      if (isScriptAction(doc, aa.get(key))) {
        found += 1
        if (apply) aa.delete(key)
      }
    }
    if (apply && aa.keys().length === 0) dict.delete(N('AA'))
  }
  return found
}

/** Leaves of a name tree: how many entries it names */
function nameTreeSize(doc: PDFDocument, node: unknown, depth = 0): number {
  const dict = dictOf(doc, node)
  if (!dict || depth > 16) return 0
  let count = 0
  const names = arrayOf(doc, dict.get(N('Names')))
  if (names) count += Math.floor(names.size() / 2)
  const kids = arrayOf(doc, dict.get(N('Kids')))
  if (kids) for (const kid of kids.asArray()) count += nameTreeSize(doc, kid, depth + 1)
  return count
}

function outlineCount(doc: PDFDocument, first: unknown, depth = 0): number {
  let count = 0
  let item = dictOf(doc, first)
  let guard = 0
  while (item && guard++ < 100000) {
    count += 1
    if (depth < 32) count += outlineCount(doc, item.get(N('First')), depth + 1)
    item = dictOf(doc, item.get(N('Next')))
  }
  return count
}

export function sanitizeHidden(
  doc: PDFDocument,
  categories: ReadonlySet<SanitizeCategory>,
  apply: boolean,
): HiddenInfoCounts {
  const counts = emptyCounts()
  const want = (c: SanitizeCategory) => apply && categories.has(c)
  const catalog = doc.catalog

  // metadata: the Info dictionary's entries and the XMP packet
  const info = dictOf(doc, doc.context.trailerInfo.Info)
  if (info) {
    const keys = info.keys()
    counts.metadata += keys.length
    if (want('metadata')) for (const key of keys) info.delete(key)
  }
  if (catalog.get(N('Metadata'))) {
    counts.metadata += 1
    if (want('metadata')) catalog.delete(N('Metadata'))
  }

  // document level: embedded files, scripts, bookmarks
  const names = dictOf(doc, catalog.get(N('Names')))
  if (names) {
    const embedded = nameTreeSize(doc, names.get(N('EmbeddedFiles')))
    counts.attachments += embedded
    if (want('attachments') && names.get(N('EmbeddedFiles'))) names.delete(N('EmbeddedFiles'))
    const scripts = nameTreeSize(doc, names.get(N('JavaScript')))
    counts.scripts += scripts
    if (want('scripts') && names.get(N('JavaScript'))) names.delete(N('JavaScript'))
  }
  const associated = arrayOf(doc, catalog.get(N('AF')))
  if (associated) {
    counts.attachments += associated.size()
    if (want('attachments')) catalog.delete(N('AF'))
  }
  counts.scripts += stripScripts(doc, catalog, want('scripts'))
  if (isScriptAction(doc, catalog.get(N('OpenAction')))) {
    counts.scripts += 1
    if (want('scripts')) catalog.delete(N('OpenAction'))
  }
  const outlines = dictOf(doc, catalog.get(N('Outlines')))
  if (outlines) {
    counts.bookmarks += outlineCount(doc, outlines.get(N('First')))
    if (want('bookmarks')) {
      catalog.delete(N('Outlines'))
      if (nameOf(doc, catalog.get(N('PageMode'))) === 'UseOutlines') {
        catalog.set(N('PageMode'), N('UseNone'))
      }
    }
  }

  // pages: annotations (comments, links, attached files, scripts), thumbnails, page actions
  for (const page of doc.getPages()) {
    const pageDict = page.node
    counts.scripts += stripScripts(doc, pageDict, want('scripts'))
    if (pageDict.get(N('Thumb'))) {
      counts.thumbnails += 1
      if (want('thumbnails')) pageDict.delete(N('Thumb'))
    }
    const annots = arrayOf(doc, pageDict.get(N('Annots')))
    if (!annots) continue
    const kept: unknown[] = []
    let removedAny = false
    for (const entry of annots.asArray()) {
      const annot = dictOf(doc, entry)
      if (!annot) {
        kept.push(entry)
        continue
      }
      const subtype = nameOf(doc, annot.get(N('Subtype')))
      let drop = false
      if (subtype === 'FileAttachment') {
        counts.attachments += 1
        drop = want('attachments')
      } else if (subtype === 'Link') {
        counts.links += 1
        drop = want('links')
        counts.scripts += stripScripts(doc, annot, want('scripts') && !drop)
      } else if (subtype === 'Widget') {
        // a form field stays; only the scripts on it go
        counts.scripts += stripScripts(doc, annot, want('scripts'))
      } else if (subtype === 'Popup') {
        // belongs to the comment that opens it: counted and removed with the comments
        drop = want('comments')
      } else {
        counts.comments += 1
        drop = want('comments')
        if (!drop) counts.scripts += stripScripts(doc, annot, want('scripts'))
      }
      if (drop) removedAny = true
      else kept.push(entry)
    }
    if (removedAny) {
      if (kept.length === 0) pageDict.delete(N('Annots'))
      else pageDict.set(N('Annots'), doc.context.obj(kept as never))
    }
  }

  // the form's own field actions (calculations, formats) live on the field dictionaries too
  const form = dictOf(doc, catalog.get(N('AcroForm')))
  const fields = form ? arrayOf(doc, form.get(N('Fields'))) : undefined
  if (fields) {
    const seen = new Set<PDFDict>()
    const walk = (entry: unknown, depth: number): void => {
      const field = dictOf(doc, entry)
      if (!field || seen.has(field) || depth > 32) return
      seen.add(field)
      counts.scripts += stripScripts(doc, field, want('scripts'))
      const kids = arrayOf(doc, field.get(N('Kids')))
      if (kids) for (const kid of kids.asArray()) walk(kid, depth + 1)
    }
    for (const entry of fields.asArray()) walk(entry, 0)
  }

  return counts
}

export function inspectHidden(doc: PDFDocument): HiddenInfoCounts {
  return sanitizeHidden(doc, new Set(SANITIZE_CATEGORIES), false)
}
