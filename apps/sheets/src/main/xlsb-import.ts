/**
 * Read-only .xlsb (BIFF12) → .xlsx conversion. Reads sheet names, cell values
 * (numbers, text, booleans, errors; formula cells keep their cached value) and
 * number formats. Formulas, styles other than number formats, charts, pivots
 * and macros are not converted; the caller opens the result as a copy.
 */
import JSZip from 'jszip'

class Reader {
  pos = 0
  constructor(readonly data: Uint8Array) {}
  get done(): boolean {
    return this.pos >= this.data.length
  }
  next(): { type: number; body: Uint8Array } | null {
    if (this.done) return null
    let type = this.data[this.pos++]!
    if (type & 0x80) type = (type & 0x7f) | ((this.data[this.pos++] ?? 0) << 7)
    let length = 0
    for (let shift = 0, i = 0; i < 4; i++, shift += 7) {
      const byte = this.data[this.pos++]
      if (byte === undefined) return null
      length |= (byte & 0x7f) << shift
      if (!(byte & 0x80)) break
    }
    const body = this.data.subarray(this.pos, this.pos + length)
    this.pos += length
    return { type, body }
  }
}

const view = (b: Uint8Array): DataView => new DataView(b.buffer, b.byteOffset, b.byteLength)

function wideString(b: Uint8Array, offset: number): { text: string; end: number } {
  const count = view(b).getUint32(offset, true)
  const start = offset + 4
  const end = start + count * 2
  return { text: Buffer.from(b.subarray(start, end)).toString('utf16le'), end }
}

function rkValue(rk: number): number {
  const isInt = (rk & 2) !== 0
  let value: number
  if (isInt) value = rk >> 2
  else {
    const buffer = new DataView(new ArrayBuffer(8))
    buffer.setUint32(4, rk & 0xfffffffc, true)
    value = buffer.getFloat64(0, true)
  }
  return rk & 1 ? value / 100 : value
}

const ERROR_NAMES: Record<number, string> = {
  0x00: '#NULL!',
  0x07: '#DIV/0!',
  0x0f: '#VALUE!',
  0x17: '#REF!',
  0x1d: '#NAME?',
  0x24: '#NUM!',
  0x2a: '#N/A',
  0x2b: '#GETTING_DATA',
}

const esc = (text: string): string =>
  text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

const colName = (col: number): string => {
  let n = col + 1
  let name = ''
  while (n > 0) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name
    n = Math.floor((n - 1) / 26)
  }
  return name
}

async function entry(zip: JSZip, name: string): Promise<Uint8Array | null> {
  const file = zip.file(name)
  return file ? file.async('uint8array') : null
}

interface Styles {
  formats: Map<number, string>
  xfs: number[]
}

function readStyles(data: Uint8Array | null): Styles {
  const styles: Styles = { formats: new Map(), xfs: [] }
  if (!data) return styles
  const reader = new Reader(data)
  let inCellXfs = false
  for (let rec = reader.next(); rec; rec = reader.next()) {
    if (rec.type === 44 && rec.body.length >= 6) {
      // BrtFmt: ifmt u16, stFmtCode
      styles.formats.set(view(rec.body).getUint16(0, true), wideString(rec.body, 2).text)
    } else if (rec.type === 617) inCellXfs = true
    else if (rec.type === 618) inCellXfs = false
    else if (rec.type === 47 && inCellXfs && rec.body.length >= 4) {
      styles.xfs.push(view(rec.body).getUint16(2, true))
    }
  }
  return styles
}

function readSharedStrings(data: Uint8Array | null): string[] {
  const out: string[] = []
  if (!data) return out
  const reader = new Reader(data)
  for (let rec = reader.next(); rec; rec = reader.next()) {
    if (rec.type === 19 && rec.body.length >= 5) out.push(wideString(rec.body, 1).text)
  }
  return out
}

interface SheetRef {
  name: string
  relId: string
}

function readWorkbook(data: Uint8Array): SheetRef[] {
  const sheets: SheetRef[] = []
  const reader = new Reader(data)
  for (let rec = reader.next(); rec; rec = reader.next()) {
    if (rec.type !== 156) continue // BrtBundleSh
    const rel = wideString(rec.body, 8)
    sheets.push({ relId: rel.text, name: wideString(rec.body, rel.end).text })
  }
  return sheets
}

