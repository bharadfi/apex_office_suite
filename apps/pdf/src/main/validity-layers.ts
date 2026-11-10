/**
 * The verdict mark of a signature box, as Adobe lays it out.
 *
 * Signing software draws a signature box in layers inside one appearance: a background, the
 * signer's text and, beside them, "validity layers" that stand in for the verdict the reader will
 * reach. Each opens with a marker comment (`% DSUnknown`, `% DSValid`, `% DSInvalid`); Adobe's
 * `n4` layer carries the words "(Signature Not Verified)". The signer can only guess the verdict
 * (usually "unknown"), so a reader draws its own in place of the guess, under the signer's text.
 *
 * This is that, for the copy a reader DISPLAYS or PRINTS. The signed file is never changed: a
 * signature covers its own bytes, and verification always reads the file as it is on disk.
 */
import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  decodePDFRawStream,
  type PDFContext,
  type PDFObject,
} from 'pdf-lib'

/** What a validity layer is a placeholder for */
export type LayerMark = 'unknown' | 'valid' | 'invalid' | 'caption'

/** The verdict a mark can show. Three glyphs, as in Adobe: tick, question mark, cross */
export type Verdict = 'valid' | 'unknown' | 'invalid'

/** How deep a signature appearance's form XObjects are followed looking for validity layers */
const LAYER_DEPTH = 6
/** The most of a layer's decoded content read to find its marker comment */
const PROBE_BYTES = 64 * 1024
/** The wording a signer bakes into the caption layer; a reader writes its own once the signature verifies */
const NOT_VERIFIED = '(Signature Not Verified)'

export interface ValidityLayer {
  ref: PDFRef
  mark: LayerMark
}

const decoded = (stream: PDFRawStream, limit = Number.POSITIVE_INFINITY): string | null => {
  try {
    const bytes = decodePDFRawStream(stream).decode()
    return Buffer.from(bytes.subarray(0, Math.min(bytes.length, limit))).toString('latin1')
  } catch {
    return null
  }
}

/** The mark a form XObject is a placeholder for, from the comment its content opens with */
function layerMark(stream: PDFRawStream): LayerMark | null {
  const subtype = stream.dict.get(PDFName.of('Subtype'))
  if (!(subtype instanceof PDFName) || subtype.decodeText() !== 'Form') return null
  const content = decoded(stream, PROBE_BYTES)
  if (content === null) return null
  if (content.includes(NOT_VERIFIED)) return 'caption'
  const m = /^\s*% DS([A-Za-z]+)/.exec(content)
  switch (m?.[1]) {
    case 'Unknown':
      return 'unknown'
    case 'Valid':
      return 'valid'
    case 'Invalid':
      return 'invalid'
    default:
      return null // `% DSBlank` layers are empty and need nothing
  }
}

function collect(
  ctx: PDFContext,
  node: PDFObject | undefined,
  depth: number,
  seen: Set<PDFRef>,
  out: ValidityLayer[],
): void {
  if (!node) return
  const stream = ctx.lookup(node)
  if (!(stream instanceof PDFRawStream)) return
  if (node instanceof PDFRef) {
    if (seen.has(node)) return
    seen.add(node)
    const mark = layerMark(stream)
    if (mark) {
      out.push({ ref: node, mark })
      return
    }
  }
  if (depth >= LAYER_DEPTH) return
  const resources = ctx.lookupMaybe(stream.dict.get(PDFName.of('Resources')), PDFDict)
  const xobjects = resources && ctx.lookupMaybe(resources.get(PDFName.of('XObject')), PDFDict)
  if (!xobjects) return
  for (const [, child] of xobjects.entries()) collect(ctx, child, depth + 1, seen, out)
}

/** The widgets that draw a signature field's box: the field itself when merged, else its unnamed kids. */
function boxWidgets(field: PDFDict, needs: 'AP' | 'Rect'): PDFDict[] {
  const widgets: PDFDict[] = []
  if (field.has(PDFName.of(needs))) widgets.push(field)
  const kids = field.lookupMaybe(PDFName.of('Kids'), PDFArray)
  if (kids) {
    for (let i = 0; i < kids.size(); i++) {
      const kid = kids.lookupMaybe(i, PDFDict)
      if (kid && !kid.has(PDFName.of('T'))) widgets.push(kid)
    }
  }
  return widgets
}

