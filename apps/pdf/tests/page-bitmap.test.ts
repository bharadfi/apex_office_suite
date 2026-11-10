import { describe, expect, it } from 'vitest'
import { MAX_PAGE_RENDER_PIXELS, MAX_PAGE_RENDER_SIDE, pageRenderDpr } from '../src/renderer/page-bitmap'

const ZOOM_STEPS = [0.1, 0.25, 0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6, 8]

/** page sizes in points: A4, A0, a long web-page print, a banner, a huge poster, a tiny label */
const PAGES: Array<[string, number, number]> = [
  ['A4', 595, 842],
  ['A0', 2384, 3370],
  ['long page', 595, 30_000],
  ['banner', 14_400, 600],
  ['poster', 14_400, 14_400],
  ['label', 72, 36],
]

describe('page bitmap size', () => {
  it('never asks the browser for more than the pixel budget or the longest-side limit', () => {
    for (const [, w, h] of PAGES) {
      for (const zoom of ZOOM_STEPS) {
        for (const deviceDpr of [1, 1.5, 2, 3]) {
          const cssW = w * zoom
          const cssH = h * zoom
          const dpr = pageRenderDpr(cssW, cssH, deviceDpr)
          expect(dpr).toBeGreaterThan(0)
          expect(Math.floor(cssW * dpr)).toBeLessThanOrEqual(MAX_PAGE_RENDER_SIDE)
          expect(Math.floor(cssH * dpr)).toBeLessThanOrEqual(MAX_PAGE_RENDER_SIDE)
          expect(cssW * dpr * cssH * dpr).toBeLessThanOrEqual(MAX_PAGE_RENDER_PIXELS * 1.0001)
        }
      }
    }
  })

  it('keeps a normal page sharp at every zoom step on an ordinary screen', () => {
    for (const zoom of ZOOM_STEPS) {
      // an A4 page is pixel-for-pixel up to 800% on a 1x display and keeps 1x on a 2x display
      expect(pageRenderDpr(595 * zoom, 842 * zoom, 1)).toBe(1)
    }
    expect(pageRenderDpr(595, 842, 2)).toBe(2)
  })

  it('shrinks a very wide page by its longest side, which the pixel budget alone did not', () => {
    // 800% of a 14,400 x 600 banner: 115,200 x 4,800 css px. The pixel budget alone allows a
    // bitmap ~33,900 px wide, which the browser leaves blank past about 32,767 px.
    const dpr = pageRenderDpr(14_400 * 8, 600 * 8, 1)
    expect(Math.floor(14_400 * 8 * dpr)).toBeLessThanOrEqual(MAX_PAGE_RENDER_SIDE)
    const budgetOnly = Math.sqrt(MAX_PAGE_RENDER_PIXELS / (14_400 * 8 * 600 * 8))
    expect(Math.floor(14_400 * 8 * budgetOnly)).toBeGreaterThan(32_767)
  })

  it('treats a missing or zero device ratio as 1 and tolerates degenerate sizes', () => {
    expect(pageRenderDpr(100, 100, 0)).toBe(1)
    expect(pageRenderDpr(0, 0, 1)).toBeGreaterThan(0)
  })
})
