import { randomUUID } from 'node:crypto'
import { BACKUPS_MAX_PER_USER, BACKUPS_MAX_PAYLOAD_BYTES, BACKUPS_TTL_MS } from './config.ts'
import { MODS_MAX_PER_USER } from './mods.ts'
import { MAPS_MAX_PER_USER } from './maps.ts'

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

/** Total registered accounts (profile rows). Returns null when the DB is unavailable. */
export const dbProfileCount = async (): Promise<number | null> => {
  if (!dbConfigured()) return null
  try {
    const res = await timedFetch(
      '/rest/v1/profiles?select=user_id&limit=1000',
      { headers: headers(SERVICE, { Prefer: 'count=exact' }) },
      2500,
    )
    if (!res.ok) return null
    // Prefer PostgREST's exact count header; fall back to the returned rows (GET always
    // returns the body) in case the header is stripped on some proxy/gateway.
    const total = Number(res.headers.get('content-range')?.split('/')[1] ?? NaN)
    if (Number.isFinite(total)) return total
    const rows = (await res.json().catch(() => [])) as unknown[]
    return rows.length
  } catch {
    return null
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

// ---- Phase 4: community mod repository ------------------------------------------------

const ilikeEscaped = (q: string): string => q.replace(/[\\*]/g, '\\$&')

export interface ModRepoRow {
  id: string
  ownerId: string
  /** The publisher's account username (from `profiles`), empty if unknown. */
  ownerName: string
  name: string
  author: string
  description: string
  version: string
  sizeBytes: number
  requireProtocol: number
  downloads: number
  ratingAvg: number | null
  ratingCount: number
  createdAt: string
}

/** Reads the repo listing (payload-free) with rating aggregates merged in. */
export const dbListMods = async (
  opts: { q?: string; sort?: string; owner?: string; limit?: number } = {},
): Promise<SupabaseResult<ModRepoRow[]>> => {
  if (!dbConfigured()) return { ok: false, error: 'database not configured' }
  const sort = opts.sort === 'rating' || opts.sort === 'downloads' ? opts.sort : 'newest'
  const limit = Math.max(1, Math.min(250, opts.limit ?? 100))
  try {
    let url = '/rest/v1/mods?select=id,owner_id,name,meta_author,meta_description,meta_version,size_bytes,require_protocol,downloads,created_at'
    if (opts.owner) url += `&owner_id=eq.${encodeURIComponent(opts.owner)}`
    const q = opts.q?.trim()
    if (q && q !== '') {
      const term = ilikeEscaped(q)
      url += `&or=(name.ilike.*${term}*,meta_author.ilike.*${term}*)`
    }
    url += opts.sort === 'downloads' ? '&order=downloads.desc,name.asc' : '&order=created_at.desc,name.asc'
    url += `&limit=${limit}`
    const res = await timedFetch(url, { headers: restServiceHeaders() })
    if (!res.ok) return { ok: false, error: `mod list failed (${res.status})` }
    const rows = (await res.json()) as Array<{
      id: string
      owner_id: string
      name: string
      meta_author: string
      meta_description: string
      meta_version: string
      size_bytes: number
      require_protocol: number
      downloads: number
      created_at: string
    }>
    const ratings = await timedFetch('/rest/v1/mod_ratings?select=mod_id,rating', { headers: restServiceHeaders() })
    const sum = new Map<string, number>()
    const count = new Map<string, number>()
    if (ratings.ok) {
      for (const r of (await ratings.json()) as Array<{ mod_id: string; rating: number }>) {
        sum.set(r.mod_id, (sum.get(r.mod_id) ?? 0) + r.rating)
        count.set(r.mod_id, (count.get(r.mod_id) ?? 0) + 1)
      }
    }
    // Merge the publisher account username (profiles) so the UI can show "by @name".
    const ownerIds = Array.from(new Set(rows.map((r) => r.owner_id).filter((x) => x !== '')))
    const nameById = new Map<string, string>()
    if (ownerIds.length > 0) {
      const prof = await timedFetch(
        `/rest/v1/profiles?user_id=in.(${ownerIds.map(encodeURIComponent).join(',')})&select=user_id,username`,
        { headers: restServiceHeaders() },
      )
      if (prof.ok) {
        for (const p of (await prof.json()) as Array<{ user_id: string; username: string }>)
          nameById.set(p.user_id, p.username)
      }
    }
    const data: ModRepoRow[] = rows.map((r) => {
      const c = count.get(r.id) ?? 0
      return {
        id: r.id,
        ownerId: r.owner_id,
        ownerName: nameById.get(r.owner_id) ?? '',
        name: r.name,
        author: r.meta_author,
        description: r.meta_description,
        version: r.meta_version,
        sizeBytes: r.size_bytes,
        requireProtocol: r.require_protocol,
        downloads: r.downloads,
        ratingAvg: c > 0 ? Math.round(((sum.get(r.id) ?? 0) / c) * 10) / 10 : null,
        ratingCount: c,
        createdAt: r.created_at,
      }
    })
    if (sort === 'rating') {
      data.sort((a, b) => (b.ratingAvg ?? -1) - (a.ratingAvg ?? -1) || b.downloads - a.downloads || a.name.localeCompare(b.name))
    }
    return { ok: true, data }
  } catch {
    return { ok: false, error: 'database unreachable' }
  }
}

/** Full ModFile fetch for the download path; also bumps the download counter. */
export const dbGetMod = async (id: string): Promise<SupabaseResult<{ id: string; name: string; payload: unknown; requireProtocol: number }>> => {
  if (!dbConfigured()) return { ok: false, error: 'database not configured' }
  try {
    const res = await timedFetch(
      `/rest/v1/mods?id=eq.${encodeURIComponent(id)}&select=id,name,payload,require_protocol,downloads&limit=1`,
      { headers: restServiceHeaders() },
    )
    if (!res.ok) return { ok: false, error: `mod read failed (${res.status})` }
    const rows = (await res.json()) as Array<{ id: string; name: string; payload: unknown; require_protocol: number; downloads: number }>
    if (!rows[0]) return { ok: false, error: 'mod not found' }
    const r = rows[0]
    await timedFetch(`/rest/v1/mods?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: headers(SERVICE, { Prefer: 'return=minimal' }),
      body: JSON.stringify({ downloads: r.downloads + 1 }),
    }).catch(() => undefined)
    return { ok: true, data: { id: r.id, name: r.name, payload: r.payload, requireProtocol: r.require_protocol } }
  } catch {
    return { ok: false, error: 'database unreachable' }
  }
}

/** Publishes a sanitized mod (quota + name-collision checked here). */
export const dbCreateMod = async (
  userId: string,
  mod: { name: string; author: string; description: string; version: string; requireProtocol: number; sizeBytes: number; payload: unknown },
): Promise<SupabaseResult<{ id: string }>> => {
  if (!dbConfigured()) return { ok: false, error: 'database not configured' }
  try {
    const countRes = await timedFetch(
      `/rest/v1/mods?owner_id=eq.${encodeURIComponent(userId)}&select=id&limit=1`,
      { headers: { ...headers(SERVICE), Prefer: 'count=exact,return=minimal' } },
    )
    const total = Number(countRes.headers.get('content-range')?.split('/')[1] ?? 0)
    if (total >= MODS_MAX_PER_USER) return { ok: false, error: 'mod quota reached' }
    const res = await timedFetch('/rest/v1/mods', {
      method: 'POST',
      headers: restServiceHeaders(),
      body: JSON.stringify([
        {
          owner_id: userId,
          name: mod.name,
          meta_author: mod.author,
          meta_description: mod.description,
          meta_version: mod.version,
          size_bytes: mod.sizeBytes,
          require_protocol: mod.requireProtocol,
          payload: mod.payload,
        },
      ]),
    })
    if (res.status === 409) return { ok: false, error: 'name already taken' }
    if (!res.ok) return { ok: false, error: `mod create failed (${res.status})` }
    const rows = (await res.json().catch(() => [])) as Array<{ id: string }>
    return { ok: true, data: { id: rows[0]?.id ?? '' } }
  } catch {
    return { ok: false, error: 'database unreachable' }
  }
}

/** Deletes a mod the caller owns (ownership checked before the DELETE). */
export const dbDeleteMod = async (userId: string, id: string): Promise<SupabaseResult> => {
  if (!dbConfigured()) return { ok: false, error: 'database not configured' }
  try {
    const res = await timedFetch(
      `/rest/v1/mods?id=eq.${encodeURIComponent(id)}&select=owner_id&limit=1`,
      { headers: restServiceHeaders() },
    )
    if (!res.ok) return { ok: false, error: `mod read failed (${res.status})` }
    const rows = (await res.json()) as Array<{ owner_id: string }>
    if (!rows[0]) return { ok: false, error: 'mod not found' }
    if (rows[0].owner_id !== userId) return { ok: false, error: 'not owner' }
    const del = await timedFetch(`/rest/v1/mods?id=eq.${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: headers(SERVICE, { Prefer: 'return=minimal' }),
    })
    if (del.status !== 204 && !del.ok) return { ok: false, error: `mod delete failed (${del.status})` }
    return { ok: true }
  } catch {
    return { ok: false, error: 'database unreachable' }
  }
}

/** Upserts one rating per user; returns the refreshed average/count. */
export const dbRateMod = async (
  modId: string,
  userId: string,
  rating: number,
): Promise<SupabaseResult<{ ratingAvg: number | null; ratingCount: number }>> => {
  if (!dbConfigured()) return { ok: false, error: 'database not configured' }
  try {
    const exists = await timedFetch(
      `/rest/v1/mods?id=eq.${encodeURIComponent(modId)}&select=id&limit=1`,
      { headers: restServiceHeaders() },
    )
    if (!exists.ok) return { ok: false, error: `mod read failed (${exists.status})` }
    if ((await exists.json() as Array<{ id: string }>).length === 0) return { ok: false, error: 'mod not found' }
    const upsert = await timedFetch('/rest/v1/mod_ratings', {
      method: 'POST',
      headers: restServiceHeaders(),
      body: JSON.stringify([{ mod_id: modId, user_id: userId, rating }]),
    })
    if (!upsert.ok) return { ok: false, error: `rating failed (${upsert.status})` }
    const agg = await timedFetch(
      `/rest/v1/mod_ratings?mod_id=eq.${encodeURIComponent(modId)}&select=rating`,
      { headers: restServiceHeaders() },
    )
    const rows = agg.ok ? ((await agg.json()) as Array<{ rating: number }>) : []
    const count = rows.length
    const avg = count > 0 ? Math.round((rows.reduce((s, r) => s + r.rating, 0) / count) * 10) / 10 : null
    return { ok: true, data: { ratingAvg: avg, ratingCount: count } }
  } catch {
    return { ok: false, error: 'database unreachable' }
  }
}

export interface ModCommentRow {
  id: string
  userId: string
  username: string
  body: string
  createdAt: string
}

/** Lists comments for a mod (newest first) with the author username merged in. */
export const dbListComments = async (modId: string): Promise<SupabaseResult<ModCommentRow[]>> => {
  if (!dbConfigured()) return { ok: false, error: 'database not configured' }
  try {
    const exists = await timedFetch(
      `/rest/v1/mods?id=eq.${encodeURIComponent(modId)}&select=id&limit=1`,
      { headers: restServiceHeaders() },
    )
    if (!exists.ok) return { ok: false, error: `mod read failed (${exists.status})` }
    if ((await exists.json() as Array<{ id: string }>).length === 0) return { ok: false, error: 'mod not found' }
    const res = await timedFetch(
      `/rest/v1/mod_comments?mod_id=eq.${encodeURIComponent(modId)}&select=id,user_id,body,created_at&order=created_at.desc&limit=200`,
      { headers: restServiceHeaders() },
    )
    if (!res.ok) return { ok: false, error: `comments read failed (${res.status})` }
    const rows = (await res.json()) as Array<{ id: string; user_id: string; body: string; created_at: string }>
    const ids = [...new Set(rows.map((r) => r.user_id))]
    const nameById = new Map<string, string>()
    if (ids.length > 0) {
      const prof = await timedFetch(
        `/rest/v1/profiles?user_id=in.(${ids.map((i) => encodeURIComponent(i)).join(',')})&select=user_id,username`,
        { headers: restServiceHeaders() },
      )
      if (prof.ok) {
        for (const p of (await prof.json()) as Array<{ user_id: string; username: string }>) nameById.set(p.user_id, p.username)
      }
    }
    return {
      ok: true,
      data: rows.map((r) => ({ id: r.id, userId: r.user_id, username: nameById.get(r.user_id) ?? '', body: r.body, createdAt: r.created_at })),
    }
  } catch {
    return { ok: false, error: 'database unreachable' }
  }
}

/** Adds a comment (auth'd caller; body length already capped by the endpoint). */
export const dbAddComment = async (modId: string, userId: string, body: string): Promise<SupabaseResult> => {
  if (!dbConfigured()) return { ok: false, error: 'database not configured' }
  try {
    const exists = await timedFetch(
      `/rest/v1/mods?id=eq.${encodeURIComponent(modId)}&select=id&limit=1`,
      { headers: restServiceHeaders() },
    )
    if (!exists.ok) return { ok: false, error: `mod read failed (${exists.status})` }
    if ((await exists.json() as Array<{ id: string }>).length === 0) return { ok: false, error: 'mod not found' }
    const res = await timedFetch('/rest/v1/mod_comments', {
      method: 'POST',
      headers: restServiceHeaders(),
      body: JSON.stringify([{ mod_id: modId, user_id: userId, body }]),
    })
    if (!res.ok) return { ok: false, error: `comment failed (${res.status})` }
    return { ok: true }
  } catch {
    return { ok: false, error: 'database unreachable' }
  }
}

// ---- Phase 5: community map repository (mirrors Phase 4 mods) ---------------------------

export interface MapRepoRow {
  id: string
  ownerId: string
  /** The publisher's account username (from `profiles`), empty if unknown. */
  ownerName: string
  name: string
  author: string
  description: string
  version: string
  sizeBytes: number
  width: number
  height: number
  players: number
  requireProtocol: number
  downloads: number
  ratingAvg: number | null
  ratingCount: number
  createdAt: string
}

/** Reads the map repo listing (payload-free) with rating aggregates merged in. */
export const dbListMaps = async (
  opts: { q?: string; sort?: string; owner?: string; limit?: number } = {},
): Promise<SupabaseResult<MapRepoRow[]>> => {
  if (!dbConfigured()) return { ok: false, error: 'database not configured' }
  const sort = opts.sort === 'rating' || opts.sort === 'downloads' || opts.sort === 'players' ? opts.sort : 'newest'
  const limit = Math.max(1, Math.min(250, opts.limit ?? 100))
  try {
    let url =
      '/rest/v1/maps?select=id,owner_id,name,meta_author,meta_description,meta_version,size_bytes,width,height,players,require_protocol,downloads,created_at'
    if (opts.owner) url += `&owner_id=eq.${encodeURIComponent(opts.owner)}`
    const q = opts.q?.trim()
    if (q && q !== '') {
      const term = ilikeEscaped(q)
      url += `&or=(name.ilike.*${term}*,meta_author.ilike.*${term}*)`
    }
    if (sort === 'downloads') url += '&order=downloads.desc,name.asc'
    else if (sort === 'players') url += '&order=players.desc,name.asc'
    else url += '&order=created_at.desc,name.asc'
    url += `&limit=${limit}`
    const res = await timedFetch(url, { headers: restServiceHeaders() })
    if (!res.ok) return { ok: false, error: `map list failed (${res.status})` }
    const rows = (await res.json()) as Array<{
      id: string
      owner_id: string
      name: string
      meta_author: string
      meta_description: string
      meta_version: string
      size_bytes: number
      width: number
      height: number
      players: number
      require_protocol: number
      downloads: number
      created_at: string
    }>
    const ratings = await timedFetch('/rest/v1/map_ratings?select=map_id,rating', { headers: restServiceHeaders() })
    const sum = new Map<string, number>()
    const count = new Map<string, number>()
    if (ratings.ok) {
      for (const r of (await ratings.json()) as Array<{ map_id: string; rating: number }>) {
        sum.set(r.map_id, (sum.get(r.map_id) ?? 0) + r.rating)
        count.set(r.map_id, (count.get(r.map_id) ?? 0) + 1)
      }
    }
    // Merge the publisher account username (profiles) so the UI can show "by @name".
    const ownerIds = Array.from(new Set(rows.map((r) => r.owner_id).filter((x) => x !== '')))
    const nameById = new Map<string, string>()
    if (ownerIds.length > 0) {
      const prof = await timedFetch(
        `/rest/v1/profiles?user_id=in.(${ownerIds.map(encodeURIComponent).join(',')})&select=user_id,username`,
        { headers: restServiceHeaders() },
      )
      if (prof.ok) {
        for (const p of (await prof.json()) as Array<{ user_id: string; username: string }>)
          nameById.set(p.user_id, p.username)
      }
    }
    const data: MapRepoRow[] = rows.map((r) => {
      const c = count.get(r.id) ?? 0
      return {
        id: r.id,
        ownerId: r.owner_id,
        ownerName: nameById.get(r.owner_id) ?? '',
        name: r.name,
        author: r.meta_author,
        description: r.meta_description,
        version: r.meta_version,
        sizeBytes: r.size_bytes,
        width: r.width,
        height: r.height,
        players: r.players,
        requireProtocol: r.require_protocol,
        downloads: r.downloads,
        ratingAvg: c > 0 ? Math.round(((sum.get(r.id) ?? 0) / c) * 10) / 10 : null,
        ratingCount: c,
        createdAt: r.created_at,
      }
    })
    if (sort === 'rating') {
      data.sort((a, b) => (b.ratingAvg ?? -1) - (a.ratingAvg ?? -1) || b.downloads - a.downloads || a.name.localeCompare(b.name))
    }
    return { ok: true, data }
  } catch {
    return { ok: false, error: 'database unreachable' }
  }
}

/** Full MapData fetch for the download path; also bumps the download counter. */
export const dbGetMap = async (id: string): Promise<SupabaseResult<{ id: string; name: string; payload: unknown; requireProtocol: number }>> => {
  if (!dbConfigured()) return { ok: false, error: 'database not configured' }
  try {
    const res = await timedFetch(
      `/rest/v1/maps?id=eq.${encodeURIComponent(id)}&select=id,name,payload,require_protocol,downloads&limit=1`,
      { headers: restServiceHeaders() },
    )
    if (!res.ok) return { ok: false, error: `map read failed (${res.status})` }
    const rows = (await res.json()) as Array<{ id: string; name: string; payload: unknown; require_protocol: number; downloads: number }>
    if (!rows[0]) return { ok: false, error: 'map not found' }
    const r = rows[0]
    await timedFetch(`/rest/v1/maps?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: headers(SERVICE, { Prefer: 'return=minimal' }),
      body: JSON.stringify({ downloads: r.downloads + 1 }),
    }).catch(() => undefined)
    return { ok: true, data: { id: r.id, name: r.name, payload: r.payload, requireProtocol: r.require_protocol } }
  } catch {
    return { ok: false, error: 'database unreachable' }
  }
}

/** Publishes a sanitized map (quota + name-collision checked here). */
export const dbCreateMap = async (
  userId: string,
  map: { name: string; author: string; description: string; version: string; width: number; height: number; players: number; requireProtocol: number; sizeBytes: number; payload: unknown },
): Promise<SupabaseResult<{ id: string }>> => {
  if (!dbConfigured()) return { ok: false, error: 'database not configured' }
  try {
    const countRes = await timedFetch(
      `/rest/v1/maps?owner_id=eq.${encodeURIComponent(userId)}&select=id&limit=1`,
      { headers: { ...headers(SERVICE), Prefer: 'count=exact,return=minimal' } },
    )
    const total = Number(countRes.headers.get('content-range')?.split('/')[1] ?? 0)
    if (total >= MAPS_MAX_PER_USER) return { ok: false, error: 'map quota reached' }
    const res = await timedFetch('/rest/v1/maps', {
      method: 'POST',
      headers: restServiceHeaders(),
      body: JSON.stringify([
        {
          owner_id: userId,
          name: map.name,
          meta_author: map.author,
          meta_description: map.description,
          meta_version: map.version,
          size_bytes: map.sizeBytes,
          width: map.width,
          height: map.height,
          players: map.players,
          require_protocol: map.requireProtocol,
          payload: map.payload,
        },
      ]),
    })
    if (res.status === 409) return { ok: false, error: 'name already taken' }
    if (!res.ok) return { ok: false, error: `map create failed (${res.status})` }
    const rows = (await res.json().catch(() => [])) as Array<{ id: string }>
    return { ok: true, data: { id: rows[0]?.id ?? '' } }
  } catch {
    return { ok: false, error: 'database unreachable' }
  }
}

/** Deletes a map the caller owns (ownership checked before the DELETE). */
export const dbDeleteMap = async (userId: string, id: string): Promise<SupabaseResult> => {
  if (!dbConfigured()) return { ok: false, error: 'database not configured' }
  try {
    const res = await timedFetch(
      `/rest/v1/maps?id=eq.${encodeURIComponent(id)}&select=owner_id&limit=1`,
      { headers: restServiceHeaders() },
    )
    if (!res.ok) return { ok: false, error: `map read failed (${res.status})` }
    const rows = (await res.json()) as Array<{ owner_id: string }>
    if (!rows[0]) return { ok: false, error: 'map not found' }
    if (rows[0].owner_id !== userId) return { ok: false, error: 'not owner' }
    const del = await timedFetch(`/rest/v1/maps?id=eq.${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: headers(SERVICE, { Prefer: 'return=minimal' }),
    })
    if (del.status !== 204 && !del.ok) return { ok: false, error: `map delete failed (${del.status})` }
    return { ok: true }
  } catch {
    return { ok: false, error: 'database unreachable' }
  }
}

/** Upserts one rating per user; returns the refreshed average/count. */
export const dbRateMap = async (
  mapId: string,
  userId: string,
  rating: number,
): Promise<SupabaseResult<{ ratingAvg: number | null; ratingCount: number }>> => {
  if (!dbConfigured()) return { ok: false, error: 'database not configured' }
  try {
    const exists = await timedFetch(
      `/rest/v1/maps?id=eq.${encodeURIComponent(mapId)}&select=id&limit=1`,
      { headers: restServiceHeaders() },
    )
    if (!exists.ok) return { ok: false, error: `map read failed (${exists.status})` }
    if ((await exists.json() as Array<{ id: string }>).length === 0) return { ok: false, error: 'map not found' }
    const upsert = await timedFetch('/rest/v1/map_ratings', {
      method: 'POST',
      headers: restServiceHeaders(),
      body: JSON.stringify([{ map_id: mapId, user_id: userId, rating }]),
    })
    if (!upsert.ok) return { ok: false, error: `rating failed (${upsert.status})` }
    const agg = await timedFetch(
      `/rest/v1/map_ratings?map_id=eq.${encodeURIComponent(mapId)}&select=rating`,
      { headers: restServiceHeaders() },
    )
    const rows = agg.ok ? ((await agg.json()) as Array<{ rating: number }>) : []
    const count = rows.length
    const avg = count > 0 ? Math.round((rows.reduce((s, r) => s + r.rating, 0) / count) * 10) / 10 : null
    return { ok: true, data: { ratingAvg: avg, ratingCount: count } }
  } catch {
    return { ok: false, error: 'database unreachable' }
  }
}

export interface MapCommentRow {
  id: string
  userId: string
  username: string
  body: string
  createdAt: string
}

/** Lists comments for a map (newest first) with the author username merged in. */
export const dbListMapComments = async (mapId: string): Promise<SupabaseResult<MapCommentRow[]>> => {
  if (!dbConfigured()) return { ok: false, error: 'database not configured' }
  try {
    const exists = await timedFetch(
      `/rest/v1/maps?id=eq.${encodeURIComponent(mapId)}&select=id&limit=1`,
      { headers: restServiceHeaders() },
    )
    if (!exists.ok) return { ok: false, error: `map read failed (${exists.status})` }
    if ((await exists.json() as Array<{ id: string }>).length === 0) return { ok: false, error: 'map not found' }
    const res = await timedFetch(
      `/rest/v1/map_comments?map_id=eq.${encodeURIComponent(mapId)}&select=id,user_id,body,created_at&order=created_at.desc&limit=200`,
      { headers: restServiceHeaders() },
    )
    if (!res.ok) return { ok: false, error: `comments read failed (${res.status})` }
    const rows = (await res.json()) as Array<{ id: string; user_id: string; body: string; created_at: string }>
    const ids = [...new Set(rows.map((r) => r.user_id))]
    const nameById = new Map<string, string>()
    if (ids.length > 0) {
      const prof = await timedFetch(
        `/rest/v1/profiles?user_id=in.(${ids.map((i) => encodeURIComponent(i)).join(',')})&select=user_id,username`,
        { headers: restServiceHeaders() },
      )
      if (prof.ok) {
        for (const p of (await prof.json()) as Array<{ user_id: string; username: string }>) nameById.set(p.user_id, p.username)
      }
    }
    return {
      ok: true,
      data: rows.map((r) => ({ id: r.id, userId: r.user_id, username: nameById.get(r.user_id) ?? '', body: r.body, createdAt: r.created_at })),
    }
  } catch {
    return { ok: false, error: 'database unreachable' }
  }
}

/** Adds a comment (auth'd caller; body length already capped by the endpoint). */
export const dbAddMapComment = async (mapId: string, userId: string, body: string): Promise<SupabaseResult> => {
  if (!dbConfigured()) return { ok: false, error: 'database not configured' }
  try {
    const exists = await timedFetch(
      `/rest/v1/maps?id=eq.${encodeURIComponent(mapId)}&select=id&limit=1`,
      { headers: restServiceHeaders() },
    )
    if (!exists.ok) return { ok: false, error: `map read failed (${exists.status})` }
    if ((await exists.json() as Array<{ id: string }>).length === 0) return { ok: false, error: 'map not found' }
    const res = await timedFetch('/rest/v1/map_comments', {
      method: 'POST',
      headers: restServiceHeaders(),
      body: JSON.stringify([{ map_id: mapId, user_id: userId, body }]),
    })
    if (!res.ok) return { ok: false, error: `comment failed (${res.status})` }
    return { ok: true }
  } catch {
    return { ok: false, error: 'database unreachable' }
  }
}