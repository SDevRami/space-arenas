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
export const DEFAULT_FIELD_SCALE = 1
export const DEFAULT_FIELD_OFFSET = 0
export const DEFAULT_OBSTACLE_SCALE = 1
export const DEFAULT_OBSTACLE_OFFSET = 0
/** Hit-flash / burning-fire size as a fraction of the object's ground footprint (0.5 = half the object's size). */
export const DEFAULT_FX_SCALE = 0.5
/** Hit-flash / burning-fire vertical shift as a fraction of the object's ground footprint size. */
export const DEFAULT_FX_OFFSET = 0
/** Size multiplier for the simple bullet tracer (rifle / AA / turret guns). */
export const DEFAULT_PROJECTILE_BULLET_SIZE = 1
/** Size multiplier for rocket-class tracers and their smoke tail. */
export const DEFAULT_PROJECTILE_ROCKET_SIZE = 1
/** Size multiplier for artillery shell tracers, fire tail and ground carve. */
export const DEFAULT_PROJECTILE_SHELL_SIZE = 1
/** How many render frames the artillery ground carve lingers after the shell hits. */
export const DEFAULT_CARVE_TICKS = 45
/** Peak height in px that artillery shells arch to above the ground line (0 = flat). */
export const DEFAULT_PROJECTILE_SHELL_HEIGHT = 14
/** Zoom factor the minimap jumps to when the Map button toggles it (1 = normal size). */
export const DEFAULT_MINIMAP_SCALE = 1.6
/** Seconds the victory cinematic stays on screen before the results popup. */
export const DEFAULT_VICTORY_CINEMATIC = 6
/** Camera zoom-out floor (farthest out) for normal matches — dev-settings adjustable. */
export const DEFAULT_ZOOM_MIN = 0.5
/** Camera zoom-in ceiling (closest in) for normal matches — dev-settings adjustable. */
export const DEFAULT_ZOOM_MAX = 2.5
/** Camera zoom-out floor (farthest out) for replays/spectate — dev-settings adjustable. */
export const DEFAULT_REPLAY_ZOOM_MIN = 0.4
/** Camera zoom-in ceiling (closest in) for replays/spectate — dev-settings adjustable. */
export const DEFAULT_REPLAY_ZOOM_MAX = 5

export type UnitScaleClass = 'vehicle' | 'infantry' | 'air' | 'naval'
export const DEFAULT_UNIT_SCALE: Record<UnitScaleClass, number> = { vehicle: 1, infantry: 1, air: 1, naval: 1 }
/** Vertical sprite shift per unit class, as a fraction of the sprite's own width. */
export const DEFAULT_UNIT_OFFSET: Record<UnitScaleClass, number> = { vehicle: 0, infantry: 0, air: 0, naval: 0 }

export type SpriteLayerKind = 'border' | 'troop' | 'vehicle' | 'building' | 'effect'
export const SPRITE_LAYER_KINDS: SpriteLayerKind[] = ['border', 'troop', 'vehicle', 'building', 'effect']
/** Dev-settings sprite draw order: lower = drawn first (further behind). Matches the pre-existing renderer stacking order. */
export const DEFAULT_SPRITE_LAYER_ORDER: Record<SpriteLayerKind, number> = {
  border: 0,
  troop: 1,
  vehicle: 2,
  building: 3,
  effect: 4,
}
/** Whole-HUD size multiplier (zoom-like) for the game UI overlays. 1 = full size. */
export const DEFAULT_UI_SCALE = 0.8

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
  bunker: 'bn',
  dock: 'd',
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
  'engineer',
  'apc',
  'fighter',
  'carrier',
  'missile-boat',
]

export const OBSTACLE_ASSET_TYPES = ['rock', 'tree', 'wreck', 'mine']

const UNIT_ASSET_FOLDERS: Record<string, string> = {
  bulldozer: 'v_b',
  harvester: 'v_h',
  'assault-walker': 'v_aw',
  'aa-platform': 'v_aa',
  artillery: 'v_a',
  engineer: 'v_e',
  fighter: 'v_f',
  carrier: 'v_c',
  'missile-boat': 'v_mb',
}

/** Entities with a dedicated HUD selection-bar icon in client/dist/hud (hud_<folder>.png). */
export const HUD_ASSET_IDS = [...Object.keys(BUILDING_ASSET_FOLDERS), ...Object.keys(UNIT_ASSET_FOLDERS)]

