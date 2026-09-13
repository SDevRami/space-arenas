import { describe, expect, it } from 'vitest'
import { createEmptyMap, AIRSTRIKE_PLANES, EMP_RADIUS_TILES, EMP_DURATION_TICKS, type MatchSettings } from '@space-arenas/shared'
import { Simulator } from '../client/src/core/Simulator.ts'
import { hashWorld } from '../client/src/core/hash.ts'
import { spawnBuilding, spawnUnit, setMove } from '../client/src/entities/factories.ts'
import { fire } from '../client/src/systems/combat-system.ts'

const MAP = createEmptyMap(64, 64)
const SEED = 0xabcdef

const makeSim = (settings?: Partial<MatchSettings>): Simulator => new Simulator(MAP, SEED, [0, 1], settings)

const arm = (sim: Simulator, team: number, choice: 'laser' | 'airstrike' | 'emp'): void => {
  sim.step([sim.makeCommand(team, { type: 'sw-choose', entities: [], x: 0, y: 0, choice })])
}

const powerTeam0 = (sim: Simulator): void => {
  spawnBuilding(sim.world, 'command-center', 0, 10, 10, true)
  spawnBuilding(sim.world, 'power-plant', 0, 30, 2, true)
  spawnBuilding(sim.world, 'power-plant', 0, 33, 2, true)
  spawnBuilding(sim.world, 'power-plant', 0, 36, 2, true)
}

describe('Day 13.1: Super Weapon choice', () => {
  it('rejects sw-choose before a Super Weapon exists', () => {
    const sim = makeSim()
    const { world } = sim
    arm(sim, 0, 'emp')
    const events = sim.drainEvents()
    expect(events.some((e) => e.type === 'command-rejected' && e.reason === 'super weapon destroyed')).toBe(true)
    expect(world.teamState(0).swChoice).toBeNull()
  })

  it('arms the chosen strike once, emits sw-chosen, and rejects a second pick', () => {
    const sim = makeSim()
    const { world } = sim
    spawnBuilding(world, 'super-weapon', 0, 20, 3, true)

    arm(sim, 0, 'emp')
    const first = sim.drainEvents()
    expect(first.some((e) => e.type === 'sw-chosen' && e.team === 0 && e.choice === 'emp')).toBe(true)
    expect(world.swChoiceOf(0)).toBe('emp')

    arm(sim, 0, 'airstrike')
    const second = sim.drainEvents()
    expect(second.some((e) => e.type === 'command-rejected' && e.reason === 'super weapon already armed')).toBe(true)
    expect(world.swChoiceOf(0)).toBe('emp')
  })

  it('rejects a malformed choice payload', () => {
    const sim = makeSim()
    const { world } = sim
    spawnBuilding(world, 'super-weapon', 0, 20, 3, true)
    sim.step([sim.makeCommand(0, { type: 'sw-choose', entities: [], x: 0, y: 0 } as never)])
    const events = sim.drainEvents()
    expect(events.some((e) => e.type === 'command-rejected' && e.reason === 'invalid strike choice')).toBe(true)
    expect(world.swChoiceOf(0)).toBeNull()
  })
})

