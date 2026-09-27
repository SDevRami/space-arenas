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
export const RATE_AUTH_PER_MIN = 5 // register / login / change-password
export const RATE_LOGIN_PER_ACCOUNT_MIN = 10 // brute-force / password-spray guard
export const RATE_ROOM_WRITE_PER_MIN = 10 // create room + join pre-check
export const RATE_WS_HANDSHAKE_PER_MIN = 20
export const RATE_BACKUP_POST_PER_MIN = 10
export const RATE_READ_PER_MIN = 60 // /api/auth/me + /api/leaderboard