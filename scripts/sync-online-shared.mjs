// Vendors the game's shared protocol sources into online/shared/ so the online/
// folder is self-contained and can be pushed alone to the server repo.
// Run after any change under shared/src/ (especially protocol.ts / PROTOCOL_VERSION):
//   node scripts/sync-online-shared.mjs
import { cpSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const src = join(root, 'shared', 'src')
const dst = join(root, 'online', 'shared', 'src')

if (!existsSync(src)) {
  console.error('shared/src not found; run from repo root')
  process.exit(1)
}

mkdirSync(dst, { recursive: true })
rmSync(dst, { recursive: true, force: true })
mkdirSync(dst, { recursive: true })

cpSync(src, dst, {
  recursive: true,
  filter: (from) => (statSync(from).isDirectory() ? true : from.endsWith('.ts')),
})

console.log(`Synced shared/src ${src} -> ${dst}`)