describe('Day 13.2: Airstrike', () => {
  it('requires the airstrike to be armed, then spawns the squadron and applies the global cooldown', () => {
    const sim = makeSim()
    const { world } = sim
    powerTeam0(sim)
    spawnBuilding(world, 'super-weapon', 0, 20, 3, true)

    sim.step([sim.makeCommand(0, { type: 'sw-airstrike', entities: [], x: 20, y: 10 })])
    const unarmed = sim.drainEvents()
    expect(unarmed.some((e) => e.type === 'command-rejected' && e.reason.includes('airstrike not armed'))).toBe(true)
    expect(world.airstrikes.size).toBe(0)

    arm(sim, 0, 'airstrike')
    sim.drainEvents()
    sim.step([sim.makeCommand(0, { type: 'sw-airstrike', entities: [], x: 20, y: 10 })])
    const called = sim.drainEvents()
    expect(called.some((e) => e.type === 'airstrike-called' && e.x === 20500 && e.y === 10500)).toBe(true)
    expect(world.airstrikes.size).toBe(AIRSTRIKE_PLANES)
    expect(world.teamState(0).airstrikeLastUsed).toBe(world.tick - 1)

    sim.step([sim.makeCommand(0, { type: 'sw-airstrike', entities: [], x: 20, y: 10 })])
    const again = sim.drainEvents()
    expect(again.some((e) => e.type === 'command-rejected' && e.reason === 'airstrike on cooldown')).toBe(true)
  })

  it('flies the planes in and bombs the target area, damaging enemies there', () => {
    const sim = makeSim()
    const { world } = sim
    powerTeam0(sim)
    spawnBuilding(world, 'super-weapon', 0, 20, 3, true)
    spawnUnit(world, 'rifleman', 1, 20500, 10500)
    spawnUnit(world, 'rifleman', 1, 19000, 11000)

    arm(sim, 0, 'airstrike')
    sim.drainEvents()
    sim.step([sim.makeCommand(0, { type: 'sw-airstrike', entities: [], x: 20, y: 10 })])
    const atStart = sim.drainEvents()
    expect(atStart.some((e) => e.type === 'airstrike-called')).toBe(true)
    expect(world.airstrikes.size).toBe(AIRSTRIKE_PLANES)

    sim.advance(AIRSTRIKE_PLANES * 8 + 60)
    const bombs = sim.drainEvents()
    expect(bombs.filter((e) => e.type === 'airstrike-bomb')).toHaveLength(AIRSTRIKE_PLANES)
    expect(world.airstrikes.size).toBe(0)

    let damaged = 0
    for (const id of [1, 2]) {
      if (!world.units.has(id)) {
        damaged++
        continue
      }
      const h = world.healths.get(id)
      if (h && h.hp < h.maxHp) damaged++
    }
    expect(damaged).toBeGreaterThan(0)
  })

  it('round-trips the choice field through the command log', () => {
    const sim = makeSim()
    const env = sim.makeCommand(0, { type: 'sw-choose', entities: [], x: 0, y: 0, choice: 'airstrike' })
    expect(env.cmd.choice).toBe('airstrike')
  })
})

