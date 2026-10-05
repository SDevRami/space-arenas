import { SECONDS_TO_TICKS, type MatchSettings } from '../constants.ts'

export interface UpgradeDef {
  id: string
  name: string
  cost: number
  researchTimeTicks: number
  availableAt: string
  /** Day 15: general rank (★) required to buy this research. 0 = available from the start. */
  requiredRank: number
}

export const UPGRADE_IDS = ['radar', 'satellite', 'space-laser', 'stealth-tech', 'detector-upgrade', 'mine-tech', 'abilities-tech', 'transport-capacity', 'defense-dome', 'weapon-upgrade', 'airstrike-level', 'emp-level'] as const

export type UpgradeId = (typeof UPGRADE_IDS)[number]

export const UPGRADES: Record<string, UpgradeDef> = {
  radar: {
    id: 'radar',
    name: 'Radar',
    cost: 300,
    researchTimeTicks: SECONDS_TO_TICKS(15),
    availableAt: 'command-center',
    requiredRank: 0,
  },
  satellite: {
    id: 'satellite',
    name: 'Satellite',
    cost: 500,
    researchTimeTicks: SECONDS_TO_TICKS(20),
    availableAt: 'tech-center',
    requiredRank: 0,
  },
  'space-laser': {
    id: 'space-laser',
    name: 'Space Laser',
    cost: 1000,
    researchTimeTicks: SECONDS_TO_TICKS(40),
    availableAt: 'super-weapon',
    requiredRank: 3,
  },
  'stealth-tech': {
    id: 'stealth-tech',
    name: 'Stealth Tech',
    cost: 400,
    researchTimeTicks: SECONDS_TO_TICKS(20),
    availableAt: 'tech-center',
    requiredRank: 1,
  },
  'detector-upgrade': {
    id: 'detector-upgrade',
    name: 'Detector Upgrade',
    cost: 300,
    researchTimeTicks: SECONDS_TO_TICKS(15),
    availableAt: 'tech-center',
    requiredRank: 1,
  },
  'mine-tech': {
    id: 'mine-tech',
    name: 'Mine Tech',
    cost: 400,
    researchTimeTicks: SECONDS_TO_TICKS(20),
    availableAt: 'tech-center',
    requiredRank: 1,
  },
  'abilities-tech': {
    id: 'abilities-tech',
    name: 'Grenades & Smoke',
    cost: 400,
    researchTimeTicks: SECONDS_TO_TICKS(20),
    availableAt: 'tech-center',
    requiredRank: 1,
  },
  'transport-capacity': {
    id: 'transport-capacity',
    name: 'Troop Capacity',
    cost: 300,
    researchTimeTicks: SECONDS_TO_TICKS(20),
    availableAt: 'tech-center',
    requiredRank: 1,
  },
  'defense-dome': {
    id: 'defense-dome',
    name: 'Defense Dome',
    cost: 500,
    researchTimeTicks: SECONDS_TO_TICKS(20),
    availableAt: 'tech-center',
    requiredRank: 2,
  },
  'weapon-upgrade': {
    id: 'weapon-upgrade',
    name: 'Weapon Upgrade',
    cost: 400,
    researchTimeTicks: SECONDS_TO_TICKS(20),
    availableAt: 'tech-center',
    requiredRank: 2,
  },
  'airstrike-level': {
    id: 'airstrike-level',
    name: 'Airstrike Payload',
    cost: 1000,
    researchTimeTicks: SECONDS_TO_TICKS(40),
    availableAt: 'super-weapon',
    requiredRank: 3,
  },
  'emp-level': {
    id: 'emp-level',
    name: 'EMP Overcharge',
    cost: 1000,
    researchTimeTicks: SECONDS_TO_TICKS(40),
    availableAt: 'super-weapon',
    requiredRank: 3,
  },
}

export const getUpgrade = (id: string, settings?: Pick<MatchSettings, 'upgradeOverrides'>): UpgradeDef => {
  const def = UPGRADES[id]
  if (!def) throw new Error(`unknown upgrade: ${id}`)
  return { ...def, ...(settings?.upgradeOverrides?.[id] ?? {}) }
}

export const upgradesForBuilding = (buildingType: string): UpgradeDef[] =>
  Object.values(UPGRADES).filter((u) => u.availableAt === buildingType)
