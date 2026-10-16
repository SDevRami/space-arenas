/** `profile/settings.json` — the dev-settings defaults layer.
 *
 *  Mirror of `shared/src/settings-file.ts` (see that file for the full docs).
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
 *  match the host's. */
export const fingerprintSettings = (settings: Partial<MatchSettings>): string =>
  crc32(new TextEncoder().encode(canonicalJson(settings))).toString(16).padStart(8, '0')
