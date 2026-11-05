/** Median RGB of the pixels ringing `rect` (canvas px, y down): the page behind a run
    without the run's own ink. Null when the ring has no pixels inside the bitmap. */
export function ringMedianColor(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  rect: { x: number; y: number; w: number; h: number },
  ring: number,
): [number, number, number] | null {
  const x0 = Math.max(0, Math.floor(rect.x - ring))
  const y0 = Math.max(0, Math.floor(rect.y - ring))
  const x1 = Math.min(width, Math.ceil(rect.x + rect.w + ring))
  const y1 = Math.min(height, Math.ceil(rect.y + rect.h + ring))
  const ix0 = Math.floor(rect.x)
  const iy0 = Math.floor(rect.y)
  const ix1 = Math.ceil(rect.x + rect.w)
  const iy1 = Math.ceil(rect.y + rect.h)
  const r: number[] = []
  const g: number[] = []
  const b: number[] = []
  for (let y = y0; y < y1; y++) {
    const inY = y >= iy0 && y < iy1
    for (let x = x0; x < x1; x++) {
      if (inY && x >= ix0 && x < ix1) continue
      const i = (y * width + x) * 4
      if (data[i + 3]! < 128) continue
      r.push(data[i]!)
      g.push(data[i + 1]!)
      b.push(data[i + 2]!)
    }
  }
  if (r.length === 0) return null
  const med = (a: number[]) => a.sort((p, q) => p - q)[a.length >> 1]!
  return [med(r), med(g), med(b)]
}

const hex2 = (v: number) => v.toString(16).padStart(2, '0')

/** Sample the page bitmap around a run's CSS box (page-relative px) as a CSS color.
    Null when the page has no rendered canvas yet or the bitmap is unreadable. */
export function samplePaperColor(
  pageEl: Element | null,
  box: { left: number; top: number; width: number; height: number },
): string | null {
  const canvas = pageEl?.querySelector('canvas')
  if (!canvas || canvas.width === 0 || canvas.clientWidth === 0) return null
  const k = canvas.width / canvas.clientWidth
  // A thin band just outside the run; glyph ink can poke a little past the layout box
  const ring = Math.max(2, Math.round(3 * k))
  const pad = Math.round(2 * k)
  const rect = {
    x: box.left * k - pad,
    y: box.top * k - pad,
    w: box.width * k + pad * 2,
    h: box.height * k + pad * 2,
  }
  const x0 = Math.max(0, Math.floor(rect.x - ring))
  const y0 = Math.max(0, Math.floor(rect.y - ring))
  const x1 = Math.min(canvas.width, Math.ceil(rect.x + rect.w + ring))
  const y1 = Math.min(canvas.height, Math.ceil(rect.y + rect.h + ring))
  if (x1 <= x0 || y1 <= y0) return null
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    const img = ctx.getImageData(x0, y0, x1 - x0, y1 - y0)
    const c = ringMedianColor(
      img.data,
      img.width,
      img.height,
      { x: rect.x - x0, y: rect.y - y0, w: rect.w, h: rect.h },
      ring,
    )
    return c ? `#${hex2(c[0])}${hex2(c[1])}${hex2(c[2])}` : null
  } catch {
    return null
  }
}

/** The colour text is printed in inside `box`: the average of the darkest tenth of its pixels
    (or the lightest tenth when the page behind is dark). Null when the bitmap is unreadable. */
export function sampleInkColor(
  pageEl: Element | null,
  box: { left: number; top: number; width: number; height: number },
  paperHex: string | undefined,
): string | null {
  const canvas = pageEl?.querySelector('canvas')
  if (!canvas || canvas.width === 0 || canvas.clientWidth === 0) return null
  const k = canvas.width / canvas.clientWidth
  const x0 = Math.max(0, Math.floor(box.left * k))
  const y0 = Math.max(0, Math.floor(box.top * k))
  const x1 = Math.min(canvas.width, Math.ceil((box.left + box.width) * k))
  const y1 = Math.min(canvas.height, Math.ceil((box.top + box.height) * k))
  if (x1 <= x0 || y1 <= y0) return null
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    const { data } = ctx.getImageData(x0, y0, x1 - x0, y1 - y0)
    const px: { lum: number; rgb: [number, number, number] }[] = []
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3]! < 128) continue
      const rgb: [number, number, number] = [data[i]!, data[i + 1]!, data[i + 2]!]
      px.push({ lum: 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2], rgb })
    }
    if (px.length === 0) return null
    const paperLum = paperHex
      ? 0.299 * parseInt(paperHex.slice(1, 3), 16) +
        0.587 * parseInt(paperHex.slice(3, 5), 16) +
        0.114 * parseInt(paperHex.slice(5, 7), 16)
      : 255
    px.sort((p, q) => (paperLum > 127 ? p.lum - q.lum : q.lum - p.lum))
    const take = px.slice(0, Math.max(1, Math.floor(px.length / 10)))
    const avg = [0, 1, 2].map((c) =>
      Math.round(take.reduce((s, p) => s + p.rgb[c]!, 0) / take.length),
    )
    return `#${hex2(avg[0]!)}${hex2(avg[1]!)}${hex2(avg[2]!)}`
  } catch {
    return null
  }
}
