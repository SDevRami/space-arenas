import { Assets, type Texture } from 'pixi.js'
import { getGraphics, UNIT_ASSET_IDS } from '../ui/graphics.ts'

const FOLDERS: Record<string, string> = {
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

export const BUILDING_STATUS_FRAMES = 8

const sprites = new Map<string, Texture[]>()
const pending = new Set<string>()

const frameUrl = (type: string, folder: string, frame: number): string => {
  const override = getGraphics().assetPaths[`building:${type}`]?.trim()
  if (override) {
    if (/^https?:\/\//i.test(override) || override.startsWith('/')) return override.replaceAll('{frame}', String(frame))
    return `${import.meta.env.BASE_URL}${override.replaceAll('{frame}', String(frame))}`
  }
  return `${import.meta.env.BASE_URL}${folder}/${folder}_${frame}.png`
}

const loadFrame = async (type: string, folder: string, frame: number): Promise<void> => {
  const slot = `${type}:${frame}`
  if (sprites.get(type)?.[frame - 1] || pending.has(slot)) return
  pending.add(slot)
  try {
    const tex = await Assets.load<Texture>(frameUrl(type, folder, frame))
    const list = sprites.get(type) ?? []
    list[frame - 1] = tex
    sprites.set(type, list)
  } catch {
    /* missing image: keep vector fallback */
  } finally {
    pending.delete(slot)
  }
}

export const buildingImagesEnabled = (): boolean => getGraphics().quality === 'high'

export const preloadBuildingSprites = async (): Promise<void> => {
  if (!buildingImagesEnabled()) return
  const jobs: Promise<void>[] = []
  for (const [type, folder] of Object.entries(FOLDERS)) {
    for (let f = 1; f <= BUILDING_STATUS_FRAMES; f++) jobs.push(loadFrame(type, folder, f))
  }
  await Promise.all(jobs)
}

// frames 1-4: build progress 0/25/50/75%, frame 5: complete,
// frames 5-8: damage at 100/75/50/25% health
export const buildingStatusIndex = (done: boolean, progress: number, hpFrac: number): number => {
  if (!done) return Math.max(1, Math.min(5, Math.floor(Math.max(0, progress) * 4) + 1))
  return 5 + Math.min(3, Math.floor((1 - Math.max(0, Math.min(1, hpFrac))) * 4))
}

export const buildingStatusTexture = (type: string, frame: number): Texture | null => {
  if (!buildingImagesEnabled() || !FOLDERS[type]) return null
  if (frame < 1 || frame > BUILDING_STATUS_FRAMES) return null
  const tex = sprites.get(type)?.[frame - 1]
  if (tex) return tex
  void loadFrame(type, FOLDERS[type], frame)
  return null
}

export const buildingAssetTemplate = (type: string): string => {
  const override = getGraphics().assetPaths[`building:${type}`]?.trim()
  if (override) return override
  const folder = FOLDERS[type] ?? type
  return `${folder}/${folder}_{frame}.png`
}

// ---------- fields & scenery (high quality) ----------

const fieldSprites = new Map<string, Texture[]>()
const obstacleImages = new Map<string, Texture>()

const resolveAssetUrl = (key: string, fallback: string): string => {
  const override = getGraphics().assetPaths[key]?.trim()
  const raw = override || fallback
  if (/^https?:\/\//i.test(raw) || raw.startsWith('/')) return raw
  return `${import.meta.env.BASE_URL}${raw}`
}

const loadInto = async (map: Map<string, Texture[]>, key: string, urlKey: string, fallback: string, frame: number): Promise<void> => {
  if (map.get(key)?.[frame - 1]) return
  try {
    const url = resolveAssetUrl(urlKey, fallback).replaceAll('{frame}', String(frame))
    const tex = await Assets.load<Texture>(url)
    const list = map.get(key) ?? []
    list[frame - 1] = tex
    map.set(key, list)
  } catch {
    /* missing image: keep vector fallback */
  }
}

export const SUPPLY_FIELD_FRAMES = 25
export const OIL_FIELD_FRAMES = 4

const loadObstacleImage = async (type: string): Promise<void> => {
  if (obstacleImages.has(type)) return
  try {
    const url = resolveAssetUrl(`obstacle:${type}`, `ao/${type}.png`).replaceAll('{type}', type).replaceAll('{frame}', '1')
    const tex = await Assets.load<Texture>(url)
    obstacleImages.set(type, tex)
  } catch {
    /* missing image */
  }
}

export const preloadFieldSprites = async (): Promise<void> => {
  if (!buildingImagesEnabled()) return
  const jobs: Promise<void>[] = []
  for (let f = 1; f <= SUPPLY_FIELD_FRAMES; f++) jobs.push(loadInto(fieldSprites, 'supply', 'field:supply', 'sf/sf_{frame}.png', f))
  for (let f = 1; f <= OIL_FIELD_FRAMES; f++) jobs.push(loadInto(fieldSprites, 'oil', 'field:oil', 'of/of_{frame}.png', f))
  for (const t of ['rock', 'tree', 'wreck']) jobs.push(loadObstacleImage(t))
  await Promise.all(jobs)
}

/** Supply field fill image 1-25: frame 1 = full, frame 25 = empty. */
export const supplyFieldStatusTexture = (frac: number): Texture | null => {
  const idx = Math.max(0, Math.min(SUPPLY_FIELD_FRAMES - 1, Math.ceil((1 - Math.max(0, Math.min(1, frac))) * SUPPLY_FIELD_FRAMES) - 1))
  return fieldSprites.get('supply')?.[idx] ?? null
}

/** Oil field damage image 1-4 at 100/75/50/25% health. */
export const oilFieldStatusTexture = (hpFrac: number): Texture | null => {
  const idx = Math.min(OIL_FIELD_FRAMES - 1, Math.floor((1 - Math.max(0, Math.min(1, hpFrac))) * OIL_FIELD_FRAMES))
  return fieldSprites.get('oil')?.[idx] ?? null
}

export const obstacleImageTexture = (type: string): Texture | null => obstacleImages.get(type) ?? null

// ---------- directional unit sprites (high quality) ----------

// frame/direction naming order as authored on disk
export const UNIT_DIRECTION_NAMES = [
  'north',
  'west+north',
  'west',
  'west+south',
  'south',
  'east+south',
  'east',
  'north+east',
] as const

// screen-space angle bins (0°=east, clockwise since screen y is down) → direction name
const ANGLE_TO_DIR: string[] = [
  'east',
  'east+south',
  'south',
  'west+south',
  'west',
  'west+north',
  'north',
  'north+east',
]

const unitSprites = new Map<string, Map<string, Texture>>()
const pendingUnits = new Set<string>()

const loadUnitDir = async (type: string, template: string, dir: string): Promise<void> => {
  if (unitSprites.get(type)?.has(dir) || pendingUnits.has(`${type}:${dir}`)) return
  pendingUnits.add(`${type}:${dir}`)
  try {
    const raw = template.replaceAll('{dir}', dir).replaceAll('{frame}', String(UNIT_DIRECTION_NAMES.indexOf(dir as never) + 1))
    const url = /^https?:\/\//i.test(raw) || raw.startsWith('/') ? raw : `${import.meta.env.BASE_URL}${raw}`
    const tex = await Assets.load<Texture>(url)
    const map = unitSprites.get(type) ?? new Map<string, Texture>()
    map.set(dir, tex)
    unitSprites.set(type, map)
  } catch {
    /* missing image: keep vector fallback */
  } finally {
    pendingUnits.delete(`${type}:${dir}`)
  }
}

export const preloadUnitSprites = async (): Promise<void> => {
  if (!buildingImagesEnabled()) return
  const jobs: Promise<void>[] = []
  for (const id of UNIT_ASSET_IDS) {
    const tmpl = getGraphics().assetPaths[`unit:${id}`]?.trim()
    if (!tmpl) continue
    for (const dir of UNIT_DIRECTION_NAMES) jobs.push(loadUnitDir(id, tmpl, dir))
  }
  await Promise.all(jobs)
}

/** Screen-space angle (radians) → direction name (8 bins of 45°). */
export const unitDirFromScreenAngle = (angleRad: number): string => {
  const deg = ((angleRad * 180) / Math.PI + 360) % 360
  return ANGLE_TO_DIR[Math.round(deg / 45) % 8]
}

/** Picks the direction image matching a screen-space movement angle (radians). */
export const unitDirectionTexture = (type: string, angleRad: number): Texture | null => {
  const deg = ((angleRad * 180) / Math.PI + 360) % 360
  const bin = Math.round(deg / 45) % 8
  return unitTextureByName(type, ANGLE_TO_DIR[bin])
}

export const unitTextureByName = (type: string, dir: string): Texture | null =>
  unitSprites.get(type)?.get(dir) ?? null

export const unitImagesAvailable = (type: string): boolean => {
  const m = unitSprites.get(type)
  return !!m && m.size > 0
}

/** Approximate on-screen width (px) of a small vector unit shape, for image size parity. */
export const UNIT_SPRITE_WIDTH = 26
