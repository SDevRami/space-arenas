import { sqDist } from '@space-arenas/shared'
import type { World } from '../core/world.ts'

export const OilSystem = {
  name: 'Oil',
  update(world: World): void {
    const incomeInterval = world.settings.oilIncomeIntervalTicks
    const income = world.settings.oilIncome
    const claimTicks = world.settings.oilClaimTicks
    world.oilFields.forEach((id, f) => {
      const t = world.transforms.get(id)
      if (!t) return
      const half = f.radius * 1000 + 1500

      if (f.owner >= 0) {
        f.incomeTicks++
        if (f.incomeTicks >= incomeInterval) {
          f.incomeTicks = 0
          const s = world.teamState(f.owner)
          s.credits += income
          world.emit({ type: 'oil-income', field: id, team: f.owner, amount: income })
        }
        return
      }

      let scout = 0
      let bestD = Infinity
      world.units.forEach((uid, u) => {
        if (u.class !== 'infantry') return
        if (world.units.get(uid)?.unitType !== 'scout') return
        if (!world.isAlive(uid)) return
        const ut = world.transforms.get(uid)
        if (!ut) return
        if (Math.abs(ut.x - t.x) > half || Math.abs(ut.y - t.y) > half) return
        const d = sqDist(ut.x, ut.y, t.x, t.y)
        if (d < bestD) {
          bestD = d
          scout = uid
        }
      })

      if (scout === 0) {
        f.claimTicks = 0
        f.claimingScout = 0
        return
      }

      const newTeam = world.units.get(scout)?.team ?? -1
      const oldTeam = f.claimingScout !== 0 ? (world.units.get(f.claimingScout)?.team ?? -1) : -2
      if (oldTeam !== newTeam) {
        f.claimTicks = 0
        world.emit({ type: 'oil-claiming', field: id, entity: scout, team: newTeam })
      }
      f.claimingScout = scout
      f.claimTicks++
      if (f.claimTicks >= claimTicks) {
        f.owner = newTeam
        f.claimTicks = 0
        f.claimingScout = 0
        f.incomeTicks = 0
        world.emit({ type: 'oil-claimed', field: id, entity: scout, team: newTeam })
      }
    })
  },
}
