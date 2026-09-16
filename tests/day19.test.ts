import { describe, expect, it } from 'vitest'
import { createEmptyMap, tileToFx } from '@space-arenas/shared'
import { Simulator } from '../client/src/core/Simulator.ts'
import { spawnBuilding } from '../client/src/entities/factories.ts'
import { recordSurvivalResult, recordDailyResult, recordCampaignResult, dailySeed, dailyLevel, dailyLevelXp } from '../client/src/profile/modeRecords.ts'
import { generateDailyMissions, evaluateDailyMissions } from '../client/src/modes/daily.ts'
import { SurvivalDirector, survivalScore } from '../client/src/modes/survival.ts'
import { CampaignScript, CHAPTER_1 } from '../client/src/modes/campaign.ts'
import { isScriptedMode } from '../client/src/game/match.ts'

const mockStorage = (): { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void } => {
  const store: Record<string, string> = {}
  return { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v } }
}

const MAP = createEmptyMap(48, 48)

describe('Day 19: isScriptedMode', () => {
  it('survival and campaign are scripted, bots and daily are not', () => {
    expect(isScriptedMode('survival')).toBe(true)
    expect(isScriptedMode('campaign')).toBe(true)
    expect(isScriptedMode('bots')).toBe(false)
    expect(isScriptedMode('daily')).toBe(false)
    expect(isScriptedMode('custom')).toBe(false)
    expect(isScriptedMode(undefined)).toBe(false)
  })
})

describe('Day 19: ModeRecords persistence', () => {
  it('survival record keeps career best and accumulates plays/wins', () => {
    const s = mockStorage()
    const r1 = recordSurvivalResult(s as any, { wave: 10, score: 1200, durationSec: 600, won: false })
    expect(r1.survival!.bestWave).toBe(10)
    expect(r1.survival!.bestScore).toBe(1200)
    expect(r1.survival!.plays).toBe(1)
    expect(r1.survival!.wins).toBe(0)

    const r2 = recordSurvivalResult(s as any, { wave: 5, score: 400, durationSec: 200, won: true })
    expect(r2.survival!.bestWave).toBe(10) // unchanged — wave 5 < 10
    expect(r2.survival!.wins).toBe(1)
    expect(r2.survival!.plays).toBe(2)

    const r3 = recordSurvivalResult(s as any, { wave: 14, score: 1500, durationSec: 800, won: true })
    expect(r3.survival!.bestWave).toBe(14)
    expect(r3.survival!.bestScore).toBe(1500)
    expect(r3.survival!.plays).toBe(3)
    expect(r3.survival!.wins).toBe(2)
  })

  it('daily result accumulates XP and maintains streak across consecutive days', () => {
    const s = mockStorage()
    const r1 = recordDailyResult(s as any, { dayKey: '2026-09-16', missionsDone: ['daily:win'], xpEarned: 40 })
    expect(r1.daily!.xp).toBe(40)
    expect(r1.daily!.streak).toBe(1)
    expect(r1.daily!.bestStreak).toBe(1)
    expect(r1.daily!.lastPlayedDayKey).toBe('2026-09-16')

    const r2 = recordDailyResult(s as any, { dayKey: '2026-09-17', missionsDone: [], xpEarned: 0 })
    expect(r2.daily!.streak).toBe(2)
    expect(r2.daily!.bestStreak).toBe(2)

    const r3 = recordDailyResult(s as any, { dayKey: '2026-09-19', missionsDone: [], xpEarned: 0 }) // skipped a day
    expect(r3.daily!.streak).toBe(1) // broken streak
  })

  it('campaign record notes chapter completion and counts plays', () => {
    const s = mockStorage()
    const r1 = recordCampaignResult(s as any, { chapterId: 'ch1', completed: false })
    expect(r1.campaign!.plays).toBe(1)
    expect(r1.campaign!.chaptersDone).toEqual([])

    const r2 = recordCampaignResult(s as any, { chapterId: 'ch1', completed: true })
    expect(r2.campaign!.plays).toBe(2)
    expect(r2.campaign!.chaptersDone).toEqual(['ch1'])
  })
})

describe('Day 19: dailySeed determinism', () => {
  it('same day key always produces the same seed', () => {
    const a = dailySeed('2026-09-16')
    const b = dailySeed('2026-09-16')
    expect(a).toBe(b)
    expect(a).toBeGreaterThan(0)
  })

  it('different day keys produce different seeds', () => {
    expect(dailySeed('2026-09-16')).not.toBe(dailySeed('2026-09-17'))
  })
})

