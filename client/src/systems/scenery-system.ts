import type { World } from '../core/world.ts'
import { applyDamage } from './combat-system.ts'

export const ScenerySystem = {
  name: 'Scenery',
  update(world: World): void {
    if (world.scenery.size === 0) return
    const crush = world.settings.crushDamage
    world.scenery.forEach((id, s) => {
      if (s.type !== 'tree') return
      const h = world.healths.get(id)
      if (!h || h.hp <= 0) return
      let attacker = 0
      world.units.forEach((uid, u) => {
        if (attacker !== 0) return
        if (u.class !== 'vehicle') return
        const t = world.transforms.get(uid)
        if (!t) return
        const tx = Math.floor(t.x / 1000)
        const ty = Math.floor(t.y / 1000)
        if (tx >= s.x && tx < s.x + s.w && ty >= s.y && ty < s.y + s.h) attacker = uid
      })
      if (attacker !== 0) applyDamage(world, id, crush, attacker)
    })
  },
}