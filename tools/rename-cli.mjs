// The command line is named apexoffice. Renames the launchers and rewrites the references to them.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })

git('mv', 'packages/cli/bin/genoffice', 'packages/cli/bin/apexoffice')
git('mv', 'packages/cli/bin/genoffice.cmd', 'packages/cli/bin/apexoffice.cmd')

const files = git('ls-files', '-z', '--', 'packages/cli', 'apps/shell/src', 'apps/shell/build', 'apps/shell/electron-builder.cjs', 'apps/shell/package.json', 'apps/shell/tests', 'apps/*/src/renderer/control.ts', 'apps/shell/src/renderer/src/i18n/help/topics')
  .split('\0')
  .filter((f) => f && /\.(ts|tsx|js|mjs|cjs|json|md|sh|cmd|nsh|txt)$|\/apexoffice$/.test(f))

const rules = [
  [/genoffice\.cjs/g, 'apexoffice.cjs'],
  [/genoffice\.cmd/g, 'apexoffice.cmd'],
  [/bin\/genoffice(?![\w.-])/g, 'bin/apexoffice'],
  // the command as typed in prose and usage text: "genoffice convert ..."
  [/(?<![@/\w.#-])genoffice(?= (?:--|[a-z][a-z-]*(?:\b| |$)))/g, 'apexoffice'],
]
let changed = 0
for (const rel of files) {
  if (/node_modules|package-lock/.test(rel)) continue
  const p = join(root, rel)
  let text
  try {
    text = readFileSync(p, 'utf8')
  } catch {
    continue
  }
  let next = text
  for (const [re, to] of rules) next = next.replace(re, to)
  if (next !== text) {
    writeFileSync(p, next)
    changed++
  }
}
console.log('rewrote', changed, 'files')