/**
 * The validity layers of a signature field's box. The widget is the field itself when the two
 * are merged, otherwise the field's kids that carry no name of their own.
 */
export function findValidityLayers(field: PDFDict): ValidityLayer[] {
  const ctx = field.context
  const layers: ValidityLayer[] = []
  const seen = new Set<PDFRef>()
  for (const widget of boxWidgets(field, 'AP')) {
    const ap = ctx.lookupMaybe(widget.get(PDFName.of('AP')), PDFDict)
    collect(ctx, ap?.get(PDFName.of('N')), 0, seen, layers)
  }
  return layers
}
// ── drawing ──────────────────────────────────────────────────────────────

const MARKERS: Record<Verdict, string> = {
  valid: '% DSValid',
  invalid: '% DSInvalid',
  unknown: '% DSUnknown',
}

/** The tick as one outline: two bold arms with square ends, on a 100 x 100 square */
const TICK = '0.89 39.37 m 43.67 -3.9 l 102.81 88.2 l 85.99 99 l 40.34 27.91 l 15.11 53.43 l h'
/**
 * The cross as one outline, traced from the standard red cross: two crossing bars with square
 * ends, 12 corners, on the same 100 x 100 square.
 */
const CROSS =
  '50 64.59 m 70.94 87.41 l 81.92 76.15 l 62.28 50.72 l 84.81 22.12 l 71.52 9.41 l 50 35.41 l 28.48 9.41 l 15.19 22.12 l 37.72 50.72 l 18.08 76.15 l 29.06 87.41 l h'

/**
 * The standard "not checked" question mark, exactly as signing software draws it in its own
 * validity layer: pale yellow with a hairline border and a black shadow 2.6 units to the lower
 * right. Used where a box has no layer of its own to carry one.
 */
const QUESTION_MARK =
  'q 0.1 0 0 0.1 9 0 cm 0 J 0 j 4 M [] 0 d 1 i 0 g ' +
  '313 292 m 313 404 325 453 432 529 c 478 561 504 597 504 645 c 504 736 440 760 391 760 c 286 760 271 681 265 626 c 265 625 l 100 625 l 100 828 253 898 381 898 c 451 898 679 878 679 650 c 679 555 628 499 538 435 c 488 399 467 376 467 292 c 313 292 l h 308 214 170 -164 re f ' +
  '0.44 G 1.2 w 1 1 0.4 rg ' +
  '287 318 m 287 430 299 479 406 555 c 451 587 478 623 478 671 c 478 762 414 786 365 786 c 260 786 245 707 239 652 c 239 651 l 74 651 l 74 854 227 924 355 924 c 425 924 653 904 653 676 c 653 581 602 525 512 461 c 462 425 441 402 441 318 c 287 318 l h 282 240 170 -164 re B Q'
/**
 * The tick: a filled shape with a black border on every edge and a black shadow to its lower right.
 * The shadow offset is in the shape's own units, before the tick is scaled into its box.
 */
const solid = (path: string, rgb: string, shadow: number): string =>
  `0 J 0 j q 1 0 0 1 ${shadow} ${-shadow} cm 0 g ${path} f Q ${rgb} rg 0 G 4.5 w ${path} B`

/**
 * The three standard marks on a 100 x 100 square, in the style every reader uses: a bold colour
 * with a black outline and a black shadow. A green tick, a red cross, and a pale yellow question mark.
 */
