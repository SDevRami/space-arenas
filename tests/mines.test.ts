import { describe, expect, it } from 'vitest'
import { createEmptyMap, type MatchSettings } from '@space-arenas/shared'
import { Simulator } from '../client/src/core/Simulator.ts'
import { hashWorld } from '../client/src/core/hash.ts'
import { spawnUnit } from '../client/src/entities/factories.ts'

const MAP = createEmptyMap(64, 64)
const SEED = 0xc0ffee

const makeSim = (settings?: Partial<MatchSettings>): Simulator => new Simulator(MAP, SEED, [0, 1], settings)

const drainRejected = (sim: Simulator, reason: string): boolean =>
  sim.drainEvents().some((e) => e.type === 'command-rejected' && e.reason === reason)

const firstMineId = (sim: Simulator): number => {
  let id = -1
  sim.world.mines.forEach((mid) => {
    id = mid
  })
  return id
}

// Engineer spawns at (10000, 10000) = tile (10, 10); the mine lands on the
// clicked fixed-point point, which resolves to the same tile center (10500, 10500).
const placeMine = (sim: Simulator, engineer: number, x: number, y: number): void => {
  sim.step([sim.makeCommand(0, { type: 'place-mine', entities: [engineer], x, y })])
}

describe('mine placement', () => {
  it('plants an armed mine at the clicked tile and deducts the cost', () => {
    const sim = makeSim()
    const { world } = sim
    world.teamState(0).mineTech = true
    world.teamState(0).credits = 10000
    const engineer = spawnUnit(world, 'engineer', 0, 10000, 10000)
    const before = world.teamState(0).credits
    const placementTick = world.tick

    placeMine(sim, engineer, 10500, 10000)

    expect(world.mines.size).toBe(1)
    expect(world.teamState(0).credits).toBe(before - world.settings.mineCost)
    const mid = firstMineId(sim)
    const m = world.mines.require(mid)
    expect(m.team).toBe(0)
    expect(m.owner).toBe(engineer)
    expect(m.armTick).toBe(placementTick + world.settings.mineArmTicks)
    expect(m.damage).toBe(world.settings.mineDamage)
    const t = world.transforms.require(mid)
    expect(t.x).toBe(10500)
    expect(t.y).toBe(10500)
    expect(sim.drainEvents().some((e) => e.type === 'mine-placed')).toBe(true)
  })

  it('rejects planting without the mine-tech research', () => {
    const sim = makeSim()
    const { world } = sim
    const engineer = spawnUnit(world, 'engineer', 0, 10000, 10000)

    placeMine(sim, engineer, 10500, 10000)

    expect(world.mines.size).toBe(0)
    expect(drainRejected(sim, 'mine tech not researched')).toBe(true)
  })

  it('rejects planting unless an engineer is selected', () => {
    const sim = makeSim()
    const { world } = sim
    world.teamState(0).mineTech = true
    const dozer = spawnUnit(world, 'bulldozer', 0, 10000, 10000)

    placeMine(sim, dozer, 10500, 10000)

    expect(world.mines.size).toBe(0)
    expect(drainRejected(sim, 'no engineer selected')).toBe(true)
  })

  it('rejects planting outside the engineer range', () => {
    const sim = makeSim()
    const { world } = sim
    world.teamState(0).mineTech = true
    world.teamState(0).credits = 10000
    const engineer = spawnUnit(world, 'engineer', 0, 10000, 10000)

    placeMine(sim, engineer, 31500, 10000)

    expect(world.mines.size).toBe(0)
    expect(drainRejected(sim, 'mine out of range')).toBe(true)
  })

  it('rejects planting beyond the team mine limit', () => {
    const sim = makeSim({ mineLimit: 1 })
    const { world } = sim
    world.teamState(0).mineTech = true
    world.teamState(0).credits = 100000
    const engineer = spawnUnit(world, 'engineer', 0, 10000, 10000)

    placeMine(sim, engineer, 10500, 10000)
    placeMine(sim, engineer, 11500, 10000)

    expect(world.mines.size).toBe(1)
    expect(drainRejected(sim, 'mine limit reached')).toBe(true)
  })

  it('rejects planting without enough credits', () => {
    const sim = makeSim()
    const { world } = sim
    world.teamState(0).mineTech = true
    world.teamState(0).credits = 0
    const engineer = spawnUnit(world, 'engineer', 0, 10000, 10000)

    placeMine(sim, engineer, 10500, 10000)

    expect(world.mines.size).toBe(0)
    expect(drainRejected(sim, 'insufficient credits')).toBe(true)
  })

  it('rejects planting off the map', () => {
    const sim = makeSim()
    const { world } = sim
    world.teamState(0).mineTech = true
    world.teamState(0).credits = 10000
    // Engineer sits near the east edge so the off-map point is still in range —
    // the range check runs before the bounds check in the command handler.
    const engineer = spawnUnit(world, 'engineer', 0, 62500, 10000)

    placeMine(sim, engineer, 64500, 10000)

    expect(world.mines.size).toBe(0)
    expect(drainRejected(sim, 'mine out of bounds')).toBe(true)
  })
})

