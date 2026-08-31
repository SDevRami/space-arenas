import { getWeapon, sqDist, tileToFx } from '@space-arenas/shared'
import type { World } from '../core/world.ts'
import { setMove } from '../entities/factories.ts'

export const applyDamage = (world: World, target: number, amount: number, attacker: number, teamOverride = -1): void => {
  const h = world.healths.get(target)
  if (!h) return
  h.hp -= amount
  const attackerUnit = world.units.get(attacker)
  const team = teamOverride >= 0 ? teamOverride : attackerUnit ? attackerUnit.team : (world.buildings.get(attacker)?.team ?? -1)
  world.emit({ type: 'combat-hit', attacker, target, damage: amount, team })
  const a = world.attacks.get(target)
  const attackerKind = world.kindOf(attacker)
  if (a && (attackerKind === 'unit' || attackerKind === 'building')) {
    a.lastHit = attacker
    if (a.target === null && a.targetPos === null) {
      const m = world.moves.get(target)
      if (!m || m.attackMove) a.target = attacker
    }
  }
  if (h.hp <= 0) world.removeEntity(target)
}

export const setChase = (world: World, id: number, tx: number, ty: number): void => {
  let m = world.moves.get(id)
  if (!m) {
    m = { tx, ty, path: [], pathIndex: 0, attackMove: false, needsPath: true, chase: true, repathCooldown: 0 }
    world.moves.set(id, m)
  } else {
    m.chase = true
    if (m.tx !== tx || m.ty !== ty) {
      m.tx = tx
      m.ty = ty
      m.path = []
      m.pathIndex = 0
      m.needsPath = true
      m.repathCooldown = 0
    }
  }
}

// Compute a firing standoff point for this unit's attack on `target`. The base
// point sits just inside fire range (~85%), back from the target along the line
// FROM this unit's own position, so the attacker stops at the near edge of range
// instead of walking onto/through the target. When several friendly attackers
// share the same target they are spread in an arc around it (semicircle).
const standoffPoint = (
  world: World,
  id: number,
  team: number,
  target: number,
  rangeFx: number,
  unitX: number,
  unitY: number,
): { x: number; y: number } => {
  const tp = world.transforms.get(target)
  if (!tp) return { x: Math.floor(unitX), y: Math.floor(unitY) }
  const stand = rangeFx * 0.85
  let dx = tp.x - unitX
  let dy = tp.y - unitY
  const d = Math.sqrt(dx * dx + dy * dy) || 1
  dx /= d
  dy /= d
  let bx = tp.x - dx * stand
  let by = tp.y - dy * stand
  let n = 0
  let base = 0
  world.attacks.forEach((oid, a) => {
    if (!a || a.target !== target) return
    const teamOf = world.units.get(oid)?.team
    if (teamOf !== team) return
    if (oid === id) base = n
    n++
  })
  if (n > 1) {
    const span = Math.min(n - 1, 4) * (Math.PI / 6)
    const off = -span / 2 + (span / Math.max(n - 1, 1)) * base
    const rx = tp.x - bx
    const ry = tp.y - by
    const cos = Math.cos(off)
    const sin = Math.sin(off)
    bx = tp.x - (rx * cos - ry * sin)
    by = tp.y - (rx * sin + ry * cos)
  }
  return { x: Math.floor(bx), y: Math.floor(by) }
}

