import { describe, expect, it } from 'vitest'
import { createEmptyMap, DEFAULT_CREDITS, RANK_FLOORS, type MatchSettings } from '@space-arenas/shared'
import { Simulator } from '../client/src/core/Simulator.ts'
import { hashWorld } from '../client/src/core/hash.ts'
import { spawnUnit, spawnBuilding } from '../client/src/entities/factories.ts'
import type { SimEvent } from '../client/src/core/events.ts'

const MAP = createEmptyMap(64, 64)
const SEED = 0xc0da16

const makeSim = (settings?: Partial<MatchSettings>, players: number[] = [0, 1, 2]): Simulator =>
  new Simulator(MAP, SEED, players, settings)

/** Turn slots 0 and 1 into one co-op alliance and 2 (if present) into its own. */
const ally = (sim: Simulator, allianceId = 0): void => {
  sim.world.teams.get(0)!.alliance = allianceId
  sim.world.teams.get(1)!.alliance = allianceId
  if (sim.world.teams.has(2)) sim.world.teams.get(2)!.alliance = 2
}

const eventsOf = (sim: Simulator): SimEvent[] => sim.drainEvents()

describe('Day 16.1: shared supply bank', () => {
  it('pools starting credits into the canonical slot of the alliance', () => {
    const sim = makeSim({ coopEconomy: 'both' })
    ally(sim)
    sim.world.rewireSharedStartingCredits()
    expect(sim.world.teams.get(0)!.credits).toBe(DEFAULT_CREDITS * 2)
    expect(sim.world.teams.get(1)!.credits).toBe(0)
    expect(sim.world.creditsSlot(1)).toBe(0)
  })

  it('does not pool when supply sharing is off', () => {
    const sim = makeSim({ coopEconomy: 'power' })
    ally(sim)
    sim.world.rewireSharedStartingCredits()
    expect(sim.world.teams.get(0)!.credits).toBe(DEFAULT_CREDITS)
    expect(sim.world.teams.get(1)!.credits).toBe(DEFAULT_CREDITS)
    expect(sim.world.creditsSlot(1)).toBe(1)
  })

  it('routes income and spending through the shared bank', () => {
    const sim = makeSim({ coopEconomy: 'both' })
    ally(sim)
    sim.world.rewireSharedStartingCredits()
    sim.world.grantCredits(1, 250)
    expect(sim.world.creditsOf(0)).toBe(DEFAULT_CREDITS * 2 + 250)
    expect(sim.world.creditsOf(1)).toBe(DEFAULT_CREDITS * 2 + 250)
    expect(sim.world.spendCredits(1, 100)).toBe(true)
    expect(sim.world.creditsOf(0)).toBe(DEFAULT_CREDITS * 2 + 150)
    expect(sim.world.canAfford(1, DEFAULT_CREDITS * 4)).toBe(false)
    expect(sim.world.spendCredits(1, DEFAULT_CREDITS * 4)).toBe(false)
  })

  it('forfeit by a non-canonical member does not wipe the shared bank', () => {
    const sim = makeSim({ coopEconomy: 'both' })
    ally(sim)
    sim.world.rewireSharedStartingCredits()
    sim.step([sim.makeCommand(1, { type: 'forfeit', entities: [], x: 0, y: 0 })])
    expect(sim.world.teams.get(0)!.credits).toBe(DEFAULT_CREDITS * 2)
    const ev = eventsOf(sim)
    expect(ev.some((e) => e.type === 'player-left')).toBe(true)
  })
})

describe('Day 16.2: fused power grid', () => {
  const buildGrid = (sim: Simulator): void => {
    spawnBuilding(sim.world, 'command-center', 0, 10, 10, true)
    spawnBuilding(sim.world, 'power-plant', 0, 20, 2, true)
    spawnBuilding(sim.world, 'command-center', 1, 40, 10, true)
    spawnBuilding(sim.world, 'power-plant', 1, 50, 2, true)
  }

  it('writes identical fused totals into every alliance member', () => {
    const sim = makeSim({ coopEconomy: 'both' })
    ally(sim)
    buildGrid(sim)
    sim.step()
    const t0 = sim.world.teams.get(0)!
    const t1 = sim.world.teams.get(1)!
    expect(t0.powerGen).toBeGreaterThan(0)
    expect(t1.powerGen).toBe(t0.powerGen)
    expect(t1.powerUse).toBe(t0.powerUse)
    expect(t1.powerNet).toBe(t0.powerNet)
  })

  it('leaves single-alliance players on their own grid', () => {
    const sim = makeSim({ coopEconomy: 'both' })
    ally(sim)
    buildGrid(sim)
    spawnBuilding(sim.world, 'power-plant', 2, 5, 30, true)
    sim.step()
    const t2 = sim.world.teams.get(2)!
    const t0 = sim.world.teams.get(0)!
    expect(t2.powerGen).not.toBe(t0.powerGen)
  })

  it('keeps the grid deterministic', () => {
    const a = makeSim({ coopEconomy: 'both' })
    const b = makeSim({ coopEconomy: 'both' })
    ally(a)
    ally(b)
    spawnBuilding(a.world, 'power-plant', 0, 20, 2, true)
    spawnBuilding(b.world, 'power-plant', 0, 20, 2, true)
    spawnBuilding(a.world, 'power-plant', 1, 50, 2, true)
    spawnBuilding(b.world, 'power-plant', 1, 50, 2, true)
    a.step()
    b.step()
    expect(hashWorld(a.world)).toBe(hashWorld(b.world))
  })
})

