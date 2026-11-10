import type { PdfSignatureInfo } from './ipc'

/** A signature with a visible box on a page: the only kind that has a mark to draw */
export const hasVisibleBox = (info: Pick<PdfSignatureInfo, 'kind' | 'rect'>): boolean =>
  info.kind === 'signature' &&
  !!info.rect &&
  Math.abs(info.rect[2] - info.rect[0]) >= 4 &&
  Math.abs(info.rect[3] - info.rect[1]) >= 4
