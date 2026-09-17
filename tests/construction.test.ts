import { describe, expect, it } from 'vitest'
import { generateDefaultMap, type EnvelopeCommand, type SimCommand } from '@space-arenas/shared'
import { Simulator } from '../client/src/core/Simulator.ts'
import type { World } from '../client/src/core/world.ts'
import { buildingRect } from '../client/src/entities/factories.ts'

const MAP = generateDefaultMap()
const SEED = 0xbeefc0de

const dozerId = (world: World): number => {
  let found = -1
  world.units.forEach((id, u) => {
    if (found < 0 && u.team === 0 && u.unitType === 'bulldozer') found = id
  })
  if (found < 0) throw new Error('no bulldozer')
  return found
}

const findSpotFor = (world: World, dozer: number, footprintW = 3, footprintH = 3): { x: number; y: number } => {
  world.rebuildGridIfDirty()
  const grid = world.grid!
  const t = world.transforms.require(dozer)
  const cx = Math.floor(t.x / 1000)
  const cy = Math.floor(t.y / 1000)
  const overlapsBuilding = (x: number, y: number): boolean => {
    let hit = false
    world.buildings.forEach((_id, b) => {
      if (hit) return
      const bt = world.transforms.require(_id)
      const bx = Math.floor((bt.x - b.footprintW * 500) / 1000)
      const by = Math.floor((bt.y - b.footprintH * 500) / 1000)
      if (x < bx + b.footprintW && bx < x + footprintW && y < by + b.footprintH && by < y + footprintH) hit = true
    })
    return hit
  }
  for (let r = 0; r <= 8; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
        const x = cx + dx
        const y = cy + dy
        let ok = true
        for (let yy = y; yy < y + footprintH; yy++) {
          for (let xx = x; xx < x + footprintW; xx++) {
            if (xx < 0 || yy < 0 || xx >= world.width || yy >= world.height) {
              ok = false
              break
            }
            if (!grid.buildable[yy * world.width + xx]) {
              ok = false
              break
            }
          }
        }
        if (!ok || overlapsBuilding(x, y)) continue
        return { x, y }
      }
    }
  }
  throw new Error('no valid spot found')
}

const findSpot = (world: World, dozer: number): { x: number; y: number } => findSpotFor(world, dozer, 3, 3)

const ccId = (world: World): number => {
  let found = -1
  world.buildings.forEach((id, b) => {
    if (found < 0 && b.team === 0 && b.buildingType === 'command-center') found = id
  })
  if (found < 0) throw new Error('no command center')
  return found
}

const placePowerPlant = (sim: Simulator, d: number): number => {
  const spot = findSpot(sim.world, d)
  reveal(sim)
  sim.step([{ player: 0, seq: 1, tick: sim.tick, cmd: { type: 'place', entities: [d], x: spot.x, y: spot.y, buildingType: 'power-plant' } }])
  let bid = -1
  sim.world.buildings.forEach((id, b) => {
    if (bid < 0 && b.buildingType === 'power-plant' && b.team === 0) bid = id
  })
  if (bid < 0) throw new Error('building not spawned')
  return bid
}

const cmd = (sim: Simulator, seq: number, c: SimCommand): EnvelopeCommand => ({ player: 0, seq, tick: sim.tick, cmd: c })

const reveal = (sim: Simulator): void => {
  sim.world.fog.forEach((a) => a.fill(1))
}

