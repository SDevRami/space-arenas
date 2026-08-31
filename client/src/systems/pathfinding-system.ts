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
      if (world.units.get(id)?.class === 'air') {
        m.needsPath = false
        return
      }
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
      if (lineClear(grid, sx, sy, tx, ty)) {
        m.needsPath = false
        return
      }
      const startIdx = sy * grid.width + sx
      const goalIdx = ty * grid.width + tx
      const inBounds = tx >= 0 && ty >= 0 && tx < grid.width && ty < grid.height
      if (inBounds && grid.passable[goalIdx] && grid.component[startIdx] !== grid.component[goalIdx]) {
        world.moves.delete(id)
        return
      }
      if (budget <= 0) return
      budget--
      const path = findPathNear(grid, sx, sy, tx, ty, 5, maxNodes, costs)
      if (path === undefined) {
        m.repathCooldown = CAP_RETRY_TICKS
        return
      }
      if (path === null || path.length === 0) {
        world.moves.delete(id)
        return
      }
      m.path = path
      m.pathIndex = 0
      m.needsPath = false
    })
  },
}
