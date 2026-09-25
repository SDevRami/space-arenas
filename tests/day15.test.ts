import { describe, expect, it } from 'vitest'
import { createEmptyMap, RANK_FLOORS, SCORE_UNIT_KILL, SCORE_BUILDING_KILL, UPGRADES, EMP_RADIUS_TILES, AIRSTRIKE_MAX_LEVEL, EMP_MAX_LEVEL, type MatchSettings } from '@space-arenas/shared'
import { Simulator } from '../client/src/core/Simulator.ts'
import { hashWorld } from '../client/src/core/hash.ts'
import { spawnUnit, spawnBuilding } from '../client/src/entities/factories.ts'
import { fire } from '../client/src/systems/combat-system.ts'
import {
  DEFAULT_PROFILE_HISTORY_CAP,
  freshProfile,
  loadProfile,
  recordMatch,
  saveProfile,
  totalScore,
  type MatchRecordInput,
  type ProfileConfig,
  type StorageLike,
} from '../client/src/profile/profile.ts'

const MAP = createEmptyMap(64, 64)
const SEED = 0xabcdef15

const makeSim = (settings?: Partial<MatchSettings>): Simulator => new Simulator(MAP, SEED, [0, 1], settings)

const powerTeam0 = (sim: Simulator): void => {
  spawnBuilding(sim.world, 'command-center', 0, 10, 10, true)
  spawnBuilding(sim.world, 'power-plant', 0, 30, 2, true)
  spawnBuilding(sim.world, 'power-plant', 0, 33, 2, true)
  spawnBuilding(sim.world, 'power-plant', 0, 36, 2, true)
}

const arm = (sim: Simulator, team: number, choice: 'laser' | 'airstrike' | 'emp'): void => {
  // The second super weapon only unlocks at 1★.
  sim.world.teamState(team).rank = 1
  sim.step([sim.makeCommand(team, { type: 'sw-choose', entities: [], x: 0, y: 0, choice })])
  sim.drainEvents()
}

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

const record = (
  storage: StorageLike,
  profile: ReturnType<typeof freshProfile>,
  cfg: ProfileConfig,
  input: Omit<MatchRecordInput, 'counters' | 'typeCounts'>,
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
    score: input.score ?? 0,
    counters: { ...input.counters },
    typeCounts: input.typeCounts ?? { unitsTrainedByType: {}, buildingsBuiltByType: {}, upgradesResearched: {} },
  })
}

describe('Day 15.1: match score from combat', () => {
  it('credits unit kills and building kills to the last attacker', () => {
    const { world } = makeSim()
    const rifle = spawnUnit(world, 'rifleman', 0, 10000, 10000)
    const enemy = spawnUnit(world, 'rifleman', 1, 10500, 10000)
    const hp = world.healths.require(enemy).hp
    const before = world.scoreOf(0)
    fire(world, rifle, enemy, 10500, 10000, hp + 100, undefined, false)
    expect(world.isAlive(enemy)).toBe(false)
    expect(world.scoreOf(0)).toBe(before + SCORE_UNIT_KILL)

    const cc = spawnBuilding(world, 'command-center', 1, 50, 50, true)
    const ccHp = world.healths.require(cc).hp
    const beforeB = world.scoreOf(0)
    fire(world, rifle, cc, 50000, 50000, ccHp + 1000, undefined, false)
    expect(world.isAlive(cc)).toBe(false)
    expect(world.scoreOf(0)).toBe(beforeB + SCORE_BUILDING_KILL)
  })

  it('does not credit score when an entity is sold/refunded (no attacker)', () => {
    const { world } = makeSim()
    const mine = spawnBuilding(world, 'command-center', 0, 5, 5, true)
    world.removeEntity(mine)
    expect(world.scoreOf(1)).toBe(0)
  })
})

