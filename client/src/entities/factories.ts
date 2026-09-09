import { getBuilding, getUnit, getWeapon, tileToFx, type WeaponDef } from '@space-arenas/shared'
import type {
  AttackComp,
  BuildingComp,
  HealthComp,
  MoveComp,
  TransformComp,
  UnitComp,
  VisionComp,
  World,
} from '../core/world.ts'

export const rectFromCenter = (cxFx: number, cyFx: number, wTiles: number, hTiles: number) => {
  const x = Math.floor((cxFx - wTiles * 500) / 1000)
  const y = Math.floor((cyFx - hTiles * 500) / 1000)
  return { x, y, w: wTiles, h: hTiles }
}

export const rectsOverlap = (
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

export const rectDistanceTiles = (
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): number => {
  const dx = Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w), 0)
  const dy = Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h), 0)
  return dx + dy
}

export const buildingRect = (world: World, id: number) => {
  const b = world.buildings.require(id)
  const t = world.transforms.require(id)
  return rectFromCenter(t.x, t.y, b.footprintW, b.footprintH)
}

export const spawnUnit = (
  world: World,
  unitType: string,
  team: number,
  x: number,
  y: number,
): number => {
  const def = getUnit(unitType, world.settings)
  const id = world.createEntity('unit', team)
  const t: TransformComp = { x, y }
  const u: UnitComp = { unitType, team, speed: def.speed, class: def.class, isHarvester: !!def.isHarvester, killCount: 0, veteranRank: 0, stealth: false, revealedUntil: 0, abilityCooldown: 0 }
  const h: HealthComp = { hp: def.hp, maxHp: def.hp }
  const v: VisionComp = { radius: def.vision }
  world.transforms.set(id, t)
  world.units.set(id, u)
  world.healths.set(id, h)
  world.visions.set(id, v)
  if (def.weapon) {
    const w: WeaponDef = getWeapon(def.weapon, world.settings)
    const a: AttackComp = { weaponId: def.weapon, cooldownTicks: w.cooldownTicks, currentCooldown: 0, target: null, targetPos: null, lastHit: -1, keepAttack: null, guardMode: false, guardPost: null }
    world.attacks.set(id, a)
  }
  return id
}

export const spawnBuilding = (
  world: World,
  buildingType: string,
  team: number,
  tileX: number,
  tileY: number,
  done: boolean,
): number => {
  const def = getBuilding(buildingType, world.settings)
  const id = world.createEntity('building', team)
  const cx = tileToFx(tileX) + (def.footprint[0] * 1000) / 2
  const cy = tileToFx(tileY) + (def.footprint[1] * 1000) / 2
  const t: TransformComp = { x: cx, y: cy }
  const b: BuildingComp = {
    buildingType,
    team,
    footprintW: def.footprint[0],
    footprintH: def.footprint[1],
    buildProgress: done ? 1 : 0,
    done,
    powerGen: def.powerGen,
    powerUse: def.powerUse,
    researching: '',
    researchTicks: 0,
    assignedDozer: 0,
    spawnTx: -1,
    spawnTy: -1,
    flagTx: -1,
    flagTy: -1,
    maxPowerUntil: -1,
    maxPowerHpTarget: -1,
    sellingUntil: 0,
    detector: false,
  }
  const h: HealthComp = { hp: def.hp, maxHp: def.hp }
  world.transforms.set(id, t)
  world.buildings.set(id, b)
  world.healths.set(id, h)
  world.visions.set(id, { radius: 8 })
  if (def.weapon) {
    const w: WeaponDef = getWeapon(def.weapon, world.settings)
    const a: AttackComp = { weaponId: def.weapon, cooldownTicks: w.cooldownTicks, currentCooldown: 0, target: null, targetPos: null, lastHit: -1, keepAttack: null, guardMode: false, guardPost: null }
    world.attacks.set(id, a)
  }
  world.markGridDirty()
  return id
}

export const setMove = (world: World, id: number, tx: number, ty: number, attackMove = false): MoveComp => {
  const m: MoveComp = { tx, ty, path: [], pathIndex: 0, attackMove, needsPath: false, chase: false, repathCooldown: 0 }
  world.moves.set(id, m)
  return m
}
