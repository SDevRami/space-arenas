import type { MapData, MatchSettings, WinRule } from '@space-arenas/shared'
import type { BotDifficulty } from '../ai/bot.ts'

export interface MatchSlot {
  team: number
  name: string
  difficulty?: BotDifficulty
  alliance?: number
  color?: number
}

export interface MatchConfig {
  map: MapData
  seed: number
  credits: number
  localTeam: number
  slots: MatchSlot[]
  winRule: WinRule
  settings?: Partial<MatchSettings>
}
