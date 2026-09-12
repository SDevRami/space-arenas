import type { World } from '../core/world.ts'
import { applyDamage } from './combat-system.ts'

/**
 * Run-over: every vehicle that steps onto the same tile as an ENEMY troop
 * deals `crushDamage` when it first makes contact. Infantry never crush and
 * aircraft fly overhead. Crush only triggers on the entry tick — a parked
 * vehicle stops grinding, and the pair re-arms once they separate again — so
 * foot soldiers aren't instantly ground away standing under a machine.
 */
export const CrushSystem = {
  name: 'Crush',
  update(world: World): void {
    const pairs: Array<[number, number]> = []
    world.units.forEach((vid, v) => {
      if (v.class !== 'vehicle') return
      const vt = world.transforms.get(vid)
      if (!vt) return
      const vtx = Math.floor(vt.x / 1000)
      const vty = Math.floor(vt.y / 1000)
      world.units.forEach((iid, i) => {
        if (i.class !== 'infantry') return
        if (world.sameTeam(v.team, i.team)) return
        const it = world.transforms.get(iid)
        if (!it) return
        if (Math.floor(it.x / 1000) === vtx && Math.floor(it.y / 1000) === vty) pairs.push([vid, iid])
      })
    })

    // Drop pairs that separated or died so a future re-crossing can crush again.
    const active = new Set(pairs.map(([a, b]) => a + '|' + b))
    for (const key of world.crushPairs) {
      if (!active.has(key)) world.crushPairs.delete(key)
    }

    for (const [vid, iid] of pairs) {
      if (!world.units.has(iid)) continue
      const key = vid + '|' + iid
      if (world.crushPairs.has(key)) continue
      world.crushPairs.add(key)
      applyDamage(world, iid, world.settings.crushDamage, vid)
    }
  },
}