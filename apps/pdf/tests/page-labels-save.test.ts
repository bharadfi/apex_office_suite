// @vitest-environment node
import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { applySaveRequest } from '../src/main/save-pdf'
import { readPageLabelRanges } from '../src/main/page-labels-io'
import type { PageLabelRange, SavePdfRequest } from '../src/shared/ipc'
import { labelsFor } from '../src/shared/page-labels'

const request = (over: Partial<SavePdfRequest>): SavePdfRequest => ({
  path: 'x.pdf',
  markups: [],
  drawings: [],
  formValues: [],
  stamps: [],
  ...over,
})

/** pages are told apart by their width: 100, 110, 120… */
async function sample(count: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < count; i++) doc.addPage([100 + i * 10, 100])
  return doc.save({ useObjectStreams: false })
}

const widths = async (bytes: Uint8Array): Promise<number[]> =>
  (await PDFDocument.load(bytes)).getPages().map((p) => p.getWidth())

const labelsOf = async (bytes: Uint8Array): Promise<string[]> => {
  const doc = await PDFDocument.load(bytes)
  return labelsFor(readPageLabelRanges(doc), doc.getPageCount())
}

const roman = (start: number): PageLabelRange => ({
  start,
  style: 'lowerRoman',
  prefix: '',
  firstNumber: 1,
})
const decimal = (start: number, firstNumber = 1): PageLabelRange => ({
  start,
  style: 'decimal',
  prefix: '',
  firstNumber,
})

describe('page labels in a save', () => {
  it('writes the ranges the request carries', async () => {
    const { bytes } = await applySaveRequest(
      await sample(4),
      request({ pageLabels: [roman(0), decimal(2)] }),
    )
    expect(await labelsOf(bytes)).toEqual(['i', 'ii', '1', '2'])
  })

  it('leaves the labels already in the file alone when the request has none', async () => {
    const first = await applySaveRequest(await sample(3), request({ pageLabels: [roman(0)] }))
    const second = await applySaveRequest(first.bytes, request({}))
    expect(await labelsOf(second.bytes)).toEqual(['i', 'ii', 'iii'])
  })

  it('removes the labels when the request carries an empty list', async () => {
    const first = await applySaveRequest(await sample(3), request({ pageLabels: [roman(0)] }))
    const second = await applySaveRequest(first.bytes, request({ pageLabels: [] }))
    expect(await labelsOf(second.bytes)).toEqual(['1', '2', '3'])
  })

  it('counts by position in the saved file, after pages are deleted', async () => {
    // pages 1 and 2 (the first two) are deleted; the labels describe what is left
    const { bytes } = await applySaveRequest(
      await sample(5),
      request({ deletedPages: [0, 1], pageLabels: [roman(0), decimal(2)] }),
    )
    expect(await widths(bytes)).toEqual([120, 130, 140])
    expect(await labelsOf(bytes)).toEqual(['i', 'ii', '1'])
  })

  it('counts by position in the saved file, after pages are reordered', async () => {
    const { bytes } = await applySaveRequest(
      await sample(3),
      request({ pageOrder: [2, 0, 1], pageLabels: [roman(0), decimal(1)] }),
    )
    // the page that was last is now first and takes the first label
    expect(await widths(bytes)).toEqual([120, 100, 110])
    expect(await labelsOf(bytes)).toEqual(['i', '1', '2'])
  })

  it('drops a range that starts past the last page of the saved file', async () => {
    const { bytes } = await applySaveRequest(
      await sample(3),
      request({ deletedPages: [2], pageLabels: [decimal(0), roman(2)] }),
    )
    expect(await labelsOf(bytes)).toEqual(['1', '2'])
  })
})
