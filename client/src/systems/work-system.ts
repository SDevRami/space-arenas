import { BUILDER_REPAIR_PER_TICK, getBuilding, getUnit, isqrt, sqDist } from '@space-arenas/shared'
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

const nearestPassableFx = (world: World, cx: number, cy: number, maxRadius: number): { x: number; y: number } | null => {
  const grid = world.grid
  if (!grid) return null
  for (let r = 1; r <= maxRadius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
        const nx = cx + dx
        const ny = cy + dy
        if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height) continue
        if (grid.passable[ny * world.width + nx]) return { x: nx * 1000 + 500, y: ny * 1000 + 500 }
      }
    }
  }
  return null
}

const workPad = (world: World): number => world.settings.workPadDistance * 1000

const workArrivePoint = (world: World, buildingId: number, dozerId: number): { x: number; y: number } | null => {
  const b = world.buildings.get(buildingId)
  const bt = world.transforms.get(buildingId)
  const t = world.transforms.get(dozerId)
  if (!b || !bt || !t) return null
  const pad = workPad(world)
  const halfX = b.footprintW * 500
  const halfY = b.footprintH * 500
  const sides: Array<{ x: number; y: number }> = [
    { x: bt.x - halfX - pad, y: bt.y },
    { x: bt.x + halfX + pad, y: bt.y },
    { x: bt.x, y: bt.y - halfY - pad },
    { x: bt.x, y: bt.y + halfY + pad },
  ]
  sides.sort((a, b2) => sqDist(a.x, a.y, t.x, t.y) - sqDist(b2.x, b2.y, t.x, t.y))
  for (const s of sides) {
    if (passableFx(world, s.x, s.y)) return s
  }
  const corners: Array<{ x: number; y: number }> = [
    { x: bt.x - halfX - pad, y: bt.y - halfY - pad },
    { x: bt.x + halfX + pad, y: bt.y - halfY - pad },
    { x: bt.x - halfX - pad, y: bt.y + halfY + pad },
    { x: bt.x + halfX + pad, y: bt.y + halfY + pad },
  ]
  for (const s of corners) {
    if (passableFx(world, s.x, s.y)) return s
  }
  const near = nearestPassableFx(world, Math.floor(bt.x / 1000), Math.floor(bt.y / 1000), 10)
  if (near) return near
  return sides[0]
}

export const WorkSystem = {
  name: 'Work',
  update(world: World): void {
    world.rebuildGridIfDirty()

    world.buildings.forEach((_id, b) => {
      if (b.assignedDozer !== 0 && !world.isAlive(b.assignedDozer)) {
        b.assignedDozer = 0
      }
    })

    world.works.forEach((id, w) => {
      const b = world.buildings.get(w.building)
      if (!b || b.assignedDozer !== id) {
        world.works.delete(id)
        world.moves.delete(id)
      }
    })

    world.works.forEach((id, w) => {
      const u = world.units.get(id)
      const t = world.transforms.get(id)
      const b = world.buildings.get(w.building)
      const bt = world.transforms.get(w.building)
      if (!u || !t || !b || !bt) {
        world.works.delete(id)
        world.moves.delete(id)
        return
      }
      if (w.kind === 'construct' && b.done) {
        b.assignedDozer = 0
        world.works.delete(id)
        world.moves.delete(id)
        return
      }
      if (w.kind === 'repair') {
        const h = world.healths.get(w.building)
        if (!h || h.hp >= h.maxHp) {
          b.assignedDozer = 0
          world.works.delete(id)
          world.moves.delete(id)
          return
        }
      }
      const halfX = b.footprintW * 500
      const halfY = b.footprintH * 500
      const pad = workPad(world)
      // strictWorkArrival (dev setting): padded-box acceptance additionally requires the
      // dozer's tile to touch the target footprint — stops a dozer from grinding against
      // a NEIGHBOURING building when its path ended on a fallback tile nearby.
      const strict = world.settings.strictWorkArrival >= 1
      let inPad = Math.abs(t.x - bt.x) <= halfX + pad && Math.abs(t.y - bt.y) <= halfY + pad
      if (strict && inPad) {
        const dtx = Math.floor(t.x / 1000)
        const dty = Math.floor(t.y / 1000)
        const x0 = Math.floor((bt.x - halfX) / 1000)
        const x1 = Math.ceil((bt.x + halfX) / 1000) - 1
        const y0 = Math.floor((bt.y - halfY) / 1000)
        const y1 = Math.ceil((bt.y + halfY) / 1000) - 1
        const touchesTarget =
          dtx >= x0 - 1 && dtx <= x1 + 1 && dty >= y0 - 1 && dty <= y1 + 1 &&
          !(dtx >= x0 && dtx <= x1 && dty >= y0 && dty <= y1)
        if (!touchesTarget) inPad = false
      }
      const p = workArrivePoint(world, w.building, id)
      const arrived = p !== null && isqrt(sqDist(t.x, t.y, p.x, p.y)) <= u.speed * 2
      if (!inPad && !arrived) {
        if (!world.moves.has(id) && p) {
          const m = setMove(world, id, p.x, p.y)
          m.needsPath = true
        }
        return
      }
      world.moves.delete(id)

      if (w.kind === 'construct') {
        const def = getBuilding(b.buildingType, world.settings)
        if (def.buildTimeTicks <= 0) {
          b.buildProgress = 1
          b.done = true
        } else {
          b.buildProgress += 1 / def.buildTimeTicks
          if (b.buildProgress >= 1) {
            b.buildProgress = 1
            b.done = true
          }
        }
        if (b.done) {
          b.assignedDozer = 0
          world.works.delete(id)
          world.emit({ type: 'building-completed', entity: w.building, buildingType: b.buildingType, team: b.team })
          if (def.producesUnit === 'harvester') {
            const q = world.queues.get(w.building)
            const list = q ? q.queue : []
            if (list.length < world.settings.queueLimit) {
              const hud = getUnit('harvester', world.settings)
              list.push({ unitType: 'harvester', remainingTicks: hud.buildTimeTicks })
              world.queues.set(w.building, { queue: list })
            }
          }
        }
      } else {
        const h = world.healths.require(w.building)
        const def = getBuilding(b.buildingType, world.settings)
        const perTick = def.buildTimeTicks > 0 ? (h.maxHp / def.buildTimeTicks) * (world.settings.builderRepairPerTick / BUILDER_REPAIR_PER_TICK) : h.maxHp
        h.hp = Math.min(h.maxHp, h.hp + Math.max(1, perTick))
      }
    })
  },
}
