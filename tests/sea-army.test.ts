import { describe, expect, it } from 'vitest'
import { Terrain, createEmptyMap, SECONDS_TO_TICKS, type MapData, type SimCommand } from '@space-arenas/shared'
import { Simulator } from '../client/src/core/Simulator.ts'
import { spawnBuilding, spawnUnit } from '../client/src/entities/factories.ts'

const SEED = 0x5ea4a5eed
const W = 64

/** 64x64 land map with one big connected lake in the middle: tiles [16..40]x[16..40] are water. */
const makeSeaMap = (): MapData => {
  const map = createEmptyMap(W, W)
  for (let y = 16; y <= 40; y++) {
    for (let x = 16; x <= 40; x++) map.tiles[y * W + x] = Terrain.Water
  }
  return map
}

const reveal = (sim: Simulator): void => {
  sim.world.fog.forEach((a) => a.fill(1))
}

const tileCenter = (tx: number, ty: number): { x: number; y: number } => ({ x: tx * 1000 + 500, y: ty * 1000 + 500 })

const tileOf = (sim: Simulator, id: number): { tx: number; ty: number } => {
  const t = sim.world.transforms.require(id)
  return { tx: Math.floor(t.x / 1000), ty: Math.floor(t.y / 1000) }
}

const onWater = (sim: Simulator, id: number): boolean => {
  const { tx, ty } = tileOf(sim, id)
  return sim.world.map.tiles[ty * W + tx] === Terrain.Water
}

const distTo = (sim: Simulator, id: number, tx: number, ty: number): number => {
  const t = sim.world.transforms.require(id)
  const p = tileCenter(tx, ty)
  return Math.hypot(t.x - p.x, t.y - p.y)
}

const orderMove = (sim: Simulator, id: number, tx: number, ty: number): void => {
  const p = tileCenter(tx, ty)
  sim.step([
    { player: 0, seq: sim.tick + 1, tick: sim.tick, cmd: { type: 'move', entities: [id], x: p.x, y: p.y } },
  ])
}

const waterSpawn = (sim: Simulator, unitType: string, team: number, tx: number, ty: number): number =>
  spawnUnit(sim.world, unitType, team, tileCenter(tx, ty).x, tileCenter(tx, ty).y)

describe('naval units move only on open water', () => {
  it('a carrier sails across the lake to another water tile', () => {
    const sim = new Simulator(makeSeaMap(), SEED, [0])
    const carrier = waterSpawn(sim, 'carrier', 0, 20, 30)
    orderMove(sim, carrier, 35, 20)
    sim.advance(4000)
    expect(sim.world.moves.has(carrier)).toBe(false)
    expect(onWater(sim, carrier)).toBe(true)
    expect(distTo(sim, carrier, 35, 20)).toBeLessThan(1600)
  })

  it('a carrier ordered onto land stops at the nearest water instead of beaching', () => {
    const sim = new Simulator(makeSeaMap(), SEED, [0])
    const carrier = waterSpawn(sim, 'carrier', 0, 20, 30)
    orderMove(sim, carrier, 12, 22)
    sim.advance(3000)
    expect(sim.world.moves.has(carrier)).toBe(false)
    expect(onWater(sim, carrier)).toBe(true)
    expect(distTo(sim, carrier, 16, 22)).toBeLessThan(2000)
  })

  it('a missile-boat likewise never enters land tiles', () => {
    const sim = new Simulator(makeSeaMap(), SEED, [0])
    const boat = waterSpawn(sim, 'missile-boat', 0, 20, 30)
    orderMove(sim, boat, 12, 22)
    sim.advance(3000)
    expect(onWater(sim, boat)).toBe(true)
    expect(distTo(sim, boat, 16, 22)).toBeLessThan(2000)
  })

  it('a road bridge is solid ground to ships and blocks their water path', () => {
    const map = makeSeaMap()
    for (let x = 16; x <= 40; x++) map.tiles[28 * W + x] = Terrain.Road
    const sim = new Simulator(map, SEED, [0])
    const carrier = waterSpawn(sim, 'carrier', 0, 20, 22)
    orderMove(sim, carrier, 20, 35)
    sim.advance(6000)
    const ty = tileOf(sim, carrier).ty
    expect(ty).toBeLessThan(28)
  })
})

