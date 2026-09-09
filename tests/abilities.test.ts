import { describe, expect, it } from 'vitest'
import { createEmptyMap, tileToFx, type MatchSettings } from '@space-arenas/shared'
import { Simulator } from '../client/src/core/Simulator.ts'
import { hashWorld } from '../client/src/core/hash.ts'
import { spawnBuilding, spawnUnit } from '../client/src/entities/factories.ts'
import { fire } from '../client/src/systems/combat-system.ts'

const MAP = createEmptyMap(64, 64)
const SEED = 0xc0ffee

const makeSim = (settings?: Partial<MatchSettings>): Simulator => new Simulator(MAP, SEED, [0, 1], settings)

const drainRejected = (sim: Simulator, reason: string): boolean =>
  sim.drainEvents().some((e) => e.type === 'command-rejected' && e.reason === reason)

describe('grenade throw', () => {
  it('lands a grenade that explodes after the fuse and damages the blast area', () => {
    const sim = makeSim()
    const { world } = sim
    const thrower = spawnUnit(world, 'rifleman', 0, 10000, 10000)
    const near = spawnUnit(world, 'rifleman', 1, 12200, 10000)
    const far = spawnUnit(world, 'rifleman', 1, 14500, 10000)
    const beforeNear = world.healths.require(near).hp
    const beforeFar = world.healths.require(far).hp

    sim.step([sim.makeCommand(0, { type: 'grenade', entities: [thrower], x: 12300, y: 10000 })])

    expect(world.grenades.size).toBe(1)
    const throwerComp = world.units.require(thrower)
    expect(throwerComp.abilityCooldown).toBe(world.settings.grenadeCooldownTicks)

    sim.advance(world.settings.grenadeFuseTicks)

    expect(sim.drainEvents().some((e) => e.type === 'grenade-exploded')).toBe(true)
    expect(world.grenades.size).toBe(0)
    expect(world.healths.require(near).hp).toBeLessThan(beforeNear)
    expect(world.healths.require(far).hp).toBe(beforeFar)
  })

  it('rejects throws beyond the configured range', () => {
    const sim = makeSim()
    const { world } = sim
    const thrower = spawnUnit(world, 'rifleman', 0, 10000, 10000)
    const farX = 10000 + tileToFx(world.settings.grenadeRange) + 300

    sim.step([sim.makeCommand(0, { type: 'grenade', entities: [thrower], x: farX, y: 10000 })])

    expect(drainRejected(sim, 'target out of throw range')).toBe(true)
    expect(world.grenades.size).toBe(0)
  })

  it('rejects a second throw while the ability is on cooldown', () => {
    const sim = makeSim()
    const { world } = sim
    const thrower = spawnUnit(world, 'rifleman', 0, 10000, 10000)

    sim.step([sim.makeCommand(0, { type: 'grenade', entities: [thrower], x: 11000, y: 10000 })])
    sim.step([sim.makeCommand(0, { type: 'grenade', entities: [thrower], x: 10900, y: 10000 })])

    expect(world.grenades.size).toBe(1)
    expect(drainRejected(sim, 'ability on cooldown')).toBe(true)

    // Once the cooldown elapses (and the first grenade has long since blown up)
    // the unit can throw again: a fresh grenade appears.
    sim.advance(world.settings.grenadeCooldownTicks)
    sim.step([sim.makeCommand(0, { type: 'grenade', entities: [thrower], x: 10800, y: 10000 })])
    expect(world.grenades.size).toBe(1)
  })
})

describe('smoke throw', () => {
  it('lets a cloud make shots through it miss', () => {
    const sim = makeSim({ smokeMissChance: 1 })
    const { world } = sim
    const attacker = spawnUnit(world, 'rifleman', 0, 10000, 10000)
    const target = spawnUnit(world, 'rifleman', 1, 13000, 10000)
    const thrower = spawnUnit(world, 'rifleman', 0, 12000, 14000)

    // Cloud lands exactly on the straight line between attacker and target.
    sim.step([sim.makeCommand(0, { type: 'smoke', entities: [thrower], x: 11500, y: 10000 })])
    expect(world.smokes.size).toBe(1)

    sim.drainEvents() // drop any auto-shot events from the placement tick
    const hpBefore = world.healths.require(target).hp
    fire(world, attacker, target, 13000, 10000, 10)

    expect(sim.drainEvents().some((e) => e.type === 'shot-missed')).toBe(true)
    expect(world.healths.require(target).hp).toBe(hpBefore)
  })

  it('a cloud does not force a miss when the miss chance is zero', () => {
    const sim = makeSim({ smokeMissChance: 0 })
    const { world } = sim
    const attacker = spawnUnit(world, 'rifleman', 0, 10000, 10000)
    const target = spawnUnit(world, 'rifleman', 1, 13000, 10000)
    const thrower = spawnUnit(world, 'rifleman', 0, 12000, 14000)

    sim.step([sim.makeCommand(0, { type: 'smoke', entities: [thrower], x: 11500, y: 10000 })])
    sim.drainEvents()
    const hpBefore = world.healths.require(target).hp
    fire(world, attacker, target, 13000, 10000, 10)

    const events = sim.drainEvents()
    expect(events.some((e) => e.type === 'shot-missed')).toBe(false)
    expect(world.healths.require(target).hp).toBeLessThan(hpBefore)
  })

  it('expires the cloud once the duration passes', () => {
    const sim = makeSim()
    const { world } = sim
    const thrower = spawnUnit(world, 'rifleman', 0, 10000, 10000)

    sim.step([sim.makeCommand(0, { type: 'smoke', entities: [thrower], x: 10500, y: 10000 })])
    expect(world.smokes.size).toBe(1)

    sim.advance(world.settings.smokeDurationTicks)
    expect(world.smokes.size).toBe(0)
  })
})

