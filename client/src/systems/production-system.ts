import { Terrain, getUnit, isPassableTerrain, tileAt } from '@space-arenas/shared'
import type { World, WorldGrid } from '../core/world.ts'
import { setMove, spawnUnit } from '../entities/factories.ts'

export const findSpawnTile = (world: World, buildingId: number, grid: WorldGrid): { x: number; y: number } | null => {
  const b = world.buildings.get(buildingId)
  // Docks produce naval units, so their spawn tile must be open water; every
  // other producer keeps the land-passable rule.
  const naval = b?.buildingType === 'dock'
  const mask = naval ? grid.water : grid.passable
  if (b && b.spawnTx >= 0) {
    const sx = b.spawnTx
    const sy = b.spawnTy
    if (sx >= 0 && sy >= 0 && sx < world.width && sy < world.height && mask[sy * world.width + sx]) {
      return { x: sx, y: sy }
    }
  }
  const t = world.transforms.require(buildingId)
  const cx = Math.floor(t.x / 1000)
  const cy = Math.floor(t.y / 1000)
  for (let r = 1; r <= 5; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
        const x = cx + dx
        const y = cy + dy
        if (x < 0 || y < 0 || x >= world.width || y >= world.height) continue
        if (naval ? tileAt(world.map, x, y) !== Terrain.Water : !isPassableTerrain(tileAt(world.map, x, y))) continue
        if (!mask[y * world.width + x]) continue
        return { x, y }
      }
    }
  }
  return null
}

export const ProductionSystem = {
  name: 'Production',
  update(world: World): void {
    world.rebuildGridIfDirty()
    const grid = world.grid
    if (!grid) return
    world.queues.forEach((id, q) => {
      const b = world.buildings.get(id)
      if (!b || !b.done) return
      if (b.team < 0) return
      if (world.empStunned(id)) return
      const s = world.teams.get(b.team)
      if (!s || s.powerDown) return
      if (q.queue.length === 0) return
      const order = q.queue[0]
      order.remainingTicks--
      if (order.remainingTicks > 0) return
      q.queue.shift()
      const spot = findSpawnTile(world, id, grid)
      if (!spot) return
      const ud = getUnit(order.unitType, world.settings)
      const x = spot.x * 1000 + 500
      const y = spot.y * 1000 + 500
      const unitId = spawnUnit(world, order.unitType, b.team, x, y)
      if (ud.isHarvester) {
        world.harvesters.set(unitId, { phase: 'idle', field: -1, dock: id, loadTicks: 0 })
      }
      if (ud.class === 'air') {
        const bt = world.transforms.require(id)
        let airCount = 0
        world.planes.forEach((_pid, p) => {
          if (p.home === id) airCount++
        })
        const offsets = [
          { x: 0, y: -900 },
          { x: 900, y: 0 },
          { x: 0, y: 900 },
        ]
        const off = offsets[airCount % offsets.length]
        world.planes.set(unitId, {
          home: id,
          state: 'idle',
          hoverX: bt.x + off.x,
          hoverY: bt.y + off.y,
          ammo: ud.maxAmmo ?? 2,
          reloadTicks: 0,
        })
      }
      if (!ud.isHarvester && ud.class !== 'air' && b.flagTx >= 0 && b.flagTy >= 0) {
        const m = setMove(world, unitId, b.flagTx * 1000 + 500, b.flagTy * 1000 + 500, false)
        m.needsPath = true
      }
      world.emit({ type: 'unit-trained', entity: unitId, unitType: order.unitType, team: b.team })
    })
  },
}