describe('construction requires a bulldozer', () => {
  it('rejects placement without a free bulldozer', () => {
    const sim = new Simulator(MAP, SEED, [0])
    reveal(sim)
    sim.step([{ player: 0, seq: 1, tick: 0, cmd: { type: 'place', entities: [], x: 12, y: 8, buildingType: 'power-plant' } }])
    const events = sim.drainEvents()
    expect(events.some((e) => e.type === 'command-rejected' && e.reason === 'no available bulldozer')).toBe(true)
  })

  it('queues a building for a busy bulldozer with capacity', () => {
    const sim = new Simulator(MAP, SEED, [0])
    const d = dozerId(sim.world)
    const firstBid = placePowerPlant(sim, d)
    const spot = findSpot(sim.world, d)
    sim.step([cmd(sim, 2, { type: 'place', entities: [d], x: spot.x, y: spot.y, buildingType: 'barracks' })])
    const events = sim.drainEvents()
    expect(events.some((e) => e.type === 'command-rejected')).toBe(false)
    const queued = sim.world.buildOrderQueues.get(d)
    expect(queued?.length).toBe(1)
    let bid = -1
    sim.world.buildings.forEach((id, b) => {
      if (bid < 0 && b.buildingType === 'barracks' && b.team === 0) bid = id
    })
    expect(bid > 0).toBe(true)
    const b = sim.world.buildings.require(bid)
    expect(b.assignedDozer).toBe(0)
    expect(sim.world.works.get(d)?.building).toBe(firstBid)
    expect(events.some((e) => e.type === 'build-order-queued' && e.building === bid)).toBe(true)
  })

  it('rejects placement when the dozer build queue is full', () => {
    const sim = new Simulator(MAP, SEED, [0])
    const d = dozerId(sim.world)
    sim.world.teamState(0).credits = 1000000
    placePowerPlant(sim, d)
    for (let i = 0; i < 2; i++) {
      const spot = findSpot(sim.world, d)
      sim.step([cmd(sim, 2 + i, { type: 'place', entities: [d], x: spot.x, y: spot.y, buildingType: 'barracks' })])
      sim.drainEvents()
    }
    expect(sim.world.buildOrderQueues.get(d)?.length).toBe(2)
    const spot = findSpot(sim.world, d)
    sim.step([cmd(sim, 5, { type: 'place', entities: [d], x: spot.x, y: spot.y, buildingType: 'barracks' })])
    const events = sim.drainEvents()
    expect(events.some((e) => e.type === 'command-rejected' && e.reason === 'build order queue full')).toBe(true)
  })

  it('auto-starts the next queued building when the current one completes', () => {
    const sim = new Simulator(MAP, SEED, [0])
    const d = dozerId(sim.world)
    placePowerPlant(sim, d)
    const spot = findSpot(sim.world, d)
    sim.step([cmd(sim, 2, { type: 'place', entities: [d], x: spot.x, y: spot.y, buildingType: 'barracks' })])
    sim.drainEvents()
    const queuedBid = sim.world.buildOrderQueues.get(d)![0]
    sim.advance(2000)
    expect(sim.world.buildings.get(queuedBid)?.done).toBe(true)
    expect(sim.world.buildings.require(queuedBid).assignedDozer).toBe(0)
    expect(sim.world.works.has(d)).toBe(false)
    expect(sim.world.buildOrderQueues.get(d)?.length ?? 0).toBe(0)
  })

  it('stop auto-starts the next queued building instead of dropping it', () => {
    const sim = new Simulator(MAP, SEED, [0])
    const d = dozerId(sim.world)
    placePowerPlant(sim, d)
    const spot = findSpot(sim.world, d)
    sim.step([cmd(sim, 2, { type: 'place', entities: [d], x: spot.x, y: spot.y, buildingType: 'barracks' })])
    sim.drainEvents()
    const queuedBid = sim.world.buildOrderQueues.get(d)![0]
    sim.step([cmd(sim, 3, { type: 'stop', entities: [d], x: 0, y: 0 })])
    expect(sim.world.works.has(d)).toBe(true)
    expect(sim.world.works.get(d)?.building).toBe(queuedBid)
    expect(sim.world.buildings.require(queuedBid).assignedDozer).toBe(d)
    expect(sim.world.buildOrderQueues.get(d)?.length ?? 0).toBe(0)
  })

  it('drops a queued order when the building is removed', () => {
    const sim = new Simulator(MAP, SEED, [0])
    const d = dozerId(sim.world)
    placePowerPlant(sim, d)
    const spot = findSpot(sim.world, d)
    sim.step([cmd(sim, 2, { type: 'place', entities: [d], x: spot.x, y: spot.y, buildingType: 'barracks' })])
    sim.drainEvents()
    const q = sim.world.buildOrderQueues.get(d)!
    expect(q.length).toBe(1)
    sim.world.removeEntity(q[0])
    expect(q.length).toBe(0)
  })
})

describe('bulldozer builds the structure', () => {
  it('assigns the dozer, builds over time, and frees it when done', () => {
    const sim = new Simulator(MAP, SEED, [0])
    const d = dozerId(sim.world)
    const bid = placePowerPlant(sim, d)
    const b = sim.world.buildings.require(bid)
    expect(b.done).toBe(false)
    expect(b.assignedDozer).toBe(d)
    expect(sim.world.works.has(d)).toBe(true)

    sim.advance(50)
    expect(sim.world.buildings.require(bid).buildProgress).toBeGreaterThan(0)

    sim.advance(600)
    expect(sim.world.buildings.require(bid).done).toBe(true)
    expect(sim.world.buildings.require(bid).assignedDozer).toBe(0)
    expect(sim.world.works.has(d)).toBe(false)
  })

  it('a busy bulldozer rejects move orders', () => {
    const sim = new Simulator(MAP, SEED, [0])
    const d = dozerId(sim.world)
    placePowerPlant(sim, d)
    sim.step([cmd(sim, 2, { type: 'move', entities: [d], x: 100000, y: 100000 })])
    const events = sim.drainEvents()
    expect(events.some((e) => e.type === 'command-rejected' && e.reason === 'bulldozer is busy')).toBe(true)
  })
})

