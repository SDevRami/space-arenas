import type { MapData, MatchSettings, WinRule } from '@space-arenas/shared'
import type { BotDifficulty } from '../ai/bot.ts'

export interface MatchSlot {
  team: number
  name: string
  difficulty?: BotDifficulty
  alliance?: number
  color?: number
}

/** Offline game modes (Day 19): a normal bots match (which also tracks the daily
 *  mission list) and a campaign placeholder. */
export type OfflineMode = 'bots' | 'campaign'

/** Daily: a fixed mission-set challenge + level-up daily missions, tracked across bots matches. */
export interface DailyConfig {
  /** Non-date challenge generation; the same list persists until all missions are finished. */
  generation: number
}

export interface MatchConfig {
  map: MapData
  seed: number
  credits: number
  localTeam: number
  slots: MatchSlot[]
  winRule: WinRule
  settings?: Partial<MatchSettings>
  mode?: OfflineMode
  daily?: DailyConfig
  /** Accept/skip: whether this match counts toward the daily mission list. */
  trackDaily: boolean
  /** Whether this match counts toward the profile (counters, history, achievements). */
  trackProfile: boolean
}
