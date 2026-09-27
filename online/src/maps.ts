import { validateMap, type MapData } from '@space-arenas/shared'

/** Uploads above this size are refused (same ceiling as the mod repository). */
export const MAP_MAX_BYTES = 4 * 1024 * 1024

/** Per-account cap on how many maps one user may publish. */
export const MAPS_MAX_PER_USER = 20

const scrubName = (name: string): string =>
  name
    .trim()
    // eslint-disable-next-line no-control-regex -- scrub filesystem-hostile control chars from map names
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '')
    .slice(0, 80)

/** Re-validates + re-sanitizes a parsed map file (same `validateMap` gate as the LAN map builder). */
export const sanitizeMap = (json: unknown): MapData | null => {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null
  try {
    const check = validateMap(json as MapData)
    if (!check.ok) return null
  } catch {
    // validateMap assumes a fully-shaped MapData; hostile/partial uploads must simply be rejected.
    return null
  }
  const m = json as MapData
  return {
    ...m,
    name: scrubName(m.name).slice(0, 60) || 'Unnamed',
    description: m.description.replace(/\s+/g, ' ').trim().slice(0, 160),
    author: scrubName(m.author).slice(0, 60) || '',
    mapVersion: m.mapVersion.replace(/\s+/g, ' ').trim().slice(0, 24) || '0.1.0',
  }
}

/** Human label for the repo list: `name` when present, else fallback. */
export const mapLabel = (m: MapData | null | undefined, fallback = 'map'): string => {
  const name = m?.name?.trim()
  return name && name !== '' ? name : fallback
}

/** Lightweight metrics denormalized onto the maps row for the payload-free repo list. */
export const mapMetrics = (m: MapData): { width: number; height: number; players: number } => ({
  width: m.width,
  height: m.height,
  players: m.spawnPoints.length,
})