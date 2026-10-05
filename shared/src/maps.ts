import { RNG, hashSeed } from './rng.ts'
import { DEFAULT_CREDITS, DEFAULT_MAX_PLAYERS } from './constants.ts'

export enum Terrain {
  Ground = 0,
  Cliff = 1,
  Water = 2,
  Road = 3,
  BuildableGround = 4,
}

export interface Obstruction {
  x: number
  y: number
  w: number
  h: number
  type: 'rock' | 'wreck' | 'tree'
}

export interface SupplyField {
  x: number
  y: number
  radius: number
  capacity: number
  w?: number
  h?: number
}

export interface OilField {
  x: number
  y: number
  radius: number
}

export interface SpawnPoint {
  x: number
  y: number
  team: number
}

export interface MapData {
  schemaVersion: number
  format: 'space-arenas-map'
  name: string
  description: string
  author: string
  mapVersion: string
  width: number
  height: number
  tiles: number[]
  /** Optional per-tile color overrides (hex, '' = use the terrain's default color). Rendered when present. */
  groundColors?: string[]
  /** Optional global light factor (-10..+10). 0 = natural colors, + = lighter (day), - = darker (night). */
  brightness?: number
  obstructions: Obstruction[]
  supplyFields: SupplyField[]
  oilFields: OilField[]
  spawnPoints: SpawnPoint[]
  credits: number
}

export const isPassableTerrain = (t: number): boolean => t !== Terrain.Water && t !== Terrain.Cliff
export const isBuildableTerrain = (t: number): boolean => t === Terrain.Ground || t === Terrain.BuildableGround

export const MIN_MAP_SIZE = 16
export const MAX_MAP_SIZE = 512
export const clampMapSize = (n: number): number => Math.max(MIN_MAP_SIZE, Math.min(MAX_MAP_SIZE, Math.round(n)))

export const createEmptyMap = (width: number, height: number): MapData => ({
  schemaVersion: 1,
  format: 'space-arenas-map',
  name: 'Unnamed',
  description: '',
  author: '',
  mapVersion: '0.1.0',
  width,
  height,
  tiles: new Array<number>(width * height).fill(Terrain.Ground),
  groundColors: new Array<string>(width * height).fill(''),
  brightness: 0,
  obstructions: [],
  supplyFields: [],
  oilFields: [],
  spawnPoints: [],
  credits: DEFAULT_CREDITS,
})

export const tileIndex = (map: MapData, x: number, y: number): number => y * map.width + x

export const tileAt = (map: MapData, x: number, y: number): number => map.tiles[tileIndex(map, x, y)]

export const inBounds = (map: MapData, x: number, y: number): boolean =>
  x >= 0 && y >= 0 && x < map.width && y < map.height

export const clampBrightness = (b: number): number => Math.max(-10, Math.min(10, Math.round(b)))

/**
 * Applies a global light factor (-10..+10) to a #rrggbb color.
 * 0 keeps the color unchanged, positive makes it lighter (day), negative darker (night).
 */
