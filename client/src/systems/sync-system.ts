import type { World } from '../core/world.ts'
import { hashWorld } from '../core/hash.ts'

export const SyncSystem = {
  name: 'Sync',
  update(world: World): void {
    world.lastHash = hashWorld(world)
    if (world.tick % 60 === 0 && world.onSyncTick) {
      world.onSyncTick(world.lastHash)
    }
  },
}