describe('stopping and resuming construction', () => {
  it('stop cancels the assignment and freezes progress until a build command reassigns the dozer', () => {
    const sim = new Simulator(MAP, SEED, [0])
    const d = dozerId(sim.world)
    const bid = placePowerPlant(sim, d)
    sim.advance(50)
    const prog = sim.world.buildings.require(bid).buildProgress
    expect(prog).toBeGreaterThan(0)

    sim.step([cmd(sim, 2, { type: 'stop', entities: [d], x: 0, y: 0 })])
    expect(sim.world.works.has(d)).toBe(false)
    expect(sim.world.buildings.require(bid).assignedDozer).toBe(0)
    sim.advance(50)
    expect(sim.world.buildings.require(bid).buildProgress).toBeCloseTo(prog, 5)

    sim.step([cmd(sim, 3, { type: 'build', entities: [d], x: 0, y: 0, target: bid })])
    expect(sim.world.works.has(d)).toBe(true)
    expect(sim.world.buildings.require(bid).assignedDozer).toBe(d)
    sim.advance(600)
    expect(sim.world.buildings.require(bid).done).toBe(true)
  })
})

describe('repair', () => {
  it('a bulldozer repairs a damaged finished building, healing in proportion to its build time', () => {
    const sim = new Simulator(MAP, SEED, [0])
    const d = dozerId(sim.world)
    const bid = placePowerPlant(sim, d)
    sim.advance(600)
    expect(sim.world.buildings.require(bid).done).toBe(true)

    const h = sim.world.healths.require(bid)
    h.hp = 200
    sim.step([cmd(sim, 2, { type: 'build', entities: [d], x: 0, y: 0, target: bid })])
    expect(sim.world.works.has(d)).toBe(true)
    sim.advance(50)
    expect(sim.world.healths.require(bid).hp).toBeGreaterThan(200)
    expect(sim.world.works.has(d)).toBe(true)
    sim.advance(600)
    expect(sim.world.healths.require(bid).hp).toBe(h.maxHp)
    expect(sim.world.works.has(d)).toBe(false)
    expect(sim.world.buildings.require(bid).assignedDozer).toBe(0)
  })
})

describe('power tracking', () => {
  it('updates generation/usage totals as buildings are placed and finished', () => {
    const sim = new Simulator(MAP, SEED, [0])
    sim.step()
    const s0 = sim.world.teamState(0)
    expect(s0.powerGen).toBe(10)
    expect(s0.powerUse).toBe(0)

    const d = dozerId(sim.world)
    const bid = placePowerPlant(sim, d)
    sim.advance(5)
    expect(sim.world.teamState(0).powerGen).toBe(10)

    sim.advance(600)
    const s = sim.world.teamState(0)
    expect(s.powerGen).toBe(60)
    expect(s.powerUse).toBe(0)
    expect(s.powerNet).toBe(60)
    expect(s.powerDown).toBe(false)
    void bid
  })

  it('a supply dock adds to power usage and an extra plant keeps it from going down', () => {
    const sim = new Simulator(MAP, SEED, [0])
    sim.step()
    const s0 = sim.world.teamState(0)
    expect(s0.powerGen).toBe(10)

    const d = dozerId(sim.world)
    const bid = placePowerPlant(sim, d)
    sim.advance(600)
    expect(sim.world.teamState(0).powerGen).toBe(60)

    const spot = findSpot(sim.world, d)
    reveal(sim)
    sim.step([cmd(sim, 2, { type: 'place', entities: [d], x: spot.x, y: spot.y, buildingType: 'supply-dock' })])
    sim.advance(600)
    const s = sim.world.teamState(0)
    expect(s.powerGen).toBe(60)
    expect(s.powerUse).toBe(5)
    expect(s.powerNet).toBe(55)
    expect(s.powerDown).toBe(false)
    void bid
  })
})

