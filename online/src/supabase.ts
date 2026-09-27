import { randomUUID } from 'node:crypto'
import { BACKUPS_MAX_PER_USER, BACKUPS_MAX_PAYLOAD_BYTES, BACKUPS_TTL_MS } from './config.ts'

// Thin Supabase client for the online server. Talks plain REST (Auth + PostgREST) so the
// server keeps zero extra dependencies and stays compatible with both the legacy `anon`/
// `service_role` keys and the newer `sb_publishable_`/`sb_secret_` formats.
//
// Nothing here is secret; the real values come from env vars (Render dashboard). When they
// are missing the helpers fail softly with `{ ok: false, ... }` so the lobby keeps working.

export interface SupabaseResult<T = unknown> {
  ok: boolean
  error?: string
  data?: T
}

const URL = process.env.SUPABASE_URL ?? ''
const ANON = process.env.SUPABASE_ANON_KEY ?? ''
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

export const dbConfigured = (): boolean => URL !== '' && ANON !== '' && SERVICE !== ''

/** fetch with a hard deadline so a dead DB never freezes the REST API. */
const timedFetch = async (path: string, init: RequestInit, ms = 4000): Promise<Response> => {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(`${URL}${path}`, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

const headers = (key: string, extra?: Record<string, string>): Record<string, string> => ({
  apikey: key,
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json',
  ...extra,
})

const authAdminHeaders = (): Record<string, string> => headers(SERVICE)
const authUserHeaders = (token: string): Record<string, string> => headers(ANON, { Authorization: `Bearer ${token}` })
const restServiceHeaders = (): Record<string, string> =>
  headers(SERVICE, { Prefer: 'resolution=merge-duplicates,return=minimal' })

/** Creates a confirmed user + profile row. Service-role so no confirmation email is needed. */
export const authRegister = async (email: string, password: string, username: string): Promise<SupabaseResult<{ id: string }>> => {
  if (!dbConfigured()) return { ok: false, error: 'database not configured' }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: 'invalid email' }
  if (password.length < 6) return { ok: false, error: 'password must be at least 6 characters' }
  const name = username.trim()
  if (name.length < 1 || name.length > 24) return { ok: false, error: 'username must be 1-24 characters' }
  try {
    const taken = await timedFetch(
      `/rest/v1/profiles?username=eq.${encodeURIComponent(name)}&select=user_id&limit=1`,
      { headers: restServiceHeaders() },
    )
    if (taken.ok) {
      const dup = (await taken.json()) as unknown[]
      if (dup.length > 0) return { ok: false, error: 'username already taken' }
    }
    const res = await timedFetch('/auth/v1/admin/users', {
      method: 'POST',
      headers: authAdminHeaders(),
      body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { username: name } }),
    })
    if (!res.ok) {
      const j = (await res.json().catch(() => null)) as { msg?: string } | null
      if (/already registered|exists/i.test(j?.msg ?? '')) return { ok: false, error: 'email already registered' }
      return { ok: false, error: j?.msg ?? `register failed (${res.status})` }
    }
    const user = (await res.json()) as { id: string }
    await upsertProfile(user.id, name).catch(() => undefined)
    return { ok: true, data: { id: user.id } }
  } catch {
    return { ok: false, error: 'database unreachable' }
  }
}

/** Exchanges email+password for a session token (works for confirmed accounts). */
export const authLogin = async (email: string, password: string): Promise<SupabaseResult<{ token: string; userId: string; email: string; username: string }>> => {
  if (!dbConfigured()) return { ok: false, error: 'database not configured' }
  try {
    const res = await timedFetch('/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: headers(ANON),
      body: JSON.stringify({ email, password }),
    })
    if (!res.ok) return { ok: false, error: res.status === 400 ? 'wrong email or password' : `login failed (${res.status})` }
    const j = (await res.json()) as { access_token: string; user: { id: string; email: string; user_metadata?: { username?: string } } }
    const meta = j.user?.user_metadata?.username
    let username = meta && meta.trim() !== '' ? meta.trim() : ''
    if (username === '') {
      const prof = await dbProfile(j.user.id).catch(() => ({ ok: false as const }))
      if (prof.ok && prof.data?.username) username = prof.data.username
    }
    return { ok: true, data: { token: j.access_token, userId: j.user.id, email: j.user.email, username } }
  } catch {
    return { ok: false, error: 'database unreachable' }
  }
}

