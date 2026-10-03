// Server-wide limits (Phase 3: expiring backups + abuse hardening).
// Tuned for a small community; purely a deterrence layer on a single Render instance.

/** How long a backup stays restorable (player sees the countdown in the Data tab). */
export const BACKUPS_TTL_DAYS = 7
export const BACKUPS_TTL_MS = BACKUPS_TTL_DAYS * 24 * 60 * 60 * 1000
/** Per-account storage cap. */
export const BACKUPS_MAX_PER_USER = 10
export const BACKUPS_MAX_PAYLOAD_BYTES = 64 * 1024
/** Cadence of the expired-row purge. */
export const BACKUPS_PURGE_INTERVAL_MS = 10 * 60 * 1000

// Rate limits (per minute, sliding window). Keyed by client IP (and account for login).
// Overridable via SA_RATE_* so the test harness can raise them without touching prod defaults.
export const RATE_AUTH_PER_MIN = 5 // register / login / change-password
export const RATE_LOGIN_PER_ACCOUNT_MIN = 10 // brute-force / password-spray guard
export const RATE_ROOM_WRITE_PER_MIN = Number(process.env.SA_RATE_ROOM_WRITE_PER_MIN ?? 10) // create room + join pre-check
export const RATE_WS_HANDSHAKE_PER_MIN = Number(process.env.SA_RATE_WS_HANDSHAKE_PER_MIN ?? 20)
export const RATE_BACKUP_POST_PER_MIN = 10
export const RATE_READ_PER_MIN = 60 // /api/auth/me + /api/leaderboard

// Phase 4: mod repository + landing page.
export const MOD_COMMENT_MAX_CHARS = 500
export const RATE_MOD_REPO_PER_MIN = 60 // browse/list/search + single mod fetch
export const RATE_MOD_DOWNLOAD_PER_MIN = 60
export const RATE_MOD_WRITE_PER_MIN = 10 // upload / delete / rate / comment

// Phase 5: map repository (companion to the mod repository).
export const MAP_COMMENT_MAX_CHARS = 500
export const RATE_MAP_REPO_PER_MIN = 60 // browse/list/search + single map fetch
export const RATE_MAP_DOWNLOAD_PER_MIN = 60
export const RATE_MAP_WRITE_PER_MIN = 10 // publish / delete / rate / comment

// Cross-origin allow-list (Phase 4). Render serves the game + landing on GitHub Pages;
// when set (comma-separated origins) the API echoes the matching Origin instead of `*`.
// When unset the server keeps `*` (local/LAN dev) so existing builds keep working.
export const CORS_ALLOW_SOURCES: string[] = (process.env.SA_CORS_ALLOW ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s !== '')