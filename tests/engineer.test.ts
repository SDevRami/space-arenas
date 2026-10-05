import { describe, expect, it } from 'vitest'
import { createEmptyMap, type MatchSettings } from '@space-arenas/shared'
import { Simulator } from '../client/src/core/Simulator.ts'
import { hashWorld } from '../client/src/core/hash.ts'
import { spawnUnit } from '../client/src/entities/factories.ts'

const MAP = createEmptyMap(64, 64)
const SEED = 0xbabeface

const makeSim = (settings?: Partial<MatchSettings>): Simulator => new Simulator(MAP, SEED, [0, 1], settings)

const drainRejected = (sim: Simulator, reason: string): boolean =>
  sim.drainEvents().some((e) => e.type === 'command-rejected' && e.reason === reason)

describe('engineer single-target heal', () => {
  it('heals an ordered damaged ally every tick until full — by default, with no research', () => {
    const sim = makeSim()
    const { world } = sim
    expect(world.teamState(0).mineTech).toBe(false) // heal must NOT require mine-tech
    const engineer = spawnUnit(world, 'engineer', 0, 10000, 10000)
    const patient = spawnUnit(world, 'rifleman', 0, 10500, 10500)
    world.healths.require(patient).hp = 180

    sim.step([sim.makeCommand(0, { type: 'repair-unit', entities: [engineer], x: 0, y: 0, target: patient })])
    expect(world.works.require(engineer).kind).toBe('repair-unit')
    expect(sim.drainEvents().some((e) => e.type === 'repair-target-assigned')).toBe(true)

    sim.advance(2)

    const hp = world.healths.require(patient).hp
    expect(hp).toBeGreaterThan(180)
    expect(hp).toBeLessThanOrEqual(world.healths.require(patient).maxHp)
  })

  it('stops healing when the target reaches full health', () => {
    const sim = makeSim()
    const { world } = sim
    const engineer = spawnUnit(world, 'engineer', 0, 10000, 10000)
    const patient = spawnUnit(world, 'rifleman', 0, 10500, 10500)
    world.healths.require(patient).hp = 190

    sim.step([sim.makeCommand(0, { type: 'repair-unit', entities: [engineer], x: 0, y: 0, target: patient })])
    sim.advance(10)

    expect(world.healths.require(patient).hp).toBe(world.healths.require(patient).maxHp)
    expect(world.works.get(engineer)).toBeUndefined()
  })

  it('chases an out-of-range ally instead of healing from a distance', () => {
    const sim = makeSim()
    const { world } = sim
    const engineer = spawnUnit(world, 'engineer', 0, 10000, 10000)
    const patient = spawnUnit(world, 'rifleman', 0, 15000, 10000)
    world.healths.require(patient).hp = 180

    sim.step([sim.makeCommand(0, { type: 'repair-unit', entities: [engineer], x: 0, y: 0, target: patient })])

    // Still too far this tick: the engineer walks over instead of healing.
    expect(world.moves.has(engineer)).toBe(true)
    expect(world.healths.require(patient).hp).toBe(180)
  })

  it('rejects air targets', () => {
    const sim = makeSim()
    const { world } = sim
    const engineer = spawnUnit(world, 'engineer', 0, 10000, 10000)
    const fighter = spawnUnit(world, 'fighter', 0, 10500, 10500)
    world.healths.require(fighter).hp = 100

    sim.step([sim.makeCommand(0, { type: 'repair-unit', entities: [engineer], x: 0, y: 0, target: fighter })])

    expect(world.works.get(engineer)).toBeUndefined()
    expect(drainRejected(sim, 'cannot repair air units')).toBe(true)
  })

  it('rejects targets already at full health', () => {
    const sim = makeSim()
    const { world } = sim
    const engineer = spawnUnit(world, 'engineer', 0, 10000, 10000)
    const patient = spawnUnit(world, 'rifleman', 0, 10500, 10500)

    sim.step([sim.makeCommand(0, { type: 'repair-unit', entities: [engineer], x: 0, y: 0, target: patient })])

    expect(world.works.get(engineer)).toBeUndefined()
    expect(drainRejected(sim, 'target already at full health')).toBe(true)
  })

  it('rejects the order when no engineer is available', () => {
    const sim = makeSim()
    const { world } = sim
    const dozer = spawnUnit(world, 'bulldozer', 0, 10000, 10000)
    const patient = spawnUnit(world, 'rifleman', 0, 10500, 10500)
    world.healths.require(patient).hp = 180

    sim.step([sim.makeCommand(0, { type: 'repair-unit', entities: [dozer], x: 0, y: 0, target: patient })])

    expect(drainRejected(sim, 'no available engineer')).toBe(true)
  })
})

