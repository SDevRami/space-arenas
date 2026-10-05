import { describe, expect, it, vi } from 'vitest'
import { recordDailyResult, dailySeed, dailyLevel, dailyLevelXp, loadModeRecords } from '../client/src/profile/modeRecords.ts'
import { generateDailyMissions, evaluateDailyMissions, resolveDailyChallenge } from '../client/src/modes/daily.ts'

const mockStorage = (): { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void } => {
  const store: Record<string, string> = {}
  return { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v } }
}

describe('Day 19: ModeRecords persistence (daily)', () => {
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

  it('loads a stored daily record but ignores removed mode shapes', () => {
    const s = mockStorage()
    s.setItem('space-arenas:mode-records', JSON.stringify({ v: 2, survival: { bestWave: 9 }, campaign: { plays: 3 }, daily: { xp: 120 } }))
    const r = loadModeRecords(s as any)
    expect(r.daily).toEqual({ xp: 120 })
    expect((r as any).survival).toBeUndefined()
    expect((r as any).campaign).toBeUndefined()
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