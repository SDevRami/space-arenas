import type { EnvelopeCommand } from '@space-arenas/shared'
import { getBuilding, getUnit, getUpgrade } from '@space-arenas/shared'
import type { World } from '../core/world.ts'
import { placementExplored } from '../core/world.ts'
import { nearestPassablePoint } from '../core/pathfinding.ts'
import { buildingRect, setMove, spawnBuilding } from '../entities/factories.ts'
import { dockArrivePoint } from './economy-system.ts'

const SPAWN_POINT_RADIUS_DEFAULT = 2

const clampToRadius = (
  tx: number,
  ty: number,
  rect: { x: number; y: number; w: number; h: number },
  radius: number,
): { x: number; y: number } => {
  const minX = rect.x - radius
  const maxX = rect.x + rect.w - 1 + radius
  const minY = rect.y - radius
  const maxY = rect.y + rect.h - 1 + radius
  return { x: Math.max(minX, Math.min(maxX, tx)), y: Math.max(minY, Math.min(maxY, ty)) }
}

const resolveMovePoint = (world: World, x: number, y: number): { x: number; y: number } => {
  const grid = world.grid
  if (!grid) return { x, y }
  const tx = Math.floor(x / 1000)
  const ty = Math.floor(y / 1000)
  if (tx >= 0 && ty >= 0 && tx < world.width && ty < world.height && grid.passable[ty * world.width + tx]) {
    return { x, y }
  }
  const p = nearestPassablePoint(grid, tx, ty)
  return p ?? { x, y }
}

// Deterministic formation slots around a center point for a group of units,
// mirroring the grid layout used by a move order. Every unit gets its own slot
// (index-ordered), so identical command streams produce identical posts.
const formationSlots = (
  world: World,
  ids: number[],
  cx: number,
  cy: number,
): Map<number, { x: number; y: number }> => {
  const map = new Map<number, { x: number; y: number }>()
  if (ids.length === 0) return map
  const hasVehicle = ids.some((id) => world.units.get(id)?.class === 'vehicle')
  const cell = hasVehicle ? 2400 : 1400
  const cols = Math.ceil(Math.sqrt(ids.length))
  const rows = Math.ceil(ids.length / cols)
  ids.forEach((id, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    const dx = Math.floor((col - (cols - 1) / 2) * cell)
    const dy = Math.floor((row - (rows - 1) / 2) * cell)
    map.set(id, { x: cx + dx, y: cy + dy })
  })
  return map
}

const ownedUnit = (world: World, player: number, id: number): boolean => {
  const u = world.units.get(id)
  return !!u && u.team === player
}

const ownedBuilding = (world: World, player: number, id: number): boolean => {
  const b = world.buildings.get(id)
  return !!b && b.team === player
}

const isFreeDozer = (world: World, player: number, id: number): boolean => {
  const u = world.units.get(id)
  return !!u && u.team === player && u.unitType === 'bulldozer' && !world.works.has(id)
}

const countBuilding = (world: World, type: string, team: number): number => {
  let n = 0
  world.buildings.forEach((_id, b) => {
    if (b.buildingType === type && b.team === team) n++
  })
  return n
}

const blockedByBuilding = (world: World, tx: number, ty: number): boolean => {
  let blocked = false
  world.buildings.forEach((_id, b) => {
    if (blocked) return
    const t = world.transforms.get(_id)
    if (!t) return
    const bx = Math.floor((t.x - b.footprintW * 500) / 1000)
    const by = Math.floor((t.y - b.footprintH * 500) / 1000)
    if (tx >= bx && tx < bx + b.footprintW && ty >= by && ty < by + b.footprintH) blocked = true
  })
  return blocked
}