describe('mine detonation', () => {
  it('detonates once armed when an enemy ground unit steps within the trigger radius and damages the blast area', () => {
    const sim = makeSim()
    const { world } = sim
    world.teamState(0).mineTech = true
    world.teamState(0).credits = 10000
    const engineer = spawnUnit(world, 'engineer', 0, 10000, 10000)

    placeMine(sim, engineer, 10500, 10500)
    const armored = world.tick + world.settings.mineArmTicks
    sim.drainEvents()
    const engineerHpBefore = world.healths.require(engineer).hp

    // Scout walks into the 1-cell trigger radius before the arming window elapses.
    spawnUnit(world, 'scout', 1, 11050, 10500)

    // Still arming: nothing happens.
    sim.advance(world.settings.mineArmTicks - 1)
    expect(world.mines.size).toBe(1)
    expect(world.healths.get(firstMineId(sim))).toBeUndefined()

    // After arming, the enemy in the trigger radius sets it off.
    sim.advance(2)
    expect(world.mines.size).toBe(0)
    expect(sim.drainEvents().some((e) => e.type === 'mine-exploded')).toBe(true)

    let scoutId = -1
    world.units.forEach((uid, u) => {
      if (u.team === 1) scoutId = uid
    })
    expect(world.healths.require(scoutId).hp).toBe(100 - world.settings.mineDamage)
    // The placing engineer shares the blast radius but is SKIPPED (ally, no friendly fire).
    expect(world.healths.require(engineer).hp).toBe(engineerHpBefore)
    expect(world.tick).toBeGreaterThan(armored)
  })

  it('never trips on allied ground units by default (friendly fire off)', () => {
    const sim = makeSim()
    const { world } = sim
    world.teamState(0).mineTech = true
    world.teamState(0).credits = 10000
    const engineer = spawnUnit(world, 'engineer', 0, 10000, 10000)

    placeMine(sim, engineer, 10500, 10500)
    const ally = spawnUnit(world, 'scout', 0, 11050, 10500)
    const before = world.healths.require(ally).hp

    sim.advance(world.settings.mineArmTicks + 2)

    expect(world.mines.size).toBe(1)
    expect(world.healths.require(ally).hp).toBe(before)
  })

  it('trips on and damages allies when friendly-mine damage is on', () => {
    const sim = makeSim({ friendlyMineDamage: true })
    const { world } = sim
    world.teamState(0).mineTech = true
    world.teamState(0).credits = 10000
    const engineer = spawnUnit(world, 'engineer', 0, 10200, 10200)

    placeMine(sim, engineer, 10500, 10500)
    const ally = spawnUnit(world, 'scout', 0, 11050, 10500)

    sim.advance(world.settings.mineArmTicks + 2)

    expect(world.mines.size).toBe(0)
    expect(world.healths.require(ally).hp).toBe(100 - world.settings.mineDamage)
  })

  it('never trips while still arming', () => {
    const sim = makeSim()
    const { world } = sim
    world.teamState(0).mineTech = true
    world.teamState(0).credits = 10000
    const engineer = spawnUnit(world, 'engineer', 0, 10000, 10000)

    placeMine(sim, engineer, 10500, 10500)
    sim.drainEvents()
    const enemy = spawnUnit(world, 'scout', 1, 11050, 10500)

    sim.advance(world.settings.mineArmTicks - 2)

    expect(world.mines.size).toBe(1)
    expect(world.healths.require(enemy).hp).toBe(100)
  })

  it('awards a kill to the placing engineer', () => {
    const sim = makeSim()
    const { world } = sim
    world.teamState(0).mineTech = true
    world.teamState(0).credits = 10000
    const engineer = spawnUnit(world, 'engineer', 0, 10000, 10000)

    placeMine(sim, engineer, 10500, 10500)
    const victim = spawnUnit(world, 'scout', 1, 11050, 10500)
    world.healths.require(victim).hp = world.settings.mineDamage - 1

    sim.advance(world.settings.mineArmTicks + 2)

    expect(world.units.get(victim)).toBeUndefined()
    expect(world.units.require(engineer).killCount).toBe(1)
  })
})

