import { describe, expect, it } from 'vitest'
import { createEmptyMap, isqrt, sqDist, type MatchSettings } from '@space-arenas/shared'
import { Simulator } from '../client/src/core/Simulator.ts'
import { hashWorld } from '../client/src/core/hash.ts'
import { spawnUnit, spawnBuilding } from '../client/src/entities/factories.ts'

const MAP = createEmptyMap(64, 64)
const SEED = 0xabcdef

const makeSim = (settings?: Partial<MatchSettings>): Simulator => new Simulator(MAP, SEED, [0, 1], settings)

const getPassengers = (sim: Simulator, apc: number): number => sim.world.transports.get(apc)?.passengers.length ?? 0
const getLoadQueue = (sim: Simulator, apc: number): number => sim.world.transports.get(apc)?.loadQueue.length ?? 0

describe('APC transport: boarding', () => {
  it('queues riders first, then boards them one per tick until the APC lifts them', () => {
    const sim = makeSim()
    const { world } = sim
    const apc = spawnUnit(world, 'apc', 0, 10000, 10000)
    const r1 = spawnUnit(world, 'rifleman', 0, 10300, 10000)
    const r2 = spawnUnit(world, 'rifleman', 0, 10000, 10300)
    const before = world.units.size

    sim.step([sim.makeCommand(0, { type: 'transport-load', entities: [r1, r2], x: 0, y: 0, transportId: apc })])
    // On the command tick the nearest rider boards; the other is still walking.
    expect(world.units.size).toBe(before - 1)
    expect(getLoadQueue(sim, apc)).toBe(1)
    expect(getPassengers(sim, apc)).toBe(1)
    expect(sim.drainEvents().some((e) => e.type === 'unit-loaded')).toBe(true)

    sim.advance(1)
    expect(getPassengers(sim, apc)).toBe(2)
    expect(getLoadQueue(sim, apc)).toBe(0)
    expect(world.units.size).toBe(before - 2)
  })

  it('rejects air units and non-owned units while loading', () => {
    const sim = makeSim()
    const { world } = sim
    const apc = spawnUnit(world, 'apc', 0, 10000, 10000)
    const fighter = spawnUnit(world, 'fighter', 0, 10200, 10000)
    const enemy = spawnUnit(world, 'rifleman', 1, 10100, 10000)
    const mine = spawnUnit(world, 'rifleman', 0, 10000, 10200)

    sim.step([
      sim.makeCommand(0, {
        type: 'transport-load',
        entities: [fighter, enemy, mine],
        x: 0,
        y: 0,
        transportId: apc,
      }),
    ])

    expect(sim.drainEvents().some((e) => e.type === 'command-rejected' && e.reason === 'only infantry can be transported')).toBe(true)
    // Only the owned rifleman was queued (and boarded right away, being in range).
    expect(world.units.has(enemy)).toBe(true)
    expect(world.units.has(fighter)).toBe(true)
    expect(world.units.has(mine)).toBe(false)
    expect(getLoadQueue(sim, apc)).toBe(0)
    expect(getPassengers(sim, apc)).toBe(1)
  })

  it('rejects vehicles — the APC only carries infantry', () => {
    const sim = makeSim()
    const { world } = sim
    const apc = spawnUnit(world, 'apc', 0, 10000, 10000)
    const dozer = spawnUnit(world, 'bulldozer', 0, 10200, 10000)
    const walker = spawnUnit(world, 'assault-walker', 0, 10100, 10300)

    sim.step([sim.makeCommand(0, { type: 'transport-load', entities: [dozer, walker], x: 0, y: 0, transportId: apc })])

    const rejected = sim.drainEvents().filter((e) => e.type === 'command-rejected' && e.reason === 'only infantry can be transported')
    expect(rejected.length).toBe(2)
    expect(world.units.has(dozer)).toBe(true)
    expect(world.units.has(walker)).toBe(true)
    expect(getLoadQueue(sim, apc)).toBe(0)
    expect(getPassengers(sim, apc)).toBe(0)
  })

  it('stops reserving slots once the APC is full (10 base, +3 per capacity research)', () => {
    const sim = makeSim()
    const { world } = sim
    const apc = spawnUnit(world, 'apc', 0, 10000, 10000)
    const soldiers = Array.from({ length: 11 }, (_, i) => spawnUnit(world, 'rifleman', 0, 10400 + i * 200, 10000))

    sim.step([sim.makeCommand(0, { type: 'transport-load', entities: soldiers, x: 0, y: 0, transportId: apc })])
    const events = sim.drainEvents()

    expect(getLoadQueue(sim, apc) + getPassengers(sim, apc)).toBe(10)
    // The eleventh squad member was rejected for lack of space.
    expect(events.some((e) => e.type === 'command-rejected' && e.reason === 'transport is full')).toBe(true)
    // Let the ten board.
    sim.advance(20)
    expect(getPassengers(sim, apc)).toBe(10)

    // One more research level grants +3 slots.
    world.teamState(0).transportCapacityLevel = 1
    const apc2 = spawnUnit(world, 'apc', 0, 14000, 10000)
    const squad = Array.from({ length: 14 }, (_, i) => spawnUnit(world, 'rifleman', 0, 14500 + i * 200, 10000))
    sim.step([sim.makeCommand(0, { type: 'transport-load', entities: squad, x: 0, y: 0, transportId: apc2 })])
    expect(getLoadQueue(sim, apc2) + getPassengers(sim, apc2)).toBe(13)
    sim.advance(20)
    expect(getPassengers(sim, apc2)).toBe(13)
  })

  it('distant riders walk to the APC while it drives to meet them, boarding one at a time', () => {
    const sim = makeSim()
    const { world } = sim
    const apc = spawnUnit(world, 'apc', 0, 10000, 10000)
    const r1 = spawnUnit(world, 'rifleman', 0, 20000, 10000)
    const r2 = spawnUnit(world, 'rifleman', 0, 10000, 20500)
    const before = world.units.size

    sim.step([sim.makeCommand(0, { type: 'transport-load', entities: [r1, r2], x: 0, y: 0, transportId: apc })])
    expect(getLoadQueue(sim, apc)).toBe(2)
    // Both the APC (toward the nearest rider) and the riders were given moves.
    sim.advance(5)
    expect(world.transforms.require(apc).x).toBeGreaterThan(10000)
    expect(world.transforms.require(r2).y).toBeLessThan(20500)

    sim.advance(120)
    expect(getLoadQueue(sim, apc)).toBe(0)
    expect(getPassengers(sim, apc)).toBe(2)
    expect(world.units.size).toBe(before - 2)
  })
})

