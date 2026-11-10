// @vitest-environment node
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
  decodePDFRawStream,
  type PDFContext,
} from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import {
  applyVerdicts,
  captionContent,
  findValidityLayers,
  markContent,
} from '../src/main/validity-layers'

function formStream(ctx: PDFContext, content: string, extra: Record<string, unknown> = {}): PDFRef {
  return ctx.register(
    ctx.flateStream(content, {
      Type: 'XObject',
      Subtype: 'Form',
      BBox: [0, 0, 100, 100],
      Matrix: [1, 0, 0, 1, 0, 0],
      ...extra,
    }),
  )
}

/**
 * A signature box laid out the way Adobe does: AP/N draws /FRM, which draws five layers: a blank
 * background (n0), the guessed verdict mark (n1), the signer's text (n2), a second blank (n3) and
 * the "Signature Not Verified" caption (n4).
 */
function layeredBox(
  doc: PDFDocument,
  guess = '% DSUnknown\nq 0 g 10 10 80 80 re f Q\n',
  withCaption = true,
): { widget: PDFDict; refs: Record<string, PDFRef> } {
  const ctx = doc.context
  const refs = {
    n0: formStream(ctx, '% DSBlank\n'),
    n1: formStream(ctx, guess),
    n2: formStream(ctx, 'BT /F1 7 Tf 1 0 0 1 8 63 Tm (Signed by Someone) Tj ET\n', {
      BBox: [0, 0, 150, 70],
    }),
    n3: formStream(ctx, '% DSBlank\n'),
    n4: formStream(ctx, 'BT /F1 7 Tf 1 0 0 1 2 60 Tm (\\(Signature Not Verified\\)) Tj ET\n', {
      BBox: [0, 0, 150, 70],
    }),
  }
  // the caption's content must contain the exact words, with plain parentheses, to be found
  refs.n4 = formStream(ctx, 'BT /F1 7 Tf 1 0 0 1 2 60 Tm ((Signature Not Verified)) Tj ET\n', {
    BBox: [0, 0, 150, 70],
  })
  const layers: Record<string, unknown> = { n0: refs.n0, n1: refs.n1, n2: refs.n2, n3: refs.n3 }
  if (withCaption) layers.n4 = refs.n4
  const frm = formStream(ctx, 'q /n0 Do Q q /n1 Do Q q /n2 Do Q q /n3 Do Q q /n4 Do Q\n', {
    BBox: [0, 0, 150, 70],
    Resources: { XObject: layers },
  })
  const ap = formStream(ctx, 'q /FRM Do Q\n', {
    BBox: [0, 0, 150, 70],
    Resources: { XObject: { FRM: frm } },
  })
  const widget = ctx.obj({
    Type: 'Annot',
    Subtype: 'Widget',
    FT: 'Sig',
    Rect: [0, 0, 150, 70],
    AP: { N: ap },
  }) as PDFDict
  return { widget, refs }
}

const contentOf = (ctx: PDFContext, ref: PDFRef): string => {
  const stream = ctx.lookup(ref) as PDFRawStream
  return Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1')
}

describe('findValidityLayers', () => {
  it("finds the guessed mark and the caption, and ignores blanks and the signer's text", async () => {
    const doc = await PDFDocument.create()
    const { widget, refs } = layeredBox(doc)
    const found = findValidityLayers(widget)
    expect(found.map((l) => [l.ref, l.mark])).toEqual(
      expect.arrayContaining([
        [refs.n1, 'unknown'],
        [refs.n4, 'caption'],
      ]),
    )
    expect(found).toHaveLength(2)
  })

  it('reads the verdict a layer stands for from its marker', async () => {
    for (const [marker, mark] of [
      ['% DSValid', 'valid'],
      ['% DSInvalid', 'invalid'],
      ['% DSUnknown', 'unknown'],
    ] as const) {
      const doc = await PDFDocument.create()
      const { widget } = layeredBox(doc, `${marker}\nq Q\n`, false)
      expect(findValidityLayers(widget).map((l) => l.mark)).toEqual([mark])
    }
  })

  it('finds layers on the kids of a field whose widgets are separate', async () => {
    const doc = await PDFDocument.create()
    const { widget } = layeredBox(doc, '% DSUnknown\nq Q\n', false)
    const field = doc.context.obj({
      FT: 'Sig',
      T: 'Signature1',
      Kids: [doc.context.register(widget)],
    }) as PDFDict
    expect(findValidityLayers(field)).toHaveLength(1)
  })

  it('finds nothing in a box with no marker layers, or none at all', async () => {
    const doc = await PDFDocument.create()
    const plain = doc.context.obj({ FT: 'Sig' }) as PDFDict
    expect(findValidityLayers(plain)).toEqual([])
    const { widget } = layeredBox(doc, 'q Q\n', false)
    expect(findValidityLayers(widget)).toEqual([])
  })
})

