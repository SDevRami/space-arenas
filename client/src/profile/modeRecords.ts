import type { StorageLike } from './profile.ts'
import type { DailyMissionDef } from '../modes/daily.ts'

/** Day 19.1: best survival score. Stored career-wide (kept when the profile resets). */
export interface SurvivalRecord {
  bestWave: number
  bestScore: number
  bestDurationSec: number
  plays: number
  wins: number
}

/** The persisted daily mission list. It is fixed until every mission is completed,
 *  regardless of how many days it takes (no date-relative missions). */
export interface DailyChallengeState {
  /** Non-date generation; bumped only when the previous list is fully finished. */
  generation: number
  /** Ids of the missions completely finished across all plays of this challenge. */
  doneIds: string[]
}

/** Day 19.2: daily challenge level-up progression (no leaderboard — local only). */
export interface DailyLevelRecord {
  /** Lifetime XP earned from completed daily missions. */
  xp: number
  /** Current daily streak (consecutive played days). */
  streak: number
  /** Best ever streak. */
  bestStreak: number
  /** UTC day key of the last daily match played, so the streak rolls over. */
  lastPlayedDayKey: string
  /** The active mission list; stays put until all of its missions are done. */
  challenge: DailyChallengeState | null
}

/** Day 19.3: campaign progress. */
export interface CampaignRecord {
  /** Chapter ids fully completed. */
  chaptersDone: string[]
  /** Chapter id currently in progress (null = none started). */
  currentChapter: string
  plays: number
  wins: number
}

export interface ModeRecords {
  survival: SurvivalRecord | null
  daily: DailyLevelRecord | null
  campaign: CampaignRecord | null
}

export const MODE_RECORDS_KEY = 'space-arenas:mode-records'
export const MODE_RECORDS_VERSION = 2

/** XP needed per daily level. The daily level only ever grows (battle-pass style). */
export const DAILY_XP_PER_LEVEL = 100

const readJson = <T>(s: StorageLike, key: string, fallback: T): T => {
  try {
    const raw = s.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

const writeJson = (s: StorageLike, key: string, value: unknown): void => {
  try {
    s.setItem(key, JSON.stringify(value))
  } catch {
    /* storage unavailable */
  }
}

export const freshModeRecords = (): ModeRecords => ({ survival: null, daily: null, campaign: null })

export const loadModeRecords = (s: StorageLike): ModeRecords => {
  const raw = readJson<Partial<ModeRecords> & { v?: number } | null>(s, MODE_RECORDS_KEY, null)
  if (!raw || raw.v !== MODE_RECORDS_VERSION) return freshModeRecords()
  return {
    survival: raw.survival ?? null,
    daily: raw.daily ?? null,
    campaign: raw.campaign ?? null,
  }
}

export const saveModeRecords = (s: StorageLike, r: ModeRecords): void =>
  writeJson(s, MODE_RECORDS_KEY, { v: MODE_RECORDS_VERSION, ...r })

/** UTC "yyyy-mm-dd" — the daily day boundary. */
export const todayKey = (now = Date.now()): string => new Date(now).toISOString().slice(0, 10)

/** Deterministic seed for a given seed string (mission lists, match maps, etc.). */
export const dailySeed = (seedKey: string, salt = 'daily'): number => {
  let h = 2166136261
  const str = `${salt}:${seedKey}`
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) || 0x5eed
}

export const dailyLevel = (r: DailyLevelRecord | null): number => Math.floor((r?.xp ?? 0) / DAILY_XP_PER_LEVEL)
export const dailyLevelXp = (r: DailyLevelRecord | null): number => (r?.xp ?? 0) % DAILY_XP_PER_LEVEL

/** How many missions the active challenge still needs (given its deterministic list). */
export const remainingDailyMissions = (r: DailyLevelRecord | null, generation: number, missions: DailyMissionDef[]): number => {
  const ch = r?.challenge
  if (!ch || ch.generation !== generation) return missions.length
  return missions.filter((m) => !ch.doneIds.includes(m.id)).length
}

/** Record a finished survival match; keeps the career best wave/score/duration. */
export const recordSurvivalResult = (s: StorageLike, input: { wave: number; score: number; durationSec: number; won: boolean }): ModeRecords => {
  const r = loadModeRecords(s)
  const last = r.survival ?? { bestWave: 0, bestScore: 0, bestDurationSec: 0, plays: 0, wins: 0 }
  r.survival = {
    bestWave: Math.max(last.bestWave, input.wave),
    bestScore: Math.max(last.bestScore, input.score),
    bestDurationSec: Math.max(last.bestDurationSec, input.durationSec),
    plays: last.plays + 1,
    wins: last.wins + (input.won ? 1 : 0),
  }
  saveModeRecords(s, r)
  return r
}

/** True when `b` is the UTC day immediately after `a` (both "yyyy-mm-dd"). */
const isNextUtcDay = (a: string, b: string): boolean => {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  return Date.UTC(by, bm, bd) - Date.UTC(ay, am, ad) === 86400000
}

/** Record a finished daily match: rolls the streak and banks XP ONLY for missions
 *  newly finished this play. The mission list itself never re-rolls on date change. */
export const recordDailyResult = (s: StorageLike, input: { generation: number; missions: DailyMissionDef[]; doneIds: string[] }): ModeRecords => {
  const r = loadModeRecords(s)
  const prev = r.daily ?? { xp: 0, streak: 0, bestStreak: 0, lastPlayedDayKey: '', challenge: null }
  const dayKey = todayKey()
  let streak = 1
  if (dayKey === prev.lastPlayedDayKey) streak = Math.max(1, prev.streak)
  else if (prev.lastPlayedDayKey && isNextUtcDay(prev.lastPlayedDayKey, dayKey)) streak = prev.streak + 1
  const challenge: DailyChallengeState =
    prev.challenge && prev.challenge.generation === input.generation
      ? prev.challenge
      : { generation: input.generation, doneIds: [] }
  const alreadyDone = new Set(challenge.doneIds)
  const newlyDone = input.doneIds.filter((id) => !alreadyDone.has(id))
  const doneIds = [...new Set([...challenge.doneIds, ...input.doneIds])]
  const xpEarned = input.missions.filter((m) => newlyDone.includes(m.id)).reduce((sum, m) => sum + m.xp, 0)
  r.daily = {
    xp: prev.xp + Math.max(0, xpEarned),
    streak,
    bestStreak: Math.max(prev.bestStreak, streak),
    lastPlayedDayKey: dayKey,
    challenge: { generation: challenge.generation, doneIds },
  }
  saveModeRecords(s, r)
  return r
}

/** Record a finished campaign play: notes the current chapter and marks it done on a win. */
export const recordCampaignResult = (s: StorageLike, input: { chapterId: string; completed: boolean }): ModeRecords => {
  const r = loadModeRecords(s)
  const prev = r.campaign ?? { chaptersDone: [], currentChapter: '', plays: 0, wins: 0 }
  const chaptersDone = input.completed && !prev.chaptersDone.includes(input.chapterId) ? [...prev.chaptersDone, input.chapterId] : prev.chaptersDone
  r.campaign = {
    chaptersDone,
    currentChapter: input.chapterId,
    plays: prev.plays + 1,
    wins: prev.wins + (input.completed ? 1 : 0),
  }
  saveModeRecords(s, r)
  return r
}