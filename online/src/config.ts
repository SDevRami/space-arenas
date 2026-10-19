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
export const RATE_AUTH_PER_MIN = Number(process.env.SA_RATE_AUTH_PER_MIN ?? 5) // register / login / change-password
export const RATE_LOGIN_PER_ACCOUNT_MIN = 10 // brute-force / password-spray guard
export const RATE_ROOM_WRITE_PER_MIN = Number(process.env.SA_RATE_ROOM_WRITE_PER_MIN ?? 10) // create room + join pre-check (per IP)
/** Same room-write budget keyed on the verified account, so one account cannot spam rooms
 *  by rotating IPs — which the IP-only limit above cannot see. */
export const RATE_ROOM_WRITE_PER_ACCOUNT_MIN = Number(process.env.SA_RATE_ROOM_WRITE_PER_ACCOUNT_MIN ?? 10)
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

// --- Feature flags (Phase 6). Dashboard-set so the values change without a redeploy. ---

/** Parses a boolean env var; empty/undefined falls back to `fallback`. */
const boolEnv = (raw: string | undefined, fallback: boolean): boolean => {
  if (raw === undefined || raw.trim() === '') return fallback
  return /^(1|true|yes|on)$/i.test(raw.trim())
}

/** Community publishing (mods + maps). Off for the first public release; flip on later. */
export const PUBLISHING_ENABLED = boolEnv(process.env.SA_ENABLE_PUBLISHING, false)

/** Tester phase: while true, only allow-listed emails may create a new account.
 *  Login is never affected — existing accounts keep working. */
export const TESTERS_ONLY = boolEnv(process.env.SA_TESTERS, true)

/** Emails allowed to register while `TESTERS_ONLY` is on (comma-separated, case-insensitive).
 *  Empty + `TESTERS_ONLY` means registration is closed until the flag is flipped. */
export const TESTER_EMAILS: string[] = (process.env.SA_TESTER_EMAILS ?? '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter((s) => s !== '')

/** Whether a brand-new account may be created for `email` right now. */
export const registrationAllowed = (email: string): boolean =>
  !TESTERS_ONLY || TESTER_EMAILS.includes(email.trim().toLowerCase())

// Accounts.
/** Username length bound, enforced on set/register and mirrored by both client UIs. */
export const USERNAME_MAX_CHARS = 24

/** Reserved usernames nobody may take (comma-separated, trimmed, case-insensitive). Staff /
 *  official-looking handles live here so a player cannot impersonate them. Set on Render, e.g.
 *  `SA_FORBIDDEN_USERNAME=sdevrami,developer,owner`. */
export const FORBIDDEN_USERNAMES: string[] = (process.env.SA_FORBIDDEN_USERNAME ?? '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter((s) => s !== '')

/** True when `username` *contains* a reserved token (case-insensitive, surrounding space ignored).
 *  Substring match (which includes the prefix case), so `admin` blocks `admin2`, `the_admin` and
 *  `superadmin`. Keep the tokens distinctive — a short token like `mod` also blocks `Commander`. */
export const isForbiddenUsername = (username: string): boolean => {
  const name = username.trim().toLowerCase()
  return name !== '' && FORBIDDEN_USERNAMES.some((token) => name.includes(token))
}

/** Retention for `public.matches` (the JSONB-heavy raw match log): keep only the newest N rows.
 *  Overridable via `SA_MATCHES_MAX_ROWS`; `0` disables trimming (keep forever). Default 100. */
export const MATCHES_MAX_ROWS: number = (() => {
  const raw = process.env.SA_MATCHES_MAX_ROWS
  if (raw === undefined || raw.trim() === '') return 100
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 100
})()

// --- Admin dashboard (Phase 7: read-only ops view served at /admin). ---
/** Dashboard password. Empty (the default) disables the whole admin surface, so a
 *  deployment that never sets it exposes nothing. Set this on Render to switch it on. */
export const ADMIN_PASSWORD = process.env.SA_ADMIN_PASSWORD ?? ''
export const ADMIN_ENABLED = ADMIN_PASSWORD.trim() !== ''
/** Admin session lifetime (12h). Deliberately not env-tunable — rotate the password to revoke. */
export const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000
// Per-IP rate limits for the admin endpoints; overridable so the test harness can raise them.
export const RATE_ADMIN_LOGIN_PER_MIN = Number(process.env.SA_RATE_ADMIN_LOGIN_PER_MIN ?? 5)
export const RATE_ADMIN_STATS_PER_MIN = Number(process.env.SA_RATE_ADMIN_STATS_PER_MIN ?? 60)