export const applyBrightness = (hex: string, brightness: number): string => {
  if (!brightness || !/^#[0-9a-f]{6}$/i.test(hex)) return hex
  const f = 1 + (clampBrightness(brightness) * 4) / 100
  const n = parseInt(hex.slice(1), 16)
  const r = Math.min(255, Math.round(((n >> 16) & 255) * f))
  const g = Math.min(255, Math.round(((n >> 8) & 255) * f))
  const b = Math.min(255, Math.round((n & 255) * f))
  return `#${(((r << 16) | (g << 8) | b) >>> 0).toString(16).padStart(6, '0')}`
}

export interface MapValidation {
  ok: boolean
  errors: string[]
}

export const validateMap = (map: MapData): MapValidation => {
  const errors: string[] = []
  if (map.format !== 'space-arenas-map') errors.push('invalid format')
  if (map.width < MIN_MAP_SIZE || map.width > MAX_MAP_SIZE) errors.push(`width out of range: ${map.width}`)
  if (map.height < MIN_MAP_SIZE || map.height > MAX_MAP_SIZE) errors.push(`height out of range: ${map.height}`)
  if (map.tiles.length !== map.width * map.height) errors.push('tile array size mismatch')
  if (map.spawnPoints.length < 2 || map.spawnPoints.length > DEFAULT_MAX_PLAYERS) {
    errors.push(`spawn count out of range: ${map.spawnPoints.length}`)
  }
  if (map.supplyFields.length < 1) errors.push('map has no supply fields')

  const teams = new Set<number>()
  for (const s of map.spawnPoints) {
    if (!inBounds(map, s.x, s.y)) errors.push(`spawn out of bounds: (${s.x},${s.y})`)
    if (teams.has(s.team)) errors.push(`duplicate team spawn: ${s.team}`)
    teams.add(s.team)
  }

  for (const f of map.supplyFields) {
    if (!inBounds(map, f.x, f.y)) errors.push(`supply field out of bounds: (${f.x},${f.y})`)
    if (f.radius < 1 || f.capacity < 1) errors.push(`bad supply field at (${f.x},${f.y})`)
  }

  for (const f of map.oilFields ?? []) {
    if (!inBounds(map, f.x, f.y)) errors.push(`oil field out of bounds: (${f.x},${f.y})`)
    if (f.radius < 1) errors.push(`bad oil field at (${f.x},${f.y})`)
  }

  for (const o of map.obstructions) {
    if (!inBounds(map, o.x, o.y) || !inBounds(map, o.x + o.w - 1, o.y + o.h - 1)) {
      errors.push(`obstruction out of bounds at (${o.x},${o.y})`)
    }
  }

  if (map.credits < 0) errors.push('negative credits')
  if (map.brightness !== undefined && (map.brightness < -10 || map.brightness > 10)) {
    errors.push(`brightness out of range: ${map.brightness}`)
  }

  return { ok: errors.length === 0, errors }
}

export type MapVariant = 'river' | 'lake' | 'plain' | 'rings' | 'pass' | 'crossroads' | 'hexring' | 'shattered'

export interface MapPreset {
  id: string
  name: string
  description: string
  players: number
  seedText: string
  variant: MapVariant
}

export const MAP_PRESETS: MapPreset[] = [
  {
    id: 'breach',
    name: 'The Breach',
    description: 'A winding river splits two bases. Classic 2-player duel.',
    players: 2,
    seedText: 'breach-v1',
    variant: 'river',
  },
  {
    id: 'four-corners',
    name: 'Four Corners',
    description: 'Four bases around a central lake crossed by two bridges.',
    players: 4,
    seedText: 'four-corners-v1',
    variant: 'lake',
  },
  {
    id: 'six-settlers',
    name: 'Six Settlers',
    description: 'Six bases on the rim of a wide, supply-rich field.',
    players: 6,
    seedText: 'six-settlers-v1',
    variant: 'plain',
  },
  {
    id: 'grand-arena',
    name: 'Grand Arena',
    description: 'Eight bases ring a fortified center. Maximum carnage.',
    players: 8,
    seedText: 'grand-arena-v1',
    variant: 'rings',
  },
  {
    id: 'dead-mans-pass',
    name: "Dead Man's Pass",
    description: 'Two bases split by a sheer mountain ridge. Only two passes let you cross — hold them.',
    players: 2,
    seedText: 'dead-mans-pass-v1',
    variant: 'pass',
  },
  {
    id: 'crossroads-of-cinder',
    name: 'Crossroads of Cinder',
    description: 'Four bases linked by a stone cross of roads around a rich central plaza. Corner lakes box the map in.',
    players: 4,
    seedText: 'crossroads-of-cinder-v1',
    variant: 'crossroads',
  },
  {
    id: 'sixfold-ring',
    name: 'The Sixfold Ring',
    description: 'A crater lake crowned by an island, ringed by a circular road and six bases. Fight over the ring and the bridge.',
    players: 6,
    seedText: 'sixfold-ring-v1',
    variant: 'hexring',
  },
  {
    id: 'shattered-circlet',
    name: 'Shattered Circlet',
    description: 'Eight bases around a broken wasteland core. Only the eight road-spokes make it crossable.',
    players: 8,
    seedText: 'shattered-circlet-v1',
    variant: 'shattered',
  },
]

export const mapPreset = (id: string): MapPreset | undefined => MAP_PRESETS.find((p) => p.id === id)

export const mapForPreset = (preset: MapPreset): MapData => {
  const map = generateMap(preset.players, preset.seedText, preset.variant)
  map.name = preset.name
  map.description = preset.description
  map.author = 'Space Arenas'
  return map
}

export const generateMap = (players: number, seedText: string, variant: MapVariant = 'plain'): MapData => {
  const n = Math.max(2, Math.min(DEFAULT_MAX_PLAYERS, Math.floor(players)))
  const rng = new RNG(hashSeed(seedText))
  const size = n <= 4 ? 128 : n <= 6 ? 160 : 192
  switch (variant) {
    case 'pass':
      return buildPassMap(size, rng)
    case 'crossroads':
      return buildCrossroadsMap(size, rng)
    case 'hexring':
      return buildHexringMap(size, rng)
    case 'shattered':
      return buildShatteredMap(size, rng)
    case 'river':
    case 'lake':
    case 'rings':
    case 'plain':
    default:
      return buildGenericMap(n, size, rng, variant)
  }
}

// ---------- shared helpers ----------

const setTile = (map: MapData, x: number, y: number, t: number): void => {
  if (x >= 0 && y >= 0 && x < map.width && y < map.height) map.tiles[tileIndex(map, x, y)] = t
}

const groundAround = (map: MapData, x: number, y: number): void => {
  for (let dy = -5; dy <= 5; dy++) {
    for (let dx = -5; dx <= 5; dx++) {
      setTile(map, x + dx, y + dy, Terrain.Ground)
    }
  }
}

const disc = (map: MapData, cx: number, cy: number, r: number, t: number): void => {
  const x0 = Math.max(0, Math.floor(cx - r))
  const x1 = Math.min(map.width - 1, Math.ceil(cx + r))
  const y0 = Math.max(0, Math.floor(cy - r))
  const y1 = Math.min(map.height - 1, Math.ceil(cy + r))
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (Math.hypot(x - cx, y - cy) <= r) map.tiles[tileIndex(map, x, y)] = t
    }
  }
}

