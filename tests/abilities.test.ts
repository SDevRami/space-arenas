import { describe, expect, it } from 'vitest'
import { createEmptyMap, tileToFx, GRENADE_BLAST_RADIUS, SMOKE_RADIUS, DEFAULT_MATCH_SETTINGS, type MatchSettings } from '@space-arenas/shared'
import { Simulator } from '../client/src/core/Simulator.ts'
import { hashWorld } from '../client/src/core/hash.ts'
import { spawnBuilding, spawnUnit } from '../client/src/entities/factories.ts'
import { fire, smokeRadiusAt } from '../client/src/systems/combat-system.ts'

const MAP = createEmptyMap(64, 64)
const SEED = 0xc0ffee

const makeSim = (settings?: Partial<MatchSettings>): Simulator => new Simulator(MAP, SEED, [0, 1], settings)

const drainRejected = (sim: Simulator, reason: string): boolean =>
  sim.drainEvents().some((e) => e.type === 'command-rejected' && e.reason === reason)

describe('grenade throw', () => {
  it('lands a grenade that explodes after the fuse and damages the blast area', () => {
    const sim = makeSim()
    const { world } = sim
    // unarmed thrower (scout carries no weapon) so only the grenade damages the blast area
    const thrower = spawnUnit(world, 'scout', 0, 10000, 10000)
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
    // The enemy standing in the blast radius takes the full grenade damage.
    expect(world.healths.require(near).hp).toBe(beforeNear - world.settings.grenadeDamage)
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

describe('ability eligibility', () => {
  it('rejects a grenade throw from a bulldozer', () => {
    const sim = makeSim()
    const { world } = sim
    const dozer = spawnUnit(world, 'bulldozer', 0, 10000, 10000)

    sim.step([sim.makeCommand(0, { type: 'grenade', entities: [dozer], x: 10500, y: 10000 })])

    expect(drainRejected(sim, 'unit cannot use ability')).toBe(true)
    expect(world.grenades.size).toBe(0)
    expect(world.units.require(dozer).abilityCooldown).toBe(0)
  })

  it('rejects a smoke throw from a bulldozer', () => {
    const sim = makeSim()
    const { world } = sim
    const dozer = spawnUnit(world, 'bulldozer', 0, 10000, 10000)

    sim.step([sim.makeCommand(0, { type: 'smoke', entities: [dozer], x: 10500, y: 10000 })])

    expect(drainRejected(sim, 'unit cannot use ability')).toBe(true)
    expect(world.smokes.size).toBe(0)
  })

  it('rejects a grenade throw from an air unit', () => {
    const sim = makeSim()
    const { world } = sim
    const fighter = spawnUnit(world, 'fighter', 0, 10000, 10000)

    sim.step([sim.makeCommand(0, { type: 'grenade', entities: [fighter], x: 10500, y: 10000 })])

    expect(drainRejected(sim, 'unit cannot use ability')).toBe(true)
    expect(world.grenades.size).toBe(0)
  })

  it('rejects a smoke throw from an air unit', () => {
    const sim = makeSim()
    const { world } = sim
    const fighter = spawnUnit(world, 'fighter', 0, 10000, 10000)

    sim.step([sim.makeCommand(0, { type: 'smoke', entities: [fighter], x: 10500, y: 10000 })])

    expect(drainRejected(sim, 'unit cannot use ability')).toBe(true)
    expect(world.smokes.size).toBe(0)
  })
})

describe('smoke throw', () => {
  // Attacker and target sit outside rifle range (6 cells) so the manual fire()
  // calls below are the only shots — auto-fire during sim.advance would damage
  // the target before we compare HP. The cloud always lands on the shot line.
  const LINE = { attacker: 9000, target: 15200, cloud: 12100, y: 10000 }

  it('throws the canister first, and only a landed cloud blocks shots', () => {
    const sim = makeSim({ smokeMissChance: 1 })
    const { world } = sim
    const attacker = spawnUnit(world, 'rifleman', 0, LINE.attacker, LINE.y)
    const target = spawnUnit(world, 'rifleman', 1, LINE.target, LINE.y)
    const thrower = spawnUnit(world, 'rifleman', 0, 11000, 14000)

    // Right after the throw the canister is still arcing: no cloud yet, and a
    // shot right through the landing point goes through untouched.
    sim.step([sim.makeCommand(0, { type: 'smoke', entities: [thrower], x: LINE.cloud, y: LINE.y })])
    expect(world.smokes.size).toBe(1)
    const hpInFlight = world.healths.require(target).hp
    fire(world, attacker, target, LINE.target, LINE.y, 10)
    expect(sim.drainEvents().some((e) => e.type === 'shot-missed')).toBe(false)
    expect(world.healths.require(target).hp).toBe(hpInFlight - 10)

    // Once the canister lands and billows out, the same line is blocked.
    sim.advance(world.settings.grenadeFuseTicks)
    sim.drainEvents()
    const hpBefore = world.healths.require(target).hp
    fire(world, attacker, target, LINE.target, LINE.y, 10)
    expect(sim.drainEvents().some((e) => e.type === 'shot-missed')).toBe(true)
    expect(world.healths.require(target).hp).toBe(hpBefore)
  })

  it('lets a landed cloud make shots through it miss', () => {
    const sim = makeSim({ smokeMissChance: 1 })
    const { world } = sim
    const attacker = spawnUnit(world, 'rifleman', 0, LINE.attacker, LINE.y)
    const target = spawnUnit(world, 'rifleman', 1, LINE.target, LINE.y)
    const thrower = spawnUnit(world, 'rifleman', 0, 11000, 14000)

    sim.step([sim.makeCommand(0, { type: 'smoke', entities: [thrower], x: LINE.cloud, y: LINE.y })])
    expect(world.smokes.size).toBe(1)
    sim.advance(world.settings.grenadeFuseTicks)
    sim.drainEvents()
    const hpBefore = world.healths.require(target).hp
    fire(world, attacker, target, LINE.target, LINE.y, 10)

    expect(sim.drainEvents().some((e) => e.type === 'shot-missed')).toBe(true)
    expect(world.healths.require(target).hp).toBe(hpBefore)
  })

  it('a cloud does not force a miss when the miss chance is zero', () => {
    const sim = makeSim({ smokeMissChance: 0 })
    const { world } = sim
    const attacker = spawnUnit(world, 'rifleman', 0, LINE.attacker, LINE.y)
    const target = spawnUnit(world, 'rifleman', 1, LINE.target, LINE.y)
    const thrower = spawnUnit(world, 'rifleman', 0, 11000, 14000)

    sim.step([sim.makeCommand(0, { type: 'smoke', entities: [thrower], x: LINE.cloud, y: LINE.y })])
    sim.advance(world.settings.grenadeFuseTicks)
    sim.drainEvents()
    const hpBefore = world.healths.require(target).hp
    fire(world, attacker, target, LINE.target, LINE.y, 10)

    const events = sim.drainEvents()
    expect(events.some((e) => e.type === 'shot-missed')).toBe(false)
    expect(world.healths.require(target).hp).toBeLessThan(hpBefore)
  })

  it('billows out after landing and shrinks as it fades', () => {
    const sim = makeSim()
    const { world } = sim
    const thrower = spawnUnit(world, 'rifleman', 0, 10000, 10000)

    sim.step([sim.makeCommand(0, { type: 'smoke', entities: [thrower], x: 10500, y: 10000 })])
    let sid = -1
    world.smokes.forEach((id) => {
      sid = id
    })
    const s = world.smokes.require(sid)

    // Thrown like a grenade: lands after the grenade fuse, then lasts the
    // smoke-duration window from that landing point.
    expect(s.fromX).toBe(10000)
    expect(s.fromY).toBe(10000)
    expect(s.landTick - s.startTick).toBe(world.settings.grenadeFuseTicks)
    expect(s.untilTick - s.landTick).toBe(world.settings.smokeDurationTicks)

    // In flight: no cloud at all.
    expect(smokeRadiusAt(world.tick, s)).toBe(0)

    // Shortly after landing it has begun to fill out but hasn't peaked.
    sim.advance(world.settings.grenadeFuseTicks)
    expect(smokeRadiusAt(world.tick, s)).toBeGreaterThan(0)
    expect(smokeRadiusAt(world.tick, s)).toBeLessThan(s.radius)

    // After the full grow-in window the cloud is at its full radius.
    sim.advance(Math.ceil(world.settings.smokeDurationTicks * 0.25))
    expect(smokeRadiusAt(world.tick, s)).toBeCloseTo(s.radius, 5)

    // As it fades near expiry the radius collapses back toward zero.
    sim.advance(world.settings.smokeDurationTicks - Math.ceil(world.settings.smokeDurationTicks * 0.25) - 2)
    expect(smokeRadiusAt(world.tick, s)).toBeGreaterThan(0)
    expect(smokeRadiusAt(world.tick, s)).toBeLessThan(s.radius)
    expect(smokeRadiusAt(s.untilTick, s)).toBe(0)
  })

  it('expires the cloud once the duration passes', () => {
    const sim = makeSim()
    const { world } = sim
    const thrower = spawnUnit(world, 'rifleman', 0, 10000, 10000)

    sim.step([sim.makeCommand(0, { type: 'smoke', entities: [thrower], x: 10500, y: 10000 })])
    expect(world.smokes.size).toBe(1)

    sim.advance(world.settings.grenadeFuseTicks + world.settings.smokeDurationTicks)
    expect(world.smokes.size).toBe(0)
  })

  it('the smoke cloud radius is 1.5x the grenade blast radius by default', () => {
    expect(SMOKE_RADIUS).toBe(GRENADE_BLAST_RADIUS * 1.5)
    expect(DEFAULT_MATCH_SETTINGS.smokeRadius).toBe(SMOKE_RADIUS)
  })
})

describe('stealth', () => {
  it('hides a purchased-stealth unit until it fires, then reveals it briefly', () => {
    const sim = makeSim()
    const { world } = sim
    world.teamState(0).stealthTech = true
    world.teamState(0).credits = 100000
    const spy = spawnUnit(world, 'rifleman', 0, 10000, 10000)
    const victim = spawnUnit(world, 'rifleman', 1, 11500, 10000)
    const u = world.units.require(spy)
    expect(u.stealth).toBe(false)

    sim.step([sim.makeCommand(0, { type: 'set-stealth', entities: [spy], x: 0, y: 0 })])
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

  it('buys stealth per-unit for infantry and vehicles, deducting the cost', () => {
    const sim = makeSim()
    const { world } = sim
    world.teamState(0).stealthTech = true
    world.teamState(0).credits = 10000
    const infantry = spawnUnit(world, 'rifleman', 0, 10000, 10000)
    const vehicle = spawnUnit(world, 'bulldozer', 0, 11000, 10000)
    const creditsBefore = world.teamState(0).credits

    sim.step([sim.makeCommand(0, { type: 'set-stealth', entities: [infantry, vehicle], x: 0, y: 0 })])

    expect(world.units.require(infantry).stealth).toBe(true)
    expect(world.units.require(vehicle).stealth).toBe(true)
    expect(world.teamState(0).credits).toBe(creditsBefore - 2 * world.settings.stealthCost)
    expect(sim.drainEvents().some((e) => e.type === 'stealth-bought')).toBe(true)
  })

  it('rejects the buy without the stealth-tech research', () => {
    const sim = makeSim()
    const { world } = sim
    world.teamState(0).credits = 10000
    const infantry = spawnUnit(world, 'rifleman', 0, 10000, 10000)

    sim.step([sim.makeCommand(0, { type: 'set-stealth', entities: [infantry], x: 0, y: 0 })])

    expect(world.units.require(infantry).stealth).toBe(false)
    expect(drainRejected(sim, 'stealth upgrade not researched')).toBe(true)
  })

  it('rejects the buy on air units', () => {
    const sim = makeSim()
    const { world } = sim
    world.teamState(0).stealthTech = true
    world.teamState(0).credits = 10000
    const fighter = spawnUnit(world, 'fighter', 0, 10000, 10000)

    sim.step([sim.makeCommand(0, { type: 'set-stealth', entities: [fighter], x: 0, y: 0 })])

    expect(world.units.require(fighter).stealth).toBe(false)
    expect(drainRejected(sim, 'cannot stealth this unit')).toBe(true)
  })

  it('rejects the buy without enough credits', () => {
    const sim = makeSim()
    const { world } = sim
    world.teamState(0).stealthTech = true
    world.teamState(0).credits = 0
    const infantry = spawnUnit(world, 'rifleman', 0, 10000, 10000)

    sim.step([sim.makeCommand(0, { type: 'set-stealth', entities: [infantry], x: 0, y: 0 })])

    expect(world.units.require(infantry).stealth).toBe(false)
    expect(drainRejected(sim, 'insufficient credits')).toBe(true)
  })

  it('rejects a second buy on an already-stealthed unit', () => {
    const sim = makeSim()
    const { world } = sim
    world.teamState(0).stealthTech = true
    world.teamState(0).credits = 10000
    const infantry = spawnUnit(world, 'rifleman', 0, 10000, 10000)

    sim.step([sim.makeCommand(0, { type: 'set-stealth', entities: [infantry], x: 0, y: 0 })])
    expect(world.units.require(infantry).stealth).toBe(true)
    sim.drainEvents()
    const creditsAfter = world.teamState(0).credits

    sim.step([sim.makeCommand(0, { type: 'set-stealth', entities: [infantry], x: 0, y: 0 })])

    expect(world.teamState(0).credits).toBe(creditsAfter)
    expect(drainRejected(sim, 'unit already stealthed')).toBe(true)
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