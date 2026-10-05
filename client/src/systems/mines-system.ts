import { sqDist, tileToFx } from '@space-arenas/shared'
import type { World } from '../core/world.ts'
import { applyDamage } from './combat-system.ts'

/**
 * Proximity mines placed by engineers. Once a mine is armed it detonates when
 * an enemy ground unit steps within its trigger radius; the blast hits every
 * ground unit inside the blast radius. When `friendlyMineDamage` is enabled the
 * mine also trips on, and damages, allied units — but enemy units are always the
 * ones that give the placing engineer the kill. The owning team sees its own
 * mines, so stepping on your own (friendly-fire) mine is a fair warning.
 */
export const MinesSystem = {
  name: 'Mines',
  update(world: World): void {
    // Friendly-fire mines trip on ANY ground unit; otherwise only enemy ground
    // units can set them off (so the owner never boom-rangs itself).
    const mineTripsOnAllies = world.settings.friendlyMineDamage
    const triggered: number[] = []
    world.mines.forEach((id, m) => {
      if (world.tick < m.armTick) return
      const mt = world.transforms.get(id)
      if (mt && unitInRadius(world, m.team, mt.x, mt.y, m.triggerRadius, mineTripsOnAllies) >= 0) triggered.push(id)
    })

    for (const id of triggered) {
      const m = world.mines.get(id)
      const mt = world.transforms.get(id)
      if (!m || !mt) continue
      world.emit({ type: 'mine-exploded', entity: id, team: m.team, x: mt.x, y: mt.y })
      const blastFx = tileToFx(m.blastRadius)
      const blastSq = blastFx * blastFx
      const victims: number[] = []
      world.units.forEach((uid, u) => {
        if (u.class === 'air') return
        if (world.sameTeam(m.team, u.team) && !world.settings.friendlyMineDamage) return
        const ut = world.transforms.get(uid)
        if (!ut) return
        if (sqDist(mt.x, mt.y, ut.x, ut.y) <= blastSq) victims.push(uid)
      })
      for (const vid of victims) applyDamage(world, vid, m.damage, m.owner, m.team)
      world.removeEntity(id)
    }
  },
}

const unitInRadius = (
  world: World,
  team: number,
  x: number,
  y: number,
  radiusTiles: number,
  includeAllies: boolean,
): number => {
  let found = -1
  const rFx = tileToFx(radiusTiles)
  const rSq = rFx * rFx
  world.units.forEach((uid, u) => {
    if (found >= 0) return
    if (u.class === 'air') return
    const allied = world.sameTeam(team, u.team)
    if (includeAllies ? !allied : allied) return
    const ut = world.transforms.get(uid)
    if (!ut) return
    if (sqDist(x, y, ut.x, ut.y) <= rSq) found = uid
  })
  return found
}