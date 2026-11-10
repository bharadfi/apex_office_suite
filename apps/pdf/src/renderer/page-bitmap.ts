/**
 * How big a page's bitmap may be. A page drawn at deep zoom (800% of a large or very wide/tall
 * page) would otherwise ask the browser for a canvas it refuses: past about 32,767 px on a side
 * Chromium draws nothing beyond that edge, so part of the page, or all of it, stays blank.
 */

/** Page bitmap budget: at 800% a hi-dpi Letter page would otherwise be ~125M px */
export const MAX_PAGE_RENDER_PIXELS = 48_000_000

/**
 * The longest side of a page bitmap. Chromium's canvas limit is 32,767 px; 16,384 also stays
 * within the texture size of every GPU, so the page is never drawn in software for this reason.
 */
export const MAX_PAGE_RENDER_SIDE = 16_384

/**
 * Device-pixel ratio for a page bitmap of `width` x `height` CSS px: the display's (at most 2),
 * shrunk so that neither the pixel count nor the longest side goes past the limits. The page is
 * already magnified when the cap bites, so the picture is softer, never missing.
 */
export function pageRenderDpr(width: number, height: number, deviceDpr = 1): number {
  const w = Math.max(1, width)
  const h = Math.max(1, height)
  return Math.min(
    deviceDpr || 1,
    2,
    Math.sqrt(MAX_PAGE_RENDER_PIXELS / (w * h)),
    MAX_PAGE_RENDER_SIDE / Math.max(w, h),
  )
}
