import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber } from 'pdf-lib'
import type { PdfSecurityInfo } from '../shared/ipc'
import { permissionsFromP } from './pdf-crypt'
import { inspectHidden } from './pdf-sanitize'

/**
 * Security properties: what protects the file and what it can do, read from its own dictionaries
 * (the encryption dictionary, the form's signature fields, the catalog) and reported as found.
 */

const N = (name: string) => PDFName.of(name)

const lookup = (doc: PDFDocument, value: unknown) => doc.context.lookup(value as never)
const dictOf = (doc: PDFDocument, value: unknown): PDFDict | undefined => {
  const v = lookup(doc, value)
  return v instanceof PDFDict ? v : undefined
}
const numberOf = (doc: PDFDocument, value: unknown): number | undefined => {
  const v = lookup(doc, value)
  return v instanceof PDFNumber ? v.asNumber() : undefined
}
const nameOf = (doc: PDFDocument, value: unknown): string | undefined => {
  const v = lookup(doc, value)
  return v instanceof PDFName ? v.decodeText() : undefined
}

/** How the standard security handler encrypts, from its version and crypt filter. Unknown stays unknown. */
export function encryptionMethod(
  version: number | undefined,
  filterMethod: string | undefined,
  keyBits: number | undefined,
): string | null {
  if (version === 1) return 'RC4 40-bit'
  if (version === 2 || version === 3) return `RC4 ${keyBits ?? 128}-bit`
  if (version === 4) {
    if (filterMethod === 'AESV2') return 'AES 128-bit'
    if (filterMethod === 'V2') return 'RC4 128-bit'
    return null
  }
  if (version === 5) return filterMethod === 'AESV3' ? 'AES 256-bit' : null
  return null
}

export function readSecurity(doc: PDFDocument): PdfSecurityInfo {
  const encrypt = dictOf(doc, doc.context.trailerInfo.Encrypt)
  let encryption: PdfSecurityInfo['encryption'] = null
  if (encrypt) {
    const version = numberOf(doc, encrypt.get(N('V')))
    const cf = dictOf(doc, encrypt.get(N('CF')))
    const stmF = nameOf(doc, encrypt.get(N('StmF')))
    const filter = cf && stmF ? dictOf(doc, cf.get(N(stmF))) : undefined
    const p = numberOf(doc, encrypt.get(N('P'))) ?? 0
    encryption = {
      method: encryptionMethod(
        version,
        nameOf(doc, filter?.get(N('CFM'))),
        numberOf(doc, encrypt.get(N('Length'))),
      ),
      permissions: permissionsFromP(p),
    }
  }

  // signature fields that hold a signature, walking the field tree
  let signatures = 0
  const form = dictOf(doc, doc.catalog.get(N('AcroForm')))
  const fields = form ? lookup(doc, form.get(N('Fields'))) : undefined
  if (fields instanceof PDFArray) {
    const seen = new Set<PDFDict>()
    const stack: unknown[] = fields.asArray()
    while (stack.length > 0 && seen.size < 100_000) {
      const field = dictOf(doc, stack.pop())
      if (!field || seen.has(field)) continue
      seen.add(field)
      if (nameOf(doc, field.get(N('FT'))) === 'Sig' && field.get(N('V'))) signatures += 1
      const kids = lookup(doc, field.get(N('Kids')))
      if (kids instanceof PDFArray) stack.push(...kids.asArray())
    }
  }
  const perms = dictOf(doc, doc.catalog.get(N('Perms')))
  const hidden = inspectHidden(doc)
  return {
    encryption,
    signatures,
    certified: perms?.get(N('DocMDP')) !== undefined,
    scripts: hidden.scripts,
    attachments: hidden.attachments,
  }
}
