import {
  COOP_CONTROL_OPTIONS,
  COOP_ECONOMY_OPTIONS,
  COOP_RANK_OPTIONS,
  FOG_MODES,
  DEV_OVERRIDE_CLAMP as OVERRIDE_CLAMP,
  DEV_SANITIZE as SANITIZE,
  type MatchSettings,
} from '@space-arenas/shared'

/** The dev-settings clamp tables live in the shared registry
 *  (`shared/src/dev-settings-registry.ts`) so the client form, the host and the
 *  online server all read the same ranges. Re-exported for existing callers. */
export { OVERRIDE_CLAMP, SANITIZE }

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