function glyph(verdict: Verdict): string {
  switch (verdict) {
    case 'valid':
      return `q 0.88 0 0 0.88 1.9 10.6 cm ${solid(TICK, '0 0.70 0.25', 5.1)} Q`
    case 'invalid':
      // pure red, a thin black border all round, and a black shadow 2 units to the lower right
      return (
        '0 J 0 j ' +
        `q 1 0 0 1 2 -2 cm 0 g 0 G 1.8 w ${CROSS} B Q ` +
        `0 G 1.8 w ${CROSS} S 1 0 0 rg ${CROSS} f`
      )
    case 'unknown':
      return QUESTION_MARK
  }
}
/** The mark at its natural proportions, centred in `bbox` (PDF user space of the box it goes in) */
export function placedMark(
  verdict: Verdict,
  bbox: readonly [number, number, number, number],
): string {
  const w = Math.abs(bbox[2] - bbox[0])
  const h = Math.abs(bbox[3] - bbox[1])
  const s = Math.min(w, h) / 100
  const x = Math.min(bbox[0], bbox[2]) + (w - 100 * s) / 2
  const y = Math.min(bbox[1], bbox[3]) + (h - 100 * s) / 2
  return `q ${s} 0 0 ${s} ${x} ${y} cm\n${glyph(verdict)}\nQ\n`
}

/**
 * The content of a validity layer drawing `verdict` in the layer's own box. The first line is the
 * marker comment, so the layer reads as the verdict it now shows.
 */
export function markContent(
  verdict: Verdict,
  bbox: readonly [number, number, number, number],
): string {
  return `${MARKERS[verdict]}\n${placedMark(verdict, bbox)}`
}
const numbers = (ctx: PDFContext, dict: PDFDict, key: string): number[] | null => {
  const array = ctx.lookupMaybe(dict.get(PDFName.of(key)), PDFArray)
  if (!array) return null
  const out: number[] = []
  for (let i = 0; i < array.size(); i++) {
    const n = ctx.lookupMaybe(array.get(i), PDFNumber)
    if (!n) return null
    out.push(n.asNumber())
  }
  return out
}

/**
 * `content` (a caption layer: one font, one text position, "(Signature Not Verified)") with `text`
 * in place of the signer's words. A caption with an address after its name (`... <a@b>`) goes on
 * two lines, and the font shrinks so the longest line fits the layer's width.
 */
export function captionContent(
  content: string,
  text: string,
  bbox: readonly number[] | null,
): string | null {
  if (!content.includes(NOT_VERIFIED) || !bbox || bbox.length !== 4) return null
  const tf = content.indexOf(' Tf')
  if (tf < 0) return null
  const before = content.slice(0, tf).trimEnd().split(/\s+/)
  const size = Number(before[before.length - 1])
  const font = before[before.length - 2]
  if (!Number.isFinite(size) || !font?.startsWith('/')) return null
  const [a, b, c, d] = bbox as [number, number, number, number]
  const x0 = Math.min(a, c)
  const x1 = Math.max(a, c)
  const y0 = Math.min(b, d)
  const y1 = Math.max(b, d)
  const split = text.indexOf(' <')
  const lines = split >= 0 ? [text.slice(0, split), text.slice(split + 1)] : [text]
  const longest = Math.max(1, ...lines.map((l) => [...l].length))
  // Helvetica averages about 0.6 em per character in capitals and lower case mixed
  const fitted = Math.max(3, Math.min((x1 - x0 - 4) / (longest * 0.6), size))
  const escape = (line: string): string =>
    [...line]
      .map((ch) =>
        ch === '(' || ch === ')' || ch === '\\' ? `\\${ch}` : ch >= ' ' && ch <= '~' ? ch : '?',
      )
      .join('')
  let out = 'BT\n'
  lines.forEach((line, i) => {
    const y = Math.max(y1 - fitted * (i + 1), y0)
    out += `${font} ${fitted.toFixed(2)} Tf 1 0 0 1 2 ${y.toFixed(2)} Tm (${escape(line)}) Tj\n`
  })
  return `${out}ET\n`
}

/** A signature field to redraw, and the words to put in its caption when it earns them */
export interface FieldVerdict {
  field: PDFDict
  verdict: Verdict
  /** the caption for a signature that verifies (e.g. "Document certified by NAME <email>."), or undefined */
  caption?: string
}

