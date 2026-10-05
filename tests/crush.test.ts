import { describe, expect, it } from 'vitest'
import { createEmptyMap, type MatchSettings } from '@space-arenas/shared'
import { Simulator } from '../client/src/core/Simulator.ts'
import { spawnUnit } from '../client/src/entities/factories.ts'

const MAP = createEmptyMap(64, 64)
const SEED = 0xdeadbeef

const makeSim = (settings?: Partial<MatchSettings>): Simulator => new Simulator(MAP, SEED, [0, 1], settings)

// Units placed on the (10, 10) tile.
const vehicleAt = (sim: Simulator, type: string, team: number): number => spawnUnit(sim.world, type, team, 10200, 10200)
const troopAt = (sim: Simulator, type: string, team: number): number => spawnUnit(sim.world, type, team, 10400, 10400)

describe('vehicle run-over', () => {
  it('crushes once when a vehicle first steps onto an enemy troop tile', () => {
    const sim = makeSim()
    const { world } = sim
    vehicleAt(sim, 'engineer', 0)
    const victim = troopAt(sim, 'scout', 1)
    const before = world.healths.require(victim).hp

    sim.advance(2)

    // Entry crush lands once; a parked vehicle doesn't keep grinding.
    expect(world.healths.require(victim).hp).toBe(before - world.settings.crushDamage)
  })

  it('crushes each fresh pair it makes contact with', () => {
    const sim = makeSim()
    const { world } = sim
    vehicleAt(sim, 'engineer', 0)
    const victim = troopAt(sim, 'scout', 1)
    const before = world.healths.require(victim).hp

    sim.advance(2)
    expect(world.healths.require(victim).hp).toBe(before - world.settings.crushDamage)

    // A second troop entering the same tile forms a new pair and is crushed too.
    world.removeEntity(victim)
    const victim2 = troopAt(sim, 'scout', 1)
    const before2 = world.healths.require(victim2).hp

    sim.advance(1)

    expect(world.healths.require(victim2).hp).toBe(before2 - world.settings.crushDamage)
  })

  it('never crushes friendly troops', () => {
    const sim = makeSim()
    const { world } = sim
    vehicleAt(sim, 'engineer', 0)
    const ally = troopAt(sim, 'scout', 0)
    const before = world.healths.require(ally).hp

    sim.advance(2)

    expect(world.healths.require(ally).hp).toBe(before)
  })

  it('does not crush from the air', () => {
    const sim = makeSim()
    const { world } = sim
    const fighter = spawnUnit(world, 'fighter', 1, 10200, 10200)
    const victim = troopAt(sim, 'scout', 0)
    const before = world.healths.require(victim).hp

    sim.advance(2)

    expect(world.healths.require(victim).hp).toBe(before)
    expect(world.units.require(fighter).class).toBe('air')
  })

  it('infantry never crushes', () => {
    const sim = makeSim()
    const { world } = sim
    troopAt(sim, 'scout', 0)
    const victim = troopAt(sim, 'scout', 1)
    const before = world.healths.require(victim).hp

    sim.advance(2)

    expect(world.healths.require(victim).hp).toBe(before)
  })

  it('credits the crushing vehicle with the kill', () => {
    const sim = makeSim()
    const { world } = sim
    const dozer = vehicleAt(sim, 'bulldozer', 0)
    const victim = troopAt(sim, 'scout', 1)
    world.healths.require(victim).hp = world.settings.crushDamage

    sim.advance(2)

    expect(world.units.get(victim)).toBeUndefined()
    expect(world.units.require(dozer).killCount).toBe(1)
  })
})