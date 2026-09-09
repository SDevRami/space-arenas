import { SECONDS_TO_TICKS, type MatchSettings } from '../constants.ts'

export interface UpgradeDef {
  id: string
  name: string
  cost: number
  researchTimeTicks: number
  availableAt: string
}

export const UPGRADE_IDS = ['radar', 'satellite', 'space-laser', 'stealth-tech', 'detector-upgrade'] as const

export type UpgradeId = (typeof UPGRADE_IDS)[number]

export const UPGRADES: Record<string, UpgradeDef> = {
  radar: {
    id: 'radar',
    name: 'Radar',
    cost: 300,
    researchTimeTicks: SECONDS_TO_TICKS(15),
    availableAt: 'tech-center',
  },
  satellite: {
    id: 'satellite',
    name: 'Satellite',
    cost: 500,
    researchTimeTicks: SECONDS_TO_TICKS(20),
    availableAt: 'tech-center',
  },
  'space-laser': {
    id: 'space-laser',
    name: 'Space Laser',
    cost: 1000,
    researchTimeTicks: SECONDS_TO_TICKS(40),
    availableAt: 'super-weapon',
  },
  'stealth-tech': {
    id: 'stealth-tech',
    name: 'Stealth Tech',
    cost: 400,
    researchTimeTicks: SECONDS_TO_TICKS(20),
    availableAt: 'tech-center',
  },
  'detector-upgrade': {
    id: 'detector-upgrade',
    name: 'Detector Upgrade',
    cost: 300,
    researchTimeTicks: SECONDS_TO_TICKS(15),
    availableAt: 'tech-center',
  },
}

export const getUpgrade = (id: string, settings?: Pick<MatchSettings, 'upgradeOverrides'>): UpgradeDef => {
  const def = UPGRADES[id]
  if (!def) throw new Error(`unknown upgrade: ${id}`)
  return { ...def, ...(settings?.upgradeOverrides?.[id] ?? {}) }
}

export const upgradesForBuilding = (buildingType: string): UpgradeDef[] =>
  Object.values(UPGRADES).filter((u) => u.availableAt === buildingType)
