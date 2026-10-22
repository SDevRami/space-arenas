/** Single source of truth for the Dev Settings panel data.
 *
 *  Everything the panel needs to render a section — the scalar groups, the
 *  per-entity override fields, and the units/steps/ranges — lives here so the
 *  client form, the host sanitizer and the balance-mod clamps all read the same
 *  values. Editing a range or adding a field is a one-file change.
 *
 *  The UI ranges below are expressed in the units the player types (seconds when
 *  `seconds` is set). The host clamps (`DEV_SANITIZE` / `DEV_OVERRIDE_CLAMP`) are
 *  expressed in raw ticks/values and are the authoritative wire ceiling — they
 *  are intentionally wider than the UI in a few spots so balance-mod files keep
 *  working.
 */
import type { MatchSettings } from './constants.ts'

/** One editable scalar of `MatchSettings` shown in a numeric product-level section. */
export interface DevScalarFieldDef {
  key: keyof MatchSettings
  unit?: string
  min: number
  max: number
  step: number
  /** Value is stored in ticks and edited in seconds. */
  seconds?: boolean
}

export interface DevScalarSectionDef {
  /** Section title key segment: `dev.sections.<title>`. */
  title: string
  fields: DevScalarFieldDef[]
}

/** One editable field inside one of the four per-entity override maps. */
export interface DevOverrideFieldDef {
  field: string
  unit?: string
  min: number
  max: number
  step: number
  seconds?: boolean
  /** When set, the field is only shown for these entity ids. */
  only?: string[]
}

