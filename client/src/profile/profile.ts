import { ACHIEVEMENTS, achievementProgress, type AchievementDef } from './achievements.ts'

/** Cumulative career counters. Values only grow — achievements keep reading them to display live progress. */
export interface ProfileCounters {
  gamesPlayed: number
  wins: number
  losses: number
  draws: number
  spectatedMatches: number
  kills: number
  killsInfantry: number
  killsVehicle: number
  killsAir: number
  killsBuilding: number
  unitsTrained: number
  unitsLost: number
  buildingsBuilt: number
  buildingsLost: number
  supplyHarvested: number
  damageDealt: number
  minesPlaced: number
  veteranPromotions: number
  grenadesLobbed: number
  laserStrikes: number
  airstrikes: number
  empStrikes: number
  satelliteScans: number
  troopsTransported: number
}

/** Per-type cumulative counts used by type-scoped achievements. */
export interface ProfileTypeCounts {
  unitsTrainedByType: Record<string, number>
  buildingsBuiltByType: Record<string, number>
  upgradesResearched: Record<string, number>
}

export interface MatchRecord {
  at: number
  mode: 'offline' | 'net'
  result: 'win' | 'loss' | 'draw' | 'spectate'
  map: string
  durationSec: number
  kills: number
  unitsBuilt: number
  buildingsBuilt: number
  supplyHarvested: number
}

export interface Profile {
  v: number
  name: string
  createdAt: number
  counters: ProfileCounters
  typeCounts: ProfileTypeCounts
  history: MatchRecord[]
  achievements: Record<string, { unlockedAt: number }>
}

export interface ProfileConfig {
  historyCap: number
  achievementTargets: Partial<Record<string, number>>
}

export const PROFILE_VERSION = 1
export const PROFILE_KEY = 'space-arenas:profile'
export const PROFILE_CONFIG_KEY = 'space-arenas:profile:config'
export const DEFAULT_PROFILE_HISTORY_CAP = 50
export const DEFAULT_PROFILE_NAME = 'Commander'

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export const freshCounters = (): ProfileCounters => ({
  gamesPlayed: 0,
  wins: 0,
  losses: 0,
  draws: 0,
  spectatedMatches: 0,
  kills: 0,
  killsInfantry: 0,
  killsVehicle: 0,
  killsAir: 0,
  killsBuilding: 0,
  unitsTrained: 0,
  unitsLost: 0,
  buildingsBuilt: 0,
  buildingsLost: 0,
  supplyHarvested: 0,
  damageDealt: 0,
  minesPlaced: 0,
  veteranPromotions: 0,
  grenadesLobbed: 0,
  laserStrikes: 0,
  airstrikes: 0,
  empStrikes: 0,
  satelliteScans: 0,
  troopsTransported: 0,
})

export const freshTypeCounts = (): ProfileTypeCounts => ({
  unitsTrainedByType: {},
  buildingsBuiltByType: {},
  upgradesResearched: {},
})

export const freshProfile = (name: string = DEFAULT_PROFILE_NAME): Profile => ({
  v: PROFILE_VERSION,
  name,
  createdAt: Date.now(),
  counters: freshCounters(),
  typeCounts: freshTypeCounts(),
  history: [],
  achievements: {},
})

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

export const loadProfile = (s: StorageLike): Profile => {
  const raw = readJson<Partial<Profile> | null>(s, PROFILE_KEY, null)
  if (!raw || raw.v !== PROFILE_VERSION) return freshProfile()
  const counters = { ...freshCounters(), ...(raw.counters ?? {}) }
  const tc: ProfileTypeCounts = raw.typeCounts ?? { unitsTrainedByType: {}, buildingsBuiltByType: {}, upgradesResearched: {} }
  const typeCounts: ProfileTypeCounts = {
    unitsTrainedByType: { ...(tc.unitsTrainedByType ?? {}) },
    buildingsBuiltByType: { ...(tc.buildingsBuiltByType ?? {}) },
    upgradesResearched: { ...(tc.upgradesResearched ?? {}) },
  }
  return {
    v: PROFILE_VERSION,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : DEFAULT_PROFILE_NAME,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    counters,
    typeCounts,
    history: Array.isArray(raw.history) ? raw.history : [],
    achievements: raw.achievements ?? {},
  }
}

export const saveProfile = (s: StorageLike, profile: Profile): void => writeJson(s, PROFILE_KEY, profile)

export const loadProfileConfig = (s: StorageLike): ProfileConfig => {
  const raw = readJson<Partial<ProfileConfig>>(s, PROFILE_CONFIG_KEY, {})
  const cap = raw.historyCap
  return {
    historyCap: typeof cap === 'number' && Number.isFinite(cap) ? Math.max(1, Math.min(500, Math.round(cap))) : DEFAULT_PROFILE_HISTORY_CAP,
    achievementTargets: raw.achievementTargets ?? {},
  }
}

