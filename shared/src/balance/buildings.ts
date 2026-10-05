import { SECONDS_TO_TICKS, type MatchSettings } from '../constants.ts'

export interface BuildingDef {
  id: string
  name: string
  footprint: [number, number]
  cost: number
  buildTimeTicks: number
  hp: number
  powerGen: number
  powerUse: number
  weapon?: string
  producesUnit?: string
  countLimit?: number
  /** How many infantry a finished building can garrison (bunker). 0/undefined = not a garrison. */
  transportCapacity?: number
}

export const BUILDING_IDS = [
  'command-center',
  'power-plant',
  'supply-dock',
  'barracks',
  'war-factory',
  'turret',
  'tech-center',
  'air-force',
  'super-weapon',
  'bunker',
  'dock',
] as const

export type BuildingId = (typeof BUILDING_IDS)[number]

export const BUILDINGS: Record<string, BuildingDef> = {
  'command-center': {
    id: 'command-center',
    name: 'Command Center',
    footprint: [4, 4],
    cost: 500,
    buildTimeTicks: SECONDS_TO_TICKS(30),
    hp: 2000,
    powerGen: 10,
    powerUse: 0,
    countLimit: 1,
    producesUnit: 'bulldozer',
  },
  'power-plant': {
    id: 'power-plant',
    name: 'Power Plant',
    footprint: [3, 3],
    cost: 200,
    buildTimeTicks: SECONDS_TO_TICKS(20),
    hp: 800,
    powerGen: 50,
    powerUse: 0,
  },
  'supply-dock': {
    id: 'supply-dock',
    name: 'Supply Dock',
    footprint: [3, 3],
    cost: 300,
    buildTimeTicks: SECONDS_TO_TICKS(20),
    hp: 800,
    powerGen: 0,
    powerUse: 5,
    producesUnit: 'harvester',
  },
  barracks: {
    id: 'barracks',
    name: 'Barracks',
    footprint: [3, 3],
    cost: 200,
    buildTimeTicks: SECONDS_TO_TICKS(20),
    hp: 600,
    powerGen: 0,
    powerUse: 5,
    producesUnit: 'rifleman',
  },
  'war-factory': {
    id: 'war-factory',
    name: 'War Factory',
    footprint: [4, 3],
    cost: 400,
    buildTimeTicks: SECONDS_TO_TICKS(30),
    hp: 900,
    powerGen: 0,
    powerUse: 10,
    producesUnit: 'assault-walker',
  },
  turret: {
    id: 'turret',
    name: 'Turret',
    footprint: [2, 2],
    cost: 150,
    buildTimeTicks: SECONDS_TO_TICKS(15),
    hp: 500,
    powerGen: 0,
    powerUse: 5,
    weapon: 'turret-gun',
  },
  'tech-center': {
    id: 'tech-center',
    name: 'Tech Center',
    footprint: [3, 3],
    cost: 500,
    buildTimeTicks: SECONDS_TO_TICKS(40),
    hp: 700,
    powerGen: 0,
    powerUse: 10,
  },
  'air-force': {
    id: 'air-force',
    name: 'Air Force',
    footprint: [3, 3],
    cost: 500,
    buildTimeTicks: SECONDS_TO_TICKS(25),
    hp: 900,
    powerGen: 0,
    powerUse: 15,
    producesUnit: 'fighter',
  },
  'super-weapon': {
    id: 'super-weapon',
    name: 'Super Weapon',
    footprint: [4, 4],
    cost: 1500,
    buildTimeTicks: SECONDS_TO_TICKS(45),
    hp: 1500,
    powerGen: 0,
    powerUse: 100,
    countLimit: 1,
  },
  bunker: {
    id: 'bunker',
    name: 'Bunker',
    footprint: [2, 2],
    cost: 250,
    buildTimeTicks: SECONDS_TO_TICKS(20),
    hp: 700,
    powerGen: 0,
    powerUse: 5,
    weapon: 'bunker-gun',
    transportCapacity: 5,
  },
  dock: {
    id: 'dock',
    name: 'Dock',
    footprint: [3, 3],
    cost: 400,
    buildTimeTicks: SECONDS_TO_TICKS(30),
    hp: 900,
    powerGen: 0,
    powerUse: 10,
    producesUnit: 'carrier',
  },
}

export const getBuilding = (id: string, settings?: Pick<MatchSettings, 'buildingOverrides'>): BuildingDef => {
  const def = BUILDINGS[id]
  if (!def) throw new Error(`unknown building: ${id}`)
  return { ...def, ...(settings?.buildingOverrides?.[id] ?? {}) }
}
