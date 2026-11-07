import { ArrayValueObject, NumberValueObject } from '@univerjs/engine-formula'
import { describe, expect, it } from 'vitest'

import {
  ForecastEts,
  ForecastEtsConfint,
  ForecastEtsSeasonality,
  ForecastEtsStat,
} from '../src/renderer/forecast-ets'

const col = (xs: number[]) =>
  ArrayValueObject.create({
    calculateValueList: xs.map((x) => [NumberValueObject.create(x)]),
    rowCount: xs.length,
    columnCount: 1,
    unitId: '',
    sheetId: '',
    row: 0,
    column: 0,
  } as never)
const n = (x: number) => NumberValueObject.create(x)
const val = (r: unknown) => (r as { getValue(): unknown }).getValue() as number

describe('FORECAST.ETS family (approximation of Excel)', () => {
  const linear = Array.from({ length: 12 }, (_, i) => 10 + 2 * i)
  const time = Array.from({ length: 12 }, (_, i) => i + 1)
  const seasonal = Array.from({ length: 24 }, (_, i) => 100 + i + [10, -5, 0, -5][i % 4]!)
  const seasonTime = Array.from({ length: 24 }, (_, i) => i + 1)

  it('extrapolates a linear trend', () => {
    const f = new ForecastEts('FORECAST.ETS').calculate(n(13), col(linear), col(time), n(0))
    expect(val(f)).toBeCloseTo(34, 0)
  })

  it('finds a period-4 season and forecasts through it', () => {
    expect(val(new ForecastEtsSeasonality('S').calculate(col(seasonal), col(seasonTime)))).toBe(4)
    const f = new ForecastEts('F').calculate(n(25), col(seasonal), col(seasonTime))
    // true next point is 100 + 24 + 10 = 134
    expect(val(f)).toBeCloseTo(134, -0.3)
  })

  it('confidence interval is non-negative and STAT step size is the timeline step', () => {
    expect(val(new ForecastEtsConfint('C').calculate(n(13), col(linear), col(time), n(0.95), n(0)))).toBeGreaterThanOrEqual(0)
    expect(val(new ForecastEtsStat('T').calculate(col(linear), col(time), n(8), n(0)))).toBe(1)
  })

  it('returns an error for a target inside the data and for uneven timelines', () => {
    const inside = new ForecastEts('F').calculate(n(5), col(linear), col(time))
    expect((inside as { isError(): boolean }).isError()).toBe(true)
    const uneven = new ForecastEts('F').calculate(n(20), col([1, 2, 3, 4]), col([1, 2, 3.5, 5]))
    expect((uneven as { isError(): boolean }).isError()).toBe(true)
  })
})
