import { describe, expect, it } from 'vitest'
import {
  formatPageNumber,
  hasCustomLabels,
  labelOf,
  labelsFor,
  normalizeRanges,
  type PageLabelRange,
} from '../src/shared/page-labels'

const range = (over: Partial<PageLabelRange> & { start: number }): PageLabelRange => ({
  style: 'decimal',
  prefix: '',
  firstNumber: 1,
  ...over,
})

describe('formatPageNumber', () => {
  it('writes decimals, and nothing for the no-number style', () => {
    expect(formatPageNumber(7, 'decimal')).toBe('7')
    expect(formatPageNumber(7, 'none')).toBe('')
  })

  it('writes subtractive roman numerals in either case', () => {
    expect(
      [1, 4, 9, 14, 40, 90, 400, 1994, 3999].map((n) => formatPageNumber(n, 'upperRoman')),
    ).toEqual(['I', 'IV', 'IX', 'XIV', 'XL', 'XC', 'CD', 'MCMXCIV', 'MMMCMXCIX'])
    expect(formatPageNumber(14, 'lowerRoman')).toBe('xiv')
  })

  it('falls back to digits where roman numerals run out', () => {
    expect(formatPageNumber(4000, 'upperRoman')).toBe('4000')
  })

  it('repeats letters instead of carrying, as the PDF specification says', () => {
    expect([1, 26, 27, 52, 53].map((n) => formatPageNumber(n, 'upperAlpha'))).toEqual([
      'A',
      'Z',
      'AA',
      'ZZ',
      'AAA',
    ])
    expect(formatPageNumber(28, 'lowerAlpha')).toBe('bb')
  })

  it('treats a number below 1 as 1', () => {
    expect(formatPageNumber(0, 'decimal')).toBe('1')
    expect(formatPageNumber(-5, 'upperRoman')).toBe('I')
  })
})

describe('labelOf', () => {
  it('is plain 1, 2, 3 with no ranges', () => {
    expect(labelsFor([], 3)).toEqual(['1', '2', '3'])
  })

  it('numbers each run from its own first number, with its prefix', () => {
    const ranges = [
      range({ start: 0, style: 'lowerRoman' }),
      range({ start: 2 }),
      range({ start: 5, prefix: 'A-', firstNumber: 10 }),
    ]
    expect(labelsFor(ranges, 7)).toEqual(['i', 'ii', '1', '2', '3', 'A-10', 'A-11'])
  })

  it('gives a no-number run just its prefix', () => {
    expect(labelsFor([range({ start: 0, style: 'none', prefix: 'Cover' })], 2)).toEqual([
      'Cover',
      'Cover',
    ])
  })

  it('follows pages by position: the same ranges relabel whatever page sits there', () => {
    const ranges = [range({ start: 0, style: 'lowerRoman' }), range({ start: 1 })]
    expect(labelOf(ranges, 0)).toBe('i')
    expect(labelOf(ranges, 1)).toBe('1')
  })
})

describe('normalizeRanges', () => {
  it('orders ranges and keeps the last one given for a repeated start', () => {
    const out = normalizeRanges([
      range({ start: 4, prefix: 'b' }),
      range({ start: 0 }),
      range({ start: 4, prefix: 'last' }),
    ])
    expect(out.map((r) => [r.start, r.prefix])).toEqual([
      [0, ''],
      [4, 'last'],
    ])
  })

  it('adds the plain range at page 0 that the specification requires', () => {
    const out = normalizeRanges([range({ start: 3, style: 'upperRoman' })])
    expect(out[0]).toEqual({ start: 0, style: 'decimal', prefix: '', firstNumber: 1 })
    expect(out[1]!.start).toBe(3)
  })

  it('drops starts that are not whole non-negative numbers and repairs bad numbers', () => {
    const out = normalizeRanges([
      range({ start: -1 }),
      range({ start: 1.5 }),
      range({ start: 0, firstNumber: 0 }),
    ])
    expect(out).toEqual([{ start: 0, style: 'decimal', prefix: '', firstNumber: 1 }])
  })

  it('stays empty when there are no ranges, which means no labels', () => {
    expect(normalizeRanges([])).toEqual([])
  })
})

describe('hasCustomLabels', () => {
  it('is false for no ranges or for ranges that only restate 1, 2, 3', () => {
    expect(hasCustomLabels([], 5)).toBe(false)
    expect(hasCustomLabels([range({ start: 0 })], 5)).toBe(false)
  })

  it('is true as soon as any page is labelled differently', () => {
    expect(hasCustomLabels([range({ start: 0, style: 'lowerRoman' })], 2)).toBe(true)
    expect(hasCustomLabels([range({ start: 0, firstNumber: 3 })], 2)).toBe(true)
  })
})