describe('stealth', () => {
  it('hides units until they fire, then reveals them briefly', () => {
    const sim = makeSim()
    const { world } = sim
    world.teamState(0).stealthTech = true
    const spy = spawnUnit(world, 'rifleman', 0, 10000, 10000)
    const victim = spawnUnit(world, 'rifleman', 1, 11500, 10000)
    const u = world.units.require(spy)
    expect(u.stealth).toBe(true)

    sim.step()
    expect(world.isVisibleTo(1, spy)).toBe(false)

    fire(world, spy, victim, 11500, 10000, 5)
    expect(u.revealedUntil).toBeGreaterThan(world.tick)
    expect(world.isVisibleTo(1, spy)).toBe(true)
  })

  it('keeps non-researched units visible once scouted', () => {
    const sim = makeSim()
    const { world } = sim
    const guard = spawnUnit(world, 'rifleman', 0, 10000, 10000)
    const u = world.units.require(guard)
    expect(u.stealth).toBe(false)
    spawnUnit(world, 'rifleman', 1, 9000, 10000) // gives team 1 vision of the guard's tile
    expect(world.isVisibleTo(1, guard)).toBe(false) // fogged until the scout's vision applies
    sim.step()
    expect(world.isVisibleTo(1, guard)).toBe(true)
  })
})

describe('detectors', () => {
  it('buys a detector on a finished building that reveals nearby stealth', () => {
    const sim = makeSim()
    const { world } = sim
    world.teamState(0).stealthTech = true
    const spy = spawnUnit(world, 'rifleman', 0, 10000, 10000)
    sim.step()
    expect(world.isVisibleTo(1, spy)).toBe(false)

    world.teamState(1).detectorUnlocked = true
    world.teamState(1).credits = 10000
    const building = spawnBuilding(world, 'tech-center', 1, 8, 10, true)
    const creditsBefore = world.teamState(1).credits

    sim.step([sim.makeCommand(1, { type: 'set-detector', entities: [building], x: 0, y: 0 })])

    expect(world.buildings.require(building).detector).toBe(true)
    expect(world.teamState(1).credits).toBe(creditsBefore - world.settings.detectorCost)
    expect(sim.drainEvents().some((e) => e.type === 'detector-bought')).toBe(true)
    expect(world.isVisibleTo(1, spy)).toBe(true)

    // The detector only covers its radius: a distant stealth unit stays hidden.
    const farSpy = spawnUnit(world, 'rifleman', 0, 30000, 30000)
    expect(world.isVisibleTo(1, farSpy)).toBe(false)
  })

  it('rejects the buy without the detector upgrade researched', () => {
    const sim = makeSim()
    const { world } = sim
    const building = spawnBuilding(world, 'tech-center', 1, 8, 10, true)

    sim.step([sim.makeCommand(1, { type: 'set-detector', entities: [building], x: 0, y: 0 })])

    expect(world.buildings.require(building).detector).toBe(false)
    expect(drainRejected(sim, 'detector upgrade not researched')).toBe(true)
  })
})

describe('abilities: lockstep determinism', () => {
  const runWithAbilities = (): Simulator => {
    const sim = makeSim()
    const { world } = sim
    const grenadier = spawnUnit(world, 'rifleman', 0, 10000, 10000)
    const smokeThrower = spawnUnit(world, 'rifleman', 0, 9500, 14000)
    spawnUnit(world, 'rifleman', 1, 12000, 10000)
    sim.step([sim.makeCommand(0, { type: 'grenade', entities: [grenadier], x: 12100, y: 10000 })])
    sim.advance(2)
    sim.step([sim.makeCommand(0, { type: 'smoke', entities: [smokeThrower], x: 11000, y: 10000 })])
    sim.advance(2)
    return sim
  }

  it('the new fields and effect sets are hashed', () => {
    const a = runWithAbilities()
    const b = runWithAbilities()
    expect(hashWorld(a.world)).toBe(hashWorld(b.world))

    const plain = (): Simulator => {
      const sim = makeSim()
      const { world } = sim
      spawnUnit(world, 'rifleman', 0, 10000, 10000)
      spawnUnit(world, 'rifleman', 0, 9500, 14000)
      spawnUnit(world, 'rifleman', 1, 12000, 10000)
      sim.advance(5)
      return sim
    }
    expect(hashWorld(b.world)).not.toBe(hashWorld(plain().world))
  })
})