describe('APC transport: unloading', () => {
  it('drops passengers when ordered to unload near the current spot', () => {
    const sim = makeSim()
    const { world } = sim
    const apc = spawnUnit(world, 'apc', 0, 10000, 10000)
    const r1 = spawnUnit(world, 'rifleman', 0, 10300, 10000)
    const r2 = spawnUnit(world, 'rifleman', 0, 10000, 10300)
    sim.step([sim.makeCommand(0, { type: 'transport-load', entities: [r1, r2], x: 0, y: 0, transportId: apc })])
    sim.advance(2)
    expect(getPassengers(sim, apc)).toBe(2)
    const pos = world.transforms.require(apc)
    const empty = world.units.size

    sim.step([sim.makeCommand(0, { type: 'transport-unload', entities: [], x: pos.x, y: pos.y, transportId: apc })])
    sim.advance(3)

    expect(world.units.size).toBe(empty + 2)
    expect(getPassengers(sim, apc)).toBe(0)
    expect(world.transports.get(apc)?.pendingUnload).toBe(false)
    expect(sim.drainEvents().some((e) => e.type === 'unit-unloaded')).toBe(true)
  })

  it('drives to a far drop-off point before unloading (move-then-unload)', () => {
    const sim = makeSim()
    const { world } = sim
    const apc = spawnUnit(world, 'apc', 0, 10000, 10000)
    const r1 = spawnUnit(world, 'rifleman', 0, 10300, 10000)
    sim.step([sim.makeCommand(0, { type: 'transport-load', entities: [r1], x: 0, y: 0, transportId: apc })])
    sim.advance(2)
    const startX = world.transforms.require(apc).x

    sim.step([sim.makeCommand(0, { type: 'transport-unload', entities: [], x: 50000, y: 10000, transportId: apc })])

    // One tick in: APC must have started moving towards the point and kept the hold.
    sim.advance(10)
    expect(world.transforms.require(apc).x).toBeGreaterThan(startX)
    expect(getPassengers(sim, apc)).toBe(1)

    sim.advance(700)
    expect(getPassengers(sim, apc)).toBe(0)
    expect(world.units.size).toBeGreaterThanOrEqual(2)
  })

  it('restores passenger stats (hp, veterancy) on unload', () => {
    const sim = makeSim()
    const { world } = sim
    const apc = spawnUnit(world, 'apc', 0, 10000, 10000)
    const vet = spawnUnit(world, 'rifleman', 0, 10300, 10000)
    const vu = world.units.require(vet)
    vu.killCount = 3
    vu.veteranRank = 2
    world.healths.require(vet).hp = 55

    sim.step([sim.makeCommand(0, { type: 'transport-load', entities: [vet], x: 0, y: 0, transportId: apc })])
    sim.advance(2)
    const pos = world.transforms.require(apc)
    sim.step([sim.makeCommand(0, { type: 'transport-unload', entities: [], x: pos.x, y: pos.y, transportId: apc })])
    sim.advance(3)

    const restoredId = Array.from(world.units.idsArray()).find((id) => world.units.get(id)?.unitType === 'rifleman')!
    expect(restoredId).toBeGreaterThan(0)
    expect(world.units.require(restoredId).veteranRank).toBe(2)
    expect(world.units.require(restoredId).killCount).toBe(3)
    expect(world.healths.require(restoredId).hp).toBe(55)
    expect(world.healths.require(restoredId).maxHp).toBeGreaterThanOrEqual(55)
  })

  it('kills the boarded passengers with the APC when it is destroyed (they never re-enter)', () => {
    const sim = makeSim()
    const { world } = sim
    const apc = spawnUnit(world, 'apc', 0, 10000, 10000)
    const r1 = spawnUnit(world, 'rifleman', 0, 10300, 10000)
    const r2 = spawnUnit(world, 'rifleman', 0, 10000, 10300)
    sim.step([sim.makeCommand(0, { type: 'transport-load', entities: [r1, r2], x: 0, y: 0, transportId: apc })])
    sim.advance(2)
    expect(getPassengers(sim, apc)).toBe(2)
    const before = world.units.size

    world.removeEntity(apc)
    sim.advance(5)

    expect(world.units.size).toBe(before - 1)
    expect(world.transports.has(apc)).toBe(false)
    // The APC took down its two boarded riders with it.
    const riflemenAlive = Array.from(world.units.idsArray()).filter((id) => world.units.get(id)?.unitType === 'rifleman').length
    expect(riflemenAlive).toBe(0)
  })

  it('queued riders that never boarded survive an APC that is destroyed first', () => {
    const sim = makeSim()
    const { world } = sim
    const apc = spawnUnit(world, 'apc', 0, 10000, 10000)
    const r1 = spawnUnit(world, 'rifleman', 0, 18000, 10000)
    const r2 = spawnUnit(world, 'rifleman', 0, 10000, 18500)
    sim.step([sim.makeCommand(0, { type: 'transport-load', entities: [r1, r2], x: 0, y: 0, transportId: apc })])
    expect(getLoadQueue(sim, apc)).toBe(2)
    expect(getPassengers(sim, apc)).toBe(0)

    world.removeEntity(apc)
    sim.advance(5)

    expect(world.transports.has(apc)).toBe(false)
    const riflemenAlive = Array.from(world.units.idsArray()).filter((id) => world.units.get(id)?.unitType === 'rifleman').length
    expect(riflemenAlive).toBe(2)
  })

  it('unloads one passenger per tick into stable grid slots', () => {
    const sim = makeSim()
    const { world } = sim
    const apc = spawnUnit(world, 'apc', 0, 10000, 10000)
    const rs = [0, 1, 2, 3].map((i) => spawnUnit(world, 'rifleman', 0, 10300, 10000 + i * 100))
    sim.step([sim.makeCommand(0, { type: 'transport-load', entities: rs, x: 0, y: 0, transportId: apc })])
    sim.advance(5)
    expect(getPassengers(sim, apc)).toBe(4)
    sim.drainEvents()

    const pos = world.transforms.require(apc)
    sim.step([sim.makeCommand(0, { type: 'transport-unload', entities: [], x: pos.x, y: pos.y, transportId: apc })])
    // The first passenger steps off on the same tick as the order.
    expect(getPassengers(sim, apc)).toBe(3)
    sim.advance(1)
    expect(getPassengers(sim, apc)).toBe(2)
    sim.advance(1)
    expect(getPassengers(sim, apc)).toBe(1)
    sim.advance(2)
    expect(getPassengers(sim, apc)).toBe(0)
    expect(world.transports.get(apc)?.pendingUnload).toBe(false)
  })

  it('unload determinism: two sims with the same stream stay in lockstep', () => {
    const mk = () => {
      const sim = makeSim()
      const apc = spawnUnit(sim.world, 'apc', 0, 10000, 10000)
      const rs = [0, 1, 2].map((i) => spawnUnit(sim.world, 'rifleman', 0, 10300, 10000 + i * 200))
      sim.step([sim.makeCommand(0, { type: 'transport-load', entities: rs, x: 0, y: 0, transportId: apc })])
      sim.step([sim.makeCommand(0, { type: 'transport-unload', entities: [], x: 50000, y: 50000, transportId: apc })])
      return sim
    }
    const a = mk()
    const b = mk()
    a.advance(500)
    b.advance(500)
    expect(hashWorld(a.world)).toBe(hashWorld(b.world))
  })
})

