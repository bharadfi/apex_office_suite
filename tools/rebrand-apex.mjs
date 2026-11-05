// One-off rebrand pass: user-visible "GenOffice" becomes "Apex Office".
// Internal code names (@genoffice/* packages, font aliases, PDF dictionary keys) are left alone on purpose.
//   node tools/rebrand-apex.mjs [--dry]
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dry = process.argv.includes('--dry')

const tracked = execFileSync('git', ['ls-files', '-z', '--', 'apps', 'packages', 'docs', 'e2e', 'tools', 'skills', '.agents'], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 256 * 1024 * 1024,
})
  .split('\0')
  .filter(Boolean)

const TEXT = /\.(ts|tsx|js|mjs|cjs|json|md|html|css|nsh|txt|yml|yaml|xml|plist|sh|cmd)$/i
const SKIP = [
  /(^|\/)node_modules\//,
  /\/fixtures\//, // fixtures assert on their own strings
  /\/fonts\//, // font family aliases
  /\/font-metrics\//,
  /gen-apex-brand|rebrand-apex/,
  /package-lock\.json$/,
  /\.generated\./,
  /\/measurements\//,
  /CHANGELOG/i,
  /^LICENSE|\/LICENSE|NOTICE/i,
]
// the word, not an identifier part or a file-format marker
const NAME = /(?<![A-Za-z0-9@/_.-])GenOffice(?![A-Za-z0-9-])(?! visual signature field)/g

let files = 0
let hits = 0
for (const rel of tracked) {
  if (!TEXT.test(rel) || SKIP.some((re) => re.test(rel))) continue
  const path = join(root, rel)
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    continue
  }
  const next = text.replace(NAME, () => {
    hits++
    return 'Apex Office'
  })
  if (next !== text) {
    files++
    if (!dry) writeFileSync(path, next)
  }
}
console.log(`${dry ? 'would change' : 'changed'} ${hits} mentions in ${files} files`)
