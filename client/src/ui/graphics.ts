export type GraphicsQuality = 'low' | 'medium' | 'high'
export type EffectId = 'effects'
export type WeatherId = 'none' | 'rain' | 'snow' | 'thunder'

export const GRAPHICS_QUALITY: GraphicsQuality = 'low'
export const QUALITIES: GraphicsQuality[] = ['low', 'medium', 'high']

export interface BuildingFillRatios {
  medium: number
  high: number
}

export const DEFAULT_BUILDING_FILL: BuildingFillRatios = { medium: 0.3, high: 0.5 }
export const DEFAULT_BUILDING_OFFSET: BuildingFillRatios = { medium: 0.2, high: 0 }
export const DEFAULT_FIELD_OFFSET = 0

export type UnitScaleClass = 'vehicle' | 'infantry' | 'air'
export const DEFAULT_UNIT_SCALE: Record<UnitScaleClass, number> = { vehicle: 1, infantry: 1, air: 1 }

const BUILDING_ASSET_FOLDERS: Record<string, string> = {
  'command-center': 'cc',
  'power-plant': 'pp',
  'supply-dock': 'sd',
  barracks: 'b',
  'war-factory': 'wf',
  turret: 't',
  'tech-center': 'tc',
  'air-force': 'af',
  'super-weapon': 'sp',
}

export const UNIT_ASSET_IDS = [
  'bulldozer',
  'harvester',
  'scout',
  'rifleman',
  'rocket-trooper',
  'assault-walker',
  'aa-platform',
  'artillery',
  'fighter',
]

export const OBSTACLE_ASSET_TYPES = ['rock', 'tree', 'wreck']

const UNIT_ASSET_FOLDERS: Record<string, string> = {
  bulldozer: 'v_b',
  harvester: 'v_h',
  'assault-walker': 'v_aw',
  'aa-platform': 'v_aa',
  artillery: 'v_a',
  fighter: 'v_f',
}

/** Client-only high-quality asset path templates; {frame} is replaced with the 4-digit image number, {dir} with a direction name, {color} with the player's 1-based color folder. */
export const DEFAULT_ASSET_PATHS: Record<string, string> = {
  ...Object.fromEntries(Object.entries(BUILDING_ASSET_FOLDERS).map(([id, f]) => [`building:${id}`, `${f}/{color}/${f}_{frame}.png`])),
  'field:supply': 'sf/sf_{frame}.png',
  'field:oil': 'of/of_{frame}.png',
  ...Object.fromEntries(Object.entries(UNIT_ASSET_FOLDERS).map(([id, f]) => [`unit:${id}`, `${f}/{color}/${f}_{dir}.png`])),
  obstacle: 'ao/{type}.png',
  ...Object.fromEntries(OBSTACLE_ASSET_TYPES.map((k) => [`obstacle:${k}`, `ao/${k}.png`])),
  // empty = procedural flame fallback; a user override like `fx/burn/burn_{frame}.png` loads 2 animated frames
  'fx:burn': '',
}

export const SUPPLY_FIELD_FRAMES = 25
export const OIL_FIELD_FRAMES = 4

const STORAGE_KEY = 'space-arenas:graphics'

const DEFAULT_EFFECTS: Record<EffectId, boolean> = {
  effects: true,
}

export interface GraphicsSettings {
  quality: GraphicsQuality
  effects: Record<EffectId, boolean>
  weather: WeatherId
  buildingFill: BuildingFillRatios
  buildingOffset: BuildingFillRatios
  fieldOffset: number
  unitScale: Record<UnitScaleClass, number>
  assetPaths: Record<string, string>
  /** Selection-bar thumbnail size in px. */
  hudIconSize: number
}

export interface EffectRowDef {
  id: EffectId
  labelKey: string
  descKey: string
}

export const EFFECT_ROWS: EffectRowDef[] = [
  {
    id: 'effects',
    labelKey: 'settings.graphics.effectsLabel',
    descKey: 'settings.graphics.effectsDesc',
  },
]

export const WEATHERS: WeatherId[] = ['none', 'rain', 'snow', 'thunder']

