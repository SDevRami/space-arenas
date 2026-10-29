import type { World } from '../core/world.ts'

export interface CryptoMinerSupport {
  powered: boolean
  dock: boolean
  boats: number
  carriers: number
}

/** Team-wide support state used by both the income system and the HUD. */
export const cryptoMinerSupportFor = (world: World, team: number): CryptoMinerSupport => {
  let dock = false
  let boats = 0
  let carriers = 0
  world.buildings.forEach((id, b) => {
    if (b.team === team && b.buildingType === 'dock' && b.done && world.isAlive(id)) dock = true
  })
  world.units.forEach((id, u) => {
    if (u.team !== team || !world.isAlive(id)) return
    if (u.unitType === 'missile-boat') boats++
    else if (u.unitType === 'carrier') carriers++
  })
  return { powered: !world.teams.get(team)?.powerDown, dock, boats, carriers }
}

/** Naval Crypto Miner: interval income that only runs while the owning team is
 *  powered, has a completed Dock and keeps the required navy alive. All of the
 *  numbers come from MatchSettings so the host/dev panel can tune them. */
export const CryptoMinerSystem = {
  name: 'CryptoMiner',
  update(world: World): void {
    const interval = Math.max(1, world.settings.cryptoMinerIncomeIntervalTicks)
    const requiredBoats = Math.max(0, Math.floor(world.settings.cryptoMinerMissileBoats))
    const requiredCarriers = Math.max(0, Math.floor(world.settings.cryptoMinerCarriers))
    const income = Math.max(0, Math.floor(world.settings.cryptoMinerIncome))
    const support = new Map<number, CryptoMinerSupport>()

    world.buildings.forEach((id, b) => {
      if (b.buildingType !== 'crypto-miner') return
      // Construction pads, selling and dead buildings never mine.
      if (!b.done || !world.isAlive(id) || b.sellingUntil > world.tick) {
        b.cryptoIncomeTicks = 0
        return
      }
      let s = support.get(b.team)
      if (!s) {
        s = cryptoMinerSupportFor(world, b.team)
        support.set(b.team, s)
      }
      const supplied =
        s.powered &&
        s.dock &&
        s.boats >= requiredBoats &&
        s.carriers >= requiredCarriers
      if (!supplied) {
        // No banked income: the timer restarts once the miner is operational again.
        b.cryptoIncomeTicks = 0
        return
      }
      b.cryptoIncomeTicks++
      if (b.cryptoIncomeTicks < interval) return
      b.cryptoIncomeTicks = 0
      if (income <= 0) return
      world.grantCredits(b.team, income)
      world.emit({ type: 'crypto-miner-income', entity: id, team: b.team, amount: income })
    })
  },
}
