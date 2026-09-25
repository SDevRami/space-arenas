import { COOP_CONTROL_OPTIONS, COOP_ECONOMY_OPTIONS, COOP_RANK_OPTIONS, FOG_MODES, type MatchSettings } from '@space-arenas/shared'

/** Whitelist + clamp table for every numeric `MatchSettings` scalar the host accepts
 *  from clients (dev panels, room updates and balance-mod files all go through it). */
export const SANITIZE: Record<string, { min: number; max: number }> = {
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
export const OVERRIDE_CLAMP: Record<string, { min: number; max: number }> = {
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

const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v))

export const sanitizeOverrideMaps = (patch: Partial<MatchSettings>): Partial<MatchSettings> => {
  const out: Partial<MatchSettings> = {}
  const keys = ['buildingOverrides', 'unitOverrides', 'weaponOverrides', 'upgradeOverrides'] as const
  for (const key of keys) {
    const map = (patch as Record<string, unknown>)[key]
    if (!map || typeof map !== 'object') continue
    const clean: Record<string, Record<string, number>> = {}
    for (const [id, overrides] of Object.entries(map as Record<string, unknown>)) {
      if (!overrides || typeof overrides !== 'object') continue
      const entry: Record<string, number> = {}
      for (const [k, v] of Object.entries(overrides as Record<string, unknown>)) {
        const spec = OVERRIDE_CLAMP[k]
        if (spec && typeof v === 'number' && Number.isFinite(v)) {
          entry[k] = clamp(v, spec.min, spec.max)
        }
      }
      if (Object.keys(entry).length > 0) clean[id] = entry
    }
    ;(out as Record<string, unknown>)[key] = clean
  }
  return out
}

export const sanitizeSettings = (patch: Partial<MatchSettings>): Partial<MatchSettings> => {
  const out: Partial<MatchSettings> = {}
  for (const key of Object.keys(SANITIZE)) {
    const value = (patch as Record<string, unknown>)[key]
    if (typeof value === 'number' && Number.isFinite(value)) {
      const { min, max } = SANITIZE[key]
      ;(out as Record<string, number>)[key] = clamp(value, min, max)
    }
  }
  if (patch.fogMode && (FOG_MODES as readonly string[]).includes(patch.fogMode)) out.fogMode = patch.fogMode
  if (typeof patch.dayNight === 'boolean') out.dayNight = patch.dayNight
  if ((COOP_ECONOMY_OPTIONS as readonly string[]).includes(patch.coopEconomy as string)) out.coopEconomy = patch.coopEconomy
  if ((COOP_RANK_OPTIONS as readonly string[]).includes(patch.coopRank as string)) out.coopRank = patch.coopRank
  if ((COOP_CONTROL_OPTIONS as readonly string[]).includes(patch.coopControl as string)) out.coopControl = patch.coopControl
  return { ...out, ...sanitizeOverrideMaps(patch) }
}