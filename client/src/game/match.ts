import type { MapData, MatchSettings, WinRule } from '@space-arenas/shared'
import type { BotDifficulty } from '../ai/bot.ts'

export interface MatchSlot {
  team: number
  name: string
  difficulty?: BotDifficulty
  alliance?: number
  color?: number
}

/** Offline game modes (Day 19). "bots" is the classic bots match. */
export type OfflineMode = 'bots' | 'survival' | 'daily' | 'campaign' | 'custom'

/** Survival (19.1): endless escalating waves. The enemy is one bot plus wave raids. */
export interface SurvivalConfig {
  /** Difficulty of the enemy bot that owns the map's base. */
  enemyDifficulty: BotDifficulty
  /** Sim ticks between waves (default ~60 s at 25 Hz). */
  waveIntervalTicks: number
}

/** Daily (19.2): a fixed per-day seed challenge + level-up daily missions. */
export interface DailyConfig {
  /** UTC "yyyy-mm-dd" the seed derives from; used to know which missions are for today. */
  dayKey: string
}

/** Campaign (19.3): scripted chapter with objectives (collect troops → rebuild the old base → defend → take the outposts). */
export interface CampaignConfig {
  chapterId: string
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
  survival?: SurvivalConfig
  daily?: DailyConfig
  campaign?: CampaignConfig
}

/** True when a mode runs a scripted director (waves / objectives) rather than plain bots. */
export const isScriptedMode = (mode: OfflineMode | undefined): boolean => mode === 'survival' || mode === 'campaign'
