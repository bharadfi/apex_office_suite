import type { ReactElement } from 'react'
import type { PdfSignatureInfo } from '../shared/ipc'
import { pdfRectToCss } from './annotations'
import type { PageGeom } from './annotations'
import type { TFunc } from './i18n/locale'

/** What to draw on a page for one signature box */
export interface SignatureMark {
  status: PdfSignatureInfo['status']
  /** the box on the page, PDF user space */
  rect: [number, number, number, number]
  /** set for a certifying signature that verifies: who certified the document */
  certifiedBy?: { name: string; email?: string }
}

/** Room (PDF units) the caption needs under the box; with less, it goes above the box instead */
const CAPTION_ROOM = 22

/**
 * The marks for one page: a visible signature gets its verdict drawn on it. Invisible
 * signatures and time stamps have no box to mark. A certifying signature whose content still
 * verifies (valid, or intact but not yet trusted) also says who certified the document.
 */
export function marksForPage(
  signatures: readonly PdfSignatureInfo[],
  pageIndex: number,
): SignatureMark[] {
  const marks: SignatureMark[] = []
  for (const sig of signatures) {
    if (sig.kind !== 'signature' || sig.pageIndex !== pageIndex || !sig.rect) continue
    const verifies = sig.status === 'valid' || sig.status === 'untrusted'
    const name = sig.signer?.commonName ?? sig.signerName
    marks.push({
      status: sig.status,
      rect: sig.rect,
      ...(sig.certifiedLevel && verifies && name
        ? {
            certifiedBy: {
              name,
              ...(sig.signer?.email ? { email: sig.signer.email } : {}),
            },
          }
        : {}),
    })
  }
  return marks
}

const STATUS_KEYS = {
  valid: 'sigStatusValid',
  untrusted: 'sigStatusUntrusted',
  warning: 'sigStatusWarning',
  invalid: 'sigStatusInvalid',
} as const

/** The glyph of each verdict, in a 24-unit square: tick, question mark, exclamation mark, cross */
function Glyph({ status }: { status: SignatureMark['status'] }): ReactElement {
  switch (status) {
    case 'valid':
      return <path d="M6.5 12.8 L10.4 16.6 L17.6 7.6" />
    case 'untrusted':
      return (
        <>
          <path d="M9.3 9.4 C9.5 7.5 10.7 6.6 12.1 6.6 C13.7 6.6 14.8 7.6 14.8 9 C14.8 10.3 13.9 10.9 13.1 11.5 C12.4 12 12 12.5 12 13.6" />
          <circle cx="12" cy="17.2" r="0.9" fill="currentColor" />
        </>
      )
    case 'warning':
      return (
        <>
          <path d="M12 6.8 L12 13.2" />
          <circle cx="12" cy="17.2" r="0.9" fill="currentColor" />
        </>
      )
    case 'invalid':
      return <path d="M8 8 L16 16 M16 8 L8 16" />
  }
}

/**
 * Verdict marks over the signature boxes of one page: a round badge with a tick, a question
 * mark, an exclamation mark or a cross. The badge is drawn with a multiply blend, so the
 * signer's dark text stays fully readable through it, as if the badge were behind the text.
 * Marks never take the pointer: the signature field underneath keeps working.
 */
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
        const caption = mark.certifiedBy
          ? mark.certifiedBy.email
            ? t('sigCertifiedByEmail', mark.certifiedBy)
            : t('sigCertifiedBy', { name: mark.certifiedBy.name })
          : null
        return (
          <div key={i} className="pdf-sig-mark-box" style={box}>
            <div
              className={`pdf-sig-mark ${mark.status}`}
              role="img"
              aria-label={t(STATUS_KEYS[mark.status])}
              data-tip={t(STATUS_KEYS[mark.status])}
            >
              <svg viewBox="0 0 24 24" aria-hidden>
                <circle cx="12" cy="12" r="11" className="pdf-sig-mark-disc" />
                <g
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <Glyph status={mark.status} />
                </g>
              </svg>
            </div>
            {caption && (
              <div
                className={`pdf-sig-caption ${roomBelow ? 'below' : 'above'}`}
                style={{ fontSize: Math.max(8, 10 * scale) }}
              >
                {caption}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
