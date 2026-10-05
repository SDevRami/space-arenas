import { describe, expect, it } from 'vitest'
import { createEmptyMap, SECONDS_TO_TICKS, type MatchSettings } from '@space-arenas/shared'
import { Simulator } from '../client/src/core/Simulator.ts'
import { hashWorld } from '../client/src/core/hash.ts'
import { spawnBuilding, spawnUnit } from '../client/src/entities/factories.ts'

const MAP = (() => {
  const m = createEmptyMap(64, 64)
  m.supplyFields.push({ x: 32, y: 32, radius: 3, capacity: 48 })
  return m
})()

const SEED = 0xbeef2200
const CLAIM_TICKS = SECONDS_TO_TICKS(20)
const HOLD_TICKS = SECONDS_TO_TICKS(10)

const makeSim = (settings?: Partial<MatchSettings>): Simulator => new Simulator(MAP, SEED, [0, 1], settings)

const findField = (world: Simulator['world']): number => {
  let found = -1
  world.fields.forEach((id) => {
    if (found < 0) found = id
  })
  return found
}

/** Puts a capturer's supply dock + harvester already waiting at the dock pad,
 *  so the next tick banks `supplyPerTrip` (+ bonus when captured by `team`). */
const readyToUnload = (sim: Simulator, team: number, field: number, dockX = 28, dockY = 28): number => {
  const { world } = sim
  const dock = spawnBuilding(world, 'supply-dock', team, dockX, dockY, true)
  const hv = spawnUnit(world, 'harvester', team, dockX * 1000 + 500, dockY * 1000 + 500)
  world.harvesters.set(hv, { phase: 'to-dock', field, dock, loadTicks: 0 })
  return hv
}

describe('Day 22: supply field capture bonus', () => {
  it('fields start neutral (no team holds the bonus)', () => {
    const sim = makeSim()
    expect(sim.world.fields.require(findField(sim.world)).capturer).toBe(-1)
  })

  it('a scout near a field captures it for its team after the claim time', () => {
    const sim = makeSim()
    const { world } = sim
    const field = findField(world)
    spawnUnit(world, 'scout', 0, 32500, 32500)

    sim.advance(CLAIM_TICKS + 1)

    expect(world.fields.require(field).capturer).toBe(0)
    expect(sim.drainEvents().some((e) => e.type === 'supply-captured' && e.team === 0)).toBe(true)
  })

  it('capture is not exclusive: enemies still harvest base supply without the bonus', () => {
    const sim = makeSim()
    const { world } = sim
    const field = findField(world)
    spawnUnit(world, 'scout', 0, 32500, 32500)
    sim.advance(CLAIM_TICKS + 1)
    sim.drainEvents()

    readyToUnload(sim, 1, field)
    const before = world.teamState(1).credits
    sim.advance(5)

    expect(world.teamState(1).credits).toBe(before + world.settings.supplyPerTrip)
    const event = sim.drainEvents().find((e) => e.type === 'supply-harvested')
    expect(event).toBeDefined()
    if (event && event.type === 'supply-harvested') {
      expect(event.amount).toBe(world.settings.supplyPerTrip)
      expect(event.bonus).toBe(0)
    }
  })

  it('the capturing team banks supply plus the bonus percent on unload', () => {
    const sim = makeSim()
    const { world } = sim
    const field = findField(world)
    spawnUnit(world, 'scout', 0, 32500, 32500)
    sim.advance(CLAIM_TICKS + 1)
    sim.drainEvents()

    readyToUnload(sim, 0, field)
    const before = world.teamState(0).credits
    const bonusPct = world.settings.supplyFieldBonus
    const expectedAmount = world.settings.supplyPerTrip + Math.round((world.settings.supplyPerTrip * bonusPct) / 100)
    sim.advance(5)

    expect(world.teamState(0).credits).toBe(before + expectedAmount)
    const event = sim.drainEvents().find((e) => e.type === 'supply-harvested')
    expect(event).toBeDefined()
    if (event && event.type === 'supply-harvested') {
      expect(event.amount).toBe(expectedAmount)
      expect(event.bonus).toBe(event.amount - world.settings.supplyPerTrip)
      expect(event.bonus).toBeGreaterThan(0)
    }
  })

  it('the bonus drops off after the scout leaves and the hold grace elapses', () => {
    const sim = makeSim()
    const { world } = sim
    const field = findField(world)
    const scout = spawnUnit(world, 'scout', 0, 32500, 32500)
    sim.advance(CLAIM_TICKS + 1)
    expect(world.fields.require(field).capturer).toBe(0)

    world.removeEntity(scout)
    sim.advance(HOLD_TICKS + 1)

    expect(world.fields.require(field).capturer).toBe(-1)
    expect(sim.drainEvents().some((e) => e.type === 'supply-captured-lost' && e.team === 0)).toBe(true)
  })

  it('a better-positioned rival scout flips a captured field directly', () => {
    const sim = makeSim()
    const { world } = sim
    const field = findField(world)
    const scout0 = spawnUnit(world, 'scout', 0, 33000, 32500)
    sim.advance(CLAIM_TICKS + 1)
    expect(world.fields.require(field).capturer).toBe(0)

    world.removeEntity(scout0)
    spawnUnit(world, 'scout', 1, 32000, 32500)
    sim.advance(CLAIM_TICKS + 1)

    expect(world.fields.require(field).capturer).toBe(1)
    expect(sim.drainEvents().some((e) => e.type === 'supply-captured' && e.team === 1)).toBe(true)
  })

  it('a 0% bonus still captures but pays only the base amount', () => {
    const sim = makeSim({ supplyFieldBonus: 0 })
    const { world } = sim
    const field = findField(world)
    spawnUnit(world, 'scout', 0, 32500, 32500)
    sim.advance(CLAIM_TICKS + 1)
    expect(world.fields.require(field).capturer).toBe(0)
    sim.drainEvents()

    readyToUnload(sim, 0, field)
    const before = world.teamState(0).credits
    sim.advance(5)

    expect(world.teamState(0).credits).toBe(before + world.settings.supplyPerTrip)
    const event = sim.drainEvents().find((e) => e.type === 'supply-harvested')
    if (event && event.type === 'supply-harvested') expect(event.bonus).toBe(0)
  })

  it('capture + bonus trips are deterministic across identical simulations', () => {
    const run = (): number => {
      const sim = makeSim()
      const { world } = sim
      const field = findField(world)
      spawnUnit(world, 'scout', 0, 33000, 32500)
      readyToUnload(sim, 0, field)
      sim.advance(CLAIM_TICKS + 2)
      sim.advance(6)
      return hashWorld(world)
    }
    expect(run()).toBe(run())
  })
})