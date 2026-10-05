import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PROTOCOL_VERSION,
  isValidMod,
  type ModFile,
  type ModMeta,
  type ModMetaData,
} from '@space-arenas/shared'
import { sanitizeOverrideMaps, sanitizeSettings } from './sanitize.ts'

const HOST_BASE =
  typeof __dirname !== 'undefined' ? __dirname : fileURLToPath(new URL('.', import.meta.url))

/** The on-disk balance-mod folder. `../../mods` from host/src or host/dist is the project
 *  root's `mods/` in both builds; tests pin it via SA_MODS_DIR. */
export const MODS_DIR = resolve(process.env.SA_MODS_DIR ?? resolve(HOST_BASE, '../../mods'))

/** Uploaded mod files are refused above this size. */
export const MOD_MAX_BYTES = 4 * 1024 * 1024

const scrubName = (name: string): string =>
  name
    .trim()
    // eslint-disable-next-line no-control-regex -- scrub filesystem-hostile control chars from mod names
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '')
    .slice(0, 80)

/** Normalizes an arbitrary mod label to a safe `<name>.json` filename. */
export const modFileName = (name: string): string =>
  `${scrubName(name).replace(/\.json$/i, '') || 'mod'}.json`

/** Re-validates + re-sanitizes a parsed mod file. Never mutates host state. */
export const sanitizeMod = (json: unknown): ModFile | null => {
  if (!isValidMod(json, PROTOCOL_VERSION).ok) return null
  const mod = json as ModFile
  const out: ModFile = {}
  if (mod.meta !== undefined && typeof mod.meta === 'object') {
    const meta: ModMetaData = {}
    if (typeof mod.meta.name === 'string') meta.name = scrubName(mod.meta.name).slice(0, 60) || undefined
    if (typeof mod.meta.author === 'string') meta.author = mod.meta.author.trim().slice(0, 60) || undefined
    if (typeof mod.meta.description === 'string') meta.description = mod.meta.description.trim().slice(0, 160) || undefined
    if (typeof mod.meta.version === 'string') meta.version = mod.meta.version.trim().slice(0, 24) || undefined
    if (typeof mod.meta.requireProtocol === 'number') meta.requireProtocol = mod.meta.requireProtocol
    out.meta = meta
  }
  const cleanSettings = sanitizeSettings((mod.settings ?? {}) as Parameters<typeof sanitizeSettings>[0])
  const cleanMaps = sanitizeOverrideMaps({
    buildingOverrides: mod.buildingOverrides,
    unitOverrides: mod.unitOverrides,
    weaponOverrides: mod.weaponOverrides,
    upgradeOverrides: mod.upgradeOverrides,
  })
  if (mod.settings !== undefined) out.settings = cleanSettings
  for (const [key, map] of Object.entries(cleanMaps) as [keyof typeof cleanMaps, Record<string, Record<string, number>>][]) {
    if (map && Object.keys(map).length > 0) (out as Record<string, unknown>)[key] = map
  }
  return out
}

export interface ModStore {
  readonly dir: string
  ensure(): void
  save(mod: ModFile, suggested?: string): Promise<string>
  read(name: string): Promise<ModFile | null>
  /** Synchronous read used by the sync room/options path. */
  readSync(name: string): ModFile | null
  list(): Promise<ModMeta[]>
  remove(name: string): Promise<boolean>
  /** Renames a mod file and rewrites its `meta.name` label. Returns the new filename. */
  rename(name: string, newName: string): Promise<string | null>
}

export const createModStore = (dir: string): ModStore => {
  const filePath = (name: string): string => join(dir, modFileName(name))
  const fileExists = (p: string): boolean => existsSync(p)

  const uniqueFileName = (name: string): string => {
    const file = modFileName(name)
    const bare = file.slice(0, -5)
    let candidate = file
    let n = 1
    while (fileExists(join(dir, candidate))) {
      candidate = `${bare}-${n}.json`
      n++
    }
    return candidate
  }

  const ensure = (): undefined => {
    mkdirSync(dir, { recursive: true })
    return undefined
  }

  return {
    dir,
    ensure,
    async save(mod, suggested) {
      ensure()
      const clean = sanitizeMod(mod)
      if (!clean) throw new Error('invalid mod')
      const file = uniqueFileName(suggested ?? clean.meta?.name ?? 'mod')
      await writeFile(join(dir, file), JSON.stringify(clean, null, 2), 'utf8')
      return file
    },
    async read(name) {
      try {
        const json = JSON.parse(await readFile(filePath(name), 'utf8')) as unknown
        return sanitizeMod(json)
      } catch {
        return null
      }
    },
    readSync(name) {
      try {
        const json = JSON.parse(readFileSync(filePath(name), 'utf8')) as unknown
        return sanitizeMod(json)
      } catch {
        return null
      }
    },
    async list() {
      ensure()
      const entries = await readdir(dir)
      const names = entries.filter((f) => f.toLowerCase().endsWith('.json'))
      const metas: ModMeta[] = []
      for (const name of names) {
        const file = join(dir, name)
        let size = 0
        let mtimeMs = 0
        try {
          const st = await stat(file)
          size = st.size
          mtimeMs = st.mtimeMs
        } catch {
          continue
        }
        const meta: ModMeta = {
          name,
          label: name.replace(/\.json$/i, ''),
          size,
          createdAt: new Date(mtimeMs).toISOString(),
          valid: false,
          protocolOk: true,
        }
        try {
          const json = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
          const validation = isValidMod(json, PROTOCOL_VERSION)
          meta.valid = validation.ok
          meta.protocolOk = validation.ok
          const metaData = json.meta as ModMetaData | undefined
          if (metaData && typeof metaData === 'object') {
            if (typeof metaData.name === 'string') meta.label = metaData.name
            if (typeof metaData.author === 'string') meta.author = metaData.author
            if (typeof metaData.description === 'string') meta.description = metaData.description
            if (typeof metaData.version === 'string') meta.version = metaData.version
          }
          if (metaData?.requireProtocol !== undefined && metaData.requireProtocol !== PROTOCOL_VERSION) {
            meta.protocolOk = false
          }
        } catch {
          // unreadable/corrupt files stay listed (valid:false) so they can be deleted
        }
        metas.push(meta)
      }
      return metas.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    },
    async remove(name) {
      try {
        await unlink(filePath(name))
        return true
      } catch {
        return false
      }
    },
    async rename(name, newName) {
      const fromFile = modFileName(name)
      const bare = modFileName(newName).slice(0, -5)
      if (bare.toLowerCase() === fromFile.slice(0, -5).toLowerCase()) return fromFile
      const target = uniqueFileName(bare)
      try {
        const json = JSON.parse(readFileSync(filePath(name), 'utf8')) as Record<string, unknown>
        if (json && typeof json === 'object' && !Array.isArray(json)) {
          const meta = (json.meta as ModMetaData | undefined) ?? {}
          meta.name = scrubName(newName).slice(0, 60) || bare
          json.meta = meta
        }
        await writeFile(join(dir, target), JSON.stringify(json, null, 2), 'utf8')
        await unlink(filePath(name))
        return target
      } catch {
        return null
      }
    },
  }
}

export const modStore = createModStore(MODS_DIR)