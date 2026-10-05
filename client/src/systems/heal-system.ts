import { sqDist } from '@space-arenas/shared'
import type { World } from '../core/world.ts'

/**
 * Engineer aura healing: once an engineer reaches the configured veteran rank
 * it passively heals every allied GROUND unit within `engineerHealAuraRadius`
 * tiles every tick. Air units and buildings are never healed; the targeted
 * single-unit heal lives in WorkSystem (`repair-unit`). Cosmetic heal flashes
 * are recorded here exactly like hit flashes (not part of the sim hash).
 */
export const HealSystem = {
  name: 'Heal',
  update(world: World): void {
    const auraFx = world.settings.engineerHealAuraRadius * 1000
    world.units.forEach((eid, e) => {
      if (e.unitType !== 'engineer') return
      if (e.veteranRank < world.settings.engineerHealRank) return
      const et = world.transforms.get(eid)
      if (!et) return
      const auraSq = auraFx * auraFx
      world.units.forEach((uid, u) => {
        if (uid === eid) return
        if (!world.sameTeam(e.team, u.team)) return
        if (u.class === 'air') return
        const h = world.healths.get(uid)
        if (!h || h.hp >= h.maxHp) return
        const ut = world.transforms.get(uid)
        if (!ut) return
        if (sqDist(et.x, et.y, ut.x, ut.y) <= auraSq) {
          h.hp = Math.min(h.maxHp, h.hp + world.settings.engineerHealPerTick)
          world.healFlashes.set(uid, { healTick: world.tick })
        }
      })
    })
  },
}