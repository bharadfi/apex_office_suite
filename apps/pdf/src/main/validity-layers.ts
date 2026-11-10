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
/** The cross as one outline: two crossing bars, 12 corners */
const CROSS =
  '14.93 70.93 m 29.07 85.07 l 50 64.14 l 70.93 85.07 l 85.07 70.93 l 64.14 50 l 85.07 29.07 l 70.93 14.93 l 50 35.86 l 29.07 14.93 l 14.93 29.07 l 35.86 50 l h'
const HOOK = '32 70 m 32 90 68 90 68 70 c 68 55 50 52 50 38 c'
const DOT_OUTER =
  '61 14 m 61 20.07 55.07 25 50 25 c 44.93 25 39 20.07 39 14 c 39 7.93 44.93 3 50 3 c 55.07 3 61 7.93 61 14 c f'
const DOT_INNER =
  '57.5 14 m 57.5 18.14 54.14 21.5 50 21.5 c 45.86 21.5 42.5 18.14 42.5 14 c 42.5 9.86 45.86 6.5 50 6.5 c 54.14 6.5 57.5 9.86 57.5 14 c f'

/** A filled shape with a black border on every edge and a black shadow to its lower right */
const solid = (path: string, rgb: string): string =>
  `0 J 0 j q 1 0 0 1 5.6 -5.6 cm 0 g 0 G 4.5 w ${path} B Q ${rgb} rg 0 G 4.5 w ${path} B`

/**
 * The three standard marks on a 100 x 100 square, in the style every reader uses: a bold colour
 * with a black outline and a black shadow. A green tick, a red cross, and a yellow question mark.
 */
function glyph(verdict: Verdict): string {
  switch (verdict) {
    case 'valid':
      return `q 0.88 0 0 0.88 1.9 10.6 cm ${solid(TICK, '0 0.70 0.25')} Q`
    case 'invalid':
      return `q 1.15 0 0 1.15 -10.6 -4.3 cm ${solid(CROSS, '0.88 0.07 0.07')} Q`
    case 'unknown':
      return (
        'q 0.92 0 0 0.92 4 6 cm 1 J 1 j ' +
        `q 1 0 0 1 5 -5 cm 0 G 0 g 20 w ${HOOK} S ${DOT_OUTER} Q ` +
        `0.15 0.12 0 RG 20 w ${HOOK} S 1 0.80 0 RG 12 w ${HOOK} S ` +
        `0.15 0.12 0 rg ${DOT_OUTER} 1 0.80 0 rg ${DOT_INNER} Q`
      )
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
