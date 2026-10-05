import { describe, expect, it } from 'vitest'
import { createEmptyMap, SECONDS_TO_TICKS } from '@space-arenas/shared'
import { Simulator } from '../client/src/core/Simulator.ts'
import { spawnUnit } from '../client/src/entities/factories.ts'

const makeMap = () => {
  const map = createEmptyMap(64, 64)
  map.oilFields.push({ x: 32, y: 32, radius: 2 })
  map.supplyFields.push({ x: 10, y: 10, radius: 3, capacity: 24 })
  map.spawnPoints.push({ x: 5, y: 5, team: 0 }, { x: 55, y: 55, team: 1 })
  return map
}

const SEED = 0xcafe1111

const CLAIM_TICKS = SECONDS_TO_TICKS(20)
const INCOME_INTERVAL = SECONDS_TO_TICKS(10)

const findOilField = (world: ReturnType<typeof Simulator>['world']): number => {
  let found = -1
  world.oilFields.forEach((id) => {
    if (found < 0) found = id
  })
  return found
}

describe('OilSystem', () => {
  it('claims unowned oil fields with a scout', () => {
    const sim = new Simulator(makeMap(), SEED, [0, 1])
    const { world } = sim
    const oilId = findOilField(world)
    spawnUnit(world, 'scout', 0, 32500, 32500)

    expect(world.oilFields.require(oilId).owner).toBe(-1)

    sim.advance(CLAIM_TICKS + 1)

    expect(world.oilFields.require(oilId).owner).toBe(0)
  })

  it('oil income increases team credits', () => {
    const sim = new Simulator(makeMap(), SEED, [0, 1])
    const { world } = sim
    const oilId = findOilField(world)
    spawnUnit(world, 'scout', 0, 32500, 32500)

    sim.advance(CLAIM_TICKS + 1)
    expect(world.oilFields.require(oilId).owner).toBe(0)

    const creditsBefore = world.teamState(0).credits
    sim.advance(INCOME_INTERVAL + 1)

    expect(world.teamState(0).credits).toBe(creditsBefore + world.settings.oilIncome)
  })

  it('destroyed oil fields stop generating income', () => {
    const sim = new Simulator(makeMap(), SEED, [0, 1])
    const { world } = sim
    const oilId = findOilField(world)
    spawnUnit(world, 'scout', 0, 32500, 32500)

    sim.advance(CLAIM_TICKS + 1)
    expect(world.oilFields.require(oilId).owner).toBe(0)

    world.removeEntity(oilId)

    const creditsBefore = world.teamState(0).credits
    sim.advance(INCOME_INTERVAL + 1)

    expect(world.teamState(0).credits).toBe(creditsBefore)
  })
})
