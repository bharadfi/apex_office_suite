/**
 * vCard (.vcf, 2.1 / 3.0 / 4.0) → one table row per contact. Several values of
 * one kind (phones, emails…) are joined with "; " in a single cell so no
 * contact is split across rows. Photos, keys and other binary properties are
 * not imported.
 */

export const VCF_COLUMNS = [
  'Name',
  'Given name',
  'Family name',
  'Organization',
  'Title',
  'Phone',
  'Email',
  'Address',
  'Birthday',
  'Website',
  'Notes',
] as const

export type VcfRow = Record<(typeof VCF_COLUMNS)[number], string>

interface Property {
  name: string
  params: string[]
  value: string
}

function unfold(text: string): string[] {
  const raw = text.replace(/\r\n?/g, '\n').split('\n')
  const lines: string[] = []
  for (const line of raw) {
    const previous = lines[lines.length - 1]
    if (
      previous !== undefined &&
      previous.endsWith('=') &&
      /ENCODING=QUOTED-PRINTABLE|;QUOTED-PRINTABLE/i.test(previous)
    ) {
      // quoted-printable soft line break: the continuation is content verbatim
      lines[lines.length - 1] = previous.slice(0, -1) + line
    } else if ((line.startsWith(' ') || line.startsWith('	')) && previous !== undefined) {
      lines[lines.length - 1] = previous + line.slice(1)
    } else {
      lines.push(line)
    }
  }
  return lines
}

function decodeQuotedPrintable(value: string, charset: string): string {
  const bytes: number[] = []
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(value.slice(i + 1, i + 3))) {
      bytes.push(parseInt(value.slice(i + 1, i + 3), 16))
      i += 2
    } else bytes.push(value.charCodeAt(i) & 0xff)
  }
  try {
    return new TextDecoder(charset || 'utf-8').decode(Uint8Array.from(bytes))
  } catch {
    return new TextDecoder('utf-8').decode(Uint8Array.from(bytes))
  }
}

function unescapeText(value: string): string {
  return value.replace(/\\([nN,;\\])/g, (_m, c: string) => (c === 'n' || c === 'N' ? '\n' : c))
}

function parseProperty(line: string): Property | null {
  const colon = line.indexOf(':')
  if (colon <= 0) return null
  const head = line.slice(0, colon).split(';')
  let name = head[0]!.toUpperCase()
  const dot = name.indexOf('.') // group prefix: item1.TEL
  if (dot >= 0) name = name.slice(dot + 1)
  const params = head.slice(1)
  let value = line.slice(colon + 1)
  if (params.some((p) => /^ENCODING=QUOTED-PRINTABLE$/i.test(p) || /^QUOTED-PRINTABLE$/i.test(p))) {
    const charset = params.find((p) => /^CHARSET=/i.test(p))?.slice(8) ?? 'utf-8'
    value = decodeQuotedPrintable(value, charset)
  }
  return { name, params, value }
}

const SKIPPED = new Set(['PHOTO', 'LOGO', 'SOUND', 'KEY'])

function splitStructured(value: string): string[] {
  // split on unescaped ';'
  const parts: string[] = []
  let current = ''
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '\\' && i + 1 < value.length) {
      current += value[i]! + value[i + 1]!
      i++
    } else if (value[i] === ';') {
      parts.push(current)
      current = ''
    } else current += value[i]
  }
  parts.push(current)
  return parts.map(unescapeText)
}

function emptyRow(): VcfRow {
  return Object.fromEntries(VCF_COLUMNS.map((c) => [c, ''])) as VcfRow
}

function append(row: VcfRow, column: keyof VcfRow, value: string): void {
  const v = value.trim()
  if (!v) return
  row[column] = row[column] ? `${row[column]}; ${v}` : v
}

