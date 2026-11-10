import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef } from 'pdf-lib'
import type { PDFContext, PDFObject } from 'pdf-lib'

/**
 * What may be written after a signature without breaking it, as other readers judge it.
 *
 * A file signed more than once, or given validation data later, ends with revisions the earlier
 * signatures never covered. Those revisions are not tampering when all they add is more
 * signatures (their fields, values and appearances), validation data, or the document bookkeeping
 * that carries them. A change to page content, text, images or anything else is. A certifying
 * signature narrows or widens this: level 1 allows nothing, level 2 also form filling, level 3
 * also annotations.
 *
 * The check compares the file as it was when the signature was made (everything up to the end of
 * its signed bytes) with the file as it is now, object by object, so it does not matter whether a
 * later revision stores its objects plainly or in object streams.
 */

const name = (key: string) => PDFName.of(key)

const typeOf = (obj: PDFObject | undefined): string | undefined => {
  const dict = obj instanceof PDFRawStream ? obj.dict : obj instanceof PDFDict ? obj : undefined
  const type = dict?.get(name('Type'))
  return type instanceof PDFName ? type.decodeText() : undefined
}

const dictOf = (obj: PDFObject | undefined): PDFDict | undefined =>
  obj instanceof PDFRawStream ? obj.dict : obj instanceof PDFDict ? obj : undefined

/** Whether two objects are the same, comparing a stream's data as well as its dictionary */
function sameObject(a: PDFObject, b: PDFObject): boolean {
  if (a instanceof PDFRawStream && b instanceof PDFRawStream) {
    return a.dict.toString() === b.dict.toString() && Buffer.compare(a.contents, b.contents) === 0
  }
  return a.constructor === b.constructor && a.toString() === b.toString()
}

/** Whether two dictionaries agree on every key except `except` */
function sameExcept(a: PDFDict, b: PDFDict, except: readonly string[]): boolean {
  const skip = new Set(except)
  const keys = new Set<string>()
  for (const [key] of a.entries()) keys.add(key.decodeText())
  for (const [key] of b.entries()) keys.add(key.decodeText())
  for (const key of keys) {
    if (skip.has(key)) continue
    const x = a.get(name(key))
    const y = b.get(name(key))
    if (x === undefined || y === undefined) return false
    if (x.toString() !== y.toString()) return false
  }
  return true
}

/** The objects a form field or annotation uses (its appearance, value, resources), never walking up to its page */
function reachableFrom(start: PDFObject | undefined, ctx: PDFContext, into: Set<PDFRef>): void {
  const visit = (node: PDFObject | undefined, depth: number): void => {
    if (!node || depth > 24) return
    if (node instanceof PDFRef) {
      if (into.has(node)) return
      const target = ctx.lookup(node)
      if (typeOf(target) === 'Page' || typeOf(target) === 'Pages') return
      into.add(node)
      visit(target, depth + 1)
      return
    }
    if (node instanceof PDFArray) {
      for (const item of node.asArray()) visit(item, depth + 1)
      return
    }
    const dict = dictOf(node)
    if (!dict) return
    for (const [key, value] of dict.entries()) {
      const k = key.decodeText()
      if (k === 'P' || k === 'Parent' || k === 'Prev' || k === 'Next') continue
      visit(value, depth + 1)
    }
  }
  visit(start, 0)
}

const isSignatureValue = (obj: PDFObject | undefined): boolean => {
  const dict = dictOf(obj)
  if (!dict) return false
  const type = typeOf(obj)
  return type === 'Sig' || type === 'DocTimeStamp' || (dict.has(name('ByteRange')) && dict.has(name('Contents')))
}

const fieldType = (dict: PDFDict, ctx: PDFContext): string | undefined => {
  let current: PDFDict | undefined = dict
  for (let depth = 0; current && depth < 16; depth++) {
    const ft = current.get(name('FT'))
    if (ft instanceof PDFName) return ft.decodeText()
    current = ctx.lookupMaybe(current.get(name('Parent')), PDFDict)
  }
  return undefined
}

