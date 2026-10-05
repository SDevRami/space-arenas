import { fxToTile, isqrt, sqDist } from '@space-arenas/shared'
import type { World } from '../core/world.ts'
import { rectFromCenter } from '../core/geometry.ts'
const centerOf = (tile: number, width: number): { x: number; y: number } => {
  const tx = tile % width
  const ty = Math.floor(tile / width)
  return { x: tx * 1000 + 500, y: ty * 1000 + 500 }
}

const isWideClass = (c: string | undefined): boolean => c === 'vehicle' || c === 'naval'

const sepSpacing = (world: World, a: string, b: string): number =>
  (isWideClass(a) || isWideClass(b) ? world.settings.sepVehicle : world.settings.sepInfantry) * 1000

const nearestPassableSpot = (world: World, sx: number, sy: number, mask: Uint8Array): { x: number; y: number } | null => {
  const grid = world.grid
  if (!grid) return null
  for (let r = 1; r <= world.settings.stuckRelocateRadius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
        const x = sx + dx
        const y = sy + dy
        if (x < 0 || y < 0 || x >= world.width || y >= world.height) continue
        if (mask[y * world.width + x]) return { x: x * 1000 + 500, y: y * 1000 + 500 }
      }
    }
  }
  return null
}

const displaceStuckUnits = (world: World): void => {
  const grid = world.grid
  if (!grid) return
  const stuck: number[] = []
  world.units.forEach((id, u) => {
    if (u.class === 'air') return
    // Relocate each unit on its own mask — a ship out of the water is pulled
    // to the nearest water tile, never onto land (and vice versa for ground units).
    const mask = u.class === 'naval' ? grid.water : grid.passable
    const t = world.transforms.get(id)
    if (!t) return
    const tx = fxToTile(t.x)
    const ty = fxToTile(t.y)
    if (tx < 0 || ty < 0 || tx >= world.width || ty >= world.height) return
    if (!mask[ty * world.width + tx]) stuck.push(id)
  })
  for (const id of stuck) {
    const u = world.units.get(id)
    const t = world.transforms.get(id)
    if (!t) continue
    const mask = u?.class === 'naval' ? grid.water : grid.passable
    const spot = nearestPassableSpot(world, fxToTile(t.x), fxToTile(t.y), mask)
    if (!spot) continue
    t.x = spot.x
    t.y = spot.y
    const m = world.moves.get(id)
    if (m) {
      m.path = []
      m.pathIndex = 0
      m.needsPath = true
      m.repathCooldown = 0
    } else {
      const fresh = { tx: spot.x, ty: spot.y, path: [] as number[], pathIndex: 0, attackMove: false, needsPath: false, chase: false, repathCooldown: 0 }
      world.moves.set(id, fresh)
    }
  }
}

interface FxRect {
  x0: number
  y0: number
  x1: number
  y1: number
  id: number
}

const buildingRects = (world: World): FxRect[] => {
  const rects: FxRect[] = []
  world.buildings.forEach((id, b) => {
    const t = world.transforms.get(id)
    if (!t) return
    const r = rectFromCenter(t.x, t.y, b.footprintW, b.footprintH)
    rects.push({ x0: r.x * 1000, y0: r.y * 1000, x1: (r.x + r.w) * 1000, y1: (r.y + r.h) * 1000, id })
  })
  return rects
}

const fieldRects = (world: World): FxRect[] => {
  const rects: FxRect[] = []
  world.fields.forEach((id, f) => {
    const t = world.transforms.get(id)
    if (!t) return
    rects.push({
      x0: t.x - f.radius * 1000,
      y0: t.y - f.radius * 1000,
      x1: t.x + f.radius * 1000,
      y1: t.y + f.radius * 1000,
      id,
    })
  })
  world.oilFields.forEach((id, f) => {
    const t = world.transforms.get(id)
    if (!t) return
    rects.push({
      x0: t.x - f.radius * 1000,
      y0: t.y - f.radius * 1000,
      x1: t.x + f.radius * 1000,
      y1: t.y + f.radius * 1000,
      id,
    })
  })
  return rects
}

const pushAwayFromRect = (px: number, py: number, r: FxRect, margin: number): { x: number; y: number } | null => {
  const inside = px >= r.x0 && px <= r.x1 && py >= r.y0 && py <= r.y1
  if (inside) {
    const dl = px - r.x0
    const dr = r.x1 - px
    const dt = py - r.y0
    const db = r.y1 - py
    const m = Math.min(dl, dr, dt, db)
    const want = m + margin
    if (m === dl) return { x: -want, y: 0 }
    if (m === dr) return { x: want, y: 0 }
    if (m === dt) return { x: 0, y: -want }
    return { x: 0, y: want }
  }
  const nx = Math.max(r.x0, Math.min(px, r.x1))
  const ny = Math.max(r.y0, Math.min(py, r.y1))
  const dx = px - nx
  const dy = py - ny
  const d = isqrt(dx * dx + dy * dy)
  if (d >= margin) return null
  if (d === 0) return null
  const push = margin - d
  return { x: Math.floor((dx * push) / d), y: Math.floor((dy * push) / d) }
}

