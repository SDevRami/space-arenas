/** `profile/settings.json` — the dev-settings defaults layer.
 *
 *  The panel's "Save as default" writes this file (via the host `/api/settings`
 *  endpoint) so the defaults survive a fresh browser origin / port change instead
 *  of living only in this origin's localStorage.
 *
 *  ```
 *  {
 *    "v": 1,
 *    "builtin": { "startingCredits": 5000 },     // shipped/base layer
 *    "user":    { "sellRefundFraction": 0.4 },   // per-player override layer
 *    "client":  { "graphics": {}, "audio": {}, "profile": {} }
 *  }
 *  ```
 *
 *  Resolution: `builtin` then `user` are layered over the compiled
 *  `DEFAULT_MATCH_SETTINGS`. When `/api/settings` is unavailable (static hosting,
 *  online-only) the client falls back to compiled defaults + localStorage.
 */
import type { MatchSettings } from './constants.ts'
import { crc32 } from './protocol.ts'
import { canonicalJson } from './mod.ts'

/** The non-synced ("client-only") dev values that ride along in `settings.json`
 *  and, later, in the wire clone/mod blobs. Every store is a loose JSON map so the
 *  client owns the shape; the shared layer only carries it. */
export interface ClientDevSettings {
  graphics?: Record<string, unknown>
  audio?: Record<string, unknown>
  profile?: Record<string, unknown>
}

export interface MatchSettingsFile {
  v?: number
  builtin?: Partial<MatchSettings>
  user?: Partial<MatchSettings>
  client?: ClientDevSettings
}

/** Layers `builtin` then `user` (does NOT fill in the compiled defaults — the
 *  caller merges with `mergeMatchSettings`). */
export const resolveSettingsFileLayers = (file: MatchSettingsFile | null | undefined): Partial<MatchSettings> => ({
  ...(file?.builtin ?? {}),
  ...(file?.user ?? {}),
})

/** Deterministic crc32 (hex) of a settings object — the "effective defaults"
 *  identity broadcast in the lobby so a client can tell whether its own defaults
 *  match the host's. Must stay byte-identical to what the client already uses for
 *  its per-player sync chips. */
export const fingerprintSettings = (settings: Partial<MatchSettings>): string =>
  crc32(new TextEncoder().encode(canonicalJson(settings))).toString(16).padStart(8, '0')

/** True when `value` is an absolute URL (`http(s)://` / protocol-relative) that
 *  resolves to an origin other than `baseOrigin`. Empty / relative / same-origin
 *  values are not foreign. */
const isForeignAbsoluteUrl = (value: string, baseOrigin: string): boolean => {
  const v = value.trim()
  if (!v) return false
  if (!/^https?:\/\//i.test(v) && !v.startsWith('//')) return false
  try {
    return new URL(v, baseOrigin).origin !== baseOrigin
  } catch {
    return true
  }
}

/** Path-like values are sanitized wherever client values cross machines (clone,
 *  mod, `settings.json` import). Returns a COPY of `client` with every
 *  foreign-origin absolute asset/audio URL neutralised to `''` (which the stores
 *  read as "use the bundled default"). Relative (`sound/x.wav`) and same-origin
 *  (`/hud/x.png`) values pass through untouched; non-string values are untouched.
 *  `baseOrigin` defaults to the current page origin (empty on the server, which
 *  then drops every absolute URL — the safe server-side default). */
export const sanitizeClientDevSettings = (
  client: ClientDevSettings | undefined,
  baseOrigin?: string,
): ClientDevSettings | undefined => {
  if (!client) return client
  // `globalThis.location` exists only in a browser; on the server (and in tests)
  // the origin stays '' so every absolute URL is neutralised.
  const origin = baseOrigin ?? (globalThis as { location?: { origin?: string } }).location?.origin ?? ''
  const scrub = (value: unknown): unknown => {
    if (typeof value === 'string') return isForeignAbsoluteUrl(value, origin) ? '' : value
    if (Array.isArray(value)) return value.map(scrub)
    if (value !== null && typeof value === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = scrub(v)
      return out
    }
    return value
  }
  return scrub(client) as ClientDevSettings
}