describe('command center rebuilding', () => {
  it('rejects a second command center via the count limit', () => {
    const sim = new Simulator(MAP, SEED, [0])
    const d = dozerId(sim.world)
    const spot = findSpotFor(sim.world, d, 4, 4)
    reveal(sim)
    sim.step([cmd(sim, 1, { type: 'place', entities: [d], x: spot.x, y: spot.y, buildingType: 'command-center' })])
    const events = sim.drainEvents()
    expect(events.some((e) => e.type === 'command-rejected' && e.reason === 'count limit reached')).toBe(true)
  })

  it('can be sold and rebuilt by the bulldozer', () => {
    const sim = new Simulator(MAP, SEED, [0])
    reveal(sim)
    const cc = ccId(sim.world)
    sim.step([cmd(sim, 1, { type: 'sell', entities: [cc], x: 0, y: 0 })])
    sim.advance(76)
    expect(sim.world.teamState(0).credits).toBe(800 + Math.floor(500 / 2))

    const d = dozerId(sim.world)
    const spot = findSpotFor(sim.world, d, 4, 4)
    sim.step([cmd(sim, 2, { type: 'place', entities: [d], x: spot.x, y: spot.y, buildingType: 'command-center' })])
    expect(sim.world.teamState(0).credits).toBe(800 + 250 - 500)

    const newCc = ccId(sim.world)
    expect(sim.world.buildings.require(newCc).done).toBe(false)
    sim.advance(760)
    expect(sim.world.buildings.require(newCc).done).toBe(true)
    expect(sim.world.teamState(0).powerGen).toBe(10)

    const spot2 = findSpotFor(sim.world, d, 4, 4)
    sim.step([cmd(sim, 3, { type: 'place', entities: [d], x: spot2.x, y: spot2.y, buildingType: 'command-center' })])
    const events = sim.drainEvents()
    expect(events.some((e) => e.type === 'command-rejected' && e.reason === 'count limit reached')).toBe(true)
  })
})

