import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { DOC_OPTS } from './view-config'

export function loadPdfForView(bytes: Uint8Array, password?: string) {
  // PDF.js transfers its input to the worker; retain the source for the
  // encrypted-document IPC and metadata checks later in the open pipeline.
  return getDocument({ data: bytes.slice(), password, ...DOC_OPTS })
}

/** Whether a file may hold digital signatures: their /ByteRange entry is plain text in the file */
export function mayBeSigned(bytes: Uint8Array): boolean {
  const marker = [0x2f, 0x42, 0x79, 0x74, 0x65, 0x52, 0x61, 0x6e, 0x67, 0x65] // /ByteRange
  const last = bytes.length - marker.length
  for (let i = 0; i <= last; i++) {
    if (bytes[i] !== 0x2f) continue
    let j = 1
    while (j < marker.length && bytes[i + j] === marker[j]) j++
    if (j === marker.length) return true
  }
  return false
}

/**
 * The bytes to show for a file: for a signed one, the copy the main process redraws with each
 * signature box's own verdict mark (the file on disk is never changed); otherwise the file as it
 * is. Any failure falls back to the original, so a document always opens.
 */
export async function displayBytesFor(
  api: { signatureDisplayCopy(path: string): Promise<ArrayBuffer | null> },
  path: string,
  bytes: Uint8Array,
): Promise<Uint8Array> {
  if (!mayBeSigned(bytes)) return bytes
  try {
    const copy = await api.signatureDisplayCopy(path)
    return copy ? new Uint8Array(copy) : bytes
  } catch {
    return bytes
  }
}