describe('dock placement requires a shoreline', () => {
  const cmd = (sim: Simulator, c: SimCommand): void => {
    sim.step([{ player: 0, seq: sim.tick + 1, tick: sim.tick, cmd: c }])
  }

  const withDozer = (sim: Simulator, tx = 15, ty = 24): number => spawnUnit(sim.world, 'bulldozer', 0, tileCenter(tx, ty).x, tileCenter(tx, ty).y)

  it('accepts a dock whose footprint touches a water edge', () => {
    const sim = new Simulator(makeSeaMap(), SEED, [0])
    sim.world.teams.get(0)!.credits = 100000
    reveal(sim)
    const d = withDozer(sim)
    cmd(sim, { type: 'place', entities: [d], x: 13, y: 20, buildingType: 'dock' })
    const events = sim.drainEvents()
    expect(events.some((e) => e.type === 'command-rejected')).toBe(false)
    let dock = 0
    sim.world.buildings.forEach((id, b) => {
      if (b.buildingType === 'dock' && b.team === 0) dock = id
    })
    expect(dock).toBeGreaterThan(0)
  })

  it('rejects a dock with no adjacent water tile', () => {
    const sim = new Simulator(makeSeaMap(), SEED, [0])
    sim.world.teams.get(0)!.credits = 100000
    reveal(sim)
    const d = withDozer(sim)
    cmd(sim, { type: 'place', entities: [d], x: 5, y: 5, buildingType: 'dock' })
    const events = sim.drainEvents()
    expect(events.some((e) => e.type === 'command-rejected' && e.reason === 'dock needs water access')).toBe(true)
  })

  it('rejects a dock whose footprint covers water', () => {
    const sim = new Simulator(makeSeaMap(), SEED, [0])
    sim.world.teams.get(0)!.credits = 100000
    reveal(sim)
    const d = withDozer(sim)
    cmd(sim, { type: 'place', entities: [d], x: 15, y: 20, buildingType: 'dock' })
    const events = sim.drainEvents()
    expect(events.some((e) => e.type === 'command-rejected' && e.reason === 'cannot build on this terrain')).toBe(true)
  })

  it('a finished dock trains a carrier that floats on its auto-nearest water tile', () => {
    const sim = new Simulator(makeSeaMap(), SEED, [0])
    sim.world.teams.get(0)!.credits = 100000
    reveal(sim)
    spawnBuilding(sim.world, 'power-plant', 0, 20, 2, true)
    const d = spawnUnit(sim.world, 'bulldozer', 0, 14500, 19500)
    cmd(sim, { type: 'place', entities: [d], x: 13, y: 20, buildingType: 'dock' })
    sim.drainEvents()
    sim.advance(SECONDS_TO_TICKS(30) + 600)
    let dock = 0
    sim.world.buildings.forEach((id, b) => {
      if (b.buildingType === 'dock' && b.team === 0 && b.done) dock = id
    })
    expect(dock).toBeGreaterThan(0)

    cmd(sim, { type: 'queue', entities: [dock], x: 0, y: 0, unitType: 'carrier' })
    sim.advance(SECONDS_TO_TICKS(35) + 400)
    let carrier = 0
    sim.world.units.forEach((id, u) => {
      if (u.team === 0 && u.unitType === 'carrier') carrier = id
    })
    expect(carrier).toBeGreaterThan(0)
    expect(onWater(sim, carrier)).toBe(true)
    const dt = sim.world.transforms.require(dock)
    const ct = sim.world.transforms.require(carrier)
    expect(Math.hypot(dt.x - ct.x, dt.y - ct.y)).toBeLessThanOrEqual(3200)
  })
})