const applySeparation = (world: World): void => {
  const ids: number[] = []
  world.units.forEach((id, u) => {
    if (u.class !== 'air') ids.push(id)
  })
  const n = ids.length
  if (n === 0) return
  const ax = new Array<number>(n).fill(0)
  const ay = new Array<number>(n).fill(0)
  for (let i = 0; i < n; i++) {
    const ia = ids[i]
    const ta = world.transforms.get(ia)
    const ua = world.units.get(ia)
    if (!ta || !ua) continue
    for (let j = i + 1; j < n; j++) {
      const ib = ids[j]
      const tb = world.transforms.get(ib)
      const ub = world.units.get(ib)
      if (!tb || !ub) continue
      if (ua.team !== ub.team) continue
      const dx = tb.x - ta.x
      const dy = tb.y - ta.y
      const d = isqrt(sqDist(ta.x, ta.y, tb.x, tb.y))
      if (d === 0) {
        const jitter = world.settings.samePosJitter * 1000
        ax[i] += jitter
        ax[j] -= jitter
        continue
      }
      const minS = sepSpacing(world, ua.class, ub.class)
      if (d >= minS) continue
      const push = Math.floor((minS - d) / 2) + 1
      // Head-on deadlock avoidance: two units moving towards each other would cancel
      // each other's push and grind forever. Make them sidestep to deterministic,
      // opposite sides (lower id yields right, higher id yields left).
      let rx: number
      let ry: number
      const ma = world.moves.get(ids[i])
      const mb = world.moves.get(ids[j])
      // only plain travel moves (not combat chases) take the sidestep
      if (ma && mb && !ma.chase && !mb.chase && (ma.tx - ta.x) * (mb.tx - tb.x) + (ma.ty - ta.y) * (mb.ty - tb.y) < 0) {
        const sgn = ids[i] < ids[j] ? 1 : -1
        rx = Math.floor((-dy / d) * push) * sgn
        ry = Math.floor((dx / d) * push) * sgn
      } else {
        rx = Math.floor((dx * push) / d)
        ry = Math.floor((dy * push) / d)
      }
      ax[i] -= rx
      ay[i] -= ry
      ax[j] += rx
      ay[j] += ry
    }
  }
  const rects = buildingRects(world)
  const fRects = fieldRects(world)
  for (let i = 0; i < n; i++) {
    const ta = world.transforms.get(ids[i])
    const ua = world.units.get(ids[i])
    if (!ta || !ua) continue
    // Working dozers used to be excluded from building separation entirely, but
    // that let them march head-on into buildings standing between them and
    // their pad. Keep them flowing AROUND every building except the exact one
    // they are assigned to work on (that rect is exempt so they can stand on
    // their own pad without being pushed back).
    const wa = world.works.get(ids[i])
    const workTarget = wa && (wa.kind === 'construct' || wa.kind === 'repair') ? wa.building : -1
    const hv = world.harvesters.get(ids[i])
    const isTarget = (id: number): boolean => hv !== undefined && (hv.dock === id || hv.field === id || id === workTarget)
    const margin = (isWideClass(ua.class) ? world.settings.buildingMarginVehicle : world.settings.buildingMarginInfantry) * 1000
    for (const r of rects) {
      if (isTarget(r.id)) continue
      const p = pushAwayFromRect(ta.x, ta.y, r, margin)
      if (p) {
        ax[i] += p.x
        ay[i] += p.y
      }
    }
    for (const r of fRects) {
      if (isTarget(r.id)) continue
      const p = pushAwayFromRect(ta.x, ta.y, r, world.settings.fieldMargin * 1000)
      if (p) {
        ax[i] += p.x
        ay[i] += p.y
      }
    }
  }
  const grid = world.grid
  const maxX = world.width * 1000 - 500
  const maxY = world.height * 1000 - 500
  const ok = (x: number, y: number, mask: Uint8Array | null): boolean => {
    if (!grid) return true
    const tx = Math.floor(x / 1000)
    const ty = Math.floor(y / 1000)
    if (tx < 0 || ty < 0 || tx >= world.width || ty >= world.height) return false
    return !!mask?.[ty * world.width + tx]
  }
  const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))
  for (let i = 0; i < n; i++) {
    const m = world.moves.get(ids[i])
    const mt = world.transforms.get(ids[i])
    const ua = world.units.get(ids[i])
    const mask = grid ? (ua?.class === 'naval' ? grid.water : grid.passable) : null
    if (m && mt) {
      const dd = isqrt(sqDist(mt.x, mt.y, m.tx, m.ty))
      if (dd > world.settings.lateralSepDist * 1000) {
        const ux = (m.tx - mt.x) / dd
        const uy = (m.ty - mt.y) / dd
        const px = -uy
        const py = ux
        const lat = ax[i] * px + ay[i] * py
        ax[i] = px * lat
        ay[i] = py * lat
      }
    }
    const maxPush = world.settings.sepMaxPush * 1000
    const pxx = Math.max(-maxPush, Math.min(maxPush, ax[i]))
    const pyy = Math.max(-maxPush, Math.min(maxPush, ay[i]))
    if (pxx === 0 && pyy === 0) continue
    const t = world.transforms.get(ids[i])
    if (!t) continue
    const nx = t.x + pxx
    const ny = t.y + pyy
    if (ok(nx, ny, mask)) {
      t.x = clamp(nx, 500, maxX)
      t.y = clamp(ny, 500, maxY)
    } else if (ok(nx, t.y, mask)) {
      t.x = clamp(nx, 500, maxX)
    } else if (ok(t.x, ny, mask)) {
      t.y = clamp(ny, 500, maxY)
    }
  }
}

