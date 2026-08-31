export type GraphicsQuality = 'low' | 'medium' | 'high'
export type EffectId = 'bulletImpact' | 'bulletProjectile' | 'laserBeam'
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

/** Client-only high-quality asset path templates; {frame} is replaced with the image number, {dir} with a direction name. */
export const DEFAULT_ASSET_PATHS: Record<string, string> = {
  ...Object.fromEntries(Object.entries(BUILDING_ASSET_FOLDERS).map(([id, f]) => [`building:${id}`, `${f}/${f}_{frame}.png`])),
  'field:supply': 'sf/sf_{frame}.png',
  'field:oil': 'of/of_{frame}.png',
  ...Object.fromEntries(Object.entries(UNIT_ASSET_FOLDERS).map(([id, f]) => [`unit:${id}`, `${f}/${f}_{dir}.png`])),
  obstacle: 'ao/{type}.png',
  ...Object.fromEntries(OBSTACLE_ASSET_TYPES.map((k) => [`obstacle:${k}`, `ao/${k}.png`])),
}

export const SUPPLY_FIELD_FRAMES = 25
export const OIL_FIELD_FRAMES = 4

const STORAGE_KEY = 'space-arenas:graphics'

const DEFAULT_EFFECTS: Record<EffectId, boolean> = {
  bulletImpact: true,
  bulletProjectile: true,
  laserBeam: true,
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
}

export interface EffectRowDef {
  id: EffectId
  labelKey: string
  descKey: string
}

export const EFFECT_ROWS: EffectRowDef[] = [
  {
    id: 'bulletImpact',
    labelKey: 'settings.graphics.effects.bulletImpact',
    descKey: 'settings.graphics.effects.bulletImpactDesc',
  },
  {
    id: 'bulletProjectile',
    labelKey: 'settings.graphics.effects.bulletProjectile',
    descKey: 'settings.graphics.effects.bulletProjectileDesc',
  },
  {
    id: 'laserBeam',
    labelKey: 'settings.graphics.effects.laserBeam',
    descKey: 'settings.graphics.effects.laserBeamDesc',
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
      if (parsed && parsed.assetPaths && typeof parsed.assetPaths === 'object') {
        for (const [k, v] of Object.entries(parsed.assetPaths)) {
          if (typeof v !== 'string') continue
          // stored empty value over a key that now ships with a default → adopt the default
          base.assetPaths[k] = v === '' && DEFAULT_ASSET_PATHS[k] ? (DEFAULT_ASSET_PATHS[k] as string) : v
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

export const setQuality = (q: GraphicsQuality): void => {
  if (!QUALITIES.includes(q)) return
  state.quality = q
  save(state)
}