function sheetXml(data: Uint8Array, strings: string[], usedXfs: Set<number>): string {
  const rows = new Map<number, string[]>()
  let row = -1
  const reader = new Reader(data)
  for (let rec = reader.next(); rec; rec = reader.next()) {
    if (rec.type === 0 && rec.body.length >= 4) {
      row = view(rec.body).getUint32(0, true)
      continue
    }
    if (rec.type < 1 || rec.type > 11 || row < 0 || rec.body.length < 8) continue
    const v = view(rec.body)
    const col = v.getUint32(0, true)
    const xf = v.getUint32(4, true) & 0xffffff
    const ref = `${colName(col)}${row + 1}`
    const style = xf > 0 ? ` s="${xf}"` : ''
    if (xf > 0) usedXfs.add(xf)
    let cell: string | null = null
    switch (rec.type) {
      case 2:
        cell = `<c r="${ref}"${style}><v>${rkValue(v.getUint32(8, true))}</v></c>`
        break
      case 3:
      case 11:
        cell = `<c r="${ref}"${style} t="e"><v>${ERROR_NAMES[rec.body[8]!] ?? '#VALUE!'}</v></c>`
        break
      case 4:
      case 10:
        cell = `<c r="${ref}"${style} t="b"><v>${rec.body[8] ? 1 : 0}</v></c>`
        break
      case 5:
      case 9:
        cell = `<c r="${ref}"${style}><v>${v.getFloat64(8, true)}</v></c>`
        break
      case 6:
      case 8:
        cell = `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${esc(wideString(rec.body, 8).text)}</t></is></c>`
        break
      case 7:
        cell = `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${esc(strings[v.getUint32(8, true)] ?? '')}</t></is></c>`
        break
      default:
        break // blank cells carry no value
    }
    if (cell) {
      const list = rows.get(row) ?? []
      list.push(cell)
      rows.set(row, list)
    }
  }
  const body = [...rows.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([r, cells]) => `<row r="${r + 1}">${cells.join('')}</row>`)
    .join('')
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<sheetData>${body}</sheetData></worksheet>`
  )
}

export async function convertXlsbToXlsx(source: Uint8Array): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(source)
  const workbook = await entry(zip, 'xl/workbook.bin')
  if (!workbook) throw new Error('not an .xlsb workbook')
  const rels = await zip.file('xl/_rels/workbook.bin.rels')?.async('string')
  const targets = new Map<string, string>()
  for (const m of (rels ?? '').matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /Id="([^"]*)"/.exec(m[0])?.[1]
    const target = /Target="([^"]*)"/.exec(m[0])?.[1]
    if (id && target) targets.set(id, target.replace(/^\/?(xl\/)?/, 'xl/'))
  }
  const sheets = readWorkbook(workbook)
  if (sheets.length === 0) throw new Error('workbook has no sheets')
  const strings = readSharedStrings(await entry(zip, 'xl/sharedStrings.bin'))
  const styles = readStyles(await entry(zip, 'xl/styles.bin'))

  const out = new JSZip()
  const used = new Set<number>()
  const names: string[] = []
  for (const [index, sheet] of sheets.entries()) {
    const data = await entry(zip, targets.get(sheet.relId) ?? `xl/worksheets/sheet${index + 1}.bin`)
    out.file(
      `xl/worksheets/sheet${index + 1}.xml`,
      data
        ? sheetXml(data, strings, used)
        : '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>',
    )
    names.push(sheet.name.replace(/[\\/?*[\]:]/g, '_').slice(0, 31) || `Sheet${index + 1}`)
  }

  const customFormats = [...styles.formats.entries()]
    .map(([id, code]) => `<numFmt numFmtId="${id}" formatCode="${esc(code)}"/>`)
    .join('')
  const xfCount = Math.max(styles.xfs.length, 1)
  const xfs = Array.from({ length: xfCount }, (_, i) => {
    const fmt = styles.xfs[i] ?? 0
    return `<xf numFmtId="${fmt}" fontId="0" fillId="0" borderId="0" xfId="0"${fmt ? ' applyNumberFormat="1"' : ''}/>`
  }).join('')
  out.file(
    'xl/styles.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      (customFormats ? `<numFmts count="${styles.formats.size}">${customFormats}</numFmts>` : '') +
      '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>' +
      '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      `<cellXfs count="${xfCount}">${xfs}</cellXfs>` +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
  )
  out.file(
    'xl/workbook.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
      '</sheets></workbook>',
  )
  out.file(
    'xl/_rels/workbook.xml.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      names
        .map(
          (_, i) =>
            `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
        )
        .join('') +
      `<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      '</Relationships>',
  )
  out.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  )
  out.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      names
        .map(
          (_, i) =>
            `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
        )
        .join('') +
      '</Types>',
  )
  return out.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}
