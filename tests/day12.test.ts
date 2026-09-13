import { describe, expect, it } from 'vitest'
import { createEmptyMap, SHIELD_MAX_HP, WEAPON_UPGRADE_MAX_LEVEL, type MatchSettings } from '@space-arenas/shared'
import { Simulator } from '../client/src/core/Simulator.ts'
import { hashWorld } from '../client/src/core/hash.ts'
import { spawnBuilding, spawnUnit } from '../client/src/entities/factories.ts'
import { fire } from '../client/src/systems/combat-system.ts'

const MAP = createEmptyMap(64, 64)
const SEED = 0xabcdef

const makeSim = (settings?: Partial<MatchSettings>): Simulator => new Simulator(MAP, SEED, [0, 1], settings)

describe('Day 12.1: Defense Dome', () => {
  it('keeps the shield at 0 until researched, then regenerates it each tick while powered', () => {
    const sim = makeSim()
    const { world } = sim
    const cc = spawnBuilding(world, 'command-center', 0, 10, 10, true)

    sim.advance(10)
    expect(world.buildings.require(cc).shieldHp).toBe(0)

    world.teamState(0).defenseDome = true
    sim.advance(100)
    expect(world.buildings.require(cc).shieldHp).toBe(100)
    sim.advance(100)
    expect(world.buildings.require(cc).shieldHp).toBe(SHIELD_MAX_HP)
  })

  it('counts a shield as 1 power of drain and reports it through powerUse', () => {
    const sim = makeSim()
    const { world } = sim
    spawnBuilding(world, 'command-center', 0, 10, 10, true)
    world.teamState(0).defenseDome = true
    sim.advance(10)

    expect(world.teamState(0).powerUse).toBe(1)
    expect(world.teamState(0).powerNet).toBe(9)
  })

  it('absorbs damage before hull HP and emits shield-hit', () => {
    const sim = makeSim()
    const { world } = sim
    const cc = spawnBuilding(world, 'command-center', 0, 10, 10, true)
    const enemy = spawnUnit(world, 'rifleman', 1, 4000, 10500)
    world.teamState(0).defenseDome = true
    world.buildings.require(cc).shieldHp = SHIELD_MAX_HP
    sim.advance(1)
    sim.drainEvents()
    const hpBefore = world.healths.require(cc).hp

    fire(world, enemy, cc, 10500, 10500, 12, 0)
    const events = sim.drainEvents()

    expect(events.some((e) => e.type === 'shield-hit' && e.target === cc && e.damage === 12)).toBe(true)
    expect(world.buildings.require(cc).shieldHp).toBe(SHIELD_MAX_HP - 12)
    expect(world.healths.require(cc).hp).toBe(hpBefore)
  })

  it('lets overflow damage through to the hull once the shield is gone', () => {
    const sim = makeSim()
    const { world } = sim
    const cc = spawnBuilding(world, 'command-center', 0, 10, 10, true)
    const enemy = spawnUnit(world, 'rifleman', 1, 4000, 10500)
    world.teamState(0).defenseDome = true
    world.buildings.require(cc).shieldHp = 5
    const hpBefore = world.healths.require(cc).hp

    fire(world, enemy, cc, 10500, 10500, 12, 0)
    sim.drainEvents()

    expect(world.buildings.require(cc).shieldHp).toBe(0)
    expect(world.healths.require(cc).hp).toBe(hpBefore - 7)
  })

  it('shields only the Command Center — other buildings never gain a dome', () => {
    const sim = makeSim()
    const { world } = sim
    const cc = spawnBuilding(world, 'command-center', 0, 10, 10, true)
    const barracks = spawnBuilding(world, 'barracks', 0, 14, 14, true)
    world.teamState(0).defenseDome = true
    world.buildings.require(barracks).shieldHp = 50
    sim.advance(250)

    // Only the CC carries a dome: the barracks' manually set shield is cleared
    // every tick and never regenerates, while the CC dome regenerates to full.
    expect(world.teamState(0).powerDown).toBe(false)
    expect(world.buildings.require(cc).shieldHp).toBe(SHIELD_MAX_HP)
    expect(world.buildings.require(barracks).shieldHp).toBe(0)
  })
})

