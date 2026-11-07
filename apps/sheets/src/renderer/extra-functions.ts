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

export function createExtraFunctionExecutors(): BaseFunction[] {
  return [
    new PercentOf('PERCENTOF'),
    new RegexTest('REGEXTEST'),
    new IsoCeiling('ISO.CEILING'),
    new InfoFunction('INFO'),
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
