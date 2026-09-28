import { MAP_PRESETS, mapForPreset, validateMap, type MapData } from '@space-arenas/shared'

const CUSTOM_MAPS_KEY = 'space-arenas:custom-maps'
const LEGACY_DB_NAME = 'space-arenas-maps'
const LEGACY_DB_STORE = 'maps'

export interface MapEntry {
  kind: 'preset' | 'custom'
  id: string
  name: string
  players: number
  description: string
  variant?: string
  data?: MapData
}

const clone = (m: MapData): MapData => JSON.parse(JSON.stringify(m)) as MapData

export const customMapId = (name: string): string => `custom:${name}`

export const loadCustomMaps = (): MapData[] => {
  try {
    const raw = localStorage.getItem(CUSTOM_MAPS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((m): m is MapData => !!m && typeof m === 'object' && typeof (m as MapData).name === 'string')
  } catch {
    return []
  }
}

const saveCustomMaps = (maps: MapData[]): void => {
  try {
    localStorage.setItem(CUSTOM_MAPS_KEY, JSON.stringify(maps))
  } catch {
    /* storage unavailable */
  }
}

export const findCustomMap = (name: string): MapData | undefined => loadCustomMaps().find((m) => m.name === name)

export interface SaveResult {
  ok: boolean
  errors: string[]
}

/** Upsert a custom map. `prevName` is the name it was saved under before a rename. */
export const saveCustomMap = (map: MapData, prevName?: string): SaveResult => {
  const v = validateMap(map)
  if (!v.ok) return { ok: false, errors: v.errors }
  if (findCustomMap(map.name)) {
    const idx = loadCustomMaps().findIndex((m) => m.name === map.name)
    const maps = loadCustomMaps()
    maps[idx] = clone(map)
    saveCustomMaps(maps)
    return { ok: true, errors: [] }
  }
  const maps = loadCustomMaps()
  if (prevName && prevName !== map.name) {
    const idx = maps.findIndex((m) => m.name === prevName)
    if (idx >= 0) maps[idx] = clone(map)
    else maps.push(clone(map))
  } else {
    maps.push(clone(map))
  }
  saveCustomMaps(maps)
  return { ok: true, errors: [] }
}

export const deleteCustomMap = (name: string): void => {
  saveCustomMaps(loadCustomMaps().filter((m) => m.name !== name))
}

/** Any `.json` maps committed under `client/maps/` are bundled at build time. */
const bundledMapModules = import.meta.glob<{ default: unknown }>('../../maps/*.json', { eager: true })

/** Import bundled `maps/*.json` files into the custom library on first run.
 *  Files are skipped when a custom map with the same name already exists, so the
 *  player's own maps are never overwritten. Returns how many new maps were added. */
export const seedLibraryFromBundledMaps = (): number => {
  let added = 0
  for (const mod of Object.values(bundledMapModules)) {
    const raw = mod?.default
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const map = raw as MapData
    if (typeof map.name !== 'string' || map.name === '') continue
    if (findCustomMap(map.name)) continue
    if (saveCustomMap(map).ok) added += 1
  }
  return added
}

export const renameCustomMap = (from: string, to: string): void => {
  saveCustomMaps(loadCustomMaps().map((m) => (m.name === from ? { ...m, name: to } : m)))
}

/** Presets + custom maps, newest custom first. */
export const allMapEntries = (): MapEntry[] => {
  const presets: MapEntry[] = MAP_PRESETS.map((p) => ({
    kind: 'preset',
    id: p.id,
    name: p.name,
    players: p.players,
    description: p.description,
    variant: p.variant,
  }))
  const customs: MapEntry[] = loadCustomMaps().map((m) => ({
    kind: 'custom',
    id: customMapId(m.name),
    name: m.name,
    players: m.spawnPoints.length,
    description: m.description || '',
    data: m,
  }))
  return [...presets, ...customs.reverse()]
}

export const findMapEntry = (id: string): MapEntry | undefined => allMapEntries().find((e) => e.id === id)

export const entryToMap = (entry: MapEntry): MapData => {
  if (entry.kind === 'custom' && entry.data) return clone(entry.data)
  const preset = MAP_PRESETS.find((p) => p.id === entry.id)
  if (!preset) return mapForPreset(MAP_PRESETS[0])
  return mapForPreset(preset)
}

/** One-time import of maps saved by the standalone Map Builder (IndexedDB). */
export const migrateLegacyLibrary = async (): Promise<void> => {
  if (typeof indexedDB === 'undefined') return
  if (loadCustomMaps().length > 0) return
  const open = (): Promise<IDBDatabase> =>
    new Promise((resolve) => {
      const req = indexedDB.open(LEGACY_DB_NAME, 1)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null as unknown as IDBDatabase)
      req.onupgradeneeded = () => {
        req.result.createObjectStore(LEGACY_DB_STORE, { keyPath: 'name' })
      }
    })
  const db = await open()
  if (!db) return
  const readAll = (): Promise<MapData[]> =>
    new Promise((resolve) => {
      try {
        const tx = db.transaction(LEGACY_DB_STORE, 'readonly')
        const req = tx.objectStore(LEGACY_DB_STORE).getAll()
        req.onsuccess = () => {
          const out: MapData[] = []
          for (const row of (req.result as Array<{ map: string }>) ?? []) {
            try {
              const m = JSON.parse(row.map) as MapData
              if (m && typeof m.name === 'string') out.push(m)
            } catch {
              /* skip corrupt rows */
            }
          }
          resolve(out)
        }
        req.onerror = () => resolve([])
      } catch {
        resolve([])
      }
    })
  const legacy = await readAll()
  if (legacy.length > 0) saveCustomMaps(legacy.map(clone))
  db.close()
}