const ringBand = (map: MapData, cx: number, cy: number, r1: number, r2: number, t: number): void => {
  const x0 = Math.max(0, Math.floor(cx - r2))
  const x1 = Math.min(map.width - 1, Math.ceil(cx + r2))
  const y0 = Math.max(0, Math.floor(cy - r2))
  const y1 = Math.min(map.height - 1, Math.ceil(cy + r2))
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x - cx, y - cy)
      if (d >= r1 && d <= r2) map.tiles[tileIndex(map, x, y)] = t
    }
  }
}

const addField = (map: MapData, x: number, y: number, radius: number, capacity: number): void => {
  if (!inBounds(map, x, y)) return
  if (map.tiles[tileIndex(map, x, y)] === Terrain.Water) return
  map.supplyFields.push({ x, y, radius, capacity })
}

const addOilField = (map: MapData, x: number, y: number, radius: number): void => {
  if (!inBounds(map, x, y)) return
  if (map.tiles[tileIndex(map, x, y)] === Terrain.Water) return
  map.oilFields.push({ x, y, radius })
}

const placeOilFields = (map: MapData, size: number, count: number): void => {
  const cx = Math.floor(size / 2)
  const cy = Math.floor(size / 2)
  const tooClose = (x: number, y: number): boolean => {
    for (const s of map.spawnPoints) {
      if (Math.abs(s.x - x) < 12 && Math.abs(s.y - y) < 12) return true
    }
    for (const f of map.supplyFields) {
      if (Math.abs(f.x - x) < 8 && Math.abs(f.y - y) < 8) return true
    }
    return false
  }
  const used = new Set<string>()
  const tryPlace = (x: number, y: number): boolean => {
    if (!inBounds(map, x, y)) return false
    if (tooClose(x, y)) return false
    const key = `${x},${y}`
    if (used.has(key)) return false
    used.add(key)
    addOilField(map, x, y, 2)
    return true
  }
  let placed = 0
  if (tryPlace(cx, cy)) placed++
  const baseR = Math.floor(size * 0.3)
  const angles = [0, 120, 240, 45, 165, 285, 90, 210, 330, 60, 180, 300]
  for (let i = 0; placed < count && i < angles.length; i++) {
    const a = (angles[i] * Math.PI) / 180
    const x = Math.round(cx + Math.cos(a) * baseR)
    const y = Math.round(cy + Math.sin(a) * baseR)
    if (tryPlace(x, y)) placed++
  }
}

const addSpawn = (map: MapData, x: number, y: number): void => {
  map.spawnPoints.push({ x, y, team: map.spawnPoints.length })
}

