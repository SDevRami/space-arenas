export const SIM_TICK_HZ = 25
export const SIM_TICK_MS = 1000 / SIM_TICK_HZ
export const TICKS_PER_SECOND = SIM_TICK_HZ
export const SECONDS_TO_TICKS = (seconds: number): number => Math.round(seconds * SIM_TICK_HZ)

/** Extra transport slots granted by each Tech-Center "Troop Capacity" research. */
export const TRANSPORT_CAPACITY_PER_LEVEL = 3

/** Defense Dome (Day 12): max shield HP per building, regen per powered tick, and power drained per active shield. */
export const SHIELD_MAX_HP = 200
export const SHIELD_REGEN_PER_TICK = 1
export const SHIELD_POWER_DRAIN_PER_TICK = 1

/** Weapon Upgrade research (Day 12): max research levels and damage per level, applied only to max-rank (level 5) veterans. */
export const WEAPON_UPGRADE_MAX_LEVEL = 3
export const WEAPON_UPGRADE_DAMAGE_PER_LEVEL = 0.25

/** Day 15: match score + general rank ladder (Zero Hour style: reach a score
 * floor and rank up for free — the score keeps counting toward the next star). */
export const RANK_COUNT = 3
export const MAX_RANK = RANK_COUNT
/** Score floor to reach for each rank-up (rank 1★, 2★, 3★). */
export const RANK_FLOORS = [500, 1500, 3500]
export const SCORE_UNIT_KILL = 10
export const SCORE_BUILDING_KILL = 30
/** Flat score granted each time a harvester docks supply (deterministic per trip). */
export const SCORE_SUPPLY_PER_TRIP = 2
/** Score granted when a research/upgrade finishes. */
export const SCORE_RESEARCH = 15
/** Score granted when a building is placed beyond the starting-base radius. */
export const SCORE_EXPANSION = 25
/** Distance (tiles) from a team's spawn point that counts as an expansion. */
export const EXPANSION_RADIUS_TILES = 18
/** Day 15: the additional super weapon (airstrike/EMP) upgrade levels, mirroring the laser. */
export const AIRSTRIKE_MAX_LEVEL = 2
export const EMP_MAX_LEVEL = 2

export const DEFAULT_PORT = 17321
export const DEFAULT_MAX_PLAYERS = 8
/** Wire protocol revision (21). Kept XOR-obfuscated so the plain number isn't
 *  trivially greppable in a minified bundle — a cheap stop for casual patchers,
 *  explicitly NOT a security boundary (a determined client can always read it). */
export const PROTOCOL_VERSION = 0x5c ^ 0x49
/** Oldest client protocol a room still admits. The number is UX/policy only: the
 *  real compatibility gate is server-side frame validation, so clients 1-2
 *  versions behind keep playing while a patched client that speaks a changed
 *  wire format gets rejected regardless of the integer it claims. */
export const MIN_PROTOCOL_VERSION = PROTOCOL_VERSION - 2

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

/** Fog-of-war decay mode: Memory keeps explored tiles dim, Classic skips the fade (seen = bright forever), Hard forgets everything instantly. */
export const FOG_MODES = ['memory', 'classic', 'hard'] as const
export type FogMode = (typeof FOG_MODES)[number]
export const FOG_MODE_DEFAULT: FogMode = 'memory'

/** Day 13 — Super Weapon random strikes, chosen once at the Super Weapon.
 * Airstrike: a squadron of kamikaze planes bombs the target point in sequence.
 * EMP: disables every enemy unit/building in a radius for a few seconds. */
export const AIRSTRIKE_PLANES = 4
/** Kamikaze plane cruise speed, in fx units per tick (~0.5 tiles/tick). */
export const AIRSTRIKE_PLANE_SPEED = 500
/** Delay between consecutive kamikaze bombs reaching the target. */
export const AIRSTRIKE_PLANE_STAGGER_TICKS = SECONDS_TO_TICKS(0.3)
export const AIRSTRIKE_BOMB_DAMAGE = 50
export const AIRSTRIKE_BOMB_RADIUS = 3
export const AIRSTRIKE_COOLDOWN_TICKS = SECONDS_TO_TICKS(60)

