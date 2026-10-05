import { describe, expect, it } from 'vitest'
import { createEmptyMap } from '@space-arenas/shared'
import { Simulator } from '../client/src/core/Simulator.ts'

const makeMap = () => {
  const map = createEmptyMap(64, 64)
  map.supplyFields.push({ x: 30, y: 30, radius: 3, capacity: 24 })
  map.spawnPoints.push({ x: 10, y: 10, team: 0 }, { x: 50, y: 50, team: 1 })
  return map
}

const SEED = 0xbad12345

const removeTeamEntities = (world: ReturnType<typeof Simulator>['world'], team: number): void => {
  const toRemove: number[] = []
  world.buildings.forEach((id, b) => {
    if (b.team === team) toRemove.push(id)
  })
  world.units.forEach((id, u) => {
    if (u.team === team) toRemove.push(id)
  })
  for (const id of toRemove) world.removeEntity(id)
}

describe('WinLossSystem', () => {
  it('standard: team eliminated when no CC, no dozer, cannot rebuild', () => {
    const sim = new Simulator(makeMap(), SEED, [0, 1])
    const { world } = sim
    world.winRule = 'standard'

    removeTeamEntities(world, 1)

    sim.step()

    expect(world.gameOver).toBe(0)
  })

  it('command-center: team eliminated when CC destroyed (even with other buildings)', () => {
    const sim = new Simulator(makeMap(), SEED, [0, 1])
    const { world } = sim
    world.winRule = 'command-center'

    world.buildings.forEach((id, b) => {
      if (b.team === 1 && b.buildingType === 'command-center') {
        world.removeEntity(id)
      }
    })

    sim.step()

    expect(world.gameOver).toBe(0)
  })

  it('annihilation: team NOT eliminated while buildings remain', () => {
    const sim = new Simulator(makeMap(), SEED, [0, 1])
    const { world } = sim
    world.winRule = 'annihilation'

    const toRemove: number[] = []
    world.units.forEach((id, u) => {
      if (u.team === 1) toRemove.push(id)
    })
    for (const id of toRemove) world.removeEntity(id)

    sim.step()

    expect(world.gameOver).toBeNull()
  })

  it('annihilation: team eliminated when no units and no buildings', () => {
    const sim = new Simulator(makeMap(), SEED, [0, 1])
    const { world } = sim
    world.winRule = 'annihilation'

    removeTeamEntities(world, 1)

    sim.step()

    expect(world.gameOver).toBe(0)
  })
})