describe('mine removal', () => {
  const setup = (sim: Simulator): number => {
    sim.world.teamState(0).mineTech = true
    sim.world.teamState(0).credits = 10000
    const engineer = spawnUnit(sim.world, 'engineer', 0, 10000, 10000)
    placeMine(sim, engineer, 10500, 10000)
    return firstMineId(sim)
  }

  it('sweeps an own mine with an engineer', () => {
    const sim = makeSim()
    const { world } = sim
    const mid = setup(sim)
    const engineer = spawnUnit(world, 'engineer', 0, 10200, 10000)

    sim.step([sim.makeCommand(0, { type: 'remove-mine', entities: [engineer], x: 0, y: 0, target: mid })])

    expect(world.mines.get(mid)).toBeUndefined()
    expect(world.transforms.get(mid)).toBeUndefined()
    expect(sim.drainEvents().some((e) => e.type === 'mine-removed')).toBe(true)
  })

  it('sweeps an own mine with a bulldozer', () => {
    const sim = makeSim()
    const { world } = sim
    const mid = setup(sim)
    const dozer = spawnUnit(world, 'bulldozer', 0, 10200, 10000)

    sim.step([sim.makeCommand(0, { type: 'remove-mine', entities: [dozer], x: 0, y: 0, target: mid })])

    expect(world.mines.get(mid)).toBeUndefined()
  })

  it('rejects sweeping before the mine-tech research', () => {
    const sim = makeSim()
    const { world } = sim
    world.teamState(0).mineTech = true
    world.teamState(0).credits = 10000
    const engineer = spawnUnit(world, 'engineer', 0, 10000, 10000)
    placeMine(sim, engineer, 10500, 10000)
    const mid = firstMineId(sim)
    world.teamState(0).mineTech = false

    sim.step([sim.makeCommand(0, { type: 'remove-mine', entities: [engineer], x: 0, y: 0, target: mid })])

    expect(world.mines.get(mid)).toBeDefined()
    expect(drainRejected(sim, 'mine tech not researched')).toBe(true)
  })

  it('rejects sweeping an enemy mine', () => {
    const sim = makeSim()
    const { world } = sim
    const mid = setup(sim)
    world.teamState(1).mineTech = true // the would-be sweeper researched too
    const enemy = spawnUnit(world, 'engineer', 1, 10200, 10000)

    sim.step([sim.makeCommand(1, { type: 'remove-mine', entities: [enemy], x: 0, y: 0, target: mid })])

    expect(world.mines.get(mid)).toBeDefined()
    expect(drainRejected(sim, 'no mine there')).toBe(true)
  })

  it('rejects sweeping out of range', () => {
    const sim = makeSim()
    const { world } = sim
    const mid = setup(sim)
    const dozer = spawnUnit(world, 'bulldozer', 0, 30000, 10000)

    sim.step([sim.makeCommand(0, { type: 'remove-mine', entities: [dozer], x: 0, y: 0, target: mid })])

    expect(world.mines.get(mid)).toBeDefined()
    expect(drainRejected(sim, 'mine out of range')).toBe(true)
  })
})

describe('mines: lockstep determinism', () => {
  const runWithMines = (): Simulator => {
    const sim = makeSim()
    const { world } = sim
    world.teamState(0).mineTech = true
    world.teamState(0).credits = 100000
    const engineer = spawnUnit(world, 'engineer', 0, 10000, 10000)
    sim.step([sim.makeCommand(0, { type: 'place-mine', entities: [engineer], x: 10500, y: 10500 })])
    spawnUnit(world, 'scout', 1, 11050, 10500)
    sim.advance(world.settings.mineArmTicks + 3)
    return sim
  }

  it('twin simulations hash identically', () => {
    const a = runWithMines()
    const b = runWithMines()
    expect(hashWorld(a.world)).toBe(hashWorld(b.world))
  })

  it('a world without mines hashes differently', () => {
    const a = runWithMines()
    const bareWorld = makeSim().world
    expect(hashWorld(a.world)).not.toBe(hashWorld(bareWorld))
  })
})