export const EMP_RADIUS_TILES = 8
/** How long the EMP zone disables enemy units/buildings. */
export const EMP_DURATION_TICKS = SECONDS_TO_TICKS(5)
/** How long the purple pulse visual stays up (same window as the disable). */
export const EMP_PULSE_TICKS = EMP_DURATION_TICKS
export const EMP_COOLDOWN_TICKS = SECONDS_TO_TICKS(60)

/** Length of one full day/night cycle, in game ticks, when dayNight is enabled. */
export const DAY_NIGHT_CYCLE_TICKS = SECONDS_TO_TICKS(310)
/** Duration of the dusk and dawn transition phases within the cycle. */
export const DAY_NIGHT_TRANSITION_TICKS = SECONDS_TO_TICKS(60)

export const LASER_COOLDOWN_TICKS = SECONDS_TO_TICKS(60)
export const LASER_RADIUS = 3
export const LASER_DURATION_TICKS = SECONDS_TO_TICKS(4)
export const LASER_DAMAGE_PER_TICK = 40
export const LASER_MAX_LEVEL = 2
/** Wind-up time after target selection before the beam fires, per laser level. */
export const LASER_DELAY_TICKS_LV1 = SECONDS_TO_TICKS(1)
export const LASER_DELAY_TICKS_LV2 = SECONDS_TO_TICKS(0.7)

/** Grenade bandolier: throw range (cells), blast circle, damage, fuse + cooldown. */
export const GRENADE_RANGE = 6
export const GRENADE_BLAST_RADIUS = 1.5
export const GRENADE_DAMAGE = 45
export const GRENADE_FUSE_TICKS = SECONDS_TO_TICKS(1)
export const GRENADE_COOLDOWN_TICKS = SECONDS_TO_TICKS(2.5)

/** Smoke canister: throw range, cloud radius/duration, + how shots miss. */
export const SMOKE_RANGE = 6
export const SMOKE_RADIUS = GRENADE_BLAST_RADIUS * 1.5
export const SMOKE_DURATION_TICKS = SECONDS_TO_TICKS(12)
export const SMOKE_MISS_CHANCE = 0.6
export const SMOKE_COOLDOWN_TICKS = SECONDS_TO_TICKS(4)

/** Stealth & detection. */
export const DETECTOR_COST = 200
export const DETECTOR_RANGE = 12
export const STEALTH_COST = 200
export const STEALTH_REVEAL_TICKS = SECONDS_TO_TICKS(3)

/** Mines: place/remove range, proximity trigger, blast, cost & arming delay. */
export const MINE_COST = 50
export const MINE_PLACE_RANGE = 4
export const MINE_TRIGGER_RADIUS = 1
export const MINE_BLAST_RADIUS = 2
export const MINE_DAMAGE = 60
export const MINE_ARM_TICKS = SECONDS_TO_TICKS(1.5)
export const TEAM_MINE_LIMIT = 30

/** Engineer: single-target heal per tick, aura radius/kill-rank once veteran. */
export const ENGINEER_HEAL_PER_TICK = 4
export const ENGINEER_HEAL_RANGE = 2
export const ENGINEER_HEAL_AURA_RADIUS = 2
export const ENGINEER_HEAL_RANK = 3

/** How far (in cells) an enemy entity stays visible past the edge of the currently-visible area. */
export const FOG_FADE_DISTANCE = 3

export const OIL_INCOME = 50
export const OIL_INCOME_INTERVAL_TICKS = SECONDS_TO_TICKS(10)
export const OIL_CLAIM_TICKS = SECONDS_TO_TICKS(20)