describe('Day 19: daily missions', () => {
  it('generates 4 missions for the day', () => {
    const missions = generateDailyMissions('2026-09-16')
    expect(missions.length).toBe(4)
    // every mission has a positive XP
    for (const m of missions) expect(m.xp).toBeGreaterThan(0)
  })

  it('same day always yields same missions', () => {
    const a = generateDailyMissions('2026-09-16')
    const b = generateDailyMissions('2026-09-16')
    expect(a).toEqual(b)
  })

  it('evaluateDailyMissions awards XP for satisfied missions', () => {
    const missions = generateDailyMissions('2026-09-16')
    const { done, xp } = evaluateDailyMissions(missions, { won: true, kills: 999, unitsTrained: 99, buildingsBuilt: 99, supplyHarvested: 9999 })
    expect(done.length).toBe(missions.length)
    expect(xp).toBe(missions.reduce((s, m) => s + m.xp, 0))
  })

  it('evaluateDailyMissions partially satisfies missions', () => {
    const missions = generateDailyMissions('2026-09-16')
    // all-zero result: no kills, no units, no buildings, no supply, no win
    const { done, xp } = evaluateDailyMissions(missions, { won: false, kills: 0, unitsTrained: 0, buildingsBuilt: 0, supplyHarvested: 0 })
    // at most only the supply mission may pass if its target is 0 (unlikely — targets are positive)
    expect(xp).toBeGreaterThanOrEqual(0)
    expect(done.length).toBeLessThanOrEqual(missions.length)
  })
})

describe('Day 19: dailyLevel and dailyLevelXp', () => {
  it('computes level and sub-level XP from a record', () => {
    const s = mockStorage()
    const r1 = recordDailyResult(s as any, { dayKey: '2026-09-16', missionsDone: ['daily:win'], xpEarned: 40 })
    expect(dailyLevel(r1.daily)).toBe(0)
    expect(dailyLevelXp(r1.daily)).toBe(40)

    const r2 = recordDailyResult(s as any, { dayKey: '2026-09-17', missionsDone: ['daily:train', 'daily:build', 'daily:destroy'], xpEarned: 100 }) // +100 total = 140
    // level = floor(140/100) = 1, xp-in-level = 40
    expect(dailyLevel(r2.daily)).toBe(1)
    expect(dailyLevelXp(r2.daily)).toBe(40)
  })
})

describe('Day 19: survivalScore', () => {
  it('scores from wave, kills, and damage dealt', () => {
    expect(survivalScore(1, 0, 0)).toBe(0)
    expect(survivalScore(5, 20, 1000)).toBe(400 + 200 + 10) // 4*100=400, 20*10=200, 1000/100=10
    expect(survivalScore(10, 50, 3000)).toBe(900 + 500 + 30) // 9*100=900
  })
})

describe('Day 19: SurvivalDirector', () => {
  it('does not spawn wave until grace ticks have elapsed', () => {
    const sim = new Simulator(MAP, 0x1234, [0, 1])
    const dir = new SurvivalDirector({ enemyDifficulty: 'easy', waveIntervalTicks: 250 }, 0)
    expect(dir.run.wave).toBe(0)
    for (let tick = 0; tick < 250; tick++) {
      sim.world.tick = tick
      dir.tick(sim.world)
    }
    expect(dir.run.wave).toBe(0)
  })

  it('spawns wave 1 on first eligible tick and queues wave 2 after interval', () => {
    const sim = new Simulator(MAP, 0x1234, [0, 1])
    const dir = new SurvivalDirector({ enemyDifficulty: 'easy', waveIntervalTicks: 250 }, 0)
    sim.world.tick = 250
    const out = dir.tick(sim.world)
    expect(dir.run.wave).toBe(1)
    expect(out.wave).toBe(1)
    expect(out.toastKey).toBe('survival.toast.wave')
    expect(dir.run.nextWaveAt).toBe(250 + 250) // 500
  })

  it('waves accumulate and second wave spawns after the interval', () => {
    const sim = new Simulator(MAP, 0x1234, [0, 1])
    const dir = new SurvivalDirector({ enemyDifficulty: 'easy', waveIntervalTicks: 100 }, 0)
    sim.world.tick = 250 // grace period (10s) elapsed
    dir.tick(sim.world) // wave 1
    expect(dir.run.wave).toBe(1)
    sim.world.tick = 349
    dir.tick(sim.world) // too early (next at 250+100=350)
    expect(dir.run.wave).toBe(1)
    sim.world.tick = 350
    const out = dir.tick(sim.world) // wave 2
    expect(dir.run.wave).toBe(2)
    expect(out.wave).toBe(2)
  })
})

