import { describe, expect, it } from 'vitest'
import { Terrain, createEmptyMap, type MapData } from '@space-arenas/shared'
import { Simulator } from '../client/src/core/Simulator.ts'
import { spawnBuilding, spawnUnit } from '../client/src/entities/factories.ts'
import { placementValid } from '../client/src/systems/input-system.ts'

const W = 64
const SEED = 0xc0ffee

/** 64x64 land map with one big connected lake: tiles [16..40]x[16..40] are water. */
const makeSeaMap = (): MapData => {
  const map = createEmptyMap(W, W)
  for (let y = 16; y <= 40; y++) {
    for (let x = 16; x <= 40; x++) map.tiles[y * W + x] = Terrain.Water
  }
  return map
}

const tileCenter = (tx: number, ty: number): { x: number; y: number } => ({ x: tx * 1000 + 500, y: ty * 1000 + 500 })

/** Powered base + completed Dock + a Crypto Miner on the lake, supported by 3 boats and 1 carrier. */
const makeSupportedMatch = (opts: { dock?: boolean; boats?: number; carriers?: number } = {}) => {
  const dock = opts.dock ?? true
  const boats = opts.boats ?? 3
  const carriers = opts.carriers ?? 1
  const sim = new Simulator(makeSeaMap(), SEED, [0])
  const { world } = sim
  spawnBuilding(world, 'power-plant', 0, 4, 4, true)
  if (dock) spawnBuilding(world, 'dock', 0, 9, 9, true)
  spawnBuilding(world, 'crypto-miner', 0, 20, 20, true)
  for (let i = 0; i < boats; i++) {
    const p = tileCenter(24 + i * 2, 30)
    spawnUnit(world, 'missile-boat', 0, p.x, p.y)
  }
  for (let i = 0; i < carriers; i++) {
    const p = tileCenter(25 + i * 2, 34)
    spawnUnit(world, 'carrier', 0, p.x, p.y)
  }
  return sim
}

const findCryptoMiner = (sim: Simulator): number => {
  let found = -1
  sim.world.buildings.forEach((id, b) => {
    if (found < 0 && b.buildingType === 'crypto-miner') found = id
  })
  return found
}

const reveal = (sim: Simulator): void => {
  sim.world.fog.forEach((a) => a.fill(1))
}

describe('CryptoMinerSystem', () => {
  it('pays income every interval while powered, docked and escorted', () => {
    const sim = makeSupportedMatch()
    const interval = sim.world.settings.cryptoMinerIncomeIntervalTicks
    const miner = findCryptoMiner(sim)
    expect(miner).toBeGreaterThan(0)

    const before = sim.world.creditsOf(0)
    sim.advance(interval + 2)

    expect(sim.world.creditsOf(0)).toBe(before + sim.world.settings.cryptoMinerIncome)
  })

  it('pays nothing when the navy escort is below the minimum', () => {
    const sim = makeSupportedMatch({ boats: 2 })
    const interval = sim.world.settings.cryptoMinerIncomeIntervalTicks

    const before = sim.world.creditsOf(0)
    sim.advance(interval + 2)

    expect(sim.world.creditsOf(0)).toBe(before)
  })

  it('pays nothing without a completed Dock', () => {
    const sim = makeSupportedMatch({ dock: false })
    const interval = sim.world.settings.cryptoMinerIncomeIntervalTicks

    const before = sim.world.creditsOf(0)
    sim.advance(interval + 2)

    expect(sim.world.creditsOf(0)).toBe(before)
  })

  it('restarts the payout timer after losing support (no banked income)', () => {
    const sim = makeSupportedMatch()
    const { world } = sim
    const interval = world.settings.cryptoMinerIncomeIntervalTicks
    const miner = findCryptoMiner(sim)

    sim.advance(Math.floor(interval * 0.9))
    // Drop one boat: support fails, the timer resets on that tick.
    let removed = false
    world.units.forEach((id, u) => {
      if (!removed && u.unitType === 'missile-boat') {
        world.removeEntity(id)
        removed = true
      }
    })
    const before = world.creditsOf(0)
    sim.advance(2)
    expect(world.creditsOf(0)).toBe(before)

    // Restore support; a full interval must still elapse before the next payout.
    const p = tileCenter(30, 30)
    spawnUnit(world, 'missile-boat', 0, p.x, p.y)
    const beforeRestored = world.creditsOf(0)
    sim.advance(Math.floor(interval * 0.5))
    expect(world.creditsOf(0)).toBe(beforeRestored)
    expect(world.buildings.require(miner).cryptoIncomeTicks).toBeLessThan(interval)
  })
})

describe('Crypto Miner placement', () => {
  it('only allows open water tiles', () => {
    const sim = new Simulator(makeSeaMap(), SEED, [0])
    reveal(sim)
    expect(placementValid(sim.world, 0, 'crypto-miner', 20, 20)).toBeNull()
    expect(placementValid(sim.world, 0, 'crypto-miner', 8, 8)).toBe('crypto miner needs open water')
  })

  it('enforces the configured edge-to-edge spacing between friendly miners', () => {
    const sim = new Simulator(makeSeaMap(), SEED, [0])
    reveal(sim)
    spawnBuilding(sim.world, 'crypto-miner', 0, 20, 20, true)

    // 3-wide footprint at x=26 starts 3 tiles after the first one ends (23) -> too close.
    expect(placementValid(sim.world, 0, 'crypto-miner', 26, 20)).not.toBeNull()
    // Exactly 5 empty tiles (23..27) passes at the default spacing.
    expect(placementValid(sim.world, 0, 'crypto-miner', 28, 20)).toBeNull()
  })

  it('stacks on a different axis once the gap is wide enough', () => {
    const sim = new Simulator(makeSeaMap(), SEED, [0])
    reveal(sim)
    spawnBuilding(sim.world, 'crypto-miner', 0, 20, 20, true)

    expect(placementValid(sim.world, 0, 'crypto-miner', 20, 26)).not.toBeNull()
    expect(placementValid(sim.world, 0, 'crypto-miner', 20, 28)).toBeNull()
  })

  it('is built by a Carrier and rejected from a Bulldozer', () => {
    const sim = new Simulator(makeSeaMap(), SEED, [0])
    const { world } = sim
    reveal(sim)
    // Plenty of credits for the $800 build.
    world.grantCredits(0, 10000)

    const carrier = spawnUnit(world, 'carrier', 0, tileCenter(30, 30).x, tileCenter(30, 30).y)
    sim.step([
      {
        player: 0,
        seq: sim.tick + 1,
        tick: sim.tick,
        cmd: { type: 'place', buildingType: 'crypto-miner', entities: [carrier], x: 20, y: 20 },
      },
    ])

    const miner = findCryptoMiner(sim)
    expect(miner).toBeGreaterThan(0)
    expect(world.buildings.require(miner).assignedDozer).toBe(carrier)
    expect(world.works.require(carrier).kind).toBe('construct')

    // A bulldozer cannot start a Crypto Miner.
    const sim2 = new Simulator(makeSeaMap(), SEED, [0])
    reveal(sim2)
    sim2.world.grantCredits(0, 10000)
    const dozer = spawnUnit(sim2.world, 'bulldozer', 0, tileCenter(5, 5).x, tileCenter(5, 5).y)
    sim2.step([
      {
        player: 0,
        seq: sim2.tick + 1,
        tick: sim2.tick,
        cmd: { type: 'place', buildingType: 'crypto-miner', entities: [dozer], x: 20, y: 20 },
      },
    ])
    expect(findCryptoMiner(sim2)).toBe(-1)
  })
})
