import { Assets, Texture } from 'pixi.js'
import { getGraphics, resolveAssetTemplate, UNIT_ASSET_IDS } from '../ui/graphics.ts'
import { fetchSpritesBundle, spriteBundleBytes, type SpriteBundle } from './sprite-bundle.ts'

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
  bunker: 'bn',
  dock: 'd',
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
  const override = resolveAssetTemplate(getGraphics().assetPaths[`building:${type}`], '')
  if (override) {
    const url = override.replaceAll('{frame}', padFrame(frame)).replaceAll('{color}', String(fileColor(color)))
    if (/^https?:\/\//i.test(url) || url.startsWith('/')) return url
    return `${import.meta.env.BASE_URL}${url}`
  }
  return `${import.meta.env.BASE_URL}${folder}/${fileColor(color)}/${folder}_${padFrame(frame)}.png`
}

// ---------- one-request sprite bundle fallback ----------
// When the browser's per-file requests crawl (common on hotspot links with the
// WAN down), the loader pulls the whole PNG set from /assets/sprites.bundle in a
// single request and builds every texture locally, keyed by dist-relative path.

let bundle: SpriteBundle | null = null

const bundablePath = (url: string): string | null => {
  if (/^https?:\/\//i.test(url)) {
    try {
      if (new URL(url).origin !== location.origin) return null
    } catch {
      return null
    }
  }
  return new URL(url, location.href).pathname.replace(/^\/+/, '') || null
}

const textureFromBundle = async (relPath: string): Promise<Texture | null> => {
  if (!bundle) return null
  const bytes = spriteBundleBytes(bundle, relPath)
  if (!bytes) return null
  try {
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    return Texture.from(bitmap)
  } catch {
    return null
  }
}

