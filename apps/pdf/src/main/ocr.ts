/**
 * Text recognition for the pdf viewer (issue #119): recognizes one rendered page image.
 *
 * Tesseract (WebAssembly, ocr-tesseract.ts) is the primary engine: it reads documents more
 * accurately than the system engines and works the same on every platform. If it cannot start
 * (its files are missing, or the worker fails), the platform helper binaries shared with
 * pdf2docx take over (macOS Vision / Windows.Media.Ocr), found the same way as the shell's
 * pdf2docx-local.ts: packaged under Resources/ocr, repo-relative in dev. With neither, there is
 * no engine and the viewer keeps today's behavior.
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createVisionOcrEngine,
  createWindowsOcrEngine,
} from '../../../../packages/pdf2docx/src/ocr-vision'
import type { OcrEngine } from '../../../../packages/pdf2docx/src/ocr'
import type { PdfOcrLine } from '../shared/ipc'
import { TesseractEngine, tesseractPaths } from './ocr-tesseract'

let ocrEngine: OcrEngine | null | undefined

function ensureOcrEngine(): OcrEngine | null {
  if (ocrEngine !== undefined) return ocrEngine
  const here = dirname(fileURLToPath(import.meta.url))
  const helper = process.platform === 'darwin' ? 'vision-ocr' : 'win-ocr.exe'
  const create = process.platform === 'darwin' ? createVisionOcrEngine : createWindowsOcrEngine
  const candidates = [
    ...(process.resourcesPath ? [join(process.resourcesPath, 'ocr', helper)] : []),
    join(here, '../../../../packages/pdf2docx/ocr-helper', helper),
  ]
  ocrEngine = null
  for (const path of candidates) {
    const engine = create(path)
    if (engine) {
      ocrEngine = engine
      break
    }
  }
  return ocrEngine
}

let tesseract: TesseractEngine | null | undefined

function ensureTesseract(): TesseractEngine | null {
  if (tesseract !== undefined) return tesseract
  const paths = tesseractPaths()
  tesseract = paths ? new TesseractEngine(paths) : null
  return tesseract
}

/** Release the recognition worker (the app is quitting, or a test is done) */
export async function disposeOcr(): Promise<void> {
  await tesseract?.dispose()
}

/** PNG (base64) → OCR lines; null only when there is no engine at all (callers
    stop trying), [] when recognition failed for this image (callers move on) */
export async function ocrPagePng(pngBase64: string): Promise<PdfOcrLine[] | null> {
  const primary = ensureTesseract()
  const system = ensureOcrEngine()
  if (!primary && !system) return null
  let png: Uint8Array
  try {
    png = Uint8Array.from(Buffer.from(pngBase64, 'base64'))
  } catch {
    return []
  }
  if (primary) {
    try {
      return await primary.recognize(png)
    } catch {
      // Tesseract could not run (files damaged, worker failed to start): the system engine, if any, reads this page
      if (!system) return []
    }
  }
  if (!system) return []
  const result = system(png, { widthPt: 0, heightPt: 0 }) // helpers ignore the page size hint
  if (!result) return []
  return result.lines.map((l) => ({
    text: l.text,
    confidence: l.confidence,
    box: [l.box.x0, l.box.y0, l.box.x1, l.box.y1],
    ...(l.chars
      ? {
          chars: l.chars.map((c) => ({
            text: c.text,
            box: [c.box.x0, c.box.y0, c.box.x1, c.box.y1] as [number, number, number, number],
          })),
        }
      : {}),
  }))
}
