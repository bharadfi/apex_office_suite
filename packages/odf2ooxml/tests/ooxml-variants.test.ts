import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'

import { normalizeOoxmlVariant } from '../src/ooxml-variants'

async function pkg(mainType: string): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    `<Types><Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/>` +
      `<Override PartName="/word/document.xml" ContentType="${mainType}"/></Types>`,
  )
  zip.file(
    'word/_rels/document.xml.rels',
    `<Relationships><Relationship Id="r1" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="vbaProject.bin"/>` +
      `<Relationship Id="r2" Type="http://x/styles" Target="styles.xml"/></Relationships>`,
  )
  zip.file('word/vbaProject.bin', 'macro')
  zip.file('word/document.xml', '<doc/>')
  return zip.generateAsync({ type: 'uint8array' })
}

describe('normalizeOoxmlVariant', () => {
  it('rewrites a macro-enabled main type and drops the VBA project', async () => {
    const out = await JSZip.loadAsync(
      await normalizeOoxmlVariant(
        await pkg('application/vnd.ms-word.document.macroEnabled.main+xml'),
        'word',
      ),
    )
    const types = await out.file('[Content_Types].xml')!.async('string')
    expect(types).toContain('wordprocessingml.document.main+xml')
    expect(types).not.toContain('vbaProject')
    expect(out.file('word/vbaProject.bin')).toBeNull()
    const rels = await out.file('word/_rels/document.xml.rels')!.async('string')
    expect(rels).not.toContain('vbaProject')
    expect(rels).toContain('styles.xml')
    expect(await out.file('word/document.xml')!.async('string')).toBe('<doc/>')
  })

  it('rewrites a template main type', async () => {
    const out = await JSZip.loadAsync(
      await normalizeOoxmlVariant(
        await pkg('application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml'),
        'word',
      ),
    )
    expect(await out.file('[Content_Types].xml')!.async('string')).toContain(
      'wordprocessingml.document.main+xml',
    )
  })
})
