// Guards the vendored copy of the shared sources used by the online server.
// online/ is deployed standalone (Render rootDir: online), so it carries its own
// copy of shared/src. This check fails when that copy drifts from the real
// sources; fix it with `npm run sync:online` (node scripts/sync-online-shared.mjs).
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const src = join(root, 'shared', 'src')
const dst = join(root, 'online', 'shared', 'src')

for (const dir of [src, dst]) {
  if (!existsSync(dir)) {
    console.error(`check-online-shared: missing directory ${dir}`)
    process.exit(1)
  }
}

/** Every `.ts` file under `base`, as posix-style relative paths. */
const listTs = (base) => {
  const out = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile() && entry.name.endsWith('.ts')) {
        out.push(relative(base, full).split(sep).join('/'))
      }
    }
  }
  walk(base)
  return out.sort()
}

// Compare content, not line endings: Windows checkouts may normalise CRLF.
const read = (path) => readFileSync(path, 'utf8').replace(/\r\n?/g, '\n')

const source = listTs(src)
const vendored = listTs(dst)
const sourceSet = new Set(source)
const vendoredSet = new Set(vendored)

const missing = source.filter((file) => !vendoredSet.has(file))
const extra = vendored.filter((file) => !sourceSet.has(file))
const changed = source.filter(
  (file) => vendoredSet.has(file) && read(join(src, file)) !== read(join(dst, file)),
)

if (missing.length || extra.length || changed.length) {
  console.error('check-online-shared: online/shared/src is out of date.')
  if (missing.length) console.error(`  missing:  ${missing.join(', ')}`)
  if (extra.length) console.error(`  extra:    ${extra.join(', ')}`)
  if (changed.length) console.error(`  changed:  ${changed.join(', ')}`)
  console.error('Run `npm run sync:online` and commit online/shared/src.')
  process.exit(1)
}

console.log(`check-online-shared: OK (${source.length} files match shared/src)`)
