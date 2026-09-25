import type { BuildingOverrides, UnitOverrides, WeaponOverrides, UpgradeOverrides, MatchSettings } from './constants.ts'

/**
 * A "balance mod" is a JSON file of *deltas* that rides the same override-aware
 * accessors the dev-settings panel already uses (`getBuilding/getUnit/getWeapon/
 * getUpgrade` + the host `sanitizeSettings` whitelist). It never deep-merges whole
 * definition tables and it never changes sim logic.
 *
 * ```
 * {
 *   "meta": { "name": "...", "author": "...", "description": "...", "version": "1.0.0", "requireProtocol": 18 },
 *   "settings": { "sellRefundFraction": 0.4, "maxBuildOrders": 4 },
 *   "buildingOverrides": { "power-plant": { "cost": 400, "hp": 1600 } },
 *   "unitOverrides":     { "rifleman": { "cost": 120 } },
 *   "weaponOverrides":   { "turret-gun": { "range": 12 } },
 *   "upgradeOverrides":  { "weapon-upgrade": { "cost": 800 } }
 * }
 * ```
 */
export interface ModMetaData {
  name?: string
  author?: string
  description?: string
  version?: string
  /** Optional protocol gate: a file with a mismatching `requireProtocol` is refused. */
  requireProtocol?: number
}

export interface ModFile {
  meta?: ModMetaData
  settings?: Partial<MatchSettings>
  buildingOverrides?: Record<string, BuildingOverrides>
  unitOverrides?: Record<string, UnitOverrides>
  weaponOverrides?: Record<string, WeaponOverrides>
  upgradeOverrides?: Record<string, UpgradeOverrides>
}

export interface ModMeta {
  /** On-disk `<name>.json` filename. */
  name: string
  /** Human label: `meta.name` when present, else the bare filename. */
  label: string
  size: number
  createdAt: string
  valid: boolean
  author?: string
  description?: string
  version?: string
  /** False when the file was rejected for a `requireProtocol` mismatch. */
  protocolOk?: boolean
}

export interface ModValidation {
  ok: boolean
  errors: string[]
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

const OVERRIDE_MAP_KEYS = ['buildingOverrides', 'unitOverrides', 'weaponOverrides', 'upgradeOverrides'] as const

/** Strict JSON-only validator. Never evals; unknown fields are NOT an error here —
 *  the host's sanitizer drops unknown scalars/fields when the file is applied. */
export const isValidMod = (json: unknown, protocolVersion: number): ModValidation => {
  const errors: string[] = []
  if (!isRecord(json)) {
    return { ok: false, errors: ['mod file must be a JSON object'] }
  }
  if (json.meta !== undefined) {
    if (!isRecord(json.meta)) {
      errors.push('meta must be an object')
    } else if (json.meta.requireProtocol !== undefined) {
      if (typeof json.meta.requireProtocol !== 'number' || !Number.isFinite(json.meta.requireProtocol)) {
        errors.push('meta.requireProtocol must be a number')
      } else if (json.meta.requireProtocol !== protocolVersion) {
        errors.push('mod protocol mismatch')
      }
    }
  }
  if (json.settings !== undefined && !isRecord(json.settings)) {
    errors.push('settings must be an object')
  }
  for (const key of OVERRIDE_MAP_KEYS) {
    const map = json[key]
    if (map === undefined) continue
    if (!isRecord(map)) {
      errors.push(`${key} must be an object`)
      continue
    }
    for (const [id, fields] of Object.entries(map)) {
      if (!isRecord(fields)) {
        errors.push(`${key}.${id} must be an object`)
        continue
      }
      for (const [field, value] of Object.entries(fields)) {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          errors.push(`${key}.${id}.${field} must be a number`)
        }
      }
    }
  }
  const hasContent =
    json.settings !== undefined ||
    OVERRIDE_MAP_KEYS.some((k) => isRecord(json[k]) && Object.keys(json[k] as Record<string, unknown>).length > 0)
  if (!hasContent) errors.push('mod has no settings or overrides')
  return { ok: errors.length === 0, errors }
}

/** Field-by-field merge of two per-entity override maps (a whole entity id is not
 *  clobbered — fields from `b` win per field, `a` fills the rest). */
export const mergeEntityMaps = <T extends Record<string, number>>(
  a: Record<string, T> | undefined,
  b: Record<string, T> | undefined,
): Record<string, T> => {
  const out: Record<string, T> = { ...(a ?? {}) }
  for (const [id, fields] of Object.entries(b ?? {})) {
    out[id] = { ...(out[id] ?? {}), ...(fields as T) }
  }
  return out
}

type OverrideBase = Pick<MatchSettings, 'buildingOverrides' | 'unitOverrides' | 'weaponOverrides' | 'upgradeOverrides'>

/** Effective settings a mod contributes on top of a base settings object. Feed the
 *  result to `mergeMatchSettings` — the mod's scalar `settings` and its four override
 *  maps are pre-merged here. */
export const modSettingsDelta = (base: OverrideBase, mod: ModFile): Partial<MatchSettings> =>
  ({
    buildingOverrides: mergeEntityMaps(
      base.buildingOverrides as Record<string, Record<string, number>> | undefined,
      mod.buildingOverrides as Record<string, Record<string, number>> | undefined,
    ),
    unitOverrides: mergeEntityMaps(
      base.unitOverrides as Record<string, Record<string, number>> | undefined,
      mod.unitOverrides as Record<string, Record<string, number>> | undefined,
    ),
    weaponOverrides: mergeEntityMaps(
      base.weaponOverrides as Record<string, Record<string, number>> | undefined,
      mod.weaponOverrides as Record<string, Record<string, number>> | undefined,
    ),
    upgradeOverrides: mergeEntityMaps(
      base.upgradeOverrides as Record<string, Record<string, number>> | undefined,
      mod.upgradeOverrides as Record<string, Record<string, number>> | undefined,
    ),
    ...(mod.settings ?? {}),
  }) as Partial<MatchSettings>

/** Builds a mod file from a settings patch (used by the dev-panel "Export Mod"
 *  button — only the deviated scalar keys + the four override maps are emitted). */
export const modFromSettings = (patch: Partial<MatchSettings>, meta: ModMetaData): ModFile => {
  const { buildingOverrides, unitOverrides, weaponOverrides, upgradeOverrides, ...scalars } = patch
  const settings: Partial<MatchSettings> = {}
  for (const [key, value] of Object.entries(scalars)) {
    if (value !== undefined) (settings as Record<string, unknown>)[key] = value
  }
  return {
    meta,
    settings,
    ...(buildingOverrides && Object.keys(buildingOverrides).length > 0 ? { buildingOverrides } : {}),
    ...(unitOverrides && Object.keys(unitOverrides).length > 0 ? { unitOverrides } : {}),
    ...(weaponOverrides && Object.keys(weaponOverrides).length > 0 ? { weaponOverrides } : {}),
    ...(upgradeOverrides && Object.keys(upgradeOverrides).length > 0 ? { upgradeOverrides } : {}),
  }
}