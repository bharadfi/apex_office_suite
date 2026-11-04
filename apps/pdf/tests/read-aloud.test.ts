import { describe, expect, it } from 'vitest'
import { collectSpeechText, itemsToSpeechText } from '../src/renderer/read-aloud'

/** a stand-in for a pdf.js document whose pages hold the given text items */
function fakeDoc(pages: { str: string; hasEOL?: boolean }[][]) {
  const requested: number[] = []
  return {
    requested,
    doc: {
      numPages: pages.length,
      getPage: async (n: number) => {
        requested.push(n)
        return { getTextContent: async () => ({ items: pages[n - 1] ?? [] }) }
      },
    } as never,
  }
}

describe('itemsToSpeechText', () => {
  it('joins runs and breaks the line where pdf.js says it ended', () => {
    expect(
      itemsToSpeechText([{ str: 'Hello ' }, { str: 'world', hasEOL: true }, { str: 'Next line' }]),
    ).toBe('Hello world\nNext line')
  })

  it('ignores items that carry no string (marked-content markers)', () => {
    expect(itemsToSpeechText([{ str: 'a' }, {}, { str: 'b' }])).toBe('ab')
  })
})

describe('collectSpeechText', () => {
  it('reads the pages asked for, in that order, a blank line apart', async () => {
    const { doc, requested } = fakeDoc([[{ str: 'one' }], [{ str: 'two' }], [{ str: 'three' }]])
    expect(await collectSpeechText(doc, [1, 2])).toBe('two\n\nthree')
    expect(requested).toEqual([2, 3])
  })

  it('skips pages without text and indexes past the end (unsaved blank pages)', async () => {
    const { doc, requested } = fakeDoc([[{ str: 'one' }], [{ str: '   ' }]])
    expect(await collectSpeechText(doc, [0, 1, 5, -1])).toBe('one')
    expect(requested).toEqual([1, 2])
  })

  it('gives nothing for a page with no text layer', async () => {
    const { doc } = fakeDoc([[]])
    expect(await collectSpeechText(doc, [0])).toBe('')
  })

  it('stops gathering as soon as it is cancelled', async () => {
    const { doc, requested } = fakeDoc([[{ str: 'a' }], [{ str: 'b' }], [{ str: 'c' }]])
    let calls = 0
    const text = await collectSpeechText(doc, [0, 1, 2], () => ++calls > 1)
    expect(text).toBe('')
    expect(requested).toEqual([1])
  })
})
