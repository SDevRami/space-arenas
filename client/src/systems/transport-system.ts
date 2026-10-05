import { getUnit, isqrt, sqDist } from '@space-arenas/shared'
import type { PassengerRecord, TransportComp, World } from '../core/world.ts'
import { nearestPassablePoint } from '../core/pathfinding.ts'
import { setMove, spawnUnit } from '../entities/factories.ts'

/** An unload starts once the APC gets within this many fx units of the point.
 * Kept above the vehicle/infantry separation floor (SEP_VEHICLE 1900) so newly
 * dropped passengers pushing the APC around cannot interrupt one-per-tick
 * disembarking; riders only start when the APC has actually driven over. */
const UNLOAD_RANGE = 2800
/** Fx spacing between passengers in the drop-off grid around the unload point. */
const UNLOAD_SPACING = 800
/** A queued rider boards as soon as the APC comes within this distance.
 * Slightly above the vehicle/infantry separation floor (SEP_VEHICLE 1900) so
 * riders can actually reach the ramp instead of being held apart forever. */
const BOARD_RANGE = 2400

const resolveUnloadPoint = (world: World, x: number, y: number): { x: number; y: number } => {
  const grid = world.grid
  if (!grid) return { x, y }
  const tx = Math.floor(x / 1000)
  const ty = Math.floor(y / 1000)
  if (tx >= 0 && ty >= 0 && tx < world.width && ty < world.height && grid.passable[ty * world.width + tx]) {
    return { x, y }
  }
  const p = nearestPassablePoint(grid, tx, ty)
  return p ?? { x, y }
}

/** Compact grid slots around a center, mirroring the other order formations. */
const unloadSlots = (count: number, cx: number, cy: number): { x: number; y: number }[] => {
  if (count <= 0) return []
  const cols = Math.ceil(Math.sqrt(count))
  const rows = Math.ceil(count / cols)
  const slots: { x: number; y: number }[] = []
  for (let i = 0; i < count; i++) {
    const col = i % cols
    const row = Math.floor(i / cols)
    const dx = Math.floor((col - (cols - 1) / 2) * UNLOAD_SPACING)
    const dy = Math.floor((row - (rows - 1) / 2) * UNLOAD_SPACING)
    slots.push({ x: cx + dx, y: cy + dy })
  }
  return slots
}

/** Formation target for one passenger marching toward a shared point after a
 *  bunker unload — each gets its own slot so a squad spreads instead of piling
 *  onto the exact same spot (same grid layout as a multi-unit move order). */
const marchSlot = (index: number, total: number, cx: number, cy: number): { x: number; y: number } => {
  if (total <= 0) return { x: cx, y: cy }
  const cell = 1400
  const cols = Math.ceil(Math.sqrt(total))
  const rows = Math.ceil(total / cols)
  const col = index % cols
  const row = Math.floor(index / cols)
  return {
    x: cx + Math.floor((col - (cols - 1) / 2) * cell),
    y: cy + Math.floor((row - (rows - 1) / 2) * cell),
  }
}

/** Restore a passenger record into the world at a position and report the spawn. */
const spawnUnloaded = (world: World, transportId: number, tc: TransportComp, rec: PassengerRecord, x: number, y: number): number => {
  const sid = spawnUnit(world, rec.unitType, tc.team, x, y)
  const h = world.healths.get(sid)
  if (h) {
    h.maxHp = rec.maxHp > 0 ? rec.maxHp : h.maxHp
    h.hp = Math.max(1, Math.min(rec.hp, h.maxHp))
  }
  const su = world.units.get(sid)
  if (su) {
    su.killCount = rec.killCount
    su.veteranRank = rec.veteranRank
    su.stealth = rec.stealth
    su.abilityCooldown = rec.abilityCooldown
    su.formationSpread = rec.formationSpread
    su.relativeFormation = rec.relativeFormation
  }
  const sa = world.attacks.get(sid)
  if (sa) sa.autoFire = rec.autoFire
  world.emit({ type: 'unit-unloaded', entity: sid, transport: transportId, unitType: rec.unitType, team: tc.team })
  return sid
}

/** Queued riders still waiting keep walking to the APC's current spot. */
const issueWalkMoves = (world: World, tc: TransportComp, ax: number, ay: number): void => {
  for (const rid of tc.loadQueue) {
    if (world.moves.has(rid)) continue
    const r = setMove(world, rid, ax, ay, false)
    r.needsPath = true
  }
}

/** Board the nearest in-range queued rider and remove it from the world. */
const boardRider = (world: World, transportId: number, tc: TransportComp, rid: number): void => {
  const u = world.units.require(rid)
  const h = world.healths.get(rid)
  const def = getUnit(u.unitType, world.settings)
  tc.passengers.push({
    unitType: u.unitType,
    hp: h?.hp ?? def.hp,
    maxHp: h?.maxHp ?? def.hp,
    killCount: u.killCount,
    veteranRank: u.veteranRank,
    stealth: u.stealth,
    abilityCooldown: u.abilityCooldown,
    formationSpread: u.formationSpread,
    relativeFormation: u.relativeFormation,
    autoFire: world.attacks.get(rid)?.autoFire ?? true,
  })
  const idx = tc.loadQueue.indexOf(rid)
  if (idx >= 0) tc.loadQueue.splice(idx, 1)
  world.moves.delete(rid)
  world.emit({ type: 'unit-loaded', entity: rid, transport: transportId, unitType: u.unitType, team: tc.team })
  world.removeEntity(rid)
}

