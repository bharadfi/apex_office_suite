/**
 * Excel functions Univer 0.25 does not register: PERCENTOF, REGEXTEST,
 * ISO.CEILING, INFO. Each is a BaseFunction executor added to the live
 * function service; builtins are never replaced (hasExecutor guard).
 */
import {
  BaseFunction,
  BooleanValueObject,
  ErrorType,
  ErrorValueObject,
  IFunctionService,
  NumberValueObject,
  StringValueObject,
  type BaseValueObject,
} from '@univerjs/engine-formula'

import type { UniverRuntime } from './univer-state'

type CalcResult = ReturnType<BaseFunction['calculate']>

interface ValueLike {
  isError(): boolean
  isArray?(): boolean
  isReferenceObject?(): boolean
  toArrayValueObject?(): ValueLike
  getArrayValue?(): ValueLike[][]
  getValue?(): unknown
}

function err(type: ErrorType): CalcResult {
  return ErrorValueObject.create(type)
}

function cells(value: BaseValueObject): ValueLike[] {
  let v = value as unknown as ValueLike
  if (v.isReferenceObject?.()) v = v.toArrayValueObject!()
  if (v.isArray?.()) return v.getArrayValue!().flat()
  return [v]
}

function numbers(value: BaseValueObject): number[] | ErrorType {
  const out: number[] = []
  for (const cell of cells(value)) {
    if (cell.isError()) return ErrorType.VALUE
    const raw = cell.getValue?.()
    if (typeof raw === 'number') out.push(raw)
    else if (typeof raw === 'boolean') continue
  }
  return out
}

function scalar(value: BaseValueObject): ValueLike {
  return cells(value)[0] ?? ({ isError: () => false, getValue: () => '' } as ValueLike)
}

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0)

export class PercentOf extends BaseFunction {
  override minParams = 2
  override maxParams = 2
  override needsReferenceObject = false
  override calculate(subset: BaseValueObject, all: BaseValueObject): CalcResult {
    const part = numbers(subset)
    const total = numbers(all)
    if (typeof part === 'string' || typeof total === 'string') return err(ErrorType.VALUE)
    const denominator = sum(total)
    if (denominator === 0) return err(ErrorType.DIV_BY_ZERO)
    return NumberValueObject.create(sum(part) / denominator)
  }
}

export class RegexTest extends BaseFunction {
  override minParams = 2
  override maxParams = 3
  override calculate(
    text: BaseValueObject,
    pattern: BaseValueObject,
    caseSensitivity?: BaseValueObject,
  ): CalcResult {
    const t = scalar(text)
    const p = scalar(pattern)
    if (t.isError()) return text as CalcResult
    if (p.isError()) return pattern as CalcResult
    const mode = caseSensitivity ? Number(scalar(caseSensitivity).getValue?.()) : 0
    if (mode !== 0 && mode !== 1) return err(ErrorType.VALUE)
    try {
      return BooleanValueObject.create(
        new RegExp(String(p.getValue?.() ?? ''), mode === 1 ? 'iu' : 'u').test(
          String(t.getValue?.() ?? ''),
        ),
      )
    } catch {
      return err(ErrorType.VALUE)
    }
  }
}

export class IsoCeiling extends BaseFunction {
  override minParams = 1
  override maxParams = 2
  override calculate(number: BaseValueObject, significance?: BaseValueObject): CalcResult {
    const n = scalar(number)
    if (n.isError()) return number as CalcResult
    const x = Number(n.getValue?.())
    const sig = significance ? Math.abs(Number(scalar(significance).getValue?.())) : 1
    if (!Number.isFinite(x) || !Number.isFinite(sig)) return err(ErrorType.VALUE)
    if (sig === 0 || x === 0) return NumberValueObject.create(0)
    // Always rounds toward +infinity, regardless of the sign of either argument.
    return NumberValueObject.create(Math.ceil(x / sig) * sig)
  }
}

export class InfoFunction extends BaseFunction {
  override minParams = 1
  override maxParams = 1
  override calculate(type: BaseValueObject): CalcResult {
    const t = scalar(type)
    if (t.isError()) return type as CalcResult
    switch (String(t.getValue?.()).toLowerCase()) {
      case 'recalc':
        return StringValueObject.create('Automatic')
      case 'system':
        return StringValueObject.create('pcdos')
      case 'numfile':
        return NumberValueObject.create(1)
      case 'release':
        return StringValueObject.create('16.0')
      case 'osversion':
        return StringValueObject.create('Windows (64-bit) NT 10.00')
      case 'origin':
        return StringValueObject.create('$A:$A$1')
      default:
        return err(ErrorType.VALUE)
    }
  }
}