describe('Day 12.2: Bunker garrison', () => {
  // A powered garrison: the bunker consumes 5 power, so it only behaves like a
  // turret when the team has a Command Center (otherwise it powers down).
  const poweredBunker = (sim: Simulator): number => {
    spawnBuilding(sim.world, 'command-center', 0, 4, 4, true)
    return spawnBuilding(sim.world, 'bunker', 0, 10, 10, true)
  }

  it('offers 5 garrison slots to infantry', () => {
    const sim = makeSim()
    const { world } = sim
    const bunker = spawnBuilding(world, 'bunker', 0, 10, 10, true)
    expect(world.transportCapacityOf(bunker)).toBe(5)
  })

  it('does not fire while empty', () => {
    const sim = makeSim()
    const { world } = sim
    const bunker = poweredBunker(sim)
    const enemy = spawnUnit(world, 'rifleman', 1, 17200, 11000)
    world.attacks.require(bunker).target = enemy
    const hpBefore = world.healths.require(enemy).hp

    sim.advance(20)

    expect(world.healths.require(enemy).hp).toBe(hpBefore)
  })

  it('fires once occupied and damages the target', () => {
    const sim = makeSim()
    const { world } = sim
    const bunker = poweredBunker(sim)
    const enemy = spawnUnit(world, 'rifleman', 1, 17200, 11000)
    world.transports.require(bunker).passengers.push({
      unitType: 'rifleman',
      hp: 200,
      maxHp: 200,
      killCount: 0,
      veteranRank: 0,
      stealth: false,
      abilityCooldown: 0,
    })
    world.attacks.require(bunker).target = enemy
    const hpBefore = world.healths.require(enemy).hp

    sim.advance(2)

    expect(world.healths.require(enemy).hp).toBeLessThan(hpBefore)
  })

  it('rejects more infantry once the garrison is full', () => {
    const sim = makeSim()
    const { world } = sim
    const bunker = poweredBunker(sim)
    const squad = Array.from({ length: 6 }, (_, i) => spawnUnit(world, 'rifleman', 0, 9400 + i * 40, 10500))

    sim.step([sim.makeCommand(0, { type: 'transport-load', entities: squad, x: 0, y: 0, transportId: bunker })])
    const events = sim.drainEvents()

    // The command reserves the five slots; the sixth is rejected.
    const tc = world.transports.require(bunker)
    expect(tc.loadQueue.length + tc.passengers.length).toBe(5)
    expect(events.some((e) => e.type === 'command-rejected' && e.reason === 'transport is full')).toBe(true)
  })

  it('boards infantry and discharges them again', () => {
    const sim = makeSim()
    const { world } = sim
    const bunker = poweredBunker(sim)
    const squad = Array.from({ length: 5 }, (_, i) => spawnUnit(world, 'rifleman', 0, 9400 + i * 40, 10500))

    sim.step([sim.makeCommand(0, { type: 'transport-load', entities: squad, x: 0, y: 0, transportId: bunker })])
    sim.advance(15)
    expect(world.transports.require(bunker).passengers.length).toBe(5)
    expect(world.units.size).toBe(0) // every boarded infantry has left the world

    sim.step([sim.makeCommand(0, { type: 'transport-unload', entities: [], x: 30000, y: 15000, transportId: bunker })])
    sim.advance(20)

    expect(world.transports.require(bunker).passengers.length).toBe(0)
    expect(world.units.size).toBe(5)
  })

  it('garrison determinism: identical sims stay in lockstep', () => {
    const mk = () => {
      const sim = makeSim()
      const bunker = poweredBunker(sim)
      const riders = Array.from({ length: 5 }, (_, i) => spawnUnit(sim.world, 'rifleman', 0, 9400 + i * 40, 10500))
      spawnUnit(sim.world, 'rifleman', 1, 17200, 11000)
      sim.step([sim.makeCommand(0, { type: 'transport-load', entities: riders, x: 0, y: 0, transportId: bunker })])
      return sim
    }
    const a = mk()
    const b = mk()
    a.advance(30)
    b.advance(30)
    expect(hashWorld(a.world)).toBe(hashWorld(b.world))
  })
})

