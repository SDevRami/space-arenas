import type { StorageLike } from './profile.ts'

/** Day 19.1: best survival score. Stored career-wide (kept when the profile resets). */
export interface SurvivalRecord {
  bestWave: number
  bestScore: number
  bestDurationSec: number
  plays: number
  wins: number
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
  /** missionId -> dayKey it was completed on (a mission done today stays done). */
  missionsDone: Record<string, string>
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
export const MODE_RECORDS_VERSION = 1

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

/** Deterministic seed for a given day: every client plays the same challenge on the same day. */
export const dailySeed = (dayKey: string, salt = 'daily'): number => {
  let h = 2166136261
  const str = `${salt}:${dayKey}`
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) || 0x5eed
}

export const dailyLevel = (r: DailyLevelRecord | null): number => Math.floor((r?.xp ?? 0) / DAILY_XP_PER_LEVEL)
export const dailyLevelXp = (r: DailyLevelRecord | null): number => (r?.xp ?? 0) % DAILY_XP_PER_LEVEL

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

/** Record a finished daily match: rolls the streak, banks XP from completed missions. */
export const recordDailyResult = (s: StorageLike, input: { dayKey: string; missionsDone: string[]; xpEarned: number }): ModeRecords => {
  const r = loadModeRecords(s)
  const prev = r.daily ?? { xp: 0, streak: 0, bestStreak: 0, lastPlayedDayKey: '', missionsDone: {} }
  let streak = 1
  if (input.dayKey === prev.lastPlayedDayKey) streak = Math.max(1, prev.streak)
  else if (prev.lastPlayedDayKey && isNextUtcDay(prev.lastPlayedDayKey, input.dayKey)) streak = prev.streak + 1
  const missionsDone = { ...prev.missionsDone }
  for (const id of input.missionsDone) missionsDone[id] = input.dayKey
  r.daily = {
    xp: prev.xp + Math.max(0, input.xpEarned),
    streak,
    bestStreak: Math.max(prev.bestStreak, streak),
    lastPlayedDayKey: input.dayKey,
    missionsDone,
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