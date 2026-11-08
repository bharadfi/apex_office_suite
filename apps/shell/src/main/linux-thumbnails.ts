/**
 * Linux file-manager thumbnails. GNOME Files (the Zorin OS default) runs thumbnailer programs in a
 * sandbox with no display and no access to /opt, so a thumbnailer that launches this app cannot
 * work there. Instead the app, which runs in the user's session, draws page 1 of a file when the
 * user opens or saves it and writes it into the freedesktop thumbnail cache
 * (~/.cache/thumbnails/{normal,large}); file managers use a cached picture when its
 * Thumb::URI and Thumb::MTime match the file.
 */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { crc32 } from 'node:zlib'

import { nativeImage } from 'electron'

const THUMBNAILABLE = new Set([
  '.docx', '.docm', '.dotx', '.dotm', '.xlsx', '.xlsm', '.pptx', '.pptm', '.ppsx', '.pdf', '.md', '.markdown', '.html', '.htm',
])

/** Percent-encoded file URI as the thumbnail specification hashes it. */
export function thumbnailUri(path: string): string {
  return pathToFileURL(path).href
}

export function thumbnailCachePath(cacheHome: string, size: 'normal' | 'large', uri: string): string {
  return join(cacheHome, 'thumbnails', size, `${createHash('md5').update(uri).digest('hex')}.png`)
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0)
  return Buffer.concat([head, data, crc])
}

/** The PNG with tEXt chunks added right after its header chunk. */
export function withTextChunks(png: Buffer, entries: Record<string, string>): Buffer {
  const ihdrEnd = 8 + 8 + png.readUInt32BE(8) + 4
  const texts = Object.entries(entries).map(([key, value]) =>
    chunk('tEXt', Buffer.concat([Buffer.from(key, 'latin1'), Buffer.from([0]), Buffer.from(value, 'utf8')])),
  )
  return Buffer.concat([png.subarray(0, ihdrEnd), ...texts, png.subarray(ihdrEnd)])
}

const done = new Map<string, number>()
let queue: Promise<void> = Promise.resolve()

/** Fire and forget: draws and caches the preview for [path] unless it is already current. */
export function primeLinuxThumbnail(path: string): void {
  if (process.platform !== 'linux' || !THUMBNAILABLE.has(extname(path).toLowerCase())) return
  queue = queue.then(() => render(path)).catch(() => undefined)
}

async function render(path: string): Promise<void> {
  const mtime = Math.floor(statSync(path).mtimeMs / 1000)
  if (done.get(path) === mtime) return
  const cacheHome = process.env.XDG_CACHE_HOME || join(homedir(), '.cache')
  const uri = thumbnailUri(path)
  const largePath = thumbnailCachePath(cacheHome, 'large', uri)
  if (existsSync(largePath) && readFileSync(largePath).includes(`Thumb::MTime\0${mtime}`)) {
    done.set(path, mtime)
    return
  }
  const cli = join(process.resourcesPath ?? '', 'cli', 'apexoffice.cjs')
  if (!existsSync(cli)) return
  const dir = mkdtempSync(join(tmpdir(), 'apex-thumb-'))
  try {
    await new Promise<void>((resolve, reject) => {
      execFile(
        process.execPath,
        [cli, 'render', path, '--out', dir, '--page', '1', '--scale', '0.6'],
        { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 40_000 },
        (error) => (error ? reject(error) : resolve()),
      )
    })
    const png = (await import('node:fs')).readdirSync(dir).find((f) => f.toLowerCase().endsWith('.png'))
    if (!png) return
    const image = nativeImage.createFromPath(join(dir, png))
    const { width, height } = image.getSize()
    if (!width || !height) return
    for (const [name, side] of [['large', 256], ['normal', 128]] as const) {
      const scaled = image.resize(width >= height ? { width: side } : { height: side })
      const target = thumbnailCachePath(cacheHome, name, uri)
      mkdirSync(join(cacheHome, 'thumbnails', name), { recursive: true, mode: 0o700 })
      writeFileSync(
        target,
        withTextChunks(scaled.toPNG(), {
          'Thumb::URI': uri,
          'Thumb::MTime': String(mtime),
          Software: 'Apex Office',
        }),
        { mode: 0o600 },
      )
    }
    done.set(path, mtime)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
