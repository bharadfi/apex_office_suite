/**
 * word/fontTable.xml for converted documents. The rebuild names each run's font
 * after the PDF's own (or a metric-compatible stand-in) but wrote no font table,
 * so a viewer without that font had no hint what kind of face it was and fell
 * back to its default serif: a sans-serif design came out in a Times-like face.
 * The table gives every font the family Word and LibreOffice substitute by
 * (swiss = sans-serif, roman = serif, modern = fixed pitch).
 */
import JSZip from 'jszip'

export type FontFamilyHint = 'roman' | 'swiss' | 'modern'

const FONT_TABLE_PATH = 'word/fontTable.xml'
const MAIN_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const FONT_TABLE_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml'
const FONT_TABLE_REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable'

const MONO = /mono|courier|consolas|menlo|typewriter|lucida console|fixed|\bcode\b/i
const SANS =
  /sans|grotesk|grotesque|gothic|helvet|arial|swiss|univers|frutiger|segoe|calibri|verdana|tahoma|roboto|inter\b/i
const SERIF =
  /times|serif|georgia|garamond|palatino|baskerville|bookman|cambria|century|didot|minion|caslon|roman|antiqua|schoolbook|charter|constantia|sabon|utopia|bodoni|cochin|elephant/i

/**
 * A font's family by its name. Only the name is known here, so this is a
 * heuristic: the families Word substitutes by are broad, and an unrecognised
 * name is far more often a modern sans-serif UI/brand face than a serif one.
 */
export function fontFamilyHint(name: string): FontFamilyHint {
  if (MONO.test(name)) return 'modern'
  if (SANS.test(name)) return 'swiss'
  if (SERIF.test(name)) return 'roman'
  return 'swiss'
}

const escapeXml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const unescapeXml = (s: string): string =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')

/** every font name a part's runs ask for (w:rFonts ascii/hAnsi/cs/eastAsia), unescaped */
function fontNamesIn(xml: string, into: Set<string>): void {
  for (const m of xml.matchAll(/<w:rFonts\b[^>]*>/g)) {
    for (const a of m[0].matchAll(/\bw:(?:ascii|hAnsi|cs|eastAsia)="([^"]+)"/g)) {
      if (a[1]) into.add(unescapeXml(a[1]))
    }
  }
}

/**
 * Add word/fontTable.xml (with its content type and relationship) listing the
 * fonts the document uses. A package that already has a font table, or no
 * fonts at all, is returned untouched; so is anything that fails to open.
 */
export async function addFontTable(docx: Uint8Array): Promise<Uint8Array> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(docx)
  } catch {
    return docx
  }
  if (zip.file(FONT_TABLE_PATH)) return docx
  const contentTypes = zip.file('[Content_Types].xml')
  const rels = zip.file('word/_rels/document.xml.rels')
  if (!contentTypes || !rels) return docx

  const names = new Set<string>()
  const parts = zip.file(/^word\/(document|styles|header\d*|footer\d*|footnotes|endnotes)\.xml$/)
  for (const part of parts) fontNamesIn(await part.async('string'), names)
  if (names.size === 0) return docx

  const fonts = [...names]
    .sort()
    .map((name) => {
      const family = fontFamilyHint(name)
      const pitch = family === 'modern' ? 'fixed' : 'variable'
      return `<w:font w:name="${escapeXml(name)}"><w:family w:val="${family}"/><w:pitch w:val="${pitch}"/></w:font>`
    })
    .join('')
  zip.file(
    FONT_TABLE_PATH,
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:fonts xmlns:w="${MAIN_NS}">${fonts}</w:fonts>`,
  )

  const ct = await contentTypes.async('string')
  zip.file(
    '[Content_Types].xml',
    ct.replace(
      '</Types>',
      `<Override PartName="/${FONT_TABLE_PATH}" ContentType="${FONT_TABLE_CT}"/></Types>`,
    ),
  )
  const rel = await rels.async('string')
  zip.file(
    'word/_rels/document.xml.rels',
    rel.replace(
      '</Relationships>',
      `<Relationship Id="rIdFontTable" Type="${FONT_TABLE_REL}" Target="fontTable.xml"/></Relationships>`,
    ),
  )
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}
