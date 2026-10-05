import { sqDist } from '@space-arenas/shared'
import type { World } from '../core/world.ts'
import { applyDamage } from './combat-system.ts'

export const LaserSystem = {
  name: 'Laser',
  update(world: World): void {
    const expired: number[] = []
    world.lasers.forEach((id, l) => {
      if (l.untilTick <= world.tick) {
        expired.push(id)
        return
      }
      if (world.tick < l.startTick) return
      const t = world.transforms.get(id)
      if (!t) return
      const radiusFx = l.radius * 1000
      const rSq = radiusFx * radiusFx
      const dmg = world.settings.laserDamagePerTick
      world.units.forEach((uid, u) => {
        if (world.sameTeam(l.team, u.team)) return
        const ut = world.transforms.get(uid)
        if (!ut) return
        if (sqDist(t.x, t.y, ut.x, ut.y) <= rSq) applyDamage(world, uid, dmg, id, l.team)
      })
      world.buildings.forEach((bid, b) => {
        if (world.sameTeam(l.team, b.team) || !b.done) return
        const bt = world.transforms.get(bid)
        if (!bt) return
        if (sqDist(t.x, t.y, bt.x, bt.y) <= rSq) applyDamage(world, bid, dmg, id, l.team)
      })
    })
    for (const id of expired) world.removeEntity(id)
  },
}
