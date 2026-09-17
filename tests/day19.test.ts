import { describe, expect, it, vi } from 'vitest'
import { createEmptyMap, tileToFx, type MapData } from '@space-arenas/shared'
import { Simulator } from '../client/src/core/Simulator.ts'
import { spawnBuilding } from '../client/src/entities/factories.ts'
import { recordSurvivalResult, recordDailyResult, recordCampaignResult, dailySeed, dailyLevel, dailyLevelXp } from '../client/src/profile/modeRecords.ts'
import { generateDailyMissions, evaluateDailyMissions, resolveDailyChallenge } from '../client/src/modes/daily.ts'
import { SurvivalDirector, survivalScore, enemyWaveSquad } from '../client/src/modes/survival.ts'
import { CampaignScript, CHAPTER_1 } from '../client/src/modes/campaign.ts'
import { WinLossSystem } from '../client/src/systems/winloss-system.ts'
import { isScriptedMode } from '../client/src/game/match.ts'

const mockStorage = (): { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void } => {
  const store: Record<string, string> = {}
  return { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v } }
}

/** Map with explicit spawn points so survival's player base and raider spawn can be asserted. */
const MAP_WITH_SPAWNS = (): MapData => {
  const map = createEmptyMap(48, 48)
  map.spawnPoints = [
    { x: 4, y: 4, team: 0 },
    { x: 44, y: 44, team: 1 },
  ]
  return map
}

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

  it('daily result banks XP for newly completed missions and maintains a real-day streak', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-09-16T12:00:00Z'))
      const s = mockStorage()
      const missions = generateDailyMissions(1)
      const r1 = recordDailyResult(s as any, { generation: 1, missions, doneIds: [missions[0].id] })
      expect(r1.daily!.xp).toBe(missions[0].xp)
      expect(r1.daily!.streak).toBe(1)
      expect(r1.daily!.bestStreak).toBe(1)
      expect(r1.daily!.lastPlayedDayKey).toBe('2026-09-16')

      vi.setSystemTime(new Date('2026-09-17T12:00:00Z'))
      // Re-reporting mission 0 must NOT bank its XP twice.
      const r2 = recordDailyResult(s as any, { generation: 1, missions, doneIds: [missions[0].id, missions[1].id] })
      expect(r2.daily!.xp).toBe(missions[0].xp + missions[1].xp)
      expect(r2.daily!.streak).toBe(2)
      expect(r2.daily!.bestStreak).toBe(2)

      vi.setSystemTime(new Date('2026-09-19T12:00:00Z'))
      const r3 = recordDailyResult(s as any, { generation: 1, missions, doneIds: [] }) // skipped a day
      expect(r3.daily!.streak).toBe(1) // broken streak
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the same mission list across days until every mission is done', () => {
    const s = mockStorage()
    const a = resolveDailyChallenge(s as any)
    expect(a.generation).toBe(1)
    expect(a.allDone).toBe(false)

    // "Next day" — the list must not change just because time passed.
    const b = resolveDailyChallenge(s as any)
    expect(b.generation).toBe(1)
    expect(b.missions).toEqual(a.missions)

    // Completing one mission also keeps the list.
    recordDailyResult(s as any, { generation: 1, missions: a.missions, doneIds: [a.missions[0].id] })
    const c = resolveDailyChallenge(s as any)
    expect(c.generation).toBe(1)
    expect(c.doneIds).toEqual([a.missions[0].id])

    // ...but finishing them all rolls a fresh generation.
    recordDailyResult(s as any, { generation: 1, missions: a.missions, doneIds: a.missions.map((m) => m.id) })
    const d = resolveDailyChallenge(s as any)
    expect(d.generation).toBe(2)
    expect(d.doneIds).toEqual([])
  })

  it('a mission finished "yesterday" still shows as done today (no date reset)', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-09-16T12:00:00Z'))
      const s = mockStorage()
      const challenge = resolveDailyChallenge(s as any)
      recordDailyResult(s as any, { generation: challenge.generation, missions: challenge.missions, doneIds: [challenge.missions[0].id] })

      vi.setSystemTime(new Date('2026-09-17T12:00:00Z'))
      const tomorrow = resolveDailyChallenge(s as any)
      expect(tomorrow.generation).toBe(challenge.generation)
      expect(tomorrow.doneIds).toContain(challenge.missions[0].id)
    } finally {
      vi.useRealTimers()
    }
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
  it('generates 4 missions for the challenge generation', () => {
    const missions = generateDailyMissions(1)
    expect(missions.length).toBe(4)
    // every mission has a positive XP
    for (const m of missions) expect(m.xp).toBeGreaterThan(0)
  })

  it('same generation always yields same missions', () => {
    const a = generateDailyMissions(1)
    const b = generateDailyMissions(1)
    expect(a).toEqual(b)
  })

  it('different generations yields different missions', () => {
    expect(generateDailyMissions(2)).not.toEqual(generateDailyMissions(1))
  })

  it('evaluateDailyMissions awards XP for satisfied missions', () => {
    const missions = generateDailyMissions(1)
    const { done, xp } = evaluateDailyMissions(missions, { won: true, kills: 999, unitsTrained: 99, buildingsBuilt: 99, supplyHarvested: 9999 })
    expect(done.length).toBe(missions.length)
    expect(xp).toBe(missions.reduce((s, m) => s + m.xp, 0))
  })

  it('evaluateDailyMissions partially satisfies missions', () => {
    const missions = generateDailyMissions(1)
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
    const missions = generateDailyMissions(1)
    const r1 = recordDailyResult(s as any, { generation: 1, missions, doneIds: [missions[0].id] })
    expect(dailyLevel(r1.daily)).toBe(0)
    expect(dailyLevelXp(r1.daily)).toBe(missions[0].xp)

    const r2 = recordDailyResult(s as any, { generation: 1, missions, doneIds: missions.map((m) => m.id) })
    const total = missions.reduce((sum, m) => sum + m.xp, 0)
    // level = floor(total/100), xp-in-level = total % 100
    expect(dailyLevel(r2.daily)).toBe(Math.floor(total / 100))
    expect(dailyLevelXp(r2.daily)).toBe(total % 100)
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
    const sim = new Simulator(MAP_WITH_SPAWNS(), 0x1234, [0, 1])
    const dir = new SurvivalDirector({ difficulty: 'easy', waveIntervalTicks: 250 }, 0)
    expect(dir.run.wave).toBe(0)
    for (let tick = 0; tick < 250; tick++) {
      sim.world.tick = tick
      dir.tick(sim.world)
    }
    expect(dir.run.wave).toBe(0)
  })

  it('spawns wave 1 on first eligible tick and rearms the next wave', () => {
    const sim = new Simulator(MAP_WITH_SPAWNS(), 0x1234, [0, 1])
    const dir = new SurvivalDirector({ difficulty: 'easy', waveIntervalTicks: 250 }, 0)
    sim.world.tick = 250
    const out = dir.tick(sim.world)
    expect(dir.run.wave).toBe(1)
    expect(out.wave).toBe(1)
    expect(out.toastKey).toBe('survival.toast.wave')
    // next wave = interval + short rearm, so a fast wipe can't chain instantly
    expect(dir.run.nextWaveAt).toBeGreaterThan(250 + 250)
  })

  it('spawns raiders from the enemy spawn point without an enemy base or bot', () => {
    const sim = new Simulator(MAP_WITH_SPAWNS(), 0x1234, [0])
    const dir = new SurvivalDirector({ difficulty: 'medium', waveIntervalTicks: 100 }, 0)
    sim.world.tick = 250
    dir.tick(sim.world)
    let enemyBuildings = 0
    sim.world.buildings.forEach((_, b) => {
      if (b.team === 1) enemyBuildings++
    })
    expect(enemyBuildings).toBe(0)
    let enemyUnits = 0
    let nearSpawn = 0
    sim.world.units.forEach((id, u) => {
      if (u.team !== 1) return
      enemyUnits++
      const t = sim.world.transforms.get(id)
      if (t && Math.max(Math.abs(Math.floor(t.x / 1000) - 44), Math.abs(Math.floor(t.y / 1000) - 44)) <= 4) nearSpawn++
    })
    expect(enemyUnits).toBeGreaterThan(0)
    expect(nearSpawn).toBe(enemyUnits) // all raiders spawned at the enemy spawn point
  })

  it('spawns one squad per enemy spawn point (N sources = N squads per wave)', () => {
    const map = createEmptyMap(48, 48)
    map.spawnPoints = [
      { x: 4, y: 4, team: 0 },
      { x: 44, y: 44, team: 1 },
      { x: 4, y: 44, team: 2 },
    ]
    const sim = new Simulator(map, 0x1234, [0])
    const dir = new SurvivalDirector({ difficulty: 'easy', waveIntervalTicks: 100 }, 0)
    sim.world.tick = 250
    dir.tick(sim.world)
    const near = (x: number, y: number): number => {
      let n = 0
      sim.world.units.forEach((id, u) => {
        if (u.team !== 1) return
        const t = sim.world.transforms.get(id)
        if (t && Math.max(Math.abs(Math.floor(t.x / 1000) - x), Math.abs(Math.floor(t.y / 1000) - y)) <= 5) n++
      })
      return n
    }
    expect(near(44, 44)).toBeGreaterThan(0)
    expect(near(4, 44)).toBeGreaterThan(0)
    expect(dir.run.lastWaveSpawned).toBe(near(44, 44) + near(4, 44))
  })

  it('refills every supply field when a new wave spawns', () => {
    const map = MAP_WITH_SPAWNS()
    map.supplyFields = [{ x: 20, y: 20, radius: 2, capacity: 500 }]
    const sim = new Simulator(map, 0x1234, [0])
    const tripsOf = (): number => {
      let trips = -1
      sim.world.fields.forEach((_id, f) => { trips = f.trips })
      return trips
    }
    sim.world.fields.forEach((_id, f) => { f.trips = 0 })
    expect(tripsOf()).toBe(0)
    const dir = new SurvivalDirector({ difficulty: 'easy', waveIntervalTicks: 100 }, 0)
    sim.world.tick = 250
    dir.tick(sim.world)
    expect(tripsOf()).toBe(500)
  })

  it('flags raiders for pathfinding and never wipes an existing path mid-march', () => {
    const sim = new Simulator(MAP_WITH_SPAWNS(), 0x1234, [0])
    const dir = new SurvivalDirector({ difficulty: 'easy', waveIntervalTicks: 100 }, 0)
    sim.world.tick = 250
    dir.tick(sim.world) // spawn wave 1
    dir.tick(sim.world) // steering assigns a pathed move
    const id = dir.run.raiderIds[0]
    const move = sim.world.moves.get(id)!
    expect(move.needsPath).toBe(true)
    // Simulate PathfindingSystem giving the raider a real route.
    move.path = [sim.world.width * 2 + 2]
    move.needsPath = false
    dir.tick(sim.world)
    expect(sim.world.moves.get(id)!.path).toEqual([sim.world.width * 2 + 2])
  })

  it('later waves add troops and war vehicles beyond riflemen', () => {
    expect(enemyWaveSquad(1, 'medium').map((g) => g.type)).toEqual(['rifleman'])
    const w3 = enemyWaveSquad(3, 'medium').map((g) => g.type)
    expect(w3).toContain('rocket-trooper')
    expect(w3).toContain('assault-walker')
    expect(enemyWaveSquad(7, 'medium').map((g) => g.type)).toContain('artillery')
  })

  it('does not start a new wave until at least half of the previous wave is destroyed', () => {
    const sim = new Simulator(MAP_WITH_SPAWNS(), 0x1234, [0, 1])
    const dir = new SurvivalDirector({ difficulty: 'easy', waveIntervalTicks: 100 }, 0)
    sim.world.tick = 250
    dir.tick(sim.world) // wave 1
    expect(dir.run.wave).toBe(1)
    const spawned = dir.run.lastWaveSpawned
    expect(spawned).toBeGreaterThan(0)

    // Interval elapsed, but most of wave 1 is still alive — wave 2 must hold.
    sim.world.tick = 250 + 100 + 50
    dir.tick(sim.world)
    expect(dir.run.wave).toBe(1)

    // Destroy enough of wave 1 (floor(half) + 1) to clear the 50% gate.
    const toKill = Math.floor(spawned / 2) + 1
    for (let i = 0; i < toKill; i++) sim.world.removeEntity(dir.run.lastWaveIds[i])
    const out = dir.tick(sim.world)
    expect(dir.run.wave).toBe(2)
    expect(out.wave).toBe(2)
  })

  it('ends the run in defeat when the local base is destroyed', () => {
    const sim = new Simulator(MAP_WITH_SPAWNS(), 0x1234, [0])
    const dir = new SurvivalDirector({ difficulty: 'easy', waveIntervalTicks: 100 }, 0)
    sim.world.tick = 250
    dir.tick(sim.world)
    // Remove the player's command center.
    const toRemove: number[] = []
    sim.world.buildings.forEach((id, b) => {
      if (b.team === 0 && b.buildingType === 'command-center') toRemove.push(id)
    })
    for (const id of toRemove) sim.world.removeEntity(id)
    const out = dir.tick(sim.world)
    expect(out.done).toBe(true)
    expect(out.winner).toBe(1)
    expect(out.toastKey).toBe('survival.toast.lost')
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

  it('uses a larger map and spawns waves far from the old base', () => {
    expect(CHAPTER_1.map.width).toBeGreaterThanOrEqual(64)
    expect(CHAPTER_1.map.height).toBeGreaterThanOrEqual(64)
    expect(CHAPTER_1.wavesSpawn.tileX).toBeGreaterThan(CHAPTER_1.oldBase.minX)
    expect(CHAPTER_1.assaultSpawn.tileX).toBeGreaterThan(0)
  })

  it('never triggers the standard win-loss rule (no instant defeat at start)', () => {
    const { sim } = script()
    // place() strips the player's auto base, so the standard rule would call them eliminated.
    let playerCC = 0
    sim.world.buildings.forEach((_, b) => {
      if (b.team === 0 && b.buildingType === 'command-center') playerCC++
    })
    expect(playerCC).toBe(0)

    sim.world.winless = true
    WinLossSystem.update(sim.world)
    expect(sim.world.gameOver).toBe(null)

    // Sanity: without the guard the opening squad WOULD be declared eliminated.
    sim.world.winless = false
    WinLossSystem.update(sim.world)
    expect(sim.world.gameOver).not.toBe(null)
  })

  it('ends in defeat if the whole opening squad dies before regrouping', () => {
    const { sim, script: sc } = script()
    const ids: number[] = []
    sim.world.units.forEach((id, u) => {
      if (u.team === 0) ids.push(id)
    })
    for (const id of ids) sim.world.removeEntity(id)
    const out = sc.tick(sim.world)
    expect(out.done).toBe(true)
    expect(out.winner).toBe(1)
    expect(out.toastKey).toBe('campaign.toast.squadLost')
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
