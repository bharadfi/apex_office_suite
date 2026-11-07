import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'

import { convertXlsbToXlsx } from '../src/main/xlsb-import'

function record(type: number, body: number[]): number[] {
  const head = type < 0x80 ? [type] : [(type & 0x7f) | 0x80, type >> 7]
  const len: number[] = []
  let n = body.length
  do {
    let byte = n & 0x7f
    n >>= 7
    if (n > 0) byte |= 0x80
    len.push(byte)
  } while (n > 0)
  return [...head, ...len, ...body]
}
const u32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255]
const wide = (s: string) => [...u32(s.length), ...Buffer.from(s, 'utf16le')]
const f64 = (x: number) => [...Buffer.from(new Float64Array([x]).buffer)]
const cell = (type: number, col: number, xf: number, data: number[]) =>
  record(type, [...u32(col), ...u32(xf), ...data])

describe('convertXlsbToXlsx', () => {
  it('converts values, shared strings, booleans, errors and number formats', async () => {
    const zip = new JSZip()
    zip.file(
      'xl/workbook.bin',
      Uint8Array.from(record(156, [...u32(0), ...u32(1), ...wide('rId1'), ...wide('Data')])),
    )
    zip.file(
      'xl/_rels/workbook.bin.rels',
      '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.bin"/></Relationships>',
    )
    zip.file('xl/sharedStrings.bin', Uint8Array.from(record(19, [0, ...wide('hello')])))
    zip.file(
      'xl/styles.bin',
      Uint8Array.from([
        ...record(44, [164, 0, ...wide('yyyy-mm-dd')]),
        ...record(617, u32(2)),
        ...record(47, [0, 0, 0, 0]),
        ...record(47, [0, 0, 164, 0]),
        ...record(618, []),
      ]),
    )
    // RK integer 7 (7<<2 | 2), RK 12.5 as x100 of 1250
    zip.file(
      'xl/worksheets/sheet1.bin',
      Uint8Array.from([
        ...record(0, u32(0)),
        ...cell(7, 0, 0, u32(0)),
        ...cell(2, 1, 0, u32((7 << 2) | 2)),
        ...cell(5, 2, 1, f64(45000)),
        ...cell(4, 3, 0, [1]),
        ...cell(3, 4, 0, [0x07]),
        ...record(0, u32(2)),
        ...cell(2, 0, 0, u32((1250 << 2) | 3)),
        ...cell(6, 1, 0, wide('x<y')),
      ]),
    )
    const xlsx = await JSZip.loadAsync(await convertXlsbToXlsx(await zip.generateAsync({ type: 'uint8array' })))
    const sheet = await xlsx.file('xl/worksheets/sheet1.xml')!.async('string')
    expect(sheet).toContain('<c r="A1" t="inlineStr"><is><t xml:space="preserve">hello</t></is></c>')
    expect(sheet).toContain('<c r="B1"><v>7</v></c>')
    expect(sheet).toContain('<c r="C1" s="1"><v>45000</v></c>')
    expect(sheet).toContain('t="b"><v>1</v>')
    expect(sheet).toContain('<v>#DIV/0!</v>')
    expect(sheet).toContain('<row r="3">')
    expect(sheet).toContain('<c r="A3"><v>12.5</v></c>')
    expect(sheet).toContain('x&lt;y')
    expect(await xlsx.file('xl/styles.xml')!.async('string')).toContain('formatCode="yyyy-mm-dd"')
    expect(await xlsx.file('xl/workbook.xml')!.async('string')).toContain('name="Data"')
  })

  it('rejects a package without workbook.bin', async () => {
    const zip = new JSZip()
    zip.file('a.txt', 'x')
    await expect(convertXlsbToXlsx(await zip.generateAsync({ type: 'uint8array' }))).rejects.toThrow()
  })
})
