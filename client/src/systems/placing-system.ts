import type { World } from '../core/world.ts'

export const PlacingSystem = {
  name: 'Placing',
  update(world: World): void {
    world.buildings.forEach((id, b) => {
      if (b.researching === '' || !b.done) return
      b.researchTicks--
      if (b.researchTicks > 0) return
      const upgradeType = b.researching
      b.researching = ''
      b.researchTicks = 0
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
    power.forEach((val, team) => {
      const s = world.teamState(team)
      s.powerGen = val.gen
      s.powerUse = val.use
      s.powerNet = val.gen - val.use
      const down = s.powerNet < 0
      if (down && !s.powerDown) world.emit({ type: 'power-down', team })
      if (!down && s.powerDown) world.emit({ type: 'power-restored', team })
      s.powerDown = down
    })
  },
}