export const saveProfileConfig = (s: StorageLike, config: ProfileConfig): void => writeJson(s, PROFILE_CONFIG_KEY, config)

export const achievementTarget = (config: ProfileConfig, def: AchievementDef): number => {
  const t = config.achievementTargets[def.id]
  return typeof t === 'number' && Number.isFinite(t) ? Math.max(1, Math.round(t)) : def.target
}

export const countFor = (profile: Profile, def: AchievementDef): number => achievementProgress(def, profile.counters, profile.typeCounts)

export const isUnlocked = (profile: Profile, id: string): boolean => profile.achievements[id] !== undefined

export const unlockedCount = (profile: Profile): number => {
  let n = 0
  for (const def of ACHIEVEMENTS) if (profile.achievements[def.id]) n++
  return n
}

/** Re-evaluate every achievement against the still-growing counters; newly met ones unlock. */
export const evaluateAchievements = (profile: Profile, config: ProfileConfig, now = Date.now()): void => {
  for (const def of ACHIEVEMENTS) {
    if (profile.achievements[def.id]) continue
    if (countFor(profile, def) >= achievementTarget(config, def)) profile.achievements[def.id] = { unlockedAt: now }
  }
}

export interface MatchRecordInput {
  mode: 'offline' | 'net'
  result: 'win' | 'loss' | 'draw'
  map: string
  durationSec: number
  kills: number
  unitsBuilt: number
  buildingsBuilt: number
  supplyHarvested: number
  counters: ProfileCounters
  typeCounts: ProfileTypeCounts
}

/** Merge one finished match (delta counters) into the profile, then re-evaluate achievements and persist. */
export const recordMatch = (s: StorageLike, profile: Profile, config: ProfileConfig, input: MatchRecordInput, now = Date.now()): Profile => {
  profile.counters.gamesPlayed += 1
  if (input.result === 'win') profile.counters.wins += 1
  else if (input.result === 'loss') profile.counters.losses += 1
  else profile.counters.draws += 1
  for (const key of Object.keys(freshCounters()) as (keyof ProfileCounters)[]) {
    if (key === 'gamesPlayed' || key === 'wins' || key === 'losses' || key === 'draws' || key === 'spectatedMatches') continue
    profile.counters[key] += input.counters[key] ?? 0
  }
  for (const [id, n] of Object.entries(input.typeCounts.unitsTrainedByType)) profile.typeCounts.unitsTrainedByType[id] = (profile.typeCounts.unitsTrainedByType[id] ?? 0) + n
  for (const [id, n] of Object.entries(input.typeCounts.buildingsBuiltByType)) profile.typeCounts.buildingsBuiltByType[id] = (profile.typeCounts.buildingsBuiltByType[id] ?? 0) + n
  for (const [id, n] of Object.entries(input.typeCounts.upgradesResearched)) profile.typeCounts.upgradesResearched[id] = (profile.typeCounts.upgradesResearched[id] ?? 0) + n
  profile.history.unshift({
    at: now,
    mode: input.mode,
    result: input.result,
    map: input.map,
    durationSec: input.durationSec,
    kills: input.kills,
    unitsBuilt: input.unitsBuilt,
    buildingsBuilt: input.buildingsBuilt,
    supplyHarvested: input.supplyHarvested,
  })
  if (profile.history.length > config.historyCap) profile.history.length = config.historyCap
  evaluateAchievements(profile, config, now)
  saveProfile(s, profile)
  return profile
}

export const resetProfile = (s: StorageLike, name: string = DEFAULT_PROFILE_NAME): Profile => {
  const profile = freshProfile(name)
  saveProfile(s, profile)
  return profile
}

export interface SpectateRecordInput {
  mode: 'offline' | 'net'
  map: string
  durationSec: number
}

/** A watched match (spectator): only the spectatedMatches counter and spectator achievements advance. */
export const recordSpectate = (s: StorageLike, profile: Profile, config: ProfileConfig, input: SpectateRecordInput, now = Date.now()): Profile => {
  profile.counters.spectatedMatches += 1
  profile.history.unshift({
    at: now,
    mode: input.mode,
    result: 'spectate',
    map: input.map,
    durationSec: input.durationSec,
    kills: 0,
    unitsBuilt: 0,
    buildingsBuilt: 0,
    supplyHarvested: 0,
  })
  if (profile.history.length > config.historyCap) profile.history.length = config.historyCap
  evaluateAchievements(profile, config, now)
  saveProfile(s, profile)
  return profile
}

/** Rename the commander; the name is capped to the same length as the match name field. */
export const updateProfileName = (s: StorageLike, profile: Profile, name: string): Profile => {
  profile.name = (name.trim() || DEFAULT_PROFILE_NAME).slice(0, 16)
  saveProfile(s, profile)
  return profile
}