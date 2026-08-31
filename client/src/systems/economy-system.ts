import { sqDist } from '@space-arenas/shared'
import type { World } from '../core/world.ts'
import { setMove } from '../entities/factories.ts'

const passableFx = (world: World, x: number, y: number): boolean => {
  const grid = world.grid
  if (!grid) return true
  const tx = Math.floor(x / 1000)
  const ty = Math.floor(y / 1000)
  if (tx < 0 || ty < 0 || tx >= world.width || ty >= world.height) return false
  return !!grid.passable[ty * world.width + tx]
}

const fieldArrivePoint = (world: World, fieldId: number, harvesterId: number): { x: number; y: number } => {
  const f = world.fields.get(fieldId)
  const fc = world.transforms.get(fieldId)
  const ht = world.transforms.get(harvesterId)
  if (!f || !fc) return { x: 0, y: 0 }
  const r = f.radius
  const fromX = ht ? ht.x : fc.x
  const fromY = ht ? ht.y : fc.y
  const spread = (((harvesterId * 7 + fieldId) % 5) - 2) * 700
  const sides: Array<{ x: number; y: number }> = [
    { x: fc.x - (r + 1) * 1000, y: fc.y },
    { x: fc.x + (r + 1) * 1000, y: fc.y },
    { x: fc.x, y: fc.y - (r + 1) * 1000 },
    { x: fc.x, y: fc.y + (r + 1) * 1000 },
  ]
  sides.sort((a, b) => sqDist(a.x, a.y, fromX, fromY) - sqDist(b.x, b.y, fromX, fromY))
  for (const s of sides) {
    const isEW = Math.abs(s.x - fc.x) > 0
    const c = { x: isEW ? s.x : fc.x + spread, y: isEW ? fc.y + spread : s.y }
    if (passableFx(world, c.x, c.y)) return c
  }
  return sides[0]
}

export const dockArrivePoint = (world: World, dockId: number, harvesterId: number): { x: number; y: number } | null => {
  const b = world.buildings.get(dockId)
  const dp = world.transforms.get(dockId)
  const ht = world.transforms.get(harvesterId)
  if (!b || !dp || !ht) return null
  const hx = (b.footprintW * 1000) / 2
  const hy = (b.footprintH * 1000) / 2
  const spread = (((harvesterId * 7 + dockId) % 5) - 2) * 600
  const sides: Array<{ x: number; y: number }> = [
    { x: dp.x - hx - 500, y: dp.y },
    { x: dp.x + hx + 500, y: dp.y },
    { x: dp.x, y: dp.y - hy - 500 },
    { x: dp.x, y: dp.y + hy + 500 },
  ]
  sides.sort((a, b) => sqDist(a.x, a.y, ht.x, ht.y) - sqDist(b.x, b.y, ht.x, ht.y))
  for (const s of sides) {
    const isEW = Math.abs(s.x - dp.x) > 0
    const c = { x: isEW ? s.x : dp.x + spread, y: isEW ? dp.y + spread : s.y }
    if (passableFx(world, c.x, c.y)) return c
  }
  return null
}

const nearestField = (world: World, fromX: number, fromY: number): number => {
  let best = -1
  let bestD = Infinity
  world.fields.forEach((id, f) => {
    if (f.trips <= 0) return
    const t = world.transforms.get(id)
    if (!t) return
    const d = sqDist(fromX, fromY, t.x, t.y)
    if (d < bestD) {
      bestD = d
      best = id
    }
  })
  return best
}

export const EconomySystem = {
  name: 'Economy',
  update(world: World): void {
    world.rebuildGridIfDirty()
    world.harvesters.forEach((id, hv) => {
      const u = world.units.get(id)
      const t = world.transforms.get(id)
      if (!u || !t) return
      const dockAlive = world.isAlive(hv.dock)

      switch (hv.phase) {
        case 'idle': {
          if (!dockAlive) return
          const field = nearestField(world, t.x, t.y)
          if (field < 0) return
          const f = world.fields.get(field)
          if (!f || f.trips <= 0) return
          hv.field = field
          const p = fieldArrivePoint(world, field, id)
          hv.phase = 'to-field'
          const m = setMove(world, id, p.x, p.y)
          m.needsPath = true
          break
        }
        case 'to-field': {
          if (!dockAlive || !world.isAlive(hv.field)) {
            hv.phase = 'idle'
            world.moves.delete(id)
            break
          }
          const f = world.fields.get(hv.field)
          const fc = world.transforms.get(hv.field)
          if (!f || !fc || f.trips <= 0) {
            hv.phase = 'idle'
            world.moves.delete(id)
            break
          }
          const half = f.radius * 1000 + 500
          const inPad = Math.abs(t.x - fc.x) <= half + 1500 && Math.abs(t.y - fc.y) <= half + 1500
          if (!world.moves.has(id) || inPad) {
            world.moves.delete(id)
            hv.phase = 'loading'
            hv.loadTicks = 0
          }
          break
        }
        case 'loading': {
          hv.loadTicks++
          if (hv.loadTicks >= world.settings.harvesterLoadTicks) {
            const f = world.fields.get(hv.field)
            if (f && f.trips > 0) f.trips--
            const dockPos = world.transforms.get(hv.dock)
            if (dockPos) {
              hv.phase = 'to-dock'
              const p = dockArrivePoint(world, hv.dock, id)
              if (!p) {
                hv.phase = 'idle'
                break
              }
              const m = setMove(world, id, p.x, p.y)
              m.needsPath = true
            } else {
              hv.phase = 'idle'
            }
          }
          break
        }
        case 'to-dock': {
          if (!dockAlive) {
            hv.phase = 'idle'
            world.moves.delete(id)
            break
          }
          const b = world.buildings.get(hv.dock)
          const dockPos = world.transforms.get(hv.dock)
          if (!b || !dockPos) {
            hv.phase = 'idle'
            world.moves.delete(id)
            break
          }
          const halfX = (b.footprintW * 1000) / 2
          const halfY = (b.footprintH * 1000) / 2
          const inPad = Math.abs(t.x - dockPos.x) <= halfX + 1500 && Math.abs(t.y - dockPos.y) <= halfY + 1500
          if (inPad) {
            world.moves.delete(id)
            hv.phase = 'idle'
            const s = world.teamState(u.team)
            const perTrip = world.settings.supplyPerTrip
            s.credits += perTrip
            world.emit({ type: 'supply-harvested', team: u.team, amount: perTrip })
            break
          }
          if (!world.moves.has(id)) {
            const p = dockArrivePoint(world, hv.dock, id)
            if (!p) break
            const m = setMove(world, id, p.x, p.y)
            m.needsPath = true
          }
          break
        }
      }
    })
  },
}
