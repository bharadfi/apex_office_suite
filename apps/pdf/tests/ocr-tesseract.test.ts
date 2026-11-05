// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  MIN_WORD_CONFIDENCE,
  TesseractEngine,
  defaultPoolSize,
  blocksToLines,
  pngSize,
  tesseractPaths,
  type RecognizedBlocks,
} from '../src/main/ocr-tesseract'

const word = (
  text: string,
  confidence: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
) => ({
  text,
  confidence,
  bbox: { x0, y0, x1, y1 },
})

const oneLine = (words: ReturnType<typeof word>[]): RecognizedBlocks[] => [
  { paragraphs: [{ lines: [{ words }] }] },
]

describe('blocksToLines', () => {
  it('measures boxes as fractions of the picture from the bottom left, as the system engines do', () => {
    // a word 100 px from the left, 50 px from the top, 200 wide and 40 tall, in a 1000 x 500 picture
    const [line] = blocksToLines(oneLine([word('Hello', 90, 100, 50, 300, 90)]), 1000, 500)
    expect(line!.box[0]).toBeCloseTo(0.1)
    expect(line!.box[2]).toBeCloseTo(0.3)
    // the picture's top is y = 1 in this space: 50 px down is 0.9, 90 px down is 0.82
    expect(line!.box[1]).toBeCloseTo(0.82)
    expect(line!.box[3]).toBeCloseTo(0.9)
  })

  it('makes one line of the words it keeps, with a box for each word and a gap between them', () => {
    const lines = blocksToLines(
      oneLine([word('Total', 95, 0, 0, 100, 20), word('premium', 85, 120, 0, 300, 20)]),
      1000,
      1000,
    )
    expect(lines).toHaveLength(1)
    expect(lines[0]!.text).toBe('Total premium')
    expect(lines[0]!.confidence).toBeCloseTo(0.9)
    expect(lines[0]!.chars!.map((c) => c.text)).toEqual(['Total', ' ', 'premium'])
    // the gap has no width, which is how the text layer tells a space from a letter
    const gap = lines[0]!.chars![1]!.box
    expect(gap[2] - gap[0]).toBe(0)
  })

  it('drops words Tesseract is unsure of and words with no text, and lines left empty', () => {
    const blocks: RecognizedBlocks[] = [
      {
        paragraphs: [
          {
            lines: [
              {
                words: [
                  word('real', 90, 0, 0, 50, 10),
                  word('~', MIN_WORD_CONFIDENCE - 1, 60, 0, 70, 10),
                  word('  ', 99, 80, 0, 90, 10),
                ],
              },
              { words: [word('[o]', 0, 0, 20, 30, 30)] },
            ],
          },
        ],
      },
    ]
    const lines = blocksToLines(blocks, 100, 100)
    expect(lines.map((l) => l.text)).toEqual(['real'])
  })

  it('reads every block, paragraph and line, in the order given', () => {
    const blocks: RecognizedBlocks[] = [
      {
        paragraphs: [
          {
            lines: [
              { words: [word('one', 90, 0, 0, 10, 5)] },
              { words: [word('two', 90, 0, 10, 10, 15)] },
            ],
          },
        ],
      },
      { paragraphs: [{ lines: [{ words: [word('three', 90, 0, 20, 10, 25)] }] }] },
    ]
    expect(blocksToLines(blocks, 100, 100).map((l) => l.text)).toEqual(['one', 'two', 'three'])
  })

  it('gives nothing for a picture with no size, and keeps boxes inside the picture', () => {
    expect(blocksToLines(oneLine([word('x', 90, 0, 0, 5, 5)]), 0, 100)).toEqual([])
    const [line] = blocksToLines(oneLine([word('edge', 90, -5, -5, 120, 120)]), 100, 100)
    for (const v of line!.box) expect(v >= 0 && v <= 1).toBe(true)
  })
})

describe('pngSize', () => {
  it('reads the size from the header and refuses anything else', () => {
    const png = readFileSync(
      join(__dirname, '../../../packages/pdf2docx/ocr-helper/fixtures/smoke-en.png'),
    )
    const size = pngSize(new Uint8Array(png))
    expect(size!.width).toBeGreaterThan(50)
    expect(size!.height).toBeGreaterThan(20)
    expect(pngSize(new Uint8Array([1, 2, 3]))).toBeNull()
    expect(pngSize(new Uint8Array(40))).toBeNull()
  })
})

describe('tesseractPaths', () => {
  it('finds the engine files in node_modules when running from source', () => {
    const paths = tesseractPaths(undefined)
    expect(paths).not.toBeNull()
    expect(paths!.workerPath).toMatch(/worker-script/)
    expect(paths!.langPath).toMatch(/4\.0\.0_best_int/)
  })

  it('falls back to node_modules when the packaged folder has no engine', () => {
    // a resources folder without the worker script is not mistaken for a packaged install
    expect(tesseractPaths('C:/does/not/exist')?.workerPath).toMatch(/worker-script/)
  })
})

describe('TesseractEngine (the real engine)', () => {
  const paths = tesseractPaths(undefined)!
  const engine = new TesseractEngine(paths, 200)
  const png = new Uint8Array(
    readFileSync(join(__dirname, '../../../packages/pdf2docx/ocr-helper/fixtures/smoke-en.png')),
  )
  afterAll(() => engine.dispose())

  it('reads the words in a picture and gives boxes the text layer can use', async () => {
    const lines = await engine.recognize(png)
    const text = lines.map((l) => l.text).join(' ')
    expect(text).toMatch(/quick/i)
    expect(text).toMatch(/12345/)
    for (const line of lines) {
      for (const v of line.box) expect(v >= 0 && v <= 1).toBe(true)
      expect(line.confidence).toBeGreaterThan(0)
      expect(line.chars!.length).toBeGreaterThan(0)
    }
  }, 120_000)

  it('handles pages that arrive together, one at a time, and keeps working afterwards', async () => {
    const results = await Promise.all([
      engine.recognize(png),
      engine.recognize(png),
      engine.recognize(png),
    ])
    expect(results.map((r) => r.map((l) => l.text).join(' '))).toEqual([
      results[0]!.map((l) => l.text).join(' '),
      results[0]!.map((l) => l.text).join(' '),
      results[0]!.map((l) => l.text).join(' '),
    ])
    expect(results[0]!.length).toBeGreaterThan(0)
  }, 120_000)

  it('reads pages on several workers at once and keeps each page its own', async () => {
    const pool = new TesseractEngine(paths, 200, 2)
    try {
      const results = await Promise.all([
        pool.recognize(png),
        pool.recognize(png),
        pool.recognize(png),
      ])
      for (const r of results) expect(r.map((l) => l.text).join(' ')).toMatch(/quick/i)
      expect(defaultPoolSize(1)).toBe(1)
      expect(defaultPoolSize(4)).toBe(2)
      expect(defaultPoolSize(32)).toBe(3)
    } finally {
      await pool.dispose()
    }
  }, 120_000)

  it('gives nothing for something that is not a PNG', async () => {
    expect(await engine.recognize(new Uint8Array([1, 2, 3]))).toEqual([])
  })

  it('lets its worker go when idle and starts a new one on the next page', async () => {
    await new Promise((resolve) => setTimeout(resolve, 600)) // longer than the 200 ms idle time
    const again = await engine.recognize(png)
    expect(again.map((l) => l.text).join(' ')).toMatch(/quick/i)
  }, 120_000)
})
