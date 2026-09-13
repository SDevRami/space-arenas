import { SHIELD_MAX_HP, SHIELD_POWER_DRAIN_PER_TICK, SHIELD_REGEN_PER_TICK, WEAPON_UPGRADE_MAX_LEVEL, SCORE_RESEARCH, AIRSTRIKE_MAX_LEVEL, EMP_MAX_LEVEL } from '@space-arenas/shared'
import type { World } from '../core/world.ts'

export const PlacingSystem = {
  name: 'Placing',
  update(world: World): void {
    world.buildings.forEach((id, b) => {
      const head = b.researchQueue[0]
      if (!head || !b.done) return
      head.remainingTicks--
      if (head.remainingTicks > 0) return
      const upgradeType = head.upgrade
      b.researchQueue.shift()
      if (upgradeType === 'radar') {
        const s = world.teamState(b.team)
        s.radar = true
      }
      if (upgradeType === 'satellite') {
        const s = world.teamState(b.team)
        s.satellite = true
      }
      if (upgradeType === 'space-laser') {
        const s = world.teamState(b.team)
        s.laser = true
        s.laserLevel = (s.laserLevel ?? 0) + 1
        world.teams.get(b.team)!.laserLastUsed = world.tick
      }
      if (upgradeType === 'stealth-tech') {
        const s = world.teamState(b.team)
        s.stealthTech = true
        // research only unlocks the per-unit stealth purchase; individual
        // units are cloaked via the 'set-stealth' command (HUD button)
      }
      if (upgradeType === 'detector-upgrade') {
        const s = world.teamState(b.team)
        s.detectorUnlocked = true
      }
      if (upgradeType === 'mine-tech') {
        const s = world.teamState(b.team)
        s.mineTech = true
      }
      if (upgradeType === 'abilities-tech') {
        const s = world.teamState(b.team)
        s.abilitiesUnlocked = true
      }
      if (upgradeType === 'transport-capacity') {
        const s = world.teamState(b.team)
        s.transportCapacityLevel = (s.transportCapacityLevel ?? 0) + 1
      }
      if (upgradeType === 'defense-dome') {
        const s = world.teamState(b.team)
        s.defenseDome = true
      }
      if (upgradeType === 'weapon-upgrade') {
        const s = world.teamState(b.team)
        s.weaponUpgradeLevel = Math.min(WEAPON_UPGRADE_MAX_LEVEL, (s.weaponUpgradeLevel ?? 0) + 1)
      }
      if (upgradeType === 'airstrike-level') {
        const s = world.teamState(b.team)
        s.airstrikeLevel = Math.min(AIRSTRIKE_MAX_LEVEL, (s.airstrikeLevel ?? 0) + 1)
      }
      if (upgradeType === 'emp-level') {
        const s = world.teamState(b.team)
        s.empLevel = Math.min(EMP_MAX_LEVEL, (s.empLevel ?? 0) + 1)
      }
      world.awardScore(b.team, SCORE_RESEARCH)
      world.emit({ type: 'upgrade-completed', building: id, upgrade: upgradeType, team: b.team })
    })

    world.buildings.forEach((id, b) => {
      if (b.maxPowerHpTarget >= 0) {
        const h = world.healths.get(id)
        if (h && h.hp > b.maxPowerHpTarget) {
          h.hp--
        }
        if (!h || h.hp <= b.maxPowerHpTarget) {
          b.maxPowerHpTarget = -1
        }
      }
    })

    world.buildings.forEach((id, b) => {
      if (b.maxPowerUntil < 0) return
      if (world.tick < b.maxPowerUntil) return
      b.maxPowerUntil = -1
      world.emit({ type: 'power-boost-ended', entity: id, team: b.team })
    })

    const power: Map<number, { gen: number; use: number }> = new Map()
    world.buildings.forEach((_id, b) => {
      if (!b.done) return
      const cur = power.get(b.team) ?? { gen: 0, use: 0 }
      cur.gen += b.maxPowerUntil > world.tick ? b.powerGen * 2 : b.powerGen
      cur.use += b.powerUse
      power.set(b.team, cur)
    })
    // Per-team totals + Defense Dome shield upkeep (shields drain by team, so this
    // happens before the alliance power fusion below).
    power.forEach((val, team) => {
      const s = world.teamState(team)
      const baseNet = val.gen - val.use
      s.powerGen = val.gen
      s.powerUse = val.use
      s.powerNet = baseNet
      let shields = 0
      world.buildings.forEach((_id, b) => {
        if (!b.done || b.team !== team) return
        if (!s.defenseDome || b.buildingType !== 'command-center') {
          b.shieldHp = 0
          return
        }
        const keep = (b.shieldHp > 0 || baseNet >= 1) && !s.powerDown
        if (keep) {
          b.shieldHp = Math.min(SHIELD_MAX_HP, b.shieldHp + SHIELD_REGEN_PER_TICK)
        } else {
          b.shieldHp = Math.max(0, b.shieldHp - SHIELD_REGEN_PER_TICK)
        }
        if (b.shieldHp > 0) shields++
      })
      s.powerUse = val.use + shields * SHIELD_POWER_DRAIN_PER_TICK
      s.powerNet = val.gen - s.powerUse
    })
    // Day 16: fuse the alliance into one grid when the team shares power
    // ('power' or 'both') — every member gets the summed gen/use and a single net.
    const eco = world.settings.coopEconomy
    if (eco === 'power' || eco === 'both') {
      const grouped = new Map<number, number[]>()
      for (const team of power.keys()) {
        const a = world.allianceOf(team)
        const list = grouped.get(a)
        if (list) list.push(team)
        else grouped.set(a, [team])
      }
      for (const members of grouped.values()) {
        if (members.length < 2) continue
        let gen = 0
        let use = 0
        for (const team of members) {
          const s = world.teamState(team)
          gen += s.powerGen
          use += s.powerUse
        }
        const net = gen - use
        for (const team of members) {
          const s = world.teamState(team)
          s.powerGen = gen
          s.powerUse = use
          s.powerNet = net
        }
      }
    }
    // Emit power transitions once the final per-team net is settled.
    power.forEach((_val, team) => {
      const s = world.teamState(team)
      const down = s.powerNet < 0
      if (down && !s.powerDown) world.emit({ type: 'power-down', team })
      if (!down && s.powerDown) world.emit({ type: 'power-restored', team })
      s.powerDown = down
    })
  },
}
