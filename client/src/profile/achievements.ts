import type { ProfileCounters, ProfileTypeCounts } from './profile.ts'

/** Achievement definitions map each id to a cumulative counter or a per-type count map. */
export interface AchievementDef {
  id: string
  group: string
  target: number
  /** Cumulative scalar counter to measure, or null when measuring a per-type count. */
  stat?: keyof ProfileCounters
  /** Which per-type counter map to read when `stat` is not set. */
  countType?: 'unit' | 'building' | 'upgrade'
  /** Entity/upgrade type keyed inside that map. */
  typeId?: string
  nameKey: string
  descKey: string
}

export const ACHIEVEMENTS: AchievementDef[] = [
  // economy
  { id: 'builder', group: 'economy', target: 1, stat: 'buildingsBuilt', nameKey: 'achievements.names.builder', descKey: 'achievements.descs.builder' },
  { id: 'power-plant', group: 'economy', target: 1, countType: 'building', typeId: 'power-plant', nameKey: 'achievements.names.power-plant', descKey: 'achievements.descs.power-plant' },
  { id: 'supply-dock', group: 'economy', target: 1, countType: 'building', typeId: 'supply-dock', nameKey: 'achievements.names.supply-dock', descKey: 'achievements.descs.supply-dock' },
  { id: 'harvester-fleet', group: 'economy', target: 3, countType: 'unit', typeId: 'harvester', nameKey: 'achievements.names.harvester-fleet', descKey: 'achievements.descs.harvester-fleet' },
  { id: 'capitalist', group: 'economy', target: 1000, stat: 'supplyHarvested', nameKey: 'achievements.names.capitalist', descKey: 'achievements.descs.capitalist' },
  // army
  { id: 'squad', group: 'army', target: 10, countType: 'unit', typeId: 'rifleman', nameKey: 'achievements.names.squad', descKey: 'achievements.descs.squad' },
  { id: 'armor', group: 'army', target: 5, countType: 'unit', typeId: 'assault-walker', nameKey: 'achievements.names.armor', descKey: 'achievements.descs.armor' },
  { id: 'flak', group: 'army', target: 3, countType: 'unit', typeId: 'aa-platform', nameKey: 'achievements.names.flak', descKey: 'achievements.descs.flak' },
  { id: 'arty', group: 'army', target: 3, countType: 'unit', typeId: 'artillery', nameKey: 'achievements.names.arty', descKey: 'achievements.descs.arty' },
  { id: 'engineer-army', group: 'army', target: 3, countType: 'unit', typeId: 'engineer', nameKey: 'achievements.names.engineer-army', descKey: 'achievements.descs.engineer-army' },
  { id: 'apc-fleet', group: 'army', target: 3, countType: 'unit', typeId: 'apc', nameKey: 'achievements.names.apc-fleet', descKey: 'achievements.descs.apc-fleet' },
  { id: 'air-wing', group: 'army', target: 3, countType: 'unit', typeId: 'fighter', nameKey: 'achievements.names.air-wing', descKey: 'achievements.descs.air-wing' },
  { id: 'transport', group: 'army', target: 25, stat: 'troopsTransported', nameKey: 'achievements.names.transport', descKey: 'achievements.descs.transport' },
  { id: 'sentry-net', group: 'army', target: 4, countType: 'building', typeId: 'turret', nameKey: 'achievements.names.sentry-net', descKey: 'achievements.descs.sentry-net' },
  { id: 'bunker-line', group: 'army', target: 3, countType: 'building', typeId: 'bunker', nameKey: 'achievements.names.bunker-line', descKey: 'achievements.descs.bunker-line' },
  { id: 'air-force-hangar', group: 'army', target: 1, countType: 'building', typeId: 'air-force', nameKey: 'achievements.names.air-force-hangar', descKey: 'achievements.descs.air-force-hangar' },
  // research & defense
  { id: 'arsenal', group: 'research', target: 1, countType: 'upgrade', typeId: 'weapon-upgrade', nameKey: 'achievements.names.arsenal', descKey: 'achievements.descs.arsenal' },
  { id: 'fortify', group: 'research', target: 1, countType: 'upgrade', typeId: 'defense-dome', nameKey: 'achievements.names.fortify', descKey: 'achievements.descs.fortify' },
  { id: 'camo', group: 'research', target: 1, countType: 'upgrade', typeId: 'stealth-tech', nameKey: 'achievements.names.camo', descKey: 'achievements.descs.camo' },
  { id: 'bandolier', group: 'research', target: 1, countType: 'upgrade', typeId: 'abilities-tech', nameKey: 'achievements.names.bandolier', descKey: 'achievements.descs.bandolier' },
  { id: 'satellite-eye', group: 'research', target: 1, countType: 'upgrade', typeId: 'satellite', nameKey: 'achievements.names.satellite-eye', descKey: 'achievements.descs.satellite-eye' },
  { id: 'super-weapon', group: 'research', target: 1, countType: 'building', typeId: 'super-weapon', nameKey: 'achievements.names.super-weapon', descKey: 'achievements.descs.super-weapon' },
  // combat & veterancy
  { id: 'first-blood', group: 'combat', target: 1, stat: 'kills', nameKey: 'achievements.names.first-blood', descKey: 'achievements.descs.first-blood' },
  { id: 'marine-hunter', group: 'combat', target: 20, stat: 'killsInfantry', nameKey: 'achievements.names.marine-hunter', descKey: 'achievements.descs.marine-hunter' },
  { id: 'tank-buster', group: 'combat', target: 10, stat: 'killsVehicle', nameKey: 'achievements.names.tank-buster', descKey: 'achievements.descs.tank-buster' },
  { id: 'sky-killer', group: 'combat', target: 5, stat: 'killsAir', nameKey: 'achievements.names.sky-killer', descKey: 'achievements.descs.sky-killer' },
  { id: 'base-breaker', group: 'combat', target: 5, stat: 'killsBuilding', nameKey: 'achievements.names.base-breaker', descKey: 'achievements.descs.base-breaker' },
  { id: 'warlord', group: 'combat', target: 5000, stat: 'damageDealt', nameKey: 'achievements.names.warlord', descKey: 'achievements.descs.warlord' },
  { id: 'veteran-cert', group: 'combat', target: 1, stat: 'veteranPromotions', nameKey: 'achievements.names.veteran-cert', descKey: 'achievements.descs.veteran-cert' },
  { id: 'war-hero', group: 'combat', target: 10, stat: 'veteranPromotions', nameKey: 'achievements.names.war-hero', descKey: 'achievements.descs.war-hero' },
  { id: 'miner', group: 'combat', target: 20, stat: 'minesPlaced', nameKey: 'achievements.names.miner', descKey: 'achievements.descs.miner' },
  { id: 'grenade-spam', group: 'combat', target: 20, stat: 'grenadesLobbed', nameKey: 'achievements.names.grenade-spam', descKey: 'achievements.descs.grenade-spam' },
  // super weapons & tools
  { id: 'laser-lord', group: 'superweapons', target: 1, stat: 'laserStrikes', nameKey: 'achievements.names.laser-lord', descKey: 'achievements.descs.laser-lord' },
  { id: 'airstrike-master', group: 'superweapons', target: 1, stat: 'airstrikes', nameKey: 'achievements.names.airstrike-master', descKey: 'achievements.descs.airstrike-master' },
  { id: 'emp-master', group: 'superweapons', target: 1, stat: 'empStrikes', nameKey: 'achievements.names.emp-master', descKey: 'achievements.descs.emp-master' },
  { id: 'satellite-scout', group: 'superweapons', target: 1, stat: 'satelliteScans', nameKey: 'achievements.names.satellite-scout', descKey: 'achievements.descs.satellite-scout' },
  // career
  { id: 'first-match', group: 'career', target: 1, stat: 'gamesPlayed', nameKey: 'achievements.names.first-match', descKey: 'achievements.descs.first-match' },
  { id: 'first-win', group: 'career', target: 1, stat: 'wins', nameKey: 'achievements.names.first-win', descKey: 'achievements.descs.first-win' },
  { id: 'five-matches', group: 'career', target: 5, stat: 'gamesPlayed', nameKey: 'achievements.names.five-matches', descKey: 'achievements.descs.five-matches' },
  { id: 'ten-wins', group: 'career', target: 10, stat: 'wins', nameKey: 'achievements.names.ten-wins', descKey: 'achievements.descs.ten-wins' },
  // spectator
  { id: 'first-spectate', group: 'spectator', target: 1, stat: 'spectatedMatches', nameKey: 'achievements.names.first-spectate', descKey: 'achievements.descs.first-spectate' },
  { id: 'five-spectates', group: 'spectator', target: 5, stat: 'spectatedMatches', nameKey: 'achievements.names.five-spectates', descKey: 'achievements.descs.five-spectates' },
  { id: 'ten-spectates', group: 'spectator', target: 10, stat: 'spectatedMatches', nameKey: 'achievements.names.ten-spectates', descKey: 'achievements.descs.ten-spectates' },
]

/** Live progress of an achievement — the underlying counter, which keeps growing past the target. */
export const achievementProgress = (def: AchievementDef, counters: ProfileCounters, typeCounts: ProfileTypeCounts): number => {
  if (def.stat !== undefined) return counters[def.stat] ?? 0
  if (def.countType === 'unit') return typeCounts.unitsTrainedByType[def.typeId ?? ''] ?? 0
  if (def.countType === 'building') return typeCounts.buildingsBuiltByType[def.typeId ?? ''] ?? 0
  if (def.countType === 'upgrade') return typeCounts.upgradesResearched[def.typeId ?? ''] ?? 0
  return 0
}