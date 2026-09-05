import { describe, expect, it } from 'vitest'
import { createEmptyMap } from '@space-arenas/shared'
import { Simulator } from '../client/src/core/Simulator.ts'
import { spawnUnit } from '../client/src/entities/factories.ts'

const makeMap = () => {
  const map = createEmptyMap(64, 64)
  map.spawnPoints.push({ x: 10, y: 10, team: 0 }, { x: 50, y: 50, team: 1 })
  return map
}

const SEED = 0xface1234

const fogAt = (world: ReturnType<typeof Simulator>['world'], team: number, tx: number, ty: number): number => {
  const fog = world.fog.get(team)!
  return fog[ty * world.width + tx]
}

describe('VisionSystem', () => {
  it('reveals tiles within unit vision radius', () => {
    const sim = new Simulator(makeMap(), SEED, [0, 1])
    const { world } = sim
    spawnUnit(world, 'scout', 0, 10000, 10000)
    sim.step()

    const cx = 10
    const cy = 10

    expect(fogAt(world, 0, cx, cy)).toBe(2)
    expect(fogAt(world, 0, cx + 5, cy)).toBe(2)
    expect(fogAt(world, 0, cx, cy + 5)).toBe(2)
    expect(fogAt(world, 0, cx + 8, cy + 6)).toBe(2)
  })

  it('tiles start unseen and become visible when unit arrives', () => {
    const sim = new Simulator(makeMap(), SEED, [0, 1])
    const { world } = sim

    expect(fogAt(world, 0, 10, 10)).toBe(0)

    spawnUnit(world, 'scout', 0, 10000, 10000)
    sim.step()

    expect(fogAt(world, 0, 10, 10)).toBe(2)
  })

  it('fog transitions from visible to explored when unit moves away', () => {
    const sim = new Simulator(makeMap(), SEED, [0, 1])
    const { world } = sim
    const scout = spawnUnit(world, 'scout', 0, 10000, 10000)
    sim.step()

    const tx = 3
    const ty = 3
    expect(fogAt(world, 0, tx, ty)).toBe(2)

    world.transforms.require(scout).x = 50000
    world.transforms.require(scout).y = 50000
    sim.step()

    expect(fogAt(world, 0, tx, ty)).toBe(1)
  })

  it('fog becomes visible again when unit returns', () => {
    const sim = new Simulator(makeMap(), SEED, [0, 1])
    const { world } = sim
    const scout = spawnUnit(world, 'scout', 0, 10000, 10000)
    sim.step()

    const tx = 3
    const ty = 3

    world.transforms.require(scout).x = 50000
    world.transforms.require(scout).y = 50000
    sim.step()

    expect(fogAt(world, 0, tx, ty)).toBe(1)

    world.transforms.require(scout).x = 10000
    world.transforms.require(scout).y = 10000
    sim.step()

    expect(fogAt(world, 0, tx, ty)).toBe(2)
  })

  it('hard fog forgets seen tiles instantly', () => {
    const sim = new Simulator(makeMap(), SEED, [0, 1], { fogMode: 'hard' })
    const { world } = sim
    const scout = spawnUnit(world, 'scout', 0, 10000, 10000)
    sim.step()

    const tx = 3
    const ty = 3
    expect(fogAt(world, 0, tx, ty)).toBe(2)

    world.transforms.require(scout).x = 50000
    world.transforms.require(scout).y = 50000
    sim.step()

    expect(fogAt(world, 0, tx, ty)).toBe(0)
  })

  it('classic fog keeps seen tiles bright (no explore fade)', () => {
    const sim = new Simulator(makeMap(), SEED, [0, 1], { fogMode: 'classic' })
    const { world } = sim
    const scout = spawnUnit(world, 'scout', 0, 10000, 10000)
    sim.step()

    const tx = 3
    const ty = 3
    expect(fogAt(world, 0, tx, ty)).toBe(2)

    world.transforms.require(scout).x = 50000
    world.transforms.require(scout).y = 50000
    sim.step()

    expect(fogAt(world, 0, tx, ty)).toBe(2)
  })
})
