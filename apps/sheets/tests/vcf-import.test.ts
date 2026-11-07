import { describe, expect, it } from 'vitest'

import { csvToVcf, parseVcf, vcfToCsv } from '../src/main/vcf-import'

const card3 = [
  'BEGIN:VCARD',
  'VERSION:3.0',
  'FN:Ada Lovelace',
  'N:Lovelace;Ada;;;',
  'ORG:Analytical Engines;Research',
  'TEL;TYPE=CELL:+44 20 7946 0000',
  'item1.TEL:0123 456',
  'EMAIL;TYPE=INTERNET:ada@example.com',
  'ADR;TYPE=HOME:;;1 Main St;London;;N1;UK',
  'NOTE:Line one\\nline two\\, with comma',
  'PHOTO;ENCODING=b:AAAA',
  'END:VCARD',
].join('\r\n')

describe('parseVcf', () => {
  it('maps a 3.0 card to one row, joining repeated values', () => {
    const [row] = parseVcf(card3)
    expect(row!.Name).toBe('Ada Lovelace')
    expect(row!['Family name']).toBe('Lovelace')
    expect(row!.Organization).toBe('Analytical Engines, Research')
    expect(row!.Phone).toBe('+44 20 7946 0000; 0123 456')
    expect(row!.Address).toBe('1 Main St, London, N1, UK')
    expect(row!.Notes).toBe('Line one\nline two, with comma')
  })

  it('handles folded lines, 2.1 quoted-printable and several cards', () => {
    const text =
      'BEGIN:VCARD\nVERSION:2.1\nN;ENCODING=QUOTED-PRINTABLE;CHARSET=UTF-8:M=C3=BCller;Jo\nTEL:555\n 1234\n' +
      'NOTE;ENCODING=QUOTED-PRINTABLE;CHARSET=UTF-8:caf=C3=A9=\n bar\nEND:VCARD\n' +
      'BEGIN:VCARD\nVERSION:4.0\nFN:Second\nEND:VCARD\n'
    const rows = parseVcf(text)
    expect(rows).toHaveLength(2)
    expect(rows[0]!.Name).toBe('Jo Müller')
    expect(rows[0]!.Phone).toBe('5551234')
    expect(rows[0]!.Notes).toBe('café bar')
    expect(rows[1]!.Name).toBe('Second')
  })

  it('quotes csv cells with commas and newlines', () => {
    expect(vcfToCsv(card3)).toContain('"Line one\nline two, with comma"')
  })
})

describe('csvToVcf', () => {
  it('writes one vCard per row from recognised headers and round-trips', () => {
    const csv = 'First Name,Last Name,Phone,E-mail,Company,Notes\r\nAda,Lovelace,+44 1; 555,ada@x.org,Engines,"a, b"\r\n'
    const vcf = csvToVcf(csv)!
    expect(vcf).toContain('FN:Ada Lovelace')
    expect(vcf).toContain('TEL:555')
    const [row] = parseVcf(vcf)
    expect(row!.Phone).toBe('+44 1; 555')
    expect(row!.Notes).toBe('a, b')
    expect(row!.Organization).toBe('Engines')
  })

  it('returns null without contact columns', () => {
    expect(csvToVcf('x,y\r\n1,2\r\n')).toBeNull()
  })
})