const placementValid = (world: World, player: number, buildingType: string, tx: number, ty: number): string | null => {
  const def = getBuilding(buildingType, world.settings)
  if (!def) return `unknown building ${buildingType}`
  if (def.countLimit !== undefined && countBuilding(world, buildingType, player) >= def.countLimit) {
    return 'count limit reached'
  }
  world.rebuildGridIfDirty()
  const grid = world.grid
  if (!grid) return 'grid not ready'
  const fog = world.fog.get(player)
  const rect = { x: tx, y: ty, w: def.footprint[0], h: def.footprint[1] }
  if (tx < 0 || ty < 0 || tx + rect.w > world.width || ty + rect.h > world.height) return 'out of bounds'
  if (fog && !placementExplored(fog, world.width, tx, ty, rect.w, rect.h)) return 'area unexplored'
  for (let y = ty; y < ty + rect.h; y++) {
    for (let x = tx; x < tx + rect.w; x++) {
      const idx = y * world.width + x
      if (!grid.buildable[idx]) {
        return blockedByBuilding(world, x, y) ? 'blocked by existing building' : 'cannot build on this terrain'
      }
    }
  }
  return null
}

const forfeitPlayer = (world: World, player: number): number => {
  const teamState = world.teams.get(player)
  let total = teamState?.credits ?? 0
  if (teamState) teamState.credits = 0
  world.clearSatelliteMarkers(player)
  const gone: number[] = []
  world.buildings.forEach((id, b) => {
    if (b.team !== player) return
    const def = getBuilding(b.buildingType, world.settings)
    total += Math.floor((def.cost ?? 0) * world.settings.sellRefundFraction)
    gone.push(id)
  })
  world.units.forEach((id, u) => {
    if (u.team !== player) return
    const def = getUnit(u.unitType, world.settings)
    total += Math.floor((def.cost ?? 0) * world.settings.sellRefundFraction)
    gone.push(id)
  })
  for (const id of gone) world.removeEntity(id)
  world.oilFields.forEach((_id, f) => {
    if (f.owner !== player) return
    f.owner = -1
    f.claimTicks = 0
    f.claimingScout = 0
    f.incomeTicks = 0
  })
  return total
}

const distributeRefundToFields = (world: World, amount: number): void => {
  if (amount <= 0) return
  const supplyPerTrip = world.settings.supplyPerTrip
  if (supplyPerTrip <= 0) return
  const totalTrips = Math.floor(amount / supplyPerTrip)
  if (totalTrips <= 0) return
  const fieldIds: number[] = []
  world.fields.forEach((id) => fieldIds.push(id))
  if (fieldIds.length === 0) return
  const base = Math.floor(totalTrips / fieldIds.length)
  const extra = totalTrips % fieldIds.length
  fieldIds.forEach((id, i) => {
    const f = world.fields.require(id)
    const add = base + (i < extra ? 1 : 0)
    f.capacity += add
    f.trips += add
  })
}

