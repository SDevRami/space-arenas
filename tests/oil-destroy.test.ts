import { describe, expect, it } from 'vitest'
import { generateDefaultMap, type EnvelopeCommand, type SimCommand } from '@space-arenas/shared'
import { Simulator } from '../client/src/core/Simulator.ts'
import { spawnUnit } from '../client/src/entities/factories.ts'

const MAP = generateDefaultMap()
const SEED = 0x0f1d5eed

const firstOilField = (sim: Simulator): number => {
  let id = -1
  sim.world.oilFields.forEach((fid) => {
    if (id < 0) id = fid
  })
  if (id < 0) throw new Error('no oil field')
  return id
}

const reveal = (sim: Simulator): void => {
  sim.world.fog.forEach((a) => a.fill(1))
}

const cmd = (sim: Simulator, seq: number, c: SimCommand): EnvelopeCommand => ({ player: 0, seq, tick: sim.tick, cmd: c })

describe('destructible oil fields', () => {
  it('an enemy attack command targets and destroys an owned oil field', () => {
    const sim = new Simulator(MAP, SEED, [0, 1])
    reveal(sim)
    const field = firstOilField(sim)
    const f = sim.world.oilFields.require(field)
    f.owner = 1
    const t = sim.world.transforms.require(field)
    sim.world.healths.require(field).hp = 30

    const rifleman = spawnUnit(sim.world, 'rifleman', 0, t.x, t.y)
    sim.step([cmd(sim, 1, { type: 'attack', entities: [rifleman], x: t.x, y: t.y, target: field })])
    const a = sim.world.attacks.require(rifleman)
    expect(a.target).toBe(field)

    sim.advance(40)
    expect(sim.world.oilFields.has(field)).toBe(false)
    expect(sim.world.isAlive(field)).toBe(false)
    const events = sim.drainEvents()
    expect(events.some((e) => e.type === 'entity-destroyed' && e.kind === 'field' && e.entity === field)).toBe(true)
  })

  it('a low-hp oil field stays up when it is friendly', () => {
    const sim = new Simulator(MAP, SEED, [0, 1])
    reveal(sim)
    const field = firstOilField(sim)
    const f = sim.world.oilFields.require(field)
    f.owner = 1
    const t = sim.world.transforms.require(field)
    sim.world.healths.require(field).hp = 30

    const rifleman = spawnUnit(sim.world, 'rifleman', 1, t.x, t.y)
    sim.step([cmd(sim, 1, { type: 'attack', entities: [rifleman], x: t.x, y: t.y, target: field })])
    const a = sim.world.attacks.require(rifleman)
    expect(a.target).toBe(null)

    sim.advance(40)
    expect(sim.world.oilFields.has(field)).toBe(true)
    expect(sim.world.healths.require(field).hp).toBe(30)
  })

  it('oil fields track their hp from map init', () => {
    const sim = new Simulator(MAP, SEED, [0, 1])
    const field = firstOilField(sim)
    const h = sim.world.healths.get(field)
    expect(h).toBeDefined()
    expect(h!.hp).toBe(h!.maxHp)
    expect(h!.hp).toBeGreaterThan(0)
  })
})
