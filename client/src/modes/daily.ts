import { dailySeed } from '../profile/modeRecords.ts'
import { loadModeRecords, saveModeRecords } from '../profile/modeRecords.ts'
import type { DailyChallengeState } from '../profile/modeRecords.ts'
import type { StorageLike } from '../profile/profile.ts'
import { RNG } from '@space-arenas/shared'

export interface DailyMissionDef {
  id: string
  /** What the mission measures. "win" is a boolean; the rest are count/thresholds. */
  kind: 'win' | 'train' | 'build' | 'destroy' | 'supply'
  /** Threshold: how many units/buildings/kills/credits, or 1 for a win. */
  target: number
  /** XP banked to the daily level when completed. */
  xp: number
  /** Base i18n key; rendered with the target interpolated as {n}. */
  descKey: string
}

export interface DailyMatchResult {
  won: boolean
  kills: number
  unitsTrained: number
  buildingsBuilt: number
  supplyHarvested: number
}

const KINDS: { kind: DailyMissionDef['kind']; key: string; base: number; xp: number }[] = [
  { kind: 'win', key: 'daily.mission.win', base: 1, xp: 40 },
  { kind: 'train', key: 'daily.mission.train', base: 10, xp: 30 },
  { kind: 'build', key: 'daily.mission.build', base: 6, xp: 30 },
  { kind: 'destroy', key: 'daily.mission.destroy', base: 8, xp: 30 },
  { kind: 'supply', key: 'daily.mission.supply', base: 600, xp: 25 },
]

export const DAILY_MISSION_COUNT = 4

/** Pick 4 missions deterministically from the challenge generation. The generation is
 *  stable (not date-relative): the same list persists until every mission is done. */
export const generateDailyMissions = (generation: number): DailyMissionDef[] => {
  const rng = new RNG(dailySeed(`gen:${generation}`, 'missions'))
  const order = KINDS.map((_, i) => i)
  for (let i = order.length - 1; i > 0; i--) {
    const j = rng.nextInt(0, i)
    const tmp = order[i]
    order[i] = order[j]
    order[j] = tmp
  }
  const out: DailyMissionDef[] = []
  for (const idx of order.slice(0, DAILY_MISSION_COUNT)) {
    const k = KINDS[idx]
    const target = k.kind === 'win' ? 1 : Math.max(k.base, k.base + rng.nextInt(-Math.round(k.base / 3), Math.round(k.base / 2)))
    out.push({ id: `daily:${generation}:${k.kind}`, kind: k.kind, target, xp: k.xp, descKey: k.key })
  }
  return out
}

/** True when every mission of the stored challenge is completed. */
const challengeFinished = (ch: DailyChallengeState | null): boolean => {
  if (!ch) return false
  return generateDailyMissions(ch.generation).every((m) => ch.doneIds.includes(m.id))
}

export const dailyChallengeDone = challengeFinished

/** The active challenge list. It only rolls to a fresh generation once every mission
 *  is completed — the same list persists across any number of days until then. */
export const resolveDailyChallenge = (s: StorageLike): { challenge: DailyChallengeState; generation: number; missions: DailyMissionDef[]; doneIds: string[]; allDone: boolean; fresh: boolean } => {
  const r = loadModeRecords(s)
  let ch = r.daily?.challenge ?? null
  let fresh = false
  if (!ch || challengeFinished(ch)) {
    ch = { generation: (ch?.generation ?? 0) + 1, doneIds: [] }
    fresh = true
    r.daily = r.daily ?? { xp: 0, streak: 0, bestStreak: 0, lastPlayedDayKey: '', challenge: null }
    r.daily.challenge = ch
    saveModeRecords(s, r)
  }
  const missions = generateDailyMissions(ch.generation)
  return { challenge: ch, generation: ch.generation, missions, doneIds: ch.doneIds, allDone: challengeFinished(ch), fresh }
}

const satisfied = (mission: DailyMissionDef, r: DailyMatchResult): boolean => {
  switch (mission.kind) {
    case 'win':
      return r.won
    case 'train':
      return r.unitsTrained >= mission.target
    case 'build':
      return r.buildingsBuilt >= mission.target
    case 'destroy':
      return r.kills >= mission.target
    case 'supply':
      return r.supplyHarvested >= mission.target
  }
}

/** Which of today's missions are satisfied and how much XP they bank. */
export const evaluateDailyMissions = (missions: DailyMissionDef[], r: DailyMatchResult): { done: DailyMissionDef[]; xp: number } => {
  const done = missions.filter((m) => satisfied(m, r))
  return { done, xp: done.reduce((sum, m) => sum + m.xp, 0) }
}