/** Verifies a session token and returns the profile. Used to reload the account popup. */
export const authMe = async (token: string): Promise<SupabaseResult<{ userId: string; email: string; username: string; games: number; wins: number; highScore: number }>> => {
  if (!dbConfigured()) return { ok: false, error: 'database not configured' }
  try {
    const res = await timedFetch('/auth/v1/user', { headers: authUserHeaders(token) })
    if (!res.ok) return { ok: false, error: 'invalid session' }
    const user = (await res.json()) as { id: string; email: string }
    const prof = await dbProfile(user.id)
    return {
      ok: true,
      data: {
        userId: user.id,
        email: user.email,
        username: prof.ok ? prof.data?.username ?? '' : (user as { user_metadata?: { username?: string } }).user_metadata?.username ?? '',
        games: prof.ok ? prof.data?.games ?? 0 : 0,
        wins: prof.ok ? prof.data?.wins ?? 0 : 0,
        highScore: prof.ok ? prof.data?.high_score ?? 0 : 0,
      },
    }
  } catch {
    return { ok: false, error: 'database unreachable' }
  }
}

/** Updates the account password (caller must be authenticated with a live token). */
export const authChangePassword = async (token: string, newPassword: string): Promise<SupabaseResult> => {
  if (!dbConfigured()) return { ok: false, error: 'database not configured' }
  if (newPassword.length < 6) return { ok: false, error: 'password must be at least 6 characters' }
  try {
    const res = await timedFetch('/auth/v1/user', {
      method: 'PUT',
      headers: authUserHeaders(token),
      body: JSON.stringify({ password: newPassword }),
    })
    if (!res.ok) return { ok: false, error: `password change failed (${res.status})` }
    return { ok: true }
  } catch {
    return { ok: false, error: 'database unreachable' }
  }
}

const dbProfile = async (userId: string): Promise<SupabaseResult<{ username: string; games: number; wins: number; high_score: number }>> => {
  const res = await timedFetch(
    `/rest/v1/profiles?user_id=eq.${userId}&select=username,games,wins,high_score`,
    { headers: restServiceHeaders() },
  )
  if (!res.ok) return { ok: false, error: `profile read failed (${res.status})` }
  const rows = (await res.json()) as Array<{ username: string; games: number; wins: number; high_score: number }>
  if (rows.length === 0) return { ok: false, error: 'no profile' }
  return { ok: true, data: rows[0] }
}

export const upsertProfile = async (userId: string, username: string): Promise<SupabaseResult> => {
  const res = await timedFetch('/rest/v1/profiles', {
    method: 'POST',
    headers: restServiceHeaders(),
    body: JSON.stringify([{ user_id: userId, username, games: 0, wins: 0, high_score: 0 }]),
  })
  return res.ok || res.status === 201 ? { ok: true } : { ok: false, error: `profile create failed (${res.status})` }
}

export interface MatchRecord {
  map: string
  winner: number | null
  startedAt: number
  participants: Array<{ id: number; username: string; team: number; score: number; userId?: string }>
}

/** Persists a finished match and updates the bound profiles + leaderboard mirror.
 *  Best effort: never fails the match flow when the DB is down. */