export const DEV_SCALAR_SECTIONS: DevScalarSectionDef[] = [
  {
    title: 'economy',
    fields: [
      { key: 'startingCredits', unit: 'credits', min: 100, max: 100000, step: 100 },
      { key: 'oilIncome', unit: 'credits', min: 0, max: 100000, step: 10 },
      { key: 'oilIncomeIntervalTicks', unit: 'sec', min: 0.1, max: 600, step: 0.5, seconds: true },
      { key: 'oilClaimTicks', unit: 'sec', min: 0.1, max: 600, step: 0.5, seconds: true },
      { key: 'supplyPerTrip', unit: 'units', min: 0, max: 100000, step: 10 },
      { key: 'supplyFieldCapacity', unit: 'units', min: 0, max: 100000, step: 10 },
      { key: 'supplyFieldBonus', unit: '%', min: 0, max: 1000, step: 5 },
      { key: 'supplyFieldClaimTicks', unit: 'sec', min: 0.1, max: 600, step: 0.5, seconds: true },
      { key: 'supplyFieldHoldTicks', unit: 'sec', min: 0, max: 600, step: 0.5, seconds: true },
      { key: 'harvesterLoadTicks', unit: 'sec', min: 0.1, max: 120, step: 0.1, seconds: true },
      { key: 'builderRepairPerTick', unit: 'hp/tick', min: 0, max: 100000, step: 5 },
      { key: 'sellRefundFraction', unit: '0–1', min: 0, max: 1, step: 0.05 },
      { key: 'sellTicks', unit: 'sec', min: 0, max: 300, step: 0.5, seconds: true },
      { key: 'wreckValueFraction', unit: '0–1', min: 0, max: 1, step: 0.05 },
      { key: 'wreckCollectTicks', unit: 'sec', min: 0.1, max: 300, step: 0.5, seconds: true },
      { key: 'queueLimit', unit: 'orders', min: 1, max: 50, step: 1 },
    ],
  },
  {
    title: 'satellite',
    fields: [
      { key: 'satelliteRevealTicks', unit: 'sec', min: 0.1, max: 600, step: 0.5, seconds: true },
      { key: 'satelliteCooldownTicks', unit: 'sec', min: 0, max: 600, step: 0.5, seconds: true },
    ],
  },
  {
    title: 'power',
    fields: [{ key: 'maxPowerTicks', unit: 'sec', min: 1, max: 300, step: 1, seconds: true }],
  },
  {
    title: 'laser',
    fields: [
      { key: 'laserMaxLevel', unit: 'levels', min: 1, max: 10, step: 1 },
      { key: 'laserCooldownTicks', unit: 'sec', min: 0.1, max: 600, step: 0.5, seconds: true },
      { key: 'laserRadius', unit: 'cells', min: 0.5, max: 30, step: 0.5 },
      { key: 'laserDurationTicks', unit: 'sec', min: 0.1, max: 30, step: 0.1, seconds: true },
      { key: 'laserDamagePerTick', unit: 'dmg/tick', min: 0, max: 100000, step: 10 },
      { key: 'laserDelayTicksLv1', unit: 'sec', min: 0, max: 30, step: 0.1, seconds: true },
      { key: 'laserDelayTicksLv2', unit: 'sec', min: 0, max: 30, step: 0.1, seconds: true },
    ],
  },
  {
    title: 'superWeapon',
    fields: [
      { key: 'airstrikeCooldownTicks', unit: 'sec', min: 1, max: 600, step: 1, seconds: true },
      { key: 'empCooldownTicks', unit: 'sec', min: 1, max: 600, step: 1, seconds: true },
      { key: 'airstrikeBombDamage', unit: 'dmg', min: 0, max: 100000, step: 10 },
      { key: 'airstrikeBombRadius', unit: 'cells', min: 0.5, max: 30, step: 0.5 },
      { key: 'empRadiusTiles', unit: 'cells', min: 0.5, max: 30, step: 0.5 },
      { key: 'empDurationTicks', unit: 'sec', min: 0.1, max: 60, step: 0.5, seconds: true },
    ],
  },
  {
    title: 'fog',
    fields: [{ key: 'fogFadeDistance', unit: 'cells', min: 0, max: 30, step: 1 }],
  },
  {
    title: 'abilities',
    fields: [
      { key: 'grenadeRange', unit: 'cells', min: 1, max: 30, step: 1 },
      { key: 'grenadeBlastRadius', unit: 'cells', min: 0.5, max: 10, step: 0.5 },
      { key: 'grenadeDamage', unit: 'dmg', min: 0, max: 100000, step: 10 },
      { key: 'grenadeFuseTicks', unit: 'sec', min: 0.2, max: 30, step: 0.2, seconds: true },
      { key: 'grenadeCooldownTicks', unit: 'sec', min: 0.1, max: 120, step: 0.5, seconds: true },
      { key: 'smokeRange', unit: 'cells', min: 1, max: 30, step: 1 },
      { key: 'smokeRadius', unit: 'cells', min: 0.5, max: 10, step: 0.5 },
      { key: 'smokeDurationTicks', unit: 'sec', min: 1, max: 120, step: 1, seconds: true },
      { key: 'smokeMissChance', unit: '0–1', min: 0, max: 1, step: 0.05 },
      { key: 'smokeCooldownTicks', unit: 'sec', min: 0.1, max: 120, step: 0.5, seconds: true },
    ],
  },
  {
    title: 'stealth',
    fields: [
      { key: 'detectorCost', unit: 'credits', min: 0, max: 100000, step: 50 },
      { key: 'detectorRange', unit: 'cells', min: 1, max: 100, step: 1 },
      { key: 'stealthCost', unit: 'credits', min: 0, max: 100000, step: 50 },
      { key: 'stealthRevealTicks', unit: 'sec', min: 0.1, max: 120, step: 0.5, seconds: true },
    ],
  },
  {
    title: 'dayNight',
    fields: [
      { key: 'dayNightCycleTicks', unit: 'sec', min: 30, max: 3600, step: 5, seconds: true },
      { key: 'dayNightTransitionTicks', unit: 'sec', min: 1, max: 600, step: 1, seconds: true },
    ],
  },
  {
    title: 'mines',
    fields: [
      { key: 'mineCost', unit: 'credits', min: 0, max: 100000, step: 10 },
      { key: 'minePlaceRange', unit: 'cells', min: 0.5, max: 30, step: 0.5 },
      { key: 'mineTriggerRadius', unit: 'cells', min: 0.1, max: 5, step: 0.1 },
      { key: 'mineBlastRadius', unit: 'cells', min: 0.5, max: 10, step: 0.5 },
      { key: 'mineDamage', unit: 'dmg', min: 0, max: 100000, step: 10 },
      { key: 'mineArmTicks', unit: 'sec', min: 0, max: 60, step: 0.5, seconds: true },
      { key: 'mineLimit', unit: 'units', min: 1, max: 1000, step: 1 },
      { key: 'friendlyMineDamage', unit: '0–1', min: 0, max: 1, step: 1 },
    ],
  },
  {
    title: 'heal',
    fields: [
      { key: 'engineerHealPerTick', unit: 'hp/tick', min: 0, max: 1000, step: 1 },
      { key: 'engineerHealRange', unit: 'cells', min: 0.5, max: 10, step: 0.5 },
      { key: 'engineerHealAuraRadius', unit: 'cells', min: 0.5, max: 10, step: 0.5 },
      { key: 'engineerHealRank', unit: 'levels', min: 1, max: 5, step: 1 },
    ],
  },
  {
    title: 'rank',
    fields: [
      { key: 'rankFloor1', unit: 'score', min: 0, max: 100000, step: 100 },
      { key: 'rankFloor2', unit: 'score', min: 0, max: 100000, step: 100 },
      { key: 'rankFloor3', unit: 'score', min: 0, max: 100000, step: 100 },
      { key: 'rankUpPrizeCredits', unit: 'credits', min: 0, max: 100000, step: 100 },
    ],
  },
  {
    title: 'worldFields',
    fields: [
      { key: 'supplyFieldRadius', unit: 'cells', min: 0, max: 30, step: 1 },
      { key: 'oilFieldRadius', unit: 'cells', min: 0, max: 30, step: 1 },
      { key: 'spawnRange', unit: 'cells', min: 1, max: 20, step: 1 },
      { key: 'oilFieldHp', unit: 'hp', min: 1, max: 1000000, step: 50 },
      { key: 'treeHp', unit: 'hp', min: 1, max: 100000, step: 5 },
      { key: 'rockHp', unit: 'hp', min: 1, max: 100000, step: 5 },
      { key: 'crushDamage', unit: 'dmg', min: 0, max: 10000, step: 1 },
      { key: 'workPadDistance', unit: 'cells', min: 0.5, max: 10, step: 0.5 },
      { key: 'workStuckTicks', unit: 'ticks', min: 5, max: 300, step: 5 },
      { key: 'maxBuildOrders', unit: 'orders', min: 1, max: 12, step: 1 },
    ],
  },
  {
    title: 'movement',
    fields: [
      { key: 'sepVehicle', unit: 'cells', min: 0.2, max: 5, step: 0.05 },
      { key: 'sepInfantry', unit: 'cells', min: 0.2, max: 5, step: 0.05 },
      { key: 'sepMaxPush', unit: 'cells', min: 0, max: 2, step: 0.02 },
      { key: 'buildingMarginVehicle', unit: 'cells', min: 0, max: 3, step: 0.05 },
      { key: 'buildingMarginInfantry', unit: 'cells', min: 0, max: 3, step: 0.05 },
      { key: 'fieldMargin', unit: 'cells', min: 0, max: 3, step: 0.05 },
      { key: 'samePosJitter', unit: 'cells', min: 0, max: 2, step: 0.01 },
      { key: 'lateralSepDist', unit: 'cells', min: 0, max: 2, step: 0.01 },
      { key: 'stuckRelocateRadius', unit: 'cells', min: 1, max: 30, step: 1 },
      { key: 'repathCooldownBlockedTicks', unit: 'sec', min: 0.04, max: 4, step: 0.04, seconds: true },
      { key: 'repathCooldownFailTicks', unit: 'sec', min: 0.04, max: 4, step: 0.04, seconds: true },
    ],
  },
  {
    title: 'combat',
    fields: [
      { key: 'chaseLeash', unit: 'x', min: 1, max: 10, step: 0.25 },
      { key: 'guardArriveCells', unit: 'cells', min: 0, max: 10, step: 0.1 },
      { key: 'targetBiasLastHit', unit: 'score', min: 0, max: 100000000, step: 1000000 },
      { key: 'targetBiasFocusFire', unit: 'score', min: 0, max: 10000000, step: 100000 },
      { key: 'targetBiasLowHp', unit: 'score', min: 0, max: 1000000, step: 1000 },
      { key: 'defaultSplash', unit: 'cells', min: 0, max: 10, step: 0.1 },
    ],
  },
  {
    title: 'veterancy',
    fields: [
      { key: 'veteranRank1Kills', unit: 'kills', min: 0, max: 100, step: 1 },
      { key: 'veteranRank2Kills', unit: 'kills', min: 0, max: 200, step: 1 },
      { key: 'veteranRank3Kills', unit: 'kills', min: 0, max: 300, step: 1 },
      { key: 'veteranRank4Kills', unit: 'kills', min: 0, max: 400, step: 1 },
      { key: 'veteranRank5Kills', unit: 'kills', min: 0, max: 500, step: 1 },
      { key: 'veteranDamagePerRank', unit: 'x', min: 0, max: 2, step: 0.05 },
      { key: 'veteranRangePerRank', unit: 'x', min: 0, max: 2, step: 0.05 },
      { key: 'veteranArmorPerRank', unit: '0–1', min: 0, max: 1, step: 0.05 },
    ],
  },
  {
    title: 'planes',
    fields: [
      { key: 'planeOrbitRadius', unit: 'cells', min: 0.2, max: 10, step: 0.1 },
      { key: 'planeReloadRadius', unit: 'cells', min: 1, max: 40, step: 1 },
      { key: 'planeSortieMult', unit: 'x', min: 0, max: 20, step: 0.5 },
    ],
  },
  {
    title: 'pathfinding',
    fields: [
      { key: 'pathBudgetPerTick', unit: 'orders', min: 1, max: 100, step: 1 },
      { key: 'pathMaxNodes', unit: 'nodes', min: 100, max: 200000, step: 100 },
      { key: 'astarCostStraight', unit: 'score', min: 1, max: 100, step: 1 },
      { key: 'astarCostDiagonal', unit: 'score', min: 1, max: 200, step: 1 },
    ],
  },
]

