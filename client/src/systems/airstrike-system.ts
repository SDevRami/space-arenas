import { AIRSTRIKE_BOMB_DAMAGE, AIRSTRIKE_BOMB_RADIUS, AIRSTRIKE_PLANES, AIRSTRIKE_PLANE_SPEED, AIRSTRIKE_PLANE_STAGGER_TICKS, isqrt, sqDist, tileToFx } from '@space-arenas/shared'
import type { World } from '../core/world.ts'
import { explodeAt } from './combat-system.ts'

/**
 * Day 13: an Airstrike — a squadron of kamikaze planes that flies in from the
 * top map edge and bombs the target point in sequence. Each plane is a marker
 * entity driven entirely by the tick (deterministic, no RNG): it holds at its
 * spawn point until `startTick`, then cruises at `AIRSTRIKE_PLANE_SPEED`
 * straight at the target, where it drops a bomb (area damage) and disappears.
 */
export const spawnAirstrike = (world: World, team: number, tx: number, ty: number): void => {
  const targetX = tx * 1000 + 500
  const targetY = ty * 1000 + 500
  const mid = (AIRSTRIKE_PLANES - 1) / 2
  for (let i = 0; i < AIRSTRIKE_PLANES; i++) {
    const id = world.createEntity('marker', team)
    const startX = targetX + (i - mid) * tileToFx(1)
    const startY = -tileToFx(2)
    world.transforms.set(id, { x: startX, y: startY })
    world.visions.set(id, { radius: 6 })
    world.airstrikes.set(id, {
      team,
      startX,
      startY,
      tx: targetX,
      ty: targetY,
      startTick: world.tick + i * AIRSTRIKE_PLANE_STAGGER_TICKS,
    })
  }
}

export const AirstrikeSystem = {
  name: 'Airstrike',
  update(world: World): void {
    const dead: number[] = []
    world.airstrikes.forEach((id, a) => {
      const t = world.transforms.get(id)
      if (!t) {
        dead.push(id)
        return
      }
      if (world.tick < a.startTick) {
        t.x = a.startX
        t.y = a.startY
        return
      }
      const d = isqrt(sqDist(t.x, t.y, a.tx, a.ty))
      if (d <= AIRSTRIKE_PLANE_SPEED) {
        t.x = a.tx
        t.y = a.ty
        world.emit({ type: 'airstrike-bomb', team: a.team, x: a.tx, y: a.ty })
        explodeAt(world, a.team, a.tx, a.ty, AIRSTRIKE_BOMB_RADIUS, AIRSTRIKE_BOMB_DAMAGE)
        dead.push(id)
      } else {
        t.x = t.x + Math.floor(((a.tx - t.x) * AIRSTRIKE_PLANE_SPEED) / d)
        t.y = t.y + Math.floor(((a.ty - t.y) * AIRSTRIKE_PLANE_SPEED) / d)
      }
    })
    for (const id of dead) world.removeEntity(id)
  },
}