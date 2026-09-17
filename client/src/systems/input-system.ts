import type { EnvelopeCommand } from '@space-arenas/shared'
import { canThrowBandolier, getBuilding, getUnit, getUpgrade, sqDist, tileToFx, SW_CHOICES, EMP_RADIUS_TILES, isqrt, EXPANSION_RADIUS_TILES, SCORE_EXPANSION, AIRSTRIKE_BOMB_DAMAGE, AIRSTRIKE_BOMB_RADIUS } from '@space-arenas/shared'
import type { World } from '../core/world.ts'
import { placementExplored, PING_TICKS } from '../core/world.ts'
import { nearestPassablePoint } from '../core/pathfinding.ts'
import { buildingRect, setMove, spawnBuilding } from '../entities/factories.ts'
import { dockArrivePoint } from './economy-system.ts'
import { startNextQueued } from './work-system.ts'
import { spawnAirstrike } from './airstrike-system.ts'

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
  return !!u && world.canControl(player, id)
}

const ownedBuilding = (world: World, player: number, id: number): boolean => {
  const b = world.buildings.get(id)
  return !!b && world.canControl(player, id)
}

/** Day 20: whether a bulldozer may take one more build order. A busy dozer is
 *  only eligible while it is constructing (not collecting/repairing), and the
 *  total (active construct + queued) must stay below settings.maxBuildOrders. */