const ANNOTATION_SUBTYPES = new Set([
  'Text', 'FreeText', 'Line', 'Square', 'Circle', 'Polygon', 'PolyLine', 'Highlight', 'Underline',
  'Squiggly', 'StrikeOut', 'Stamp', 'Caret', 'Ink', 'Popup', 'FileAttachment', 'Redact', 'Link',
])

/**
 * Whether every change made after `signedEnd` (the end of the signature's signed bytes) is one the
 * signature allows. `certifiedLevel` is the certifying signature's level (1 to 3), if it is one.
 */
export async function onlyPermittedChangesAfter(
  bytes: Buffer,
  signedEnd: number,
  finalDoc: PDFDocument,
  certifiedLevel: 1 | 2 | 3 | undefined,
): Promise<boolean> {
  let base: PDFDocument
  try {
    base = await PDFDocument.load(bytes.subarray(0, signedEnd), {
      updateMetadata: false,
      throwOnInvalidObject: false,
    })
  } catch {
    return false // the signed revision cannot be read back: do not vouch for what followed
  }
  const finalCtx = finalDoc.context
  const baseCtx = base.context

  // 1. what changed: objects that are new, or that differ from the signed revision
  const changed: PDFRef[] = []
  for (const [ref, now] of finalCtx.enumerateIndirectObjects()) {
    const before = baseCtx.lookup(ref)
    if (before === undefined || !sameObject(before, now)) changed.push(ref)
  }
  // nothing that is an object changed: only whitespace may follow, anything else is unexplained content
  if (changed.length === 0) return bytes.subarray(signedEnd).toString('latin1').trim() === ''

  // a certifying signature of level 1 allows no change at all (the file structure aside)
  const structural = (obj: PDFObject | undefined) => typeOf(obj) === 'XRef' || typeOf(obj) === 'ObjStm'

  // 2. what the changes may belong to: new signature fields, the validation data, the form fields
  const allowed = new Set<PDFRef>()
  const widgets = new Set<PDFRef>()
  const catalog = finalDoc.catalog
  const rootRef = finalCtx.trailerInfo.Root
  const acroFormEntry = catalog.get(name('AcroForm'))
  const dss = catalog.get(name('DSS'))
  if (certifiedLevel !== 1) reachableFrom(dss, finalCtx, allowed)

  for (const ref of changed) {
    const obj = finalCtx.lookup(ref)
    const dict = dictOf(obj)
    if (!dict) continue
    const subtype = dict.get(name('Subtype'))
    const isWidget = subtype instanceof PDFName && subtype.decodeText() === 'Widget'
    const ft = isWidget || dict.has(name('FT')) ? fieldType(dict, finalCtx) : undefined
    if (certifiedLevel === 1) continue
    if (ft === 'Sig' || isSignatureValue(obj)) {
      allowed.add(ref)
      if (ft === 'Sig') widgets.add(ref)
      reachableFrom(obj, finalCtx, allowed)
    } else if (certifiedLevel !== undefined && certifiedLevel >= 2 && (isWidget || ft !== undefined)) {
      allowed.add(ref) // form filling under a certifying signature
      reachableFrom(obj, finalCtx, allowed)
    } else if (
      certifiedLevel === 3 &&
      subtype instanceof PDFName &&
      ANNOTATION_SUBTYPES.has(subtype.decodeText())
    ) {
      allowed.add(ref) // annotating under a certifying signature
      widgets.add(ref)
      reachableFrom(obj, finalCtx, allowed)
    }
  }

  const isInfo = (ref: PDFRef) => finalCtx.trailerInfo.Info === ref

  // 3. every change is either structure, allowed, or a small permitted edit to the document's own dictionaries
  // arrays that are a page's /Annots, stored as their own object
  const annotArrays = new Set<PDFRef>()
  for (const [, obj] of finalCtx.enumerateIndirectObjects()) {
    if (typeOf(obj) !== 'Page') continue
    const annots = dictOf(obj)?.get(name('Annots'))
    if (annots instanceof PDFRef) annotArrays.add(annots)
  }

  for (const ref of changed) {
    const now = finalCtx.lookup(ref)
    if (structural(now) || allowed.has(ref) || isInfo(ref)) continue
    // signing software rewrites the document's XMP metadata (modify date, producer)
    if (certifiedLevel !== 1 && typeOf(now) === 'Metadata') continue
    const before = baseCtx.lookup(ref)
    if (annotArrays.has(ref) && now instanceof PDFArray && before instanceof PDFArray) {
      if (certifiedLevel === 1) return false
      const was = before.asArray().map((e) => e.toString())
      const items = now.asArray()
      if (!was.every((r) => items.some((n) => n.toString() === r))) return false
      for (const added of items) {
        if (was.includes(added.toString())) continue
        if (!(added instanceof PDFRef) || !widgets.has(added)) return false
      }
      continue
    }
    const nowDict = dictOf(now)
    const beforeDict = dictOf(before)
    if (!nowDict || !beforeDict || certifiedLevel === 1) return false
    const type = typeOf(now)

    if (ref === rootRef || type === 'Catalog') {
      if (!sameExcept(beforeDict, nowDict, ['AcroForm', 'DSS', 'Extensions', 'Version'])) return false
      // an AcroForm written directly in the catalog is judged here; an indirect one on its own
      if (acroFormEntry instanceof PDFDict) {
        const was = beforeDict.get(name('AcroForm'))
        if (was instanceof PDFDict) {
          if (!acroFormOk(was, acroFormEntry, finalCtx, widgets, allowed)) return false
        } else if (was?.toString() !== acroFormEntry.toString()) return false
      }      continue
    }
    if (acroFormEntry instanceof PDFRef && ref === acroFormEntry) {
      if (!acroFormOk(beforeDict, nowDict, finalCtx, widgets, allowed)) return false
      continue
    }
    if (type === 'Page') {
      if (!sameExcept(beforeDict, nowDict, ['Annots'])) return false
      const was = refStrings(beforeDict.get(name('Annots')), baseCtx)
      const now2 = refList(nowDict.get(name('Annots')), finalCtx)
      if (!was.every((r) => now2.some((n) => n.toString() === r))) return false
      for (const added of now2) {
        if (was.includes(added.toString())) continue
        if (!(added instanceof PDFRef) || !widgets.has(added)) return false
      }
      continue
    }
    return false
  }
  return true
}