export const DEV_OVERRIDE_BUILDING_FIELDS: DevOverrideFieldDef[] = [
  { field: 'cost', unit: 'credits', min: 0, max: 1000000, step: 100 },
  { field: 'buildTimeTicks', unit: 'sec', min: 0.1, max: 900, step: 0.5, seconds: true },
  { field: 'hp', unit: 'hp', min: 1, max: 1000000, step: 100 },
  { field: 'powerGen', unit: 'power', min: 0, max: 100000, step: 10, only: ['power-plant'] },
  { field: 'powerUse', unit: 'power', min: 0, max: 100000, step: 10 },
]

export const DEV_OVERRIDE_UNIT_FIELDS: DevOverrideFieldDef[] = [
  { field: 'cost', unit: 'credits', min: 0, max: 1000000, step: 50 },
  { field: 'buildTimeTicks', unit: 'sec', min: 0.1, max: 300, step: 0.5, seconds: true },
  { field: 'hp', unit: 'hp', min: 1, max: 1000000, step: 50 },
  { field: 'speed', unit: 'cells/s', min: 1, max: 1000, step: 5 },
  { field: 'vision', unit: 'cells', min: 1, max: 100, step: 1 },
  { field: 'capacity', unit: 'units', min: 1, max: 100, step: 1, only: ['fighter'] },
  { field: 'maxAmmo', unit: 'rounds', min: 1, max: 100, step: 1, only: ['fighter'] },
  { field: 'reloadTicks', unit: 'sec', min: 0.1, max: 300, step: 0.5, seconds: true, only: ['fighter'] },
]