describe('spawn points', () => {
  const passableInRadius = (world: World, cc: number): { x: number; y: number } => {
    world.rebuildGridIfDirty()
    const grid = world.grid!
    const rect = buildingRect(world, cc)
    const minX = rect.x - 2
    const maxX = rect.x + rect.w - 1 + 2
    const minY = rect.y - 2
    const maxY = rect.y + rect.h - 1 + 2
    let best: { x: number; y: number } | null = null
    let bestDist = -1
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (x < 0 || y < 0 || x >= world.width || y >= world.height) continue
        if (!grid.passable[y * world.width + x]) continue
        const dist = Math.max(Math.abs(x - rect.x), Math.abs(y - rect.y))
        if (dist > bestDist) {
          bestDist = dist
          best = { x, y }
        }
      }
    }
    if (!best) throw new Error('no passable tile in radius')
    return best
  }

  it('stores the spawn point and produces the next unit there', () => {
    const sim = new Simulator(MAP, SEED, [0])
    const cc = ccId(sim.world)
    const initialDozer = dozerId(sim.world)
    const spot = passableInRadius(sim.world, cc)

    sim.step([cmd(sim, 1, { type: 'set-spawn-point', entities: [cc], x: spot.x, y: spot.y })])
    const b = sim.world.buildings.require(cc)
    expect(b.spawnTx).toBe(spot.x)
    expect(b.spawnTy).toBe(spot.y)
    expect(sim.drainEvents().some((e) => e.type === 'spawn-point-set' && e.building === cc)).toBe(true)

    sim.step([cmd(sim, 2, { type: 'queue', entities: [cc], x: 0, y: 0, unitType: 'bulldozer' })])
    expect(sim.world.teamState(0).credits).toBe(700)
    sim.advance(130)

    let trained = -1
    sim.world.units.forEach((id, u) => {
      if (trained < 0 && id !== initialDozer && u.team === 0 && u.unitType === 'bulldozer') trained = id
    })
    expect(trained).toBeGreaterThan(0)
    const t = sim.world.transforms.require(trained)
    expect(Math.abs(t.x - (spot.x * 1000 + 500))).toBeLessThan(200)
    expect(Math.abs(t.y - (spot.y * 1000 + 500))).toBeLessThan(200)
  })

  it('clamps far-away spawn points into the radius around the building', () => {
    const sim = new Simulator(MAP, SEED, [0])
    const cc = ccId(sim.world)
    sim.world.rebuildGridIfDirty()
    const grid = sim.world.grid!
    const t = sim.world.transforms.require(cc)
    const cx = Math.floor(t.x / 1000)
    const cy = Math.floor(t.y / 1000)
    let far: { x: number; y: number } | null = null
    let bestDist = -1
    for (let y = 0; y < sim.world.height; y++) {
      for (let x = 0; x < sim.world.width; x++) {
        if (!grid.passable[y * sim.world.width + x]) continue
        const dist = Math.max(Math.abs(x - cx), Math.abs(y - cy))
        if (dist > bestDist) {
          bestDist = dist
          far = { x, y }
        }
      }
    }
    if (!far) throw new Error('no passable tile')
    sim.step([cmd(sim, 1, { type: 'set-spawn-point', entities: [cc], x: far.x, y: far.y })])
    const b = sim.world.buildings.require(cc)
    const rect = buildingRect(sim.world, cc)
    expect(b.spawnTx).toBeGreaterThanOrEqual(rect.x - 2)
    expect(b.spawnTx).toBeLessThanOrEqual(rect.x + rect.w - 1 + 2)
    expect(b.spawnTy).toBeGreaterThanOrEqual(rect.y - 2)
    expect(b.spawnTy).toBeLessThanOrEqual(rect.y + rect.h - 1 + 2)
    expect(b.spawnTx).not.toBe(far.x)
    expect(sim.drainEvents().some((e) => e.type === 'spawn-point-set' && e.building === cc)).toBe(true)
  })

  it('rejects spawn points on blocked terrain and out of bounds', () => {
    const sim = new Simulator(MAP, SEED, [0])
    const cc = ccId(sim.world)
    const rect = buildingRect(sim.world, cc)
    const blockedSpot = { x: rect.x + 1, y: rect.y + 1 }

    sim.step([cmd(sim, 1, { type: 'set-spawn-point', entities: [cc], x: blockedSpot.x, y: blockedSpot.y })])
    expect(sim.drainEvents().some((e) => e.type === 'command-rejected' && e.reason === 'spawn point blocked')).toBe(true)

    sim.step([cmd(sim, 2, { type: 'set-spawn-point', entities: [cc], x: -1, y: -1 })])
    expect(sim.drainEvents().some((e) => e.type === 'command-rejected' && e.reason === 'spawn point out of bounds')).toBe(true)

    const b = sim.world.buildings.require(cc)
    expect(b.spawnTx).toBe(-1)
    expect(b.spawnTy).toBe(-1)
  })

  it('ignores spawn points for non-producer buildings', () => {
    const sim = new Simulator(MAP, SEED, [0])
    const d = dozerId(sim.world)
    const bid = placePowerPlant(sim, d)
    sim.step([cmd(sim, 2, { type: 'set-spawn-point', entities: [bid], x: 10, y: 10 })])
    expect(sim.drainEvents().some((e) => e.type === 'spawn-point-set')).toBe(false)
    expect(sim.world.buildings.require(bid).spawnTx).toBe(-1)
  })
})

describe('flags', () => {
  const farPassableTile = (world: World, cc: number): { x: number; y: number } => {
    world.rebuildGridIfDirty()
    const grid = world.grid!
    const t = world.transforms.require(cc)
    const cx = Math.floor(t.x / 1000)
    const cy = Math.floor(t.y / 1000)
    let best: { x: number; y: number } | null = null
    let bestDist = -1
    for (let y = 0; y < world.height; y++) {
      for (let x = 0; x < world.width; x++) {
        if (!grid.passable[y * world.width + x]) continue
        const dist = Math.max(Math.abs(x - cx), Math.abs(y - cy))
        if (dist > bestDist) {
          bestDist = dist
          best = { x, y }
        }
      }
    }
    if (!best) throw new Error('no passable tile')
    return best
  }

  it('stores the flag anywhere and gives trained units the flag move order', () => {
    const sim = new Simulator(MAP, SEED, [0])
    const cc = ccId(sim.world)
    const initialDozer = dozerId(sim.world)
    const flag = farPassableTile(sim.world, cc)

    sim.step([cmd(sim, 1, { type: 'set-flag-point', entities: [cc], x: flag.x, y: flag.y })])
    const b = sim.world.buildings.require(cc)
    expect(b.flagTx).toBe(flag.x)
    expect(b.flagTy).toBe(flag.y)
    expect(sim.drainEvents().some((e) => e.type === 'flag-point-set' && e.building === cc)).toBe(true)

    sim.step([cmd(sim, 2, { type: 'queue', entities: [cc], x: 0, y: 0, unitType: 'bulldozer' })])
    sim.advance(130)

    let trained = -1
    sim.world.units.forEach((id, u) => {
      if (trained < 0 && id !== initialDozer && u.team === 0 && u.unitType === 'bulldozer') trained = id
    })
    expect(trained).toBeGreaterThan(0)
    const m = sim.world.moves.get(trained)
    expect(m).toBeDefined()
    expect(Math.floor(m!.tx / 1000)).toBe(flag.x)
    expect(Math.floor(m!.ty / 1000)).toBe(flag.y)
  })

  it('rejects flags out of bounds', () => {
    const sim = new Simulator(MAP, SEED, [0])
    const cc = ccId(sim.world)
    const b = sim.world.buildings.require(cc)
    sim.step([cmd(sim, 1, { type: 'set-flag-point', entities: [cc], x: -1, y: -1 })])
    expect(sim.drainEvents().some((e) => e.type === 'command-rejected' && e.reason === 'flag point out of bounds')).toBe(true)
    expect(b.flagTx).toBe(-1)
    expect(b.flagTy).toBe(-1)
  })
})

