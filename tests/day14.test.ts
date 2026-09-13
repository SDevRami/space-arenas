import { describe, expect, it } from 'vitest'
import { ACHIEVEMENTS, achievementProgress } from '../client/src/profile/achievements.ts'
import { SessionRecorder } from '../client/src/profile/recorder.ts'
import {
  DEFAULT_PROFILE_HISTORY_CAP,
  achievementTarget,
  countFor,
  evaluateAchievements,
  freshCounters,
  freshProfile,
  loadProfile,
  loadProfileConfig,
  recordMatch,
  resetProfile,
  saveProfile,
  type MatchRecordInput,
  type ProfileConfig,
  type StorageLike,
} from '../client/src/profile/profile.ts'
import type { SimEvent } from '../client/src/core/events.ts'

const makeStorage = (): StorageLike & { store: Map<string, string> } => {
  const store = new Map<string, string>()
  return {
    store,
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => { store.set(k, v) },
    removeItem: (k) => { store.delete(k) },
  }
}

const config = (over?: Partial<ProfileConfig>): ProfileConfig => ({
  historyCap: DEFAULT_PROFILE_HISTORY_CAP,
  achievementTargets: {},
  ...over,
})

const delta = (over: Partial<ReturnType<typeof freshCounters>> = {}): ReturnType<typeof freshCounters> => ({
  ...freshCounters(),
  ...over,
})

const record = (
  storage: StorageLike,
  profile: ReturnType<typeof freshProfile>,
  cfg: ProfileConfig,
  input: Omit<MatchRecordInput, 'counters' | 'typeCounts'> & {
    counters?: Partial<ReturnType<typeof freshCounters>>
  },
): void => {
  recordMatch(storage, profile, cfg, {
    mode: input.mode,
    result: input.result,
    map: input.map,
    durationSec: input.durationSec,
    kills: input.kills,
    unitsBuilt: input.unitsBuilt,
    buildingsBuilt: input.buildingsBuilt,
    supplyHarvested: input.supplyHarvested,
    counters: delta(input.counters),
    typeCounts: input.typeCounts ?? { unitsTrainedByType: {}, buildingsBuiltByType: {}, upgradesResearched: {} },
  })
}

describe('Day 14.1: profile gamesPlayed/wins keys', () => {
  it('increments gamesPlayed and wins/losses/draws correctly', () => {
    const storage = makeStorage()
    const profile = freshProfile('Ace')
    const cfg = config({ historyCap: 100 })

    record(storage, profile, cfg, { mode: 'offline', result: 'win', map: 'm', durationSec: 60, kills: 3, unitsBuilt: 5, buildingsBuilt: 1, supplyHarvested: 100, counters: { kills: 3 } })
    record(storage, profile, cfg, { mode: 'net', result: 'loss', map: 'm', durationSec: 90, kills: 1, unitsBuilt: 2, buildingsBuilt: 0, supplyHarvested: 0, counters: { kills: 1 } })
    record(storage, profile, cfg, { mode: 'offline', result: 'draw', map: 'm', durationSec: 30, kills: 0, unitsBuilt: 0, buildingsBuilt: 0, supplyHarvested: 0 })

    expect(profile.counters.gamesPlayed).toBe(3)
    expect(profile.counters.wins).toBe(1)
    expect(profile.counters.losses).toBe(1)
    expect(profile.counters.draws).toBe(1)
    expect(profile.counters.kills).toBe(4)
    expect(profile.history).toHaveLength(3)
    expect(profile.history[0].result).toBe('draw')
    expect(profile.history[0].durationSec).toBe(30)
  })

  it('persists the full profile through localStorage round-trip', () => {
    const storage = makeStorage()
    const profile = freshProfile('Ace')
    record(storage, profile, config(), { mode: 'offline', result: 'win', map: 'dust', durationSec: 45, kills: 2, unitsBuilt: 3, buildingsBuilt: 1, supplyHarvested: 60 })
    const loaded = loadProfile(storage)
    expect(loaded).toEqual(profile)

    const reset = resetProfile(storage, 'New')
    expect(reset.name).toBe('New')
    expect(loadProfile(storage).counters.gamesPlayed).toBe(0)
  })

  it('falls back to a fresh profile when storage data is absent or invalid', () => {
    const storage = makeStorage()
    storage.setItem('space-arenas:profile', 'not-json{')
    const loaded = loadProfile(storage)
    expect(loaded.counters.gamesPlayed).toBe(0)
    expect(loaded.name).toBe('Commander')

    storage.setItem('space-arenas:profile', '{"v": 99}')
    expect(loadProfile(storage).counters.gamesPlayed).toBe(0)
  })
})

