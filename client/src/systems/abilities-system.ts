import type { World } from '../core/world.ts'
import { explodeAt } from './combat-system.ts'

/** Household-sized ability bookkeeping: grenade fuses, smoke clouds, and the
 * ability cooldowns they share. Explosions are handled here (not in Combat) so
 * a thrown grenade detonates exactly `grenadeFuseTicks` after launch, killing
 * target units around the landing point via `explodeAt`. */
export const AbilitiesSystem = {
  name: 'Abilities',
  update(world: World): void {
    const exploded: number[] = []
    world.grenades.forEach((id, g) => {
      if (world.tick >= g.explodeAt) {
        exploded.push(id)
        world.emit({ type: 'grenade-exploded', team: g.team, x: g.x, y: g.y })
        explodeAt(world, g.team, g.x, g.y, g.radius, g.damage)
      }
    })
    for (const id of exploded) world.removeEntity(id)

    const cleared: number[] = []
    world.smokes.forEach((id, s) => {
      if (world.tick >= s.untilTick) cleared.push(id)
    })
    for (const id of cleared) world.removeEntity(id)

    // Cooldowns count down naturally; once expired they reset so the hashed
    // value stays small and a fresh throw can be validated against tick 0.
    world.units.forEach((id) => {
      const u = world.units.get(id)
      if (u && u.abilityCooldown !== 0 && world.tick >= u.abilityCooldown) u.abilityCooldown = 0
    })
  },
}