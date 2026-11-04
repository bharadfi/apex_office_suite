/**
 * Text recognition with Tesseract (WebAssembly), the primary OCR engine of the PDF viewer.
 *
 * Measured on real pages against their true text, Tesseract reads ordinary documents more
 * accurately than the system engines (word F1 99% against 96% on a documentation page,
 * 98% against 86% on a table page), needs no helper program compiled for each platform, and
 * works the same everywhere. It is slower (a few seconds a page), which suits a background pass.
 *
 * The engine keeps one worker alive between pages, handles one page at a time, and lets the
 * worker go after a quiet minute so an idle viewer holds no recognition memory.
 */
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { createWorker, OEM, type Worker } from 'tesseract.js'
import type { PdfOcrLine } from '../shared/ipc'

/** Words Tesseract is less sure of than this are dropped: stray marks from logos and rules */
export const MIN_WORD_CONFIDENCE = 40

/** A box Tesseract reports, in pixels from the picture's top left */
interface PixelBox {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** The part of Tesseract's recognition result this module reads */
export interface RecognizedBlocks {
  paragraphs?: {
    lines?: {
      words?: { text: string; confidence: number; bbox: PixelBox }[]
    }[]
  }[]
}

/**
 * Tesseract's blocks as the viewer's lines: one line per recognised text line, a box and a
 * confidence for it (0..1), and one entry per word with its own box. Boxes are normalised to the
 * picture and measured from the bottom left, the shape the system engines use, so everything
 * downstream (the selectable text layer, search, saving the layer into the file) is unchanged.
 * Words below MIN_WORD_CONFIDENCE, and words with no text, are dropped.
 */
export function blocksToLines(
  blocks: readonly RecognizedBlocks[],
  width: number,
  height: number,
  minConfidence = MIN_WORD_CONFIDENCE,
): PdfOcrLine[] {
  if (!(width > 0) || !(height > 0)) return []
  const normalise = (b: PixelBox): [number, number, number, number] => [
    Math.max(0, b.x0 / width),
    Math.max(0, 1 - b.y1 / height),
    Math.min(1, b.x1 / width),
    Math.min(1, 1 - b.y0 / height),
  ]
  const lines: PdfOcrLine[] = []
  for (const block of blocks) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        const words = (line.words ?? []).filter(
          (w) => w.text.trim() !== '' && w.confidence >= minConfidence,
        )
        if (words.length === 0) continue
        const union: PixelBox = {
          x0: Math.min(...words.map((w) => w.bbox.x0)),
          y0: Math.min(...words.map((w) => w.bbox.y0)),
          x1: Math.max(...words.map((w) => w.bbox.x1)),
          y1: Math.max(...words.map((w) => w.bbox.y1)),
        }
        const chars: NonNullable<PdfOcrLine['chars']> = []
        words.forEach((w, i) => {
          // a separator has no width: that is how the text layer tells a gap from a letter
          if (i > 0) chars.push({ text: ' ', box: [0, 0, 0, 0] })
          chars.push({ text: w.text.trim(), box: normalise(w.bbox) })
        })
        lines.push({
          text: words.map((w) => w.text.trim()).join(' '),
          confidence: words.reduce((sum, w) => sum + w.confidence, 0) / words.length / 100,
          box: normalise(union),
          chars,
        })
      }
    }
  }
  return lines
}

/** A PNG's width and height from its header, or null when it is not a PNG */
export function pngSize(png: Uint8Array): { width: number; height: number } | null {
  if (png.length < 24) return null
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (!sig.every((b, i) => png[i] === b)) return null
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

/** Where the engine's files are: the worker script (when it is not tesseract.js's own), the core, the language data */
export interface TesseractPaths {
  workerPath?: string
  corePath: string
  langPath: string
}

/**
 * The engine's files. Packaged, they ship in Resources/ocr/tesseract (the app bundles its code
 * and has no node_modules); from source they come straight from node_modules. null when neither
 * place has them, in which case the system engine is used instead.
 */
export function tesseractPaths(
  resourcesPath: string | undefined = process.resourcesPath,
): TesseractPaths | null {
  if (resourcesPath) {
    const dir = join(resourcesPath, 'ocr', 'tesseract')
    if (existsSync(join(dir, 'worker.cjs'))) {
      return { workerPath: join(dir, 'worker.cjs'), corePath: dir, langPath: join(dir, 'lang') }
    }
  }
  try {
    const req = createRequire(import.meta.url)
    const tesseract = dirname(req.resolve('tesseract.js/package.json'))
    const core = dirname(req.resolve('tesseract.js-core/package.json'))
    const lang = join(dirname(req.resolve('@tesseract.js-data/eng/package.json')), '4.0.0_best_int')
    const workerPath = join(tesseract, 'src', 'worker-script', 'node', 'index.js')
    if (!existsSync(workerPath) || !existsSync(join(lang, 'eng.traineddata.gz'))) return null
    return { workerPath, corePath: core, langPath: lang }
  } catch {
    return null
  }
}

/** One Tesseract worker, created on first use, one page at a time, released when idle */
export class TesseractEngine {
  private worker: Promise<Worker> | null = null
  private idleTimer: NodeJS.Timeout | null = null
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly paths: TesseractPaths,
    private readonly idleMs = 60_000,
  ) {}

  private start(): Promise<Worker> {
    this.worker ??= createWorker('eng', OEM.LSTM_ONLY, {
      ...(this.paths.workerPath ? { workerPath: this.paths.workerPath } : {}),
      corePath: this.paths.corePath,
      langPath: this.paths.langPath,
      gzip: true,
      // the data ships with the app: nothing is downloaded and no cache is written beside it
      cacheMethod: 'none',
    }).catch((err) => {
      this.worker = null
      throw err
    })
    return this.worker
  }

  /** Recognise one PNG. Calls queue up and run one at a time. */
  recognize(png: Uint8Array): Promise<PdfOcrLine[]> {
    const run = async (): Promise<PdfOcrLine[]> => {
      const size = pngSize(png)
      if (!size) return []
      this.cancelIdle()
      try {
        const worker = await this.start()
        const { data } = await worker.recognize(Buffer.from(png), {}, { blocks: true })
        return blocksToLines(
          (data.blocks ?? []) as unknown as RecognizedBlocks[],
          size.width,
          size.height,
        )
      } finally {
        this.scheduleIdle()
      }
    }
    const next = this.queue.then(run, run)
    this.queue = next.catch(() => undefined)
    return next
  }

  /** Let the worker go now. A later call starts a new one. */
  async dispose(): Promise<void> {
    this.cancelIdle()
    const pending = this.worker
    this.worker = null
    if (pending) await (await pending.catch(() => null))?.terminate()
  }

  private scheduleIdle(): void {
    this.cancelIdle()
    this.idleTimer = setTimeout(() => void this.dispose(), this.idleMs)
    this.idleTimer.unref?.()
  }

  private cancelIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
  }
}
