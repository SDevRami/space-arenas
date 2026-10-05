import { describe, expect, it } from 'vitest'
import { createEmptyMap, type MatchSettings } from '@space-arenas/shared'
import { Simulator } from '../client/src/core/Simulator.ts'
import { hashWorld } from '../client/src/core/hash.ts'
import { spawnUnit } from '../client/src/entities/factories.ts'

const MAP = createEmptyMap(64, 64)
const SEED = 0xabcdef

const makeSim = (settings?: Partial<MatchSettings>): Simulator => new Simulator(MAP, SEED, [0, 1], settings)

describe('Day 21: auto-fire toggle', () => {
  it('idle units auto-fire at in-range enemies by default', () => {
    const sim = makeSim()
    const { world } = sim
    const r = spawnUnit(world, 'rifleman', 0, 10000, 10000)
    const enemy = spawnUnit(world, 'rifleman', 1, 10000, 10800)
    const maxHp = world.healths.require(enemy).hp

    sim.advance(30)

    expect(world.healths.require(enemy).hp).toBeLessThan(maxHp)
    expect(world.attacks.require(r).target).not.toBeNull()
  })

  it('set-auto-fire OFF stops idle auto-acquire but explicit attack still works', () => {
    const sim = makeSim()
    const { world } = sim
    const r = spawnUnit(world, 'rifleman', 0, 10000, 10000)
    const enemy = spawnUnit(world, 'rifleman', 1, 10000, 10800)
    const maxHp = world.healths.require(enemy).hp

    sim.step([sim.makeCommand(0, { type: 'set-auto-fire', entities: [r], x: 0, y: 0, autoFire: false })])
    sim.advance(30)

    expect(world.attacks.require(r).autoFire).toBe(false)
    expect(world.attacks.require(r).target).toBeNull()
    expect(world.healths.require(enemy).hp).toBe(maxHp)

    sim.step([sim.makeCommand(0, { type: 'attack', entities: [r], x: 0, y: 0, target: enemy })])
    sim.advance(5)

    expect(world.healths.require(enemy).hp).toBeLessThan(maxHp)
  })

  it('set-auto-fire re-enables idle engagement', () => {
    const sim = makeSim()
    const { world } = sim
    const r = spawnUnit(world, 'rifleman', 0, 10000, 10000)
    const enemy = spawnUnit(world, 'rifleman', 1, 10000, 10800)
    const maxHp = world.healths.require(enemy).hp

    sim.step([sim.makeCommand(0, { type: 'set-auto-fire', entities: [r], x: 0, y: 0, autoFire: false })])
    sim.advance(10)
    expect(world.healths.require(enemy).hp).toBe(maxHp)

    sim.step([sim.makeCommand(0, { type: 'set-auto-fire', entities: [r], x: 0, y: 0, autoFire: true })])
    sim.advance(30)
    expect(world.healths.require(enemy).hp).toBeLessThan(maxHp)
  })
})

