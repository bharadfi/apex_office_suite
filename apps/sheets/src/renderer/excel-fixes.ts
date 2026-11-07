/**
 * Corrections where Univer's builtin disagrees with Excel (found by the
 * correctness pass in tests/excel-correctness.test.ts):
 *  - EDATE clamps to the end of a shorter month (31 Jan + 1 month = 29 Feb);
 *    Univer rolls over into March.
 *  - DOLLAR returns "$1,234.50", not "$1,234.50 " (the builtin keeps the
 *    trailing space of the accounting-style positive section).
 * Each fix wraps the builtin executor and only changes the case it fixes;
 * array and reference arguments still reach the builtin untouched.
 */
import {
  BaseFunction,
  ErrorType,
  ErrorValueObject,
  FUNCTION_NAMES_DATE,
  FUNCTION_NAMES_TEXT,
  IFunctionService,
  NumberValueObject,
  StringValueObject,
  functionDate,
  functionText,
  type BaseValueObject,
} from '@univerjs/engine-formula'

import type { UniverRuntime } from './univer-state'

type CalcResult = ReturnType<BaseFunction['calculate']>
type BuiltinCtor = new (name: string) => BaseFunction

interface Scalar {
  isError(): boolean
  isArray?(): boolean
  isReferenceObject?(): boolean
  isNumber?(): boolean
  isString?(): boolean
  isBoolean?(): boolean
  isNull?(): boolean
  getValue(): unknown
}

const isPlainScalar = (v: BaseValueObject): boolean => {
  const s = v as unknown as Scalar
  return !s.isError() && !s.isArray?.() && !s.isReferenceObject?.()
}

function builtin(map: ReadonlyArray<ReadonlyArray<unknown>>, name: string): BuiltinCtor | null {
  return (map.find(([, n]) => n === name)?.[0] as BuiltinCtor | undefined) ?? null
}

const DAY_MS = 86400000

export function addMonthsClamped(serial: number, months: number): number | null {
  if (serial < 0) return null
  const base = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * DAY_MS)
  const total = base.getUTCFullYear() * 12 + base.getUTCMonth() + Math.trunc(months)
  const year = Math.floor(total / 12)
  const month = ((total % 12) + 12) % 12
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const day = Math.min(base.getUTCDate(), lastDay)
  return Math.round((Date.UTC(year, month, day) - Date.UTC(1899, 11, 30)) / DAY_MS)
}

function createEdate(): BaseFunction | null {
  const Builtin = builtin(functionDate, FUNCTION_NAMES_DATE.EDATE)
  if (!Builtin) return null
  class EdateClamped extends Builtin {
    override calculate(...args: BaseValueObject[]): CalcResult {
      const [start, months] = args
      if (args.length === 2 && start && months && isPlainScalar(start) && isPlainScalar(months)) {
        const s = start as unknown as Scalar
        const m = months as unknown as Scalar
        const serial = typeof s.getValue() === 'number' ? (s.getValue() as number) : NaN
        const delta = typeof m.getValue() === 'number' ? (m.getValue() as number) : NaN
        if (Number.isFinite(serial) && Number.isFinite(delta)) {
          const result = addMonthsClamped(serial, delta)
          return result === null
            ? ErrorValueObject.create(ErrorType.NUM)
            : NumberValueObject.create(result)
        }
      }
      return (super.calculate as (...a: BaseValueObject[]) => CalcResult)(...args)
    }
  }
  return new EdateClamped(FUNCTION_NAMES_DATE.EDATE)
}

function createDollar(): BaseFunction | null {
  const Builtin = builtin(functionText, FUNCTION_NAMES_TEXT.DOLLAR)
  if (!Builtin) return null
  class DollarTrimmed extends Builtin {
    override calculate(...args: BaseValueObject[]): CalcResult {
      const result = (super.calculate as (...a: BaseValueObject[]) => CalcResult)(...args)
      const r = result as unknown as Scalar
      if (r && !r.isError() && !r.isArray?.() && typeof r.getValue() === 'string') {
        const text = r.getValue() as string
        const trimmed = text.replace(/ +$/, '')
        if (trimmed !== text) return StringValueObject.create(trimmed)
      }
      return result
    }
  }
  return new DollarTrimmed(FUNCTION_NAMES_TEXT.DOLLAR)
}

export function installExcelFixes(runtime: UniverRuntime): { dispose(): void } {
  const functionService = runtime.univer.__getInjector().get(IFunctionService)
  const executors = [createEdate(), createDollar()].filter(
    (executor): executor is BaseFunction => executor !== null,
  )
  const originals = executors.map((e) => functionService.getExecutor(e.name) ?? undefined)
  functionService.registerExecutors(...executors)
  // builtins land in one batch at plugin ready; re-assert once afterwards
  const timer = setTimeout(() => {
    const stale = executors.filter((e) => functionService.getExecutor(e.name) !== e)
    if (stale.length > 0) functionService.registerExecutors(...stale)
  }, 0)
  return {
    dispose() {
      clearTimeout(timer)
      for (const original of originals) {
        if (original) functionService.registerExecutors(original)
      }
    },
  }
}