const loadFrame = async (type: string, folder: string, frame: number, color = DEFAULT_PLAYER_COLOR, onDone?: () => void): Promise<void> => {
  const slot = `${type}:${frame}:${color}`
  if (sprites.has(slot) || pending.has(slot)) return
  pending.add(slot)
  try {
    const url = frameUrl(type, folder, frame, color)
    const rel = bundablePath(url)
    const bundleTex = rel ? await textureFromBundle(rel) : null
    if (bundleTex) {
      sprites.set(slot, bundleTex)
    } else {
      const tex = await Assets.load<Texture>(url)
      if (!sprites.has(slot)) {
        sprites.set(slot, tex)
        loadedUrls.add(url)
      }
    }
  } catch {
    /* missing image: keep vector fallback */
  } finally {
    pending.delete(slot)
    onDone?.()
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
  const raw = resolveAssetTemplate(getGraphics().assetPaths[key], fallback)
  if (/^https?:\/\//i.test(raw) || raw.startsWith('/')) return raw
  return `${import.meta.env.BASE_URL}${raw}`
}

const loadInto = async (map: Map<string, Texture[]>, key: string, urlKey: string, fallback: string, frame: number, onDone?: () => void): Promise<void> => {
  if (map.get(key)?.[frame - 1]) return
  try {
    const url = resolveAssetUrl(urlKey, fallback).replaceAll('{frame}', padFrame(frame))
    const rel = bundablePath(url)
    const bundleTex = rel ? await textureFromBundle(rel) : null
    if (bundleTex) {
      const list = map.get(key) ?? []
      list[frame - 1] = bundleTex
      map.set(key, list)
    } else {
      const tex = await Assets.load<Texture>(url)
      if (!map.get(key)?.[frame - 1]) {
        const list = map.get(key) ?? []
        list[frame - 1] = tex
        map.set(key, list)
        loadedUrls.add(url)
      }
    }
  } catch {
    /* missing image: keep vector fallback */
  } finally {
    onDone?.()
  }
}

export const SUPPLY_FIELD_FRAMES = 25
export const OIL_FIELD_FRAMES = 4

const loadObstacleImage = async (type: string, onDone?: () => void): Promise<void> => {
  if (obstacleImages.has(type)) return
  try {
    const url = resolveAssetUrl(`obstacle:${type}`, `ao/${type}.png`).replaceAll('{type}', type).replaceAll('{frame}', '1')
    const rel = bundablePath(url)
    const bundleTex = rel ? await textureFromBundle(rel) : null
    if (bundleTex) {
      obstacleImages.set(type, bundleTex)
    } else {
      const tex = await Assets.load<Texture>(url)
      if (!obstacleImages.has(type)) {
        obstacleImages.set(type, tex)
        loadedUrls.add(url)
      }
    }
  } catch {
    /* missing image */
  } finally {
    onDone?.()
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

const unitFrameUrl = (template: string, dir: string, color: number): string => {
  const raw = template
    .replaceAll('{dir}', dir)
    .replaceAll('{frame}', padFrame4(FRAME_TO_DIR.indexOf(dir as never) + 1))
    .replaceAll('{color}', String(fileColor(color)))
  return /^https?:\/\//i.test(raw) || raw.startsWith('/') ? raw : `${import.meta.env.BASE_URL}${raw}`
}

const loadUnitDir = async (type: string, template: string, dir: string, color = DEFAULT_PLAYER_COLOR, onDone?: () => void): Promise<void> => {
  const key = `${dir}:${color}`
  if (unitSprites.get(type)?.has(key) || pendingUnits.has(`${type}:${key}`)) return
  pendingUnits.add(`${type}:${key}`)
  try {
    const url = unitFrameUrl(template, dir, color)
    const rel = bundablePath(url)
    const bundleTex = rel ? await textureFromBundle(rel) : null
    if (bundleTex) {
      const map = unitSprites.get(type) ?? new Map<string, Texture>()
      map.set(key, bundleTex)
      unitSprites.set(type, map)
    } else {
      const tex = await Assets.load<Texture>(url)
      const map = unitSprites.get(type) ?? new Map<string, Texture>()
      unitSprites.set(type, map)
      if (!map.has(key)) {
        map.set(key, tex)
        loadedUrls.add(url)
      }
    }
  } catch {
    /* missing image: keep vector fallback */
  } finally {
    pendingUnits.delete(`${type}:${key}`)
    onDone?.()
  }
}

export const preloadUnitSprites = async (colors?: number[]): Promise<void> => {
  if (!buildingImagesEnabled()) return
  const palette = colors && colors.length > 0 ? colors : [DEFAULT_PLAYER_COLOR]
  const jobs: Promise<void>[] = []
  for (const id of UNIT_ASSET_IDS) {
    const tmpl = resolveAssetTemplate(getGraphics().assetPaths[`unit:${id}`], '')
    if (!tmpl) continue
    for (const dir of UNIT_DIRECTION_NAMES) for (const c of palette) jobs.push(loadUnitDir(id, tmpl, dir, c))
  }
  await Promise.all(jobs)
}

const ALL_COLOR_INDEXES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]

/** All on-disk obstacles. Kept in sync with preloadFieldSprites' list. */
const OBSTACLE_KINDS = ['rock', 'tree', 'wreck', 'mine'] as const

/**
 * Warms up every image asset the match renderer could need (all building types,
 * all unit directions, supply/oil fields, obstacles and burn fx, for every color
 * in the palette) so a later `renderer.init` never has to hit the network and no
 * sprite is ever missing mid-match. Reports (done, total) progress while loading.
 * Each individual load swallows its own errors, so this never rejects; the vector
 * art fallback kicks in for anything that fails to load.
 *
 * On slow links (e.g. a phone hotspot with the WAN down, where the browser
 * staggers ~1500 tiny fetches at roughly one per second), the per-file path is
 * abandoned and the whole PNG set is pulled in one request from
 * /assets/sprites.bundle instead. Any per-file jobs still in flight keep their
 * completion callback, but the loaders re-check their slot before writing so a
 * late file never overwrites a bundle-filled texture.
 */
export const preloadAllMatchAssets = async (onProgress?: (done: number, total: number) => void): Promise<void> => {
  if (!buildingImagesEnabled()) {
    onProgress?.(1, 1)
    return
  }
  const fxBurn = resolveAssetTemplate(getGraphics().assetPaths['fx:burn'], '')
  const total = Object.keys(FOLDERS).length * BUILDING_STATUS_FRAMES * ALL_COLOR_INDEXES.length +
    UNIT_ASSET_IDS.filter((id) => resolveAssetTemplate(getGraphics().assetPaths[`unit:${id}`], '')).length * UNIT_DIRECTION_NAMES.length * ALL_COLOR_INDEXES.length +
    SUPPLY_FIELD_FRAMES + OIL_FIELD_FRAMES + OBSTACLE_KINDS.length + (fxBurn ? 2 : 0)
  let done = 0
  const bump = (): void => {
    done += 1
    onProgress?.(done, total)
  }
  const jobs: Promise<void>[] = []
  for (const [type, folder] of Object.entries(FOLDERS)) {
    for (let f = 1; f <= BUILDING_STATUS_FRAMES; f++) {
      for (const c of ALL_COLOR_INDEXES) jobs.push(loadFrame(type, folder, f, c, bump))
    }
  }
  for (const id of UNIT_ASSET_IDS) {
    const tmpl = resolveAssetTemplate(getGraphics().assetPaths[`unit:${id}`], '')
    if (!tmpl) continue
    for (const dir of UNIT_DIRECTION_NAMES) {
      for (const c of ALL_COLOR_INDEXES) jobs.push(loadUnitDir(id, tmpl, dir, c, bump))
    }
  }
  for (let f = 1; f <= SUPPLY_FIELD_FRAMES; f++) jobs.push(loadInto(fieldSprites, 'supply', 'field:supply', 'sf/sf_{frame}.png', f, bump))
  for (let f = 1; f <= OIL_FIELD_FRAMES; f++) jobs.push(loadInto(fieldSprites, 'oil', 'field:oil', 'of/of_{frame}.png', f, bump))
  for (const t of OBSTACLE_KINDS) jobs.push(loadObstacleImage(t, bump))
  if (fxBurn) {
    jobs.push(loadFxFrame('burn', 1, bump))
    jobs.push(loadFxFrame('burn', 2, bump))
  }

  const allDone = Promise.allSettled(jobs).then(() => true)
  if (await Promise.race([allDone, detectSlowPreload(() => done, total)])) {
    bundle = await fetchSpritesBundle()
    if (bundle) {
      await fillFromBundle(fxBurn, bump)
      onProgress?.(total, total)
      return
    }
  }
  await allDone
  onProgress?.(total, total)
}

const SLOW_PRELOAD_PROBE_MS = 4000
const SLOW_PRELOAD_EXPIRE_MS = 10_000

/** Resolves true once the per-file crawl looks pathological (<30% of the set in
 * 4s, or still unfinished after 10s). Resolves false if the full set lands first. */
const detectSlowPreload = (done: () => number, total: number): Promise<boolean> => {
  const start = performance.now()
  return new Promise((resolve) => {
    const probe = (): void => {
      const elapsed = performance.now() - start
      if (done() >= total) {
        resolve(false)
      } else if (elapsed >= SLOW_PRELOAD_EXPIRE_MS) {
        resolve(true)
      } else if (elapsed >= SLOW_PRELOAD_PROBE_MS && done() < total * 0.3) {
        resolve(true)
      } else {
        setTimeout(probe, 250)
      }
    }
    setTimeout(probe, SLOW_PRELOAD_PROBE_MS)
  })
}

const fillFromBundle = async (fxBurn: string, bump: () => void): Promise<void> => {
  if (!bundle) return
  const ops: Array<() => Promise<void>> = []
  for (const [type, folder] of Object.entries(FOLDERS)) {
    for (let f = 1; f <= BUILDING_STATUS_FRAMES; f++) {
      for (const c of ALL_COLOR_INDEXES) {
        const slot = `${type}:${f}:${c}`
        if (sprites.has(slot)) continue
        const rel = bundablePath(frameUrl(type, folder, f, c))
        ops.push(async () => {
          const tex = rel ? await textureFromBundle(rel) : null
          if (tex) sprites.set(slot, tex)
          bump()
        })
      }
    }
  }
  for (const id of UNIT_ASSET_IDS) {
    const tmpl = resolveAssetTemplate(getGraphics().assetPaths[`unit:${id}`], '')
    if (!tmpl) continue
    for (const dir of UNIT_DIRECTION_NAMES) {
      for (const c of ALL_COLOR_INDEXES) {
        const key = `${dir}:${c}`
        if (unitSprites.get(id)?.has(key)) continue
        const rel = bundablePath(unitFrameUrl(tmpl, dir, c))
        ops.push(async () => {
          const tex = rel ? await textureFromBundle(rel) : null
          if (tex) {
            const map = unitSprites.get(id) ?? new Map<string, Texture>()
            map.set(key, tex)
            unitSprites.set(id, map)
          }
          bump()
        })
      }
    }
  }
  for (let f = 1; f <= SUPPLY_FIELD_FRAMES; f++) {
    if (fieldSprites.get('supply')?.[f - 1]) continue
    const rel = bundablePath(resolveAssetUrl('field:supply', 'sf/sf_{frame}.png').replaceAll('{frame}', padFrame(f)))
    ops.push(async () => {
      const tex = rel ? await textureFromBundle(rel) : null
      if (tex) {
        const list = fieldSprites.get('supply') ?? []
        list[f - 1] = tex
        fieldSprites.set('supply', list)
      }
      bump()
    })
  }
  for (let f = 1; f <= OIL_FIELD_FRAMES; f++) {
    if (fieldSprites.get('oil')?.[f - 1]) continue
    const rel = bundablePath(resolveAssetUrl('field:oil', 'of/of_{frame}.png').replaceAll('{frame}', padFrame(f)))
    ops.push(async () => {
      const tex = rel ? await textureFromBundle(rel) : null
      if (tex) {
        const list = fieldSprites.get('oil') ?? []
        list[f - 1] = tex
        fieldSprites.set('oil', list)
      }
      bump()
    })
  }
  for (const t of OBSTACLE_KINDS) {
    if (obstacleImages.has(t)) continue
    const rel = bundablePath(resolveAssetUrl(`obstacle:${t}`, `ao/${t}.png`).replaceAll('{type}', t).replaceAll('{frame}', '1'))
    ops.push(async () => {
      const tex = rel ? await textureFromBundle(rel) : null
      if (tex) obstacleImages.set(t, tex)
      bump()
    })
  }
  if (fxBurn) {
    for (const frame of [1, 2]) {
      const rel = bundablePath(fxFrameUrl('burn', frame)) || null
      ops.push(async () => {
        const tex = rel ? await textureFromBundle(rel) : null
        if (tex) fxImages.set(`fx:burn:${frame}`, tex)
        bump()
      })
    }
  }
  const LIMIT = 48
  let i = 0
  const workers = Array.from({ length: Math.min(LIMIT, ops.length) }, async (): Promise<void> => {
    while (i < ops.length) await ops[i++]()
  })
  await Promise.all(workers)
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
  const template = resolveAssetTemplate(getGraphics().assetPaths[`fx:${key}`], '')
  if (!template) return ''
  const url = template.replaceAll('{frame}', padFrame4(frame))
  return /^https?:\/\//i.test(url) || url.startsWith('/') ? url : `${import.meta.env.BASE_URL}${url}`
}

const loadFxFrame = async (key: string, frame: number, onDone?: () => void): Promise<void> => {
  const url = fxFrameUrl(key, frame)
  if (!url) return
  const slot = `fx:${key}:${frame}`
  if (fxImages.has(slot) || pending.has(slot)) return
  pending.add(slot)
  try {
    const rel = bundablePath(url)
    const bundleTex = rel ? await textureFromBundle(rel) : null
    if (bundleTex) {
      fxImages.set(slot, bundleTex)
    } else {
      const tex = await Assets.load<Texture>(url)
      if (!fxImages.has(slot)) {
        fxImages.set(slot, tex)
        loadedUrls.add(url)
      }
    }
  } catch {
    /* missing image: keep procedural fallback */
  } finally {
    pending.delete(slot)
    onDone?.()
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