const canAcceptBuildOrder = (world: World, player: number, id: number): { ok: boolean; reason: string } => {
  const u = world.units.get(id)
  if (!u || u.unitType !== 'bulldozer' || !world.canControl(player, id)) return { ok: false, reason: 'no available bulldozer' }
  const w = world.works.get(id)
  const queued = world.buildOrderQueues.get(id)?.length ?? 0
  if (w) {
    if (w.kind !== 'construct') return { ok: false, reason: 'no available bulldozer' }
    if (1 + queued >= world.settings.maxBuildOrders) return { ok: false, reason: 'build order queue full' }
  } else if (queued >= world.settings.maxBuildOrders) {
    return { ok: false, reason: 'build order queue full' }
  }
  return { ok: true, reason: '' }
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
  // With a shared alliance bank the forfeiting member must not wipe the pool,
  // so only zero their own slot when it really is the bank's slot.
  if (teamState && world.creditsSlot(player) === player) teamState.credits = 0
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
    if (world.pings.length > 0) {
      const cutoff = world.tick - PING_TICKS
      const pings = world.pings
      let w = 0
      for (let r = 0; r < pings.length; r++) {
        if (pings[r].started >= cutoff) pings[w++] = pings[r]
      }
      pings.length = w
    }
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
          const explicit =
            target >= 0 && world.isAlive(target) && !world.sameTeam(player, world.teamOf(target))
          for (const id of cmd.entities) {
            if (!ownedUnit(world, player, id)) continue
            const a = world.attacks.get(id)
            if (!a) continue
            if (explicit) {
              // An explicit order on a specific enemy overrides the keep-attack
              // stance: chase the target for real instead of only engaging it
              // inside the leash around the spot.
              a.keepAttack = null
              a.guardMode = false
              a.guardPost = null
              a.target = target
              a.targetPos = null
              continue
            }
            a.keepAttack = { x: mp.x, y: mp.y }
            a.guardMode = false
            a.guardPost = null
            a.target = null
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
          const target = cmd.target ?? -1
          const mp = resolveMovePoint(world, cmd.x, cmd.y)
          const explicit =
            target >= 0 && world.isAlive(target) && !world.sameTeam(player, world.teamOf(target))
          if (explicit) {
            // An explicit order on a specific enemy overrides the guard stance:
            // march onto it instead of holding the post.
            for (const id of cmd.entities) {
              if (!ownedUnit(world, player, id)) continue
              const a = world.attacks.get(id)
              if (!a) continue
              a.keepAttack = null
              a.guardMode = false
              a.guardPost = null
              a.target = target
              a.targetPos = null
            }
            break
          }
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
        case 'grenade': {
          if (!teamState.abilitiesUnlocked) {
            world.emit({ type: 'command-rejected', player, reason: 'abilities tech not researched' })
            break
          }
          for (const id of cmd.entities) {
            const u = world.units.get(id)
            if (!u || !world.canControl(player, id)) continue
            if (!canThrowBandolier({ id: u.unitType, class: u.class })) {
              world.emit({ type: 'command-rejected', player, reason: 'unit cannot use ability' })
              continue
            }
            if (u.abilityCooldown > world.tick) {
              world.emit({ type: 'command-rejected', player, reason: 'ability on cooldown' })
              continue
            }
            const t = world.transforms.get(id)
            if (!t) continue
            const rangeFx = tileToFx(world.settings.grenadeRange)
            if (sqDist(t.x, t.y, cmd.x, cmd.y) > rangeFx * rangeFx) {
              world.emit({ type: 'command-rejected', player, reason: 'target out of throw range' })
              continue
            }
            u.abilityCooldown = world.tick + world.settings.grenadeCooldownTicks
            const gid = world.createEntity('marker', player)
            world.transforms.set(gid, { x: cmd.x, y: cmd.y })
            world.grenades.set(gid, {
              team: player,
              fromX: t.x,
              fromY: t.y,
              x: cmd.x,
              y: cmd.y,
              startTick: world.tick,
              explodeAt: world.tick + world.settings.grenadeFuseTicks,
              radius: world.settings.grenadeBlastRadius,
              damage: world.settings.grenadeDamage,
            })
          }
          break
        }
        case 'smoke': {
          if (!teamState.abilitiesUnlocked) {
            world.emit({ type: 'command-rejected', player, reason: 'abilities tech not researched' })
            break
          }
          for (const id of cmd.entities) {
            const u = world.units.get(id)
            if (!u || !world.canControl(player, id)) continue
            if (!canThrowBandolier({ id: u.unitType, class: u.class })) {
              world.emit({ type: 'command-rejected', player, reason: 'unit cannot use ability' })
              continue
            }
            if (u.abilityCooldown > world.tick) {
              world.emit({ type: 'command-rejected', player, reason: 'ability on cooldown' })
              continue
            }
            const t = world.transforms.get(id)
            if (!t) continue
            const rangeFx = tileToFx(world.settings.smokeRange)
            if (sqDist(t.x, t.y, cmd.x, cmd.y) > rangeFx * rangeFx) {
              world.emit({ type: 'command-rejected', player, reason: 'target out of throw range' })
              continue
            }
            u.abilityCooldown = world.tick + world.settings.smokeCooldownTicks
            const sid = world.createEntity('marker', player)
            world.transforms.set(sid, { x: cmd.x, y: cmd.y })
            // Thrown like a grenade: the canister arcs over `grenadeFuseTicks`
            // and only then starts billowing into a cloud that lasts
            // `smokeDurationTicks`.
            const landTick = world.tick + world.settings.grenadeFuseTicks
            world.smokes.set(sid, {
              team: player,
              fromX: t.x,
              fromY: t.y,
              x: cmd.x,
              y: cmd.y,
              startTick: world.tick,
              landTick,
              radius: world.settings.smokeRadius,
              untilTick: landTick + world.settings.smokeDurationTicks,
            })
          }
          break
        }
        case 'set-detector': {
          const id = cmd.entities[0]
          if (id === undefined || !ownedBuilding(world, player, id)) break
          const b = world.buildings.require(id)
          if (!b.done) {
            world.emit({ type: 'command-rejected', player, reason: 'building not finished' })
            break
          }
          if (!teamState.detectorUnlocked) {
            world.emit({ type: 'command-rejected', player, reason: 'detector upgrade not researched' })
            break
          }
          if (b.detector) {
            world.emit({ type: 'command-rejected', player, reason: 'building already has a detector' })
            break
          }
          if (!world.canAfford(player, world.settings.detectorCost)) {
            world.emit({ type: 'command-rejected', player, reason: 'insufficient credits' })
            break
          }
          world.spendCredits(player, world.settings.detectorCost)
          b.detector = true
          world.emit({ type: 'detector-bought', building: id, team: player })
          break
        }
        case 'set-stealth': {
          let bought = false
          for (const id of cmd.entities) {
            if (!ownedUnit(world, player, id)) continue
            const u = world.units.require(id)
            if (u.class !== 'infantry' && u.class !== 'vehicle') {
              world.emit({ type: 'command-rejected', player, reason: 'cannot stealth this unit' })
              continue
            }
            if (!teamState.stealthTech) {
              world.emit({ type: 'command-rejected', player, reason: 'stealth upgrade not researched' })
              continue
            }
            if (u.stealth) {
              world.emit({ type: 'command-rejected', player, reason: 'unit already stealthed' })
              continue
            }
            if (!world.canAfford(player, world.settings.stealthCost)) {
              world.emit({ type: 'command-rejected', player, reason: 'insufficient credits' })
              continue
            }
            world.spendCredits(player, world.settings.stealthCost)
            u.stealth = true
            bought = true
          }
          if (bought) world.emit({ type: 'stealth-bought', team: player })
          break
        }
        case 'place-mine': {
          if (!teamState.mineTech) {
            world.emit({ type: 'command-rejected', player, reason: 'mine tech not researched' })
            break
          }
          let mineCount = 0
          world.mines.forEach((_id, m) => {
            if (m.team === player) mineCount++
          })
          const tx = Math.floor(cmd.x / 1000)
          const ty = Math.floor(cmd.y / 1000)
          const committer = cmd.entities.find((id) => {
            const u = world.units.get(id)
            return !!u && world.canControl(player, id) && u.unitType === 'engineer'
          })
          if (committer === undefined) {
            world.emit({ type: 'command-rejected', player, reason: 'no engineer selected' })
            break
          }
          const ct = world.transforms.require(committer)
          const rangeFx = tileToFx(world.settings.minePlaceRange)
          if (sqDist(ct.x, ct.y, cmd.x, cmd.y) > rangeFx * rangeFx) {
            world.emit({ type: 'command-rejected', player, reason: 'mine out of range' })
            break
          }
          if (mineCount >= world.settings.mineLimit) {
            world.emit({ type: 'command-rejected', player, reason: 'mine limit reached' })
            break
          }
          if (!world.canAfford(player, world.settings.mineCost)) {
            world.emit({ type: 'command-rejected', player, reason: 'insufficient credits' })
            break
          }
          if (tx < 0 || ty < 0 || tx >= world.width || ty >= world.height) {
            world.emit({ type: 'command-rejected', player, reason: 'mine out of bounds' })
            break
          }
          world.rebuildGridIfDirty()
          const grid = world.grid
          if (!grid || !grid.passable[ty * world.width + tx]) {
            world.emit({ type: 'command-rejected', player, reason: 'cannot place mine there' })
            break
          }
          world.spendCredits(player, world.settings.mineCost)
          const mid = world.createEntity('mine', player)
          world.transforms.set(mid, { x: tx * 1000 + 500, y: ty * 1000 + 500 })
          world.mines.set(mid, {
            team: player,
            owner: committer,
            armTick: world.tick + world.settings.mineArmTicks,
            triggerRadius: world.settings.mineTriggerRadius,
            blastRadius: world.settings.mineBlastRadius,
            damage: world.settings.mineDamage,
          })
          world.emit({ type: 'mine-placed', entity: mid, team: player, x: tx * 1000 + 500, y: ty * 1000 + 500 })
          break
        }
        case 'remove-mine': {
          if (!teamState.mineTech) {
            world.emit({ type: 'command-rejected', player, reason: 'mine tech not researched' })
            break
          }
          const target = cmd.target ?? -1
          if (target < 0) break
          const mine = world.mines.get(target)
          const mt = world.transforms.get(target)
          if (!mine || !world.sameTeam(mine.team, player) || !mt) {
            world.emit({ type: 'command-rejected', player, reason: 'no mine there' })
            break
          }
          let removed = false
          for (const id of cmd.entities) {
            const u = world.units.get(id)
            if (!u || !world.canControl(player, id)) continue
            if (u.unitType !== 'engineer' && u.unitType !== 'bulldozer') continue
            if (world.works.has(id)) continue
            const ut = world.transforms.get(id)
            if (!ut) continue
            const rangeFx = tileToFx(world.settings.minePlaceRange)
            if (sqDist(ut.x, ut.y, mt.x, mt.y) > rangeFx * rangeFx) continue
            world.removeEntity(target)
            world.emit({ type: 'mine-removed', entity: target, team: player })
            removed = true
            break
          }
          if (!removed) world.emit({ type: 'command-rejected', player, reason: 'mine out of range' })
          break
        }
        case 'repair-unit': {
          const target = cmd.target ?? -1
          if (target < 0) break
          const tu = world.units.get(target)
          if (!tu || !world.canControl(player, target)) break
          if (tu.class === 'air') {
            world.emit({ type: 'command-rejected', player, reason: 'cannot repair air units' })
            break
          }
          const th = world.healths.get(target)
          if (!th || th.hp >= th.maxHp) {
            world.emit({ type: 'command-rejected', player, reason: 'target already at full health' })
            break
          }
          let assigned = false
          for (const id of cmd.entities) {
            const u = world.units.get(id)
            if (!u || !world.canControl(player, id)) continue
            if (u.unitType !== 'engineer') continue
            if (world.works.has(id)) continue
            world.works.set(id, { kind: 'repair-unit', building: target })
            world.moves.delete(id)
            assigned = true
            world.emit({ type: 'repair-target-assigned', entity: id, target, team: player })
          }
          if (!assigned) world.emit({ type: 'command-rejected', player, reason: 'no available engineer' })
          break
        }
        case 'transport-load': {
          const transportId = cmd.transportId ?? -1
          if (transportId < 0) break
          const tu = world.units.get(transportId)
          const tb = tu ? null : world.buildings.get(transportId)
          const owner = tu ? tu.team : tb ? tb.team : -1
          if (owner !== player) {
            world.emit({ type: 'command-rejected', player, reason: 'no transport selected' })
            break
          }
          const capacity = world.transportCapacityOf(transportId)
          if (capacity <= 0) {
            world.emit({ type: 'command-rejected', player, reason: 'unit cannot carry passengers' })
            break
          }
          // Queued riders stay alive and walk to the APC, boarding one per tick in
          // TransportSystem; here we only validate and reserve their slots so the
          // APC (and its riders) visibly converge before disappearing inside.
          const t =
            world.transports.get(transportId) ??
            { team: player, passengers: [], loadQueue: [], unloadX: 0, unloadY: 0, pendingUnload: false, unloadCount: 0, pendingOne: -1 }
          let queued = false
          for (const id of cmd.entities) {
            if (id === transportId) continue
            const u = world.units.get(id)
            if (!u || !world.canControl(player, id)) continue
            if (u.class !== 'infantry') {
              world.emit({ type: 'command-rejected', player, reason: 'only infantry can be transported' })
              continue
            }
            if (t.loadQueue.includes(id)) continue
            if (t.passengers.length + t.loadQueue.length >= capacity) {
              world.emit({ type: 'command-rejected', player, reason: 'transport is full' })
              break
            }
            t.loadQueue.push(id)
            queued = true
          }
          if (queued) world.transports.set(transportId, t)
          break
        }
        case 'transport-unload': {
          const transportId = cmd.transportId ?? -1
          if (transportId < 0) break
          const tc = world.transports.get(transportId)
          if (!tc || !world.canControl(player, transportId)) {
            world.emit({ type: 'command-rejected', player, reason: 'no transport selected' })
            break
          }
          if (tc.passengers.length === 0) {
            world.emit({ type: 'command-rejected', player, reason: 'transport is empty' })
            break
          }
          // Click-to-eject: a single passenger (index from the loaded-units list)
          // steps off right next to the transport — no drop-off point to pick.
          const oneIndex = cmd.index ?? -1
          if (oneIndex >= 0) {
            if (oneIndex >= tc.passengers.length) {
              world.emit({ type: 'command-rejected', player, reason: 'transport is empty' })
              break
            }
            const t = world.transforms.get(transportId)
            tc.unloadX = t?.x ?? 0
            tc.unloadY = t?.y ?? 0
            tc.pendingUnload = true
            tc.pendingOne = oneIndex
            tc.unloadCount = 0
            world.emit({ type: 'unload-ordered', entity: transportId, x: tc.unloadX, y: tc.unloadY, team: player })
            break
          }
          tc.unloadX = cmd.x
          tc.unloadY = cmd.y
          tc.pendingUnload = true
          tc.pendingOne = -1
          tc.unloadCount = 0
          world.emit({ type: 'unload-ordered', entity: transportId, x: cmd.x, y: cmd.y, team: player })
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
              startNextQueued(world, id)
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
          if (!b || !world.canControl(player, target)) break
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
          if (!dock || !world.canControl(player, target) || dock.buildingType !== 'supply-dock') break
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
        case 'sw-choose': {
          if (!world.hasDoneBuilding(player, 'super-weapon')) {
            world.emit({ type: 'command-rejected', player, reason: 'super weapon destroyed' })
            break
          }
          const choice = cmd.choice
          if (!choice || !SW_CHOICES.includes(choice)) {
            world.emit({ type: 'command-rejected', player, reason: 'invalid strike choice' })
            break
          }
          // Day 15: the laser is now free/always armed — the SP panel only
          // lets you pick the *additional* strike (airstrike vs EMP).
          if (choice === 'laser') {
            world.emit({ type: 'command-rejected', player, reason: 'laser is armed by default' })
            break
          }
          if (teamState.swChoice !== null) {
            world.emit({ type: 'command-rejected', player, reason: 'super weapon already armed' })
            break
          }
          teamState.swChoice = choice
          world.emit({ type: 'sw-chosen', team: player, choice })
          break
        }
        case 'sw-airstrike': {
          if (teamState.swChoice !== 'airstrike') {
            world.emit({ type: 'command-rejected', player, reason: 'airstrike not armed — choose it at the super weapon first' })
            break
          }
          if (!world.hasDoneBuilding(player, 'super-weapon')) {
            world.emit({ type: 'command-rejected', player, reason: 'super weapon destroyed' })
            break
          }
          if (teamState.powerDown) {
            world.emit({ type: 'command-rejected', player, reason: 'insufficient power' })
            break
          }
          if (world.tick - teamState.airstrikeLastUsed < world.settings.airstrikeCooldownTicks) {
            world.emit({ type: 'command-rejected', player, reason: 'airstrike on cooldown' })
            break
          }
          const airTx = Math.floor(cmd.x)
          const airTy = Math.floor(cmd.y)
          if (airTx < 0 || airTy < 0 || airTx >= world.width || airTy >= world.height) {
            world.emit({ type: 'command-rejected', player, reason: 'airstrike target out of bounds' })
            break
          }
          teamState.airstrikeLastUsed = world.tick
          const airDmg = Math.round(AIRSTRIKE_BOMB_DAMAGE * world.airstrikeDamageMultiplier(player))
          const airRad = Math.max(1, Math.round(AIRSTRIKE_BOMB_RADIUS * world.airstrikeRadiusMultiplier(player)))
          spawnAirstrike(world, player, airTx, airTy, airDmg, airRad)
          world.emit({ type: 'airstrike-called', team: player, x: airTx * 1000 + 500, y: airTy * 1000 + 500 })
          break
        }
        case 'sw-emp': {
          if (teamState.swChoice !== 'emp') {
            world.emit({ type: 'command-rejected', player, reason: 'emp not armed — choose it at the super weapon first' })
            break
          }
          if (!world.hasDoneBuilding(player, 'super-weapon')) {
            world.emit({ type: 'command-rejected', player, reason: 'super weapon destroyed' })
            break
          }
          if (teamState.powerDown) {
            world.emit({ type: 'command-rejected', player, reason: 'insufficient power' })
            break
          }
          if (world.tick - teamState.empLastUsed < world.settings.empCooldownTicks) {
            world.emit({ type: 'command-rejected', player, reason: 'emp on cooldown' })
            break
          }
          const empTx = Math.floor(cmd.x)
          const empTy = Math.floor(cmd.y)
          if (empTx < 0 || empTy < 0 || empTx >= world.width || empTy >= world.height) {
            world.emit({ type: 'command-rejected', player, reason: 'emp target out of bounds' })
            break
          }
          teamState.empLastUsed = world.tick
          const empId = world.createEntity('marker', player)
          const empX = empTx * 1000 + 500
          const empY = empTy * 1000 + 500
          world.transforms.set(empId, { x: empX, y: empY })
          const empRadius = Math.max(1, Math.round(EMP_RADIUS_TILES * world.empRadiusMultiplier(player)))
          const empTicks = world.empDurationTicks(player)
          world.empPulses.set(empId, { team: player, radius: empRadius, untilTick: world.tick + empTicks })
          world.emit({ type: 'emp-strike', team: player, x: empX, y: empY, radius: empRadius })
          break
        }
        case 'max-power': {
          for (const id of cmd.entities) {
            const b = world.buildings.get(id)
            if (!b || !world.canControl(player, id)) continue
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
          if (dozerId === undefined) {
            world.emit({ type: 'command-rejected', player, reason: 'no available bulldozer' })
            break
          }
          const order = canAcceptBuildOrder(world, player, dozerId)
          if (!order.ok) {
            world.emit({ type: 'command-rejected', player, reason: order.reason })
            break
          }
          const def = getBuilding(buildingType, world.settings)
          if (!world.canAfford(player, def.cost)) {
            world.emit({ type: 'command-rejected', player, reason: 'insufficient credits' })
            break
          }
          world.spendCredits(player, def.cost)
          const id = spawnBuilding(world, buildingType, player, tx, ty, false)
          const b = world.buildings.require(id)
          const w = world.works.get(dozerId)
          if (w && w.kind === 'construct') {
            // Busy dozer with queue capacity: hold the order until it finishes
            // the current construct (WorkSystem auto-starts it afterwards).
            const q = world.buildOrderQueues.get(dozerId)
            if (q) q.push(id)
            else world.buildOrderQueues.set(dozerId, [id])
            world.emit({ type: 'building-placed', entity: id, buildingType, team: player })
            world.emit({ type: 'build-order-queued', entity: dozerId, building: id, team: player })
          } else {
            b.assignedDozer = dozerId
            world.works.set(dozerId, { kind: 'construct', building: id })
            world.moves.delete(dozerId)
            world.emit({ type: 'building-placed', entity: id, buildingType, team: player })
            world.emit({ type: 'dozer-assigned', entity: dozerId, building: id, kind: 'construct', team: player })
          }
          // Day 15 expansion score: only when the new building is far enough
          // from this team's starting base to actually count as scouting/expanding.
          const sp = world.map.spawnPoints[player]
          if (sp) {
            const dx = tx - sp.x
            const dy = ty - sp.y
            if (isqrt(dx * dx + dy * dy) >= EXPANSION_RADIUS_TILES) world.awardScore(player, SCORE_EXPANSION)
          }
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
              if (!world.canControl(player, id)) continue
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
              b.researchQueue = []
              continue
            }
            const u = world.units.get(id)
            if (u && world.canControl(player, id)) {
              const def = getUnit(u.unitType, world.settings)
              const refund = Math.floor(def.cost * world.settings.sellRefundFraction)
              world.grantCredits(player, refund)
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
          if (!world.canAfford(player, ud.cost)) {
            world.emit({ type: 'command-rejected', player, reason: 'insufficient credits' })
            break
          }
          world.spendCredits(player, ud.cost)
          q.queue.push({ id: world.allocId(), unitType, remainingTicks: ud.buildTimeTicks })
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
            world.grantCredits(player, ud.cost)
            world.emit({ type: 'order-dequeued', building: id, unitType: removed.unitType, team: player })
          }
          break
        }
        case 'reorder-queue': {
          const id = cmd.entities[0]
          if (id === undefined || !ownedBuilding(world, player, id)) break
          const q = world.queues.get(id)
          if (!q) break
          const from = cmd.index ?? 0
          const to = cmd.to ?? 0
          if (from === to) break
          if (from < 0 || from >= q.queue.length) break
          if (to < 0 || to >= q.queue.length) break
          const [moved] = q.queue.splice(from, 1)
          q.queue.splice(to, 0, moved)
          // Reordering restarts production: the (new) front order's build progress goes back to the start.
          for (const o of q.queue) o.remainingTicks = getUnit(o.unitType, world.settings).buildTimeTicks
          world.emit({ type: 'order-reordered', building: id, from, to, team: player })
          break
        }
        case 'ping': {
          const type = cmd.pingType ?? 'alert'
          const x = Math.floor(cmd.x)
          const y = Math.floor(cmd.y)
          if (x < 0 || y < 0 || x >= world.width || y >= world.height) {
            world.emit({ type: 'command-rejected', player, reason: 'ping out of bounds' })
            break
          }
          world.addPing(player, x, y, type)
          world.emit({ type: 'ping-point', team: player, x, y, pingType: type })
          break
        }
        case 'dequeue-research': {
          const id = cmd.entities[0]
          if (id === undefined || !ownedBuilding(world, player, id)) break
          const b = world.buildings.get(id)
          if (!b) break
          const index = cmd.index ?? 0
          if (index >= 0 && index < b.researchQueue.length) {
            const removed = b.researchQueue.splice(index, 1)[0]
            world.grantCredits(player, removed.cost)
            world.emit({ type: 'research-cancelled', building: id, upgrade: removed.upgrade, team: player })
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
          if (b.researchQueue.length >= world.settings.queueLimit) {
            world.emit({ type: 'command-rejected', player, reason: 'research queue full' })
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
          const cost = up.id === 'space-laser' ? world.laserUpgradeCost(player, up.cost) : up.id === 'weapon-upgrade' ? world.weaponUpgradeCost(player, up.cost) : up.id === 'airstrike-level' ? world.airstrikeLevel(player) * 1000 + up.cost : up.id === 'emp-level' ? world.empLevel(player) * 1000 + up.cost : up.cost
          if (world.rankOf(player) < up.requiredRank) {
            world.emit({ type: 'command-rejected', player, reason: up.requiredRank + ' star rank required' })
            break
          }
          if (up.id === 'space-laser' && world.laserLevel(player) >= world.laserMaxLevel()) {
            world.emit({ type: 'command-rejected', player, reason: 'laser maxed' })
            break
          }
          if (up.id === 'airstrike-level' && teamState.swChoice !== 'airstrike') {
            world.emit({ type: 'command-rejected', player, reason: 'choose the airstrike at the super weapon first' })
            break
          }
          if (up.id === 'airstrike-level' && world.airstrikeLevel(player) >= world.airstrikeMaxLevel()) {
            world.emit({ type: 'command-rejected', player, reason: 'airstrike maxed' })
            break
          }
          if (up.id === 'emp-level' && teamState.swChoice !== 'emp') {
            world.emit({ type: 'command-rejected', player, reason: 'choose the emp at the super weapon first' })
            break
          }
          if (up.id === 'emp-level' && world.empLevel(player) >= world.empMaxLevel()) {
            world.emit({ type: 'command-rejected', player, reason: 'emp maxed' })
            break
          }
          if (up.id === 'weapon-upgrade' && world.weaponUpgradeLevel(player) >= world.weaponMaxLevel()) {
            world.emit({ type: 'command-rejected', player, reason: 'weapon upgrade maxed' })
            break
          }
          if (up.id === 'stealth-tech' && teamState.stealthTech) {
            world.emit({ type: 'command-rejected', player, reason: 'stealth tech already researched' })
            break
          }
          if (up.id === 'detector-upgrade' && teamState.detectorUnlocked) {
            world.emit({ type: 'command-rejected', player, reason: 'detector already researched' })
            break
          }
          if (up.id === 'radar' && teamState.radar) {
            world.emit({ type: 'command-rejected', player, reason: 'radar already researched' })
            break
          }
          if (up.id === 'satellite' && teamState.satellite) {
            world.emit({ type: 'command-rejected', player, reason: 'satellite already researched' })
            break
          }
          if (up.id === 'mine-tech' && teamState.mineTech) {
            world.emit({ type: 'command-rejected', player, reason: 'mine tech already researched' })
            break
          }
          if (up.id === 'abilities-tech' && teamState.abilitiesUnlocked) {
            world.emit({ type: 'command-rejected', player, reason: 'abilities tech already researched' })
            break
          }
          if (up.id === 'defense-dome' && teamState.defenseDome) {
            world.emit({ type: 'command-rejected', player, reason: 'defense dome already researched' })
            break
          }
          if (!world.canAfford(player, cost)) {
            world.emit({ type: 'command-rejected', player, reason: 'insufficient credits' })
            break
          }
          world.spendCredits(player, cost)
          b.researchQueue.push({ id: world.allocId(), upgrade: upgradeType, remainingTicks: up.researchTimeTicks, cost })
          world.emit(
            b.researchQueue.length === 1
              ? { type: 'research-started', building: id, upgrade: upgradeType, team: player }
              : { type: 'research-queued', building: id, upgrade: upgradeType, team: player },
          )
          break
        }
        case 'rank-up': {
          if (!world.rankUp(player)) {
            world.emit({ type: 'command-rejected', player, reason: 'score below next rank floor' })
          }
          break
        }
      }
    }
  },
}
