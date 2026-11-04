import { PDFDocument } from 'pdf-lib'
import type { PdfSignatureInfo } from '../shared/ipc'
import { collectSignatureFields, readPdfSignatures } from './pdf-signatures'
import { applyVerdicts, type FieldVerdict, type Verdict } from './validity-layers'

/**
 * The verdict a box shows. Adobe has three marks and one at a time: a tick when the signature is
 * intact and the signer trusted, a cross when it does not verify, a question mark for everything
 * in between (intact but not trusted yet, changed after signing, an algorithm that cannot be
 * checked here).
 */
export function verdictOf(info: Pick<PdfSignatureInfo, 'status'>): Verdict {
  if (info.status === 'valid') return 'valid'
  if (info.status === 'invalid') return 'invalid'
  return 'unknown'
}

/**
 * The line a certifying signature that verifies writes in place of the signer's "Signature Not
 * Verified" caption, or undefined when the signature has no such claim to make.
 */
export function certifiedCaption(
  info: Pick<PdfSignatureInfo, 'status' | 'certifiedLevel' | 'signer' | 'signerName'>,
): string | undefined {
  const verifies = info.status === 'valid' || info.status === 'untrusted'
  const name = info.signer?.commonName ?? info.signerName
  if (!info.certifiedLevel || !verifies || !name) return undefined
  return info.signer?.email
    ? `Document certified by ${name} <${info.signer.email}>.`
    : `Document certified by ${name}.`
}

/**
 * The copy of a signed PDF to DISPLAY or PRINT: each signature box's own verdict mark (and
 * certified caption) drawn in place of the guess the signer baked in. The file on disk is never
 * changed. Returns null when there is nothing to redraw (no signatures, none with a mark layer,
 * a protected or unreadable file), in which case the original is shown as it is.
 */
export async function signatureDisplayCopy(
  bytes: Uint8Array,
  userTrusted: ReadonlySet<string> = new Set(),
): Promise<Uint8Array | null> {
  const infos = await readPdfSignatures(bytes, userTrusted)
  if (!infos.some((info) => info.validityLayer)) return null
  let pdf: PDFDocument
  try {
    pdf = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: false })
  } catch {
    return null
  }
  const fields: FieldVerdict[] = []
  for (const field of collectSignatureFields(pdf)) {
    const info = infos.find((candidate) => candidate.fieldName === field.name)
    if (!info || info.kind !== 'signature') continue
    fields.push({ field: field.widget, verdict: verdictOf(info), caption: certifiedCaption(info) })
  }
  if (!applyVerdicts(pdf.context, fields)) return null
  return pdf.save({ useObjectStreams: false })
}
