import { PDFArray, PDFBool, PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib'
import type { AccessibilityCheck } from '../shared/ipc'

/**
 * Accessibility check: whether the file carries what assistive software reads. Each check inspects
 * the file's own structures and says how many places failed; none of them can say a page *reads* well,
 * so the report names what it did not test.
 */

const N = (name: string) => PDFName.of(name)

const lookup = (doc: PDFDocument, value: unknown) => doc.context.lookup(value as never)
const dictOf = (doc: PDFDocument, value: unknown): PDFDict | undefined => {
  const v = lookup(doc, value)
  return v instanceof PDFDict ? v : undefined
}
const arrayOf = (doc: PDFDocument, value: unknown): PDFArray | undefined => {
  const v = lookup(doc, value)
  return v instanceof PDFArray ? v : undefined
}
const textOf = (doc: PDFDocument, value: unknown): string | undefined => {
  const v = lookup(doc, value)
  return v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : undefined
}

/** Figure elements in the structure tree, and how many of them have no alternate text */
function figures(doc: PDFDocument, root: unknown): { total: number; missing: number } {
  let total = 0
  let missing = 0
  const seen = new Set<PDFDict>()
  const stack: unknown[] = [root]
  while (stack.length > 0 && seen.size < 200_000) {
    const entry = lookup(doc, stack.pop())
    if (entry instanceof PDFArray) {
      stack.push(...entry.asArray())
      continue
    }
    const node = entry instanceof PDFDict ? entry : undefined
    if (!node || seen.has(node)) continue
    seen.add(node)
    const type = lookup(doc, node.get(N('S')))
    if (type instanceof PDFName && type.decodeText() === 'Figure') {
      total += 1
      if (!(textOf(doc, node.get(N('Alt')))?.trim() ?? '')) missing += 1
    }
    const kids = lookup(doc, node.get(N('K')))
    if (kids instanceof PDFArray) stack.push(...kids.asArray())
    else if (kids instanceof PDFDict) stack.push(kids)
  }
  return { total, missing }
}

export function checkAccessibility(doc: PDFDocument): AccessibilityCheck[] {
  const catalog = doc.catalog
  const out: AccessibilityCheck[] = []
  const add = (id: AccessibilityCheck['id'], status: AccessibilityCheck['status'], count = 0) =>
    out.push({ id, status, count })

  const markInfo = dictOf(doc, catalog.get(N('MarkInfo')))
  const marked = lookup(doc, markInfo?.get(N('Marked')))
  const structRoot = dictOf(doc, catalog.get(N('StructTreeRoot')))
  add('tagged', marked instanceof PDFBool && marked.asBoolean() && structRoot ? 'pass' : 'fail')

  add('language', (textOf(doc, catalog.get(N('Lang')))?.trim() ?? '') ? 'pass' : 'fail')

  const info = dictOf(doc, doc.context.trailerInfo.Info)
  const hasTitle = (textOf(doc, info?.get(N('Title')))?.trim() ?? '') !== ''
  const prefs = dictOf(doc, catalog.get(N('ViewerPreferences')))
  const showsTitle = lookup(doc, prefs?.get(N('DisplayDocTitle')))
  add(
    'title',
    hasTitle && showsTitle instanceof PDFBool && showsTitle.asBoolean() ? 'pass' : 'fail',
  )

  if (structRoot) {
    const found = figures(doc, structRoot.get(N('K')))
    add('figureAlt', found.missing === 0 ? 'pass' : 'fail', found.missing)
  } else {
    // untagged: there is no structure to hold alternate text at all
    add('figureAlt', 'fail')
  }

  let fieldsWithoutTip = 0
  let pagesWithoutTabOrder = 0
  for (const page of doc.getPages()) {
    const annots = arrayOf(doc, page.node.get(N('Annots')))
    if (!annots || annots.size() === 0) continue
    const tabs = lookup(doc, page.node.get(N('Tabs')))
    if (!(tabs instanceof PDFName) || tabs.decodeText() !== 'S') pagesWithoutTabOrder += 1
    for (const entry of annots.asArray()) {
      const annot = dictOf(doc, entry)
      if (!annot) continue
      const subtype = lookup(doc, annot.get(N('Subtype')))
      if (!(subtype instanceof PDFName) || subtype.decodeText() !== 'Widget') continue
      // the description may sit on the field the widget belongs to
      const parent = dictOf(doc, annot.get(N('Parent')))
      const tip = textOf(doc, annot.get(N('TU'))) ?? textOf(doc, parent?.get(N('TU')))
      if (!(tip?.trim() ?? '')) fieldsWithoutTip += 1
    }
  }
  add('fieldTips', fieldsWithoutTip === 0 ? 'pass' : 'fail', fieldsWithoutTip)
  add('tabOrder', pagesWithoutTabOrder === 0 ? 'pass' : 'fail', pagesWithoutTabOrder)

  const pages = doc.getPageCount()
  const outlines = dictOf(doc, catalog.get(N('Outlines')))
  add('bookmarks', pages < 20 || outlines ? 'pass' : 'fail')

  // permission bit 10 (extraction for accessibility) is read from the encryption dictionary
  const encrypt = dictOf(doc, doc.context.trailerInfo.Encrypt)
  if (encrypt) {
    const p = lookup(doc, encrypt.get(N('P')))
    const bits = p && 'asNumber' in p ? (p as { asNumber(): number }).asNumber() : -1
    add('screenReaderAccess', (bits & (1 << 9)) !== 0 ? 'pass' : 'fail')
  } else {
    add('screenReaderAccess', 'pass')
  }
  return out
}
