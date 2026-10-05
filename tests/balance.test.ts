import { describe, expect, it } from 'vitest'
import { BUILDINGS, UNITS, WEAPONS, validateBalance, SECONDS_TO_TICKS } from '@space-arenas/shared'

describe('balance: integrity', () => {
  it('has no validation errors', () => {
    expect(validateBalance()).toEqual([])
  })

  it('every unit producer exists as a building', () => {
    for (const u of Object.values(UNITS)) {
      expect(BUILDINGS[u.producedBy], `unit ${u.id}`).toBeDefined()
    }
  })

  it('every weapon reference resolves', () => {
    for (const b of Object.values(BUILDINGS)) {
      if (b.weapon) expect(WEAPONS[b.weapon], `building ${b.id}`).toBeDefined()
    }
    for (const u of Object.values(UNITS)) {
      if (u.weapon) expect(WEAPONS[u.weapon], `unit ${u.id}`).toBeDefined()
    }
  })

  it('has sane cost / time numbers', () => {
    for (const u of Object.values(UNITS)) {
      expect(u.cost).toBeGreaterThanOrEqual(0)
      if (u.cost > 0) expect(u.buildTimeTicks).toBeGreaterThan(0)
      expect(u.hp).toBeGreaterThan(0)
      expect(u.speed).toBeGreaterThan(0)
    }
    for (const b of Object.values(BUILDINGS)) {
      expect(b.cost).toBeGreaterThanOrEqual(0)
      expect(b.hp).toBeGreaterThan(0)
      expect(b.footprint[0]).toBeGreaterThan(0)
      expect(b.footprint[1]).toBeGreaterThan(0)
    }
  })

  it('harvester is free and takes time to spawn', () => {
    const h = UNITS.harvester
    expect(h.cost).toBe(0)
    expect(h.buildTimeTicks).toBeGreaterThan(0)
    expect(h.isHarvester).toBe(true)
  })

  it('only the command center and super weapon have a count limit', () => {
    for (const b of Object.values(BUILDINGS)) {
      if (b.id === 'command-center' || b.id === 'super-weapon') expect(b.countLimit).toBe(1)
      else expect(b.countLimit).toBeUndefined()
    }
  })

  it('command center provides base power and can be rebuilt', () => {
    const cc = BUILDINGS['command-center']
    expect(cc.cost).toBeGreaterThan(0)
    expect(cc.powerGen).toBe(10)
    expect(cc.powerUse).toBe(0)
  })

  it('command center produces bulldozers, supply dock produces harvesters', () => {
    expect(BUILDINGS['command-center'].producesUnit).toBe('bulldozer')
    expect(BUILDINGS['supply-dock'].producesUnit).toBe('harvester')
  })
})

describe('balance: weapons', () => {
  it('all weapons have sane stats', () => {
    for (const w of Object.values(WEAPONS)) {
      expect(w.damage).toBeGreaterThan(0)
      expect(w.cooldownTicks).toBeGreaterThan(0)
      expect(w.range).toBeGreaterThan(0)
    }
  })

  it('artillery has splash, others do not', () => {
    expect(WEAPONS.artillery.splash).toBeGreaterThan(0)
    expect(WEAPONS.rifle.splash).toBeUndefined()
  })
})

describe('balance: timing', () => {
  it('converts seconds to ticks at 25 hz', () => {
    expect(SECONDS_TO_TICKS(1)).toBe(25)
    expect(SECONDS_TO_TICKS(10)).toBe(250)
    expect(SECONDS_TO_TICKS(0)).toBe(0)
  })
})