describe('Day 16.3: combined rank ladder', () => {
  it('routes score and rank reads to the alliance slot', () => {
    const sim = makeSim({ coopRank: 'both' })
    ally(sim)
    sim.world.awardScore(1, 100)
    expect(sim.world.scoreOf(1)).toBe(100)
    expect(sim.world.scoreOf(0)).toBe(100)
    expect(sim.world.rankOf(0)).toBe(sim.world.rankOf(1))
  })

  it('keeps ladders separate when only the lobby declares sharing off', () => {
    const sim = makeSim({ coopRank: 'none' })
    ally(sim)
    sim.world.awardScore(1, 100)
    expect(sim.world.scoreOf(1)).toBe(100)
    expect(sim.world.scoreOf(0)).toBe(0)
  })

  it('pays the rank-up prize into the shared bank', () => {
    const sim = makeSim({ coopRank: 'both', coopEconomy: 'both' })
    ally(sim)
    sim.world.rewireSharedStartingCredits()
    const before = sim.world.creditsOf(0)
    sim.world.awardScore(1, RANK_FLOORS[0])
    expect(sim.world.rankOf(1)).toBe(1)
    expect(sim.world.creditsOf(0)).toBe(before + 100)
  })
})

describe('Day 16.5: alliance win-loss after partial quits', () => {
  const buildHomes = (sim: Simulator): void => {
    spawnBuilding(sim.world, 'command-center', 0, 10, 10, true)
    spawnBuilding(sim.world, 'command-center', 1, 40, 10, true)
    spawnBuilding(sim.world, 'command-center', 2, 90, 10, true)
  }

  it('does not end the match when one of two allied humans quits and enemies remain', () => {
    const sim = makeSim({}, [0, 1, 2])
    ally(sim)
    buildHomes(sim)
    sim.step([sim.makeCommand(1, { type: 'forfeit', entities: [], x: 0, y: 0 })])
    const ev = eventsOf(sim)
    expect(ev.some((e) => e.type === 'player-left')).toBe(true)
    expect(ev.some((e) => e.type === 'game-over')).toBe(false)
    expect(sim.world.gameOver).toBeNull()
  })

  it('ends the match only once the entire alliance is gone', () => {
    const sim = makeSim({}, [0, 1, 2])
    ally(sim)
    buildHomes(sim)
    sim.step([sim.makeCommand(0, { type: 'forfeit', entities: [], x: 0, y: 0 })])
    expect(sim.world.gameOver).toBeNull()
    sim.step([sim.makeCommand(1, { type: 'forfeit', entities: [], x: 0, y: 0 })])
    const ev = eventsOf(sim)
    expect(ev.some((e) => e.type === 'game-over')).toBe(true)
    expect(sim.world.gameOver).toBe(2)
  })
})

describe('Day 16.4: control sharing', () => {
  const setup = (sim: Simulator): void => {
    ally(sim)
    spawnUnit(sim.world, 'rifleman', 0, 10000, 10000)
    spawnUnit(sim.world, 'rifleman', 1, 11000, 10000)
    spawnBuilding(sim.world, 'barracks', 1, 20, 20, true)
  }

  it('units-only: allies may command ally units but not ally buildings', () => {
    const sim = makeSim({ coopControl: 'units' })
    setup(sim)
    const allyUnit = sim.world.units.idsArray().find((id) => sim.world.units.get(id)!.team === 1)!
    const allyBuilding = sim.world.buildings.idsArray().find((id) => sim.world.buildings.get(id)!.team === 1)!
    expect(sim.world.canControl(0, allyUnit)).toBe(true)
    expect(sim.world.canControl(0, allyBuilding)).toBe(false)
  })

  it('all: allies may command ally buildings too', () => {
    const sim = makeSim({ coopControl: 'all' })
    setup(sim)
    const allyUnit = sim.world.units.idsArray().find((id) => sim.world.units.get(id)!.team === 1)!
    const allyBuilding = sim.world.buildings.idsArray().find((id) => sim.world.buildings.get(id)!.team === 1)!
    expect(sim.world.canControl(0, allyUnit)).toBe(true)
    expect(sim.world.canControl(0, allyBuilding)).toBe(true)
  })

  it('none: allies get nothing when the lobby leaves control sharing off', () => {
    const sim = makeSim({ coopControl: 'none' })
    setup(sim)
    const allyUnit = sim.world.units.idsArray().find((id) => sim.world.units.get(id)!.team === 1)!
    expect(sim.world.canControl(0, allyUnit)).toBe(false)
    expect(sim.world.controlLevel(0)).toBe('none')
  })
})