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

// True when the point (x,y) is on a tile that touches the target footprint
// (Chebyshev distance 1 ring around its footprint, not inside it). Used to reject
// a dozer that has only reached a NEIGHBOURING building's border rather than the
// actual structure it is assigned to build.
const touchesFootprint = (
  x: number,
  y: number,
  b: { footprintW: number; footprintH: number },
  bt: { x: number; y: number },
): boolean => {
  const dtx = Math.floor(x / 1000)
  const dty = Math.floor(y / 1000)
  const x0 = Math.floor((bt.x - b.footprintW * 500) / 1000)
  const x1 = Math.ceil((bt.x + b.footprintW * 500) / 1000) - 1
  const y0 = Math.floor((bt.y - b.footprintH * 500) / 1000)
  const y1 = Math.ceil((bt.y + b.footprintH * 500) / 1000) - 1
  return (
    dtx >= x0 - 1 && dtx <= x1 + 1 && dty >= y0 - 1 && dty <= y1 + 1 &&
    !(dtx >= x0 && dtx <= x1 && dty >= y0 && dty <= y1)
  )
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
      if (w.kind === 'collect' || w.kind === 'repair-unit') return
      const b = world.buildings.get(w.building)
      if (!b || b.assignedDozer !== id) {
        world.works.delete(id)
        world.moves.delete(id)
      }
    })

    world.works.forEach((id, w) => {
      const u = world.units.get(id)
      const t = world.transforms.get(id)
      if (!u || !t) {
        world.works.delete(id)
        world.moves.delete(id)
        return
      }
      if (world.empStunned(id)) return
      if (w.kind === 'collect') {
        const wc = world.wrecks.get(w.building)
        const wt = world.wrecks.get(w.building) ? world.transforms.get(w.building) : null
        if (!wc || !wt) {
          world.works.delete(id)
          world.moves.delete(id)
          return
        }
        const arrived = isqrt(sqDist(t.x, t.y, wt.x, wt.y)) <= u.speed * 2 + 400
        if (!arrived) {
          if (!world.moves.has(id)) {
            const m = setMove(world, id, wt.x, wt.y)
            m.needsPath = true
          }
          return
        }
        world.moves.delete(id)
        w.collectTicks = (w.collectTicks ?? 0) + 1
        if (w.collectTicks >= world.settings.wreckCollectTicks) {
          const ws = world.teams.get(u.team)
          if (ws) ws.credits += wc.value
          world.emit({ type: 'wreck-collected', entity: w.building, team: u.team, value: wc.value })
          world.removeEntity(w.building)
          world.works.delete(id)
          world.moves.delete(id)
        }
        return
      }
      if (w.kind === 'repair-unit') {
        const tu = world.units.get(w.building)
        const tt = world.transforms.get(w.building)
        if (!tu || !tt) {
          world.works.delete(id)
          world.moves.delete(id)
          return
        }
        const th = world.healths.get(w.building)
        if (!th || th.hp >= th.maxHp) {
          world.works.delete(id)
          world.moves.delete(id)
          return
        }
        // The engineer keeps chasing a moving ally until it is inside the heal
        // range, then stands and heals it every tick.
        const healRangeFx = world.settings.engineerHealRange * 1000
        if (isqrt(sqDist(t.x, t.y, tt.x, tt.y)) > healRangeFx) {
          const m = world.moves.get(id) ?? setMove(world, id, tt.x, tt.y)
          m.tx = tt.x
          m.ty = tt.y
          m.needsPath = true
          return
        }
        world.moves.delete(id)
        th.hp = Math.min(th.maxHp, th.hp + world.settings.engineerHealPerTick)
        world.healFlashes.set(w.building, { healTick: world.tick })
        return
      }
      const b = world.buildings.get(w.building)
      const bt = world.transforms.get(w.building)
      if (!b || !bt) {
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
      const p = workArrivePoint(world, w.building, id)
      // Precise arrival: the dozer has reached its assigned work pad point.
      const arrived = p !== null && isqrt(sqDist(t.x, t.y, p.x, p.y)) <= u.speed * 2
      // Precise touch: the dozer's tile is adjacent to the target footprint. This
      // is what stops a dozer from stopping at a NEIGHBOURING building's border
      // while still marching — it must actually touch the assigned structure.
      const touches = touchesFootprint(t.x, t.y, b, bt)
      // Stuck: the dozer can't get any closer to its pad point (blocked by
      // neighbours/terrain). Count consecutive ticks that make no progress and
      // treat it as arrived once it has been unable to advance for a while — this
      // keeps boxed-in buildings buildable without relying on a lenient box.
      const dToPad = p ? isqrt(sqDist(t.x, t.y, p.x, p.y)) : 0
      const prev = w.lastPadDist ?? -1
      const improved = prev < 0 || dToPad < prev
      if (improved) {
        w.stuckTicks = 0
      } else if (dToPad > 0) {
        w.stuckTicks = (w.stuckTicks ?? 0) + 1
      }
      w.lastPadDist = dToPad
      const stuck = dToPad > 0 && (w.stuckTicks ?? 0) >= world.settings.workStuckTicks
      if (!arrived && !touches && !stuck) {
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
              list.push({ id: world.allocId(), unitType: 'harvester', remainingTicks: hud.buildTimeTicks })
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