describe('Day 14.2: cumulative achievements keep counting past unlock', () => {
  it('keeps killsInfantry counting after the achievement unlocks', () => {
    const storage = makeStorage()
    const profile = freshProfile()
    const cfg = config()

    record(storage, profile, cfg, { mode: 'offline', result: 'win', map: 'm', durationSec: 60, kills: 18, unitsBuilt: 0, buildingsBuilt: 0, supplyHarvested: 0, counters: { killsInfantry: 18, kills: 18 } })
    const def = ACHIEVEMENTS.find((a) => a.id === 'marine-hunter')!
    expect(countFor(profile, def)).toBe(18)
    expect(profile.achievements['marine-hunter']).toBeUndefined()

    record(storage, profile, cfg, { mode: 'offline', result: 'loss', map: 'm', durationSec: 60, kills: 7, unitsBuilt: 0, buildingsBuilt: 0, supplyHarvested: 0, counters: { killsInfantry: 7, kills: 7 } })
    expect(countFor(profile, def)).toBe(25)
    expect(profile.achievements['marine-hunter']).toBeDefined()

    record(storage, profile, cfg, { mode: 'offline', result: 'win', map: 'm', durationSec: 60, kills: 10, unitsBuilt: 0, buildingsBuilt: 0, supplyHarvested: 0, counters: { killsInfantry: 10, kills: 10 } })
    expect(countFor(profile, def)).toBe(35)
    expect(profile.achievements['marine-hunter']).toBeDefined()
  })

  it('unlocks career achievements from gamesPlayed and wins', () => {
    const storage = makeStorage()
    const profile = freshProfile()
    const cfg = config()

    record(storage, profile, cfg, { mode: 'offline', result: 'win', map: 'm', durationSec: 60, kills: 0, unitsBuilt: 0, buildingsBuilt: 0, supplyHarvested: 0 })
    expect(profile.achievements['first-match']).toBeDefined()
    expect(profile.achievements['first-win']).toBeDefined()
    expect(profile.achievements['five-matches']).toBeUndefined()

    for (let i = 0; i < 4; i++) record(storage, profile, cfg, { mode: 'offline', result: 'win', map: 'm', durationSec: 60, kills: 0, unitsBuilt: 0, buildingsBuilt: 0, supplyHarvested: 0 })
    expect(profile.counters.gamesPlayed).toBe(5)
    expect(profile.achievements['five-matches']).toBeDefined()
    expect(profile.achievements['ten-wins']).toBeUndefined()
    expect(profile.counters.wins).toBe(5)

    for (let i = 0; i < 5; i++) record(storage, profile, cfg, { mode: 'offline', result: 'win', map: 'm', durationSec: 60, kills: 0, unitsBuilt: 0, buildingsBuilt: 0, supplyHarvested: 0 })
    expect(profile.counters.wins).toBe(10)
    expect(profile.achievements['ten-wins']).toBeDefined()
  })

  it('accumulates per-type counts across matches', () => {
    const storage = makeStorage()
    const profile = freshProfile()
    const cfg = config()

    record(storage, profile, cfg, {
      mode: 'offline', result: 'win', map: 'm', durationSec: 60, kills: 0, unitsBuilt: 2, buildingsBuilt: 1, supplyHarvested: 0,
      counters: {},
      typeCounts: { unitsTrainedByType: { rifleman: 6, apc: 1 }, buildingsBuiltByType: { 'power-plant': 1 }, upgradesResearched: { 'weapon-upgrade': 1 } },
    })
    record(storage, profile, cfg, {
      mode: 'offline', result: 'win', map: 'm', durationSec: 60, kills: 0, unitsBuilt: 4, buildingsBuilt: 0, supplyHarvested: 0,
      counters: {},
      typeCounts: { unitsTrainedByType: { rifleman: 4 }, buildingsBuiltByType: {}, upgradesResearched: {} },
    })

    expect(profile.typeCounts.unitsTrainedByType.rifleman).toBe(10)
    expect(profile.typeCounts.unitsTrainedByType.apc).toBe(1)
    const squad = ACHIEVEMENTS.find((a) => a.id === 'squad')!
    expect(countFor(profile, squad)).toBe(10)
    expect(profile.achievements['squad']).toBeDefined()

    record(storage, profile, cfg, {
      mode: 'offline', result: 'win', map: 'm', durationSec: 60, kills: 0, unitsBuilt: 3, buildingsBuilt: 0, supplyHarvested: 0,
      counters: {},
      typeCounts: { unitsTrainedByType: { rifleman: 3 }, buildingsBuiltByType: {}, upgradesResearched: {} },
    })
    expect(countFor(profile, squad)).toBe(13)
  })

  it('respects dev-tunable achievement targets', () => {
    const storage = makeStorage()
    const profile = freshProfile()
    const cfg = config({ achievementTargets: { 'marine-hunter': 10 } })
    const def = ACHIEVEMENTS.find((a) => a.id === 'marine-hunter')!

    expect(achievementTarget(cfg, def)).toBe(10)
    expect(achievementTarget(config(), def)).toBe(20)

    record(storage, profile, cfg, { mode: 'offline', result: 'win', map: 'm', durationSec: 60, kills: 10, unitsBuilt: 0, buildingsBuilt: 0, supplyHarvested: 0, counters: { killsInfantry: 10, kills: 10 } })
    expect(profile.achievements['marine-hunter']).toBeDefined()
    expect(countFor(profile, def)).toBe(10)
  })

  it('trims match history to the configured cap', () => {
    const storage = makeStorage()
    const profile = freshProfile()
    const cfg = config({ historyCap: 2 })
    record(storage, profile, cfg, { mode: 'offline', result: 'win', map: 'a', durationSec: 10, kills: 0, unitsBuilt: 0, buildingsBuilt: 0, supplyHarvested: 0 })
    record(storage, profile, cfg, { mode: 'offline', result: 'win', map: 'b', durationSec: 10, kills: 0, unitsBuilt: 0, buildingsBuilt: 0, supplyHarvested: 0 })
    record(storage, profile, cfg, { mode: 'offline', result: 'win', map: 'c', durationSec: 10, kills: 0, unitsBuilt: 0, buildingsBuilt: 0, supplyHarvested: 0 })
    expect(profile.history).toHaveLength(2)
    expect(profile.history[0].map).toBe('c')
    expect(profile.history[1].map).toBe('b')
  })

  it('all 40 achievement defs resolve against the counter shape', () => {
    const profile = freshProfile()
    expect(ACHIEVEMENTS).toHaveLength(40)
    for (const def of ACHIEVEMENTS) {
      expect(typeof achievementProgress(def, profile.counters, profile.typeCounts)).toBe('number')
      expect(achievementProgress(def, profile.counters, profile.typeCounts)).toBe(0)
    }
    const ids = new Set(ACHIEVEMENTS.map((a) => a.id))
    expect(ids.size).toBe(ACHIEVEMENTS.length)
  })

  it('evaluateAchievements stamps unlockedAt once and never removes unlocks', () => {
    const profile = freshProfile()
    profile.counters.killsInfantry = 25
    evaluateAchievements(profile, config(), 5000)
    const unlockedAt = profile.achievements['marine-hunter']?.unlockedAt
    expect(unlockedAt).toBe(5000)

    evaluateAchievements(profile, config(), 9999)
    expect(profile.achievements['marine-hunter'].unlockedAt).toBe(5000)
    expect(profile.achievements['warlord']).toBeUndefined()
  })
})

