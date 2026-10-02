import type { MatchSettings } from '../constants.ts'

/** Cosmetic projectile visual class chosen by the renderer for a weapon's tracer. */
export type ProjectileKind = 'bullet' | 'rocket' | 'shell'

export interface WeaponDef {
  id: string
  damage: number
  cooldownTicks: number
  range: number
  splash?: number
  targetsAir?: boolean
  /** Visual projectile kind: simple tracer (bullet), fire-and-smoke rocket, or arched heavy shell. */
  projectile?: ProjectileKind
}

export const WEAPONS: Record<string, WeaponDef> = {
  rifle: { id: 'rifle', damage: 12, cooldownTicks: 10, range: 6, projectile: 'bullet' },
  rocket: { id: 'rocket', damage: 25, cooldownTicks: 20, range: 7, projectile: 'rocket' },
  cannon: { id: 'cannon', damage: 40, cooldownTicks: 15, range: 7, projectile: 'bullet' },
  aa: { id: 'aa', damage: 18, cooldownTicks: 10, range: 8, targetsAir: true, projectile: 'bullet' },
  artillery: { id: 'artillery', damage: 60, cooldownTicks: 45, range: 12, splash: 1.5, projectile: 'shell' },
  'turret-gun': { id: 'turret-gun', damage: 20, cooldownTicks: 12, range: 8, targetsAir: true, projectile: 'bullet' },
  'bunker-gun': { id: 'bunker-gun', damage: 22, cooldownTicks: 12, range: 8, targetsAir: true, projectile: 'bullet' },
  'air-cannon': { id: 'air-cannon', damage: 45, cooldownTicks: 30, range: 7, projectile: 'rocket' },
  'sea-missile': { id: 'sea-missile', damage: 60, cooldownTicks: 40, range: 9, splash: 1.5, projectile: 'rocket' },
}

export const getWeapon = (id: string, settings?: Pick<MatchSettings, 'weaponOverrides'>): WeaponDef => {
  const def = WEAPONS[id]
  if (!def) throw new Error(`unknown weapon: ${id}`)
  return { ...def, ...(settings?.weaponOverrides?.[id] ?? {}) }
}
