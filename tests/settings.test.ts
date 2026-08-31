import { describe, expect, it } from 'vitest'
import {
  generateDefaultMap,
  DEFAULT_CREDITS,
  DEFAULT_QUEUE_LIMIT,
  DEFAULT_SELL_REFUND_FRACTION,
  OIL_INCOME,
  getBuilding,
  getUnit,
  getUpgrade,
  getWeapon,
  mergeMatchSettings,
} from '@space-arenas/shared'
import { Simulator } from '../client/src/core/Simulator.ts'
import { spawnBuilding, spawnUnit } from '../client/src/entities/factories.ts'

const MAP = generateDefaultMap()
const SEED = 0x5eedcafe

describe('match settings', () => {
  it('applies a settings patch and keeps defaults otherwise', () => {
    const sim = new Simulator(MAP, SEED, [0], { startingCredits: 1500 })
    expect(sim.world.settings.startingCredits).toBe(1500)
    expect(sim.world.settings.oilIncome).toBe(OIL_INCOME)
    expect(sim.world.teams.get(0)?.credits).toBe(1500)
  })

  it('uses defaults when no patch is given', () => {
    const sim = new Simulator(MAP, SEED, [0])
    expect(sim.world.settings.startingCredits).toBe(DEFAULT_CREDITS)
    expect(sim.world.teams.get(0)?.credits).toBe(DEFAULT_CREDITS)
  })

  it('custom oil income fires with the patched amount', () => {
    const sim = new Simulator(MAP, SEED, [0], { oilIncome: 200, oilIncomeIntervalTicks: 25 })
    let fieldId = -1
    sim.world.oilFields.forEach((id) => {
      if (fieldId < 0) fieldId = id
    })
    const field = sim.world.oilFields.get(fieldId)!
    field.owner = 0
    field.incomeTicks = 24
    sim.step()
    const events = sim.drainEvents()
    const income = events.find((e) => e.type === 'oil-income')
    expect(income).toBeDefined()
    expect((income as { amount: number }).amount).toBe(200)
    expect(sim.world.teams.get(0)?.credits).toBe(DEFAULT_CREDITS + 200)
  })

  it('two simulators with the same settings stay in lockstep', () => {
    const settings = { oilIncome: 200, oilIncomeIntervalTicks: 25, supplyPerTrip: 90 }
    const a = new Simulator(MAP, SEED, [0, 1], settings)
    const b = new Simulator(MAP, SEED, [0, 1], settings)
    a.advance(300)
    b.advance(300)
    expect(a.world.lastHash).toBe(b.world.lastHash)
  })

  it('mergeMatchSettings deep-merges the override maps', () => {
    const merged = mergeMatchSettings({ buildingOverrides: { turret: { cost: 400 } } })
    expect(merged.buildingOverrides.turret?.cost).toBe(400)
    expect(merged.buildingOverrides['command-center']).toBeUndefined()
    expect(merged.unitOverrides).toEqual({})
    expect(merged.sellRefundFraction).toBe(DEFAULT_SELL_REFUND_FRACTION)
    expect(merged.queueLimit).toBe(DEFAULT_QUEUE_LIMIT)
  })

  it('spawned units and buildings use settings overrides', () => {
    const sim = new Simulator(MAP, SEED, [0], {
      unitOverrides: { scout: { hp: 500, speed: 120, cost: 999 } },
      buildingOverrides: { 'power-plant': { cost: 1111, hp: 2000, powerGen: 99 } },
      weaponOverrides: { rifle: { damage: 40, range: 8, cooldownTicks: 2 } },
    })
    const unitId = spawnUnit(sim.world, 'scout', 0, 1000, 1000)
    expect(sim.world.healths.require(unitId).hp).toBe(500)
    expect(sim.world.units.require(unitId).speed).toBe(120)
    expect(getUnit('scout', sim.world.settings).cost).toBe(999)

    const bId = spawnBuilding(sim.world, 'power-plant', 0, 10, 10, true)
    expect(sim.world.healths.require(bId).hp).toBe(2000)
    expect(sim.world.buildings.require(bId).powerGen).toBe(99)

    const rifleId = spawnUnit(sim.world, 'rifleman', 0, 2000, 2000)
    expect(sim.world.attacks.require(rifleId).cooldownTicks).toBe(2)
    expect(getWeapon('rifle', sim.world.settings).damage).toBe(40)
    expect(getWeapon('rifle').damage).toBe(12)
  })

  it('getters expose overrides and leave defaults untouched', () => {
    const sim = new Simulator(MAP, SEED, [0], {
      upgradeOverrides: { radar: { cost: 1, researchTimeTicks: 5 } },
    })
    const up = getUpgrade('radar', sim.world.settings)
    expect(up.cost).toBe(1)
    expect(up.researchTimeTicks).toBe(5)
    expect(getUpgrade('radar').cost).toBe(300)
    expect(getBuilding('turret', sim.world.settings).cost).toBe(150)
  })

  it('applies supply and oil field overrides at world init', () => {
    const sim = new Simulator(MAP, SEED, [0], { supplyFieldCapacity: 999, supplyFieldRadius: 3, oilFieldRadius: 4 })
    let supply: { radius: number; capacity: number; trips: number } | undefined
    sim.world.fields.forEach((_id, f) => {
      supply = f
    })
    expect(supply).toBeDefined()
    expect(supply!.capacity).toBe(999)
    expect(supply!.trips).toBe(999)
    expect(supply!.radius).toBe(3)
    let oil: { radius: number } | undefined
    sim.world.oilFields.forEach((_id, f) => {
      oil = f
    })
    expect(oil).toBeDefined()
    expect(oil!.radius).toBe(4)
  })

  it('two simulators with balance overrides stay in lockstep', () => {
    const settings = {
      startingCredits: 1000,
      unitOverrides: { rifleman: { hp: 350, speed: 70 } },
      buildingOverrides: { turret: { cost: 400 } },
      weaponOverrides: { rifle: { damage: 30, range: 7 } },
      upgradeOverrides: { radar: { cost: 250 } },
      queueLimit: 4,
      sellRefundFraction: 0.25,
      supplyFieldRadius: 2,
    }
    const a = new Simulator(MAP, SEED, [0, 1], settings)
    const b = new Simulator(MAP, SEED, [0, 1], settings)
    a.advance(400)
    b.advance(400)
    expect(a.world.lastHash).toBe(b.world.lastHash)
  })
})
