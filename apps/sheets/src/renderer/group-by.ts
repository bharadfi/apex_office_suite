/**
 * GROUPBY / PIVOTBY (Excel 365). The aggregation argument must be a LAMBDA
 * (`LAMBDA(x,SUM(x))`) because Univer cannot pass a bare function name such as
 * SUM as a value. Supported options: field_headers (0 none, 1 headers present
 * and hidden-not-shown, 3 headers present and shown for GROUPBY), total_depth
 * (0 none, otherwise one grand total), sort_order (GROUPBY: column number,
 * negative = descending), filter_array. Subtotals and relationship options are
 * not implemented and answer #VALUE!.
 */
import {
  ArrayValueObject,
  BaseFunction,
  ErrorType,
  ErrorValueObject,
  NumberValueObject,
  StringValueObject,
  type BaseValueObject,
} from '@univerjs/engine-formula'

type CalcResult = ReturnType<BaseFunction['calculate']>

interface Cell {
  isError(): boolean
  isNull?(): boolean
  getValue(): unknown
}
interface Arr {
  isError(): boolean
  isArray?(): boolean
  isReferenceObject?(): boolean
  toArrayValueObject?(): Arr
  getRowCount?(): number
  getColumnCount?(): number
  getArrayValue?(): Cell[][]
  isLambda?(): boolean
  execute?(...args: unknown[]): BaseValueObject
}

function grid(value: BaseValueObject): Cell[][] | null {
  let v = value as unknown as Arr
  if (v.isReferenceObject?.()) v = v.toArrayValueObject!()
  if (v.isError()) return null
  if (v.isArray?.()) return v.getArrayValue!()
  return [[v as unknown as Cell]]
}

function scalarNumber(value: BaseValueObject | undefined, fallback: number): number {
  if (!value) return fallback
  const g = grid(value)
  const n = Number(g?.[0]?.[0]?.getValue())
  return Number.isFinite(n) ? n : fallback
}

function label(value: unknown): BaseValueObject {
  return typeof value === 'number'
    ? NumberValueObject.create(value)
    : StringValueObject.create(String(value ?? ''))
}

function compare(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'number') return -1
  if (typeof b === 'number') return 1
  return String(a).localeCompare(String(b), undefined, { sensitivity: 'base' })
}

function column(values: Cell[]): BaseValueObject {
  return ArrayValueObject.create({
    calculateValueList: values.map((v) => [v]),
    rowCount: values.length,
    columnCount: 1,
    unitId: '',
    sheetId: '',
    row: 0,
    column: 0,
  } as unknown as Parameters<typeof ArrayValueObject.create>[0]) as unknown as BaseValueObject
}

function aggregate(lambda: Arr, values: Cell[]): BaseValueObject {
  let result = lambda.execute!(column(values)) as unknown as Arr & BaseValueObject
  if ((result as unknown as Arr).isArray?.()) {
    const first = (result as unknown as Arr).getArrayValue!()[0]?.[0]
    if (first) result = first as unknown as Arr & BaseValueObject
  }
  return result as BaseValueObject
}

function table(rows: BaseValueObject[][]): CalcResult {
  return ArrayValueObject.create({
    calculateValueList: rows,
    rowCount: rows.length,
    columnCount: rows[0]?.length ?? 0,
    unitId: '',
    sheetId: '',
    row: 0,
    column: 0,
  } as unknown as Parameters<typeof ArrayValueObject.create>[0]) as unknown as CalcResult
}

const blank = (): BaseValueObject => StringValueObject.create('')
const bad = (type: ErrorType): CalcResult => ErrorValueObject.create(type)

function lambdaOf(value: BaseValueObject): Arr | null {
  const v = value as unknown as Arr & { isValueObject?(): boolean }
  return v.isLambda?.() ? v : null
}

function filtered(rows: Cell[][], filter: BaseValueObject | undefined): boolean[] {
  const keep = rows.map(() => true)
  if (!filter) return keep
  const g = grid(filter)
  if (!g) return keep
  const flat = g.map((r) => r[0]!.getValue())
  return keep.map((_, i) => flat[i] === true || (typeof flat[i] === 'number' && flat[i] !== 0))
}

export class GroupBy extends BaseFunction {
  override minParams = 3
  override maxParams = 8
  override needsReferenceObject = true