describe('bunker garrison: unloading', () => {
  const makeGarrisonedBunker = (sim: Simulator): { bunker: number; loaded: number } => {
    const { world } = sim
    spawnBuilding(world, 'command-center', 0, 4, 4, true)
    const bunker = spawnBuilding(world, 'bunker', 0, 10, 10, true)
    const squad = Array.from({ length: 5 }, (_, i) => spawnUnit(world, 'rifleman', 0, 9400 + i * 40, 10500))
    sim.step([sim.makeCommand(0, { type: 'transport-load', entities: squad, x: 0, y: 0, transportId: bunker })])
    sim.advance(20)
    return { bunker, loaded: 5 }
  }

  it('steps troops off around the bunker itself, then marches them to the clicked point', () => {
    const sim = makeSim()
    const { world } = sim
    const { bunker, loaded } = makeGarrisonedBunker(sim)
    expect(world.transports.require(bunker).passengers.length).toBe(loaded)
    const bx = world.transforms.require(bunker).x
    const by = world.transforms.require(bunker).y

    // Unload "Here" at a far map position — the click is a walk target, not a teleport.
    sim.step([sim.makeCommand(0, { type: 'transport-unload', entities: [], x: 50000, y: 50000, transportId: bunker })])
    sim.advance(1)

    const first = Array.from(world.units.idsArray()).find((id) => world.units.get(id)?.unitType === 'rifleman')!
    const ft = world.transforms.require(first)
    expect(isqrt(sqDist(ft.x, ft.y, bx, by))).toBeLessThanOrEqual(4000)
    // And it is already walking toward the clicked drop-off point.
    expect(world.moves.get(first)?.tx).toBe(50000)
    expect(world.moves.get(first)?.ty).toBe(50000)

    sim.advance(10)
    expect(world.transports.require(bunker).passengers.length).toBe(0)
    const riflemen = Array.from(world.units.idsArray()).filter((id) => world.units.get(id)?.unitType === 'rifleman')
    expect(riflemen.length).toBe(loaded)
    expect(world.transports.get(bunker)?.pendingUnload).toBe(false)
  })

  it(`doesn't teleport the garrison — nobody ends up near the point in one tick`, () => {
    const sim = makeSim()
    const { world } = sim
    const { bunker } = makeGarrisonedBunker(sim)

    sim.step([sim.makeCommand(0, { type: 'transport-unload', entities: [], x: 50000, y: 50000, transportId: bunker })])
    sim.advance(1)

    const riflemen = Array.from(world.units.idsArray()).filter((id) => world.units.get(id)?.unitType === 'rifleman')
    for (const id of riflemen) {
      const t = world.transforms.require(id)
      expect(isqrt(sqDist(t.x, t.y, 50000, 50000))).toBeGreaterThan(40000)
    }
  })
})