const postProcess = (map: MapData, size: number, rng: RNG): void => {
  for (const s of map.spawnPoints) groundAround(map, s.x, s.y)
  const patchCount = Math.floor(size * size * 0.02)
  for (let i = 0; i < patchCount; i++) {
    const x = rng.nextInt(4, size - 4)
    const y = rng.nextInt(4, size - 4)
    if (map.tiles[tileIndex(map, x, y)] === Terrain.Ground) map.tiles[tileIndex(map, x, y)] = Terrain.BuildableGround
  }
  map.spawnPoints.sort((a, b) => a.team - b.team)
  for (let i = 0; i < map.spawnPoints.length; i++) map.spawnPoints[i].team = i
}

// ---------- original procedural variants ----------

const buildGenericMap = (n: number, size: number, rng: RNG, variant: MapVariant): MapData => {
  const map = createEmptyMap(size, size)
  map.name = `${n}-player map`
  map.description = 'Procedurally generated arena.'
  map.author = 'Space Arenas'

  const spawns: Array<{ x: number; y: number }> = []
  if (n === 2) {
    spawns.push({ x: 10, y: 10 }, { x: size - 16, y: size - 16 })
  } else {
    const cx = size / 2
    const cy = size / 2
    const radius = Math.floor(size * 0.38)
    const angle0 = rng.nextInt(0, 360)
    for (let i = 0; i < n; i++) {
      const a = ((angle0 + (i * 360) / n) * Math.PI) / 180
      const x = Math.max(8, Math.min(size - 8, Math.round(cx + Math.cos(a) * radius)))
      const y = Math.max(8, Math.min(size - 8, Math.round(cy + Math.sin(a) * radius)))
      spawns.push({ x, y })
    }
  }

  if (variant === 'river') carveRiver(size, map, rng)
  else if (variant === 'lake') carveLake(size, map)
  else if (variant === 'rings') carveRings(size, map)

  for (const s of spawns) groundAround(map, s.x, s.y)

  const patchCount = Math.floor(size * size * 0.02)
  for (let i = 0; i < patchCount; i++) {
    const x = rng.nextInt(4, size - 4)
    const y = rng.nextInt(4, size - 4)
    if (map.tiles[tileIndex(map, x, y)] === Terrain.Ground) map.tiles[tileIndex(map, x, y)] = Terrain.BuildableGround
  }

  const nearSpawn = (x: number, y: number): boolean => spawns.some((s) => Math.abs(s.x - x) < 8 && Math.abs(s.y - y) < 8)
  const obsCount = Math.floor(size / 6)
  for (let i = 0; i < obsCount; i++) {
    const x = rng.nextInt(6, size - 10)
    const y = rng.nextInt(6, size - 10)
    if (nearSpawn(x, y)) continue
    map.obstructions.push({ x, y, w: rng.nextInt(1, 3), h: rng.nextInt(1, 3), type: i % 3 === 0 ? 'wreck' : 'rock' })
  }

  for (const s of spawns) {
    addField(map, s.x + 12, s.y + 12, 3, 24)
    addField(map, Math.floor((s.x + size / 2) / 2), Math.floor((s.y + size / 2) / 2), 3, 20)
  }
  if (n >= 4) addField(map, Math.floor(size / 2), Math.floor(size / 2), 3, 24)

  for (const s of spawns) map.spawnPoints.push({ x: s.x, y: s.y, team: map.spawnPoints.length })

  placeOilFields(map, size, n <= 2 ? 2 : n <= 4 ? 3 : 4)

  return map
}

// ---------- Dead Man's Pass (2p) ----------

