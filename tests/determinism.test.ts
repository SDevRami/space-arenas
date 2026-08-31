import { describe, expect, it } from 'vitest'
import { RNG, generateMap, generateDefaultMap, type CommandType, type EnvelopeCommand, type SimCommand } from '@space-arenas/shared'
import { Simulator } from '../client/src/core/Simulator.ts'

const MAP = generateDefaultMap()
const SEED = 0x5eedcafe

const TYPES: CommandType[] = ['move', 'stop', 'attack-move', 'place', 'queue', 'attack', 'sell', 'dequeue', 'research', 'build', 'set-spawn-point', 'assign-dock', 'satellite', 'laser', 'forfeit']

function nextCommands(rng: RNG, tick: number, players: number[]): EnvelopeCommand[] {
  const n = rng.nextInt(0, 4)
  const out: EnvelopeCommand[] = []
  for (let i = 0; i < n; i++) {
    const player = players[rng.nextInt(0, players.length)]
    const type = TYPES[rng.nextInt(0, TYPES.length)]
    const entities = [rng.nextInt(1, 60), rng.nextInt(1, 60)]
    let cmd: SimCommand
    if (type === 'place') {
      cmd = {
        type,
        entities: [],
        x: rng.nextInt(6, 120),
        y: rng.nextInt(6, 120),
        buildingType: rng.nextInt(0, 2) === 0 ? 'power-plant' : 'barracks',
      }
    } else if (type === 'queue') {
      cmd = { type, entities, x: 0, y: 0, unitType: 'rifleman' }
    } else if (type === 'attack') {
      cmd = { type, entities, x: 0, y: 0, target: rng.nextInt(1, 60) }
    } else if (type === 'dequeue') {
      cmd = { type, entities, x: 0, y: 0, index: rng.nextInt(0, 2) }
    } else if (type === 'research') {
      cmd = { type, entities, x: 0, y: 0, upgrade: 'radar' }
    } else if (type === 'build') {
      cmd = { type, entities, x: 0, y: 0, target: rng.nextInt(1, 60) }
    } else if (type === 'assign-dock') {
      cmd = { type, entities, x: 0, y: 0, target: rng.nextInt(1, 60) }
    } else if (type === 'set-spawn-point') {
      cmd = { type, entities, x: rng.nextInt(0, 128), y: rng.nextInt(0, 128) }
    } else {
      cmd = { type, entities, x: rng.nextInt(0, 128000), y: rng.nextInt(0, 128000) }
    }
    out.push({ player, seq: i + 1, tick, cmd })
  }
  return out
}

const runSim = (seed: number, ticks: number, recordHashes: number[]): Simulator => {
  const sim = new Simulator(MAP, seed, [0, 1])
  sim.world.onSyncTick = (hash) => recordHashes.push(hash)
  const rng = new RNG(0xabcdef)
  for (let t = 0; t < ticks; t++) {
    const cmds = nextCommands(rng, sim.tick, [0, 1])
    sim.step(cmds)
  }
  return sim
}

describe('determinism: identical inputs -> identical state', () => {
  it('two simulators with the same seed and commands stay in lockstep (400 ticks)', () => {
    const a = new Simulator(MAP, SEED, [0, 1])
    const b = new Simulator(MAP, SEED, [0, 1])
    const rng = new RNG(0xabcdef)
    for (let t = 0; t < 400; t++) {
      const cmds = nextCommands(rng, a.tick, [0, 1])
      a.step(cmds)
      b.step(cmds)
      expect(b.tick).toBe(a.tick)
      if (a.tick % 60 === 0) {
        expect(b.world.lastHash).toBe(a.world.lastHash)
      }
    }
    expect(a.world.lastHash).toBe(b.world.lastHash)
  })

  it('matches hashes across separate runs with identical command streams (1500 ticks)', () => {
    const hashesA: number[] = []
    const hashesB: number[] = []
    const a = runSim(SEED, 1500, hashesA)
    const b = runSim(SEED, 1500, hashesB)
    expect(hashesA).toHaveLength(25)
    expect(hashesB).toEqual(hashesA)
    expect(a.world.lastHash).toBe(b.world.lastHash)
    expect(a.tick).toBe(b.tick)
  })

  it('produces identical hashes with no commands at all', () => {
    const a = new Simulator(MAP, SEED, [0, 1])
    const b = new Simulator(MAP, SEED, [0, 1])
    a.advance(300)
    b.advance(300)
    expect(a.world.lastHash).toBe(b.world.lastHash)
  })

  it('different seeds diverge', () => {
    const a = runSim(SEED, 200, [])
    const b = runSim(SEED ^ 0xff, 200, [])
    expect(a.world.lastHash).not.toBe(b.world.lastHash)
  })
})

describe('determinism: command flow', () => {
  it('commands only apply on their target tick', () => {
    const a = new Simulator(MAP, SEED, [0])
    const future: EnvelopeCommand = { player: 0, seq: 1, tick: a.tick + 5, cmd: { type: 'stop', entities: [1], x: 0, y: 0 } }
    a.step([future])
    expect(a.tick).toBe(1)
    a.advance(4)
    expect(a.tick).toBe(5)
    a.step([future])
    expect(a.tick).toBe(6)
  })

  it('rejected commands do not throw and are surfaced as events', () => {
    const sim = new Simulator(MAP, SEED, [0])
    const cmd: EnvelopeCommand = { player: 0, seq: 1, tick: sim.tick, cmd: { type: 'place', entities: [], x: 0, y: 0, buildingType: 'barracks' } }
    sim.step([cmd])
    const events = sim.drainEvents()
    expect(events.some((e) => e.type === 'command-rejected')).toBe(true)
  })
})

describe('determinism: forfeit keeps the match running in lockstep', () => {
  it('two simulators process a forfeit identically and stay in lockstep', () => {
    const map = generateMap(3, 'forfeit-test-seed')
    const a = new Simulator(map, SEED, [0, 1, 2])
    const b = new Simulator(map, SEED, [0, 1, 2])
    for (let t = 0; t < 300; t++) {
      const cmds: EnvelopeCommand[] = []
      if (a.tick === 100) {
        cmds.push({ player: 1, seq: 0x80000000, tick: a.tick, cmd: { type: 'forfeit', entities: [], x: 0, y: 0 } })
      }
      a.step(cmds)
      b.step(cmds)
      if (a.tick > 100) {
        let team1Units = 0
        let team1Buildings = 0
        a.world.units.forEach((_id, u) => {
          if (u.team === 1) team1Units++
        })
        a.world.buildings.forEach((_id, bld) => {
          if (bld.team === 1) team1Buildings++
        })
        expect(team1Units).toBe(0)
        expect(team1Buildings).toBe(0)
        expect(a.world.gameOver).toBeNull()
      }
      expect(b.tick).toBe(a.tick)
    }
    expect(a.world.lastHash).toBe(b.world.lastHash)
    expect(a.world.gameOver).toBeNull()
  })
})
