import { describe, expect, it } from 'vitest'
import { createEmptyMap } from '@space-arenas/shared'
import { Simulator } from '../client/src/core/Simulator.ts'
import { setMove, spawnBuilding, spawnUnit } from '../client/src/entities/factories.ts'

const makeSim = (): Simulator => new Simulator(createEmptyMap(64, 64), 0x1234abcd, [0])

const tileCenter = (tx: number, ty: number): { x: number; y: number } => ({ x: tx * 1000 + 500, y: ty * 1000 + 500 })

const orderMove = (sim: Simulator, unitId: number, tx: number, ty: number): void => {
  const p = tileCenter(tx, ty)
  const m = setMove(sim.world, unitId, p.x, p.y)
  m.needsPath = true
}

const distTo = (sim: Simulator, unitId: number, tx: number, ty: number): number => {
  const t = sim.world.transforms.require(unitId)
  const p = tileCenter(tx, ty)
  return Math.hypot(t.x - p.x, t.y - p.y)
}

const placeWall = (sim: Simulator, tx: number, ty: number, footprintW = 3, footprintH = 3): void => {
  spawnBuilding(sim.world, 'power-plant', 0, tx, ty, true)
  void footprintW
  void footprintH
}

describe('units round buildings instead of freezing at the footprint edge', () => {
  it('walks behind a building that blocks the straight line', () => {
    const sim = makeSim()
    placeWall(sim, 20, 20)
    const unit = spawnUnit(sim.world, 'rifleman', 0, 16500, 20500)
    orderMove(sim, unit, 24, 20)
    sim.advance(1500)
    const t = sim.world.transforms.require(unit)
    expect(sim.world.moves.has(unit)).toBe(false)
    expect(distTo(sim, unit, 24, 20)).toBeLessThan(1500)
    void t
  })

  it('rounds a building corner when ordered diagonally past it', () => {
    const sim = makeSim()
    placeWall(sim, 20, 20)
    const unit = spawnUnit(sim.world, 'rifleman', 0, 17500, 17500)
    orderMove(sim, unit, 23, 23)
    sim.advance(1500)
    expect(sim.world.moves.has(unit)).toBe(false)
    expect(distTo(sim, unit, 23, 23)).toBeLessThan(1500)
  })

  it('passes through a one-tile gap between two buildings', () => {
    const sim = makeSim()
    placeWall(sim, 18, 18)
    placeWall(sim, 22, 18)
    const unit = spawnUnit(sim.world, 'rifleman', 0, 17500, 21500)
    orderMove(sim, unit, 22, 24)
    sim.advance(1500)
    expect(sim.world.moves.has(unit)).toBe(false)
    expect(distTo(sim, unit, 22, 24)).toBeLessThan(1500)
  })

  it('navigates around an L-shaped cluster of buildings', () => {
    const sim = makeSim()
    placeWall(sim, 18, 18)
    placeWall(sim, 18, 21)
    const unit = spawnUnit(sim.world, 'rifleman', 0, 16500, 16500)
    orderMove(sim, unit, 23, 23)
    sim.advance(1500)
    expect(sim.world.moves.has(unit)).toBe(false)
    expect(distTo(sim, unit, 23, 23)).toBeLessThan(1500)
  })

  it('reaches a point in the far ring tile diagonally past the corner', () => {
    const sim = makeSim()
    placeWall(sim, 20, 20)
    const unit = spawnUnit(sim.world, 'rifleman', 0, 16500, 16500)
    orderMove(sim, unit, 23, 23)
    sim.advance(1500)
    expect(sim.world.moves.has(unit)).toBe(false)
    expect(distTo(sim, unit, 23, 23)).toBeLessThan(1500)
  })

  it('a chaser reaches weapon range of an enemy building', () => {
    const sim = makeSim()
    const target = spawnBuilding(sim.world, 'power-plant', 1, 20, 20, true)
    const unit = spawnUnit(sim.world, 'rifleman', 0, 16500, 20500)
    sim.world.attacks.require(unit).target = target
    sim.advance(1500)
    if (sim.world.isAlive(target)) {
      const t = sim.world.transforms.require(unit)
      const tt = sim.world.transforms.require(target)
      const d = Math.hypot(t.x - tt.x, t.y - tt.y)
      expect(d).toBeLessThan(7000)
    } else {
      expect(sim.world.healths.has(target)).toBe(false)
    }
  })

  it('a unit ordered into a pocket must round the outer corner of two adjacent buildings', () => {
    const sim = makeSim()
    placeWall(sim, 18, 18)
    placeWall(sim, 18, 21)
    const unit = spawnUnit(sim.world, 'rifleman', 0, 24500, 15500)
    orderMove(sim, unit, 17, 23)
    sim.advance(1500)
    expect(sim.world.moves.has(unit)).toBe(false)
    expect(distTo(sim, unit, 17, 23)).toBeLessThan(1500)
  })

  it('two units ordered past the same building do not deadlock', () => {
    const sim = makeSim()
    placeWall(sim, 20, 20)
    const a = spawnUnit(sim.world, 'rifleman', 0, 15500, 18500)
    const b = spawnUnit(sim.world, 'rifleman', 0, 16500, 19500)
    orderMove(sim, a, 25, 23)
    orderMove(sim, b, 25, 23)
    sim.advance(2000)
    expect(distTo(sim, a, 25, 23)).toBeLessThan(1500)
    expect(distTo(sim, b, 25, 23)).toBeLessThan(1500)
  })

  it('rounds a wall of two adjacent buildings', () => {
    const sim = makeSim()
    placeWall(sim, 20, 20)
    placeWall(sim, 20, 23)
    const unit = spawnUnit(sim.world, 'rifleman', 0, 16500, 21500)
    orderMove(sim, unit, 24, 21)
    sim.advance(2500)
    expect(sim.world.moves.has(unit)).toBe(false)
    expect(distTo(sim, unit, 24, 21)).toBeLessThan(1500)
  })

  it('routes around a diagonal-only gap instead of getting stuck', () => {
    const sim = makeSim()
    placeWall(sim, 18, 18)
    placeWall(sim, 21, 21)
    const unit = spawnUnit(sim.world, 'rifleman', 0, 16500, 16500)
    orderMove(sim, unit, 24, 24)
    sim.advance(2000)
    expect(sim.world.moves.has(unit)).toBe(false)
    expect(distTo(sim, unit, 24, 24)).toBeLessThan(1500)
  })

  it('reaches a point inside a U-shaped pocket', () => {
    const sim = makeSim()
    placeWall(sim, 18, 18)
    placeWall(sim, 18, 21)
    placeWall(sim, 21, 18)
    const unit = spawnUnit(sim.world, 'rifleman', 0, 16500, 15500)
    orderMove(sim, unit, 20, 23)
    sim.advance(2000)
    expect(sim.world.moves.has(unit)).toBe(false)
    expect(distTo(sim, unit, 20, 23)).toBeLessThan(1500)
  })

  it('rounds a building parked against the map edge', () => {
    const sim = makeSim()
    placeWall(sim, 1, 20)
    const unit = spawnUnit(sim.world, 'rifleman', 0, 15500, 21500)
    orderMove(sim, unit, 5, 21)
    sim.advance(2000)
    expect(sim.world.moves.has(unit)).toBe(false)
    expect(distTo(sim, unit, 5, 21)).toBeLessThan(1500)
  })

  it('a bulldozer can construct a building slotted between two finished buildings', () => {
    const sim = makeSim()
    placeWall(sim, 18, 20)
    placeWall(sim, 24, 20)
    const dozer = spawnUnit(sim.world, 'bulldozer', 0, 20500, 24500)
    sim.world.teams.get(0)!.credits = 100000
    const slot = 21
    sim.step([
      { player: 0, seq: 1, tick: sim.tick, cmd: { type: 'place', entities: [dozer], x: slot, y: 20, buildingType: 'power-plant' } },
    ])
    sim.advance(2000)
    let built = false
    sim.world.buildings.forEach((_id, b) => {
      if (b.buildingType === 'power-plant' && b.done && b.team === 0) built = true
    })
    expect(built).toBe(true)
    expect(sim.world.works.has(dozer)).toBe(false)
  })

  it('a whole squad rounds a building without any member deadlocking at the corner', () => {
    const sim = makeSim()
    placeWall(sim, 20, 20)
    const ids: number[] = []
    for (let i = 0; i < 7; i++) {
      const unit = spawnUnit(sim.world, 'rifleman', 0, 15500 + (i % 3) * 800, 19500 + Math.floor(i / 3) * 800)
      ids.push(unit)
    }
    for (const id of ids) orderMove(sim, id, 26, 23)
    sim.advance(4000)
    for (const id of ids) {
      expect(distTo(sim, id, 26, 23)).toBeLessThan(2000)
    }
  })

  it('a squad sent through a one-tile corridor never deadlocks inside it', () => {
    const sim = makeSim()
    placeWall(sim, 18, 18)
    placeWall(sim, 22, 18)
    placeWall(sim, 18, 24)
    placeWall(sim, 22, 24)
    const ids: number[] = []
    for (let i = 0; i < 6; i++) {
      const unit = spawnUnit(sim.world, 'rifleman', 0, 19500, 15500 + i * 900)
      ids.push(unit)
    }
    for (const id of ids) orderMove(sim, id, 20, 27)
    sim.advance(4000)
    let arrived = 0
    for (const id of ids) {
      if (distTo(sim, id, 20, 27) < 2000) arrived++
    }
    expect(arrived).toBe(ids.length)
  })

  it('formation points that land on a building do not strand units at the footprint edge', () => {
    const sim = makeSim()
    placeWall(sim, 20, 20)
    const ids: number[] = []
    for (let i = 0; i < 7; i++) {
      const unit = spawnUnit(sim.world, 'rifleman', 0, 15500 + (i % 3) * 800, 20500 + Math.floor(i / 3) * 800)
      ids.push(unit)
    }
    const cell = 1400
    const cols = 3
    const rowsN = Math.ceil(ids.length / cols)
    for (let i = 0; i < ids.length; i++) {
      const col = i % cols
      const row = Math.floor(i / cols)
      const dx = Math.floor((col - (cols - 1) / 2) * cell)
      const dy = Math.floor((row - (rowsN - 1) / 2) * cell)
      orderMove(sim, ids[i], Math.floor((23500 + dx) / 1000), Math.floor((20500 + dy) / 1000))
    }
    sim.advance(4000)
    for (const id of ids) {
      const t = sim.world.transforms.require(id)
      const tx = Math.floor(t.x / 1000)
      const ty = Math.floor(t.y / 1000)
      expect(tx >= 20 && tx <= 22 && ty >= 20 && ty <= 22).toBe(false)
    }
  })

  it('a move target inside a building footprint resolves to a standable point', () => {
    const sim = makeSim()
    placeWall(sim, 20, 20)
    const unit = spawnUnit(sim.world, 'rifleman', 0, 16500, 20500)
    sim.step([
      { player: 0, seq: 1, tick: sim.tick, cmd: { type: 'move', entities: [unit], x: 21500, y: 21500 } },
    ])
    const m = sim.world.moves.require(unit)
    const inFootprint = (x: number, y: number): boolean =>
      Math.floor(x / 1000) >= 20 && Math.floor(x / 1000) <= 22 && Math.floor(y / 1000) >= 20 && Math.floor(y / 1000) <= 22
    expect(inFootprint(m.tx, m.ty)).toBe(false)
    sim.advance(1500)
    expect(sim.world.moves.has(unit)).toBe(false)
    const t = sim.world.transforms.require(unit)
    expect(inFootprint(t.x, t.y)).toBe(false)
    expect(Math.hypot(t.x - 21500, t.y - 21500)).toBeLessThan(3500)
  })
})
