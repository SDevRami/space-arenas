import { sqDist } from '@space-arenas/shared'
import type { World } from '../core/world.ts'

/** Owned supply fields never go exclusive: enemy harvesters still harvest base
 *  supply, but only the holding team's trips earn the `supplyFieldBonus`. */
export const SupplyCaptureSystem = {
  name: 'SupplyCapture',
  update(world: World): void {
    const claimTicks = world.settings.supplyFieldClaimTicks
    const holdTicks = world.settings.supplyFieldHoldTicks
    world.fields.forEach((id, f) => {
      const t = world.transforms.get(id)
      if (!t) return
      const half = f.radius * 1000 + 1500

      let scout = 0
      let bestD = Infinity
      world.units.forEach((uid, u) => {
        if (u.unitType !== 'scout') return
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
        f.captureTicks = 0
        f.capturingScout = 0
        if (f.capturer >= 0) {
          f.holdTicks++
          if (f.holdTicks >= holdTicks) {
            world.emit({ type: 'supply-captured-lost', field: id, team: f.capturer })
            f.capturer = -1
            f.holdTicks = 0
          }
        }
        return
      }

      const team = world.units.get(scout)?.team ?? -1
      if (team === f.capturer) {
        f.holdTicks = 0
        f.captureTicks = 0
        f.capturingScout = 0
        return
      }

      const prevTeam = f.capturingScout !== 0 ? (world.units.get(f.capturingScout)?.team ?? -1) : -2
      if (prevTeam !== team) f.captureTicks = 0
      f.holdTicks = 0
      f.capturingScout = scout
      f.captureTicks++
      if (f.captureTicks >= claimTicks) {
        f.capturer = team
        f.captureTicks = 0
        f.capturingScout = 0
        f.holdTicks = 0
        world.emit({ type: 'supply-captured', field: id, team })
      }
    })
  },
}