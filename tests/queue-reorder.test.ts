import { describe, expect, it } from 'vitest'
import { generateDefaultMap, getUnit, type EnvelopeCommand, type SimCommand } from '@space-arenas/shared'
import { Simulator } from '../client/src/core/Simulator.ts'
import { hashWorld } from '../client/src/core/hash.ts'
import type { World } from '../client/src/core/world.ts'

const MAP = generateDefaultMap()
const SEED = 0xbeefc0de

const ccId = (world: World): number => {
  let found = -1
  world.buildings.forEach((id, b) => {
    if (found < 0 && b.team === 0 && b.buildingType === 'command-center') found = id
  })
  if (found < 0) throw new Error('no command center')
  return found
}

const cmd = (sim: Simulator, seq: number, c: SimCommand): EnvelopeCommand => ({ player: 0, seq, tick: sim.tick, cmd: c })

const queueDozer = (sim: Simulator, seq: number, cc: number): void => {
  sim.step([cmd(sim, seq, { type: 'queue', entities: [cc], x: 0, y: 0, unitType: 'bulldozer' })])
}

const orders = (sim: Simulator, cc: number): string[] => {
  const q = sim.world.queues.get(cc)
  return q ? q.queue.map((o) => o.unitType) : []
}

describe('build queue reorder', () => {
  it('moves an order to a new slot and emits order-reordered', () => {
    const sim = new Simulator(MAP, SEED, [0])
    const cc = ccId(sim.world)
    queueDozer(sim, 1, cc)
    queueDozer(sim, 2, cc)
    queueDozer(sim, 3, cc)
    expect(orders(sim, cc)).toEqual(['bulldozer', 'bulldozer', 'bulldozer'])

    const creditsBefore = sim.world.teamState(0).credits
    sim.step([cmd(sim, 4, { type: 'reorder-queue', entities: [cc], x: 0, y: 0, index: 2, to: 0 })])
    expect(orders(sim, cc)).toEqual(['bulldozer', 'bulldozer', 'bulldozer'])
    expect(sim.world.teamState(0).credits).toBe(creditsBefore)
    expect(sim.drainEvents().some((e) => e.type === 'order-reordered' && e.building === cc && e.from === 2 && e.to === 0)).toBe(true)
  })

  it('does nothing when from equals to', () => {
    const sim = new Simulator(MAP, SEED, [0])
    const cc = ccId(sim.world)
    queueDozer(sim, 1, cc)
    queueDozer(sim, 2, cc)
    const before = orders(sim, cc)
    sim.step([cmd(sim, 3, { type: 'reorder-queue', entities: [cc], x: 0, y: 0, index: 1, to: 1 })])
    expect(orders(sim, cc)).toEqual(before)
    expect(sim.drainEvents().some((e) => e.type === 'order-reordered')).toBe(false)
  })

  it('rejects out-of-range slots without touching the queue', () => {
    const sim = new Simulator(MAP, SEED, [0])
    const cc = ccId(sim.world)
    queueDozer(sim, 1, cc)
    queueDozer(sim, 2, cc)
    const before = orders(sim, cc)
    sim.step([cmd(sim, 3, { type: 'reorder-queue', entities: [cc], x: 0, y: 0, index: 0, to: 9 })])
    sim.step([cmd(sim, 4, { type: 'reorder-queue', entities: [cc], x: 0, y: 0, index: 9, to: 0 })])
    expect(orders(sim, cc)).toEqual(before)
    expect(sim.drainEvents().filter((e) => e.type === 'order-reordered')).toHaveLength(0)
  })

  it('restarts the front production progress when the order changes', () => {
    const sim = new Simulator(MAP, SEED, [0])
    const cc = ccId(sim.world)
    sim.step([cmd(sim, 1, { type: 'queue', entities: [cc], x: 0, y: 0, unitType: 'bulldozer' })])
    sim.step([cmd(sim, 2, { type: 'queue', entities: [cc], x: 0, y: 0, unitType: 'bulldozer' })])
    const q = sim.world.queues.require(cc)
    const full = getUnit('bulldozer').buildTimeTicks
    sim.advance(20)
    expect(q.queue[0].remainingTicks).toBeLessThan(full)
    sim.step([cmd(sim, 3, { type: 'reorder-queue', entities: [cc], x: 0, y: 0, index: 0, to: 1 })])
    // The front order restarted from full build time (then ticked once in the same step);
    // the moved-back order also reset and is untouched by production.
    expect(q.queue[0].remainingTicks).toBeGreaterThan(full - 2)
    expect(q.queue[1].remainingTicks).toBe(full)
  })

  it('preserves unique order ids across a reorder (identity survives reordering identical units)', () => {
    const sim = new Simulator(MAP, SEED, [0])
    const cc = ccId(sim.world)
    queueDozer(sim, 1, cc)
    queueDozer(sim, 2, cc)
    queueDozer(sim, 3, cc)
    const q = sim.world.queues.require(cc)
    const idsBefore = q.queue.map((o) => o.id)
    expect(new Set(idsBefore).size).toBe(3)

    sim.step([cmd(sim, 4, { type: 'reorder-queue', entities: [cc], x: 0, y: 0, index: 2, to: 0 })])
    const idsAfter = q.queue.map((o) => o.id)
    expect(idsAfter[0]).toBe(idsBefore[2])
    expect(idsAfter[1]).toBe(idsBefore[0])
    expect(idsAfter[2]).toBe(idsBefore[1])
  })

  it('keeps two simulators in lockstep after a reorder', () => {
    const a = new Simulator(MAP, SEED, [0])
    const b = new Simulator(MAP, SEED, [0])
    const ccA = ccId(a.world)
    const ccB = ccId(b.world)
    queueDozer(a, 1, ccA)
    queueDozer(b, 1, ccB)
    queueDozer(a, 2, ccA)
    queueDozer(b, 2, ccB)
    const reorderA: EnvelopeCommand = { player: 0, seq: 3, tick: 0, cmd: { type: 'reorder-queue', entities: [ccA], x: 0, y: 0, index: 1, to: 0 } }
    const reorderB: EnvelopeCommand = { player: 0, seq: 3, tick: 0, cmd: { type: 'reorder-queue', entities: [ccB], x: 0, y: 0, index: 1, to: 0 } }
    for (let i = 0; i < 400; i++) {
      a.step(i === 0 ? [reorderA] : [])
      b.step(i === 0 ? [reorderB] : [])
    }
    expect(orders(a, ccA)).toEqual(orders(b, ccB))
    expect(hashWorld(a.world)).toBe(hashWorld(b.world))
  })
})