const buildPassMap = (size: number, rng: RNG): MapData => {
  const map = createEmptyMap(size, size)
  map.name = "Dead Man's Pass"
  map.description = 'Two bases split by a sheer mountain ridge with two passes.'
  map.author = 'Space Arenas'

  const wallX = Math.floor(size / 2)
  const g0 = Math.floor(size * 0.34)
  const g1 = Math.floor(size * 0.66)
  for (let y = 0; y < size; y++) {
    if (Math.abs(y - g0) <= 3 || Math.abs(y - g1) <= 3) continue
    const jitter = rng.nextInt(0, 100) < 30 ? (rng.nextInt(0, 2) === 0 ? -1 : 1) : 0
    for (let dx = -1; dx <= 1; dx++) {
      setTile(map, wallX + dx, y, Terrain.Cliff)
      setTile(map, wallX + dx + jitter, y, Terrain.Cliff)
    }
  }
  for (const g of [g0, g1]) {
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -2; dx <= 2; dx++) setTile(map, wallX + dx, g + dy, Terrain.Road)
    }
  }

  for (let i = 0; i < 24; i++) {
    const x = rng.nextInt(8, size - 9)
    const y = rng.nextInt(8, size - 9)
    if (Math.abs(x - wallX) <= 4) continue
    if (map.tiles[tileIndex(map, x, y)] === Terrain.Ground) setTile(map, x, y, Terrain.BuildableGround)
  }

  const nearPass = (x: number, y: number): boolean => Math.abs(x - wallX) < 6 && (Math.abs(y - g0) < 5 || Math.abs(y - g1) < 5)
  let placed = 0
  let guard = 0
  while (placed < 16 && guard < 500) {
    guard++
    const x = rng.nextInt(6, size - 10)
    const y = rng.nextInt(6, size - 10)
    if (Math.abs(x - wallX) <= 3 || nearPass(x, y)) continue
    map.obstructions.push({ x, y, w: rng.nextInt(1, 3), h: rng.nextInt(1, 3), type: placed % 3 === 0 ? 'wreck' : 'rock' })
    placed++
  }

  addSpawn(map, 10, 10)
  addSpawn(map, size - 18, size - 18)
  addField(map, 18, 18, 3, 26)
  addField(map, size - 26, size - 26, 3, 26)
  addField(map, wallX - 10, g0, 3, 20)
  addField(map, wallX + 10, g1, 3, 20)
  addField(map, wallX + 10, g0, 3, 16)
  addField(map, wallX - 10, g1, 3, 16)
  placeOilFields(map, size, 2)
  postProcess(map, size, rng)
  return map
}

// ---------- Crossroads of Cinder (4p) ----------

const buildCrossroadsMap = (size: number, rng: RNG): MapData => {
  const map = createEmptyMap(size, size)
  map.name = 'Crossroads of Cinder'
  map.description = 'Four bases linked by a stone cross of roads around a rich central plaza.'
  map.author = 'Space Arenas'

  const cx = Math.floor(size / 2)
  const cy = Math.floor(size / 2)
  const corner = Math.floor(size * 0.15)
  const lakes = [
    [4, 4],
    [size - 5, 4],
    [4, size - 5],
    [size - 5, size - 5],
  ]
  for (const [lcx, lcy] of lakes) {
    disc(map, lcx, lcy, corner, Terrain.Water)
    ringBand(map, lcx, lcy, corner + 1, corner + 2, Terrain.BuildableGround)
  }

  disc(map, cx, cy, Math.floor(size * 0.07), Terrain.BuildableGround)
  for (let i = -2; i <= 2; i++) {
    for (let y = 0; y < size; y++) setTile(map, cx + i, y, Terrain.Road)
    for (let x = 0; x < size; x++) setTile(map, x, cy + i, Terrain.Road)
  }

  const arm = Math.floor(size * 0.42)
  addSpawn(map, cx, Math.max(6, cy - arm))
  addSpawn(map, Math.min(size - 7, cx + arm), cy)
  addSpawn(map, cx, Math.min(size - 7, cy + arm))
  addSpawn(map, Math.max(6, cx - arm), cy)

  for (const s of map.spawnPoints) addField(map, s.x + 6, s.y + 6, 3, 24)
  addField(map, cx, cy, 4, 40)
  addField(map, cx, Math.floor(size * 0.25), 3, 18)
  addField(map, cx, size - Math.floor(size * 0.25), 3, 18)
  addField(map, Math.floor(size * 0.25), cy, 3, 18)
  addField(map, size - Math.floor(size * 0.25), cy, 3, 18)
  placeOilFields(map, size, 3)

  let placed = 0
  let guard = 0
  while (placed < 14 && guard < 600) {
    guard++
    const x = rng.nextInt(6, size - 10)
    const y = rng.nextInt(6, size - 10)
    if (Math.abs(x - cx) < 5 || Math.abs(y - cy) < 5) continue
    if (map.tiles[tileIndex(map, x, y)] !== Terrain.Ground) continue
    map.obstructions.push({ x, y, w: rng.nextInt(1, 3), h: rng.nextInt(1, 3), type: placed % 3 === 0 ? 'wreck' : 'rock' })
    placed++
  }
  postProcess(map, size, rng)
  return map
}

