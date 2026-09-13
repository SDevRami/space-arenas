import { getBuilding } from '@space-arenas/shared'
import type { EnvelopeCommand } from '@space-arenas/shared'
import type { World } from '../core/world.ts'

/** Resolves pending sell timers. When a building's sellingUntil tick is reached,
 * the owner receives the sell refund and the building is removed. If the building
 * was destroyed before the timer completes (by combat), no refund is granted. */
export const SellSystem = {
  name: 'Sell',
  update(world: World, _commands: EnvelopeCommand[]): void {
    const toSell: number[] = []
    world.buildings.forEach((id, b) => {
      if (b.sellingUntil > 0 && world.tick >= b.sellingUntil) {
        toSell.push(id)
      }
    })
    for (const id of toSell) {
      const b = world.buildings.get(id)
      if (!b) continue
      const def = getBuilding(b.buildingType, world.settings)
      const refund = Math.floor(def.cost * world.settings.sellRefundFraction)
      world.grantCredits(b.team, refund)
      const bt = world.transforms.get(id)
      world.emit({ type: 'building-sold', entity: id, buildingType: b.buildingType, team: b.team, refund, x: bt?.x ?? 0, y: bt?.y ?? 0 })
      world.removeEntity(id)
    }
  },
}
