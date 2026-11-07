/**
 * FORECAST.ETS, .CONFINT, .SEASONALITY and .STAT. Excel's AAA exponential
 * smoothing (parameter search, seasonality detection and confidence formulas)
 * is proprietary; this is an additive Holt-Winters fit with a grid search over
 * alpha/beta/gamma and autocorrelation-based season detection. Results follow
 * the same shape and behaviour as Excel's but are NOT numerically identical.
 */
import {
  BaseFunction,
  ErrorType,
  ErrorValueObject,
  NumberValueObject,
  type BaseValueObject,
} from '@univerjs/engine-formula'

type CalcResult = ReturnType<BaseFunction['calculate']>

interface Cell {
  isError(): boolean
  getValue(): unknown
}
interface Arr {
  isError(): boolean
  isArray?(): boolean
  isReferenceObject?(): boolean
  toArrayValueObject?(): Arr
  getArrayValue?(): Cell[][]
}

const fail = (type: ErrorType): CalcResult => ErrorValueObject.create(type)

function cells(value: BaseValueObject): Cell[] | null {
  let v = value as unknown as Arr
  if (v.isReferenceObject?.()) v = v.toArrayValueObject!()
  if (v.isError()) return null
  if (v.isArray?.()) return v.getArrayValue!().flat()
  return [v as unknown as Cell]
}

function num(value: BaseValueObject | undefined, fallback: number): number {
  if (!value) return fallback
  const n = Number(cells(value)?.[0]?.getValue())
  return Number.isFinite(n) ? n : fallback
}

interface Series {
  y: number[]
  start: number
  step: number
}

function aggregate(values: number[], mode: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  switch (mode) {
    case 2:
    case 3:
      return values.length
    case 4:
      return sorted[sorted.length - 1]!
    case 5: {
      const mid = sorted.length >> 1
      return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
    }
    case 6:
      return sorted[0]!
    case 7:
      return values.reduce((a, b) => a + b, 0)
    default:
      return values.reduce((a, b) => a + b, 0) / values.length
  }
}

function buildSeries(
  valueArg: BaseValueObject,
  timelineArg: BaseValueObject,
  completion: number,
  aggregation: number,
): Series | ErrorType {
  const v = cells(valueArg)
  const t = cells(timelineArg)
  if (!v || !t || v.length !== t.length || v.length < 3) return ErrorType.NA
  const points = new Map<number, number[]>()
  for (let i = 0; i < v.length; i++) {
    const time = Number(t[i]!.getValue())
    const value = Number(v[i]!.getValue())
    if (!Number.isFinite(time) || !Number.isFinite(value)) return ErrorType.VALUE
    points.set(time, [...(points.get(time) ?? []), value])
  }
  const times = [...points.keys()].sort((a, b) => a - b)
  if (times.length < 3) return ErrorType.NA
  let step = Infinity
  for (let i = 1; i < times.length; i++) step = Math.min(step, times[i]! - times[i - 1]!)
  if (!(step > 0)) return ErrorType.NUM
  for (let i = 1; i < times.length; i++) {
    const ratio = (times[i]! - times[i - 1]!) / step
    if (Math.abs(ratio - Math.round(ratio)) > 1e-6) return ErrorType.NUM
  }
  const count = Math.round((times[times.length - 1]! - times[0]!) / step) + 1
  const y: (number | null)[] = Array.from({ length: count }, () => null)
  for (const time of times) {
    y[Math.round((time - times[0]!) / step)] = aggregate(points.get(time)!, aggregation)
  }
  for (let i = 0; i < count; i++) {
    if (y[i] !== null) continue
    if (completion === 0) y[i] = 0
    else {
      let lo = i - 1
      while (y[lo] === null) lo--
      let hi = i + 1
      while (y[hi] === null) hi++
      y[i] = y[lo]! + ((y[hi]! - y[lo]!) * (i - lo)) / (hi - lo)
    }
  }
  return { y: y as number[], start: times[0]!, step }
}