// ---------- The Sixfold Ring (6p) ----------

const buildHexringMap = (size: number, rng: RNG): MapData => {
  const map = createEmptyMap(size, size)
  map.name = 'The Sixfold Ring'
  map.description = 'A crater lake crowned by an island, ringed by a circular road and six bases.'
  map.author = 'Space Arenas'

  const cx = Math.floor(size / 2)
  const cy = Math.floor(size / 2)
  const crater = Math.floor(size * 0.2)
  disc(map, cx, cy, crater, Terrain.Water)
  ringBand(map, cx, cy, crater + 1, crater + 3, Terrain.BuildableGround)
  disc(map, cx, cy, Math.floor(size * 0.045), Terrain.BuildableGround)
  for (let t = 6; t <= crater; t++) {
    setTile(map, cx, cy - t, Terrain.Road)
    setTile(map, cx + 1, cy - t, Terrain.Road)
  }

  const ringR = Math.floor(size * 0.3)
  for (let a = 0; a < 360; a++) {
    const rad = (a * Math.PI) / 180
    const x = Math.round(cx + Math.cos(rad) * ringR)
    const y = Math.round(cy + Math.sin(rad) * ringR)
    setTile(map, x, y, Terrain.Road)
    setTile(map, x + 1, y, Terrain.Road)
    setTile(map, x, y + 1, Terrain.Road)
  }

  const baseR = Math.floor(size * 0.38)
  const hexAngles = [0, 60, 120, 180, 240, 300]
  for (const deg of hexAngles) {
    const rad = (deg * Math.PI) / 180
    addSpawn(map, Math.round(cx + Math.cos(rad) * baseR), Math.round(cy + Math.sin(rad) * baseR))
  }

  for (const s of map.spawnPoints) addField(map, s.x + 8, s.y + 8, 3, 24)
  const midR = Math.floor(size * 0.33)
  for (let i = 0; i < 6; i++) {
    const rad = ((hexAngles[i] + 30) * Math.PI) / 180
    addField(map, Math.round(cx + Math.cos(rad) * midR), Math.round(cy + Math.sin(rad) * midR), 3, 22)
  }
  addField(map, cx, cy, 3, 26)
  placeOilFields(map, size, 3)

  let placed = 0
  let guard = 0
  while (placed < 18 && guard < 700) {
    guard++
    const x = rng.nextInt(6, size - 10)
    const y = rng.nextInt(6, size - 10)
    const d = Math.hypot(x - cx, y - cy)
    if (d < size * 0.34 || d > size * 0.46) continue
    if (map.tiles[tileIndex(map, x, y)] !== Terrain.Ground) continue
    map.obstructions.push({ x, y, w: rng.nextInt(1, 3), h: rng.nextInt(1, 3), type: placed % 3 === 0 ? 'wreck' : 'rock' })
    placed++
  }
  postProcess(map, size, rng)
  return map
}

// ---------- Shattered Circlet (8p) ----------