export const pickTarget = (
  world: World,
  id: number,
  team: number,
  x: number,
  y: number,
  rangeFx: number,
  preferred = -1,
  targetsAir = false,
): number => {
  const rangeSq = rangeFx * rangeFx
  const cands: Array<{ id: number; hpFrac: number; d: number }> = []
  const consider = (other: number, ox: number, oy: number): void => {
    if (other === id) return
    const t2 = world.units.get(other)?.team ?? world.buildings.get(other)?.team
    if (t2 === undefined || world.sameTeam(team, t2)) return
    if (!world.isVisibleTo(team, other)) return
    if (world.units.get(other)?.class === 'air' && !targetsAir) return
    const d = sqDist(x, y, ox, oy)
    if (d > rangeSq) return
    const h = world.healths.get(other)
    const hpFrac = h && h.maxHp > 0 ? h.hp / h.maxHp : 1
    cands.push({ id: other, hpFrac, d })
  }
  world.units.forEach((other, u) => {
    if (u.team === team) return
    const tp = world.transforms.get(other)
    if (tp) consider(other, tp.x, tp.y)
  })
  world.buildings.forEach((other, b) => {
    if (b.team === team || !b.done) return
    const tp = world.transforms.get(other)
    if (tp) consider(other, tp.x, tp.y)
  })
  world.oilFields.forEach((other, f) => {
    if (f.owner < 0 || world.sameTeam(team, f.owner)) return
    if (!world.isVisibleTo(team, other)) return
    const tp = world.transforms.get(other)
    if (!tp) return
    const d = sqDist(x, y, tp.x, tp.y)
    if (d > rangeSq) return
    const h = world.healths.get(other)
    const hpFrac = h && h.maxHp > 0 ? h.hp / h.maxHp : 1
    cands.push({ id: other, hpFrac, d })
  })
  if (cands.length === 0) return -1
  const focused = new Map<number, number>()
  world.attacks.forEach((attackerId, a) => {
    if (world.teamOf(attackerId) !== team) return
    if (a.target !== null && a.target >= 0) {
      focused.set(a.target, (focused.get(a.target) ?? 0) + 1)
    }
  })
  let best = -1
  let bestScore = -Infinity
  const biasLast = world.settings.targetBiasLastHit
  const biasFocus = world.settings.targetBiasFocusFire
  const biasHp = world.settings.targetBiasLowHp
  for (const c of cands) {
    const focus = focused.get(c.id) ?? 0
    const dist = Math.sqrt(c.d)
    const score = (c.id === preferred ? biasLast : 0) + focus * biasFocus - c.hpFrac * biasHp - dist
    if (score > bestScore) {
      bestScore = score
      best = c.id
    }
  }
  return best
}

