import { SECONDS_TO_TICKS, isPassableTerrain, tileAt, tileToFx } from '@space-arenas/shared'
import type { SurvivalConfig } from '../game/match.ts'
import type { World } from '../core/world.ts'
import { setMove, spawnUnit } from '../entities/factories.ts'

/** Day 19.1 survival: endless escalating waves. No bot AI and no enemy base — each
 *  enemy spawn point in the lobby acts as a wave source (N sources = N squads per
 *  wave), and a new wave only starts once at least half of the previous wave has
 *  been destroyed. You lose when the base falls; there is no win — only the high
 *  score. Every wave restocks the map's supply fields. */

export interface SurvivalRun {
  wave: number
  nextWaveAt: number
  /** Every raider ever spawned (movement steering / alive checks). */
  raiderIds: number[]
  /** Ids of the most recent wave, used for the 50%-destroyed gate. */
  lastWaveIds: number[]
  /** How many raiders the most recent wave spawned. */
  lastWaveSpawned: number
  done: boolean
}

export interface SurvivalTickOutcome {
  wave: number
  toastKey: string | null
  logKey: string | null
  done: boolean
  winner: number | null
}

const WAVE_GRACE_TICKS = SECONDS_TO_TICKS(10)
/** Min time between waves, so an instant wipe doesn't chain into the next wave on the same tick. */
const WAVE_REARM_TICKS = SECONDS_TO_TICKS(2)
const CENTRE = 500

/** Wave size scales with the chosen difficulty (easy 0.75×, medium 1×, hard 1.4×). */
const DIFF_MULT: Record<string, number> = { easy: 0.75, medium: 1, hard: 1.4 }

const scaled = (wave: number, base: number, per: number, cap: number, mult: number): number =>
  Math.min(Math.ceil(cap * mult), Math.max(1, Math.round((base + Math.floor(wave / per)) * mult)))

/** Wave army composition per source: grows with the wave number, adding troops and
 *  war vehicles early so later waves are never just riflemen. */
export const enemyWaveSquad = (wave: number, difficulty: string): { type: string; count: number }[] => {
  const mult = DIFF_MULT[difficulty] ?? 1
  const out: { type: string; count: number }[] = [{ type: 'rifleman', count: scaled(wave, 4, 2, 12, mult) }]
  if (wave >= 2) out.push({ type: 'rocket-trooper', count: scaled(wave, 2, 3, 8, mult) })
  if (wave >= 3) out.push({ type: 'assault-walker', count: scaled(wave, 1, 4, 6, mult) })
  if (wave >= 5) out.push({ type: 'aa-platform', count: scaled(wave, 1, 6, 4, mult) })
  if (wave >= 7) out.push({ type: 'artillery', count: scaled(wave, 1, 7, 4, mult) })
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

/** Every enemy spawn point is a wave source (one squad each). The bots' CCs stay
 *  hidden. Falls back to a far corner when the map has no enemy spawn. */
const raiderSpawnTiles = (world: World, localTeam: number, playerCc: { x: number; y: number } | null): { x: number; y: number }[] => {
  const sources: { x: number; y: number }[] = []
  for (const s of world.map.spawnPoints) {
    if (s.team !== localTeam) sources.push({ x: s.x, y: s.y })
  }
  if (sources.length > 0) return sources
  const fallback = { x: world.width - 6, y: 6 }
  if (playerCc && Math.max(Math.abs(fallback.x - playerCc.x), Math.abs(fallback.y - playerCc.y)) <= 12) {
    return [{ x: 6, y: world.height - 6 }]
  }
  return [fallback]
}

export const survivalScore = (wave: number, kills: number, damageDealt: number): number =>
  (wave - 1) * 100 + kills * 10 + Math.floor(damageDealt / 100)

/** Sends idle raiders marching toward the player's base. Only issues an order when a
 *  raider has no move, and flags it for pathfinding so they route around terrain
 *  instead of resetting to a straight line every tick (combat keeps its own move). */
const steerRaiders = (world: World, run: SurvivalRun): void => {
  const cc = commandCenterTile(world, 0)
  if (!cc) return
  const tx = tileToFx(cc.x) + CENTRE
  const ty = tileToFx(cc.y) + CENTRE
  for (const id of run.raiderIds) {
    if (!world.units.has(id) || world.moves.has(id)) continue
    setMove(world, id, tx, ty).needsPath = true
  }
}

/** Every wave restocks the whole map: supply fields recover to full capacity. */
const refillSupplyFields = (world: World): void => {
  world.fields.forEach((_id, f) => {
    f.trips = f.capacity
  })
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

const aliveCount = (world: World, ids: number[]): number => ids.reduce((n, id) => n + (world.units.has(id) ? 1 : 0), 0)

/** The endless wave director. `startOffline` builds the run; `tick` runs inside the offline sim. */
export class SurvivalDirector {
  readonly run: SurvivalRun

  constructor(readonly cfg: SurvivalConfig, readonly localTeam: number) {
    this.run = { wave: 0, nextWaveAt: WAVE_GRACE_TICKS, raiderIds: [], lastWaveIds: [], lastWaveSpawned: 0, done: false }
  }

  tick(world: World): SurvivalTickOutcome {
    const run = this.run
    steerRaiders(world, run)

    // No command center = base lost → survival ends (defeat).
    if (commandCenterTile(world, this.localTeam) === null) {
      run.done = true
      return { wave: run.wave, toastKey: 'survival.toast.lost', logKey: null, done: true, winner: 1 }
    }

    // A new wave waits until at least half of the previous wave has been wiped out.
    if (run.wave > 0 && run.lastWaveSpawned > 0 && aliveCount(world, run.lastWaveIds) * 2 > run.lastWaveSpawned) {
      return { wave: run.wave, toastKey: null, logKey: null, done: false, winner: null }
    }
    if (world.tick < run.nextWaveAt) {
      return { wave: run.wave, toastKey: null, logKey: null, done: false, winner: null }
    }

    run.wave++
    const cc = commandCenterTile(world, this.localTeam)
    const sources = raiderSpawnTiles(world, this.localTeam, cc)
    const squad = enemyWaveSquad(run.wave, this.cfg.difficulty)
    const ids: number[] = []
    // One scaled squad per enemy spawn: N bot sources = N squads each wave.
    for (const spawn of sources) ids.push(...spawnSquadAt(world, 1, spawn.x, spawn.y, squad))
    refillSupplyFields(world)
    run.lastWaveIds = ids
    run.lastWaveSpawned = ids.length
    run.raiderIds.push(...ids)
    run.nextWaveAt = world.tick + this.cfg.waveIntervalTicks + WAVE_REARM_TICKS
    return { wave: run.wave, toastKey: 'survival.toast.wave', logKey: 'survival.log.wave', done: false, winner: null }
  }
}