const load = (): GraphicsSettings => {
  const base: GraphicsSettings = {
    quality: GRAPHICS_QUALITY,
    effects: { ...DEFAULT_EFFECTS },
    weather: 'none',
    buildingFill: { ...DEFAULT_BUILDING_FILL },
    buildingOffset: { ...DEFAULT_BUILDING_OFFSET },
    fieldOffset: DEFAULT_FIELD_OFFSET,
    unitScale: { ...DEFAULT_UNIT_SCALE },
    assetPaths: { ...DEFAULT_ASSET_PATHS },
    hudIconSize: 20,
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<GraphicsSettings>
      if (parsed && parsed.effects && typeof parsed.effects === 'object') {
        for (const id of Object.keys(DEFAULT_EFFECTS) as EffectId[]) {
          const v = parsed.effects[id]
          if (typeof v === 'boolean') base.effects[id] = v
        }
        // migration: the three separate combat-effect toggles (bullet impact,
        // bullet projectile, laser beam) were collapsed into a single one.
        const legacy = parsed.effects as Record<string, unknown>
        if (typeof legacy.bulletImpact === 'boolean' || typeof legacy.bulletProjectile === 'boolean' || typeof legacy.laserBeam === 'boolean') {
          base.effects.effects =
            legacy.bulletImpact !== false &&
            legacy.bulletProjectile !== false &&
            legacy.laserBeam !== false
        }
      }
      if (parsed && WEATHERS.includes(parsed.weather as WeatherId)) {
        base.weather = parsed.weather as WeatherId
      }
      if (parsed && QUALITIES.includes(parsed.quality as GraphicsQuality)) {
        base.quality = parsed.quality as GraphicsQuality
      }
      if (parsed && parsed.buildingFill) {
        for (const q of ['medium', 'high'] as Array<keyof BuildingFillRatios>) {
          const v = parsed.buildingFill[q]
          if (typeof v === 'number' && Number.isFinite(v)) base.buildingFill[q] = v
        }
      }
      if (parsed && parsed.buildingOffset) {
        for (const q of ['medium', 'high'] as Array<keyof BuildingFillRatios>) {
          const v = parsed.buildingOffset[q]
          if (typeof v === 'number' && Number.isFinite(v)) base.buildingOffset[q] = v
        }
      }
      if (parsed && typeof parsed.fieldOffset === 'number' && Number.isFinite(parsed.fieldOffset)) {
        base.fieldOffset = parsed.fieldOffset
      }
      if (parsed && parsed.unitScale && typeof parsed.unitScale === 'object') {
        for (const c of ['vehicle', 'infantry', 'air'] as UnitScaleClass[]) {
          const v = (parsed.unitScale as Record<string, unknown>)[c]
          if (typeof v === 'number' && Number.isFinite(v)) base.unitScale[c] = v
        }
      }
      if (parsed && typeof parsed.hudIconSize === 'number' && Number.isFinite(parsed.hudIconSize)) {
        base.hudIconSize = Math.max(8, Math.min(64, parsed.hudIconSize))
      }
      if (parsed && parsed.assetPaths && typeof parsed.assetPaths === 'object') {
        // migration: the color slot moved from a filename suffix to a subfolder
        // (pp/pp_0001_1.png → pp/1/pp_0001.png). Stored old-default templates are
        // replaced by the new defaults; genuine user overrides are kept.
        const migrateKey = (k: string, v: string): string => {
          const adopt = (): string => (DEFAULT_ASSET_PATHS[k] as string) ?? v
          if (k.startsWith('building:')) {
            const f = BUILDING_ASSET_FOLDERS[k.slice('building:'.length)]
            if (f && (v === '' || v === `${f}/${f}_{frame}_{color}.png`)) return adopt()
          } else if (k.startsWith('unit:')) {
            const f = UNIT_ASSET_FOLDERS[k.slice('unit:'.length)]
            if (f && (v === '' || v === `${f}/${f}_{dir}_{color}.png`)) return adopt()
          }
          return v === '' && DEFAULT_ASSET_PATHS[k] ? adopt() : v
        }
        for (const [k, v] of Object.entries(parsed.assetPaths)) {
          if (typeof v !== 'string') continue
          base.assetPaths[k] = migrateKey(k, v)
        }
      }
    }
  } catch {
    /* storage unavailable */
  }
  return base
}

const save = (g: GraphicsSettings): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(g))
  } catch {
    /* storage unavailable */
  }
}

const state = load()

export const getGraphics = (): GraphicsSettings => state

export const setBuildingFill = (q: GraphicsQuality, value: number): void => {
  if (q !== 'medium' && q !== 'high') return
  const v = Math.max(0, Math.min(1, value))
  state.buildingFill[q] = v
  save(state)
}

export const setBuildingOffset = (q: GraphicsQuality, value: number): void => {
  if (q !== 'medium' && q !== 'high') return
  const v = Math.max(-2, Math.min(2, value))
  state.buildingOffset[q] = v
  save(state)
}

export const setAssetPath = (key: string, value: string): void => {
  state.assetPaths[key] = value
  save(state)
}

export const setFieldOffset = (value: number): void => {
  state.fieldOffset = Math.max(-2, Math.min(2, value))
  save(state)
}

export const setUnitScale = (cls: UnitScaleClass, value: number): void => {
  state.unitScale[cls] = Math.max(0.1, Math.min(5, value))
  save(state)
}

export const effectEnabled = (id: EffectId): boolean => state.effects[id] === true

export const setEffect = (id: EffectId, on: boolean): void => {
  state.effects[id] = on
  save(state)
}

export const setWeather = (id: WeatherId): void => {
  state.weather = id
  save(state)
}

export const setHudIconSize = (px: number): void => {
  state.hudIconSize = Math.max(8, Math.min(64, Math.round(px)))
  save(state)
}

export const setQuality = (q: GraphicsQuality): void => {
  if (!QUALITIES.includes(q)) return
  state.quality = q
  save(state)
}

/** Cosmetic night tint overlay color for the day/night cycle. `phase` 0 = noon, 1 = midnight. */
export const dayNightTint = (phase: number): { color: number; a: number } => {
  const night = Math.max(0, Math.min(1, phase))
  if (night <= 0) return { color: 0x1a2a44, a: 0 }
  return { color: 0x1a2a44, a: 0.25 * night }
}
