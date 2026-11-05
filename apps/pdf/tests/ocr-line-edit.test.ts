import { describe, expect, it } from 'vitest'
import { ocrLineAt, ocrLines } from '../src/renderer/ocr-bake'
import { blur, correlation } from '../src/renderer/ocr-font-guess'
import type { PageGeom } from '../src/renderer/annotations'

const GEOM: PageGeom = { pw: 600, ph: 800, rot: 0, x0: 0, y0: 0 }

const word = (text: string, rect: [number, number, number, number]) => ({
  text,
  rect,
  spaceAfter: true,
})

describe('recognised lines', () => {
  const words = [
    word('The', [50, 700, 80, 712]),
    word('quick', [85, 700, 125, 712]),
    word('Next', [50, 650, 90, 662]),
  ]

  it('groups words into lines with the box they cover', () => {
    const lines = ocrLines(0, words, GEOM)
    expect(lines).toHaveLength(2)
    const first = lines.find((l) => l.insert.text.startsWith('The'))!
    expect(first.insert.text).toBe('The quick')
    expect(first.rect).toEqual([50, 700, 125, 712])
  })

  it('finds the line under a point, and none in the gaps between lines', () => {
    expect(ocrLineAt(0, words, GEOM, [100, 705])?.insert.text).toBe('The quick')
    expect(ocrLineAt(0, words, GEOM, [60, 655])?.insert.text).toBe('Next')
    expect(ocrLineAt(0, words, GEOM, [300, 400])).toBeNull()
  })
})

describe('font matching helpers', () => {
  it('scores a picture against itself as 1 and against its opposite as negative', () => {
    const a = new Float32Array([0, 1, 0, 1, 1, 0, 0, 1])
    const opposite = a.map((v) => 1 - v)
    expect(correlation(a, a)).toBeCloseTo(1)
    expect(correlation(a, opposite)).toBeCloseTo(-1)
    expect(correlation(new Float32Array(4), a.slice(0, 4))).toBe(0)
  })

  it('blurs ink into its neighbours without changing the total much', () => {
    const map = new Float32Array(25)
    map[12] = 1
    const out = blur(map, 5, 5)
    expect(out[12]).toBeGreaterThan(0)
    expect(out[11]).toBeGreaterThan(0)
    expect(out[0]).toBe(0)
  })
})
