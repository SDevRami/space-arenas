import { describe, expect, it } from 'vitest'
import { createEmptyMap } from '@space-arenas/shared'
import { Simulator } from '../client/src/core/Simulator.ts'
import { spawnUnit } from '../client/src/entities/factories.ts'
import { fire, applyDamage } from '../client/src/systems/combat-system.ts'

const MAP = createEmptyMap(64, 64)
const SEED = 0xdeadbeef

const makeSim = (): Simulator => new Simulator(MAP, SEED, [0, 1])

describe('fire', () => {
  it('deals damage to target with non-splash weapon', () => {
    const { world } = makeSim()
    const attacker = spawnUnit(world, 'rifleman', 0, 10000, 10000)
    const target = spawnUnit(world, 'rifleman', 1, 10500, 10000)
    const hpBefore = world.healths.require(target).hp

    fire(world, attacker, target, 10500, 10000, 12, undefined, false)

    expect(world.healths.require(target).hp).toBe(hpBefore - 12)
    expect(world.isAlive(target)).toBe(true)
  })

  it('does NOT damage air units when targetsAir=false', () => {
    const { world } = makeSim()
    const attacker = spawnUnit(world, 'rifleman', 0, 10000, 10000)
    const airTarget = spawnUnit(world, 'fighter', 1, 10500, 10000)
    const hpBefore = world.healths.require(airTarget).hp

    fire(world, attacker, airTarget, 10500, 10000, 12, undefined, false)

    expect(world.healths.require(airTarget).hp).toBe(hpBefore)
  })

  it('damages air units when targetsAir=true', () => {
    const { world } = makeSim()
    const attacker = spawnUnit(world, 'aa-platform', 0, 10000, 10000)
    const airTarget = spawnUnit(world, 'fighter', 1, 10500, 10000)
    const hpBefore = world.healths.require(airTarget).hp

    fire(world, attacker, airTarget, 10500, 10000, 18, undefined, true)

    expect(world.healths.require(airTarget).hp).toBe(hpBefore - 18)
  })

  it('splashDamage hits units within splash range', () => {
    const { world } = makeSim()
    const attacker = spawnUnit(world, 'artillery', 0, 10000, 10000)
    const target1 = spawnUnit(world, 'rifleman', 1, 10500, 10000)
    const target2 = spawnUnit(world, 'rifleman', 1, 11000, 10000)
    const hp1Before = world.healths.require(target1).hp
    const hp2Before = world.healths.require(target2).hp

    fire(world, attacker, target1, 10500, 10000, 60, 1.5, false)

    expect(world.healths.require(target1).hp).toBeLessThan(hp1Before)
    expect(world.healths.require(target2).hp).toBeLessThan(hp2Before)
  })

  it('splashDamage skips friendly units', () => {
    const { world } = makeSim()
    const attacker = spawnUnit(world, 'artillery', 0, 10000, 10000)
    const friendly = spawnUnit(world, 'rifleman', 0, 10500, 10000)
    const enemy = spawnUnit(world, 'rifleman', 1, 10500, 11000)
    const friendlyHpBefore = world.healths.require(friendly).hp
    const enemyHpBefore = world.healths.require(enemy).hp

    fire(world, attacker, enemy, 10500, 11000, 60, 1.5, false)

    expect(world.healths.require(friendly).hp).toBe(friendlyHpBefore)
    expect(world.healths.require(enemy).hp).toBeLessThan(enemyHpBefore)
  })
})

describe('applyDamage', () => {
  it('removes entity when HP <= 0', () => {
    const { world } = makeSim()
    const target = spawnUnit(world, 'rifleman', 1, 10000, 10000)
    const attacker = spawnUnit(world, 'rifleman', 0, 10000, 11000)

    expect(world.isAlive(target)).toBe(true)
    applyDamage(world, target, 9999, attacker)
    expect(world.isAlive(target)).toBe(false)
  })

  it('does not remove entity when HP > 0', () => {
    const { world } = makeSim()
    const target = spawnUnit(world, 'rifleman', 1, 10000, 10000)
    const attacker = spawnUnit(world, 'rifleman', 0, 10000, 11000)
    const hp = world.healths.require(target).hp

    applyDamage(world, target, hp - 1, attacker)

    expect(world.isAlive(target)).toBe(true)
    expect(world.healths.require(target).hp).toBe(1)
  })
})
