import { describe, expect, it } from 'vitest'
import {
  Terrain,
  MAP_PRESETS,
  canonicalStringify,
  compressTiles,
  createEmptyMap,
  generateDefaultMap,
  generateMap,
  mapForPreset,
  validateMap,
  tileIndex,
} from '@space-arenas/shared'

const decompress = (runs: Array<[number, number]>): number[] => {
  const out: number[] = []
  for (const [t, n] of runs) for (let i = 0; i < n; i++) out.push(t)
  return out
}

describe('maps: default map', () => {
  it('is valid', () => {
    const map = generateDefaultMap()
    expect(validateMap(map).ok).toBe(true)
  })

  it('has a river, both spawns, and supply fields', () => {
    const map = generateDefaultMap()
    expect(map.width).toBe(128)
    expect(map.height).toBe(128)
    expect(map.tiles).toHaveLength(128 * 128)
    expect(map.spawnPoints).toHaveLength(2)
    expect(map.spawnPoints.map((s) => s.team)).toEqual([0, 1])
    expect(map.supplyFields.length).toBeGreaterThanOrEqual(1)
    expect(map.tiles.some((t) => t === Terrain.Water)).toBe(true)
  })

  it('is deterministic for the same seed text', () => {
    const a = generateDefaultMap()
    const b = generateDefaultMap()
    expect(a.tiles).toEqual(b.tiles)
    expect(a.obstructions).toEqual(b.obstructions)
  })
})

describe('maps: validation', () => {
  it('rejects a map with no spawns', () => {
    const map = createEmptyMap(64, 64)
    const v = validateMap(map)
    expect(v.ok).toBe(false)
    expect(v.errors.some((e) => e.includes('spawn'))).toBe(true)
  })

  it('rejects duplicate team spawns', () => {
    const map = createEmptyMap(64, 64)
    map.spawnPoints.push({ x: 5, y: 5, team: 0 }, { x: 10, y: 10, team: 0 })
    map.supplyFields.push({ x: 20, y: 20, radius: 3, capacity: 10 })
    const v = validateMap(map)
    expect(v.errors.some((e) => e.includes('duplicate team'))).toBe(true)
  })

  it('rejects out-of-bounds spawns', () => {
    const map = createEmptyMap(64, 64)
    map.spawnPoints.push({ x: 5, y: 5, team: 0 }, { x: 1000, y: 1000, team: 1 })
    map.supplyFields.push({ x: 20, y: 20, radius: 3, capacity: 10 })
    const v = validateMap(map)
    expect(v.errors.some((e) => e.includes('out of bounds'))).toBe(true)
  })
})

describe('maps: canonical serialization', () => {
  it('produces identical output for equal maps', () => {
    const a = generateDefaultMap()
    const b = generateDefaultMap()
    expect(canonicalStringify(a)).toBe(canonicalStringify(b))
  })

  it('compress + decompress round-trips tiles', () => {
    const map = generateDefaultMap()
    const runs = compressTiles(map.tiles)
    expect(decompress(runs)).toEqual(map.tiles)
  })

  it('run-length encoding shrinks large uniform regions', () => {
    const runs = compressTiles(new Array<number>(1000).fill(0))
    expect(runs).toEqual([[0, 1000]])
  })
})

describe('maps: creative variants', () => {
  const variants: Array<{ name: string; players: number; variant: string }> = [
    { name: "Dead Man's Pass", players: 2, variant: 'pass' },
    { name: 'Crossroads of Cinder', players: 4, variant: 'crossroads' },
    { name: 'The Sixfold Ring', players: 6, variant: 'hexring' },
    { name: 'Shattered Circlet', players: 8, variant: 'shattered' },
  ]

  it.each(variants)('$name generates a valid $players-player map', ({ players, variant }) => {
    const map = generateMap(players, `test-${variant}-v1`, variant as never)
    expect(validateMap(map).ok).toBe(true)
  })

  it.each(variants)('$name has exactly $players unique-team spawns and supply fields', ({ players, variant }) => {
    const map = generateMap(players, `test-${variant}-v1`, variant as never)
    expect(map.spawnPoints).toHaveLength(players)
    expect(map.spawnPoints.map((s) => s.team)).toEqual(Array.from({ length: players }, (_, i) => i))
    expect(map.supplyFields.length).toBeGreaterThanOrEqual(players)
    expect(new Set(map.spawnPoints.map((s) => `${s.x},${s.y}`)).size).toBe(players)
  })

  it.each(variants)('$name spawn tiles are passable', ({ players, variant }) => {
    const map = generateMap(players, `test-${variant}-v1`, variant as never)
    for (const s of map.spawnPoints) {
      const t = map.tiles[tileIndex(map, s.x, s.y)]
      expect(t === Terrain.Water || t === Terrain.Cliff).toBe(false)
    }
  })

  it.each(variants)('$name is deterministic for the same seed', ({ players, variant }) => {
    const a = generateMap(players, `test-${variant}-v1`, variant as never)
    const b = generateMap(players, `test-${variant}-v1`, variant as never)
    expect(a.tiles).toEqual(b.tiles)
    expect(a.obstructions).toEqual(b.obstructions)
    expect(a.supplyFields).toEqual(b.supplyFields)
  })

  it.each(variants)('$name is reachable from the lobby preset list', ({ players, variant }) => {
    const preset = MAP_PRESETS.find((x) => x.variant === variant)
    expect(preset).toBeDefined()
    expect(preset!.players).toBe(players)
    expect(validateMap(mapForPreset(preset!)).ok).toBe(true)
  })
})

describe('maps: grid accessors', () => {
  it('tileIndex matches row-major layout', () => {
    const map = createEmptyMap(32, 16)
    expect(tileIndex(map, 5, 7)).toBe(7 * 32 + 5)
  })
})