/** Day 22: extra percent a capturing team banks per supply trip from a field it holds with a scout. */
export const SUPPLY_FIELD_BONUS = 25
/** Day 22: scout presence needed (ticks) to flip a supply field's bonus to a new team. */
export const SUPPLY_FIELD_CLAIM_TICKS = SECONDS_TO_TICKS(20)
/** Day 22: scout absence tolerance (ticks) before a captured supply field drops its bonus. */
export const SUPPLY_FIELD_HOLD_TICKS = SECONDS_TO_TICKS(10)

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

/** Veterancy: kills needed to reach ranks 1–5. */
export const VETERAN_RANK1_KILLS = 3
export const VETERAN_RANK2_KILLS = 6
export const VETERAN_RANK3_KILLS = 9
export const VETERAN_RANK4_KILLS = 12
export const VETERAN_RANK5_KILLS = 15
export const VETERAN_MAX_RANK = 5
/** Veterancy: per-rank stat bonuses. rank 1 = listed values, rank N = N× them. */
export const VETERAN_DAMAGE_PER_RANK = 0.25
export const VETERAN_RANGE_PER_RANK = 0.1
export const VETERAN_ARMOR_PER_RANK = 0.2
/** Damage-reduction floor: no unit can ever reduce incoming damage below 50%. */
export const VETERAN_ARMOR_FLOOR = 0.5

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

/** Day 16: what a team's economy shares (none = today's per-member behavior). */
export const COOP_ECONOMY_OPTIONS = ['none', 'power', 'supply', 'both'] as const
export type CoopEconomy = (typeof COOP_ECONOMY_OPTIONS)[number]
/** Day 16: what a team's score/rank ladder shares. */
export const COOP_RANK_OPTIONS = ['none', 'score', 'level', 'both'] as const
export type CoopRank = (typeof COOP_RANK_OPTIONS)[number]
/** Day 16: how much of each other's stuff teammates may control. */
export const COOP_CONTROL_OPTIONS = ['none', 'units', 'all'] as const
export type CoopControl = (typeof COOP_CONTROL_OPTIONS)[number]

