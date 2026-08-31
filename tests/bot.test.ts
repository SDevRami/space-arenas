import { describe, expect, it } from 'vitest'
import { generateDefaultMap, type SimEvent } from '@space-arenas/shared'
import { Simulator } from '../client/src/core/Simulator.ts'
import { BotPlayer, BOT_CONFIGS } from '../client/src/ai/bot.ts'

const MAP = generateDefaultMap()

const run = (seed: number, ticks: number, difficulty: 'easy' | 'medium' | 'hard' = 'hard', drain?: (e: SimEvent) => void): Simulator => {
  const sim = new Simulator(MAP, seed, [0, 1])
  const bots = [new BotPlayer(sim, 0, difficulty), new BotPlayer(sim, 1, difficulty)]
  for (let t = 0; t < ticks; t++) {
    const cmds = bots.flatMap((b) => b.tick())
    sim.step(cmds)
    if (drain) {
      for (const e of sim.world.drainEvents()) drain(e)
    }
  }
  return sim
}

const unitCount = (sim: Simulator, team: number, type: string): number => {
  let n = 0
  sim.world.units.forEach((_id, u) => {
    if (u.team === team && u.unitType === type) n++
  })
  return n
}

const doneBuildings = (sim: Simulator, team: number): string[] => {
  const out: string[] = []
  sim.world.buildings.forEach((_id, b) => {
    if (b.team === team && b.done) out.push(b.buildingType)
  })
  return out
}

const enemyHurtBuildings = (sim: Simulator, team: number): number => {
  let n = 0
  sim.world.buildings.forEach((id, b) => {
    if (b.team === team) return
    const h = sim.world.healths.get(id)
    if (h && h.hp < h.maxHp) n++
  })
  return n
}

describe('bot determinism', () => {
  it('two runs with the same seed stay in lockstep', () => {
    const a = run(0xbeef, 600)
    const b = run(0xbeef, 600)
    expect(a.world.lastHash).toBe(b.world.lastHash)
    expect(a.tick).toBe(b.tick)
  })

  it('different seeds diverge', () => {
    const a = run(0xbeef, 400)
    const b = run(0xbeef ^ 0x1234, 400)
    expect(a.world.lastHash).not.toBe(b.world.lastHash)
  })

  it('issues commands stamped for the current tick', () => {
    const sim = new Simulator(MAP, 0xbeef, [0, 1])
    const bot = new BotPlayer(sim, 0, 'easy')
    const cmds = bot.tick()
    for (const c of cmds) expect(c.tick).toBe(sim.tick)
    sim.step(cmds)
    expect(sim.tick).toBe(1)
  })
})

describe('bot behaviour', () => {
  it('builds an economy over time', () => {
    const sim = run(0xbeef, 1600)
    let buildings = 0
    sim.world.buildings.forEach(() => {
      buildings++
    })
    expect(buildings).toBeGreaterThan(2)
    expect(sim.world.teamState(0).powerGen).toBeGreaterThanOrEqual(10)
  })

  it('all difficulties can play a full match without throwing', () => {
    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      const sim = run(0xdead, 300, difficulty)
      expect(sim.tick).toBe(300)
    }
  })
})

describe('bot economy', () => {
  it('supply dock is the first non-power building completed', () => {
    const order: string[] = []
    run(0xbeef, 1600, 'hard', (e) => {
      if (e.type === 'building-completed' && e.team === 0) order.push(e.buildingType)
    })
    expect(order.length).toBeGreaterThanOrEqual(1)
    expect(order[0]).toBe('supply-dock')
  })

  it('builds power and a barracks, keeping harvesters near the cap', () => {
    const sim = run(0xbeef, 3000, 'hard')
    const done = doneBuildings(sim, 0)
    expect(done).toContain('power-plant')
    expect(done).toContain('barracks')
    const harvesters = unitCount(sim, 0, 'harvester')
    expect(harvesters).toBeGreaterThan(0)
    expect(harvesters).toBeLessThanOrEqual(BOT_CONFIGS.hard.harvesterCap + 2)
  })

  it('keeps training an army over time without soft-locking', () => {
    const early = run(0xbeef, 2800, 'hard')
    const late = run(0xbeef, 4200, 'hard')
    expect(unitCount(late, 0, 'rifleman')).toBeGreaterThan(unitCount(early, 0, 'rifleman'))
    expect(early.world.teamState(0).credits).toBeGreaterThanOrEqual(0)
    expect(late.world.teamState(0).credits).toBeGreaterThanOrEqual(0)
  })
})

describe('bot combat', () => {
  it('hard bot builds an army that crosses the map and damages the enemy', () => {
    let team0Hits = 0
    let enemyBuildingsDestroyed = 0
    const sim = run(0xbeef, 5200, 'hard', (e) => {
      if (e.type === 'combat-hit' && e.team === 0) team0Hits++
      // an enemy building destroyed by combat counts toward threatening their base
      if (e.type === 'entity-destroyed' && e.kind === 'building' && e.team !== 0) enemyBuildingsDestroyed++
    })
    expect(unitCount(sim, 0, 'rifleman')).toBeGreaterThan(3)
    expect(team0Hits).toBeGreaterThan(20)
    expect(enemyBuildingsDestroyed + enemyHurtBuildings(sim, 0)).toBeGreaterThan(0)
  })
})

describe('bot difficulty', () => {
  it('economy size scales with difficulty', () => {
    const easy = run(0xbeef, 3400, 'easy')
    const medium = run(0xbeef, 3400, 'medium')
    const hard = run(0xbeef, 3400, 'hard')
    const harvesters = (sim: Simulator): number => unitCount(sim, 0, 'harvester')
    expect(harvesters(hard)).toBeGreaterThan(harvesters(medium))
    expect(harvesters(medium)).toBeGreaterThan(harvesters(easy))
    expect(doneBuildings(hard, 0).length).toBeGreaterThan(doneBuildings(easy, 0).length)
  })

  it('hard is more threatening than easy', () => {
    const damage = (difficulty: 'easy' | 'medium' | 'hard'): number => {
      let hits = 0
      const sim = new Simulator(MAP, 0xbeef, [0, 1])
      const bots = [new BotPlayer(sim, 0, difficulty), new BotPlayer(sim, 1, difficulty)]
      for (let t = 0; t < 5200; t++) {
        const cmds = bots.flatMap((b) => b.tick())
        sim.step(cmds)
        for (const e of sim.world.drainEvents()) {
          if (e.type === 'combat-hit' && e.team === 0) hits++
        }
      }
      return hits
    }
    expect(damage('hard')).toBeGreaterThan(damage('easy'))
  })
})
