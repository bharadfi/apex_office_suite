import { EDIT_FONTS } from '../shared/ipc'

/**
 * Which of the editor's fonts a line of a scanned page is closest to. A picture of text has no
 * font name to read, so each candidate (face, weight, slant) is drawn at the line's size, stretched
 * to the line's width, and compared with the page picture: the best match wins. The editor offers
 * a few faces, so this chooses between serif, sans and monospaced and between regular and bold.
 */

export interface FontGuess {
  font: (typeof EDIT_FONTS)[number]['id']
  bold?: true
  italic?: true
}

const H = 40
const BLUR = 1

/** Normalised cross-correlation of two equally sized ink maps (1 = same picture, 0 = unrelated) */
export function correlation(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length)
  if (n === 0) return 0
  let ma = 0
  let mb = 0
  for (let i = 0; i < n; i++) {
    ma += a[i]!
    mb += b[i]!
  }
  ma /= n
  mb /= n
  let num = 0
  let da = 0
  let db = 0
  for (let i = 0; i < n; i++) {
    const x = a[i]! - ma
    const y = b[i]! - mb
    num += x * y
    da += x * x
    db += y * y
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0
}

/** A small box blur, so strokes a pixel off still overlap */
export function blur(map: Float32Array, w: number, h: number, r = BLUR): Float32Array {
  const out = new Float32Array(map.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0
      let count = 0
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx
          const yy = y + dy
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
          sum += map[yy * w + xx]!
          count++
        }
      }
      out[y * w + x] = sum / count
    }
  }
  return out
}

/** How far each pixel is from the paper, 0..1 */
function inkMap(data: Uint8ClampedArray, paperLum: number): Float32Array {
  const out = new Float32Array(data.length / 4)
  for (let i = 0; i < out.length; i++) {
    const lum = 0.299 * data[i * 4]! + 0.587 * data[i * 4 + 1]! + 0.114 * data[i * 4 + 2]!
    out[i] = Math.min(1, Math.abs(lum - paperLum) / 128)
  }
  return out
}

/**
 * Compare the line in `box` (page-relative CSS px) of the page canvas under `pageEl` with each
 * candidate face. Null when the picture cannot be read.
 */
export function guessLineFont(
  pageEl: Element | null,
  box: { left: number; top: number; width: number; height: number },
  text: string,
  available: readonly string[],
): FontGuess | null {
  const canvas = pageEl?.querySelector('canvas')
  if (!canvas || canvas.width === 0 || canvas.clientWidth === 0 || !text.trim()) return null
  const k = canvas.width / canvas.clientWidth
  const sx = Math.max(0, Math.floor(box.left * k))
  const sy = Math.max(0, Math.floor(box.top * k))
  const sw = Math.min(canvas.width - sx, Math.ceil(box.width * k))
  const sh = Math.min(canvas.height - sy, Math.ceil(box.height * k))
  if (sw < 8 || sh < 4) return null
  const w = Math.max(16, Math.min(600, Math.round((sw / sh) * H)))
  try {
    const scratch = document.createElement('canvas')
    scratch.width = w
    scratch.height = H
    const ctx = scratch.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.imageSmoothingEnabled = true
    ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, w, H)
    const picture = ctx.getImageData(0, 0, w, H).data
    // paper = the lightest/darkest common value: the median of the border pixels
    const border: number[] = []
    for (let x = 0; x < w; x++) {
      for (const y of [0, H - 1]) {
        const i = (y * w + x) * 4
        border.push(0.299 * picture[i]! + 0.587 * picture[i + 1]! + 0.114 * picture[i + 2]!)
      }
    }
    border.sort((p, q) => p - q)
    const target = blur(inkMap(picture, border[border.length >> 1]!), w, H)

    let best: { guess: FontGuess; score: number } | null = null
    for (const face of EDIT_FONTS) {
      if (available.length > 0 && !available.includes(face.id)) continue
      for (const bold of [false, true]) {
        for (const italic of [false, true]) {
          ctx.fillStyle = '#fff'
          ctx.fillRect(0, 0, w, H)
          ctx.fillStyle = '#000'
          ctx.font = `${italic ? 'italic ' : ''}${bold ? '700 ' : '400 '}${H * 0.7}px ${face.css}`
          ctx.textBaseline = 'alphabetic'
          const natural = ctx.measureText(text).width
          if (natural <= 0) continue
          ctx.save()
          ctx.scale(w / natural, 1)
          ctx.fillText(text, 0, H * 0.74)
          ctx.restore()
          const drawn = blur(inkMap(ctx.getImageData(0, 0, w, H).data, 255), w, H)
          const score = correlation(target, drawn)
          if (!best || score > best.score) {
            best = {
              score,
              guess: {
                font: face.id,
                ...(bold ? { bold: true as const } : {}),
                ...(italic ? { italic: true as const } : {}),
              },
            }
          }
        }
      }
    }
    return best?.guess ?? null
  } catch {
    return null
  }
}