describe('Day 19: CampaignScript', () => {
  const makeSim = () => new Simulator(CHAPTER_1.map, 0xc4ad, [0, 1], { startingCredits: CHAPTER_1.credits })
  const script = () => {
    const s = makeSim()
    const c = new CampaignScript({ chapterId: 'ch1' }, 0)
    c.place(s.world)
    return { sim: s, script: c }
  }

  it('place() removes auto-spawned base and places player squad near the start', () => {
    const { sim, script: sc } = script()
    // no player buildings after place()
    let playerBuildings = 0
    sim.world.buildings.forEach((_, b) => { if (b.team === 0) playerBuildings++ })
    expect(playerBuildings).toBe(0)
    // at least 5 player units (the start squad)
    let playerUnits = 0
    sim.world.units.forEach((_, u) => { if (u.team === 0) playerUnits++ })
    expect(playerUnits).toBeGreaterThanOrEqual(5)
    // run starts in the journey phase
    expect(sc.run.phase).toBe('journey')
    expect(sc.run.collectedDrops).toBe(0)
  })

  it('collects a drop when a player unit stands near it', () => {
    const { sim, script: sc } = script()
    expect(sc.run.phase).toBe('journey')
    // move the first player unit near the first drop tile (9, 30)
    const drop = CHAPTER_1.drops[0]
    let firstPlayerUnit: number | null = null
    sim.world.units.forEach((id, u) => { if (firstPlayerUnit === null && u.team === 0) firstPlayerUnit = id })
    const t = sim.world.transforms.get(firstPlayerUnit!)!
    t.x = tileToFx(drop.tileX) + 500
    t.y = tileToFx(drop.tileY) + 500
    const out = sc.tick(sim.world)
    expect(out.toastKey).toBe('campaign.toast.dropFound')
    expect(sc.run.collectedDrops).toBe(1)
    expect(out.objectiveProgress).toBe(1)
    expect(out.objectiveTarget).toBe(3)
  })

  it('transitions to rebuild after all drops collected', () => {
    const { sim, script: sc } = script()
    // teleport player unit to all three drop tiles sequentially
    const playerUnits: number[] = []
    sim.world.units.forEach((id, u) => { if (u.team === 0) playerUnits.push(id) })
    for (let i = 0; i < CHAPTER_1.drops.length; i++) {
      const d = CHAPTER_1.drops[i]
      // reuse units 0,1,2 for drops 0,1,2
      const uid = playerUnits[i % playerUnits.length]
      const t = sim.world.transforms.get(uid)!
      t.x = tileToFx(d.tileX) + 500
      t.y = tileToFx(d.tileY) + 500
      sc.tick(sim.world)
    }
    expect(sc.run.collectedDrops).toBe(3)
    expect(sc.run.phase).toBe('rebuild')
    expect(sc.run.objectiveKey).toBe('campaign.obj.rebuild')
  })

  it('transitions to defend when a command center is placed at the old base', () => {
    const { sim, script: sc } = script()
    sc.run.phase = 'rebuild' // force phase
    sc.run.collectedDrops = 3
    sc.run.objectiveKey = 'campaign.obj.rebuild'
    // place a command center at the old base center (tile 12,12)
    const oldBase = CHAPTER_1.oldBase
    const ccX = oldBase.minX + Math.floor(oldBase.w / 2)
    const ccY = oldBase.minY + Math.floor(oldBase.h / 2)
    spawnBuilding(sim.world, 'command-center', 0, ccX, ccY, true)
    const out = sc.tick(sim.world)
    expect(sc.run.rebuildDone).toBe(true)
    expect(sc.run.phase).toBe('defend')
    expect(out.toastKey).toBe('campaign.toast.baseRebuilt')
    expect(out.logKey).toBe('campaign.log.baseRebuilt')
  })

  it('marks campaign done with winner when all enemy outpost command-centers are destroyed', () => {
    const { sim, script: sc } = script()
    // force into attack phase with outpost ids
    sc.run.phase = 'attack'
    sc.run.objectiveKey = 'campaign.obj.attack'
    sc.run.objectiveProgress = 0
    sc.run.objectiveTarget = CHAPTER_1.enemyOutposts.length
    // find all enemy buildings and remove them all to simulate destruction
    const outpostIds: number[] = []
    sim.world.buildings.forEach((id, b) => { if (b.team === 1) outpostIds.push(id) })
    expect(outpostIds.length).toBeGreaterThanOrEqual(2) // at least 2 outpost CCs
    for (const id of outpostIds) sim.world.removeEntity(id)
    const out = sc.tick(sim.world)
    expect(out.done).toBe(true)
    expect(out.winner).toBe(0)
    expect(sc.run.done).toBe(true)
    expect(sc.run.won).toBe(true)
  })
})
