/**
 * Stage the Tesseract OCR engine for the installer: ocr-helper/tesseract/
 *   worker.cjs  the engine's worker script, bundled (the packaged app has no node_modules)
 *   *.wasm      the WebAssembly cores (plain, SIMD, relaxed SIMD). The bundled worker reads
 *               them from its own folder; in Node, tesseract.js loads the non-LSTM-only cores.
 *   lang/       English recognition data (gzip)
 *
 * Used by apps/shell/electron-builder.cjs; apps/pdf/src/main/ocr-tesseract.ts reads
 * Resources/ocr/tesseract at run time. Idempotent: leaves a complete folder alone.
 */
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, 'tesseract')
const req = createRequire(join(here, '../package.json'))

const tesseract = dirname(req.resolve('tesseract.js/package.json'))
const core = dirname(req.resolve('tesseract.js-core/package.json'))
const lang = join(dirname(req.resolve('@tesseract.js-data/eng/package.json')), '4.0.0_best_int')

const cores = ['tesseract-core', 'tesseract-core-simd', 'tesseract-core-relaxedsimd']
const wanted = [
  join(out, 'worker.cjs'),
  ...cores.map((c) => join(out, `${c}.wasm`)),
  join(out, 'lang', 'eng.traineddata.gz'),
]
if (wanted.every((f) => existsSync(f))) {
  console.log('tesseract assets are up to date')
  process.exit(0)
}

rmSync(out, { recursive: true, force: true })
mkdirSync(join(out, 'lang'), { recursive: true })

await build({
  entryPoints: [join(tesseract, 'src', 'worker-script', 'node', 'index.js')],
  outfile: join(out, 'worker.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  logLevel: 'warning',
})
for (const c of cores) copyFileSync(join(core, `${c}.wasm`), join(out, `${c}.wasm`))
copyFileSync(join(lang, 'eng.traineddata.gz'), join(out, 'lang', 'eng.traineddata.gz'))
console.log('tesseract assets staged in', out)
