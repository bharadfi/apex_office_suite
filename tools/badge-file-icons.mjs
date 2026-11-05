// Puts the Apex Office badge in the bottom right corner of the per-type document icons
// (apps/shell/build/<type>.ico), the way other programs mark their files in Explorer.
//   node tools/badge-file-icons.mjs
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { createCanvas, loadImage } = require('@napi-rs/canvas')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const build = join(root, 'apps/shell/build')
const badge = await loadImage(readFileSync(join(build, 'branding/apex-badge.png')))
const TYPES = ['docx', 'xlsx', 'pptx', 'pdf', 'md', 'html', 'txt', 'json']
const SIZES = [16, 24, 32, 48, 64, 128, 256]

/** the largest PNG inside an .ico */
function largestPng(ico) {
  const count = ico.readUInt16LE(4)
  let best = null
  for (let i = 0; i < count; i++) {
    const e = 6 + i * 16
    const w = ico[e] === 0 ? 256 : ico[e]
    const size = ico.readUInt32LE(e + 8)
    const offset = ico.readUInt32LE(e + 12)
    const data = ico.subarray(offset, offset + size)
    if (data.subarray(0, 4).toString('hex') === '89504e47' && (!best || w > best.w)) best = { w, data }
  }
  if (!best) throw new Error('no PNG entry in the icon')
  return best.data
}

for (const type of TYPES) {
  const path = join(build, `${type}.ico`)
  const original = await loadImage(largestPng(readFileSync(path)))
  const make = (size) => {
    const c = createCanvas(size, size)
    const ctx = c.getContext('2d')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(original, 0, 0, size, size)
    if (size >= 24) {
      const side = Math.round(size * 0.42)
      const margin = Math.round(size * 0.02)
      ctx.drawImage(badge, size - side - margin, size - side - margin, side, side)
    }
    return c.toBuffer('image/png')
  }
  const images = SIZES.map((s) => ({ s, data: make(s) }))
  const head = Buffer.alloc(6 + images.length * 16)
  head.writeUInt16LE(1, 2)
  head.writeUInt16LE(images.length, 4)
  let offset = head.length
  images.forEach((img, i) => {
    const e = 6 + i * 16
    head[e] = img.s >= 256 ? 0 : img.s
    head[e + 1] = img.s >= 256 ? 0 : img.s
    head.writeUInt16LE(1, e + 4)
    head.writeUInt16LE(32, e + 6)
    head.writeUInt32LE(img.data.length, e + 8)
    head.writeUInt32LE(offset, e + 12)
    offset += img.data.length
  })
  writeFileSync(path, Buffer.concat([head, ...images.map((i) => i.data)]))
}
console.log('badged', TYPES.length, 'icons')