describe('markContent', () => {
  it('opens with the marker comment of its verdict and keeps the mark in proportion', () => {
    for (const [verdict, marker] of [
      ['valid', '% DSValid'],
      ['invalid', '% DSInvalid'],
      ['unknown', '% DSUnknown'],
    ] as const) {
      expect(markContent(verdict, [0, 0, 100, 100]).startsWith(`${marker}\n`)).toBe(true)
    }
    // a wide box: the mark is centred at its natural proportions, not stretched to the width
    expect(markContent('valid', [10, 20, 310, 120])).toContain('q 1 0 0 1 110 20 cm')
  })

  it('draws a bordered tick, a bordered cross, or a question mark, each with a shadow', () => {
    const tick = markContent('valid', [0, 0, 100, 100])
    expect(tick).toContain('0.89 39.37 m 43.67 -3.9 l 102.81 88.2 l')
    expect(tick).toContain('0 0.70 0.25 rg') // green fill
    expect(tick).toContain('0 G 4.5 w') // black border all round
    expect(tick).toContain('1 0 0 1 5.25 -5.25 cm') // shadow to the lower right
    const cross = markContent('invalid', [0, 0, 100, 100])
    expect(cross).toContain('14.93 70.93 m 29.07 85.07 l 50 64.14 l')
    expect(cross).toContain('0.88 0.07 0.07 rg') // red fill
    const unknown = markContent('unknown', [0, 0, 100, 100])
    expect(unknown).toContain('1 0.80 0 RG') // yellow
    expect(unknown).not.toContain('Tj') // drawn as shapes: no font needed
  })
})