describe('everyone can hit ships; sea missiles splash but never air', () => {
  it('a shore rifleman auto-fires on a carrier in the water', () => {
    const sim = new Simulator(makeSeaMap(), SEED, [0, 1])
    const carrier = spawnUnit(sim.world, 'carrier', 0, 20500, 17500)
    spawnUnit(sim.world, 'rifleman', 1, 20500, 15500)
    sim.advance(1200)
    const h = sim.world.healths.get(carrier)
    expect(h === undefined || h.hp < 900).toBe(true)
  })

  it('a missile-boat blasts a naval target and splashes shore infantry', () => {
    // Ship and infantry are on separate enemy teams so same-team separation
    // never nudges the infantry out of the 1.5-tile splash radius.
    const sim = new Simulator(makeSeaMap(), SEED, [0, 1, 2])
    const boat = waterSpawn(sim, 'missile-boat', 0, 20, 20)
    const enemyShip = waterSpawn(sim, 'carrier', 1, 16, 20)
    const infantry = spawnUnit(sim.world, 'rifleman', 2, 15500, 19500)
    const shipHp0 = sim.world.healths.require(enemyShip).hp
    const infHp0 = sim.world.healths.require(infantry).hp
    sim.world.attacks.require(boat).target = enemyShip
    sim.advance(500)
    const shipHp = sim.world.healths.get(enemyShip)?.hp
    expect(shipHp === undefined || shipHp < shipHp0).toBe(true)
    const infHp = sim.world.healths.get(infantry)?.hp
    expect(infHp === undefined || infHp < infHp0).toBe(true)
  })

  it('sea-missile splash skips aircraft standing in the blast', () => {
    const sim = new Simulator(makeSeaMap(), SEED, [0, 1, 2])
    const boat = waterSpawn(sim, 'missile-boat', 0, 22, 20)
    const enemyShip = waterSpawn(sim, 'carrier', 1, 18, 20)
    const plane = spawnUnit(sim.world, 'fighter', 2, 18500, 19500)
    const planeHp0 = sim.world.healths.require(plane).hp
    sim.world.attacks.require(boat).target = enemyShip
    sim.advance(500)
    const shipHp = sim.world.healths.get(enemyShip)?.hp
    expect(shipHp === undefined || shipHp < 900).toBe(true)
    expect(sim.world.healths.get(plane)?.hp).toBe(planeHp0)
  })
})

describe('carrier amphibious transport', () => {
  it('loads infantry from shore, sails, and unloads them onto land', () => {
    const sim = new Simulator(makeSeaMap(), SEED, [0])
    const carrier = waterSpawn(sim, 'carrier', 0, 19, 17)
    const grunt = spawnUnit(sim.world, 'rifleman', 0, 19500, 15500)

    sim.step([
      {
        player: 0,
        seq: sim.tick + 1,
        tick: sim.tick,
        cmd: { type: 'transport-load', transportId: carrier, entities: [grunt], x: 0, y: 0 },
      },
    ])
    sim.advance(60)
    expect(sim.world.transports.require(carrier).passengers.length).toBe(1)
    expect(sim.world.units.has(grunt)).toBe(false)

    orderMove(sim, carrier, 30, 17)
    sim.advance(1500)
    expect(onWater(sim, carrier)).toBe(true)

    sim.step([
      {
        player: 0,
        seq: sim.tick + 1,
        tick: sim.tick,
        cmd: { type: 'transport-unload', transportId: carrier, entities: [], x: 30500, y: 15500 },
      },
    ])
    sim.advance(120)
    expect(sim.world.transports.require(carrier).passengers.length).toBe(0)

    let landed = 0
    sim.world.units.forEach((id, u) => {
      if (u.team === 0 && u.unitType === 'rifleman') landed = id
    })
    expect(landed).toBeGreaterThan(0)
    expect(onWater(sim, landed)).toBe(false)
  })
})