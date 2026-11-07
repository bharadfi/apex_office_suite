import { ArrayValueObject, NumberValueObject, StringValueObject } from '@univerjs/engine-formula'
import { describe, expect, it } from 'vitest'

import { GroupBy, PivotBy } from '../src/renderer/group-by'

const arr = (rows: unknown[][]) =>
  ArrayValueObject.create({
    calculateValueList: rows.map((r) =>
      r.map((v) => (typeof v === 'number' ? NumberValueObject.create(v) : StringValueObject.create(String(v)))),
    ),
    rowCount: rows.length,
    columnCount: rows[0]!.length,
    unitId: '',
    sheetId: '',
    row: 0,
    column: 0,
  } as never)

// a stand-in for LAMBDA(x,SUM(x)): Univer's lambda objects expose isLambda/execute
const sumLambda = {
  isError: () => false,
  isLambda: () => true,
  execute: (a: { getArrayValue(): { getValue(): unknown }[][] }) =>
    NumberValueObject.create(a.getArrayValue().reduce((t, r) => t + Number(r[0]!.getValue()), 0)),
} as never

const dump = (r: unknown) =>
  (r as { getArrayValue(): { getValue(): unknown }[][] }).getArrayValue().map((row) => row.map((c) => c.getValue()))

describe('GROUPBY / PIVOTBY', () => {
  const keys = arr([['b'], ['a'], ['b'], ['a'], ['c']])
  const vals = arr([[1], [2], [3], [4], [5]])

  it('groups, sorts ascending and appends a grand total', () => {
    const out = dump(new GroupBy('GROUPBY').calculate(keys, vals, sumLambda))
    expect(out).toEqual([['a', 6], ['b', 4], ['c', 5], ['Total', 15]])
  })

  it('honours descending sort on the value column and total_depth 0', () => {
    const out = dump(
      new GroupBy('GROUPBY').calculate(keys, vals, sumLambda, undefined, NumberValueObject.create(0), NumberValueObject.create(-2)),
    )
    expect(out).toEqual([['a', 6], ['c', 5], ['b', 4]])
  })

  it('pivots rows by columns with totals', () => {
    const rows = arr([['x'], ['x'], ['y']])
    const cols = arr([['p'], ['q'], ['p']])
    const v = arr([[1], [2], [4]])
    const out = dump(new PivotBy('PIVOTBY').calculate(rows, cols, v, sumLambda))
    expect(out).toEqual([
      ['', 'p', 'q', 'Total'],
      ['x', 1, 2, 3],
      ['y', 4, '', 4],
      ['Total', 5, 2, 7],
    ])
  })

  it('rejects a non-lambda aggregator', () => {
    const r = new GroupBy('GROUPBY').calculate(keys, vals, NumberValueObject.create(1))
    expect((r as { isError(): boolean }).isError()).toBe(true)
  })
})
