import { sqDist } from '@space-arenas/shared'
import type { World } from '../core/world.ts'

/**
 * Day 13: the EMP nullification zone. While a pulse is alive it walks every
 * enemy unit/building inside its radius and pushes their `empUntil` to
 * `tick + EMP_DURATION_TICKS`. Movement/combat/work/production skip stunned
 * entities, so anything caught in the zone is frozen for the duration.
 */
export const EmpSystem = {
  name: 'Emp',
  update(world: World): void {
    const dead: number[] = []
    world.empPulses.forEach((id, p) => {
      if (p.untilTick <= world.tick) {
        dead.push(id)
        return
      }
      const t = world.transforms.get(id)
      if (!t) {
        dead.push(id)
        return
      }
      const rFx = p.radius * 1000
      const rSq = rFx * rFx
      world.units.forEach((uid, u) => {
        if (world.sameTeam(p.team, u.team)) return
        const ut = world.transforms.get(uid)
        if (!ut) return
        if (sqDist(t.x, t.y, ut.x, ut.y) <= rSq) {
          u.empUntil = Math.max(u.empUntil ?? -Infinity, p.untilTick)
        }
      })
      world.buildings.forEach((bid, b) => {
        if (world.sameTeam(p.team, b.team) || !b.done) return
        const bt = world.transforms.get(bid)
        if (!bt) return
        if (sqDist(t.x, t.y, bt.x, bt.y) <= rSq) {
          b.empUntil = Math.max(b.empUntil ?? -Infinity, p.untilTick)
        }
      })
    })
    for (const id of dead) world.removeEntity(id)
  },
}