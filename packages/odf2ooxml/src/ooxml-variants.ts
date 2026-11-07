/**
 * Macro-enabled / template / slideshow OOXML variants (.docm .dotx .dotm,
 * .pptm .ppsx .ppsm .potx .potm) differ from .docx/.pptx only in the main
 * part's content type (plus an optional VBA project). Rewrite the content
 * type to the plain document type and drop any VBA payload; macros are never
 * kept or executed. Anything else in the package is copied untouched.
 */
import JSZip from 'jszip'

const WORD_MAIN = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'
const EXCEL_MAIN = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'
const PPT_MAIN = 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml'

const WORD_VARIANTS = [
  'application/vnd.ms-word.document.macroEnabled.main+xml',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml',
  'application/vnd.ms-word.template.macroEnabledTemplate.main+xml',
]
const EXCEL_VARIANTS = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml',
  'application/vnd.ms-excel.template.macroEnabled.main+xml',
  'application/vnd.ms-excel.addin.macroEnabled.main+xml',
]
const PPT_VARIANTS = [
  'application/vnd.openxmlformats-officedocument.presentationml.slideshow.main+xml',
  'application/vnd.ms-powerpoint.presentation.macroEnabled.main+xml',
  'application/vnd.openxmlformats-officedocument.presentationml.template.main+xml',
  'application/vnd.ms-powerpoint.template.macroEnabled.main+xml',
  'application/vnd.ms-powerpoint.slideshow.macroEnabled.main+xml',
]

const VBA_PART_RE = /(^|\/)(vbaProject\.bin|vbaData\.xml|vbaProjectSignature\.bin)$/i
const VBA_CONTENT_TYPES = [
  'application/vnd.ms-office.vbaProject',
  'application/vnd.ms-office.vbaProjectSignature',
  'application/vnd.ms-word.vbaData+xml',
]

export type OoxmlFamily = 'word' | 'powerpoint' | 'excel'

function stripVbaRelationships(xml: string): string {
  return xml.replace(/<Relationship\b[^>]*\/>/g, (rel) =>
    /Type="[^"]*\/(vbaProject|vbaProjectSignature|wordVbaData)"/i.test(rel) ? '' : rel,
  )
}

export async function normalizeOoxmlVariant(
  source: Uint8Array,
  family: OoxmlFamily,
): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(source)
  const types = zip.file('[Content_Types].xml')
  if (!types) throw new Error('not an OOXML package')
  const target = family === 'word' ? WORD_MAIN : family === 'excel' ? EXCEL_MAIN : PPT_MAIN
  const variants =
    family === 'word' ? WORD_VARIANTS : family === 'excel' ? EXCEL_VARIANTS : PPT_VARIANTS
  let xml = await types.async('string')
  for (const variant of variants) xml = xml.split(variant).join(target)
  xml = xml.replace(/<(Override|Default)\b[^>]*\/>/g, (entry) =>
    VBA_CONTENT_TYPES.some((type) => entry.includes(`"${type}"`)) ? '' : entry,
  )
  zip.file('[Content_Types].xml', xml)
  for (const name of Object.keys(zip.files)) {
    if (VBA_PART_RE.test(name)) zip.remove(name)
    else if (name.endsWith('.rels')) {
      const rels = await zip.file(name)!.async('string')
      const cleaned = stripVbaRelationships(rels)
      if (cleaned !== rels) zip.file(name, cleaned)
    }
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

export const WORD_VARIANT_EXTENSIONS = ['docm', 'dotx', 'dotm'] as const
export const POWERPOINT_VARIANT_EXTENSIONS = ['pptm', 'ppsx', 'ppsm', 'potx', 'potm'] as const
export const EXCEL_VARIANT_EXTENSIONS = ['xltx', 'xltm', 'xlam'] as const
