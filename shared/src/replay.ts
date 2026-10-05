import type { MapData } from './maps.ts'
import type { MatchSettings, WinRule } from './constants.ts'
import type { EnvelopeCommand, PlayerSlot } from './protocol.ts'

/** A full recorded match: every relayed command stamped with the sim tick it
 *  entered the world, plus everything needed to rebuild the deterministic sim
 *  from tick zero (seed, map, players, settings, win rule). Stored as a JSON
 *  file in the host's `archive/` folder. */
export interface ReplayData {
  /** PROTOCOL_VERSION the match ran under. */
  version: number
  /** ISO timestamp of when the replay was saved. */
  createdAt: string
  /** Match seed — the world is re-created with this RNG seed. */
  seed: number
  /** Sim ticks per second (25). */
  tickRate: number
  /** The (post-spawn-assignment) map used at match start. */
  map: MapData
  /** Full room match options. */
  settings: MatchSettings
  winRule?: WinRule
  /** Active (non-spectator) slots at match start: humans + bots. */
  players: PlayerSlot[]
  /** Server-declared winner (null = draw). */
  winner: number | null
  /** Total sim ticks recorded (relay currentTick at game end). */
  ticks: number
  /** Every command ever relayed, stamped with its entry tick. */
  history: EnvelopeCommand[]
}

/** Dimensions a replay file must satisfy to be imported/played. */
export interface ReplayMeta {
  name: string
  size: number
  createdAt: string
  map: string
  players: string[]
  winner: number | null
  ticks: number
  /** Sanitized display label derived from the file name. */
  label: string
  valid: boolean
}

/** Bare-bones structural check for an imported/uploaded replay payload. */
export const validReplay = (data: unknown): data is ReplayData => {
  if (!data || typeof data !== 'object') return false
  const r = data as Record<string, unknown>
  if (typeof r.version !== 'number' || r.version <= 0) return false
  if (typeof r.seed !== 'number' || !Number.isFinite(r.seed)) return false
  if (typeof r.tickRate !== 'number') return false
  if (!r.map || typeof r.map !== 'object' || typeof (r.map as MapData).width !== 'number') return false
  if (!Array.isArray(r.players)) return false
  const nums = r.players as unknown[]
  if (!nums.every((p) => p && typeof p === 'object' && typeof (p as PlayerSlot).id === 'number')) return false
  if (!Array.isArray(r.history)) return false
  if (!r.history.every((c) => c && typeof c === 'object' && typeof (c as EnvelopeCommand).tick === 'number' && (c as EnvelopeCommand).cmd)) return false
  if (r.winner !== null && typeof r.winner !== 'number') return false
  if (typeof r.ticks !== 'number') return false
  return true
}

/** Compact `YYYY-MM-DD` date label for a list row. */
export const replayDateLabel = (iso: string): string => (iso || '').slice(0, 10)

/** `replay-YYYYMMDD-HHMMSS` filename stem (no extension). */
export const defaultReplayName = (ts: Date = new Date()): string => {
  const p = (n: number): string => String(n).padStart(2, '0')
  const y = ts.getFullYear()
  const mo = p(ts.getMonth() + 1)
  const d = p(ts.getDate())
  const h = p(ts.getHours())
  const mi = p(ts.getMinutes())
  const s = p(ts.getSeconds())
  return `replay-${y}${mo}${d}-${h}${mi}${s}`
}