/**
 * Show each field's verdict in its box. A box with validity layers has them redrawn: the tick or
 * cross replaces the signer's guess in its own layer, under the signer's text. The signer's own
 * question mark is the standard "not checked" mark, so it is left exactly as signed. A box with
 * no layer of its own gets the mark underneath its appearance, so every box shows one mark, in
 * the same style, beneath the text. Returns whether anything was drawn.
 */
export function applyVerdicts(ctx: PDFContext, fields: readonly FieldVerdict[]): boolean {
  const done = new Set<PDFRef>()
  let changed = false
  for (const { field, verdict, caption } of fields) {
    const layers = findValidityLayers(field)
    if (layers.length === 0) {
      if (putMarkUnderAppearance(ctx, field, verdict)) changed = true
      continue
    }
    for (const { ref, mark } of layers) {
      if (done.has(ref)) continue
      const stream = ctx.lookup(ref)
      if (!(stream instanceof PDFRawStream)) continue
      const bbox = numbers(ctx, stream.dict, 'BBox')
      if (mark === 'caption') {
        if (!caption) continue
        const content = decoded(stream)
        const replaced = content === null ? null : captionContent(content, caption, bbox)
        if (replaced === null) continue
        const dict = stream.dict.clone(ctx)
        ctx.assign(ref, ctx.flateStream(replaced, dictEntries(dict)))
      } else {
        if (verdict === 'unknown') continue // the signer's own question mark stands
        const box: [number, number, number, number] =
          bbox && bbox.length === 4 ? [bbox[0]!, bbox[1]!, bbox[2]!, bbox[3]!] : [0, 0, 100, 100]
        const entries = dictEntries(stream.dict)
        entries.Resources = ctx.obj({}) as PDFDict
        ctx.assign(ref, ctx.flateStream(markContent(verdict, box), entries))
      }
      done.add(ref)
      changed = true
    }
  }
  return changed
}

/**
 * A box with no validity layer: its mark goes first in the appearance, so the signer's own text
 * and artwork draw on top of it. A box with no appearance at all gets one that holds the mark.
 * An invisible signature has no box and is left alone.
 */
function putMarkUnderAppearance(ctx: PDFContext, field: PDFDict, verdict: Verdict): boolean {
  let changed = false
  for (const widget of boxWidgets(field, 'Rect')) {
    const rect = numbers(ctx, widget, 'Rect')
    if (!rect || rect.length !== 4) continue
    const w = Math.abs(rect[2]! - rect[0]!)
    const h = Math.abs(rect[3]! - rect[1]!)
    if (w < 4 || h < 4) continue
    const ap = ctx.lookupMaybe(widget.get(PDFName.of('AP')), PDFDict)
    const normalRef = ap?.get(PDFName.of('N'))
    const normal = normalRef ? ctx.lookup(normalRef) : undefined
    if (normalRef instanceof PDFRef && normal instanceof PDFRawStream) {
      const existing = decoded(normal)
      if (existing === null) continue
      const bbox = numbers(ctx, normal.dict, 'BBox')
      const box: [number, number, number, number] =
        bbox && bbox.length === 4 ? [bbox[0]!, bbox[1]!, bbox[2]!, bbox[3]!] : [0, 0, w, h]
      ctx.assign(
        normalRef,
        ctx.flateStream(placedMark(verdict, box) + existing, dictEntries(normal.dict)),
      )
      changed = true
    } else if (!ap) {
      const stream = ctx.register(
        ctx.flateStream(placedMark(verdict, [0, 0, w, h]), {
          Type: 'XObject',
          Subtype: 'Form',
          BBox: [0, 0, w, h],
        }),
      )
      widget.set(PDFName.of('AP'), ctx.obj({ N: stream }))
      changed = true
    }
  }
  return changed
}
/** The entries of a stream dictionary a rewritten stream keeps (its box, matrix and kind), minus those the new stream sets itself */
function dictEntries(dict: PDFDict): Record<string, PDFObject> {
  const keep: Record<string, PDFObject> = {}
  for (const [key, value] of dict.entries()) {
    const name = key.decodeText()
    if (name === 'Length' || name === 'Filter' || name === 'DecodeParms') continue
    keep[name] = value
  }
  return keep
}