export const TransportSystem = {
  name: 'Transport',
  update(world: World): void {
    world.transports.forEach((id, tc) => {
      const t = world.transforms.get(id)
      if (!t) return
      // Buildings (e.g. the bunker garrison) are static transports: riders walk
      // to the nearest passable point on the footprint edge and board there, and
      // there is no "drive out to meet them" step.
      const isBuilding = world.buildings.has(id)
      const boardAnchor = isBuilding ? resolveUnloadPoint(world, t.x, t.y) : { x: t.x, y: t.y }
      // Drop queued riders that were killed before they could board.
      if (tc.loadQueue.length > 0) {
        tc.loadQueue = tc.loadQueue.filter((rid) => world.units.has(rid) && world.transforms.has(rid))
      }

      // 11.1/refine — boarding: riders walk to the APC (one boards per tick),
      // and when the closest one is still far the APC drives out to meet it.
      if (tc.loadQueue.length > 0) {
        const capacity = world.transportCapacityOf(id)
        const available = capacity - tc.passengers.length
        if (available > 0) {
          let best = -1
          let bestDist = Infinity
          for (const rid of tc.loadQueue) {
            const rt = world.transforms.get(rid)
            if (!rt) continue
            const d = isqrt(sqDist(t.x, t.y, rt.x, rt.y))
            if (d < bestDist) {
              bestDist = d
              best = rid
            }
          }
          if (best >= 0) {
            if (bestDist <= BOARD_RANGE) {
              boardRider(world, id, tc, best)
            } else if (!tc.pendingUnload && !isBuilding) {
              const rt = world.transforms.require(best)
              const mp = resolveUnloadPoint(world, rt.x, rt.y)
              const m = setMove(world, id, mp.x, mp.y, false)
              m.needsPath = true
            }
          }
        }
        if (!tc.pendingUnload) issueWalkMoves(world, tc, boardAnchor.x, boardAnchor.y)
      }

      // 11.3 — a pending unload: drive to the drop-off point, then step off one
      // passenger per tick into a stable grid around the point. A static garrison
      // building (bunker) cannot drive anywhere, so it steps its troops off
      // around its own footprint first and then marches each to its own slot
      // around the requested point (same formation layout as a move order).
      if (!tc.pendingUnload) return
      if (tc.passengers.length === 0) {
        tc.pendingUnload = false
        tc.pendingOne = -1
        tc.unloadCount = 0
        return
      }
      // Click-to-eject: drop just that one passenger right next to the transport.
      if (tc.pendingOne >= 0) {
        world.moves.delete(id)
        const mp = isBuilding
          ? resolveUnloadPoint(world, t.x, t.y)
          : resolveUnloadPoint(world, tc.unloadX, tc.unloadY)
        const rec = tc.passengers.splice(Math.min(tc.pendingOne, tc.passengers.length - 1), 1)[0]
        if (rec) spawnUnloaded(world, id, tc, rec, mp.x, mp.y)
        tc.pendingUnload = false
        tc.pendingOne = -1
        tc.unloadCount = 0
        return
      }
      if (!isBuilding && isqrt(sqDist(t.x, t.y, tc.unloadX, tc.unloadY)) > UNLOAD_RANGE) {
        if (!world.moves.has(id)) {
          const mp = resolveUnloadPoint(world, tc.unloadX, tc.unloadY)
          const m = setMove(world, id, mp.x, mp.y, false)
          m.needsPath = true
        }
        return
      }
      world.moves.delete(id)
      const mp = isBuilding
        ? resolveUnloadPoint(world, t.x, t.y)
        : resolveUnloadPoint(world, tc.unloadX, tc.unloadY)
      // The grid is sized by the full load being dropped; passengers.length
      // shrinks as unloadCount grows, so the sum stays constant across ticks
      // and every passenger lands in the exact slot it would in a single dump.
      const totalDrop = tc.passengers.length + tc.unloadCount
      const slots = unloadSlots(totalDrop, mp.x, mp.y)
      const rec = tc.passengers.shift()!
      const slotIdx = tc.unloadCount
      const pos = slots[slotIdx]
      if (pos) {
        const sid = spawnUnloaded(world, id, tc, rec, pos.x, pos.y)
        if (isBuilding) {
          const cx = resolveUnloadPoint(world, tc.unloadX, tc.unloadY)
          const spot = marchSlot(slotIdx, totalDrop, cx.x, cx.y)
          const m = setMove(world, sid, spot.x, spot.y, false)
          m.needsPath = true
        }
      }
      tc.unloadCount++
      if (tc.passengers.length === 0) {
        tc.pendingUnload = false
        tc.pendingOne = -1
        tc.unloadCount = 0
      }
    })
  },
}