const refList = (obj: PDFObject | undefined, ctx: PDFContext): PDFObject[] => {
  const array = obj instanceof PDFRef ? ctx.lookupMaybe(obj, PDFArray) : obj instanceof PDFArray ? obj : undefined
  return array ? array.asArray() : []
}

const refStrings = (obj: PDFObject | undefined, ctx: PDFContext): string[] =>
  refList(obj, ctx).map((entry) => entry.toString())

/** The form dictionary may gain fields (signature fields, or form fields under a level 2 or 3 certification) and flags */
function acroFormOk(
  before: PDFDict,
  now: PDFDict,
  ctx: PDFContext,
  widgets: ReadonlySet<PDFRef>,
  allowed: ReadonlySet<PDFRef>,
): boolean {
  if (!sameExcept(before, now, ['Fields', 'SigFlags', 'DR', 'DA', 'NeedAppearances'])) return false
  const was = refStrings(before.get(name('Fields')), ctx)
  const fields = refList(now.get(name('Fields')), ctx)
  if (!was.every((r) => fields.some((f) => f.toString() === r))) return false
  for (const field of fields) {
    if (was.includes(field.toString())) continue
    if (!(field instanceof PDFRef) || !(widgets.has(field) || allowed.has(field))) return false
  }
  return true
}
