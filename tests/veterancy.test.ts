import { describe, expect, it } from 'vitest'
import { createEmptyMap, getWeapon, tileToFx } from '@space-arenas/shared'
import { Simulator } from '../client/src/core/Simulator.ts'
import { hashWorld } from '../client/src/core/hash.ts'
import { unitVeteranBonus, veteranRankForKills } from '../client/src/core/world.ts'
import { spawnUnit } from '../client/src/entities/factories.ts'
import { applyDamage, CombatSystem } from '../client/src/systems/combat-system.ts'
import { VisionSystem } from '../client/src/systems/vision-system.ts'

const MAP = createEmptyMap(64, 64)
const SEED = 0xc0ffee

const makeSim = (): Simulator => new Simulator(MAP, SEED, [0, 1])

/** Kills `count` fresh enemy riflemen with one big hit each. */
const makeKiller = (sim: Simulator, count: number): number => {
  const { world } = sim
  const killer = spawnUnit(world, 'rifleman', 0, 10000, 10000)
  for (let i = 0; i < count; i++) {
    const victim = spawnUnit(world, 'rifleman', 1, 12000 + i * 500, 10000)
    applyDamage(world, victim, 99999, killer)
  }
  return killer
}

describe('veterancy: kill credit and ranks', () => {
  it('counts kills and ranks up only at the configured thresholds', () => {
    const sim = makeSim()
    const killer = spawnUnit(sim.world, 'rifleman', 0, 10000, 10000)
    const victim = (i: number): number => spawnUnit(sim.world, 'rifleman', 1, 12000 + i * 500, 10000)

    applyDamage(sim.world, victim(0), 99999, killer)
    applyDamage(sim.world, victim(1), 99999, killer)
    const u = sim.world.units.require(killer)
    expect(u.killCount).toBe(2)
    expect(u.veteranRank).toBe(0)

    applyDamage(sim.world, victim(2), 99999, killer)
    expect(u.killCount).toBe(3)
    expect(u.veteranRank).toBe(1)
    expect(sim.drainEvents().some((e) => e.type === 'unit-ranked-up' && e.unit === killer && e.rank === 1)).toBe(true)

    applyDamage(sim.world, victim(3), 99999, killer)
    applyDamage(sim.world, victim(4), 99999, killer)
    applyDamage(sim.world, victim(5), 99999, killer)
    expect(u.killCount).toBe(6)
    expect(u.veteranRank).toBe(2)
  })

  it('never awards veterancy for building or friendly kills', () => {
    const sim = makeSim()
    const killer = spawnUnit(sim.world, 'rifleman', 0, 10000, 10000)
    const friendly = spawnUnit(sim.world, 'rifleman', 0, 12000, 10000)
    applyDamage(sim.world, friendly, 99999, killer)
    const u = sim.world.units.require(killer)
    expect(u.killCount).toBe(0)
    expect(u.veteranRank).toBe(0)
  })
})

