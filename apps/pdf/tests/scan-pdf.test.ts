// @vitest-environment node
import { crc32 } from 'node:zlib'
import { PDFDocument } from 'pdf-lib'
import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SCAN_DPI, MAX_SCAN_PAGES, pngDpi, scansToPdf } from '../src/main/scan-pdf'

/** a solid-colour PNG of the given size, optionally recording a resolution in a pHYs chunk */
function png(width: number, height: number, dpi?: number): Uint8Array {
  const image = new PNG({ width, height })
  image.data.fill(180)
  const bytes = PNG.sync.write(image)
  if (dpi === undefined) return new Uint8Array(bytes)
  const data = Buffer.alloc(9)
  const perMetre = Math.round((dpi * 1000) / 25.4)
  data.writeUInt32BE(perMetre, 0)
  data.writeUInt32BE(perMetre, 4)
  data[8] = 1 // metres
  const type = Buffer.from('pHYs')
  const chunk = Buffer.alloc(12 + 9)
  chunk.writeUInt32BE(9, 0)
  type.copy(chunk, 4)
  data.copy(chunk, 8)
  chunk.writeUInt32BE(crc32(Buffer.concat([type, data])) >>> 0, 17)
  // a pHYs chunk goes after IHDR (8-byte signature + 25-byte IHDR chunk)
  return new Uint8Array(Buffer.concat([bytes.subarray(0, 33), chunk, bytes.subarray(33)]))
}

describe('pngDpi', () => {
  it('reads the resolution a picture records', () => {
    expect(pngDpi(png(10, 10, 300))).toBeCloseTo(300, 0)
    expect(pngDpi(png(10, 10, 72))).toBeCloseTo(72, 0)
  })

  it('uses the default when a picture records none, or something implausible', () => {
    expect(pngDpi(png(10, 10))).toBe(DEFAULT_SCAN_DPI)
    expect(pngDpi(png(10, 10, 5))).toBe(DEFAULT_SCAN_DPI)
    expect(pngDpi(png(10, 10, 20000))).toBe(DEFAULT_SCAN_DPI)
  })

  it('uses the default for bytes that are not a PNG', () => {
    expect(pngDpi(new Uint8Array([1, 2, 3]))).toBe(DEFAULT_SCAN_DPI)
  })
})

describe('scansToPdf', () => {
  it('makes one page per picture, in order, sized to the picture at its own resolution', async () => {
    // 1240 x 1754 px at 150 dpi is A4 (about 595 x 842 pt); 600 x 300 px at 300 dpi is 144 x 72 pt
    const pdf = await PDFDocument.load(await scansToPdf([png(1240, 1754, 150), png(600, 300, 300)]))
    expect(pdf.getPageCount()).toBe(2)
    const [a, b] = pdf.getPages()
    expect(a!.getWidth()).toBeCloseTo(595.2, 0)
    expect(a!.getHeight()).toBeCloseTo(842.0, 0)
    expect(b!.getWidth()).toBeCloseTo(144, 0)
    expect(b!.getHeight()).toBeCloseTo(72, 0)
  })

  it('assumes the default resolution for a picture that records none', async () => {
    const pdf = await PDFDocument.load(await scansToPdf([png(300, 150)]))
    const page = pdf.getPages()[0]!
    expect(page.getWidth()).toBeCloseTo((300 * 72) / DEFAULT_SCAN_DPI, 0)
  })

  it('refuses nothing to scan, something that is not a PNG, and too many pages', async () => {
    await expect(scansToPdf([])).rejects.toThrow('no pages')
    await expect(scansToPdf([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9])])).rejects.toThrow(
      'not a PNG',
    )
    const many = Array.from({ length: MAX_SCAN_PAGES + 1 }, () => new Uint8Array(1))
    await expect(scansToPdf(many)).rejects.toThrow('too many')
  })
})