describe('engineer healing aura', () => {
  const engineer = (sim: Simulator, rank: number): number => {
    const id = spawnUnit(sim.world, 'engineer', 0, 10000, 10000)
    sim.world.units.require(id).veteranRank = rank
    return id
  }
  const woundedAlly = (sim: Simulator, x: number, y: number): number => {
    const id = spawnUnit(sim.world, 'rifleman', 0, x, y)
    sim.world.healths.require(id).hp = 100
    return id
  }

  it('passively heals every allied ground unit inside the aura at rank 3+', () => {
    const sim = makeSim()
    const { world } = sim
    engineer(sim, 3)
    const a = woundedAlly(sim, 10800, 10000)
    const b = woundedAlly(sim, 10000, 11800)

    sim.advance(2)

    const heal = world.settings.engineerHealPerTick
    expect(world.healths.require(a).hp).toBe(100 + 2 * heal)
    expect(world.healths.require(b).hp).toBe(100 + 2 * heal)
    expect(world.healFlashes.has(a)).toBe(true)
    expect(world.healFlashes.has(b)).toBe(true)
  })

  it('does not heal before the configured rank', () => {
    const sim = makeSim()
    const { world } = sim
    engineer(sim, 2) // default engineerHealRank = 3
    const a = woundedAlly(sim, 10800, 10000)

    sim.advance(2)

    expect(world.healths.require(a).hp).toBe(100)
    expect(world.healFlashes.has(a)).toBe(false)
  })

  it('never heals air units or full-health allies even in the aura', () => {
    const sim = makeSim()
    const { world } = sim
    engineer(sim, 3)
    const full = woundedAlly(sim, 10800, 10000)
    world.healths.require(full).hp = world.healths.require(full).maxHp
    const fighter = spawnUnit(world, 'fighter', 0, 10800, 10000)
    world.healths.require(fighter).hp = 100

    sim.advance(2)

    expect(world.healths.require(full).hp).toBe(world.healths.require(full).maxHp)
    expect(world.healths.require(fighter).hp).toBe(100)
  })

  it('respects the aura radius', () => {
    const sim = makeSim()
    const { world } = sim
    engineer(sim, 3)
    const far = woundedAlly(sim, 14000, 10000) // 4 tiles away > aura radius 2

    sim.advance(2)

    expect(world.healths.require(far).hp).toBe(100)
  })
})

describe('engineer healing: lockstep determinism', () => {
  const runWithHeal = (): Simulator => {
    const sim = makeSim()
    const eng = spawnUnit(sim.world, 'engineer', 0, 10000, 10000)
    const patient = spawnUnit(sim.world, 'rifleman', 0, 10500, 10500)
    sim.world.healths.require(patient).hp = 180
    sim.step([sim.makeCommand(0, { type: 'repair-unit', entities: [eng], x: 0, y: 0, target: patient })])
    sim.world.units.require(eng).veteranRank = 3
    spawnUnit(sim.world, 'rifleman', 1, 12000, 10000)
    sim.advance(4)
    return sim
  }

  it('twin simulations hash identically', () => {
    const a = runWithHeal()
    const b = runWithHeal()
    expect(hashWorld(a.world)).toBe(hashWorld(b.world))
  })
})