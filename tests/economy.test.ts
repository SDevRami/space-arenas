import { describe, expect, it } from 'vitest'
import { createEmptyMap } from '@space-arenas/shared'
import { Simulator } from '../client/src/core/Simulator.ts'
import { spawnUnit, spawnBuilding } from '../client/src/entities/factories.ts'

const makeMap = () => {
  const map = createEmptyMap(64, 64)
  map.supplyFields.push({ x: 30, y: 30, radius: 3, capacity: 48 })
  map.spawnPoints.push({ x: 10, y: 10, team: 0 }, { x: 50, y: 50, team: 1 })
  return map
}

const SEED = 0xbeeef00d

const findFieldId = (world: ReturnType<typeof Simulator>['world']): number => {
  let found = -1
  world.fields.forEach((id) => {
    if (found < 0) found = id
  })
  return found
}

describe('EconomySystem', () => {
  it('transitions idle harvester to to-field phase', () => {
    const sim = new Simulator(makeMap(), SEED, [0, 1])
    const { world } = sim
    const dock = spawnBuilding(world, 'supply-dock', 0, 28, 28, true)
    const fieldId = findFieldId(world)
    const hv = spawnUnit(world, 'harvester', 0, 29000, 29000)
    world.harvesters.set(hv, { phase: 'idle', field: -1, dock, loadTicks: 0 })

    sim.step()

    const h = world.harvesters.require(hv)
    expect(h.phase).toBe('to-field')
    expect(h.field).toBe(fieldId)
  })

  it('credits increase when harvester returns to dock', () => {
    const sim = new Simulator(makeMap(), SEED, [0, 1])
    const { world } = sim
    const dock = spawnBuilding(world, 'supply-dock', 0, 28, 28, true)
    const hv = spawnUnit(world, 'harvester', 0, 29000, 29000)
    const dockPos = world.transforms.require(dock)
    world.harvesters.set(hv, { phase: 'to-dock', field: -1, dock, loadTicks: 0 })
    world.transforms.require(hv).x = dockPos.x
    world.transforms.require(hv).y = dockPos.y

    const creditsBefore = world.teamState(0).credits
    sim.step()

    expect(world.teamState(0).credits).toBe(creditsBefore + world.settings.supplyPerTrip)
    expect(world.harvesters.require(hv).phase).toBe('idle')
  })

  it('harvester goes idle when dock is destroyed', () => {
    const sim = new Simulator(makeMap(), SEED, [0, 1])
    const { world } = sim
    const dock = spawnBuilding(world, 'supply-dock', 0, 28, 28, true)
    const hv = spawnUnit(world, 'harvester', 0, 29000, 29000)
    world.harvesters.set(hv, { phase: 'to-field', field: 999, dock, loadTicks: 0 })

    world.removeEntity(dock)
    sim.step()

    expect(world.harvesters.require(hv).phase).toBe('idle')
  })
})
