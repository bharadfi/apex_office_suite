// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]).toString(
  'base64',
)

const line = (text: string) => ({
  text,
  confidence: 0.9,
  box: [0, 0, 1, 1] as [number, number, number, number],
})

interface Setup {
  /** what Tesseract's recognise does; undefined = no Tesseract files at all */
  tesseract?: () => Promise<unknown>
  /** the system engine: a function that recognises, or null for none */
  system?: ((png: Uint8Array) => unknown) | null
}

/** load ocr.ts fresh with stand-ins for the two engines */
async function load({ tesseract, system = null }: Setup) {
  vi.resetModules()
  vi.doMock('../src/main/ocr-tesseract', () => ({
    tesseractPaths: () => (tesseract ? { corePath: 'c', langPath: 'l' } : null),
    TesseractEngine: class {
      recognize = tesseract ?? (async () => [])
      dispose = async () => undefined
    },
  }))
  vi.doMock('../../../packages/pdf2docx/src/ocr-vision', () => ({
    createVisionOcrEngine: () => system,
    createWindowsOcrEngine: () => system,
  }))
  vi.doMock('node:fs', async (original) => {
    const real = await original<typeof import('node:fs')>()
    return { ...real, existsSync: () => true }
  })
  return import('../src/main/ocr')
}

afterEach(() => {
  vi.doUnmock('../src/main/ocr-tesseract')
  vi.doUnmock('../../../packages/pdf2docx/src/ocr-vision')
  vi.doUnmock('node:fs')
})

const systemEngine = () => ({
  lines: [{ text: 'from the system', confidence: 0.8, box: { x0: 0, y0: 0, x1: 1, y1: 1 } }],
})

describe('ocrPagePng engine order', () => {
  it('uses Tesseract when it is there, and does not call the system engine', async () => {
    const system = vi.fn(systemEngine)
    const { ocrPagePng } = await load({ tesseract: async () => [line('from tesseract')], system })
    expect(await ocrPagePng(PNG)).toEqual([line('from tesseract')])
    expect(system).not.toHaveBeenCalled()
  })

  it('reads the page with the system engine when Tesseract cannot run', async () => {
    const { ocrPagePng } = await load({
      tesseract: async () => {
        throw new Error('worker failed to start')
      },
      system: systemEngine,
    })
    const lines = await ocrPagePng(PNG)
    expect(lines?.map((l) => l.text)).toEqual(['from the system'])
  })

  it('calls the page failed, not the platform without an engine, when Tesseract fails and nothing else exists', async () => {
    const { ocrPagePng } = await load({
      tesseract: async () => {
        throw new Error('worker failed to start')
      },
    })
    // [] = this page failed and the pass moves on; null would stop it for good
    expect(await ocrPagePng(PNG)).toEqual([])
  })

  it('uses the system engine alone when there is no Tesseract', async () => {
    const { ocrPagePng } = await load({ system: systemEngine })
    expect((await ocrPagePng(PNG))?.map((l) => l.text)).toEqual(['from the system'])
  })

  it('says there is no engine only when neither exists', async () => {
    const { ocrPagePng } = await load({})
    expect(await ocrPagePng(PNG)).toBeNull()
  })

  it('can release the worker, with or without one having been started', async () => {
    const { disposeOcr } = await load({ tesseract: async () => [] })
    await expect(disposeOcr()).resolves.toBeUndefined()
    const none = await load({})
    await expect(none.disposeOcr()).resolves.toBeUndefined()
  })
})
