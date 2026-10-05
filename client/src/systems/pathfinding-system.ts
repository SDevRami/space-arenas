import { fxToTile } from '@space-arenas/shared'
import type { World } from '../core/world.ts'
import { findPathNear, lineClear } from '../core/pathfinding.ts'

const CAP_RETRY_TICKS = 20

export const PathfindingSystem = {
  name: 'Pathfinding',
  update(world: World): void {
    world.rebuildGridIfDirty()
    const grid = world.grid
    if (!grid) return
    let budget = world.settings.pathBudgetPerTick
    const maxNodes = world.settings.pathMaxNodes
    const costs = { straight: world.settings.astarCostStraight, diagonal: world.settings.astarCostDiagonal }
    world.moves.forEach((id, m) => {
      if (m.repathCooldown > 0) {
        m.repathCooldown--
        return
      }
      if (m.path.length > 0 || !m.needsPath) return
      const u = world.units.get(id)
      if (u?.class === 'air') {
        m.needsPath = false
        return
      }
      // Naval units sail exclusively on the water mask; ground units use the
      // land-passable mask as before.
      const naval = u?.class === 'naval'
      const mask = naval ? grid.water : grid.passable
      const comp = naval ? grid.waterComponent : grid.component
      const t = world.transforms.get(id)
      if (!t) return
      const sx = fxToTile(t.x)
      const sy = fxToTile(t.y)
      const tx = fxToTile(m.tx)
      const ty = fxToTile(m.ty)
      if (sx === tx && sy === ty) {
        m.needsPath = false
        return
      }
      if (lineClear(grid, sx, sy, tx, ty, mask)) {
        m.needsPath = false
        return
      }
      const startIdx = sy * grid.width + sx
      const goalIdx = ty * grid.width + tx
      const inBounds = tx >= 0 && ty >= 0 && tx < grid.width && ty < grid.height
      const marchDirect = (): void => {
        // Unreachable goal (start and target sit on separate land masses, e.g.
        // the target is across impassable water, or the goal tile is fully
        // walled off). Deleting the move froze units in place — combat kept
        // re-creating a chase move every tick while pathfinding deleted it, so
        // the unit never advanced. March straight toward the target instead:
        // the unit gets as close as the terrain allows and then stops at the
        // obstacle, re-attempting a real path once the way opens up.
        m.path = []
        m.pathIndex = 0
        m.needsPath = false
        m.repathCooldown = CAP_RETRY_TICKS
      }
      if (inBounds && mask[goalIdx] && comp[startIdx] !== comp[goalIdx]) {
        marchDirect()
        return
      }
      if (budget <= 0) return
      budget--
      const path = findPathNear(grid, sx, sy, tx, ty, 5, maxNodes, costs, mask, comp)
      if (path === undefined) {
        m.repathCooldown = CAP_RETRY_TICKS
        return
      }
      if (path === null || path.length === 0) {
        marchDirect()
        return
      }
      m.path = path
      m.pathIndex = 0
      m.needsPath = false
    })
  },
}