export const dbRecordMatch = async (rec: MatchRecord): Promise<void> => {
  if (!dbConfigured()) return
  const logFail = (who: string, res?: Response): void => {
    const detail = res ? `${res.status} ${res.statusText}` : 'threw'
    console.error(`[db] ${who} failed (${detail})`) // eslint-disable-line no-console
  }
  try {
    const scoreMap = Object.fromEntries(rec.participants.map((p) => [p.id, p.score]))
    const matchesRes = await timedFetch('/rest/v1/matches', {
      method: 'POST',
      headers: restServiceHeaders(),
      body: JSON.stringify([
        { map: rec.map, winner: rec.winner !== null ? String(rec.winner) : null, started_at: new Date(rec.startedAt).toISOString(), participants: rec.participants, score: scoreMap },
      ]),
    }).catch(() => undefined)
    if (!matchesRes || !matchesRes.ok) logFail('matches insert', matchesRes)
    for (const p of rec.participants) {
      if (!p.userId) continue
      const row = await dbProfile(p.userId)
      if (!row.ok || !row.data) continue
      const games = row.data.games + 1
      const wins = row.data.wins + (rec.winner !== null && p.team === rec.winner ? 1 : 0)
      const high = Math.max(row.data.high_score, p.score)
      const username = row.data.username || p.username
      const profRes = await timedFetch(`/rest/v1/profiles?user_id=eq.${p.userId}`, {
        method: 'PATCH',
        headers: restServiceHeaders(),
        body: JSON.stringify({ games, wins, high_score: high }),
      }).catch(() => undefined)
      if (!profRes || !profRes.ok) logFail(`profile patch (${username})`, profRes)
      const lbRes = await timedFetch('/rest/v1/leaderboard', {
        method: 'POST',
        headers: restServiceHeaders(),
        body: JSON.stringify([{ user_id: p.userId, username, score: high }]),
      }).catch(() => undefined)
      if (!lbRes || !lbRes.ok) logFail(`leaderboard upsert (${username})`, lbRes)
    }
  } catch {
    /* the match already ended client-side; stats are best-effort */
  }
}

export const dbLeaderboard = async (limit = 100): Promise<SupabaseResult<Array<{ rank: number; username: string; score: number }>>> => {
  if (!dbConfigured()) return { ok: false, error: 'database not configured' }
  try {
    const res = await timedFetch(
      `/rest/v1/leaderboard?select=username,score&order=score.desc,username.asc&limit=${limit}`,
      { headers: restServiceHeaders() },
    )
    if (!res.ok) return { ok: false, error: `leaderboard read failed (${res.status})` }
    const rows = (await res.json()) as Array<{ username: string; score: number }>
    return { ok: true, data: rows.map((r, i) => ({ rank: i + 1, ...r })) }
  } catch {
    return { ok: false, error: 'database unreachable' }
  }
}

/** Cheap connectivity probe for the Server Setup popup / status endpoint. */
export const dbProbe = async (): Promise<boolean> => {
  if (!dbConfigured()) return false
  try {
    const res = await timedFetch('/rest/v1/profiles?select=user_id&limit=1', { headers: restServiceHeaders() }, 2500)
    return res.ok
  } catch {
    return false
  }
}

// ---- Phase 3: expiring backups -----------------------------------------------------------

export interface BackupListRow {
  id: string
  kind: string
  createdAt: string
  expiresAt: string
}

/** Inserts a backup blob owned by `userId` with a fixed 7-day TTL. Quota-checked. */
export const dbCreateBackup = async (
  userId: string,
  kind: 'devsettings' | 'profile',
  payload: string,
  passphraseHash: string,
): Promise<SupabaseResult<{ id: string; expiresAt: string }>> => {
  if (!dbConfigured()) return { ok: false, error: 'database not configured' }
  try {
    const list = await dbListBackups(userId)
    if (!list.ok) return { ok: false, error: list.error ?? 'backup list failed' }
    if ((list.data?.length ?? 0) >= BACKUPS_MAX_PER_USER) return { ok: false, error: 'backup quota reached' }
    if (Buffer.byteLength(payload, 'utf8') > BACKUPS_MAX_PAYLOAD_BYTES) return { ok: false, error: 'payload too large' }
    const id = randomUUID()
    const expiresAt = new Date(Date.now() + BACKUPS_TTL_MS).toISOString()
    const res = await timedFetch('/rest/v1/backups', {
      method: 'POST',
      headers: restServiceHeaders(),
      body: JSON.stringify([{ id, user_id: userId, kind, payload, passphrase_hash: passphraseHash, expires_at: expiresAt }]),
    })
    if (!res.ok) return { ok: false, error: `backup create failed (${res.status})` }
    return { ok: true, data: { id, expiresAt } }
  } catch {
    return { ok: false, error: 'database unreachable' }
  }
}

