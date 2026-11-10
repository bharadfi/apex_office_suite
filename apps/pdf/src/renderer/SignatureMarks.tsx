import type { ReactElement } from 'react'
import type { PdfSignatureInfo } from '../shared/ipc'
import { pdfRectToCss } from './annotations'
import type { PageGeom } from './annotations'
import type { TFunc } from './i18n/locale'

/** What to draw on a page for one signature box: the line naming who certified the document */
export interface SignatureMark {
  /** the box on the page, PDF user space */
  rect: [number, number, number, number]
  certifiedBy: { name: string; email?: string }
}

/** Room (PDF units) the caption needs under the box; with less, it goes above the box instead */
const CAPTION_ROOM = 22

/**
 * The captions for one page. The verdict mark itself (tick, cross or question mark) is drawn in
 * the displayed and printed copy of the file, beneath the signer's text, so it is not drawn here.
 * A certifying signature whose content still verifies (valid, or intact but not yet trusted)
 * also says who certified the document; a box with its own validity layers gets that line in the
 * same copy instead.
 */
export function marksForPage(
  signatures: readonly PdfSignatureInfo[],
  pageIndex: number,
): SignatureMark[] {
  const marks: SignatureMark[] = []
  for (const sig of signatures) {
    if (sig.kind !== 'signature' || sig.pageIndex !== pageIndex || !sig.rect) continue
    if (sig.validityLayer) continue
    const verifies = sig.status === 'valid' || sig.status === 'untrusted'
    const name = sig.signer?.commonName ?? sig.signerName
    if (!sig.certifiedLevel || !verifies || !name) continue
    marks.push({
      rect: sig.rect,
      certifiedBy: { name, ...(sig.signer?.email ? { email: sig.signer.email } : {}) },
    })
  }
  return marks
}

/** The captions over the signature boxes of one page. Captions never take the pointer. */
export function SignatureMarks({
  marks,
  geom,
  scale,
  t,
}: {
  marks: readonly SignatureMark[]
  geom: PageGeom
  scale: number
  t: TFunc
}): ReactElement | null {
  if (marks.length === 0) return null
  return (
    <div className="pdf-sig-marks">
      {marks.map((mark, i) => {
        const box = pdfRectToCss(geom, mark.rect, scale)
        const roomBelow = mark.rect[1] >= CAPTION_ROOM
        const caption = mark.certifiedBy.email
          ? t('sigCertifiedByEmail', mark.certifiedBy)
          : t('sigCertifiedBy', { name: mark.certifiedBy.name })
        return (
          <div key={i} className="pdf-sig-mark-box" style={box}>
            <div
              className={`pdf-sig-caption ${roomBelow ? 'below' : 'above'}`}
              style={{ fontSize: Math.max(8, 10 * scale) }}
            >
              {caption}
            </div>
          </div>
        )
      })}
    </div>
  )
}