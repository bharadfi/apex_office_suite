import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'

import { convertRtfToDocx } from '../src/rtf-docx'

const rtf = (body: string) =>
  new TextEncoder().encode(`{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}${body}}`)

async function documentXml(bytes: Uint8Array): Promise<string> {
  return (await JSZip.loadAsync(bytes)).file('word/document.xml')!.async('string')
}

describe('convertRtfToDocx', () => {
  it('keeps paragraphs, bold/italic and escapes, skipping the font table', async () => {
    const { docx, paragraphs } = await convertRtfToDocx(
      rtf("Hello {\\b bold} and {\\i it}\\par Caf\\'e9 \\u8364? end"),
    )
    const xml = await documentXml(docx)
    expect(paragraphs).toBe(2)
    expect(xml).toContain('<w:b/>')
    expect(xml).toContain('<w:i/>')
    expect(xml).toContain('Café €')
    expect(xml).not.toContain('Arial')
  })

  it('counts pictures as dropped and rejects non-RTF', async () => {
    const { dropped } = await convertRtfToDocx(rtf('x{\\pict\\jpegblip ffd8}y'))
    expect(dropped).toBe(1)
    await expect(convertRtfToDocx(new TextEncoder().encode('plain'))).rejects.toThrow()
  })
})
