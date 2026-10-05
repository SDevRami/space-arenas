import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'

const root = process.cwd()
const reports = resolve(root, 'reports')
mkdirSync(reports, { recursive: true })

const fail = (msg) => {
  console.error(`[validate-assets] FAIL: ${msg}`)
  process.exit(1)
}

const dir = resolve(root, 'client/dist')
if (!existsSync(dir)) {
  fail('client/dist not found — run `npm run build` first')
}

const collect = (base) => {
  const out = []
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    const full = resolve(base, entry.name)
    if (entry.isDirectory()) out.push(...collect(full))
    else if (/\.(js|css|html)$/.test(entry.name)) out.push(full)
  }
  return out
}

const files = collect(dir)
if (files.length === 0) fail('client/dist contains no built assets')

const manifest = []
for (const full of files) {
  const buf = readFileSync(full)
  const hash = createHash('sha256').update(buf).digest('hex')
  const rel = full.slice(dir.length + 1).replaceAll('\\', '/')
  manifest.push({ file: rel, bytes: buf.length, sha256: hash })
  console.log(`[validate-assets] ${rel} (${buf.length} bytes) ${hash.slice(0, 12)}`)
}

writeFileSync(resolve(reports, 'asset-manifest.json'), JSON.stringify(manifest, null, 2))
console.log(`[validate-assets] OK: ${manifest.length} assets, manifest written to reports/asset-manifest.json`)
