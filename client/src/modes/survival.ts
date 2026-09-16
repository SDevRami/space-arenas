import { SECONDS_TO_TICKS, isPassableTerrain, tileAt, tileToFx } from '@space-arenas/shared'
import type { SurvivalConfig } from '../game/match.ts'
import type { World } from '../core/world.ts'
import { setMove, spawnUnit } from '../entities/factories.ts'

/** Day 19.1 survival: endless escalating waves raid the player's base. The map's base belongs to one enemy bot. */

export interface SurvivalRun {
  wave: number
  nextWaveAt: number
  raiderIds: number[]
}

export interface SurvivalTickOutcome {
  wave: number
  toastKey: string | null
  logKey: string | null
}

const WAVE_GRACE_TICKS = SECONDS_TO_TICKS(10)
const CENTRE = 500

const scaledGroup = (wave: number, base: number, per: number, cap: number): number => Math.min(cap, base + Math.floor(wave / per))

/** Wave army composition grows with the wave number (every 4th wave opens a tougher unit tier). */
const enemyWaveSquad = (wave: number): { type: string; count: number }[] => {
  const tier = Math.min(4, Math.floor(wave / 4))
  const riflemen = Math.min(12, 4 + Math.floor(wave / 2) + Math.floor(wave / 8))
  const out: { type: string; count: number }[] = [{ type: 'rifleman', count: riflemen }]
  if (tier >= 1) out.push({ type: 'rocket-trooper', count: scaledGroup(wave, 2, 3, 8) })
  if (tier >= 2) out.push({ type: 'assault-walker', count: scaledGroup(wave, 1, 5, 6) })
  if (tier >= 3) out.push({ type: 'aa-platform', count: scaledGroup(wave, 1, 6, 4) })
  if (tier >= 4) out.push({ type: 'artillery', count: scaledGroup(wave, 1, 7, 4) })
  return out
}

/** Tile position of the first found command center (used as the raiders' march target). */
const commandCenterTile = (world: World, team: number): { x: number; y: number } | null => {
  let best: { x: number; y: number } | null = null
  world.buildings.forEach((id, b) => {
    if (b.team !== team || b.buildingType !== 'command-center') return
    const t = world.transforms.get(id)
    if (!t) return
    if (!best) best = { x: Math.floor((t.x - CENTRE) / 1000), y: Math.floor((t.y - CENTRE) / 1000) }
  })
  return best
}

/** Where new raiders come from: the enemy team's spawn point, else a far corner. */
const raiderSpawnTile = (world: World, localTeam: number, playerCc: { x: number; y: number } | null): { x: number; y: number } => {
  for (const s of world.map.spawnPoints) {
    if (s.team !== localTeam) return { x: s.x, y: s.y }
  }
  const fallback = { x: world.width - 6, y: 6 }
  if (playerCc && Math.max(Math.abs(fallback.x - playerCc.x), Math.abs(fallback.y - playerCc.y)) <= 12) {
    return { x: 6, y: world.height - 6 }
  }
  return fallback
}

export const survivalScore = (wave: number, kills: number, damageDealt: number): number =>
  (wave - 1) * 100 + kills * 10 + Math.floor(damageDealt / 100)

/** Sends every living raider marching toward the player's base each tick. */
const steerRaiders = (world: World, run: SurvivalRun): void => {
  const cc = commandCenterTile(world, 0)
  if (!cc) return
  const tx = tileToFx(cc.x) + CENTRE
  const ty = tileToFx(cc.y) + CENTRE
  for (const id of run.raiderIds) {
    if (world.units.has(id)) setMove(world, id, tx, ty)
  }
}

/** Spawn a raider squad nearby, avoiding impassable tiles. Returns spawned entity ids. */
const spawnSquadAt = (world: World, team: number, tileX: number, tileY: number, squad: { type: string; count: number }[]): number[] => {
  const ids: number[] = []
  const rings = [0, 1, 2, 3, 4, 5]
  for (const g of squad) {
    for (let n = 0; n < g.count; n++) {
      let placed = false
      for (const rr of rings) {
        for (let dx = -rr; dx <= rr && !placed; dx++) {
          for (let dy = -rr; dy <= rr && !placed; dy++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== rr) continue
            const tx = tileX + dx
            const ty = tileY + dy
            if (tx < 0 || ty < 0 || tx >= world.width || ty >= world.height) continue
            if (!isPassableTerrain(tileAt(world.map, tx, ty))) continue
            ids.push(spawnUnit(world, g.type, team, tileToFx(tx) + CENTRE, tileToFx(ty) + CENTRE))
            placed = true
          }
        }
      }
      if (!placed) ids.push(spawnUnit(world, g.type, team, tileToFx(tileX) + CENTRE, tileToFx(tileY) + CENTRE))
    }
  }
  return ids
}

/** The endless wave director. `startOffline` builds the run; `tick` runs inside the offline sim. */
export class SurvivalDirector {
  readonly run: SurvivalRun

  constructor(readonly cfg: SurvivalConfig, readonly localTeam: number) {
    this.run = { wave: 0, nextWaveAt: WAVE_GRACE_TICKS, raiderIds: [] }
  }

  tick(world: World): SurvivalTickOutcome {
    const run = this.run
    steerRaiders(world, run)
    if (world.tick < run.nextWaveAt) {
      return { wave: run.wave, toastKey: null, logKey: null }
    }
    run.wave++
    const cc = commandCenterTile(world, this.localTeam)
    const spawn = raiderSpawnTile(world, this.localTeam, cc)
    run.raiderIds.push(...spawnSquadAt(world, 1, spawn.x, spawn.y, enemyWaveSquad(run.wave)))
    run.nextWaveAt = world.tick + this.cfg.waveIntervalTicks
    return { wave: run.wave, toastKey: 'survival.toast.wave', logKey: 'survival.log.wave' }
  }
}