function detectSeason(y: number[]): number {
  const n = y.length
  if (n < 6) return 0
  const d = y.slice(1).map((value, i) => value - y[i]!)
  const mean = d.reduce((a, b) => a + b, 0) / d.length
  const dev = d.map((x) => x - mean)
  const denom = dev.reduce((a, b) => a + b * b, 0)
  if (denom === 0) return 0
  let best = 0
  let bestAcf = 0.3
  for (let lag = 2; lag <= Math.floor(n / 2); lag++) {
    let acc = 0
    for (let i = lag; i < dev.length; i++) acc += dev[i]! * dev[i - lag]!
    const acf = acc / denom
    if (acf > bestAcf) {
      bestAcf = acf
      best = lag
    }
  }
  return best
}

interface Fit {
  alpha: number
  beta: number
  gamma: number
  level: number
  trend: number
  season: number[]
  period: number
  errors: number[]
}

function run(y: number[], period: number, alpha: number, beta: number, gamma: number): Fit {
  const n = y.length
  const m = period
  let level: number
  let trend: number
  const season: number[] = []
  if (m >= 2) {
    const first = y.slice(0, m).reduce((a, b) => a + b, 0) / m
    const second = y.slice(m, 2 * m).reduce((a, b) => a + b, 0) / m
    level = first
    trend = (second - first) / m
    for (let i = 0; i < m; i++) season.push(y[i]! - first)
  } else {
    level = y[0]!
    trend = y[1]! - y[0]!
  }
  const errors: number[] = []
  const startAt = m >= 2 ? m : 1
  if (m >= 2) level += trend * (m - 1) // level at the end of the first season
  for (let i = startAt; i < n; i++) {
    const s = m >= 2 ? season[i % m]! : 0
    const prediction = level + trend + s
    errors.push(y[i]! - prediction)
    const previousLevel = level
    level = alpha * (y[i]! - s) + (1 - alpha) * (level + trend)
    trend = beta * (level - previousLevel) + (1 - beta) * trend
    if (m >= 2) season[i % m] = gamma * (y[i]! - level) + (1 - gamma) * s
  }
  return { alpha, beta, gamma, level, trend, season, period: m, errors }
}

function fit(series: Series, seasonality: number): Fit {
  const y = series.y
  const period = seasonality === 1 ? detectSeason(y) : seasonality >= 2 ? Math.round(seasonality) : 0
  const usable = period >= 2 && y.length >= 2 * period ? period : 0
  const grid = [0.1, 0.3, 0.5, 0.7, 0.9]
  let best: Fit | null = null
  let bestSse = Infinity
  for (const alpha of grid) {
    for (const beta of grid) {
      for (const gamma of usable ? grid : [0]) {
        const candidate = run(y, usable, alpha, beta, gamma)
        const sse = candidate.errors.reduce((a, e) => a + e * e, 0)
        if (sse < bestSse) {
          bestSse = sse
          best = candidate
        }
      }
    }
  }
  return best!
}

function predict(model: Fit, n: number, h: number): number {
  const s = model.period >= 2 ? model.season[(n - 1 + h) % model.period]! : 0
  return model.level + h * model.trend + s
}

function normalInverse(p: number): number {
  // Abramowitz & Stegun 26.2.23, adequate for confidence levels
  const q = p < 0.5 ? p : 1 - p
  const t = Math.sqrt(-2 * Math.log(q))
  const z = t - (2.515517 + 0.802853 * t + 0.010328 * t * t) / (1 + 1.432788 * t + 0.189269 * t * t + 0.001308 * t * t * t)
  return p < 0.5 ? -z : z
}

function prepare(
  values: BaseValueObject,
  timeline: BaseValueObject,
  seasonality: number,
  completion: number,
  aggregation: number,
): { series: Series; model: Fit } | ErrorType {
  if (seasonality < 0 || (completion !== 0 && completion !== 1) || aggregation < 1 || aggregation > 7) {
    return ErrorType.NUM
  }
  const series = buildSeries(values, timeline, completion, aggregation)
  if (typeof series === 'string') return series
  return { series, model: fit(series, seasonality) }
}