export const CombatSystem = {
  name: 'Combat',
  update(world: World): void {
    world.attacks.forEach((id, a) => {
      if (world.planes.has(id)) return
      const t = world.transforms.get(id)
      if (!t) return
      const weapon = getWeapon(a.weaponId, world.settings)
      const rangeFx = tileToFx(weapon.range)
      const rangeSq = rangeFx * rangeFx
      const keepSq = rangeSq * world.settings.chaseLeash * world.settings.chaseLeash
      const isBuilding = world.buildings.has(id)
      const team = isBuilding ? world.buildings.require(id).team : world.units.require(id).team
      const targetsAir = weapon.targetsAir === true

      if (a.currentCooldown > 0) a.currentCooldown--

      if (isBuilding) {
        const b = world.buildings.require(id)
        if (!b.done) return
        const s = world.teams.get(team)
        if (s && s.powerDown) return
      }

      let target = a.target
      if (target !== null && (!world.isAlive(target) || world.sameTeam(team, world.teamOf(target)))) {
        a.target = null
        target = null
        const m = world.moves.get(id)
        if (m && m.chase) world.moves.delete(id)
        // loop back to the keep-attack spot / guard post so the unit holds its area
        if (!isBuilding) {
          const post = a.keepAttack ?? a.guardPost
          if (post) {
            const back = setMove(world, id, post.x, post.y, false)
            back.needsPath = true
            back.attackMove = true
          }
        }
      }

      if (target !== null) {
        const tp = world.transforms.get(target)
        if (!tp) {
          a.target = null
          return
        }
        const dSq = sqDist(t.x, t.y, tp.x, tp.y)
        if (dSq <= rangeSq) {
          // In fire range: stop and shoot — don't keep advancing onto the
          // target. Re-issue the standoff move only if the target pulls away.
          if (a.currentCooldown === 0) {
            fire(world, id, target, tp.x, tp.y, weapon.damage, weapon.splash, targetsAir)
            a.currentCooldown = weapon.cooldownTicks
          }
          const m = world.moves.get(id)
          if (m) world.moves.delete(id)
        } else if (a.guardMode) {
          // Guard turret: hold the post. If the target wanders out of range we
          // just wait (never chase); it will be re-engaged when it re-enters
          // range. The march to the post itself is handled by the targetPos
          // branch while no valid target is engaged.
          const g = world.moves.get(id)
          if (g) world.moves.delete(id)
        } else if (a.keepAttack !== null) {
          // keep-attack: hold the spot (leash), only engaging targets that come
          // within keepSq of it; while a live target exists just chase it, and
          // drop back to the spot if it wanders beyond the leash.
          if (dSq <= keepSq) {
            setChase(world, id, tp.x, tp.y)
          } else {
            a.target = null
            const m = world.moves.get(id)
            if (m && m.chase) world.moves.delete(id)
            // leash dropped: return to the keep-attack spot / guard post
            if (!isBuilding) {
              const post = a.keepAttack ?? a.guardPost
              if (post) {
                const back = setMove(world, id, post.x, post.y, false)
                back.attackMove = true
                a.guardMode = true
              }
            }
          }
        } else {
          // Plain attack / attack-move-with-target: advance only to the edge of
          // fire range, then stop and engage — don't pile on top of the target.
          // Multiple attackers spread in an arc around the target (semicircle).
          // Recomputed each tick so a moving target is still pursued to range,
          // but only re-issued when the standoff moves >400fx to avoid repathing
          // every tick and stalling.
          const sp = standoffPoint(world, id, team, target, rangeFx, t.x, t.y)
          const gx = sp.x
          const gy = sp.y
          const m = world.moves.get(id)
          if (!m || Math.sqrt(Math.pow(m.tx - gx, 2) + Math.pow(m.ty - gy, 2)) > 400) {
            const mm = setMove(world, id, gx, gy, false)
            mm.needsPath = true
            mm.attackMove = true
          }
        }
      } else if (a.targetPos !== null) {
        if (a.guardMode && a.guardPost) {
          // Guard: march to the exact center of the guard circle, THEN hold it
          // as a turret. Targets are only auto-acquired once the unit has
          // arrived at the post, so it never gets pulled off course en route.
          const post = a.guardPost
          const dPost = Math.sqrt(sqDist(t.x, t.y, post.x, post.y))
          const atPost = dPost <= world.settings.guardArriveCells * 1000
          if (atPost) {
            if (a.currentCooldown === 0) {
              const lastHit = world.isAlive(a.lastHit) && world.isVisibleTo(team, a.lastHit) ? a.lastHit : -1
              const found = pickTarget(world, id, team, t.x, t.y, rangeFx, lastHit, targetsAir)
              if (found >= 0) {
                a.target = found
                return
              }
            }
            const m = world.moves.get(id)
            if (m) world.moves.delete(id)
          } else if (!isBuilding) {
            const m = world.moves.get(id)
            if (
              !m ||
              Math.sqrt(Math.pow(m.tx - post.x, 2) + Math.pow(m.ty - post.y, 2)) > 400
            ) {
              const mm = setMove(world, id, post.x, post.y, false)
              mm.needsPath = true
              mm.attackMove = true
            }
          }
          return
        }
        if (a.currentCooldown === 0) {
          const lastHit = world.isAlive(a.lastHit) && world.isVisibleTo(team, a.lastHit) ? a.lastHit : -1
          const found = pickTarget(world, id, team, t.x, t.y, rangeFx, lastHit, targetsAir)
          if (found >= 0) {
            a.target = found
            return
          }
        }
        const tx = a.targetPos.x
        const ty = a.targetPos.y
        const dSq = sqDist(t.x, t.y, tx, ty)
        if (dSq <= rangeSq) {
          if (a.currentCooldown === 0 && !a.guardMode) {
            fireGround(world, id, tx, ty, weapon.damage, weapon.splash, targetsAir)
            a.currentCooldown = weapon.cooldownTicks
          }
          if (!a.keepAttack && !a.guardMode) {
            a.targetPos = null
            const m = world.moves.get(id)
            if (m && !m.chase) world.moves.delete(id)
          }
        } else if (!isBuilding) {
          if (a.keepAttack || a.guardMode) {
            const d = Math.sqrt(dSq) || 1
            const stand = Math.max(0, d - rangeFx * 0.9)
            const gx = t.x + Math.floor(((tx - t.x) * stand) / d)
            const gy = t.y + Math.floor(((ty - t.y) * stand) / d)
            const m = world.moves.get(id)
            if (!m || Math.sqrt(Math.pow(m.tx - gx, 2) + Math.pow(m.ty - gy, 2)) > 400) {
              const mm = setMove(world, id, gx, gy, false)
              mm.needsPath = true
              mm.attackMove = true
            }
          } else {
            setChase(world, id, tx, ty)
          }
        }
      } else {
        const m = world.moves.get(id)
        const canAuto = !m || m.attackMove || m.chase || a.guardMode
        if (canAuto && a.currentCooldown === 0) {
          const lastHit = world.isAlive(a.lastHit) && world.isVisibleTo(team, a.lastHit) ? a.lastHit : -1
          const found = pickTarget(world, id, team, t.x, t.y, rangeFx, lastHit, targetsAir)
          if (found >= 0) a.target = found
        }
      }
    })
  },
}

