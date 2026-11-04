import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { addFontTable, fontFamilyHint } from '../src/rebuild/font-table'

const MIN_TYPES =
  '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>'
const MIN_RELS =
  '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>'

async function pkg(documentXml: string, extra: Record<string, string> = {}): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', MIN_TYPES)
  zip.file('word/_rels/document.xml.rels', MIN_RELS)
  zip.file('word/document.xml', documentXml)
  for (const [path, body] of Object.entries(extra)) zip.file(path, body)
  return zip.generateAsync({ type: 'uint8array' })
}

const run = (font: string) =>
  `<w:r><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}"/></w:rPr><w:t>x</w:t></w:r>`

describe('fontFamilyHint', () => {
  it('reads a family from the name', () => {
    expect(fontFamilyHint('Arial')).toBe('swiss')
    expect(fontFamilyHint('Noto Sans CJK')).toBe('swiss')
    expect(fontFamilyHint('Times New Roman')).toBe('roman')
    expect(fontFamilyHint('Georgia')).toBe('roman')
    expect(fontFamilyHint('Courier New')).toBe('modern')
    expect(fontFamilyHint('JetBrains Mono')).toBe('modern')
  })

  it('treats an unrecognised name as sans-serif, the likelier face', () => {
    expect(fontFamilyHint('Graphik LCG')).toBe('swiss')
  })

  it('does not call a sans-serif face a serif because of a serif-like word in its name', () => {
    expect(fontFamilyHint('Source Sans Pro')).toBe('swiss')
    expect(fontFamilyHint('Roboto Serif Sans')).toBe('swiss')
  })
})

describe('addFontTable', () => {
  it('writes a font table, its content type and its relationship', async () => {
    const out = await JSZip.loadAsync(
      await addFontTable(
        await pkg(
          `<w:document xmlns:w="w"><w:body><w:p>${run('Graphik LCG')}${run('Times New Roman')}</w:p></w:body></w:document>`,
        ),
      ),
    )
    const table = await out.file('word/fontTable.xml')!.async('string')
    expect(table).toContain('<w:font w:name="Graphik LCG"><w:family w:val="swiss"/>')
    expect(table).toContain('<w:font w:name="Times New Roman"><w:family w:val="roman"/>')
    expect(await out.file('[Content_Types].xml')!.async('string')).toContain('/word/fontTable.xml')
    expect(await out.file('word/_rels/document.xml.rels')!.async('string')).toContain(
      'fontTable.xml',
    )
  })

  it('escapes names and lists each font once', async () => {
    const out = await JSZip.loadAsync(
      await addFontTable(
        await pkg(
          `<w:document>${run('A&amp;B &quot;Sans&quot;')}${run('A&amp;B &quot;Sans&quot;')}</w:document>`,
        ),
      ),
    )
    const table = await out.file('word/fontTable.xml')!.async('string')
    expect(table.match(/<w:font /g)).toHaveLength(1)
    expect(table).toContain('A&amp;B &quot;Sans&quot;')
  })

  it('also reads fonts used only in headers and footers', async () => {
    const out = await JSZip.loadAsync(
      await addFontTable(
        await pkg('<w:document/>', { 'word/header1.xml': `<w:hdr>${run('Verdana')}</w:hdr>` }),
      ),
    )
    expect(await out.file('word/fontTable.xml')!.async('string')).toContain('w:name="Verdana"')
  })

  it('leaves a package with its own font table, or with no fonts, untouched', async () => {
    const own = await pkg(`<w:document>${run('Arial')}</w:document>`, {
      'word/fontTable.xml': '<w:fonts/>',
    })
    expect(await addFontTable(own)).toBe(own)
    const none = await pkg('<w:document><w:p/></w:document>')
    expect(await addFontTable(none)).toBe(none)
  })

  it('returns bytes it cannot open as they are', async () => {
    const junk = new Uint8Array([1, 2, 3, 4])
    expect(await addFontTable(junk)).toBe(junk)
  })
})