describe('Day 13.3: EMP strike', () => {
  it('requires the EMP to be armed, then creates a pulse of the right radius and applies the cooldown', () => {
    const sim = makeSim()
    const { world } = sim
    powerTeam0(sim)
    spawnBuilding(world, 'super-weapon', 0, 20, 3, true)

    sim.step([sim.makeCommand(0, { type: 'sw-emp', entities: [], x: 20, y: 10 })])
    const unarmed = sim.drainEvents()
    expect(unarmed.some((e) => e.type === 'command-rejected' && e.reason.includes('emp not armed'))).toBe(true)

    arm(sim, 0, 'emp')
    sim.drainEvents()
    sim.step([sim.makeCommand(0, { type: 'sw-emp', entities: [], x: 20, y: 10 })])
    const strike = sim.drainEvents()
    expect(strike.some((e) => e.type === 'emp-strike' && e.radius === EMP_RADIUS_TILES && e.x === 20500)).toBe(true)
    expect(world.empPulses.size).toBe(1)
    expect(world.empCooldownRemaining(0)).toBeGreaterThan(0)

    sim.step([sim.makeCommand(0, { type: 'sw-emp', entities: [], x: 20, y: 10 })])
    const again = sim.drainEvents()
    expect(again.some((e) => e.type === 'command-rejected' && e.reason === 'emp on cooldown')).toBe(true)
  })

  it('stuns enemy units and done buildings in range without dealing damage, for the full duration', () => {
    const sim = makeSim()
    const { world } = sim
    powerTeam0(sim)
    spawnBuilding(world, 'super-weapon', 0, 20, 3, true)
    const barracks = spawnBuilding(world, 'barracks', 1, 24, 10, true)
    const inRange = spawnUnit(world, 'rifleman', 1, 20500, 10500)
    const nearEdge = spawnUnit(world, 'rifleman', 1, 20500, 11500)
    const far = spawnUnit(world, 'rifleman', 1, 30500, 10500)

    arm(sim, 0, 'emp')
    sim.drainEvents()
    const hIn = world.healths.require(inRange).hp
    const hEdge = world.healths.require(nearEdge).hp
    const hFar = world.healths.require(far).hp

    sim.step([sim.makeCommand(0, { type: 'sw-emp', entities: [], x: 20, y: 10 })])
    sim.advance(1)

    expect(world.empStunned(inRange)).toBe(true)
    expect(world.empStunned(barracks)).toBe(true)
    expect(world.empStunned(nearEdge)).toBe(true)
    expect(world.empStunned(far)).toBe(false)

    expect(world.healths.require(inRange).hp).toBe(hIn)
    expect(world.healths.require(nearEdge).hp).toBe(hEdge)
    expect(world.healths.require(far).hp).toBe(hFar)
    expect(world.buildings.require(barracks).empUntil).toBeGreaterThan(world.tick)

    sim.advance(EMP_DURATION_TICKS - 3)
    expect(world.empStunned(inRange)).toBe(true)
    sim.advance(1)
    expect(world.empStunned(inRange)).toBe(false)
  })

  it('gates combat, movement, and production while stunned', () => {
    const sim = makeSim()
    const { world } = sim
    powerTeam0(sim)
    spawnBuilding(world, 'super-weapon', 0, 20, 3, true)
    const mover = spawnUnit(world, 'rifleman', 1, 10500, 10500)
    const victim = spawnUnit(world, 'rifleman', 0, 30500, 10500)
    setMove(world, mover, 20500, 20500)
    const hpBefore = world.healths.require(victim).hp

    arm(sim, 0, 'emp')
    sim.drainEvents()
    sim.step([sim.makeCommand(0, { type: 'sw-emp', entities: [], x: 10, y: 10 })])
    sim.advance(1)

    expect(world.empStunned(mover)).toBe(true)
    expect(world.moves.has(mover)).toBe(false)
    const t = world.transforms.require(mover)
    const sx = t.x
    const sy = t.y

    sim.advance(3)
    sim.drainEvents()
    expect(world.transforms.require(mover).x).toBe(sx)
    expect(world.transforms.require(mover).y).toBe(sy)

    fire(world, mover, victim, 30500, 10500, 12, 0)
    const combat = sim.drainEvents()
    expect(combat.some((e) => e.type === 'combat-hit')).toBe(false)
    expect(world.healths.require(victim).hp).toBe(hpBefore)
  })

  it('freezes a producing building while stunned and resumes afterwards', () => {
    const sim = makeSim()
    const { world } = sim
    powerTeam0(sim)
    spawnBuilding(world, 'super-weapon', 0, 20, 3, true)
    const barracks = spawnBuilding(world, 'barracks', 0, 24, 24, true)
    sim.step([sim.makeCommand(0, { type: 'queue', entities: [barracks], x: 0, y: 0, unitType: 'rifleman' })])
    sim.drainEvents()
    const q0 = world.queues.require(barracks).queue[0]
    expect(q0).toBeDefined()

    world.buildings.require(barracks).empUntil = world.tick + 40
    const frozen = q0.remainingTicks
    sim.advance(10)
    expect(q0.remainingTicks).toBe(frozen)
    expect(world.queues.require(barracks).queue.length).toBe(1)

    world.buildings.require(barracks).empUntil = 0
    sim.advance(10)
    expect(q0.remainingTicks).toBeLessThan(frozen)
  })
})

describe('Day 13.4: Determinism', () => {
  it('hashes identically across two runs performing the same SW commands', () => {
    const run = (): number => {
      const sim = makeSim()
      const { world } = sim
      powerTeam0(sim)
      spawnBuilding(world, 'super-weapon', 0, 20, 3, true)
      arm(sim, 0, 'emp')
      sim.drainEvents()
      sim.step([sim.makeCommand(0, { type: 'sw-emp', entities: [], x: 20, y: 10 })])
      sim.advance(30)
      return hashWorld(world)
    }
    expect(run()).toBe(run())
  })
})