describe('Day 12.3: Weapon Upgrade (rank-5 only)', () => {
  const setupShooter = (rank: number, upgradeLevel: number): { sim: Simulator; shooter: number; target: number } => {
    const sim = makeSim()
    const { world } = sim
    const shooter = spawnUnit(world, 'rifleman', 0, 5000, 5000)
    const target = spawnUnit(world, 'rifleman', 1, 11000, 5000)
    world.units.require(shooter).veteranRank = rank
    world.teamState(0).weaponUpgradeLevel = upgradeLevel
    return { sim, shooter, target }
  }

  const hpLossOfFirstShot = (rank: number, upgradeLevel: number): number => {
    const { sim, shooter, target } = setupShooter(rank, upgradeLevel)
    const before = sim.world.healths.require(target).hp
    sim.step([sim.makeCommand(0, { type: 'attack', entities: [shooter], x: 11000, y: 5000, target })])
    return before - sim.world.healths.require(target).hp
  }

  it('boosts rank-5 units by 25% per level', () => {
    const baseDamage = 12 * (1 + 0.25 * 5)
    expect(hpLossOfFirstShot(5, 0)).toBeCloseTo(baseDamage, 5)
    expect(hpLossOfFirstShot(5, 1)).toBeCloseTo(baseDamage * (1 + 0.25), 5)
    expect(hpLossOfFirstShot(5, 2)).toBeCloseTo(baseDamage * (1 + 0.5), 4)
  })

  it('does not boost units below rank 5, whatever the research level', () => {
    const baseDamage = 12 * (1 + 0.25 * 4)
    expect(hpLossOfFirstShot(4, 1)).toBeCloseTo(baseDamage, 5)
    expect(hpLossOfFirstShot(4, 3)).toBeCloseTo(baseDamage, 5)
    expect(hpLossOfFirstShot(0, 3)).toBeCloseTo(12, 5)
  })

  it('leaves a rank-5 upgrade-free shot equal to an upgrade-free rank-5 shot', () => {
    const noTech = hpLossOfFirstShot(5, 0)
    const withTech = hpLossOfFirstShot(5, 1)
    expect(withTech).toBeGreaterThan(noTech)
  })
})

describe('Day 12: research plumbing', () => {
  it('researching the defense-dome flags the team and rejects a second one', () => {
    const sim = makeSim()
    const { world } = sim
    const tech = spawnBuilding(world, 'tech-center', 0, 12, 12, true)
    world.teamState(0).rank = 2 // ★2 gates the defense-dome

    sim.step([sim.makeCommand(0, { type: 'research', entities: [tech], upgrade: 'defense-dome' })])
    expect(world.teamState(0).credits).toBe(800 - 500)
    expect(sim.drainEvents().some((e) => e.type === 'research-started')).toBe(true)

    sim.advance(510)
    expect(world.teamState(0).defenseDome).toBe(true)
    expect(sim.drainEvents().some((e) => e.type === 'upgrade-completed' && e.upgrade === 'defense-dome')).toBe(true)

    sim.step([sim.makeCommand(0, { type: 'research', entities: [tech], upgrade: 'defense-dome' })])
    expect(sim.drainEvents().some((e) => e.type === 'command-rejected' && e.reason === 'defense dome already researched')).toBe(true)
  })

  it('weapon-upgrade research levels up, escalates its cost, and caps at the max level', () => {
    const sim = makeSim()
    const { world } = sim
    const tech = spawnBuilding(world, 'tech-center', 0, 12, 12, true)
    world.teamState(0).rank = 2 // ★2 gates the weapon upgrade

    sim.step([sim.makeCommand(0, { type: 'research', entities: [tech], upgrade: 'weapon-upgrade' })])
    sim.advance(510)
    expect(world.teamState(0).weaponUpgradeLevel).toBe(1)

    // Each further level costs base x (level + 1): 800 then 1200.
    for (let lv = 2; lv <= WEAPON_UPGRADE_MAX_LEVEL; lv++) {
      world.teamState(0).credits += 5000
      const before = world.teamState(0).credits
      sim.step([sim.makeCommand(0, { type: 'research', entities: [tech], upgrade: 'weapon-upgrade' })])
      expect(world.teamState(0).credits).toBe(before - 400 * lv)
      sim.advance(510)
      expect(world.teamState(0).weaponUpgradeLevel).toBe(lv)
    }

    world.teamState(0).credits += 10000
    sim.step([sim.makeCommand(0, { type: 'research', entities: [tech], upgrade: 'weapon-upgrade' })])
    expect(sim.drainEvents().some((e) => e.type === 'command-rejected' && e.reason === 'weapon upgrade maxed')).toBe(true)
    expect(world.teamState(0).weaponUpgradeLevel).toBe(WEAPON_UPGRADE_MAX_LEVEL)
  })
})

describe('Day 12: determinism', () => {
  it('dome + weapon research state is covered by the world hash', () => {
    const mk = (researchDome: boolean, weaponLv: number) => {
      const sim = makeSim()
      sim.world.teamState(0).defenseDome = researchDome
      sim.world.teamState(0).weaponUpgradeLevel = weaponLv
      spawnBuilding(sim.world, 'command-center', 0, 10, 10, true)
      sim.advance(50)
      return sim
    }
    const a = mk(true, 2)
    const b = mk(true, 2)
    const c = mk(false, 0)
    expect(hashWorld(a.world)).toBe(hashWorld(b.world))
    expect(hashWorld(a.world)).not.toBe(hashWorld(c.world))
  })
})