export interface MatchSettings {
  startingCredits: number
  oilIncome: number
  oilIncomeIntervalTicks: number
  oilClaimTicks: number
  supplyPerTrip: number
  harvesterLoadTicks: number
  /** Day 22: extra percent a team banks per trip from a supply field it holds with a scout. */
  supplyFieldBonus: number
  /** Day 22: scout presence needed to flip a supply field's bonus to a new team. */
  supplyFieldClaimTicks: number
  /** Day 22: how long a captured supply field keeps its bonus after the scout leaves. */
  supplyFieldHoldTicks: number
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
  airstrikeCooldownTicks: number
  empCooldownTicks: number
  airstrikeBombDamage: number
  airstrikeBombRadius: number
  empRadiusTiles: number
  empDurationTicks: number
  /** Free credits granted to a team each time it ranks up (0 = none). */
  rankUpPrizeCredits: number
  maxPowerTicks: number
  fogFadeDistance: number
  fogMode: FogMode
  dayNight: boolean
  dayNightCycleTicks: number
  dayNightTransitionTicks: number
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
  /** Day 20: max total build orders (active + queued) a single bulldozer may hold. */
  maxBuildOrders: number
  pathBudgetPerTick: number
  pathMaxNodes: number
  veteranRank1Kills: number
  veteranRank2Kills: number
  veteranRank3Kills: number
  veteranRank4Kills: number
  veteranRank5Kills: number
  veteranDamagePerRank: number
  veteranRangePerRank: number
  veteranArmorPerRank: number
  grenadeRange: number
  grenadeBlastRadius: number
  grenadeDamage: number
  grenadeFuseTicks: number
  grenadeCooldownTicks: number
  smokeRange: number
  smokeRadius: number
  smokeDurationTicks: number
  smokeMissChance: number
  smokeCooldownTicks: number
  detectorCost: number
  detectorRange: number
  stealthCost: number
  stealthRevealTicks: number
  mineCost: number
  minePlaceRange: number
  mineTriggerRadius: number
  mineBlastRadius: number
  mineDamage: number
  mineArmTicks: number
  mineLimit: number
  friendlyMineDamage: boolean
  engineerHealPerTick: number
  engineerHealRange: number
  engineerHealAuraRadius: number
  engineerHealRank: number
  /** Day 16: whether an alliance shares its economy (none = per-member). */
  coopEconomy: CoopEconomy
  /** Day 16: whether an alliance shares one score/rank ladder. */
  coopRank: CoopRank
  /** Day 16: how much allied control is allowed (never overrides a mid-match vote). */
  coopControl: CoopControl
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
  supplyFieldBonus: SUPPLY_FIELD_BONUS,
  supplyFieldClaimTicks: SUPPLY_FIELD_CLAIM_TICKS,
  supplyFieldHoldTicks: SUPPLY_FIELD_HOLD_TICKS,
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
  airstrikeCooldownTicks: AIRSTRIKE_COOLDOWN_TICKS,
  empCooldownTicks: EMP_COOLDOWN_TICKS,
  airstrikeBombDamage: AIRSTRIKE_BOMB_DAMAGE,
  airstrikeBombRadius: AIRSTRIKE_BOMB_RADIUS,
  empRadiusTiles: EMP_RADIUS_TILES,
  empDurationTicks: EMP_DURATION_TICKS,
  rankUpPrizeCredits: 100,
  maxPowerTicks: MAX_POWER_TICKS,
  fogFadeDistance: FOG_FADE_DISTANCE,
  fogMode: FOG_MODE_DEFAULT,
  dayNight: false,
  dayNightCycleTicks: DAY_NIGHT_CYCLE_TICKS,
  dayNightTransitionTicks: DAY_NIGHT_TRANSITION_TICKS,
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
  maxBuildOrders: 3,
  pathBudgetPerTick: 8,
  pathMaxNodes: 8000,
  veteranRank1Kills: VETERAN_RANK1_KILLS,
  veteranRank2Kills: VETERAN_RANK2_KILLS,
  veteranRank3Kills: VETERAN_RANK3_KILLS,
  veteranRank4Kills: VETERAN_RANK4_KILLS,
  veteranRank5Kills: VETERAN_RANK5_KILLS,
  veteranDamagePerRank: VETERAN_DAMAGE_PER_RANK,
  veteranRangePerRank: VETERAN_RANGE_PER_RANK,
  veteranArmorPerRank: VETERAN_ARMOR_PER_RANK,
  grenadeRange: GRENADE_RANGE,
  grenadeBlastRadius: GRENADE_BLAST_RADIUS,
  grenadeDamage: GRENADE_DAMAGE,
  grenadeFuseTicks: GRENADE_FUSE_TICKS,
  grenadeCooldownTicks: GRENADE_COOLDOWN_TICKS,
  smokeRange: SMOKE_RANGE,
  smokeRadius: SMOKE_RADIUS,
  smokeDurationTicks: SMOKE_DURATION_TICKS,
  smokeMissChance: SMOKE_MISS_CHANCE,
  smokeCooldownTicks: SMOKE_COOLDOWN_TICKS,
  detectorCost: DETECTOR_COST,
  detectorRange: DETECTOR_RANGE,
  stealthCost: STEALTH_COST,
  stealthRevealTicks: STEALTH_REVEAL_TICKS,
  mineCost: MINE_COST,
  minePlaceRange: MINE_PLACE_RANGE,
  mineTriggerRadius: MINE_TRIGGER_RADIUS,
  mineBlastRadius: MINE_BLAST_RADIUS,
  mineDamage: MINE_DAMAGE,
  mineArmTicks: MINE_ARM_TICKS,
  mineLimit: TEAM_MINE_LIMIT,
  friendlyMineDamage: false,
  engineerHealPerTick: ENGINEER_HEAL_PER_TICK,
  engineerHealRange: ENGINEER_HEAL_RANGE,
  engineerHealAuraRadius: ENGINEER_HEAL_AURA_RADIUS,
  engineerHealRank: ENGINEER_HEAL_RANK,
  coopEconomy: 'none',
  coopRank: 'none',
  coopControl: 'none',
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
