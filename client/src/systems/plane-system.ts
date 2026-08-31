import { getUnit, getWeapon, isqrt, sqDist, tileToFx, SECONDS_TO_TICKS } from '@space-arenas/shared'
import type { World } from '../core/world.ts'
import { fire, fireGround, pickTarget, setChase } from './combat-system.ts'

const isValidTarget = (world: World, team: number, id: number): boolean => {
  if (!world.isAlive(id)) return false
  const t2 = world.teamOf(id)
  return t2 >= 0 && !world.sameTeam(team, t2)
}

const orbit = (world: World, id: number, cx: number, cy: number): void => {
  const t = world.transforms.require(id)
  const u = world.units.require(id)
  const { width, height } = world
  const angle = ((world.tick % 6000) * 0.01 + id * 1.7) % (Math.PI * 2)
  const orbitRadius = tileToFx(world.settings.planeOrbitRadius)
  const ox = cx + Math.cos(angle) * orbitRadius
  const oy = cy + Math.sin(angle) * orbitRadius
  const dx = ox - t.x
  const dy = oy - t.y
  const d = isqrt(sqDist(t.x, t.y, ox, oy))
  if (d <= u.speed) {
    t.x = ox
    t.y = oy
  } else {
    t.x = t.x + Math.floor((dx * u.speed) / d)
    t.y = t.y + Math.floor((dy * u.speed) / d)
    const nx = Math.floor(t.x / 1000)
    const ny = Math.floor(t.y / 1000)
    if (nx < 0) t.x = 0
    else if (nx >= width) t.x = width * 1000 - 1
    if (ny < 0) t.y = 0
    else if (ny >= height) t.y = height * 1000 - 1
  }
}

export const PlaneSystem = {
  name: 'Plane',
  update(world: World): void {
    world.planes.forEach((id, p) => {
      const t = world.transforms.get(id)
      const u = world.units.get(id)
      const a = world.attacks.get(id)
      if (!t || !u || !a) return
      const weapon = getWeapon(a.weaponId, world.settings)
      const rangeFx = tileToFx(weapon.range)
      const rangeSq = rangeFx * rangeFx
      const team = u.team
      const ud = getUnit(u.unitType, world.settings)
      const maxAmmo = ud.maxAmmo ?? 2
      const reloadTicks = ud.reloadTicks ?? SECONDS_TO_TICKS(4)

      if (a.currentCooldown > 0) a.currentCooldown--

      // ----- reloading at home -----
      if (p.reloadTicks > 0) {
        p.reloadTicks--
        if (p.reloadTicks <= 0) {
          p.ammo = maxAmmo
          p.state = 'idle'
          // guarded/keep-attack spot: head back there instead of idling at base
          const post = a.guardPost ?? a.keepAttack
          if (post) {
            p.hoverX = post.x
            p.hoverY = post.y
            a.targetPos = a.keepAttack ? { x: post.x, y: post.y } : null
            setChase(world, id, post.x, post.y)
          }
        }
        if (!a.keepAttack) a.targetPos = null
        a.target = null
        world.moves.delete(id)
        orbit(world, id, p.hoverX, p.hoverY)
        return
      }

      // ----- out of ammo: return home to refill -----
      if (p.ammo <= 0) {
        p.state = 'returning'
        a.target = null
        // keep-attack keeps its spot hot across the reload trip
        if (!a.keepAttack) a.targetPos = null
        const homeT = world.transforms.get(p.home)
        if (homeT) {
          const d = isqrt(sqDist(t.x, t.y, homeT.x, homeT.y))
          if (d <= tileToFx(world.settings.planeReloadRadius)) {
            p.reloadTicks = reloadTicks
            p.hoverX = homeT.x
            p.hoverY = homeT.y
            world.moves.delete(id)
            orbit(world, id, p.hoverX, p.hoverY)
          } else {
            setChase(world, id, homeT.x, homeT.y)
          }
        } else {
          p.reloadTicks = reloadTicks
          world.moves.delete(id)
        }
        return
      }

      // ----- player move command: hover point follows the destination -----
      const m = world.moves.get(id)
      if (m && !m.chase) {
        p.hoverX = m.tx
        p.hoverY = m.ty
      }

      const canFire = a.currentCooldown <= 0

      // ----- explicit target (player attack or auto-acquired) -----
      if (a.target !== null) {
        if (!isValidTarget(world, team, a.target)) {
          a.target = null
        } else {
          const tp = world.transforms.get(a.target)
          if (!tp) {
            a.target = null
          } else {
            const dSq = sqDist(t.x, t.y, tp.x, tp.y)
            if (dSq <= rangeSq) {
              if (canFire) {
                fire(world, id, a.target, tp.x, tp.y, weapon.damage, weapon.splash)
                p.ammo--
                a.currentCooldown = weapon.cooldownTicks
              }
              world.moves.delete(id)
            } else {
              setChase(world, id, tp.x, tp.y)
            }
            return
          }
        }
      }

      // ----- attack-move to a point (also the keep-attack bombardment loop) -----
      if (a.targetPos !== null) {
        const pt = a.targetPos
        if (canFire) {
          const lastHit = world.isAlive(a.lastHit) ? a.lastHit : -1
          const found = pickTarget(world, id, team, t.x, t.y, rangeFx, lastHit)
          if (found >= 0) {
            a.target = found
            return
          }
        }
        const dSq = sqDist(t.x, t.y, pt.x, pt.y)
        if (dSq <= rangeSq) {
          if (canFire) {
            fireGround(world, id, pt.x, pt.y, weapon.damage, weapon.splash)
            p.ammo--
            a.currentCooldown = weapon.cooldownTicks
          }
          if (a.keepAttack) {
            // hold position and keep shelling the spot until out of ammo
            world.moves.delete(id)
          } else {
            a.targetPos = null
            world.moves.delete(id)
          }
        } else {
          if (a.keepAttack) {
            // hover at the edge of shooting range, bombarding the spot
            const d = Math.sqrt(dSq) || 1
            const stand = Math.max(0, d - rangeFx * 0.9)
            const gx = t.x + Math.floor(((pt.x - t.x) * stand) / d)
            const gy = t.y + Math.floor(((pt.y - t.y) * stand) / d)
            if (!m || Math.sqrt(Math.pow(m.tx - gx, 2) + Math.pow(m.ty - gy, 2)) > 400) {
              setChase(world, id, gx, gy)
            }
          } else {
            setChase(world, id, pt.x, pt.y)
          }
        }
        return
      }

      // ----- explicit move command still active (player issued) -----
      // attack-move travel (guard) still auto-engages below; plain moves just hover
      if (m && !m.chase && !m.attackMove) {
        return
      }

      // ----- idle: auto sortie then orbit the hover point -----
      if (canFire && p.ammo > 0) {
        const sortieSq = tileToFx(Math.max(weapon.range, ud.vision ?? 8) * world.settings.planeSortieMult)
        const lastHit = world.isAlive(a.lastHit) && !world.sameTeam(team, world.teamOf(a.lastHit)) ? a.lastHit : -1
        const found = pickTarget(world, id, team, t.x, t.y, sortieSq, lastHit)
        if (found >= 0) {
          a.target = found
          return
        }
      }

      // orbit the hover point
      world.moves.delete(id)
      p.state = 'idle'
      orbit(world, id, p.hoverX, p.hoverY)
    })
  },
}