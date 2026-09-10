import { BUILDINGS, getBuilding } from './buildings.ts'
import { UNITS, getUnit } from './units.ts'
import { WEAPONS, getWeapon } from './weapons.ts'
import { UPGRADES, getUpgrade } from './upgrades.ts'
import type { MatchSettings } from '../constants.ts'

export const getBuildingDef = (id: string, settings?: Pick<MatchSettings, 'buildingOverrides'>) => getBuilding(id, settings)

export const getUnitDef = (id: string, settings?: Pick<MatchSettings, 'unitOverrides'>) => getUnit(id, settings)

export const getWeaponDef = (id: string, settings?: Pick<MatchSettings, 'weaponOverrides'>) => getWeapon(id, settings)

export const getUpgradeDef = (id: string, settings?: Pick<MatchSettings, 'upgradeOverrides'>) => getUpgrade(id, settings)

export const validateBalance = (): string[] => {
  const errors: string[] = []
  for (const b of Object.values(BUILDINGS)) {
    if (b.weapon && !WEAPONS[b.weapon]) errors.push(`building ${b.id}: missing weapon ${b.weapon}`)
    if (b.producesUnit && !UNITS[b.producesUnit]) errors.push(`building ${b.id}: missing unit ${b.producesUnit}`)
    if (b.cost < 0) errors.push(`building ${b.id}: negative cost`)
    if (b.footprint[0] < 1 || b.footprint[1] < 1) errors.push(`building ${b.id}: bad footprint`)
  }
  for (const u of Object.values(UNITS)) {
    if (u.weapon && !WEAPONS[u.weapon]) errors.push(`unit ${u.id}: missing weapon ${u.weapon}`)
    if (!BUILDINGS[u.producedBy]) errors.push(`unit ${u.id}: missing producer ${u.producedBy}`)
    if (u.cost < 0) errors.push(`unit ${u.id}: negative cost`)
  }
  for (const u of Object.values(UPGRADES)) {
    if (!BUILDINGS[u.availableAt]) errors.push(`upgrade ${u.id}: missing building ${u.availableAt}`)
    if (u.cost < 0) errors.push(`upgrade ${u.id}: negative cost`)
  }
  return errors
}

export { BUILDINGS, UNITS, WEAPONS, UPGRADES }
export { getBuilding } from './buildings.ts'
export { getUnit, canThrowBandolier } from './units.ts'
export { getWeapon } from './weapons.ts'
export { getUpgrade } from './upgrades.ts'
export { UNIT_IDS, type UnitId } from './units.ts'
export { BUILDING_IDS, type BuildingId } from './buildings.ts'
