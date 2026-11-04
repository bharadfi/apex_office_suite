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

/**
 * The validity layers of a signature field's box. The widget is the field itself when the two
 * are merged, otherwise the field's kids that carry no name of their own.
 */
export function findValidityLayers(field: PDFDict): ValidityLayer[] {
  const ctx = field.context
  const widgets: PDFDict[] = []
  if (field.has(PDFName.of('AP'))) widgets.push(field)
  const kids = field.lookupMaybe(PDFName.of('Kids'), PDFArray)
  if (kids) {
    for (let i = 0; i < kids.size(); i++) {
      const kid = kids.lookupMaybe(i, PDFDict)
      if (kid && !kid.has(PDFName.of('T'))) widgets.push(kid)
    }
  }
  const layers: ValidityLayer[] = []
  const seen = new Set<PDFRef>()
  for (const widget of widgets) {
    const ap = ctx.lookupMaybe(widget.get(PDFName.of('AP')), PDFDict)
    collect(ctx, ap?.get(PDFName.of('N')), 0, seen, layers)
  }
  return layers
}

// ── drawing ──────────────────────────────────────────────────────────────

const GLYPHS: Record<Verdict, { marker: string; rgb: string; glyph: string }> = {
  valid: { marker: '% DSValid', rgb: '0.0 0.5 0.18', glyph: '9 w 30 50 m 45 34 l 72 68 l S' },
  invalid: {
    marker: '% DSInvalid',
    rgb: '0.75 0.1 0.1',
    glyph: '9 w 33 33 m 67 67 l S 33 67 m 67 33 l S',
  },
  unknown: {
    marker: '% DSUnknown',
    rgb: '0.75 0.38 0.0',
    glyph: 'BT /DSF 62 Tf 31 30 Td (?) Tj ET',
  },
}

/**
 * The content of a validity layer drawing `verdict` in the layer's own box (Adobe lays these out
 * on a 100 x 100 square): a translucent round badge holding a tick, a cross or a question mark,
 * so the signer's text stays readable through it. The first line is the marker comment, so the
 * layer reads as the verdict it now shows.
 */
export function markContent(
  verdict: Verdict,
  bbox: readonly [number, number, number, number],
): string {
  const { marker, rgb, glyph } = GLYPHS[verdict]
  const sx = Math.abs(bbox[2] - bbox[0]) / 100
  const sy = Math.abs(bbox[3] - bbox[1]) / 100
  const place = `q ${sx} 0 0 ${sy} ${Math.min(bbox[0], bbox[2])} ${Math.min(bbox[1], bbox[3])} cm 1 J 1 j`
  return [
    marker,
    place,
    `/DSA gs ${rgb} rg 94 50 m 94 74.3 74.3 94 50 94 c 25.7 94 6 74.3 6 50 c 6 25.7 25.7 6 50 6 c 74.3 6 94 25.7 94 50 c f`,
    `/DSB gs ${rgb} RG ${rgb} rg ${glyph}`,
    'Q',
  ]
    .map((line) => `${line}\n`)
    .join('')
}

/** The resources markContent needs: two transparency states, and a bold font for the question mark */
function markResources(ctx: PDFContext, verdict: Verdict): PDFDict {
  const state = (alpha: number) => ({ Type: 'ExtGState', ca: alpha, CA: alpha })
  return ctx.obj({
    ExtGState: { DSA: state(0.28), DSB: state(1) },
    ...(verdict === 'unknown'
      ? { Font: { DSF: { Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica-Bold' } } }
      : {}),
  }) as PDFDict
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
 * Redraw the validity layers of each field's box to show its verdict. Every validity layer is
 * redrawn, even one that already says the same: the signer's own artwork would otherwise show
 * a different style from the verdict's. Returns whether anything was drawn.
 */
export function applyVerdicts(ctx: PDFContext, fields: readonly FieldVerdict[]): boolean {
  const done = new Set<PDFRef>()
  let changed = false
  for (const { field, verdict, caption } of fields) {
    for (const { ref, mark } of findValidityLayers(field)) {
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
        const box: [number, number, number, number] =
          bbox && bbox.length === 4 ? [bbox[0]!, bbox[1]!, bbox[2]!, bbox[3]!] : [0, 0, 100, 100]
        const entries = dictEntries(stream.dict)
        entries.Resources = markResources(ctx, verdict)
        ctx.assign(ref, ctx.flateStream(markContent(verdict, box), entries))
      }
      done.add(ref)
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