describe('Day 14.3: SessionRecorder event tracking', () => {
  const ev = (e: SimEvent): SimEvent => e

  it('counts kills and damage for the local team, ignoring the enemy side', () => {
    const r = new SessionRecorder(1)
    r.track(ev({ type: 'combat-hit', attacker: 5, target: 100, damage: 25, team: 1 }))
    r.track(ev({ type: 'entity-destroyed', entity: 100, kind: 'unit', team: 0, typeName: 'rifleman' }))
    r.track(ev({ type: 'combat-hit', attacker: 5, target: 101, damage: 10, team: 1 }))
    r.track(ev({ type: 'entity-destroyed', entity: 101, kind: 'unit', team: 0, typeName: 'assault-walker' }))
    r.track(ev({ type: 'combat-hit', attacker: 5, target: 102, damage: 10, team: 1 }))
    r.track(ev({ type: 'entity-destroyed', entity: 102, kind: 'unit', team: 0, typeName: 'fighter' }))
    r.track(ev({ type: 'combat-hit', attacker: 5, target: 103, damage: 10, team: 1 }))
    r.track(ev({ type: 'entity-destroyed', entity: 103, kind: 'building', team: 0, typeName: 'command-center' }))
    r.track(ev({ type: 'entity-destroyed', entity: 200, kind: 'unit', team: 1, typeName: 'rifleman' }))

    const s = r.summary()
    expect(s.counters.kills).toBe(4)
    expect(s.counters.killsInfantry).toBe(1)
    expect(s.counters.killsVehicle).toBe(1)
    expect(s.counters.killsAir).toBe(1)
    expect(s.counters.killsBuilding).toBe(1)
    expect(s.counters.damageDealt).toBe(55)
    expect(s.counters.unitsLost).toBe(1)
  })

  it('tracks production, economy, abilities and super weapons', () => {
    const r = new SessionRecorder(1)
    r.track(ev({ type: 'supply-harvested', team: 1, amount: 120 }))
    r.track(ev({ type: 'unit-trained', entity: 1, unitType: 'rifleman', team: 1 }))
    r.track(ev({ type: 'building-placed', entity: 2, buildingType: 'power-plant', team: 1 }))
    r.track(ev({ type: 'upgrade-completed', building: 3, upgrade: 'weapon-upgrade', team: 1 }))
    r.track(ev({ type: 'grenade-exploded', team: 1, x: 5, y: 5 }))
    r.track(ev({ type: 'mine-placed', entity: 4, team: 1, x: 0, y: 0 }))
    r.track(ev({ type: 'unit-loaded', entity: 6, transport: 7, unitType: 'rifleman', team: 1 }))
    r.track(ev({ type: 'satellite-used', team: 1 }))
    r.track(ev({ type: 'laser-strike', team: 1, x: 9, y: 9 }))
    r.track(ev({ type: 'airstrike-called', team: 1, x: 9, y: 9 }))
    r.track(ev({ type: 'emp-strike', team: 1, x: 9, y: 9, radius: 4 }))

    const s = r.summary()
    expect(s.counters.supplyHarvested).toBe(120)
    expect(s.counters.unitsTrained).toBe(1)
    expect(s.counters.buildingsBuilt).toBe(1)
    expect(s.counters.grenadesLobbed).toBe(1)
    expect(s.counters.minesPlaced).toBe(1)
    expect(s.counters.troopsTransported).toBe(1)
    expect(s.counters.satelliteScans).toBe(1)
    expect(s.counters.laserStrikes).toBe(1)
    expect(s.counters.airstrikes).toBe(1)
    expect(s.counters.empStrikes).toBe(1)
    expect(s.typeCounts.unitsTrainedByType.rifleman).toBe(1)
    expect(s.typeCounts.buildingsBuiltByType['power-plant']).toBe(1)
    expect(s.typeCounts.upgradesResearched['weapon-upgrade']).toBe(1)

    r.track(ev({ type: 'unit-trained', entity: 1, unitType: 'rifleman', team: 0 }))
    r.track(ev({ type: 'building-placed', entity: 2, buildingType: 'command-center', team: 0 }))
    expect(r.summary().counters.unitsTrained).toBe(1)
    expect(r.summary().counters.buildingsBuilt).toBe(1)
  })

  it('summaries are defensive copies of the current totals', () => {
    const r = new SessionRecorder(1)
    r.track(ev({ type: 'supply-harvested', team: 1, amount: 50 }))
    const first = r.summary()
    r.track(ev({ type: 'supply-harvested', team: 1, amount: 25 }))
    expect(first.counters.supplyHarvested).toBe(50)
    expect(r.summary().counters.supplyHarvested).toBe(75)
  })
})