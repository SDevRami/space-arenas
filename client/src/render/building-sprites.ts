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
export const DEFAULT_PLAYER_COLOR = 1

/** The color index is 0-based (palette slot); the on-disk color folder is 1-based (pp/1/…pp/10). */
const fileColor = (index: number): number => index + 1

/** Frame numbers are zero-padded to 4 digits on disk (pp_0001.png…pp_0008.png). */
const padFrame = (frame: number): string => String(frame).padStart(4, '0')

const sprites = new Map<string, Texture>()
const pending = new Set<string>()

/** URLs resolved out of asset-path templates; Assets owns these textures, so a
 * tidy teardown must `Assets.unload` them rather than destroying them directly. */
const loadedUrls = new Set<string>()

const frameUrl = (type: string, folder: string, frame: number, color: number): string => {
  const override = getGraphics().assetPaths[`building:${type}`]?.trim()
  if (override) {
    const url = override.replaceAll('{frame}', padFrame(frame)).replaceAll('{color}', String(fileColor(color)))
    if (/^https?:\/\//i.test(url) || url.startsWith('/')) return url
    return `${import.meta.env.BASE_URL}${url}`
  }
  return `${import.meta.env.BASE_URL}${folder}/${fileColor(color)}/${folder}_${padFrame(frame)}.png`
}

const loadFrame = async (type: string, folder: string, frame: number, color = DEFAULT_PLAYER_COLOR): Promise<void> => {
  const slot = `${type}:${frame}:${color}`
  if (sprites.has(slot) || pending.has(slot)) return
  pending.add(slot)
  try {
    const tex = await Assets.load<Texture>(frameUrl(type, folder, frame, color))
    sprites.set(slot, tex)
    loadedUrls.add(frameUrl(type, folder, frame, color))
  } catch {
    /* missing image: keep vector fallback */
  } finally {
    pending.delete(slot)
  }
}

export const buildingImagesEnabled = (): boolean => getGraphics().quality === 'high'

export const preloadBuildingSprites = async (colors?: number[]): Promise<void> => {
  if (!buildingImagesEnabled()) return
  const palette = colors && colors.length > 0 ? colors : [DEFAULT_PLAYER_COLOR]
  const jobs: Promise<void>[] = []
  for (const [type, folder] of Object.entries(FOLDERS)) {
    for (let f = 1; f <= BUILDING_STATUS_FRAMES; f++) {
      for (const c of palette) jobs.push(loadFrame(type, folder, f, c))
    }
  }
  await Promise.all(jobs)
}

// frames 1-4: build progress 0/25/50/75%, frame 5: complete,
// frames 5-8: damage at 100/75/50/25% health
export const buildingStatusIndex = (done: boolean, progress: number, hpFrac: number): number => {
  if (!done) return Math.max(1, Math.min(5, Math.floor(Math.max(0, progress) * 4) + 1))
  return 5 + Math.min(3, Math.floor((1 - Math.max(0, Math.min(1, hpFrac))) * 4))
}

export const buildingStatusTexture = (type: string, frame: number, color = DEFAULT_PLAYER_COLOR): Texture | null => {
  if (!buildingImagesEnabled() || !FOLDERS[type]) return null
  if (frame < 1 || frame > BUILDING_STATUS_FRAMES) return null
  const slot = `${type}:${frame}:${color}`
  const tex = sprites.get(slot)
  if (tex) return tex
  void loadFrame(type, FOLDERS[type], frame, color)
  return null
}

export const buildingAssetTemplate = (type: string): string => {
  const override = getGraphics().assetPaths[`building:${type}`]?.trim()
  if (override) return override
  const folder = FOLDERS[type] ?? type
  return `${folder}/{color}/${folder}_{frame}.png`
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
    const url = resolveAssetUrl(urlKey, fallback).replaceAll('{frame}', padFrame(frame))
    const tex = await Assets.load<Texture>(url)
    const list = map.get(key) ?? []
    list[frame - 1] = tex
    map.set(key, list)
    loadedUrls.add(url)
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
    loadedUrls.add(url)
  } catch {
    /* missing image */
  }
}

