import { SECONDS_TO_TICKS, type MatchSettings } from '../constants.ts'

export interface UnitDef {
  id: string
  name: string
  class: 'infantry' | 'vehicle' | 'air'
  cost: number
  buildTimeTicks: number
  hp: number
  vision: number
  speed: number
  weapon?: string
  producedBy: string
  isHarvester?: boolean
  capacity?: number
  maxAmmo?: number
  reloadTicks?: number
}

export const UNIT_IDS = [
  'bulldozer',
  'harvester',
  'scout',
  'rifleman',
  'rocket-trooper',
  'assault-walker',
  'aa-platform',
  'artillery',
  'fighter',
] as const

export type UnitId = (typeof UNIT_IDS)[number]

export const UNITS: Record<string, UnitDef> = {
  bulldozer: {
    id: 'bulldozer',
    name: 'Bulldozer',
    class: 'vehicle',
    cost: 100,
    buildTimeTicks: SECONDS_TO_TICKS(5),
    hp: 300,
    vision: 4,
    speed: 55,
    producedBy: 'command-center',
  },
  harvester: {
    id: 'harvester',
    name: 'Harvester',
    class: 'vehicle',
    cost: 0,
    buildTimeTicks: SECONDS_TO_TICKS(8),
    hp: 600,
    vision: 4,
    speed: 60,
    producedBy: 'supply-dock',
    isHarvester: true,
  },
  scout: {
    id: 'scout',
    name: 'Scout',
    class: 'infantry',
    cost: 50,
    buildTimeTicks: SECONDS_TO_TICKS(5),
    hp: 100,
    vision: 10,
    speed: 120,
    producedBy: 'barracks',
  },
  rifleman: {
    id: 'rifleman',
    name: 'Rifleman',
    class: 'infantry',
    cost: 100,
    buildTimeTicks: SECONDS_TO_TICKS(10),
    hp: 200,
    vision: 6,
    speed: 90,
    weapon: 'rifle',
    producedBy: 'barracks',
  },
  'rocket-trooper': {
    id: 'rocket-trooper',
    name: 'Rocket Trooper',
    class: 'infantry',
    cost: 150,
    buildTimeTicks: SECONDS_TO_TICKS(12),
    hp: 150,
    vision: 6,
    speed: 80,
    weapon: 'rocket',
    producedBy: 'barracks',
  },
  'assault-walker': {
    id: 'assault-walker',
    name: 'Assault Walker',
    class: 'vehicle',
    cost: 250,
    buildTimeTicks: SECONDS_TO_TICKS(15),
    hp: 400,
    vision: 8,
    speed: 72,
    weapon: 'cannon',
    producedBy: 'war-factory',
  },
  'aa-platform': {
    id: 'aa-platform',
    name: 'Anti-Air Platform',
    class: 'vehicle',
    cost: 300,
    buildTimeTicks: SECONDS_TO_TICKS(18),
    hp: 350,
    vision: 8,
    speed: 68,
    weapon: 'aa',
    producedBy: 'war-factory',
  },
  artillery: {
    id: 'artillery',
    name: 'Artillery',
    class: 'vehicle',
    cost: 350,
    buildTimeTicks: SECONDS_TO_TICKS(22),
    hp: 250,
    vision: 9,
    speed: 48,
    weapon: 'artillery',
    producedBy: 'war-factory',
  },
  fighter: {
    id: 'fighter',
    name: 'Fighter',
    class: 'air',
    cost: 200,
    buildTimeTicks: SECONDS_TO_TICKS(15),
    hp: 150,
    vision: 8,
    speed: 130,
    weapon: 'air-cannon',
    producedBy: 'air-force',
    capacity: 3,
    maxAmmo: 2,
    reloadTicks: SECONDS_TO_TICKS(5),
  },
}

export const getUnit = (id: string, settings?: Pick<MatchSettings, 'unitOverrides'>): UnitDef => {
  const def = UNITS[id]
  if (!def) throw new Error(`unknown unit: ${id}`)
  return { ...def, ...(settings?.unitOverrides?.[id] ?? {}) }
}

/** Grenades/smoke are a ground-combat ability: aircraft and the construction bulldozer cannot throw. */
export const canThrowBandolier = (u: Pick<UnitDef, 'id' | 'class'>): boolean =>
  u.class !== 'air' && u.id !== 'bulldozer'
