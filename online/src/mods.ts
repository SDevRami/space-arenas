import {
  PROTOCOL_VERSION,
  isValidMod,
  type ModFile,
  type ModMetaData,
} from '@space-arenas/shared'
import { sanitizeOverrideMaps, sanitizeSettings } from './sanitize.ts'

/** Retained from the LAN host (`host/src/mods.ts`): uploads above this size are refused. */
export const MOD_MAX_BYTES = 4 * 1024 * 1024

/** Per-account cap on how many mods one user may publish. */
export const MODS_MAX_PER_USER = 20

const scrubName = (name: string): string =>
  name
    .trim()
    // eslint-disable-next-line no-control-regex -- scrub filesystem-hostile control chars from mod names
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '')
    .slice(0, 80)

/** Re-validates + re-sanitizes a parsed mod file (same behavior as the LAN host). */
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

/** Human label for the repo list: `meta.name` when present, else fallback. */
export const modLabel = (meta?: ModMetaData, fallback = 'mod'): string => {
  const name = meta?.name?.trim()
  return name && name !== '' ? name : fallback
}