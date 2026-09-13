import { getBuilding, getUnit } from '@space-arenas/shared'
import type { World } from '../core/world.ts'

const isEliminated = (world: World, team: number): boolean => {
  let hasUnit = false
  let hasBuilding = false
  let hasCC = false
  let hasDozer = false
  let refund = 0
  const frac = world.settings.sellRefundFraction
  world.buildings.forEach((_id, b) => {
    if (b.team !== team) return
    hasBuilding = true
    if (b.buildingType === 'command-center') hasCC = true
    refund += Math.floor((getBuilding(b.buildingType, world.settings).cost ?? 0) * frac)
  })
  world.units.forEach((_id, u) => {
    if (u.team !== team) return
    hasUnit = true
    if (u.unitType === 'bulldozer') hasDozer = true
    refund += Math.floor((getUnit(u.unitType, world.settings).cost ?? 0) * frac)
  })

  if (!hasUnit && !hasBuilding) return true

  switch (world.winRule) {
    case 'annihilation':
      return false
    case 'command-center':
      return !hasCC
    case 'standard':
    default: {
      if (hasCC) return false
      if (!hasDozer) return true
      const ccCost = getBuilding('command-center', world.settings).cost
      return world.creditsOf(team) + refund < ccCost
    }
  }
}

export const WinLossSystem = {
  name: 'WinLoss',
  update(world: World): void {
    if (world.gameOver !== null) return
    if (world.teams.size <= 1) return

    const allTeams = [...world.teams.keys()].sort((a, b) => a - b)
    const alive = allTeams.filter((t) => !isEliminated(world, t))
    const eliminated = allTeams.filter((t) => isEliminated(world, t))

    const activeAlliances = new Set<number>()
    for (const t of allTeams) {
      if (alive.includes(t)) activeAlliances.add(world.allianceOf(t))
    }

    if (activeAlliances.size <= 1) {
      const firstAlive = alive[0] ?? null
      const winner = activeAlliances.size === 1 ? firstAlive : null
      world.gameOver = winner
      world.emit({ type: 'game-over', winner, eliminated })
    }
  },
}