  override calculate(
    rowFields: BaseValueObject,
    values: BaseValueObject,
    func: BaseValueObject,
    headers?: BaseValueObject,
    totalDepth?: BaseValueObject,
    sortOrder?: BaseValueObject,
    filterArray?: BaseValueObject,
    relationship?: BaseValueObject,
  ): CalcResult {
    const lambda = lambdaOf(func)
    const keys = grid(rowFields)
    const vals = grid(values)
    if (!lambda || !keys || !vals || keys.length !== vals.length) return bad(ErrorType.VALUE)
    if (relationship && scalarNumber(relationship, 0) !== 0) return bad(ErrorType.VALUE)
    const headerMode = scalarNumber(headers, 0)
    const depth = scalarNumber(totalDepth, 1)
    if (Math.abs(depth) > 1) return bad(ErrorType.VALUE)
    const hasHeader = headerMode === 1 || headerMode === 3
    const keyCols = keys[0]!.length
    const valCols = vals[0]!.length
    const body = hasHeader ? 1 : 0
    const keep = filtered(keys.slice(body), filterArray)

    const groups = new Map<string, { key: unknown[]; rows: number[] }>()
    for (let i = body; i < keys.length; i++) {
      if (!keep[i - body]) continue
      const key = keys[i]!.map((c) => c.getValue())
      const id = JSON.stringify(key)
      const g = groups.get(id) ?? { key, rows: [] }
      g.rows.push(i)
      groups.set(id, g)
    }
    const order = [...groups.values()]
    const sortColumn = scalarNumber(sortOrder, 1)
    const sortIndex = Math.min(Math.max(Math.abs(Math.trunc(sortColumn)) || 1, 1), keyCols + valCols) - 1
    const direction = sortColumn < 0 ? -1 : 1
    const cellOf = (g: (typeof order)[number]): unknown =>
      sortIndex < keyCols
        ? g.key[sortIndex]
        : (aggregate(lambda, g.rows.map((r) => vals[r]![sortIndex - keyCols]!)) as unknown as Cell).getValue()
    order.sort((a, b) => direction * compare(cellOf(a), cellOf(b)))

    const out: BaseValueObject[][] = []
    if (headerMode === 3) {
      out.push([
        ...keys[0]!.map((c) => label(c.getValue())),
        ...vals[0]!.map((c) => label(c.getValue())),
      ])
    }
    for (const g of order) {
      out.push([
        ...g.key.map(label),
        ...Array.from({ length: valCols }, (_, c) =>
          aggregate(lambda, g.rows.map((r) => vals[r]![c]!)),
        ),
      ])
    }
    if (depth !== 0 && order.length > 0) {
      const all = order.flatMap((g) => g.rows)
      const total = [label('Total'), ...Array.from({ length: keyCols - 1 }, blank)]
      const sums = Array.from({ length: valCols }, (_, c) =>
        aggregate(lambda, all.map((r) => vals[r]![c]!)),
      )
      const row = [...total, ...sums]
      depth < 0 ? out.unshift(row) : out.push(row)
    }
    return out.length > 0 ? table(out) : bad(ErrorType.CALC)
  }
}

export class PivotBy extends BaseFunction {
  override minParams = 4
  override maxParams = 11
  override needsReferenceObject = true

  override calculate(
    rowFields: BaseValueObject,
    colFields: BaseValueObject,
    values: BaseValueObject,
    func: BaseValueObject,
    headers?: BaseValueObject,
    rowTotalDepth?: BaseValueObject,
    rowSortOrder?: BaseValueObject,
    colTotalDepth?: BaseValueObject,
    colSortOrder?: BaseValueObject,
    filterArray?: BaseValueObject,
    relationship?: BaseValueObject,
  ): CalcResult {
    const lambda = lambdaOf(func)
    const rk = grid(rowFields)
    const ck = grid(colFields)
    const vals = grid(values)
    if (!lambda || !rk || !ck || !vals || rk.length !== ck.length || rk.length !== vals.length) {
      return bad(ErrorType.VALUE)
    }
    if (relationship && scalarNumber(relationship, 0) !== 0) return bad(ErrorType.VALUE)
    const headerMode = scalarNumber(headers, 0)
    const hasHeader = headerMode === 1 || headerMode === 3
    const rowTotals = scalarNumber(rowTotalDepth, 1) !== 0
    const colTotals = scalarNumber(colTotalDepth, 1) !== 0
    const body = hasHeader ? 1 : 0
    const keep = filtered(rk.slice(body), filterArray)

    const rowIds = new Map<string, unknown[]>()
    const colIds = new Map<string, unknown[]>()
    const cellRows = new Map<string, number[]>()
    for (let i = body; i < rk.length; i++) {
      if (!keep[i - body]) continue
      const r = rk[i]!.map((c) => c.getValue())
      const c = ck[i]!.map((x) => x.getValue())
      const rid = JSON.stringify(r)
      const cid = JSON.stringify(c)
      rowIds.set(rid, r)
      colIds.set(cid, c)
      const k = `${rid}|${cid}`
      cellRows.set(k, [...(cellRows.get(k) ?? []), i])
    }
    const sortKeys = (m: Map<string, unknown[]>, order: BaseValueObject | undefined) => {
      const dir = scalarNumber(order, 1) < 0 ? -1 : 1
      return [...m.entries()].sort(([, a], [, b]) => {
        for (let i = 0; i < a.length; i++) {
          const d = compare(a[i], b[i])
          if (d !== 0) return dir * d
        }
        return 0
      })
    }
    const rows = sortKeys(rowIds, rowSortOrder)
    const cols = sortKeys(colIds, colSortOrder)
    const valueAt = (indices: number[]): BaseValueObject =>
      indices.length === 0 ? blank() : aggregate(lambda, indices.map((r) => vals[r]![0]!))

    const rowKeyCols = rk[0]!.length
    const out: BaseValueObject[][] = []
    const header: BaseValueObject[] = [
      ...Array.from({ length: rowKeyCols }, () => blank()),
      ...cols.map(([, c]) => label(c.join(' '))),
    ]
    if (rowTotals) header.push(label('Total'))
    out.push(header)
    for (const [rid, r] of rows) {
      const line: BaseValueObject[] = [...r.map(label)]
      for (const [cid] of cols) line.push(valueAt(cellRows.get(`${rid}|${cid}`) ?? []))
      if (rowTotals) {
        line.push(valueAt(cols.flatMap(([cid]) => cellRows.get(`${rid}|${cid}`) ?? [])))
      }
      out.push(line)
    }
    if (colTotals) {
      const line: BaseValueObject[] = [label('Total'), ...Array.from({ length: rowKeyCols - 1 }, blank)]
      for (const [cid] of cols) {
        line.push(valueAt(rows.flatMap(([rid]) => cellRows.get(`${rid}|${cid}`) ?? [])))
      }
      if (rowTotals) line.push(valueAt([...cellRows.values()].flat()))
      out.push(line)
    }
    return table(out)
  }
}