export const MovementSystem = {
  name: 'Movement',
  update(world: World): void {
    world.rebuildGridIfDirty()
    const grid = world.grid
    if (!grid) return
    displaceStuckUnits(world)
    world.moves.forEach((id, m) => {
      const u = world.units.get(id)
      const t = world.transforms.get(id)
      if (!u || !t) return
      if (world.empStunned(id)) {
        world.moves.delete(id)
        return
      }
      if (m.needsPath) return
      const isAir = u.class === 'air'
      const mask = u.class === 'naval' ? grid.water : grid.passable

      let targetX: number
      let targetY: number

      if (m.pathIndex < m.path.length) {
        const tile = m.path[m.pathIndex]
        if (!isAir && !mask[tile]) {
          m.path = []
          m.pathIndex = 0
          m.needsPath = true
          m.repathCooldown = world.settings.repathCooldownBlockedTicks
          return
        }
        const txx = tile % world.width
        const tyy = Math.floor(tile / world.width)
        if (fxToTile(t.x) === txx && fxToTile(t.y) === tyy) {
          m.pathIndex++
          if (m.pathIndex >= m.path.length) {
            m.path = []
            m.pathIndex = 0
          }
        }
        if (m.pathIndex < m.path.length) {
          const c = centerOf(m.path[m.pathIndex], world.width)
          targetX = c.x
          targetY = c.y
        } else {
          targetX = m.tx
          targetY = m.ty
        }
      } else {
        targetX = m.tx
        targetY = m.ty
      }

      const dx = targetX - t.x
      const dy = targetY - t.y
      const d = isqrt(sqDist(t.x, t.y, targetX, targetY))
      const targetBlocked = !isAir && !mask[fxToTile(targetY) * world.width + fxToTile(targetX)]

      if (d <= u.speed) {
        if (targetBlocked) {
          if (m.path.length > 0 || m.chase) {
            m.path = []
            m.pathIndex = 0
            m.needsPath = true
            m.repathCooldown = world.settings.repathCooldownFailTicks
          } else {
            world.moves.delete(id)
          }
          return
        }
        t.x = targetX
        t.y = targetY
        if (m.path.length > 0) {
          m.pathIndex++
          if (m.pathIndex >= m.path.length) {
            m.path = []
            m.pathIndex = 0
            if (!m.chase && !m.attackMove) world.moves.delete(id)
          }
        } else if (!m.chase) {
          world.moves.delete(id)
        }
      } else {
        const nx = t.x + Math.floor((dx * u.speed) / d)
        const ny = t.y + Math.floor((dy * u.speed) / d)
        if (isAir || mask[fxToTile(ny) * world.width + fxToTile(nx)]) {
          t.x = nx
          t.y = ny
        } else if (m.path.length > 0) {
          m.path = []
          m.pathIndex = 0
          m.needsPath = true
          m.repathCooldown = world.settings.repathCooldownFailTicks
        } else if (fxToTile(nx) === fxToTile(m.tx) && fxToTile(ny) === fxToTile(m.ty)) {
          if (m.chase) {
            m.needsPath = true
            m.repathCooldown = world.settings.repathCooldownFailTicks
          } else {
            world.moves.delete(id)
          }
        } else {
          m.needsPath = true
          m.repathCooldown = world.settings.repathCooldownFailTicks
        }
      }
    })
    applySeparation(world)
  },
}