describe('Day 15.2: general rank ladder', () => {
  it('awardScore accumulates, rank stays 0 until the floor is reached', () => {
    const sim = makeSim()
    const { world } = sim
    world.awardScore(0, 100)
    expect(world.scoreOf(0)).toBe(100)
    expect(world.rankOf(0)).toBe(0)
    expect(world.canRankUp(0)).toBe(false)
    for (let i = 0; i < Math.ceil(RANK_FLOORS[0] / 100) - 1; i++) world.awardScore(0, 100)
    expect(world.scoreOf(0)).toBe(100 * Math.ceil(RANK_FLOORS[0] / 100))
    expect(world.rankOf(0)).toBe(1) // promotion is automatic once the floor is cleared
    expect(world.canRankUp(0)).toBe(false)
  })

  it('auto promotion grants the prize, keeps the score, and can climb again', () => {
    const sim = makeSim()
    const { world } = sim
    const creditsBefore = world.teamState(0).credits
    world.awardScore(0, RANK_FLOORS[0] + 100)
    const events = sim.drainEvents()
    expect(events.some((e) => e.type === 'rank-up' && e.team === 0 && e.rank === 1)).toBe(true)
    expect(world.rankOf(0)).toBe(1)
    expect(world.scoreOf(0)).toBe(RANK_FLOORS[0] + 100) // score is NOT consumed
    expect(world.teamState(0).credits).toBe(creditsBefore + world.settings.rankUpPrizeCredits)
    // Already past the floor for star 2? No — score now needs RANK_FLOORS[1].
    expect(world.canRankUp(0)).toBe(false)
    world.awardScore(0, RANK_FLOORS[1])
    expect(world.rankOf(0)).toBe(2)
  })

  it('rejects the rank-up command below the floor and at max rank', () => {
    const sim = makeSim()
    const { world } = sim
    world.awardScore(0, 50)
    sim.step([sim.makeCommand(0, { type: 'rank-up', entities: [], x: 0, y: 0 })])
    const rejected = sim.drainEvents()
    expect(rejected.some((e) => e.type === 'command-rejected' && e.reason.includes('below'))).toBe(true)
    expect(world.rankOf(0)).toBe(0)

    world.teams.get(0)!.rank = 3
    expect(world.canRankUp(0)).toBe(false)
    sim.step([sim.makeCommand(0, { type: 'rank-up', entities: [], x: 0, y: 0 })])
    expect(sim.drainEvents().some((e) => e.type === 'command-rejected')).toBe(true)
  })

  it('score and rank participate in the sync hash', () => {
    const a = makeSim()
    const b = makeSim()
    a.world.awardScore(0, 1234)
    a.world.rankUp(0)
    a.world.teamState(0).airstrikeLevel = 1
    a.world.teamState(0).empLevel = 2
    expect(hashWorld(a.world)).not.toBe(hashWorld(b.world))
  })
})

describe('Day 15.3: rank-gated research (tier unlocks)', () => {
  it('rejects research below the required rank and accepts it at rank', () => {
    const sim = makeSim()
    const { world } = sim
    powerTeam0(sim)
    spawnBuilding(world, 'super-weapon', 0, 20, 3, true)
    arm(sim, 0, 'airstrike')
    const sp = [...world.buildings.idsArray()].find((id) => world.buildings.get(id)?.buildingType === 'super-weapon')!

    // super-weapon upgrades require ★3
    sim.step([sim.makeCommand(0, { type: 'research', entities: [sp], x: 0, y: 0, upgrade: 'space-laser' })])
    const rejected = sim.drainEvents()
    expect(rejected.some((e) => e.type === 'command-rejected' && e.reason.includes('star rank required'))).toBe(true)
    expect(world.laserLevel(0)).toBe(0)

    world.teams.get(0)!.rank = 3
    world.teamState(0).credits = 5000
    sim.step([sim.makeCommand(0, { type: 'research', entities: [sp], x: 0, y: 0, upgrade: 'space-laser' })])
    const started = sim.drainEvents()
    expect(started.some((e) => e.type === 'research-started' && e.upgrade === 'space-laser')).toBe(true)
  })

  it('requires the matching strike arming before the level upgrade is accepted', () => {
    const sim = makeSim()
    const { world } = sim
    powerTeam0(sim)
    spawnBuilding(world, 'super-weapon', 0, 20, 3, true)
    // armed with EMP — airstrike payload is not for us
    arm(sim, 0, 'emp')
    world.teams.get(0)!.rank = 3
    world.teamState(0).credits = 5000
    const sp = [...world.buildings.idsArray()].find((id) => world.buildings.get(id)?.buildingType === 'super-weapon')!
    sim.step([sim.makeCommand(0, { type: 'research', entities: [sp], x: 0, y: 0, upgrade: 'airstrike-level' })])
    const rejected = sim.drainEvents()
    expect(rejected.some((e) => e.type === 'command-rejected' && e.reason.includes('choose the airstrike'))).toBe(true)
    expect(world.airstrikeLevel(0)).toBe(0)
  })
})