/** Lists the caller's backups, newest first (no payloads). */
export const dbListBackups = async (userId: string): Promise<SupabaseResult<BackupListRow[]>> => {
  if (!dbConfigured()) return { ok: false, error: 'database not configured' }
  try {
    const res = await timedFetch(
      `/rest/v1/backups?user_id=eq.${userId}&select=id,kind,created_at,expires_at&order=created_at.desc`,
      { headers: restServiceHeaders() },
    )
    if (!res.ok) return { ok: false, error: `backup list failed (${res.status})` }
    const rows = (await res.json()) as Array<{ id: string; kind: string; created_at: string; expires_at: string }>
    return {
      ok: true,
      data: rows.map((r) => ({ id: r.id, kind: r.kind, createdAt: r.created_at, expiresAt: r.expires_at })),
    }
  } catch {
    return { ok: false, error: 'database unreachable' }
  }
}

export interface BackupPayloadRow {
  id: string
  kind: string
  payload: string
  passphraseHash: string
  createdAt: string
  expiresAt: string
}

/** Fetches one of the caller's backups (ownership enforced by the user_id filter). */
export const dbGetBackup = async (userId: string, id: string): Promise<SupabaseResult<BackupPayloadRow>> => {
  if (!dbConfigured()) return { ok: false, error: 'database not configured' }
  try {
    const res = await timedFetch(
      `/rest/v1/backups?user_id=eq.${userId}&id=eq.${id}&select=id,kind,payload,passphrase_hash,created_at,expires_at&limit=1`,
      { headers: restServiceHeaders() },
    )
    if (!res.ok) return { ok: false, error: `backup read failed (${res.status})` }
    const rows = (await res.json()) as Array<{ id: string; kind: string; payload: string; passphrase_hash: string; created_at: string; expires_at: string }>
    if (!rows[0]) return { ok: false, error: 'backup not found' }
    const r = rows[0]
    return { ok: true, data: { id: r.id, kind: r.kind, payload: r.payload, passphraseHash: r.passphrase_hash, createdAt: r.created_at, expiresAt: r.expires_at } }
  } catch {
    return { ok: false, error: 'database unreachable' }
  }
}

/** Deletes one of the caller's backups (user_id filter keeps this scoped to the owner). */
export const dbDeleteBackup = async (userId: string, id: string): Promise<SupabaseResult> => {
  if (!dbConfigured()) return { ok: false, error: 'database not configured' }
  try {
    const res = await timedFetch(`/rest/v1/backups?user_id=eq.${userId}&id=eq.${id}`, {
      method: 'DELETE',
      headers: restServiceHeaders(),
    })
    // PostgREST answers 204 for bulk deletes even when no row matched; the filter already
    // guarantees we can only ever delete our own rows, so this is the idempotent OK.
    if (res.status === 204 || res.ok) return { ok: true }
    return { ok: false, error: `backup delete failed (${res.status})` }
  } catch {
    return { ok: false, error: 'database unreachable' }
  }
}

/** Removes rows past their TTL (best effort, called on an interval + lazily on read). */
export const dbPurgeExpiredBackups = async (): Promise<void> => {
  if (!dbConfigured()) return
  try {
    await timedFetch(
      `/rest/v1/backups?expires_at=lt.${new Date().toISOString()}`,
      { method: 'DELETE', headers: restServiceHeaders() },
      8000,
    ).catch(() => undefined)
  } catch {
    /* best effort */
  }
}