describe('Day 21: formation commands', () => {
  it('set-formation writes spread + relative flags on owned ground units', () => {
    const sim = makeSim()
    const { world } = sim
    const r1 = spawnUnit(world, 'rifleman', 0, 10000, 10000)
    const r2 = spawnUnit(world, 'rifleman', 0, 10200, 10000)

    sim.step([sim.makeCommand(0, { type: 'set-formation', entities: [r1, r2], x: 0, y: 0, spreadCode: 1, relative: true })])

    expect(world.units.require(r1).formationSpread).toBe(0.7)
    expect(world.units.require(r1).relativeFormation).toBe(true)
    expect(world.units.require(r2).formationSpread).toBe(0.7)

    sim.step([sim.makeCommand(0, { type: 'set-formation', entities: [r1], x: 0, y: 0, spreadCode: 2, relative: false })])
    expect(world.units.require(r1).formationSpread).toBe(1.5)
    expect(world.units.require(r1).relativeFormation).toBe(false)
    expect(world.units.require(r2).formationSpread).toBe(0.7)
  })

  it('rejects air units for formation commands', () => {
    const sim = makeSim()
    const { world } = sim
    const f = spawnUnit(world, 'fighter', 0, 10000, 10000)

    sim.step([sim.makeCommand(0, { type: 'set-formation', entities: [f], x: 0, y: 0, spreadCode: 1, relative: false })])

    expect(world.units.require(f).formationSpread).toBe(1)
    expect(sim.drainEvents().some((e) => e.type === 'command-rejected' && e.reason === 'cannot formation air units')).toBe(true)
  })

  it('scales guard formation spacing by tight/loose spread', () => {
    const tight = makeSim()
    const { world: tw } = tight
    const t1 = spawnUnit(tw, 'rifleman', 0, 10000, 10000)
    const t2 = spawnUnit(tw, 'rifleman', 0, 10200, 10000)
    tight.step([tight.makeCommand(0, { type: 'set-formation', entities: [t1, t2], x: 0, y: 0, spreadCode: 1, relative: false })])
    tight.step([tight.makeCommand(0, { type: 'guard', entities: [t1, t2], x: 15000, y: 15000, target: -1 })])
    const postsT = [t1, t2].map((id) => tw.attacks.require(id).guardPost!)
    const dTight = Math.hypot(postsT[0].x - postsT[1].x, postsT[0].y - postsT[1].y)

    const loose = makeSim()
    const { world: lw } = loose
    const l1 = spawnUnit(lw, 'rifleman', 0, 10000, 10000)
    const l2 = spawnUnit(lw, 'rifleman', 0, 10200, 10000)
    loose.step([loose.makeCommand(0, { type: 'set-formation', entities: [l1, l2], x: 0, y: 0, spreadCode: 2, relative: false })])
    loose.step([loose.makeCommand(0, { type: 'guard', entities: [l1, l2], x: 15000, y: 15000, target: -1 })])
    const postsL = [l1, l2].map((id) => lw.attacks.require(id).guardPost!)
    const dLoose = Math.hypot(postsL[0].x - postsL[1].x, postsL[0].y - postsL[1].y)

    const normal = makeSim()
    const { world: nw } = normal
    const n1 = spawnUnit(nw, 'rifleman', 0, 10000, 10000)
    const n2 = spawnUnit(nw, 'rifleman', 0, 10200, 10000)
    normal.step([normal.makeCommand(0, { type: 'guard', entities: [n1, n2], x: 15000, y: 15000, target: -1 })])
    const postsN = [n1, n2].map((id) => nw.attacks.require(id).guardPost!)
    const dNormal = Math.hypot(postsN[0].x - postsN[1].x, postsN[0].y - postsN[1].y)

    expect(dNormal).toBe(1400)
    expect(Math.abs(dTight / 1400 - 0.7)).toBeLessThan(0.01)
    expect(Math.abs(dLoose / 1400 - 1.5)).toBeLessThan(0.01)
  })

  it('auto-fire + formation commands stay deterministic across identical sims', () => {
    const run = (): Simulator => {
      const sim = makeSim()
      const { world } = sim
      const r1 = spawnUnit(world, 'rifleman', 0, 10000, 10000)
      const r2 = spawnUnit(world, 'rifleman', 0, 10300, 10000)
      const enemy = spawnUnit(world, 'rifleman', 1, 12000, 10000)
      sim.step([
        sim.makeCommand(0, { type: 'set-auto-fire', entities: [r1, r2], x: 0, y: 0, autoFire: false }),
        sim.makeCommand(0, { type: 'set-formation', entities: [r1, r2], x: 0, y: 0, spreadCode: 2, relative: true }),
      ])
      sim.step([sim.makeCommand(0, { type: 'attack', entities: [r1], x: 0, y: 0, target: enemy })])
      sim.advance(20)
      sim.step([sim.makeCommand(0, { type: 'guard', entities: [r2], x: 9000, y: 9000, target: -1 })])
      sim.advance(10)
      return sim
    }

    const a = run()
    const b = run()
    expect(hashWorld(a.world)).toBe(hashWorld(b.world))
  })
})