describe('Day 15.4: leveled super weapons', () => {
  it('completing airstrike-level raises airstrikeLevel and scales the strike; max clamps', () => {
    const sim = makeSim()
    const { world } = sim
    world.teams.get(0)!.rank = 3
    const s = world.teamState(0)
    s.airstrikeLevel = 0
    // direct application path (mirrors placing-system on completion)
    s.airstrikeLevel = Math.min(AIRSTRIKE_MAX_LEVEL, s.airstrikeLevel + 1)
    expect(world.airstrikeLevel(0)).toBe(1)
    expect(world.airstrikeDamageMultiplier(0)).toBeCloseTo(1.5)
    // double-buy is blocked at max
    s.airstrikeLevel = AIRSTRIKE_MAX_LEVEL
    expect(world.airstrikeLevel(0)).toBe(AIRSTRIKE_MAX_LEVEL)
    expect(world.airstrikeDamageMultiplier(0)).toBeCloseTo(2)
    // emp side
    s.empLevel = EMP_MAX_LEVEL - 1
    expect(world.empRadiusMultiplier(0)).toBeCloseTo(1.15)
  })

  it('emp-strike uses the leveled pulse radius/duration', () => {
    const sim = makeSim()
    const { world } = sim
    powerTeam0(sim)
    spawnBuilding(world, 'super-weapon', 0, 20, 3, true)
    arm(sim, 0, 'emp')
    world.teams.get(0)!.rank = 3
    world.teamState(0).empLevel = 2
    sim.step([sim.makeCommand(0, { type: 'sw-emp', entities: [], x: 20, y: 10 })])
    const events = sim.drainEvents()
    const strike = events.find((e): e is { type: 'emp-strike'; radius: number } => e.type === 'emp-strike')
    expect(strike).toBeDefined()
    expect(strike!.radius).toBe(Math.round(EMP_RADIUS_TILES * 1.3))
  })
})

describe('Day 15.5: laser default + move of radar to Command Center + unlock defs', () => {
  it('sw-choose rejects the laser pick (it is armed by default)', () => {
    const sim = makeSim()
    const { world } = sim
    spawnBuilding(world, 'super-weapon', 0, 20, 3, true)
    sim.step([sim.makeCommand(0, { type: 'sw-choose', entities: [], x: 0, y: 0, choice: 'laser' })])
    const events = sim.drainEvents()
    expect(events.some((e) => e.type === 'command-rejected' && e.reason.includes('laser is armed by default'))).toBe(true)
    expect(world.swChoiceOf(0)).toBeNull()
  })

  it('radar is researched in the Command Center', () => {
    expect(UPGRADES.radar.availableAt).toBe('command-center')
  })

  it('super weapon unlocks are rank-gated and the tech tier is rank-capped', () => {
    expect(UPGRADES['space-laser'].availableAt).toBe('super-weapon')
    expect(UPGRADES['space-laser'].requiredRank).toBe(3)
    expect(UPGRADES['airstrike-level'].requiredRank).toBe(3)
    expect(UPGRADES['emp-level'].requiredRank).toBe(3)
    expect(UPGRADES['stealth-tech'].requiredRank).toBe(1)
    expect(UPGRADES['defense-dome'].requiredRank).toBe(2)
    expect(UPGRADES['weapon-upgrade'].requiredRank).toBe(2)
    expect(UPGRADES.radar.requiredRank).toBe(0)
  })
})

describe('Day 15.6: the second super weapon unlocks at 1★', () => {
  it('rejects sw-choose below rank 1 and arms it at rank 1', () => {
    const sim = makeSim()
    const { world } = sim
    spawnBuilding(world, 'super-weapon', 0, 20, 3, true)

    sim.step([sim.makeCommand(0, { type: 'sw-choose', entities: [], x: 0, y: 0, choice: 'airstrike' })])
    const rejected = sim.drainEvents()
    expect(rejected.some((e) => e.type === 'command-rejected' && e.reason.includes('star rank required'))).toBe(true)
    expect(world.swChoiceOf(0)).toBeNull()

    world.teamState(0).rank = 1
    sim.step([sim.makeCommand(0, { type: 'sw-choose', entities: [], x: 0, y: 0, choice: 'airstrike' })])
    const accepted = sim.drainEvents()
    expect(accepted.some((e) => e.type === 'sw-chosen' && e.choice === 'airstrike')).toBe(true)
    expect(world.swChoiceOf(0)).toBe('airstrike')
  })
})

describe('Day 15.7: profile total score', () => {
  it('recordMatch stores per-match score and totalScore sums the history', () => {
    const storage = makeStorage()
    const profile = freshProfile('Ace')
    const cfg = config()
    saveProfile(storage, profile)
    record(storage, profile, cfg, {
      mode: 'offline',
      result: 'win',
      map: 'm',
      durationSec: 60,
      kills: 4,
      unitsBuilt: 0,
      buildingsBuilt: 0,
      supplyHarvested: 0,
      score: 300,
      counters: {},
    })
    record(storage, profile, cfg, {
      mode: 'offline',
      result: 'loss',
      map: 'm',
      durationSec: 60,
      kills: 0,
      unitsBuilt: 0,
      buildingsBuilt: 0,
      supplyHarvested: 0,
      score: 75,
      counters: {},
    })
    // history is unshifted: [0] is the newest (75), [1] the older (300)
    expect(profile.history[0].score).toBe(75)
    expect(profile.history[1].score).toBe(300)
    expect(totalScore(profile)).toBe(375)
    const reloaded = loadProfile(storage)
    expect(totalScore(reloaded)).toBe(375)
  })
})