export class ForecastEts extends BaseFunction {
  override minParams = 3
  override maxParams = 6
  override needsReferenceObject = true
  override calculate(
    target: BaseValueObject,
    values: BaseValueObject,
    timeline: BaseValueObject,
    seasonality?: BaseValueObject,
    completion?: BaseValueObject,
    aggregation?: BaseValueObject,
  ): CalcResult {
    const prepared = prepare(values, timeline, num(seasonality, 1), num(completion, 1), num(aggregation, 1))
    if (typeof prepared === 'string') return fail(prepared)
    const { series, model } = prepared
    const x = num(target, NaN)
    if (!Number.isFinite(x)) return fail(ErrorType.VALUE)
    const n = series.y.length
    const h = Math.round((x - series.start) / series.step) - (n - 1)
    if (h < 1) return fail(ErrorType.NUM)
    return NumberValueObject.create(predict(model, n, h))
  }
}

export class ForecastEtsConfint extends BaseFunction {
  override minParams = 3
  override maxParams = 7
  override needsReferenceObject = true
  override calculate(
    target: BaseValueObject,
    values: BaseValueObject,
    timeline: BaseValueObject,
    confidence?: BaseValueObject,
    seasonality?: BaseValueObject,
    completion?: BaseValueObject,
    aggregation?: BaseValueObject,
  ): CalcResult {
    const level = num(confidence, 0.95)
    if (!(level > 0 && level < 1)) return fail(ErrorType.NUM)
    const prepared = prepare(values, timeline, num(seasonality, 1), num(completion, 1), num(aggregation, 1))
    if (typeof prepared === 'string') return fail(prepared)
    const { series, model } = prepared
    const x = num(target, NaN)
    if (!Number.isFinite(x)) return fail(ErrorType.VALUE)
    const n = series.y.length
    const h = Math.round((x - series.start) / series.step) - (n - 1)
    if (h < 1) return fail(ErrorType.NUM)
    const sigma = Math.sqrt(model.errors.reduce((a, e) => a + e * e, 0) / Math.max(model.errors.length, 1))
    return NumberValueObject.create(normalInverse((1 + level) / 2) * sigma * Math.sqrt(h))
  }
}

export class ForecastEtsSeasonality extends BaseFunction {
  override minParams = 2
  override maxParams = 4
  override needsReferenceObject = true
  override calculate(
    values: BaseValueObject,
    timeline: BaseValueObject,
    completion?: BaseValueObject,
    aggregation?: BaseValueObject,
  ): CalcResult {
    const series = buildSeries(values, timeline, num(completion, 1), num(aggregation, 1))
    if (typeof series === 'string') return fail(series)
    return NumberValueObject.create(detectSeason(series.y))
  }
}

export class ForecastEtsStat extends BaseFunction {
  override minParams = 3
  override maxParams = 6
  override needsReferenceObject = true
  override calculate(
    values: BaseValueObject,
    timeline: BaseValueObject,
    statisticType: BaseValueObject,
    seasonality?: BaseValueObject,
    completion?: BaseValueObject,
    aggregation?: BaseValueObject,
  ): CalcResult {
    const type = Math.trunc(num(statisticType, 0))
    if (type < 1 || type > 8) return fail(ErrorType.NUM)
    const prepared = prepare(values, timeline, num(seasonality, 1), num(completion, 1), num(aggregation, 1))
    if (typeof prepared === 'string') return fail(prepared)
    const { series, model } = prepared
    const e = model.errors
    const count = Math.max(e.length, 1)
    const offset = series.y.length - e.length
    const mae = e.reduce((a, x) => a + Math.abs(x), 0) / count
    const naive =
      series.y.slice(1).reduce((a, v, i) => a + Math.abs(v - series.y[i]!), 0) / Math.max(series.y.length - 1, 1)
    const smape =
      e.reduce((a, x, i) => {
        const actual = series.y[offset + i]!
        const forecast = actual - x
        const d = Math.abs(actual) + Math.abs(forecast)
        return a + (d === 0 ? 0 : (2 * Math.abs(x)) / d)
      }, 0) / count
    const stats = [
      model.alpha,
      model.beta,
      model.gamma,
      naive === 0 ? 0 : mae / naive,
      smape,
      mae,
      Math.sqrt(e.reduce((a, x) => a + x * x, 0) / count),
      series.step,
    ]
    return NumberValueObject.create(stats[type - 1]!)
  }
}
