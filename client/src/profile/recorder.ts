import { UNITS } from '@space-arenas/shared'
import type { SimEvent } from '../core/events.ts'
import type { World } from '../core/world.ts'
import { freshCounters, freshTypeCounts, type ProfileCounters, type ProfileTypeCounts } from './profile.ts'

export interface SessionSummary {
  counters: ProfileCounters
  typeCounts: ProfileTypeCounts
}

/**
 * Collects the live match's sim events for the local team into a delta summary.
 * The summary is handed to `recordMatch` when the match ends.
 */
export class SessionRecorder {
  private readonly counters = freshCounters()
  private readonly typeCounts = freshTypeCounts()
  private readonly lastAttacker = new Map<number, number>()

  constructor(private readonly localTeam: number) {}

  track(e: SimEvent, world?: World): void {
    switch (e.type) {
      case 'unit-trained':
        if (e.team !== this.localTeam) break
        this.counters.unitsTrained += 1
        this.typeCounts.unitsTrainedByType[e.unitType] = (this.typeCounts.unitsTrainedByType[e.unitType] ?? 0) + 1
        break
      case 'building-placed':
        if (e.team !== this.localTeam) break
        this.counters.buildingsBuilt += 1
        this.typeCounts.buildingsBuiltByType[e.buildingType] = (this.typeCounts.buildingsBuiltByType[e.buildingType] ?? 0) + 1
        break
      case 'upgrade-completed':
        if (e.team !== this.localTeam) break
        this.typeCounts.upgradesResearched[e.upgrade] = (this.typeCounts.upgradesResearched[e.upgrade] ?? 0) + 1
        break
      case 'combat-hit':
        if (e.team !== this.localTeam) break
        this.counters.damageDealt += e.damage
        this.lastAttacker.set(e.target, e.team)
        break
      case 'supply-harvested':
        if (e.team !== this.localTeam) break
        this.counters.supplyHarvested += e.amount
        break
      case 'entity-destroyed': {
        if (this.lastAttacker.get(e.entity) === this.localTeam) {
          this.counters.kills += 1
          if (e.kind === 'building') this.counters.killsBuilding += 1
          else if (e.kind === 'unit') {
            const cls = e.typeName ? UNITS[e.typeName]?.class : undefined
            if (cls === 'infantry') this.counters.killsInfantry += 1
            else if (cls === 'vehicle') this.counters.killsVehicle += 1
            else if (cls === 'naval') this.counters.killsVehicle += 1
            else if (cls === 'air') this.counters.killsAir += 1
          }
        }
        if (e.team === this.localTeam) {
          if (e.kind === 'unit') this.counters.unitsLost += 1
          else if (e.kind === 'building') this.counters.buildingsLost += 1
        }
        break
      }
      case 'mine-placed':
        if (e.team === this.localTeam) this.counters.minesPlaced += 1
        break
      case 'unit-loaded':
        if (e.team === this.localTeam) this.counters.troopsTransported += 1
        break
      case 'unit-ranked-up': {
        const u = world?.units.get(e.unit)
        if (u && u.team === this.localTeam) this.counters.veteranPromotions += 1
        break
      }
      case 'laser-strike':
        if (e.team === this.localTeam) this.counters.laserStrikes += 1
        break
      case 'airstrike-called':
        if (e.team === this.localTeam) this.counters.airstrikes += 1
        break
      case 'emp-strike':
        if (e.team === this.localTeam) this.counters.empStrikes += 1
        break
      case 'grenade-exploded':
        if (e.team === this.localTeam) this.counters.grenadesLobbed += 1
        break
      case 'satellite-used':
        if (e.team === this.localTeam) this.counters.satelliteScans += 1
        break
      default:
        break
    }
  }

  summary(): SessionSummary {
    return {
      counters: { ...this.counters },
      typeCounts: {
        unitsTrainedByType: { ...this.typeCounts.unitsTrainedByType },
        buildingsBuiltByType: { ...this.typeCounts.buildingsBuiltByType },
        upgradesResearched: { ...this.typeCounts.upgradesResearched },
      },
    }
  }
}