export function parseVcf(text: string): VcfRow[] {
  const rows: VcfRow[] = []
  let row: VcfRow | null = null
  for (const line of unfold(text.replace(/^﻿/, ''))) {
    if (!line.trim()) continue
    const prop = parseProperty(line)
    if (!prop) continue
    if (prop.name === 'BEGIN' && /^VCARD$/i.test(prop.value.trim())) {
      row = emptyRow()
      continue
    }
    if (prop.name === 'END' && /^VCARD$/i.test(prop.value.trim())) {
      if (row) rows.push(row)
      row = null
      continue
    }
    if (!row || SKIPPED.has(prop.name)) continue
    switch (prop.name) {
      case 'FN':
        append(row, 'Name', unescapeText(prop.value))
        break
      case 'N': {
        const [family, given] = splitStructured(prop.value)
        append(row, 'Family name', family ?? '')
        append(row, 'Given name', given ?? '')
        break
      }
      case 'ORG':
        append(row, 'Organization', splitStructured(prop.value).filter(Boolean).join(', '))
        break
      case 'TITLE':
        append(row, 'Title', unescapeText(prop.value))
        break
      case 'TEL':
        append(row, 'Phone', prop.value.replace(/^tel:/i, ''))
        break
      case 'EMAIL':
        append(row, 'Email', unescapeText(prop.value).replace(/^mailto:/i, ''))
        break
      case 'ADR':
        // pobox;ext;street;city;region;postcode;country
        append(row, 'Address', splitStructured(prop.value).filter(Boolean).join(', '))
        break
      case 'BDAY':
        append(row, 'Birthday', prop.value)
        break
      case 'URL':
        append(row, 'Website', prop.value)
        break
      case 'NOTE':
        append(row, 'Notes', unescapeText(prop.value))
        break
      default:
        break
    }
  }
  for (const r of rows) {
    if (!r.Name) r.Name = [r['Given name'], r['Family name']].filter(Boolean).join(' ')
  }
  return rows
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/** The contacts as CSV text (header row first) for the delimited-text importer. */
export function vcfToCsv(text: string): string {
  const rows = parseVcf(text)
  const lines = [VCF_COLUMNS.map(csvCell).join(',')]
  for (const row of rows) lines.push(VCF_COLUMNS.map((c) => csvCell(row[c])).join(','))
  return lines.join('\r\n')
}

// ---- export: table (CSV text) → vCard 3.0 ----

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const src = text.replace(/^\uFEFF/, '')
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

type Field = 'name' | 'given' | 'family' | 'org' | 'title' | 'phone' | 'email' | 'address' | 'birthday' | 'url' | 'notes'

function fieldForHeader(header: string): Field | null {
  const h = header.trim().toLowerCase().replace(/\s+/g, ' ')
  if (['name', 'full name', 'display name', 'fn'].includes(h)) return 'name'
  if (['given name', 'first name', 'first'].includes(h)) return 'given'
  if (['family name', 'last name', 'surname', 'last'].includes(h)) return 'family'
  if (['organization', 'organization name', 'company', 'org'].includes(h) || /^organization 1 - name$/.test(h)) return 'org'
  if (['title', 'job title', 'organization title'].includes(h) || /^organization 1 - title$/.test(h)) return 'title'
  if (/phone|mobile|tel\b/.test(h) && !/type|label/.test(h)) return 'phone'
  if (/e-?mail|email/.test(h) && !/type|label/.test(h)) return 'email'
  if (/address|street/.test(h) && !/e-?mail/.test(h) && !/type|label/.test(h)) return 'address'
  if (['birthday', 'birth date', 'bday'].includes(h)) return 'birthday'
  if (/website|url|web page/.test(h)) return 'url'
  if (['notes', 'note', 'comments'].includes(h)) return 'notes'
  return null
}

function escapeVcard(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
}

function fold(line: string): string {
  const out: string[] = []
  let rest = line
  while (Buffer.byteLength(rest) > 75) {
    let cut = 75
    while (Buffer.byteLength(rest.slice(0, cut)) > 75) cut--
    out.push(rest.slice(0, cut))
    rest = ' ' + rest.slice(cut)
  }
  out.push(rest)
  return out.join('\r\n')
}

/** One vCard 3.0 per data row; null when no column maps to a contact field. */
export function csvToVcf(csv: string): string | null {
  const rows = parseCsvRows(csv)
  if (rows.length < 2) return null
  const header = rows[0]!.map(fieldForHeader)
  if (!header.some((f) => f !== null)) return null
  const cards: string[] = []
  for (const cells of rows.slice(1)) {
    const values: Record<Field, string[]> = {
      name: [], given: [], family: [], org: [], title: [], phone: [], email: [],
      address: [], birthday: [], url: [], notes: [],
    }
    header.forEach((field, i) => {
      const value = (cells[i] ?? '').trim()
      if (field && value) values[field].push(value)
    })
    const given = values.given[0] ?? ''
    const family = values.family[0] ?? ''
    const name = values.name[0] ?? [given, family].filter(Boolean).join(' ')
    if (!name && values.phone.length === 0 && values.email.length === 0) continue
    const lines = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${escapeVcard(name)}`, `N:${escapeVcard(family)};${escapeVcard(given)};;;`]
    if (values.org[0]) lines.push(`ORG:${escapeVcard(values.org[0])}`)
    if (values.title[0]) lines.push(`TITLE:${escapeVcard(values.title[0])}`)
    for (const v of values.phone.flatMap((p) => p.split(/\s*;\s*/))) if (v) lines.push(`TEL:${escapeVcard(v)}`)
    for (const v of values.email.flatMap((p) => p.split(/\s*;\s*/))) if (v) lines.push(`EMAIL:${escapeVcard(v)}`)
    for (const v of values.address) lines.push(`ADR:;;${escapeVcard(v)};;;;`)
    if (values.birthday[0]) lines.push(`BDAY:${values.birthday[0]}`)
    if (values.url[0]) lines.push(`URL:${values.url[0]}`)
    if (values.notes[0]) lines.push(`NOTE:${escapeVcard(values.notes[0])}`)
    lines.push('END:VCARD')
    cards.push(lines.map(fold).join('\r\n'))
  }
  return cards.length > 0 ? cards.join('\r\n') + '\r\n' : null
}