/** Client-only high-quality asset path templates; {frame} is replaced with the 4-digit image number, {color} with the player's 1-based color folder. Units are rendered in 8 heading frames (0001-0008); {dir} is kept for legacy user overrides. */
export const DEFAULT_ASSET_PATHS: Record<string, string> = {
  ...Object.fromEntries(Object.entries(BUILDING_ASSET_FOLDERS).map(([id, f]) => [`building:${id}`, `${f}/{color}/${f}_{frame}.png`])),
  'field:supply': 'sf/sf_{frame}.png',
  'field:oil': 'of/of_{frame}.png',
  ...Object.fromEntries(Object.entries(UNIT_ASSET_FOLDERS).map(([id, f]) => [`unit:${id}`, `${f}/{color}/${f}_{frame}.png`])),
  ...Object.fromEntries([...Object.entries(BUILDING_ASSET_FOLDERS), ...Object.entries(UNIT_ASSET_FOLDERS)].map(([id, f]) => [`hud:${id}`, `hud/hud_${f}.png`])),
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
  fieldScale: number
  fieldOffset: number
  obstacleScale: number
  obstacleOffset: number
  unitScale: Record<UnitScaleClass, number>
  unitOffset: Record<UnitScaleClass, number>
  assetPaths: Record<string, string>
  /** Selection-bar thumbnail size in px. */
  hudIconSize: number
  /** Hit-flash / burning-fire size as a fraction of the object's ground footprint. */
  fxScale: number
  /** Hit-flash / burning-fire vertical shift as a fraction of the object's ground footprint size. */
  fxOffset: number
  /** Size multiplier for the simple bullet tracer (rifle / AA / turret guns). */
  projectileBulletSize: number
  /** Size multiplier for rocket-class tracers and their smoke tail. */
  projectileRocketSize: number
  /** Size multiplier for artillery shell tracers, fire tail and ground carve. */
  projectileShellSize: number
  /** How many render frames the artillery ground carve lingers after the shell hits. */
  carveTicks: number
  /** Peak height in px that artillery shells arch to above the ground line (0 = flat). */
  projectileShellHeight: number
  /** Zoom factor for the enlargable minimap (Map button); 1 = normal size. */
  minimapScale: number
  /** Seconds the victory cinematic stays before the results popup (0 = skip). */
  victoryCinematicSec: number
  /** Camera zoom-out floor for normal matches. */
  zoomMin: number
  /** Camera zoom-in ceiling for normal matches. */
  zoomMax: number
  /** Camera zoom-out floor for replays/spectate (wider out). */
  replayZoomMin: number
  /** Camera zoom-in ceiling for replays/spectate (deeper in). */
  replayZoomMax: number
  /** Dev-settings draw order for sprite layers (border/troop/vehicle/building/effect). */
  spriteLayerOrder: Record<SpriteLayerKind, number>
  /** Whole-HUD size multiplier applied to the game UI overlays (1 = full size). */
  uiScale: number
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
    fieldScale: DEFAULT_FIELD_SCALE,
    fieldOffset: DEFAULT_FIELD_OFFSET,
    obstacleScale: DEFAULT_OBSTACLE_SCALE,
    obstacleOffset: DEFAULT_OBSTACLE_OFFSET,
    unitScale: { ...DEFAULT_UNIT_SCALE },
    unitOffset: { ...DEFAULT_UNIT_OFFSET },
    assetPaths: { ...DEFAULT_ASSET_PATHS },
    hudIconSize: 20,
    fxScale: DEFAULT_FX_SCALE,
    fxOffset: DEFAULT_FX_OFFSET,
    projectileBulletSize: DEFAULT_PROJECTILE_BULLET_SIZE,
    projectileRocketSize: DEFAULT_PROJECTILE_ROCKET_SIZE,
    projectileShellSize: DEFAULT_PROJECTILE_SHELL_SIZE,
    carveTicks: DEFAULT_CARVE_TICKS,
    projectileShellHeight: DEFAULT_PROJECTILE_SHELL_HEIGHT,
    minimapScale: DEFAULT_MINIMAP_SCALE,
    victoryCinematicSec: DEFAULT_VICTORY_CINEMATIC,
    zoomMin: DEFAULT_ZOOM_MIN,
    zoomMax: DEFAULT_ZOOM_MAX,
    replayZoomMin: DEFAULT_REPLAY_ZOOM_MIN,
    replayZoomMax: DEFAULT_REPLAY_ZOOM_MAX,
    spriteLayerOrder: { ...DEFAULT_SPRITE_LAYER_ORDER },
    uiScale: DEFAULT_UI_SCALE,
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
        base.fieldOffset = Math.max(-2, Math.min(2, parsed.fieldOffset))
      }
      if (parsed && typeof parsed.fieldScale === 'number' && Number.isFinite(parsed.fieldScale)) {
        base.fieldScale = Math.max(0.1, Math.min(5, parsed.fieldScale))
      }
      if (parsed && typeof parsed.obstacleScale === 'number' && Number.isFinite(parsed.obstacleScale)) {
        base.obstacleScale = Math.max(0.1, Math.min(5, parsed.obstacleScale))
      }
      if (parsed && typeof parsed.obstacleOffset === 'number' && Number.isFinite(parsed.obstacleOffset)) {
        base.obstacleOffset = Math.max(-2, Math.min(2, parsed.obstacleOffset))
      }
      if (parsed && parsed.unitScale && typeof parsed.unitScale === 'object') {
        for (const c of ['vehicle', 'infantry', 'air', 'naval'] as UnitScaleClass[]) {
          const v = (parsed.unitScale as Record<string, unknown>)[c]
          if (typeof v === 'number' && Number.isFinite(v)) base.unitScale[c] = v
        }
      }
      if (parsed && parsed.unitOffset && typeof parsed.unitOffset === 'object') {
        for (const c of ['vehicle', 'infantry', 'air', 'naval'] as UnitScaleClass[]) {
          const v = (parsed.unitOffset as Record<string, unknown>)[c]
          if (typeof v === 'number' && Number.isFinite(v)) base.unitOffset[c] = Math.max(-2, Math.min(2, v))
        }
      }
      if (parsed && typeof parsed.hudIconSize === 'number' && Number.isFinite(parsed.hudIconSize)) {
        base.hudIconSize = Math.max(8, Math.min(64, parsed.hudIconSize))
      }
      if (parsed && typeof parsed.fxScale === 'number' && Number.isFinite(parsed.fxScale)) {
        base.fxScale = Math.max(0.05, Math.min(3, parsed.fxScale))
      }
      if (parsed && typeof parsed.fxOffset === 'number' && Number.isFinite(parsed.fxOffset)) {
        base.fxOffset = Math.max(-2, Math.min(2, parsed.fxOffset))
      }
      if (parsed && typeof parsed.projectileBulletSize === 'number' && Number.isFinite(parsed.projectileBulletSize)) {
        base.projectileBulletSize = Math.max(0.2, Math.min(4, parsed.projectileBulletSize))
      }
      if (parsed && typeof parsed.projectileRocketSize === 'number' && Number.isFinite(parsed.projectileRocketSize)) {
        base.projectileRocketSize = Math.max(0.2, Math.min(4, parsed.projectileRocketSize))
      }
      if (parsed && typeof parsed.projectileShellSize === 'number' && Number.isFinite(parsed.projectileShellSize)) {
        base.projectileShellSize = Math.max(0.2, Math.min(4, parsed.projectileShellSize))
      }
      if (parsed && typeof parsed.carveTicks === 'number' && Number.isFinite(parsed.carveTicks)) {
        base.carveTicks = Math.max(0, Math.min(240, Math.round(parsed.carveTicks)))
      }
      if (parsed && typeof parsed.projectileShellHeight === 'number' && Number.isFinite(parsed.projectileShellHeight)) {
        base.projectileShellHeight = Math.max(0, Math.min(60, Math.round(parsed.projectileShellHeight)))
      }
      if (parsed && typeof parsed.minimapScale === 'number' && Number.isFinite(parsed.minimapScale)) {
        base.minimapScale = Math.max(1.2, Math.min(4, parsed.minimapScale))
      }
      if (parsed && typeof parsed.victoryCinematicSec === 'number' && Number.isFinite(parsed.victoryCinematicSec)) {
        base.victoryCinematicSec = Math.max(0, Math.min(30, Math.round(parsed.victoryCinematicSec)))
      }
      if (parsed && typeof parsed.zoomMin === 'number' && Number.isFinite(parsed.zoomMin)) {
        base.zoomMin = Math.max(0.05, Math.min(1, parsed.zoomMin))
      }
      if (parsed && typeof parsed.zoomMax === 'number' && Number.isFinite(parsed.zoomMax)) {
        base.zoomMax = Math.max(1, Math.min(20, parsed.zoomMax))
      }
      if (parsed && typeof parsed.replayZoomMin === 'number' && Number.isFinite(parsed.replayZoomMin)) {
        base.replayZoomMin = Math.max(0.05, Math.min(1, parsed.replayZoomMin))
      }
      if (parsed && typeof parsed.replayZoomMax === 'number' && Number.isFinite(parsed.replayZoomMax)) {
        base.replayZoomMax = Math.max(1, Math.min(50, parsed.replayZoomMax))
      }
      if (parsed && parsed.spriteLayerOrder && typeof parsed.spriteLayerOrder === 'object') {
        for (const k of SPRITE_LAYER_KINDS) {
          const v = (parsed.spriteLayerOrder as Record<string, unknown>)[k]
          if (typeof v === 'number' && Number.isFinite(v)) {
            base.spriteLayerOrder[k] = Math.max(-50, Math.min(50, Math.round(v)))
          }
        }
      }
      if (parsed && typeof parsed.uiScale === 'number' && Number.isFinite(parsed.uiScale)) {
        base.uiScale = Math.max(0.5, Math.min(1.5, parsed.uiScale))
      }
      if (base.zoomMin >= base.zoomMax) {
        base.zoomMin = DEFAULT_ZOOM_MIN
        base.zoomMax = DEFAULT_ZOOM_MAX
      }
      if (base.replayZoomMin >= base.replayZoomMax) {
        base.replayZoomMin = DEFAULT_REPLAY_ZOOM_MIN
        base.replayZoomMax = DEFAULT_REPLAY_ZOOM_MAX
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
            if (f && (v === '' || v === `${f}/${f}_{dir}.png` || v === `${f}/${f}_{dir}_{color}.png` || v.includes('{dir}'))) return adopt()
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

/** Re-read `state` from localStorage after an external write (e.g. a cloud-backup
 * restore). The renderer and dev-settings form keep reading `state`, so mutating it
 * in place applies the restored values immediately. */
export const reloadGraphics = (): void => {
  Object.assign(state, load())
}

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

export const setFieldScale = (value: number): void => {
  state.fieldScale = Math.max(0.1, Math.min(5, value))
  save(state)
}

export const setObstacleScale = (value: number): void => {
  state.obstacleScale = Math.max(0.1, Math.min(5, value))
  save(state)
}

export const setObstacleOffset = (value: number): void => {
  state.obstacleOffset = Math.max(-2, Math.min(2, value))
  save(state)
}

export const setUnitScale = (cls: UnitScaleClass, value: number): void => {
  state.unitScale[cls] = Math.max(0.1, Math.min(5, value))
  save(state)
}

export const setUnitOffset = (cls: UnitScaleClass, value: number): void => {
  state.unitOffset[cls] = Math.max(-2, Math.min(2, value))
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

export const setFxScale = (v: number): void => {
  state.fxScale = Math.max(0.05, Math.min(3, v))
  save(state)
}

export const setFxOffset = (v: number): void => {
  state.fxOffset = Math.max(-2, Math.min(2, v))
  save(state)
}

export const setProjectileBulletSize = (v: number): void => {
  state.projectileBulletSize = Math.max(0.2, Math.min(4, v))
  save(state)
}

export const setProjectileRocketSize = (v: number): void => {
  state.projectileRocketSize = Math.max(0.2, Math.min(4, v))
  save(state)
}

export const setProjectileShellSize = (v: number): void => {
  state.projectileShellSize = Math.max(0.2, Math.min(4, v))
  save(state)
}

export const setCarveTicks = (v: number): void => {
  state.carveTicks = Math.max(0, Math.min(240, Math.round(v)))
  save(state)
}

export const setProjectileShellHeight = (v: number): void => {
  state.projectileShellHeight = Math.max(0, Math.min(60, Math.round(v)))
  save(state)
}

export const setMinimapScale = (v: number): void => {
  state.minimapScale = Math.max(1.2, Math.min(4, v))
  save(state)
}

export const setVictoryCinematicSec = (v: number): void => {
  state.victoryCinematicSec = Math.max(0, Math.min(30, Math.round(v)))
  save(state)
}

export const setZoomMin = (v: number): void => {
  state.zoomMin = Math.max(0.05, Math.min(1, v))
  if (state.zoomMax <= state.zoomMin) state.zoomMax = state.zoomMin + 0.05
  save(state)
}

export const setZoomMax = (v: number): void => {
  state.zoomMax = Math.max(1, Math.min(20, v))
  if (state.zoomMin >= state.zoomMax) state.zoomMin = Math.max(0.05, state.zoomMax - 0.05)
  save(state)
}

export const setReplayZoomMin = (v: number): void => {
  state.replayZoomMin = Math.max(0.05, Math.min(1, v))
  if (state.replayZoomMax <= state.replayZoomMin) state.replayZoomMax = state.replayZoomMin + 0.05
  save(state)
}

export const setReplayZoomMax = (v: number): void => {
  state.replayZoomMax = Math.max(1, Math.min(50, v))
  if (state.replayZoomMin >= state.replayZoomMax) state.replayZoomMin = Math.max(0.05, state.replayZoomMax - 0.05)
  save(state)
}

export const setSpriteLayerOrder = (kind: SpriteLayerKind, v: number): void => {
  state.spriteLayerOrder[kind] = Math.max(-50, Math.min(50, Math.round(v)))
  save(state)
}

export const setUiScale = (v: number): void => {
  state.uiScale = Math.max(0.5, Math.min(1.5, v))
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
