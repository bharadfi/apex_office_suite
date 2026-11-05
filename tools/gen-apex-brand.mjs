// Cuts the Apex Office shield out of the supplied logo and writes every icon the app and installer use.
//   node tools/gen-apex-brand.mjs <logo.jpg>
// Outputs (committed): apps/shell/build/branding/*, apps/shell/build/icon.{png,ico}, icons/<n>x<n>.png,
// the shell renderer's logo and the thumbnail badge.
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync, copyFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { createCanvas, loadImage } = require('@napi-rs/canvas')
const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const source = process.argv[2]
if (!source) throw new Error('usage: node tools/gen-apex-brand.mjs <logo.jpg>')

const build = join(root, 'apps/shell/build')
const branding = join(build, 'branding')
mkdirSync(branding, { recursive: true })
mkdirSync(join(build, 'icons'), { recursive: true })

const image = await loadImage(source)
// the shield, as a square around it (measured on the 1408 x 768 artwork)
const CROP = { x: 487, y: 81, size: 440 }
const OUT = 1024

/** "colour to alpha": the near-white page behind the shield becomes transparent, the colours stay true */
function shield() {
  const small = createCanvas(CROP.size, CROP.size)
  small.getContext('2d').drawImage(image, CROP.x, CROP.y, CROP.size, CROP.size, 0, 0, CROP.size, CROP.size)
  const big = createCanvas(OUT, OUT)
  const bctx = big.getContext('2d')
  bctx.imageSmoothingQuality = 'high'
  bctx.drawImage(small, 0, 0, OUT, OUT)
  const data = bctx.getImageData(0, 0, OUT, OUT)
  const px = data.data
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], g = px[i + 1], b = px[i + 2]
    const a = Math.max(1 - r / 255, 1 - g / 255, 1 - b / 255)
    if (a < 0.07) {
      px[i + 3] = 0
      continue
    }
    const alpha = Math.min(1, (a - 0.07) / 0.28)
    const k = Math.max(a, 0.001)
    px[i] = Math.max(0, Math.min(255, Math.round((r - 255 * (1 - k)) / k)))
    px[i + 1] = Math.max(0, Math.min(255, Math.round((g - 255 * (1 - k)) / k)))
    px[i + 2] = Math.max(0, Math.min(255, Math.round((b - 255 * (1 - k)) / k)))
    px[i + 3] = Math.round(alpha * 255)
  }
  bctx.putImageData(data, 0, 0)
  return big
}

const art = shield()

/** a square canvas of `size` with the shield centred at `scale` of it */
function scaled(size, { scale = 1, background = null } = {}) {
  const c = createCanvas(size, size)
  const ctx = c.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  if (background) {
    ctx.fillStyle = background
    const r = size * 0.22
    ctx.beginPath()
    ctx.roundRect(0, 0, size, size, r)
    ctx.fill()
  }
  const s = size * scale
  ctx.drawImage(art, (size - s) / 2, (size - s) / 2, s, s)
  return c
}

const png = (canvas) => canvas.toBuffer('image/png')

// the app tile: the shield on a white rounded square, so it reads on dark task bars too
const tile = (size) => scaled(size, { scale: 0.86, background: '#ffffff' })
writeFileSync(join(build, 'icon.png'), png(tile(512)))
writeFileSync(join(branding, 'apex-tile-256.png'), png(tile(256)))
writeFileSync(join(branding, 'apex-shield.png'), png(scaled(512)))
for (const n of [16, 32, 48, 64, 128, 256, 512, 1024]) {
  writeFileSync(join(build, 'icons', `${n}x${n}.png`), png(tile(n)))
}
copyFileSync(source, join(branding, 'apex-office-logo.jpg'))

// the badge drawn on thumbnails: the shield on a round white disc
const badge = createCanvas(128, 128)
{
  const ctx = badge.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.arc(64, 64, 62, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = 'rgba(15, 40, 90, 0.18)'
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(art, 18, 18, 92, 92)
}
writeFileSync(join(branding, 'apex-badge.png'), png(badge))

// a Windows icon: PNG-compressed entries
function ico(sizes) {
  const images = sizes.map((s) => ({ s, data: png(tile(s)) }))
  const head = Buffer.alloc(6 + images.length * 16)
  head.writeUInt16LE(0, 0)
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
  return Buffer.concat([head, ...images.map((i) => i.data)])
}
writeFileSync(join(build, 'icon.ico'), ico([16, 24, 32, 48, 64, 128, 256]))

// the shell's renderer logo and window icon
const assets = join(root, 'apps/shell/src/renderer/src/assets')
writeFileSync(join(assets, 'app-icon.png'), png(tile(256)))
writeFileSync(join(assets, 'apex-shield.png'), png(scaled(256)))
console.log('brand assets written')