export const InputSystem = {
  name: 'Input',
  update(world: World, commands: EnvelopeCommand[]): void {
    for (const env of commands) {
      const player = env.player
      const cmd = env.cmd
      const teamState = world.teams.get(player)
      if (!teamState) {
        world.emit({ type: 'command-rejected', player, reason: 'unknown player' })
        continue
      }
      switch (cmd.type) {
        case 'move': {
          const mp = resolveMovePoint(world, cmd.x, cmd.y)
          for (const id of cmd.entities) {
            if (!ownedUnit(world, player, id)) continue
            if (world.works.has(id)) {
              world.emit({ type: 'command-rejected', player, reason: 'bulldozer is busy' })
              continue
            }
            const m = setMove(world, id, mp.x, mp.y, false)
            m.needsPath = true
            const a = world.attacks.get(id)
            if (a) {
              a.target = null
              a.targetPos = null
              a.keepAttack = null
              a.guardMode = false
              a.guardPost = null
            }
          }
          break
        }
        case 'attack-move': {
          const target = cmd.target ?? -1
          const mp = resolveMovePoint(world, cmd.x, cmd.y)
          for (const id of cmd.entities) {
            if (!ownedUnit(world, player, id)) continue
            const a = world.attacks.get(id)
            if (!a) continue
            a.keepAttack = null
            a.guardMode = false
            a.guardPost = null
            if (target >= 0 && world.isAlive(target) && !world.sameTeam(player, world.teamOf(target))) {
              a.target = target
            } else {
              a.target = null
            }
            // attack-move always keeps its destination so the unit resumes
            // advancing there once the current target is eliminated.
            a.targetPos = { x: mp.x, y: mp.y }
          }
          break
        }
        case 'keep-attack': {
          const target = cmd.target ?? -1
          const mp = resolveMovePoint(world, cmd.x, cmd.y)
          for (const id of cmd.entities) {
            if (!ownedUnit(world, player, id)) continue
            const a = world.attacks.get(id)
            if (!a) continue
            a.keepAttack = { x: mp.x, y: mp.y }
            a.guardMode = false
            a.guardPost = null
            if (target >= 0 && world.isAlive(target) && !world.sameTeam(player, world.teamOf(target))) {
              a.target = target
            } else {
              a.target = null
            }
            // the spot stays "hot"; the unit advances only to shooting range
            a.targetPos = { x: mp.x, y: mp.y }
            const pl = world.planes.get(id)
            if (pl) {
              pl.hoverX = mp.x
              pl.hoverY = mp.y
            }
          }
          break
        }
        case 'guard': {
          const mp = resolveMovePoint(world, cmd.x, cmd.y)
          const guardIds = cmd.entities.filter(
            (id) => ownedUnit(world, player, id) && world.attacks.has(id) && !world.planes.has(id),
          )
          const planeIds = cmd.entities.filter((id) => ownedUnit(world, player, id) && world.planes.has(id))
          // Hand each ground guard unit its own slot around the post center so a
          // group forms up around the position instead of everyone piling onto
          // the exact same spot (same grid layout as a move order).
          const posts = formationSlots(world, guardIds, mp.x, mp.y)
          for (const id of guardIds) {
            const a = world.attacks.get(id)
            if (!a) continue
            const slot = posts.get(id) ?? { x: mp.x, y: mp.y }
            a.keepAttack = null
            a.guardMode = true
            a.guardPost = { x: slot.x, y: slot.y }
            // guard = march to the post slot first, then hold there as a turret.
            // It never chases: targets are only auto-acquired when already in
            // range of the post, so we don't assign a direct target here.
            a.target = null
            a.targetPos = { x: slot.x, y: slot.y }
          }
          for (const id of planeIds) {
            const a = world.attacks.get(id)
            const pl = world.planes.get(id)
            if (!a || !pl) continue
            a.keepAttack = null
            a.guardMode = true
            a.guardPost = { x: mp.x, y: mp.y }
            a.target = null
            a.targetPos = { x: mp.x, y: mp.y }
            pl.hoverX = mp.x
            pl.hoverY = mp.y
          }
          break
        }
        case 'stop': {
          for (const id of cmd.entities) {
            if (!ownedUnit(world, player, id)) continue
            world.moves.delete(id)
            const a = world.attacks.get(id)
            if (a) {
              a.target = null
              a.keepAttack = null
              a.guardMode = false
              a.guardPost = null
            }
            const w = world.works.get(id)
            if (w) {
              world.works.delete(id)
              const b = world.buildings.get(w.building)
              if (b && b.assignedDozer === id) b.assignedDozer = 0
              world.emit({ type: 'work-cancelled', entity: id, building: w.building, team: player })
            }
          }
          break
        }
        case 'attack': {
          // Determine the selected attack units (shooters that can issue an
          // attack); buildings are handled below but have no position of their
          // own for a ground march, so keep them out of the formation slots.
          const enemyTarget =
            cmd.target !== undefined && cmd.target >= 0 && world.isAlive(cmd.target) && !world.sameTeam(player, world.teamOf(cmd.target))
              ? cmd.target
              : -1
          const attackIds = cmd.entities.filter(
            (id) => ownedUnit(world, player, id) && world.attacks.has(id),
          )
          // Attacking empty ground: give each unit its own formation slot around
          // the clicked point (same grid layout as a move order) so a group
          // spreads instead of piling onto the exact same spot. The combat system
          // then marches it there, and it stops once inside firing range.
          const slots = enemyTarget < 0 ? formationSlots(world, attackIds, cmd.x, cmd.y) : null
          for (const id of cmd.entities) {
            const a = world.attacks.get(id)
            const isOwn = ownedUnit(world, player, id) || ownedBuilding(world, player, id)
            if (!a || !isOwn) continue
            a.keepAttack = null
            a.guardMode = false
            a.guardPost = null
            if (enemyTarget >= 0) {
              a.target = enemyTarget
              a.targetPos = null
            } else {
              a.target = null
              const slot = slots?.get(id)
              a.targetPos = slot ? { x: slot.x, y: slot.y } : { x: cmd.x, y: cmd.y }
            }
          }
          break
        }
        case 'build': {
          const dozerId = cmd.entities[0]
          const target = cmd.target ?? -1
          if (dozerId === undefined || target < 0) break
          if (!ownedUnit(world, player, dozerId)) break
          const du = world.units.require(dozerId)
          if (du.unitType !== 'bulldozer') break
          if (world.works.has(dozerId)) break
          const b = world.buildings.get(target)
          if (!b || b.team !== player) break
          const prev = b.assignedDozer
          if (prev !== 0 && prev !== dozerId) {
            if (world.works.has(prev)) {
              world.works.delete(prev)
              world.moves.delete(prev)
            }
          }
          const kind: 'construct' | 'repair' = b.done ? 'repair' : 'construct'
          if (kind === 'repair') {
            const h = world.healths.get(target)
            if (!h || h.hp >= h.maxHp) break
          }
          b.assignedDozer = dozerId
          world.works.set(dozerId, { kind, building: target })
          world.moves.delete(dozerId)
          world.emit({ type: 'dozer-assigned', entity: dozerId, building: target, kind, team: player })
          break
        }
        case 'collect': {
          const dozerId = cmd.entities[0]
          const target = cmd.target ?? -1
          if (dozerId === undefined || target < 0) break
          if (!ownedUnit(world, player, dozerId)) break
          const du = world.units.require(dozerId)
          if (du.unitType !== 'bulldozer') break
          if (world.works.has(dozerId)) break
          const w = world.wrecks.get(target)
          if (!w) break
          world.works.set(dozerId, { kind: 'collect', building: target })
          world.moves.delete(dozerId)
          break
        }
        case 'set-spawn-point': {
          const id = cmd.entities[0]
          if (id === undefined || !ownedBuilding(world, player, id)) break
          const b = world.buildings.require(id)
          if (!b.done || !getBuilding(b.buildingType, world.settings).producesUnit) break
          const tx = Math.floor(cmd.x)
          const ty = Math.floor(cmd.y)
          if (tx < 0 || ty < 0 || tx >= world.width || ty >= world.height) {
            world.emit({ type: 'command-rejected', player, reason: 'spawn point out of bounds' })
            break
          }
          const clamped = clampToRadius(tx, ty, buildingRect(world, id), world.settings.spawnRange ?? SPAWN_POINT_RADIUS_DEFAULT)
          const grid = world.grid
          if (grid && !grid.passable[clamped.y * world.width + clamped.x]) {
            world.emit({ type: 'command-rejected', player, reason: 'spawn point blocked' })
            break
          }
          b.spawnTx = clamped.x
          b.spawnTy = clamped.y
          world.emit({ type: 'spawn-point-set', building: id, team: player })
          break
        }
        case 'set-flag-point': {
          const id = cmd.entities[0]
          if (id === undefined || !ownedBuilding(world, player, id)) break
          const b = world.buildings.require(id)
          if (!b.done || !getBuilding(b.buildingType, world.settings).producesUnit) break
          const tx = Math.floor(cmd.x)
          const ty = Math.floor(cmd.y)
          if (tx < 0 || ty < 0 || tx >= world.width || ty >= world.height) {
            world.emit({ type: 'command-rejected', player, reason: 'flag point out of bounds' })
            break
          }
          b.flagTx = tx
          b.flagTy = ty
          world.emit({ type: 'flag-point-set', building: id, team: player })
          break
        }
        case 'assign-dock': {
          const target = cmd.target ?? -1
          if (target < 0) break
          const dock = world.buildings.get(target)
          if (!dock || dock.team !== player || dock.buildingType !== 'supply-dock') break
          for (const id of cmd.entities) {
            const hv = world.harvesters.get(id)
            if (!hv || !ownedUnit(world, player, id)) continue
            hv.dock = target
            if (hv.phase === 'to-dock' && world.isAlive(target)) {
              const p = dockArrivePoint(world, target, id)
              if (p) {
                const m = setMove(world, id, p.x, p.y)
                m.needsPath = true
              }
            }
            world.emit({ type: 'harvester-dock-assigned', entity: id, building: target, team: player })
          }
          break
        }
        case 'satellite': {
          if (!teamState.satellite) {
            world.emit({ type: 'command-rejected', player, reason: 'satellite not researched' })
            break
          }
          if (!world.hasDoneBuilding(player, 'tech-center')) {
            world.emit({ type: 'command-rejected', player, reason: 'tech center destroyed' })
            break
          }
          if (world.tick - teamState.satelliteLastUsed < world.settings.satelliteCooldownTicks) {
            world.emit({ type: 'command-rejected', player, reason: 'satellite on cooldown' })
            break
          }
          teamState.satelliteLastUsed = world.tick
          teamState.satelliteRevealUntil = world.tick + world.settings.satelliteRevealTicks
          world.clearSatelliteMarkers(player)
          let ccX = Math.floor(world.width / 2)
          let ccY = Math.floor(world.height / 2)
          world.buildings.forEach((_id, b) => {
            if (b.team === player && b.buildingType === 'command-center') {
              const t = world.transforms.get(_id)
              if (t) {
                ccX = Math.floor(t.x / 1000)
                ccY = Math.floor(t.y / 1000)
              }
            }
          })
          world.addSatelliteMarker(player, ccX * 1000 + 500, ccY * 1000 + 500, world.tick + world.settings.satelliteRevealTicks)
          world.emit({ type: 'satellite-used', team: player })
          break
        }
        case 'laser': {
          if (!teamState.laser) {
            world.emit({ type: 'command-rejected', player, reason: 'space laser not researched' })
            break
          }
          if (world.tick - teamState.laserLastUsed < world.settings.laserCooldownTicks) {
            world.emit({ type: 'command-rejected', player, reason: 'space laser on cooldown' })
            break
          }
          if (teamState.powerDown) {
            world.emit({ type: 'command-rejected', player, reason: 'insufficient power' })
            break
          }
          const laserTx = Math.floor(cmd.x)
          const laserTy = Math.floor(cmd.y)
          if (laserTx < 0 || laserTy < 0 || laserTx >= world.width || laserTy >= world.height) {
            world.emit({ type: 'command-rejected', player, reason: 'laser target out of bounds' })
            break
          }
          const swAlive = world.hasDoneBuilding(player, 'super-weapon')
          if (!swAlive) {
            if (teamState.laserFreeShotUsed) {
              world.emit({ type: 'command-rejected', player, reason: 'space laser offline — rebuild the super weapon' })
              break
            }
            if (!world.hasDoneBuilding(player, 'command-center')) {
              world.emit({ type: 'command-rejected', player, reason: 'command center destroyed' })
              break
            }
          }
          teamState.laserLastUsed = world.tick
          if (!swAlive) teamState.laserFreeShotUsed = true
          const level = world.laserLevel(player)
          const delay = level >= 2 ? world.settings.laserDelayTicksLv2 : world.settings.laserDelayTicksLv1
          const startTick = world.tick + delay
          const laserId = world.createEntity('marker', player)
          world.transforms.set(laserId, { x: laserTx * 1000 + 500, y: laserTy * 1000 + 500 })
          world.lasers.set(laserId, {
            team: player,
            radius: world.laserStrikeRadius(player),
            startTick,
            untilTick: startTick + world.settings.laserDurationTicks,
          })
          world.emit({ type: 'laser-strike', team: player, x: laserTx * 1000 + 500, y: laserTy * 1000 + 500 })
          break
        }
        case 'max-power': {
          for (const id of cmd.entities) {
            const b = world.buildings.get(id)
            if (!b || b.team !== player) continue
            if (!b.done) {
              world.emit({ type: 'command-rejected', player, reason: 'building not finished' })
              continue
            }
            if (b.buildingType !== 'power-plant') {
              world.emit({ type: 'command-rejected', player, reason: 'wrong building' })
              continue
            }
            if (b.maxPowerUntil > world.tick) {
              world.emit({ type: 'command-rejected', player, reason: 'max power already active' })
              continue
            }
            const h = world.healths.get(id)
            if (!h || h.hp < h.maxHp) {
              world.emit({ type: 'command-rejected', player, reason: 'requires full health' })
              continue
            }
            b.maxPowerUntil = world.tick + world.settings.maxPowerTicks
            // HP drains from the moment the boost starts, not only at expiry
            b.maxPowerHpTarget = Math.ceil(h.maxHp * 0.5)
            world.emit({ type: 'power-boost', entity: id, team: player })
          }
          break
        }
        case 'place': {
          const tx = Math.floor(cmd.x)
          const ty = Math.floor(cmd.y)
          const buildingType = cmd.buildingType ?? ''
          const reason = placementValid(world, player, buildingType, tx, ty)
          if (reason) {
            world.emit({ type: 'command-rejected', player, reason })
            break
          }
          const dozerId = cmd.entities[0]
          if (dozerId === undefined || !isFreeDozer(world, player, dozerId)) {
            world.emit({ type: 'command-rejected', player, reason: 'no available bulldozer' })
            break
          }
  const def = getBuilding(buildingType, world.settings)
          if (teamState.credits < def.cost) {
            world.emit({ type: 'command-rejected', player, reason: 'insufficient credits' })
            break
          }
          teamState.credits -= def.cost
          const id = spawnBuilding(world, buildingType, player, tx, ty, false)
          const b = world.buildings.require(id)
          b.assignedDozer = dozerId
          world.works.set(dozerId, { kind: 'construct', building: id })
          world.moves.delete(dozerId)
          world.emit({ type: 'building-placed', entity: id, buildingType, team: player })
          world.emit({ type: 'dozer-assigned', entity: dozerId, building: id, kind: 'construct', team: player })
          break
        }
        case 'forfeit': {
          const refundTotal = forfeitPlayer(world, player)
          distributeRefundToFields(world, refundTotal)
          world.emit({ type: 'player-left', team: player, amount: refundTotal })
          break
        }
        case 'sell': {
          for (const id of cmd.entities) {
            const b = world.buildings.get(id)
            if (b) {
              if (b.team !== player) continue
              // Buildings sell over a short timer: the status frames play in
              // reverse (5→1) while the building can still be attacked. The
              // refund is only granted if it survives the full timer (SellSystem).
              if (b.sellingUntil > world.tick) continue
              b.sellingUntil = world.tick + world.settings.sellTicks
              if (b.assignedDozer !== 0) {
                const w = world.works.get(b.assignedDozer)
                if (w && w.building === id) {
                  world.works.delete(b.assignedDozer)
                  world.moves.delete(b.assignedDozer)
                }
                b.assignedDozer = 0
              }
              world.queues.delete(id)
              b.researching = ''
              b.researchTicks = 0
              continue
            }
            const u = world.units.get(id)
            if (u && u.team === player) {
              const def = getUnit(u.unitType, world.settings)
              const refund = Math.floor(def.cost * world.settings.sellRefundFraction)
              teamState.credits += refund
              world.moves.delete(id)
              world.works.delete(id)
              world.attacks.delete(id)
              world.harvesters.delete(id)
              const ut = world.transforms.get(id)
              world.emit({ type: 'unit-sold', entity: id, unitType: u.unitType, team: player, refund, x: ut?.x ?? 0, y: ut?.y ?? 0 })
              world.removeEntity(id)
            }
          }
          break
        }
        case 'queue': {
          const id = cmd.entities[0]
          if (id === undefined || !ownedBuilding(world, player, id)) break
          const b = world.buildings.require(id)
          if (!b.done) {
            world.emit({ type: 'command-rejected', player, reason: 'building not finished' })
            break
          }
          const unitType = cmd.unitType ?? ''
          const ud = getUnit(unitType, world.settings)
          if (ud.producedBy !== b.buildingType) {
            world.emit({ type: 'command-rejected', player, reason: 'wrong producer' })
            break
          }
          if (ud.class === 'air') {
            let airCount = 0
            world.planes.forEach((_pid, p) => {
              if (p.home === id) airCount++
            })
            const existingQ = world.queues.get(id)
            if (existingQ) {
              for (const o of existingQ.queue) {
                const od = getUnit(o.unitType, world.settings)
                if (od.class === 'air') airCount++
              }
            }
            const cap = ud.capacity ?? 3
            if (airCount >= cap) {
              world.emit({ type: 'command-rejected', player, reason: 'air force full' })
              break
            }
          }
          const q = world.queues.get(id) ?? { queue: [] }
          if (q.queue.length >= world.settings.queueLimit) {
            world.emit({ type: 'command-rejected', player, reason: `queue full (max ${world.settings.queueLimit})` })
            break
          }
          if (teamState.credits < ud.cost) {
            world.emit({ type: 'command-rejected', player, reason: 'insufficient credits' })
            break
          }
          teamState.credits -= ud.cost
          q.queue.push({ unitType, remainingTicks: ud.buildTimeTicks })
          world.queues.set(id, q)
          world.emit({ type: 'order-queued', building: id, unitType, team: player })
          break
        }
        case 'dequeue': {
          const id = cmd.entities[0]
          if (id === undefined || !ownedBuilding(world, player, id)) break
          const q = world.queues.get(id)
          if (!q) break
          const index = cmd.index ?? 0
          if (index >= 0 && index < q.queue.length) {
            const removed = q.queue.splice(index, 1)[0]
            const ud = getUnit(removed.unitType, world.settings)
            teamState.credits += ud.cost
            world.emit({ type: 'order-dequeued', building: id, unitType: removed.unitType, team: player })
          }
          break
        }
        case 'research': {
          const id = cmd.entities[0]
          if (id === undefined || !ownedBuilding(world, player, id)) break
          const b = world.buildings.require(id)
          if (!b.done) {
            world.emit({ type: 'command-rejected', player, reason: 'building not finished' })
            break
          }
          if (b.researching !== '') {
            world.emit({ type: 'command-rejected', player, reason: 'already researching' })
            break
          }
          const upgradeType = cmd.upgrade ?? ''
          const up = getUpgrade(upgradeType, world.settings)
          if (!up) {
            world.emit({ type: 'command-rejected', player, reason: 'unknown upgrade' })
            break
          }
          if (up.availableAt !== b.buildingType) {
            world.emit({ type: 'command-rejected', player, reason: 'wrong building' })
            break
          }
          const cost = up.id === 'space-laser' ? world.laserUpgradeCost(player, up.cost) : up.cost
          if (up.id === 'space-laser' && world.laserLevel(player) >= world.laserMaxLevel()) {
            world.emit({ type: 'command-rejected', player, reason: 'laser maxed' })
            break
          }
          if (teamState.credits < cost) {
            world.emit({ type: 'command-rejected', player, reason: 'insufficient credits' })
            break
          }
          teamState.credits -= cost
          b.researching = upgradeType
          b.researchTicks = up.researchTimeTicks
          world.emit({ type: 'research-started', building: id, upgrade: upgradeType, team: player })
          break
        }
      }
    }
  },
}