describe('bulldozer reaches a boxed-in building', () => {
  const footprintFits = (world: World, x: number, y: number, occupied: Array<[number, number, number, number]>): boolean => {
    world.rebuildGridIfDirty()
    const grid = world.grid!
    for (let yy = y; yy < y + 3; yy++) {
      for (let xx = x; xx < x + 3; xx++) {
        if (xx < 0 || yy < 0 || xx >= world.width || yy >= world.height) return false
        if (!grid.buildable[yy * world.width + xx]) return false
      }
    }
    for (const [ox, oy, ow, oh] of occupied) {
      if (x < ox + ow && ox < x + 3 && y < oy + oh && oy < y + 3) return false
    }
    return true
  }

  const ringWalls = (c: { x: number; y: number }): Array<[number, number]> => [
    [c.x - 3, c.y - 3],
    [c.x, c.y - 3],
    [c.x + 3, c.y - 3],
    [c.x + 3, c.y],
    [c.x + 3, c.y + 3],
    [c.x, c.y + 3],
    [c.x - 3, c.y + 3],
    [c.x - 3, c.y],
  ]

  const findRingCenter = (world: World): { x: number; y: number } => {
    world.rebuildGridIfDirty()
    const d = dozerId(world)
    const t = world.transforms.require(d)
    const cx = Math.floor(t.x / 1000)
    const cy = Math.floor(t.y / 1000)
    for (let r = 0; r <= 10; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
          const x = cx + dx
          const y = cy + dy
          if (x < 3 || y < 3 || x >= world.width - 6 || y >= world.height - 6) continue
          const occupied: Array<[number, number, number, number]> = []
          if (!footprintFits(world, x, y, occupied)) continue
          occupied.push([x, y, 3, 3])
          let ok = true
          for (const [wx, wy] of ringWalls({ x, y })) {
            if (!footprintFits(world, wx, wy, occupied)) {
              ok = false
              break
            }
            occupied.push([wx, wy, 3, 3])
          }
          if (ok) return { x, y }
        }
      }
    }
    throw new Error('no ring center found')
  }

  it('completes a building whose whole build pad is boxed in by other buildings', () => {
    const sim = new Simulator(MAP, SEED, [0])
    reveal(sim)
    sim.world.teamState(0).credits = 100000
    const d = dozerId(sim.world)
    const c = findRingCenter(sim.world)

    let seq = 1
    for (const [wx, wy] of ringWalls(c)) {
      sim.step([cmd(sim, seq++, { type: 'place', entities: [d], x: wx, y: wy, buildingType: 'power-plant' })])
      sim.advance(1000)
    }
    let wallsDone = 0
    sim.world.buildings.forEach((_id, b) => {
      if (b.buildingType === 'power-plant' && b.done) wallsDone++
    })
    expect(wallsDone).toBe(8)

    sim.step([cmd(sim, seq++, { type: 'place', entities: [d], x: c.x, y: c.y, buildingType: 'power-plant' })])
    sim.advance(2000)
    let targetDone = false
    sim.world.buildings.forEach((_id, b) => {
      if (b.buildingType !== 'power-plant' || !b.done) return
      const bt = sim.world.transforms.require(_id)
      if (Math.floor(bt.x / 1000) === c.x + 1 && Math.floor(bt.y / 1000) === c.y + 1) targetDone = true
    })
    expect(targetDone).toBe(true)
    expect(sim.world.works.has(d)).toBe(false)
  })
})