describe('applyVerdicts', () => {
  it('draws the tick or the cross in the layer of the signer\'s guess, once', async () => {
    for (const verdict of ['valid', 'invalid'] as const) {
      const doc = await PDFDocument.create()
      const { widget, refs } = layeredBox(doc)
      expect(applyVerdicts(doc.context, [{ field: widget, verdict }])).toBe(true)
      const content = contentOf(doc.context, refs.n1)
      expect(content.startsWith(verdict === 'valid' ? '% DSValid' : '% DSInvalid')).toBe(true)
      // the signer's text and the blanks are untouched
      expect(contentOf(doc.context, refs.n2)).toContain('(Signed by Someone)')
      expect(contentOf(doc.context, refs.n0)).toBe('% DSBlank\n')
    }
  })

  it("leaves the signer's own question mark exactly as signed", async () => {
    const doc = await PDFDocument.create()
    const { widget, refs } = layeredBox(doc)
    const before = contentOf(doc.context, refs.n1)
    expect(applyVerdicts(doc.context, [{ field: widget, verdict: 'unknown' }])).toBe(false)
    expect(contentOf(doc.context, refs.n1)).toBe(before)
  })

  it('draws the mark in the layer box it was given, with no resources of its own to carry', async () => {
    const doc = await PDFDocument.create()
    const { widget, refs } = layeredBox(doc)
    applyVerdicts(doc.context, [{ field: widget, verdict: 'invalid' }])
    const layer = doc.context.lookup(refs.n1) as PDFRawStream
    expect(layer.dict.get(PDFName.of('Subtype'))?.toString()).toBe('/Form')
    expect((layer.dict.get(PDFName.of('BBox')) as PDFArray).size()).toBe(4)
    const resources = layer.dict.lookup(PDFName.of('Resources'), PDFDict)
    expect(resources.has(PDFName.of('ExtGState'))).toBe(false)
    expect(resources.has(PDFName.of('Font'))).toBe(false)
  })

  it('survives a save and reload with the new mark in place', async () => {
    const doc = await PDFDocument.create()
    const { widget, refs } = layeredBox(doc)
    doc.addPage().node.set(PDFName.of('Annots'), doc.context.obj([doc.context.register(widget)]))
    applyVerdicts(doc.context, [{ field: widget, verdict: 'valid' }])
    const reloaded = await PDFDocument.load(await doc.save({ useObjectStreams: false }))
    expect(contentOf(reloaded.context, refs.n1).startsWith('% DSValid')).toBe(true)
  })

  it('writes a certifying caption in place of the signer\'s "Not Verified", only when given one', async () => {
    const doc = await PDFDocument.create()
    const { widget, refs } = layeredBox(doc)
    applyVerdicts(doc.context, [{ field: widget, verdict: 'unknown' }])
    expect(contentOf(doc.context, refs.n4)).toContain('(Signature Not Verified)')

    applyVerdicts(doc.context, [
      {
        field: widget,
        verdict: 'valid',
        caption: 'Document certified by Alice <alice@example.org>.',
      },
    ])
    const caption = contentOf(doc.context, refs.n4)
    expect(caption).not.toContain('Not Verified')
    expect(caption).toContain('(Document certified by Alice)')
    expect(caption).toContain('(<alice@example.org>.)')
  })

  describe('a box with no validity layer of its own', () => {
    /** A box whose appearance is the signer's artwork and text, with no marker layers */
    function plainBox(doc: PDFDocument, withAppearance = true) {
      const ctx = doc.context
      const ap = formStream(ctx, 'BT /F1 7 Tf 1 0 0 1 8 63 Tm (Signed by Someone) Tj ET\n', {
        BBox: [0, 0, 150, 70],
      })
      const widget = ctx.obj({
        Type: 'Annot',
        Subtype: 'Widget',
        FT: 'Sig',
        Rect: [20, 30, 170, 100],
        ...(withAppearance ? { AP: { N: ap } } : {}),
      }) as PDFDict
      return { widget, ap }
    }

    it('puts the mark first in its appearance, so the signer\'s text draws on top', async () => {
      const doc = await PDFDocument.create()
      const { widget, ap } = plainBox(doc)
      expect(applyVerdicts(doc.context, [{ field: widget, verdict: 'valid' }])).toBe(true)
      const content = contentOf(doc.context, ap)
      expect(content.indexOf('0.89 39.37 m')).toBeGreaterThanOrEqual(0)
      expect(content.indexOf('0.89 39.37 m')).toBeLessThan(content.indexOf('(Signed by Someone)'))
    })

    it('draws a question mark too, since nothing in the file stands for it', async () => {
      const doc = await PDFDocument.create()
      const { widget, ap } = plainBox(doc)
      expect(applyVerdicts(doc.context, [{ field: widget, verdict: 'unknown' }])).toBe(true)
      expect(contentOf(doc.context, ap)).toContain('1 0.80 0 RG')
    })

    it('gives a box with no appearance at all one that holds the mark', async () => {
      const doc = await PDFDocument.create()
      const { widget } = plainBox(doc, false)
      expect(applyVerdicts(doc.context, [{ field: widget, verdict: 'invalid' }])).toBe(true)
      const ap = widget.lookup(PDFName.of('AP'), PDFDict)
      const normal = doc.context.lookup(ap.get(PDFName.of('N'))) as PDFRawStream
      expect(Buffer.from(decodePDFRawStream(normal).decode()).toString('latin1')).toContain(
        '14.93 70.93 m',
      )
    })

    it('leaves an invisible signature alone', async () => {
      const doc = await PDFDocument.create()
      const widget = doc.context.obj({ FT: 'Sig', Rect: [0, 0, 0, 0] }) as PDFDict
      expect(applyVerdicts(doc.context, [{ field: widget, verdict: 'valid' }])).toBe(false)
    })
  })
})
describe('captionContent', () => {
  const original = 'BT\n/F1 7 Tf 1 0 0 1 2 60 Tm ((Signature Not Verified)) Tj\nET\n'

  it("keeps the signer's font and replaces the words, name and address on two lines", () => {
    const out = captionContent(original, 'Document certified by Alice <a@b.org>.', [0, 0, 150, 70])!
    expect(out).toContain('/F1 ')
    expect(out).toContain('(Document certified by Alice)')
    expect(out).toContain('(<a@b.org>.)')
    expect(out.match(/Tj/g)).toHaveLength(2)
  })

  it('shrinks the font so the longest line fits the layer', () => {
    const out = captionContent(
      original,
      'Document certified by A Very Long Name Indeed Ltd.',
      [0, 0, 60, 70],
    )!
    const size = Number(/\/F1 ([\d.]+) Tf/.exec(out)![1])
    expect(size).toBeLessThan(7)
    expect(size).toBeGreaterThanOrEqual(3)
  })

  it('escapes parentheses and replaces characters it cannot write', () => {
    const out = captionContent(original, 'Document certified by A(B)\\C é.', [0, 0, 150, 70])!
    expect(out).toContain('A\\(B\\)\\\\C ?.')
  })

  it('returns null for a layer that is not a caption, or without a box', () => {
    expect(captionContent('BT (Hello) Tj ET', 'x', [0, 0, 150, 70])).toBeNull()
    expect(captionContent(original, 'x', null)).toBeNull()
  })
})