export const preloadFieldSprites = async (): Promise<void> => {
  if (!buildingImagesEnabled()) return
  const jobs: Promise<void>[] = []
  for (let f = 1; f <= SUPPLY_FIELD_FRAMES; f++) jobs.push(loadInto(fieldSprites, 'supply', 'field:supply', 'sf/sf_{frame}.png', f))
  for (let f = 1; f <= OIL_FIELD_FRAMES; f++) jobs.push(loadInto(fieldSprites, 'oil', 'field:oil', 'of/of_{frame}.png', f))
  for (const t of ['rock', 'tree', 'wreck', 'mine']) jobs.push(loadObstacleImage(t))
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

// canonical direction name list; on-disk heading frames 0001-0008 resolve via FRAME_TO_DIR
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

// 4-digit heading frame order as authored on disk (v_<id>_0001.png…v_<id>_0008.png)
export const FRAME_TO_DIR: string[] = [
  'west+south',
  'south',
  'east+south',
  'east',
  'north+east',
  'north',
  'west+north',
  'west',
]

const unitSprites = new Map<string, Map<string, Texture>>()
const pendingUnits = new Set<string>()

const loadUnitDir = async (type: string, template: string, dir: string, color = DEFAULT_PLAYER_COLOR): Promise<void> => {
  const key = `${dir}:${color}`
  if (unitSprites.get(type)?.has(key) || pendingUnits.has(`${type}:${key}`)) return
  pendingUnits.add(`${type}:${key}`)
  try {
    const raw = template
      .replaceAll('{dir}', dir)
      .replaceAll('{frame}', padFrame4(FRAME_TO_DIR.indexOf(dir as never) + 1))
      .replaceAll('{color}', String(fileColor(color)))
    const url = /^https?:\/\//i.test(raw) || raw.startsWith('/') ? raw : `${import.meta.env.BASE_URL}${raw}`
    const tex = await Assets.load<Texture>(url)
    const map = unitSprites.get(type) ?? new Map<string, Texture>()
    map.set(key, tex)
    unitSprites.set(type, map)
    loadedUrls.add(url)
  } catch {
    /* missing image: keep vector fallback */
  } finally {
    pendingUnits.delete(`${type}:${key}`)
  }
}

export const preloadUnitSprites = async (colors?: number[]): Promise<void> => {
  if (!buildingImagesEnabled()) return
  const palette = colors && colors.length > 0 ? colors : [DEFAULT_PLAYER_COLOR]
  const jobs: Promise<void>[] = []
  for (const id of UNIT_ASSET_IDS) {
    const tmpl = getGraphics().assetPaths[`unit:${id}`]?.trim()
    if (!tmpl) continue
    for (const dir of UNIT_DIRECTION_NAMES) for (const c of palette) jobs.push(loadUnitDir(id, tmpl, dir, c))
  }
  await Promise.all(jobs)
}

/** Screen-space angle (radians) → direction name (8 bins of 45°). */
export const unitDirFromScreenAngle = (angleRad: number): string => {
  const deg = ((angleRad * 180) / Math.PI + 360) % 360
  return ANGLE_TO_DIR[Math.round(deg / 45) % 8]
}

/** Picks the direction image matching a screen-space movement angle (radians). */
export const unitDirectionTexture = (type: string, angleRad: number, color = DEFAULT_PLAYER_COLOR): Texture | null => {
  const deg = ((angleRad * 180) / Math.PI + 360) % 360
  const bin = Math.round(deg / 45) % 8
  return unitTextureByName(type, ANGLE_TO_DIR[bin], color)
}

export const unitTextureByName = (type: string, dir: string, color = DEFAULT_PLAYER_COLOR): Texture | null =>
  unitSprites.get(type)?.get(`${dir}:${color}`) ?? null

export const unitImagesAvailable = (type: string, color = DEFAULT_PLAYER_COLOR): boolean => {
  const m = unitSprites.get(type)
  return !!m && m.has(`${'south'}:${color}`) && m.size > 0
}

// ---------- effect frame images (e.g. burning-fire frames) ----------

/** 4-digit zero-padded frame helper, mirroring the on-disk {frame} convention. */
const padFrame4 = (frame: number): string => String(frame).padStart(4, '0')

const fxImages = new Map<string, Texture>()

const fxFrameUrl = (key: string, frame: number): string => {
  const template = getGraphics().assetPaths[`fx:${key}`]?.trim()
  if (!template) return ''
  const url = template.replaceAll('{frame}', padFrame4(frame))
  return /^https?:\/\//i.test(url) || url.startsWith('/') ? url : `${import.meta.env.BASE_URL}${url}`
}

const loadFxFrame = async (key: string, frame: number): Promise<void> => {
  if (!fxFrameUrl(key, frame)) return
  const slot = `fx:${key}:${frame}`
  if (fxImages.has(slot) || pending.has(slot)) return
  pending.add(slot)
  try {
    const tex = await Assets.load<Texture>(fxFrameUrl(key, frame))
    fxImages.set(slot, tex)
    loadedUrls.add(fxFrameUrl(key, frame))
  } catch {
    /* missing image: keep procedural fallback */
  } finally {
    pending.delete(slot)
  }
}

/** Kicks off a load for effect frames `key` (e.g. 'burn'), leaving the diffuse
 * frame textures to be picked up by `fxFrameTexture` once they resolve. */
export const preloadFxFrames = (key: string): void => {
  void loadFxFrame(key, 1)
  void loadFxFrame(key, 2)
}

export const fxFrameTexture = (key: string, frame: number): Texture | null => fxImages.get(`fx:${key}:${frame}`) ?? null

/** Releases every Assets-managed texture this module loaded and drops the
 * caches, so the app can be torn down without destroying Assets-owned
 * textures directly (which would trigger the PixiJS unload warning). */
export const unloadAllAssetTextures = async (): Promise<void> => {
  const urls = [...loadedUrls]
  loadedUrls.clear()
  sprites.clear()
  pending.clear()
  fieldSprites.clear()
  obstacleImages.clear()
  unitSprites.clear()
  pendingUnits.clear()
  fxImages.clear()
  try {
    if (urls.length > 0) await Assets.unload(urls)
  } catch {
    /* already released */
  }
}

/** Approximate on-screen width (px) of a small vector unit shape, for image size parity. */
export const UNIT_SPRITE_WIDTH = 26
