import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ nativeImage: {} }))

import { thumbnailCachePath, thumbnailUri, withTextChunks } from '../src/main/linux-thumbnails'

// a 1x1 PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAHnOcQAAAAABJRU5ErkJggg==',
  'base64',
)

describe('Linux thumbnail cache', () => {
  it('hashes the percent-encoded file URI', () => {
    const uri = thumbnailUri('/home/u/My Doc.docx')
    // the encoding is what matters; a Windows test host prefixes a drive letter
    expect(uri.startsWith('file:///')).toBe(true)
    expect(uri.endsWith('/home/u/My%20Doc.docx')).toBe(true)
    expect(thumbnailCachePath('/c', 'large', uri)).toBe(
      join('/c', 'thumbnails', 'large', `${createHash('md5').update(uri).digest('hex')}.png`),
    )
  })

  it('adds Thumb::URI and Thumb::MTime text chunks after the header', () => {
    const out = withTextChunks(PNG, { 'Thumb::URI': 'file:///x.docx', 'Thumb::MTime': '1700000000' })
    expect(out.subarray(0, 8)).toEqual(PNG.subarray(0, 8))
    expect(out.includes('Thumb::URI\0file:///x.docx')).toBe(true)
    expect(out.includes('Thumb::MTime\x001700000000')).toBe(true)
    // the original image data is still there, after the new chunks
    expect(out.length).toBeGreaterThan(PNG.length)
    expect(out.subarray(out.length - 12)).toEqual(PNG.subarray(PNG.length - 12))
  })
})