const buildShatteredMap = (size: number, rng: RNG): MapData => {
  const map = createEmptyMap(size, size)
  map.name = 'Shattered Circlet'
  map.description = 'Eight bases around a broken wasteland core, linked by eight road-spokes.'
  map.author = 'Space Arenas'

  const cx = Math.floor(size / 2)
  const cy = Math.floor(size / 2)
  const core = Math.floor(size * 0.26)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - cx, y - cy)
      if (d > core) continue
      if (d < size * 0.06) {
        setTile(map, x, y, Terrain.Water)
        continue
      }
      const r = rng.nextInt(0, 100)
      const t = r < 45 ? Terrain.Ground : r < 62 ? Terrain.Water : r < 85 ? Terrain.BuildableGround : Terrain.Cliff
      setTile(map, x, y, t)
    }
  }

  const baseR = Math.floor(size * 0.42)
  for (let k = 0; k < 8; k++) {
    const rad = ((k * 45 + 22.5) * Math.PI) / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    for (let t = 0; t <= baseR; t++) {
      setTile(map, Math.round(cx + cos * t), Math.round(cy + sin * t), Terrain.Road)
      setTile(map, Math.round(cx + cos * t) + 1, Math.round(cy + sin * t), Terrain.Road)
    }
    addSpawn(map, Math.round(cx + cos * baseR), Math.round(cy + sin * baseR))
  }

  for (const s of map.spawnPoints) addField(map, s.x + 6, s.y + 6, 3, 22)
  const fieldR = Math.floor(size * 0.2)
  for (let k = 0; k < 8; k++) {
    const rad = ((k * 45 + 22.5) * Math.PI) / 180
    addField(map, Math.round(cx + Math.cos(rad) * fieldR), Math.round(cy + Math.sin(rad) * fieldR), 3, 20)
  }
  placeOilFields(map, size, 4)

  let placed = 0
  let guard = 0
  while (placed < 22 && guard < 800) {
    guard++
    const x = rng.nextInt(6, size - 10)
    const y = rng.nextInt(6, size - 10)
    const d = Math.hypot(x - cx, y - cy)
    if (d < core + 4) continue
    if (map.tiles[tileIndex(map, x, y)] !== Terrain.Ground) continue
    map.obstructions.push({ x, y, w: rng.nextInt(1, 3), h: rng.nextInt(1, 3), type: placed % 3 === 0 ? 'wreck' : 'rock' })
    placed++
  }
  postProcess(map, size, rng)
  return map
}

const carveRiver = (size: number, map: MapData, rng: RNG): void => {
  let y = Math.floor(size * 0.35)
  for (let x = 0; x < size; x++) {
    y += rng.nextInt(-1, 2)
    y = Math.max(Math.floor(size * 0.25), Math.min(Math.floor(size * 0.55), y))
    for (let dy = -3; dy <= 3; dy++) {
      const ty = y + dy
      if (ty < 0 || ty >= size) continue
      const dist = Math.abs(dy)
      if (dist <= 1) map.tiles[tileIndex(map, x, ty)] = Terrain.Water
      else if (dist === 2 && rng.nextInt(0, 100) < 60) map.tiles[tileIndex(map, x, ty)] = Terrain.Water
      else map.tiles[tileIndex(map, x, ty)] = Terrain.BuildableGround
    }
  }
  const bridges = [Math.floor(size * 0.31), Math.floor(size * 0.5), Math.floor(size * 0.69)]
  for (const rx of bridges) {
    for (let yy = 0; yy < size; yy++) {
      const at = tileIndex(map, rx, yy)
      const next = tileIndex(map, rx + 1, yy)
      if (map.tiles[at] === Terrain.Water || map.tiles[next] === Terrain.Water) {
        map.tiles[at] = Terrain.Road
        map.tiles[next] = Terrain.Road
      }
    }
  }
}

const carveLake = (size: number, map: MapData): void => {
  const cx = Math.floor(size / 2)
  const cy = Math.floor(size / 2)
  const r = Math.floor(size * 0.16)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - cx, y - cy)
      if (d <= r) map.tiles[tileIndex(map, x, y)] = Terrain.Water
      else if (d <= r + 2) map.tiles[tileIndex(map, x, y)] = Terrain.BuildableGround
    }
  }
  for (let x = cx - r - 2; x <= cx + r + 2; x++) {
    map.tiles[tileIndex(map, x, cy)] = Terrain.Road
    map.tiles[tileIndex(map, x, cy + 1)] = Terrain.Road
  }
  for (let y = cy - r - 2; y <= cy + r + 2; y++) {
    map.tiles[tileIndex(map, cx, y)] = Terrain.Road
    map.tiles[tileIndex(map, cx + 1, y)] = Terrain.Road
  }
}

const carveRings = (size: number, map: MapData): void => {
  const cx = Math.floor(size / 2)
  const cy = Math.floor(size / 2)
  const r1 = Math.floor(size * 0.22)
  const r2 = r1 + 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - cx, y - cy)
      if (d >= r1 && d <= r2) map.tiles[tileIndex(map, x, y)] = Terrain.Water
    }
  }
  const gaps = [0, 90, 180, 270]
  for (const g of gaps) {
    const a = (g * Math.PI) / 180
    const dx = Math.round(Math.cos(a) * (r1 + 1))
    const dy = Math.round(Math.sin(a) * (r1 + 1))
    for (let k = -1; k <= 1; k++) {
      for (let k2 = -1; k2 <= 1; k2++) {
        const x = cx + dx + k
        const y = cy + dy + k2
        if (x >= 0 && y >= 0 && x < size && y < size) map.tiles[tileIndex(map, x, y)] = Terrain.Road
      }
    }
    for (let t = 0; t < r1; t += 3) {
      const x = cx + Math.round(Math.cos(a) * t)
      const y = cy + Math.round(Math.sin(a) * t)
      if (x >= 0 && y >= 0 && x < size && y < size) map.tiles[tileIndex(map, x, y)] = Terrain.Road
    }
  }
}

