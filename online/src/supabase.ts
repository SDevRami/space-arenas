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
  try {
    const scoreMap = Object.fromEntries(rec.participants.map((p) => [p.id, p.score]))
    await timedFetch('/rest/v1/matches', {
      method: 'POST',
      headers: restServiceHeaders(),
      body: JSON.stringify([
        { map: rec.map, winner: rec.winner !== null ? String(rec.winner) : null, started_at: new Date(rec.startedAt).toISOString(), participants: rec.participants, score: scoreMap },
      ]),
    }).catch(() => undefined)
    for (const p of rec.participants) {
      if (!p.userId) continue
      const row = await dbProfile(p.userId)
      if (!row.ok || !row.data) continue
      const games = row.data.games + 1
      const wins = row.data.wins + (rec.winner !== null && p.team === rec.winner ? 1 : 0)
      const high = Math.max(row.data.high_score, p.score)
      const username = row.data.username || p.username
      await timedFetch(`/rest/v1/profiles?user_id=eq.${p.userId}`, {
        method: 'PATCH',
        headers: restServiceHeaders(),
        body: JSON.stringify({ games, wins, high_score: high }),
      }).catch(() => undefined)
      await timedFetch('/rest/v1/leaderboard', {
        method: 'POST',
        headers: restServiceHeaders(),
        body: JSON.stringify([{ user_id: p.userId, username, score: high }]),
      }).catch(() => undefined)
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