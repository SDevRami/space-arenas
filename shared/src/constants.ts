export const SIM_TICK_HZ = 25
export const SIM_TICK_MS = 1000 / SIM_TICK_HZ
export const TICKS_PER_SECOND = SIM_TICK_HZ
export const SECONDS_TO_TICKS = (seconds: number): number => Math.round(seconds * SIM_TICK_HZ)

export const DEFAULT_PORT = 17321
export const DEFAULT_MAX_PLAYERS = 8
export const PROTOCOL_VERSION = 2

/** Number of selectable per-player colors. */
export const PLAYER_COLOR_COUNT = 10

/** Team/player identity palette. Index = the player's chosen color slot (0-9). */
export const PLAYER_COLORS: number[] = [
  0x42c95c, // green
  0xe0564f, // red
  0x4f8fe0, // blue
  0xe0c14f, // yellow
  0x9a5fe0, // purple
  0x4fc4d0, // cyan
  0xe0823f, // orange
  0xe04fa0, // pink
  0xb8b8c2, // white-grey
  0x3fa35f, // teal-green
]
export const DEFAULT_CREDITS = 800
export const SUPPLY_PER_TRIP = 50
export const HARVESTER_LOAD_TICKS = 40
export const BUILDER_REPAIR_PER_TICK = 40
export const SATELLITE_REVEAL_TICKS = SECONDS_TO_TICKS(6)
export const SATELLITE_COOLDOWN_TICKS = SECONDS_TO_TICKS(30)

/** How long the "Max Power" overdrive lasts on a power plant before it overheats. */
export const MAX_POWER_TICKS = SECONDS_TO_TICKS(30)

export const LASER_COOLDOWN_TICKS = SECONDS_TO_TICKS(60)
export const LASER_RADIUS = 3
export const LASER_DURATION_TICKS = SECONDS_TO_TICKS(4)
export const LASER_DAMAGE_PER_TICK = 40
export const LASER_MAX_LEVEL = 2
/** Wind-up time after target selection before the beam fires, per laser level. */
export const LASER_DELAY_TICKS_LV1 = SECONDS_TO_TICKS(1)
export const LASER_DELAY_TICKS_LV2 = SECONDS_TO_TICKS(0.7)

/** How far (in cells) an enemy entity stays visible past the edge of the currently-visible area. */
export const FOG_FADE_DISTANCE = 3

export const OIL_INCOME = 50
export const OIL_INCOME_INTERVAL_TICKS = SECONDS_TO_TICKS(10)
export const OIL_CLAIM_TICKS = SECONDS_TO_TICKS(20)

export const DEFAULT_SELL_REFUND_FRACTION = 0.5
export const DEFAULT_QUEUE_LIMIT = 10

/** Fraction of an object's cost recovered by a bulldozer collecting its wreck. */
export const DEFAULT_WRECK_VALUE_FRACTION = 0.1
/** How long (ticks) a bulldozer must work to collect a wreck. */
export const DEFAULT_WRECK_COLLECT_TICKS = SECONDS_TO_TICKS(2)
/** How long a building keeps animating (frames reversed 5→1) while being sold. */
export const DEFAULT_SELL_TICKS = SECONDS_TO_TICKS(3)

/** 0 means "use the map's own value" for the global field overrides. */
export const FIELD_OVERRIDE_AUTO = 0

export const OIL_FIELD_HP = 500
export const TREE_HP = 40
export const ROCK_HP = 220
export const CRUSH_DAMAGE = 20

/** Unit separation / clearance distances, in tiles. */
export const SEP_VEHICLE = 1900
export const SEP_INFANTRY = 1250
export const SEP_MAX_PUSH = 320
export const BUILDING_MARGIN_VEHICLE = 500
export const BUILDING_MARGIN_INFANTRY = 350
export const FIELD_MARGIN = 400

export interface BuildingOverrides {
  cost?: number
  buildTimeTicks?: number
  hp?: number
  powerGen?: number
  powerUse?: number
}

export interface UnitOverrides {
  cost?: number
  buildTimeTicks?: number
  hp?: number
  vision?: number
  speed?: number
  capacity?: number
  maxAmmo?: number
  reloadTicks?: number
}

export interface WeaponOverrides {
  damage?: number
  cooldownTicks?: number
  range?: number
  splash?: number
}

export interface UpgradeOverrides {
  cost?: number
  researchTimeTicks?: number
}

export interface MatchSettings {
  startingCredits: number
  oilIncome: number
  oilIncomeIntervalTicks: number
  oilClaimTicks: number
  supplyPerTrip: number
  harvesterLoadTicks: number
  builderRepairPerTick: number
  satelliteRevealTicks: number
  satelliteCooldownTicks: number
  laserCooldownTicks: number
  laserRadius: number
  laserDurationTicks: number
  laserDamagePerTick: number
  laserMaxLevel: number
  laserDelayTicksLv1: number
  laserDelayTicksLv2: number
  maxPowerTicks: number
  fogFadeDistance: number
  sellRefundFraction: number
  sellTicks: number
  wreckValueFraction: number
  wreckCollectTicks: number
  queueLimit: number
  supplyFieldCapacity: number
  supplyFieldRadius: number
  oilFieldRadius: number
  spawnRange: number
  oilFieldHp: number
  treeHp: number
  rockHp: number
  crushDamage: number
  sepVehicle: number
  sepInfantry: number
  sepMaxPush: number
  buildingMarginVehicle: number
  buildingMarginInfantry: number
  fieldMargin: number
  chaseLeash: number
  guardArriveCells: number
  targetBiasLastHit: number
  targetBiasFocusFire: number
  targetBiasLowHp: number
  defaultSplash: number
  samePosJitter: number
  lateralSepDist: number
  stuckRelocateRadius: number
  repathCooldownBlockedTicks: number
  repathCooldownFailTicks: number
  astarCostStraight: number
  astarCostDiagonal: number
  planeOrbitRadius: number
  planeReloadRadius: number
  planeSortieMult: number
  workPadDistance: number
  workStuckTicks: number
  pathBudgetPerTick: number
  pathMaxNodes: number
  buildingOverrides: Record<string, BuildingOverrides>
  unitOverrides: Record<string, UnitOverrides>
  weaponOverrides: Record<string, WeaponOverrides>
  upgradeOverrides: Record<string, UpgradeOverrides>
}