export const generateDefaultMap = (seedText = 'default-map-v1'): MapData => {
  const rng = new RNG(hashSeed(seedText))
  const w = 128
  const h = 128
  const map = createEmptyMap(w, h)
  map.name = 'The Breach'
  map.description = 'Two supply clusters split by a river with two bridges. Classic LAN layout.'
  map.author = 'Space Arenas'

  const carveRiver = (): void => {
    let y = 40
    for (let x = 0; x < w; x++) {
      y += rng.nextInt(-1, 2)
      y = Math.max(30, Math.min(60, y))
      for (let dy = -3; dy <= 3; dy++) {
        const ty = y + dy
        if (ty >= 0 && ty < h && x >= 0 && x < w) {
          const dist = Math.abs(dy)
          if (dist <= 1) map.tiles[tileIndex(map, x, ty)] = Terrain.Water
          else if (dist === 2 && rng.nextInt(0, 100) < 60) map.tiles[tileIndex(map, x, ty)] = Terrain.Water
          else map.tiles[tileIndex(map, x, ty)] = Terrain.BuildableGround
        }
      }
    }
  }
  carveRiver()

  const addRoadBridges = (): void => {
    const roadXs = [40, 88]
    for (const rx of roadXs) {
      for (let y = 0; y < h; y++) {
        const at = tileIndex(map, rx, y)
        const next = tileIndex(map, rx + 1, y)
        if (map.tiles[at] === Terrain.Water || map.tiles[next] === Terrain.Water) {
          map.tiles[at] = Terrain.Road
          map.tiles[next] = Terrain.Road
        }
      }
    }
  }
  addRoadBridges()

  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const nearBorder = x < 4 || y < 4 || x > w - 5 || y > h - 5
      if (!nearBorder && map.tiles[tileIndex(map, x, y)] === Terrain.Ground && rng.nextInt(0, 100) < 12) {
        map.tiles[tileIndex(map, x, y)] = Terrain.BuildableGround
      }
    }
  }

  for (let i = 0; i < 18; i++) {
    map.obstructions.push({
      x: rng.nextInt(6, w - 10),
      y: rng.nextInt(6, h - 10),
      w: rng.nextInt(1, 3),
      h: rng.nextInt(1, 3),
      type: i % 3 === 0 ? 'wreck' : 'rock',
    })
  }

  map.supplyFields.push(
    { x: 20, y: 20, radius: 3, capacity: 48 },
    { x: w - 20, y: h - 20, radius: 3, capacity: 48 },
    { x: Math.floor(w / 2), y: 18, radius: 3, capacity: 20 },
    { x: Math.floor(w / 2), y: h - 18, radius: 3, capacity: 20 },
  )

  map.spawnPoints.push({ x: 8, y: 8, team: 0 }, { x: w - 16, y: h - 16, team: 1 })

  placeOilFields(map, w, 2)

  return map
}

export const canonicalStringify = (map: MapData): string => {
  const tileRun = compressTiles(map.tiles)
  const o: Record<string, unknown> = {
    format: map.format,
    name: map.name,
    width: map.width,
    height: map.height,
    tiles: tileRun,
    obstructions: map.obstructions,
    supplyFields: map.supplyFields,
    oilFields: map.oilFields,
    spawnPoints: map.spawnPoints,
    credits: map.credits,
  }
  if (map.brightness) o.brightness = map.brightness
  return JSON.stringify(o)
}

export const compressTiles = (tiles: number[]): Array<[number, number]> => {
  const out: Array<[number, number]> = []
  let i = 0
  while (i < tiles.length) {
    const t = tiles[i]
    let run = 1
    while (i + run < tiles.length && tiles[i + run] === t && run < 0xffff) run++
    out.push([t, run])
    i += run
  }
  return out
}