export const fire = (
  world: World,
  attacker: number,
  target: number,
  tx: number,
  ty: number,
  damage: number,
  splash: number | undefined,
  targetsAir = false,
): void => {
  const team = world.teamOf(attacker)
  world.emit({ type: 'shot-fired', attacker, x: tx, y: ty, team })
  const targets: Array<[number, number, number]> = []
  if (splash && splash > 0) {
    splashDamage(world, team, tx, ty, splash, targets, targetsAir)
  } else if (!world.units.get(target)?.class || world.units.get(target)?.class !== 'air' || targetsAir) {
    targets.push([target, tx, ty])
  }
  for (const [tid] of targets) applyDamage(world, tid, damage, attacker)
}

export const fireGround = (
  world: World,
  attacker: number,
  tx: number,
  ty: number,
  damage: number,
  splash: number | undefined,
  targetsAir = false,
): void => {
  const team = world.teamOf(attacker)
  world.emit({ type: 'shot-fired', attacker, x: tx, y: ty, team })
  const targets: Array<[number, number, number]> = []
  splashDamage(world, team, tx, ty, splash && splash > 0 ? splash : world.settings.defaultSplash, targets, targetsAir)
  for (const [tid] of targets) applyDamage(world, tid, damage, attacker)
}

const splashDamage = (
  world: World,
  team: number,
  tx: number,
  ty: number,
  splash: number,
  out: Array<[number, number, number]>,
  targetsAir = false,
): void => {
  const splashFx = tileToFx(splash)
  const splashSq = splashFx * splashFx
  world.units.forEach((id, u) => {
    if (world.sameTeam(team, u.team)) return
    if (u.class === 'air' && !targetsAir) return
    const tp = world.transforms.get(id)
    if (!tp) return
    if (sqDist(tx, ty, tp.x, tp.y) <= splashSq) out.push([id, tp.x, tp.y])
  })
  world.buildings.forEach((id, b) => {
    if (world.sameTeam(team, b.team) || !b.done) return
    const tp = world.transforms.get(id)
    if (!tp) return
    if (sqDist(tx, ty, tp.x, tp.y) <= splashSq) out.push([id, tp.x, tp.y])
  })
  world.oilFields.forEach((id, f) => {
    if (f.owner < 0 || world.sameTeam(team, f.owner)) return
    const tp = world.transforms.get(id)
    if (!tp) return
    if (sqDist(tx, ty, tp.x, tp.y) <= splashSq) out.push([id, tp.x, tp.y])
  })
  world.scenery.forEach((id, _s) => {
    const tp = world.transforms.get(id)
    if (!tp) return
    if (sqDist(tx, ty, tp.x, tp.y) <= splashSq) out.push([id, tp.x, tp.y])
  })
}