export const DEFAULT_MATCH_SETTINGS: MatchSettings = {
  startingCredits: DEFAULT_CREDITS,
  oilIncome: OIL_INCOME,
  oilIncomeIntervalTicks: OIL_INCOME_INTERVAL_TICKS,
  oilClaimTicks: OIL_CLAIM_TICKS,
  supplyPerTrip: SUPPLY_PER_TRIP,
  harvesterLoadTicks: HARVESTER_LOAD_TICKS,
  builderRepairPerTick: BUILDER_REPAIR_PER_TICK,
  satelliteRevealTicks: SATELLITE_REVEAL_TICKS,
  satelliteCooldownTicks: SATELLITE_COOLDOWN_TICKS,
  laserCooldownTicks: LASER_COOLDOWN_TICKS,
  laserRadius: LASER_RADIUS,
  laserDurationTicks: LASER_DURATION_TICKS,
  laserDamagePerTick: LASER_DAMAGE_PER_TICK,
  laserMaxLevel: LASER_MAX_LEVEL,
  laserDelayTicksLv1: LASER_DELAY_TICKS_LV1,
  laserDelayTicksLv2: LASER_DELAY_TICKS_LV2,
  maxPowerTicks: MAX_POWER_TICKS,
  fogFadeDistance: FOG_FADE_DISTANCE,
  sellRefundFraction: DEFAULT_SELL_REFUND_FRACTION,
  sellTicks: DEFAULT_SELL_TICKS,
  wreckValueFraction: DEFAULT_WRECK_VALUE_FRACTION,
  wreckCollectTicks: DEFAULT_WRECK_COLLECT_TICKS,
  queueLimit: DEFAULT_QUEUE_LIMIT,
  supplyFieldCapacity: FIELD_OVERRIDE_AUTO,
  supplyFieldRadius: FIELD_OVERRIDE_AUTO,
  oilFieldRadius: FIELD_OVERRIDE_AUTO,
  spawnRange: 2,
  oilFieldHp: OIL_FIELD_HP,
  treeHp: TREE_HP,
  rockHp: ROCK_HP,
  crushDamage: CRUSH_DAMAGE,
  sepVehicle: SEP_VEHICLE / 1000,
  sepInfantry: SEP_INFANTRY / 1000,
  sepMaxPush: SEP_MAX_PUSH / 1000,
  buildingMarginVehicle: BUILDING_MARGIN_VEHICLE / 1000,
  buildingMarginInfantry: BUILDING_MARGIN_INFANTRY / 1000,
  fieldMargin: FIELD_MARGIN / 1000,
  chaseLeash: 2,
  guardArriveCells: 0.4,
  targetBiasLastHit: 20000000,
  targetBiasFocusFire: 1000000,
  targetBiasLowHp: 10000,
  defaultSplash: 0.4,
  samePosJitter: 0.12,
  lateralSepDist: 0.1,
  stuckRelocateRadius: 12,
  repathCooldownBlockedTicks: 15,
  repathCooldownFailTicks: 10,
  astarCostStraight: 10,
  astarCostDiagonal: 14,
  planeOrbitRadius: 1,
  planeReloadRadius: 4,
  planeSortieMult: 4,
  workPadDistance: 1,
  workStuckTicks: 45,
  pathBudgetPerTick: 8,
  pathMaxNodes: 8000,
  buildingOverrides: {},
  unitOverrides: {},
  weaponOverrides: {},
  upgradeOverrides: {},
}

export const mergeMatchSettings = (patch?: Partial<MatchSettings>): MatchSettings => {
  const p = patch ?? {}
  return {
    ...DEFAULT_MATCH_SETTINGS,
    ...p,
    buildingOverrides: { ...DEFAULT_MATCH_SETTINGS.buildingOverrides, ...p.buildingOverrides },
    unitOverrides: { ...DEFAULT_MATCH_SETTINGS.unitOverrides, ...p.unitOverrides },
    weaponOverrides: { ...DEFAULT_MATCH_SETTINGS.weaponOverrides, ...p.weaponOverrides },
    upgradeOverrides: { ...DEFAULT_MATCH_SETTINGS.upgradeOverrides, ...p.upgradeOverrides },
  }
}

export const WIN_RULES = ['standard', 'annihilation', 'command-center'] as const
export type WinRule = (typeof WIN_RULES)[number]
export const WIN_RULE_DEFAULT: WinRule = 'standard'

export const WIN_RULE_LABELS: Record<WinRule, string> = {
  standard: 'Standard (base destruction)',
  annihilation: 'Total Annihilation',
  'command-center': 'Command Center',
}