export const DEV_OVERRIDE_WEAPON_FIELDS: DevOverrideFieldDef[] = [
  { field: 'damage', unit: 'dmg', min: 0, max: 1000000, step: 5 },
  { field: 'cooldownTicks', unit: 'sec', min: 0.04, max: 120, step: 0.05, seconds: true },
  { field: 'range', unit: 'cells', min: 1, max: 100, step: 1 },
  { field: 'splash', unit: 'cells', min: 0, max: 100, step: 0.5, only: ['artillery'] },
]

export const DEV_OVERRIDE_UPGRADE_FIELDS: DevOverrideFieldDef[] = [
  { field: 'cost', unit: 'credits', min: 0, max: 1000000, step: 50 },
  { field: 'researchTimeTicks', unit: 'sec', min: 0.1, max: 600, step: 0.5, seconds: true },
  { field: 'requiredRank', unit: 'levels', min: 0, max: 3, step: 1 },
]

/** Host-side clamp table for every numeric `MatchSettings` scalar the host
 *  accepts from clients (dev panels, room updates and balance-mod files). Values
 *  are raw ticks/units; unspecified keys are dropped by `sanitizeSettings`. */
export const DEV_SANITIZE: Record<string, { min: number; max: number }> = {
  startingCredits: { min: 100, max: 100000 },
  oilIncome: { min: 0, max: 100000 },
  oilIncomeIntervalTicks: { min: 1, max: 100000 },
  oilClaimTicks: { min: 1, max: 100000 },
  supplyPerTrip: { min: 0, max: 100000 },
  supplyFieldBonus: { min: 0, max: 1000 },
  supplyFieldClaimTicks: { min: 1, max: 100000 },
  supplyFieldHoldTicks: { min: 0, max: 100000 },
  harvesterLoadTicks: { min: 1, max: 100000 },
  builderRepairPerTick: { min: 0, max: 100000 },
  satelliteRevealTicks: { min: 1, max: 100000 },
  satelliteCooldownTicks: { min: 0, max: 100000 },
  airstrikeCooldownTicks: { min: 0, max: 100000 },
  empCooldownTicks: { min: 0, max: 100000 },
  airstrikeBombDamage: { min: 0, max: 100000 },
  airstrikeBombRadius: { min: 0.5, max: 30 },
  empRadiusTiles: { min: 0.5, max: 30 },
  empDurationTicks: { min: 1, max: 100000 },
  laserCooldownTicks: { min: 1, max: 100000 },
  laserRadius: { min: 1, max: 100 },
  laserDurationTicks: { min: 1, max: 100000 },
  laserDamagePerTick: { min: 0, max: 1000000 },
  laserMaxLevel: { min: 1, max: 10 },
  laserDelayTicksLv1: { min: 0, max: 100000 },
  laserDelayTicksLv2: { min: 0, max: 100000 },
  maxPowerTicks: { min: 1, max: 100000 },
  rankFloor1: { min: 0, max: 100000 },
  rankFloor2: { min: 0, max: 100000 },
  rankFloor3: { min: 0, max: 100000 },
  rankUpPrizeCredits: { min: 0, max: 100000 },
  fogFadeDistance: { min: 0, max: 30 },
  dayNightCycleTicks: { min: 300, max: 36000 },
  dayNightTransitionTicks: { min: 1, max: 6000 },
  sellRefundFraction: { min: 0, max: 1 },
  queueLimit: { min: 1, max: 50 },
  supplyFieldCapacity: { min: 0, max: 100000 },
  supplyFieldRadius: { min: 0, max: 30 },
  oilFieldRadius: { min: 0, max: 30 },
  spawnRange: { min: 0, max: 20 },
  oilFieldHp: { min: 1, max: 1000000 },
  treeHp: { min: 1, max: 100000 },
  rockHp: { min: 1, max: 100000 },
  crushDamage: { min: 0, max: 10000 },
  sepVehicle: { min: 0.2, max: 5 },
  sepInfantry: { min: 0.2, max: 5 },
  sepMaxPush: { min: 0, max: 2 },
  buildingMarginVehicle: { min: 0, max: 3 },
  buildingMarginInfantry: { min: 0, max: 3 },
  fieldMargin: { min: 0, max: 3 },
  chaseLeash: { min: 1, max: 10 },
  targetBiasLastHit: { min: 0, max: 100000000 },
  targetBiasFocusFire: { min: 0, max: 10000000 },
  targetBiasLowHp: { min: 0, max: 1000000 },
  defaultSplash: { min: 0, max: 10 },
  samePosJitter: { min: 0, max: 2 },
  lateralSepDist: { min: 0, max: 2 },
  stuckRelocateRadius: { min: 1, max: 30 },
  repathCooldownBlockedTicks: { min: 1, max: 100 },
  repathCooldownFailTicks: { min: 1, max: 100 },
  astarCostStraight: { min: 1, max: 100 },
  astarCostDiagonal: { min: 1, max: 200 },
  planeOrbitRadius: { min: 0.2, max: 10 },
  planeReloadRadius: { min: 1, max: 40 },
  planeSortieMult: { min: 0, max: 20 },
  workPadDistance: { min: 0.5, max: 10 },
  workStuckTicks: { min: 5, max: 300 },
  maxBuildOrders: { min: 1, max: 12 },
  pathBudgetPerTick: { min: 1, max: 100 },
  pathMaxNodes: { min: 100, max: 200000 },
  veteranRank1Kills: { min: 0, max: 100 },
  veteranRank2Kills: { min: 0, max: 200 },
  veteranRank3Kills: { min: 0, max: 300 },
  veteranRank4Kills: { min: 0, max: 400 },
  veteranRank5Kills: { min: 0, max: 500 },
  veteranDamagePerRank: { min: 0, max: 2 },
  veteranRangePerRank: { min: 0, max: 2 },
  veteranArmorPerRank: { min: 0, max: 1 },
  grenadeRange: { min: 1, max: 30 },
  grenadeBlastRadius: { min: 0.5, max: 10 },
  grenadeDamage: { min: 0, max: 100000 },
  grenadeFuseTicks: { min: 1, max: 100000 },
  grenadeCooldownTicks: { min: 1, max: 100000 },
  smokeRange: { min: 1, max: 30 },
  smokeRadius: { min: 0.5, max: 10 },
  smokeDurationTicks: { min: 1, max: 100000 },
  smokeMissChance: { min: 0, max: 1 },
  smokeCooldownTicks: { min: 1, max: 100000 },
  detectorCost: { min: 0, max: 100000 },
  detectorRange: { min: 1, max: 100 },
  stealthCost: { min: 0, max: 100000 },
  stealthRevealTicks: { min: 1, max: 100000 },
  mineCost: { min: 0, max: 100000 },
  minePlaceRange: { min: 0.5, max: 30 },
  mineTriggerRadius: { min: 0.1, max: 5 },
  mineBlastRadius: { min: 0.5, max: 10 },
  mineDamage: { min: 0, max: 100000 },
  mineArmTicks: { min: 1, max: 100000 },
  mineLimit: { min: 1, max: 1000 },
  friendlyMineDamage: { min: 0, max: 1 },
  engineerHealPerTick: { min: 0, max: 1000 },
  engineerHealRange: { min: 0.5, max: 10 },
  engineerHealAuraRadius: { min: 0.5, max: 10 },
  engineerHealRank: { min: 1, max: 5 },
}

/** Clamp table for per-field values inside the four override maps. */
export const DEV_OVERRIDE_CLAMP: Record<string, { min: number; max: number }> = {
  cost: { min: 0, max: 1000000 },
  buildTimeTicks: { min: 1, max: 1000000 },
  researchTimeTicks: { min: 1, max: 1000000 },
  hp: { min: 1, max: 1000000 },
  powerGen: { min: 0, max: 1000000 },
  powerUse: { min: 0, max: 1000000 },
  vision: { min: 0, max: 1000 },
  speed: { min: 0, max: 100000 },
  damage: { min: 0, max: 1000000 },
  cooldownTicks: { min: 1, max: 1000000 },
  range: { min: 0, max: 100000 },
  splash: { min: 0, max: 100000 },
}