export class Jis extends BaseFunction {
  override minParams = 1
  override maxParams = 1
  override calculate(text: BaseValueObject): CalcResult {
    const t = scalar(text)
    if (t.isError()) return text as CalcResult
    const converted = String(t.getValue?.() ?? '').replace(/[ -~]/g, (ch) =>
      ch === ' ' ? '　' : String.fromCharCode(ch.charCodeAt(0) + 0xfee0),
    )
    return StringValueObject.create(converted)
  }
}

/// No furigana data is stored in the workbook model, so PHONETIC answers the
/// referenced text itself (Excel's behaviour for cells without phonetic info).
export class Phonetic extends BaseFunction {
  override minParams = 1
  override maxParams = 1
  override calculate(reference: BaseValueObject): CalcResult {
    const r = scalar(reference)
    if (r.isError()) return reference as CalcResult
    return StringValueObject.create(String(r.getValue?.() ?? ''))
  }
}

const DAY_MS = 86400000
function serialToDate(serial: number): Date {
  return new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * DAY_MS)
}

function yearFraction(startSerial: number, endSerial: number, basis: number): number {
  const a = serialToDate(startSerial)
  const b = serialToDate(endSerial)
  const days = Math.round((b.getTime() - a.getTime()) / DAY_MS)
  if (basis === 2) return days / 360
  if (basis === 3) return days / 365
  if (basis === 1) {
    const y1 = a.getUTCFullYear()
    const y2 = b.getUTCFullYear()
    let total = 0
    for (let y = y1; y <= y2; y++) {
      total += (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 366 : 365
    }
    return days / (total / (y2 - y1 + 1))
  }
  let d1 = a.getUTCDate()
  let d2 = b.getUTCDate()
  if (basis === 4) {
    d1 = Math.min(d1, 30)
    d2 = Math.min(d2, 30)
  } else {
    if (d1 === 31) d1 = 30
    if (d2 === 31 && d1 >= 30) d2 = 30
  }
  return (
    (360 * (b.getUTCFullYear() - a.getUTCFullYear()) +
      30 * (b.getUTCMonth() - a.getUTCMonth()) +
      (d2 - d1)) /
    360
  )
}

export class Amordegrc extends BaseFunction {
  override minParams = 6
  override maxParams = 7
  override calculate(...args: BaseValueObject[]): CalcResult {
    const v = args.map((x) => scalar(x))
    for (const x of v) if (x.isError()) return x as CalcResult
    const [cost0, purchased, firstPeriod, salvage, period, rate0] = v
      .slice(0, 6)
      .map((x) => Number(x.getValue?.()))
    const basis = v[6] ? Number(v[6].getValue?.()) : 0
    const nums = [cost0, purchased, firstPeriod, salvage, period, rate0, basis]
    if (nums.some((n) => !Number.isFinite(n))) return err(ErrorType.VALUE)
    if (cost0! <= 0 || rate0! <= 0 || period! < 0 || salvage! < 0 || salvage! > cost0! || basis < 0 || basis > 4) {
      return err(ErrorType.NUM)
    }
    if (purchased! > firstPeriod!) return err(ErrorType.NUM)
    const life = 1 / rate0!
    const coefficient = life < 3 ? 1 : life < 5 ? 1.5 : life <= 6 ? 2 : 2.5
    const rate = rate0! * coefficient
    let cost = cost0!
    let depreciation = Math.round(yearFraction(purchased!, firstPeriod!, basis) * rate * cost)
    cost -= depreciation
    let rest = cost - salvage!
    for (let n = 0; n < period!; n++) {
      depreciation = Math.round(rate * cost)
      rest -= depreciation
      if (rest < 0) {
        const remaining = period! - n
        return NumberValueObject.create(remaining <= 1 ? Math.round(cost * 0.5) : 0)
      }
      cost -= depreciation
    }
    return NumberValueObject.create(depreciation)
  }
}

export function createExtraFunctionExecutors(): BaseFunction[] {
  return [
    new PercentOf('PERCENTOF'),
    new RegexTest('REGEXTEST'),
    new IsoCeiling('ISO.CEILING'),
    new InfoFunction('INFO'),
    new Jis('JIS'),
    new Phonetic('PHONETIC'),
    new Amordegrc('AMORDEGRC'),
  ]
}

export function installExtraFunctions(runtime: UniverRuntime): { dispose(): void } {
  const functionService = runtime.univer.__getInjector().get(IFunctionService)
  const executors = createExtraFunctionExecutors()
  const register = (): void => {
    const missing = executors.filter((executor) => !functionService.hasExecutor(executor.name))
    if (missing.length > 0) functionService.registerExecutors(...missing)
  }
  register()
  // Builtins land in one batch at plugin ready; re-check once afterwards.
  const timer = setTimeout(register, 0)
  return {
    dispose() {
      clearTimeout(timer)
    },
  }
}
