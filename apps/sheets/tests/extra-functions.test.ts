import { describe, expect, it } from 'vitest'
import { NumberValueObject, StringValueObject } from '@univerjs/engine-formula'

import { InfoFunction, IsoCeiling, PercentOf, RegexTest } from '../src/renderer/extra-functions'

const n = (x: number) => NumberValueObject.create(x)
const s = (x: string) => StringValueObject.create(x)
const val = (r: unknown) => (r as { getValue(): unknown }).getValue()

describe('extra Excel functions', () => {
  it('ISO.CEILING rounds toward +infinity regardless of sign', () => {
    const f = new IsoCeiling('ISO.CEILING')
    expect(val(f.calculate(n(4.3), n(1)))).toBe(5)
    expect(val(f.calculate(n(-4.3), n(1)))).toBe(-4)
    expect(val(f.calculate(n(-4.3), n(-2)))).toBe(-4)
    expect(val(f.calculate(n(4.3)))).toBe(5)
  })

  it('REGEXTEST matches with optional case-insensitivity', () => {
    const f = new RegexTest('REGEXTEST')
    expect(val(f.calculate(s('Apex'), s('^a')))).toBe(false)
    expect(val(f.calculate(s('Apex'), s('^a'), n(1)))).toBe(true)
  })

  it('PERCENTOF divides subset sum by total', () => {
    const f = new PercentOf('PERCENTOF')
    expect(val(f.calculate(n(25), n(100)))).toBe(0.25)
  })

  it('INFO answers known keys', () => {
    const f = new InfoFunction('INFO')
    expect(val(f.calculate(s('recalc')))).toBe('Automatic')
  })
})