describe('veterancy: stat bonuses', () => {
  it('unitVeteranBonus scales damage/range up and armor down with rank', () => {
    const { world } = makeSim()
    expect(unitVeteranBonus(world, 0)).toEqual({ damage: 1, range: 1, armor: 1 })
    expect(unitVeteranBonus(world, 1).damage).toBeCloseTo(1.25)
    expect(unitVeteranBonus(world, 1).range).toBeCloseTo(1.1)
    expect(unitVeteranBonus(world, 1).armor).toBeCloseTo(0.8)
    expect(unitVeteranBonus(world, 2).armor).toBeCloseTo(0.6)
  })

  it('veteranRankForKills caps at rank 2 and respects custom thresholds', () => {
    const { world } = makeSim()
    expect(veteranRankForKills(world, 0)).toBe(0)
    expect(veteranRankForKills(world, 2)).toBe(0)
    expect(veteranRankForKills(world, 3)).toBe(1)
    expect(veteranRankForKills(world, 5)).toBe(1)
    expect(veteranRankForKills(world, 6)).toBe(2)
    expect(veteranRankForKills(world, 500)).toBe(2)
  })

  it('armor reduces incoming damage for veteran targets', () => {
    const sim = makeSim()
    const attacker = spawnUnit(sim.world, 'rifleman', 0, 10000, 10000)
    const target = spawnUnit(sim.world, 'rifleman', 1, 10500, 10000)
    const u = sim.world.units.require(target)
    u.killCount = 3
    u.veteranRank = 1
    const hpBefore = sim.world.healths.require(target).hp

    applyDamage(sim.world, target, 10, attacker)

    expect(sim.world.healths.require(target).hp).toBe(hpBefore - 8)
  })

  it('range bonus lets veterans shoot further than new units', () => {
    const sim = makeSim()
    const rifle = getWeapon('rifle', sim.world.settings)
    const rangeFx = tileToFx(rifle.range)
    const far = rangeFx + 400 // out of stock range, inside rank-2 range (×1.2)

    const newcomer = spawnUnit(sim.world, 'rifleman', 0, 30000, 30000)
    const enemyNew = spawnUnit(sim.world, 'rifleman', 1, 30000 + far, 30000)
    const veteran = makeKiller(sim, 6)
    const enemyVet = spawnUnit(sim.world, 'rifleman', 1, 10000 + far, 10000)
    sim.drainEvents()
    VisionSystem.update(sim.world)

    CombatSystem.update(sim.world)
    CombatSystem.update(sim.world)

    expect(sim.world.attacks.get(newcomer)?.target).toBeNull()
    expect(sim.world.attacks.get(veteran)?.target).toBe(enemyVet)
    expect(sim.world.healths.require(enemyVet).hp).toBeLessThan(sim.world.healths.require(enemyVet).maxHp)
    expect(sim.world.healths.require(enemyNew).hp).toBe(sim.world.healths.require(enemyNew).maxHp)
  })

  it('damage bonus multiplies shot damage in combat', () => {
    const sim = makeSim()
    const rifle = getWeapon('rifle', sim.world.settings)

    const veteran = makeKiller(sim, 6)
    const enemyNearVet = spawnUnit(sim.world, 'rifleman', 1, 10400, 10000)
    const plain = spawnUnit(sim.world, 'rifleman', 0, 20000, 20000)
    const enemyPlain = spawnUnit(sim.world, 'rifleman', 1, 20400, 20000)
    sim.drainEvents()
    VisionSystem.update(sim.world)

    CombatSystem.update(sim.world)
    CombatSystem.update(sim.world)

    const hits = sim.drainEvents().filter((e) => e.type === 'combat-hit')
    const vetHit = hits.find((e) => e.attacker === veteran)
    const plainHit = hits.find((e) => e.attacker === plain)
    expect(vetHit?.type === 'combat-hit' ? (vetHit as { damage: number }).damage : 0).toBeCloseTo(
      rifle.damage * unitVeteranBonus(sim.world, 2).damage,
    )
    expect(plainHit?.type === 'combat-hit' ? (plainHit as { damage: number }).damage : 0).toBeCloseTo(rifle.damage)
    expect(sim.world.healths.require(enemyNearVet).hp).toBeLessThan(sim.world.healths.require(enemyNearVet).maxHp)
    expect(sim.world.healths.require(enemyPlain).hp).toBeLessThan(sim.world.healths.require(enemyPlain).maxHp)
  })
})

describe('veterancy: lockstep determinism', () => {
  it('the new fields are hashed: same kills → same hash, different kills → different hash', () => {
    const a = makeSim()
    const b = makeSim()
    makeKiller(a, 3)
    makeKiller(b, 2)

    expect(hashWorld(a.world)).not.toBe(hashWorld(b.world))

    const a2 = makeSim()
    makeKiller(a2, 3)
    expect(hashWorld(a2.world)).toBe(hashWorld(a.world))
  })

  it('two simulators running the same kills stay in lockstep', () => {
    const a = makeSim()
    const b = makeSim()
    const killerA = spawnUnit(a.world, 'rifleman', 0, 10000, 10000)
    const killerB = spawnUnit(b.world, 'rifleman', 0, 10000, 10000)
    for (let i = 0; i < 3; i++) {
      const va = spawnUnit(a.world, 'rifleman', 1, 12000 + i * 500, 10000)
      const vb = spawnUnit(b.world, 'rifleman', 1, 12000 + i * 500, 10000)
      applyDamage(a.world, va, 99999, killerA)
      applyDamage(b.world, vb, 99999, killerB)
    }
    expect(hashWorld(a.world)).toBe(hashWorld(b.world))
  })
})