import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import WebSocket from 'ws'
import { decodeControl, decodeFrame, encodeControl, encodeCmd, BIN, MIN_PROTOCOL_VERSION, type EnvelopeCommand } from '../shared/src/index.ts'
import { hashPassphrase } from '../src/passphrase.ts'
import { modHash } from '../shared/src/mod.ts'
import { rateLimit } from '../src/ratelimit.ts'
import { MOD_MAX_BYTES, modLabel, sanitizeMod } from '../src/mods.ts'
import { MAP_MAX_BYTES, mapLabel, sanitizeMap } from '../src/maps.ts'
import { fingerprintSettingsFor } from '../src/sanitize.ts'

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const srv = createServer()
    srv.listen(0, () => {
      const port = (srv.address() as { port: number }).port
      srv.close(() => resolve(port))
    })
    srv.on('error', reject)
  })

let child: ChildProcess
let base = ''
let wsBase = ''

/** The only access token the stub auth service accepts; mapped to a stable user id. */
const TEST_TOKEN = 'sa-test-token'
const TEST_USER_ID = '11111111-1111-4111-8111-111111111111'
/** A second account, used to prove a slot is bound to the *verified* user. */
const TEST_TOKEN_B = 'sa-test-token-b'
const TEST_USER_ID_B = '22222222-2222-4222-8222-222222222222'

/** Flipped by tests that need the auth service to look broken (§6.2 "auth service down"). */
let stubAuthBroken = false

/**
 * Minimal Supabase stand-in. Answers just enough for `authMe()` to verify a session:
 * `GET /auth/v1/user` plus the PostgREST reads the profile/status paths touch.
 * This is the test seam for the room-auth gate — no production code knows about it.
 */
const startStubSupabase = async (): Promise<{ url: string; close: () => Promise<void> }> => {
  const srv = createHttpServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const send = (code: number, body: unknown, headers: Record<string, string> = {}): void => {
      res.writeHead(code, { 'Content-Type': 'application/json', ...headers })
      res.end(JSON.stringify(body))
    }
    if (url.pathname === '/auth/v1/user') {
      if (stubAuthBroken) {
        send(500, { msg: 'stub auth service is down' })
        return
      }
      const auth = req.headers.authorization ?? ''
      if (auth === `Bearer ${TEST_TOKEN}`) {
        send(200, { id: TEST_USER_ID, email: 'tester@example.test', user_metadata: { username: 'TesterOne' } })
        return
      }
      if (auth === `Bearer ${TEST_TOKEN_B}`) {
        send(200, { id: TEST_USER_ID_B, email: 'tester2@example.test', user_metadata: { username: 'TesterTwo' } })
        return
      }
      send(401, { msg: 'invalid token' })
      return
    }
    // PostgREST: profiles (dbProfile / dbProbe / dbProfileCount) + leaderboard.
    if (url.pathname.startsWith('/rest/v1/profiles')) {
      if (stubAuthBroken) {
        send(500, { msg: 'stub db is down' })
        return
      }
      if (url.searchParams.get('select')?.includes('username')) {
        send(200, [
          { username: 'TesterOne', games: 3, wins: 1, high_score: 4200 },
          { username: 'TesterTwo', games: 1, wins: 0, high_score: 900 },
        ])
        return
      }
      send(200, [{ user_id: TEST_USER_ID }, { user_id: TEST_USER_ID_B }], { 'Content-Range': '0-1/2' })
      return
    }
    if (url.pathname.startsWith('/rest/v1/leaderboard')) {
      send(200, [{ username: 'TesterOne', score: 4200 }, { username: 'TesterTwo', score: 900 }])
      return
    }
    send(404, { msg: `stub has no route for ${url.pathname}` })
  })
  await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', resolve))
  const port = (srv.address() as AddressInfo).port
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => srv.close(() => resolve())),
  }
}

const waitFor = async (fn: () => Promise<boolean>, tries = 50): Promise<boolean> => {
  for (let i = 0; i < tries; i++) {
    try {
      if (await fn()) return true
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  return false
}

interface Online {
  base: string
  wsBase: string
  child: ChildProcess
}

/** Boots dist/online.js and waits until /api/status answers. */
const spawnOnline = async (extraEnv: Record<string, string>): Promise<Online> => {
  const port = await freePort()
  const proc = spawn(process.execPath, ['dist/online.js'], {
    env: {
      ...process.env,
      SA_MODE: 'online',
      SA_PORT: String(port),
      SA_RATE_ROOM_WRITE_PER_MIN: '200',
      SA_RATE_WS_HANDSHAKE_PER_MIN: '200',
      SA_RATE_ROOM_WRITE_PER_ACCOUNT_MIN: '200',
      ...extraEnv,
    },
    stdio: 'ignore',
  })
  const b = `http://127.0.0.1:${port}`
  const up = await waitFor(async () => {
    const r = await fetch(`${b}/api/status`)
    return r.ok && ((await r.json()) as { ok?: boolean }).ok === true
  })
  assert.ok(up, 'server did not come up')
  return { base: b, wsBase: `ws://127.0.0.1:${port}/ws`, child: proc }
}

let stub: { url: string; close: () => Promise<void> }
/** A second spawn with no SUPABASE_* env, for the `dbConfigured() === false` assertions. */
let noDbChild: ChildProcess
let noDbBase = ''

before(async () => {
  stub = await startStubSupabase()
  const online = await spawnOnline({
    SUPABASE_URL: stub.url,
    SUPABASE_ANON_KEY: 'stub-anon',
    SUPABASE_SERVICE_ROLE_KEY: 'stub-service',
  })
  child = online.child
  base = online.base
  wsBase = online.wsBase

  const noDbPort = await freePort()
  noDbChild = spawn(process.execPath, ['dist/online.js'], {
    env: { ...process.env, SA_MODE: 'online', SA_PORT: String(noDbPort) },
    stdio: 'ignore',
  })
  noDbBase = `http://127.0.0.1:${noDbPort}`
  const noDbUp = await waitFor(async () => (await fetch(`${noDbBase}/api/status`)).ok)
  assert.ok(noDbUp, 'no-DB server did not come up')
})

after(async () => {
  child?.kill()
  noDbChild?.kill()
  await stub?.close()
})

/** Headers for an authenticated API call. Omit entirely to act as a signed-out player. */
const authed = (extra: Record<string, string> = {}): Record<string, string> => ({
  'content-type': 'application/json',
  authorization: `Bearer ${TEST_TOKEN}`,
  ...extra,
})

const json = async (path: string, init?: RequestInit): Promise<{ status: number; body: unknown }> => {
  const r = await fetch(`${base}${path}`, init)
  return { status: r.status, body: await r.json().catch(() => undefined) }
}

/** Same shape as `json`, against the spawn that has no SUPABASE_* env configured. */
const noDbJson = async (path: string, init?: RequestInit): Promise<{ status: number; body: unknown }> => {
  const r = await fetch(`${noDbBase}${path}`, init)
  return { status: r.status, body: await r.json().catch(() => undefined) }
}

describe('online server API', () => {
  it('status reports online mode + protocol', async () => {
    const { status, body } = await json('/api/status')
    assert.equal(status, 200)
    const b = body as { mode: string; service: string; protocol: number }
    assert.equal(b.mode, 'online')
    assert.equal(b.service, 'space-arenas-online')
    assert.equal(typeof b.protocol, 'number')
  })

  it('creates a room', async () => {
    const { status, body } = await json('/api/rooms', {
      method: 'POST',
      headers: authed(),
      body: JSON.stringify({ hostName: 'TesterOne', passphrase: 'swordfish' }),
    })
    assert.equal(status, 201)
    const b = body as { ok: boolean; roomCode: string }
    assert.equal(b.ok, true)
    assert.ok(b.roomCode.length >= 4)
  })

  it('lists rooms and finds the created one by host or code', async () => {
    const { body } = await json('/api/rooms')
    const rooms = (body as { rooms: Array<{ hostName: string; id: string; status: string }> }).rooms
    assert.ok(rooms.some((r) => r.hostName === 'TesterOne'))
    const room = rooms[0]
    assert.equal(room.status, 'lobby')

    const byHost = await json(`/api/rooms/search?q=testerone`)
    assert.ok(((byHost.body as { rooms: unknown[] }).rooms).length >= 1)

    const byCode = await json(`/api/rooms/search?q=${room.id}`)
    assert.ok(((byCode.body as { rooms: unknown[] }).rooms).some((r) => (r as { id: string }).id === room.id))
  })

  it('join pre-check returns ws url while room is open', async () => {
    const { body } = await json('/api/rooms')
    const room = (body as { rooms: Array<{ id: string }> }).rooms[0]
    const { status, body: join } = await json(`/api/rooms/${room.id}/join`, {
      method: 'POST',
      headers: authed(),
      body: JSON.stringify({}),
    })
    assert.equal(status, 200)
    const j = join as { ok: boolean; ws: string }
    assert.equal(j.ok, true)
    assert.ok(j.ws.endsWith('/ws'))
  })

  it('join pre-check 404s on an unknown room', async () => {
    const { status } = await json('/api/rooms/ZZZZ/join', { method: 'POST', headers: authed() })
    assert.equal(status, 404)
  })

  it('CORS preflight allows the Authorization header (needed by /api/auth/me)', async () => {
    const r = await fetch(`${base}/api/auth/me`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://example.com',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization',
      },
    })
    assert.equal(r.status, 204)
    assert.match(r.headers.get('access-control-allow-headers') ?? '', /authorization/i)
  })

  it('CORS preflight permits DELETE (needed by /api/backups/:id)', async () => {
    const r = await fetch(`${base}/api/backups/x`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://example.com',
        'Access-Control-Request-Method': 'DELETE',
        'Access-Control-Request-Headers': 'authorization',
      },
    })
    assert.equal(r.status, 204)
    assert.match(r.headers.get('access-control-allow-methods') ?? '', /delete/i)
  })
})

describe('online server DB-unconfigured routes', () => {
  // These assertions are about `dbConfigured() === false`, so they run against the
  // `noDbBase` spawn (no SUPABASE_* env), not the shared auth-enabled server.
  it('status reports db:false when SUPABASE env is missing', async () => {
    const { status, body } = await noDbJson('/api/status')
    assert.equal(status, 200)
    assert.equal((body as { db: boolean }).db, false)
    assert.equal((body as { registered: number | null }).registered, null)
  })

  it('auth register returns 503 without DB config', async () => {
    const { status, body } = await noDbJson('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'x', email: 'x@x.com', password: '123456' }),
    })
    assert.equal(status, 503)
    assert.equal((body as { error: string }).error, 'database not configured')
  })

  it('auth login returns 503 without DB config', async () => {
    const { status } = await noDbJson('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'x@x.com', password: '123456' }),
    })
    assert.equal(status, 503)
  })

  it('auth change-password returns 503 without DB config', async () => {
    const { status } = await noDbJson('/api/auth/change-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 't', newPassword: '123456' }),
    })
    assert.equal(status, 503)
  })

  it('auth me returns 401 for a bogus token without DB config', async () => {
    const { status } = await noDbJson('/api/auth/me', { headers: { authorization: 'Bearer bogus' } })
    assert.equal(status, 401)
  })

  it('leaderboard returns 503 without DB config', async () => {
    const { status, body } = await noDbJson('/api/leaderboard')
    assert.equal(status, 503)
    assert.equal((body as { error: string }).error, 'database not configured')
  })
})

describe('online server disabled mode', () => {
  it('all API room endpoints return 503 when SA_MODE != online', async () => {
    const port = await freePort()
    const disabled = spawn(process.execPath, ['dist/online.js'], {
      env: { ...process.env, SA_PORT: String(port) },
      stdio: 'ignore',
    })
    const dbase = `http://127.0.0.1:${port}`
    const up = await waitFor(async () => {
      const r = await fetch(`${dbase}/api/status`)
      return r.ok
    })
    assert.ok(up, 'disabled server did not come up')
    try {
      const list = await fetch(`${dbase}/api/rooms`)
      assert.equal(list.status, 503)
      const create = await fetch(`${dbase}/api/rooms`, { method: 'POST' })
      assert.equal(create.status, 503)
    } finally {
      disabled.kill()
    }
  })
})

describe('online server backups + rate limiting', () => {
  it('rateLimit enforces the per-window limit and slides with time', () => {
    const key = `unit:${Date.now()}`
    for (let i = 0; i < 3; i++) assert.equal(rateLimit(key, 3, 1000).ok, true)
    const over = rateLimit(key, 3, 1000)
    assert.equal(over.ok, false)
    assert.ok(over.retryAfterSeconds >= 1)
    assert.equal(rateLimit(key, 3, 61_000).ok, true, 'window should slide after 60 s')
  })

  it('backups require a session token', async () => {
    const { status, body } = await json('/api/backups', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'profile', payload: 'x', passphraseHash: 'y' }),
    })
    assert.equal(status, 401)
    assert.equal((body as { error: string }).error, 'login required')
  })

  it('backups reject a bogus token (no session)', async () => {
    const { status } = await json('/api/backups', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer bogus' },
      body: JSON.stringify({ kind: 'profile', payload: 'x', passphraseHash: 'y' }),
    })
    assert.equal(status, 401)
  })

  it('a burst of backup uploads is rate-limited with Retry-After', async () => {
    let last = -1
    let retryAfter = ''
    for (let i = 0; i < 12; i++) {
      const r = await fetch(`${base}/api/backups`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'profile', payload: 'x', passphraseHash: 'y' }),
      })
      last = r.status
      retryAfter = r.headers.get('retry-after') ?? ''
    }
    assert.equal(last, 429)
    assert.ok(retryAfter !== '', '429 must carry Retry-After')
  })
})

describe('online server mod repository', () => {
  it('sanitizeMod validates + scrubs a mod file (unit)', () => {
    const clean = sanitizeMod({
      meta: { name: '  My Mod  ', author: 'Ram', description: ' x ', version: '1.0' },
      settings: { sellRefundFraction: 0.25, unknown: 42 },
      buildingOverrides: { 'power-plant': { cost: 500, hp: 1500 } },
    })
    assert.ok(clean, 'valid mod must be accepted')
    assert.equal(clean?.meta?.name, 'My Mod')
    assert.equal(clean?.settings?.sellRefundFraction, 0.25)
    assert.ok(!('unknown' in (clean?.settings ?? {})))
    assert.equal(clean?.buildingOverrides?.['power-plant']?.cost, 500)
    assert.equal(sanitizeMod({ buildingOverrides: {} }), null, 'empty mod must be rejected')
    assert.equal(sanitizeMod('nope'), null)
    assert.equal(MOD_MAX_BYTES, 4 * 1024 * 1024)
    assert.equal(modLabel(undefined, 'fallback'), 'fallback')
  })

  it('repo list returns 503 without DB config', async () => {
    const { status, body } = await noDbJson('/api/mods/repo')
    assert.equal(status, 503)
    assert.equal((body as { error: string }).error, 'database not configured')
  })

  it('mod download returns 503 without DB config', async () => {
    const { status, body } = await noDbJson('/api/mods/00000000-0000-0000-0000-000000000000')
    assert.equal(status, 503)
    assert.equal((body as { error: string }).error, 'database not configured')
  })

  it('mod upload requires a session token', async () => {
    const { status, body } = await json('/api/mods', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ meta: { name: 'X' }, settings: { sellRefundFraction: 0.1 } }),
    })
    assert.equal(status, 401)
    assert.equal((body as { error: string }).error, 'login required')
  })

  it('mod rate requires a session token', async () => {
    const { status } = await json('/api/mods/00000000-0000-0000-0000-000000000000/rate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rating: 5 }),
    })
    assert.equal(status, 401)
  })

  it('mod comment POST requires a session token', async () => {
    const { status } = await json('/api/mods/00000000-0000-0000-0000-000000000000/comments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'hi' }),
    })
    assert.equal(status, 401)
  })

  it('mod delete requires a session token', async () => {
    const { status } = await json('/api/mods/00000000-0000-0000-0000-000000000000', {
      method: 'DELETE',
    })
    assert.equal(status, 401)
  })

  it('a burst of mod uploads is rate-limited with Retry-After', async () => {
    let last = -1
    let retryAfter = ''
    for (let i = 0; i < 12; i++) {
      const r = await fetch(`${base}/api/mods`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ meta: { name: 'Spam' }, settings: { sellRefundFraction: 0.1 } }),
      })
      last = r.status
      retryAfter = r.headers.get('retry-after') ?? ''
    }
    assert.equal(last, 429)
    assert.ok(retryAfter !== '', '429 must carry Retry-After')
  })
})

describe('online server map repository', () => {
  const sampleMap = (): Record<string, unknown> => ({
    schemaVersion: 1,
    format: 'space-arenas-map',
    name: '  My Map  ',
    description: ' x ',
    author: 'Ram',
    mapVersion: '1.0',
    width: 32,
    height: 32,
    tiles: new Array(32 * 32).fill(0),
    groundColors: new Array(32 * 32).fill(''),
    brightness: 0,
    obstructions: [],
    supplyFields: [{ x: 5, y: 5, radius: 3, capacity: 100 }],
    oilFields: [],
    spawnPoints: [
      { x: 1, y: 1, team: 0 },
      { x: 30, y: 30, team: 1 },
    ],
    credits: 1000,
  })

  it('sanitizeMap validates + scrubs a map file (unit)', () => {
    const clean = sanitizeMap(sampleMap())
    assert.ok(clean, 'valid map must be accepted')
    assert.equal(clean?.name, 'My Map')
    assert.equal(clean?.description, 'x')
    assert.equal(clean?.author, 'Ram')
    assert.equal(clean?.tiles.length, 32 * 32)
    const noSupply = sampleMap()
    ;(noSupply.supplyFields as unknown[]) = []
    assert.equal(sanitizeMap(noSupply), null, 'map without supply fields must be rejected')
    const bad = sampleMap()
    bad.width = 8
    assert.equal(sanitizeMap(bad), null, 'out-of-range size must be rejected')
    assert.equal(sanitizeMap('nope'), null)
    assert.equal(sanitizeMap({}), null)
    assert.equal(MAP_MAX_BYTES, 4 * 1024 * 1024)
    assert.equal(mapLabel(undefined, 'fallback'), 'fallback')
  })

  it('repo list returns 503 without DB config', async () => {
    const { status, body } = await noDbJson('/api/maps/repo')
    assert.equal(status, 503)
    assert.equal((body as { error: string }).error, 'database not configured')
  })

  it('map download returns 503 without DB config', async () => {
    const { status, body } = await noDbJson('/api/maps/00000000-0000-0000-0000-000000000000')
    assert.equal(status, 503)
    assert.equal((body as { error: string }).error, 'database not configured')
  })

  it('map publish requires a session token', async () => {
    const { status, body } = await json('/api/maps', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(sampleMap()),
    })
    assert.equal(status, 401)
    assert.equal((body as { error: string }).error, 'login required')
  })

  it('map rate requires a session token', async () => {
    const { status } = await json('/api/maps/00000000-0000-0000-0000-000000000000/rate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rating: 5 }),
    })
    assert.equal(status, 401)
  })

  it('map comment POST requires a session token', async () => {
    const { status } = await json('/api/maps/00000000-0000-0000-0000-000000000000/comments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'hi' }),
    })
    assert.equal(status, 401)
  })

  it('map delete requires a session token', async () => {
    const { status } = await json('/api/maps/00000000-0000-0000-0000-000000000000', {
      method: 'DELETE',
    })
    assert.equal(status, 401)
  })

  it('a burst of map uploads is rate-limited with Retry-After', async () => {
    let last = -1
    let retryAfter = ''
    for (let i = 0; i < 12; i++) {
      const r = await fetch(`${base}/api/maps`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(sampleMap()),
      })
      last = r.status
      retryAfter = r.headers.get('retry-after') ?? ''
    }
    assert.equal(last, 429)
    assert.ok(retryAfter !== '', '429 must carry Retry-After')
  })
})

describe('online server CORS allow-list', () => {
  it('only echoes ACAO for an allowed origin when SA_CORS_ALLOW is set', async () => {
    const port = await freePort()
    const locked = spawn(process.execPath, ['dist/online.js'], {
      env: { ...process.env, SA_MODE: 'online', SA_PORT: String(port), SA_CORS_ALLOW: 'https://example.test' },
      stdio: 'ignore',
    })
    const lbase = `http://127.0.0.1:${port}`
    const up = await waitFor(async () => {
      const r = await fetch(`${lbase}/api/status`)
      return r.ok
    })
    assert.ok(up, 'allow-list server did not come up')
    try {
      const allowed = await fetch(`${lbase}/api/status`, { headers: { Origin: 'https://example.test' } })
      assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://example.test')

      const denied = await fetch(`${lbase}/api/status`, { headers: { Origin: 'https://evil.example' } })
      assert.equal(denied.headers.get('access-control-allow-origin'), null, 'unlisted origin must not receive ACAO')

      const preflight = await fetch(`${lbase}/api/auth/me`, {
        method: 'OPTIONS',
        headers: { Origin: 'https://example.test', 'Access-Control-Request-Method': 'GET' },
      })
      assert.equal(preflight.status, 204)
      assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://example.test')
    } finally {
      locked.kill()
    }
  })
})

describe('online server websocket join', () => {
  it('host + guest lobby round-trip over /ws', async () => {
    const { body } = await json('/api/rooms', {
      method: 'POST',
      headers: authed(),
      body: JSON.stringify({ hostName: 'WsHost', passphrase: 'secret' }),
    })
    const code = (body as { roomCode: string }).roomCode
    const hash = hashPassphrase('secret', code)

    const open = (name: string, clientId: string): Promise<{ ws: WebSocket; msgs: Array<Record<string, unknown>> }> =>
      new Promise((resolve, reject) => {
        const ws = new WebSocket(wsBase)
        const msgs: Array<Record<string, unknown>> = []
        ws.on('open', () => {
          ws.send(
            encodeControl({
              kind: 'C_JOIN',
              roomCode: code,
              passphraseHash: hash,
              name,
              clientId,
              token: TEST_TOKEN,
            }),
          )
        })
        ws.on('message', (data) => {
          const msg = decodeControl(data.toString())
          msgs.push(msg as unknown as Record<string, unknown>)
          if (msg.kind === 'H_LOBBY') resolve({ ws, msgs })
        })
        ws.on('error', reject)
      })

    const host = await open('WsHost', 'h1')
    const hostLobby = host.msgs.find((m) => m.kind === 'H_LOBBY') as { players: Array<{ name: string; host: boolean; ready: boolean }>; yourId: number }
    assert.ok(hostLobby.players.some((p) => p.name === 'WsHost' && p.host === true && p.ready === true))
    const hostId = hostLobby.yourId

    const guest = await open('WsGuest', 'g1')
    const guestLobby = guest.msgs.find((m) => m.kind === 'H_LOBBY') as { players: Array<{ name: string; host: boolean }> }
    assert.equal(guestLobby.players.length, 2)
    assert.ok(guestLobby.players.some((p) => p.name === 'WsGuest' && p.host === false))

    const hostSeesGuest = host.msgs
      .filter((m) => m.kind === 'H_LOBBY')
      .some((m) => (m as { players: Array<{ id: number }> }).players.some((p) => p.id !== hostId && (m as { players: Array<{ name: string }> }).players.some((p2) => p2.name === 'WsGuest')))

    assert.ok(hostSeesGuest)

    guest.ws.close()
    host.ws.close()
  })

  it('rejects a wrong passphrase', async () => {
    const { body } = await json('/api/rooms', {
      method: 'POST',
      headers: authed(),
      body: JSON.stringify({ hostName: 'Locked', passphrase: 'right' }),
    })
    const code = (body as { roomCode: string }).roomCode
    const good = hashPassphrase('right', code)
    const bad = hashPassphrase('wrong', code)
    assert.notEqual(good, bad)

    const err = await new Promise<string>((resolve, reject) => {
      const ws = new WebSocket(wsBase)
      ws.on('open', () => {
        ws.send(encodeControl({ kind: 'C_JOIN', roomCode: code, passphraseHash: bad, name: 'Sneaky', token: TEST_TOKEN }))
      })
      ws.on('message', (data) => {
        const msg = decodeControl(data.toString())
        if (msg.kind === 'H_ERROR') resolve((msg as { message: string }).message)
      })
      ws.on('error', reject)
      setTimeout(() => reject(new Error('no H_ERROR received')), 3000)
    })
    assert.match(err, /passphrase/i)
  })
})

describe('online server tamper watch', () => {
  it('settings fingerprint is deterministic and value-sensitive', () => {
    const a = fingerprintSettingsFor({ startingCredits: 5000 })
    const b = fingerprintSettingsFor({ startingCredits: 5000 })
    const c = fingerprintSettingsFor({ startingCredits: 9000 })
    assert.equal(a, b)
    assert.notEqual(a, c)
    assert.match(a, /^[0-9a-f]{8}$/)
  })

  it('flags mid-match settings changes and lets the host kick or skip', async () => {
    const { body } = await json('/api/rooms', {
      method: 'POST',
      headers: authed(),
      body: JSON.stringify({ hostName: 'Guardian', passphrase: 'watch' }),
    })
    const code = (body as { roomCode: string }).roomCode
    const hash = hashPassphrase('watch', code)

    type Tracked = {
      ws: WebSocket
      msgs: Array<Record<string, unknown>>
      waitFor: (kind: string | ((m: Record<string, unknown>) => boolean), tries?: number) => Promise<Record<string, unknown> | undefined>
    }
    const openTracked = (name: string): Promise<Tracked> =>
      new Promise((resolve, reject) => {
        const ws = new WebSocket(wsBase)
        const msgs: Array<Record<string, unknown>> = []
        const waitFor = async (kind: string | ((m: Record<string, unknown>) => boolean), tries = 40): Promise<Record<string, unknown> | undefined> => {
          const match = typeof kind === 'function' ? kind : (m: Record<string, unknown>) => m.kind === kind
          for (let i = 0; i < tries; i++) {
            const found = msgs.find(match)
            if (found) return found
            await new Promise((r) => setTimeout(r, 50))
          }
          return undefined
        }
        ws.on('open', () => {
          ws.send(encodeControl({ kind: 'C_JOIN', roomCode: code, passphraseHash: hash, name, clientId: `tamper-${name}-${Date.now()}`, token: TEST_TOKEN }))
        })
        ws.on('message', (data) => {
          const msg = decodeControl(data.toString()) as unknown as Record<string, unknown>
          msgs.push(msg)
          if (msg.kind === 'H_LOBBY') resolve({ ws, msgs, waitFor })
        })
        ws.on('error', reject)
        setTimeout(() => reject(new Error(`no H_LOBBY for ${name}`)), 3000)
      })

    const push = (t: Tracked, m: unknown): void => t.ws.send(encodeControl(m as Parameters<typeof encodeControl>[0]))
    const alertCount = (t: Tracked): number => t.msgs.filter((m) => m.kind === 'H_SETTINGS_ALERT').length
    const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
    const waitForAlertCount = async (t: Tracked, n: number, tries = 40): Promise<boolean> => {
      for (let i = 0; i < tries; i++) {
        if (alertCount(t) >= n) return true
        await sleep(50)
      }
      return false
    }

    const host = await openTracked('Guardian')
    const guest = await openTracked('Intruder')
    const cheater = await openTracked('Cheater')
    const guestId = (guest.msgs.find((m) => m.kind === 'H_LOBBY') as { yourId: number }).yourId
    const cheaterId = (cheater.msgs.find((m) => m.kind === 'H_LOBBY') as { yourId: number }).yourId

    // everyone readies, guest syncs values pre-start (server applies via H_LOBBY echo)
    push(guest, { kind: 'C_READY', ready: true })
    push(cheater, { kind: 'C_READY', ready: true })
    push(guest, { kind: 'C_DEV_SETTINGS', settings: { startingCredits: 9000 } })
    const synced = await guest.waitFor(
      (m) =>
        m.kind === 'H_LOBBY' &&
        (m as { players: Array<{ devSettings?: { startingCredits?: number } }> }).players.some((p) => p.devSettings?.startingCredits === 9000),
    )
    assert.ok(synced, 'server should apply the pre-start sync')
    push(host, { kind: 'C_START' })
    assert.ok(await guest.waitFor('S_MATCH_START'), 'guest should receive S_MATCH_START')
    assert.ok(await host.waitFor('S_MATCH_START'), 'host should receive S_MATCH_START')
    assert.ok(await cheater.waitFor('S_MATCH_START'), 'cheater should receive S_MATCH_START')

    // re-pushing the same pre-start-synced value after start must not alert (no false positive)
    push(guest, { kind: 'C_DEV_SETTINGS', settings: { startingCredits: 9000 } })
    await sleep(250)
    assert.equal(host.msgs.filter((m) => m.kind === 'H_SETTINGS_ALERT').length, 0, 'same value as snapshot must not alert')

    // mid-match change warns the offender and alerts the host once
    push(guest, { kind: 'C_DEV_SETTINGS', settings: { startingCredits: 8000 } })
    const alert = await host.waitFor((m) => m.kind === 'H_SETTINGS_ALERT' && (m as { offenderId: number }).offenderId === guestId)
    assert.ok(alert, 'host should be alerted')
    assert.equal((alert as { offender: string }).offender, 'Intruder')
    assert.equal((alert as { offenderId: number }).offenderId, guestId)
    const offenderAlert = await guest.waitFor('H_SETTINGS_ALERT')
    assert.equal((offenderAlert as { offenderId: number }).offenderId, guestId)

    // skip silences the same value; a *different* value re-alerts
    push(host, { kind: 'C_SETTINGS_VERDICT', playerId: guestId, action: 'skip' })
    push(guest, { kind: 'C_DEV_SETTINGS', settings: { startingCredits: 8000 } })
    await sleep(250)
    assert.equal(alertCount(host), 1, 'skip must suppress repeats of the same value')
    push(guest, { kind: 'C_DEV_SETTINGS', settings: { startingCredits: 7000 } })
    assert.ok(await waitForAlertCount(host, 2), 'a new value must re-alert the host')

    // a second offender is flagged, then kick removes them over the wire
    push(cheater, { kind: 'C_DEV_SETTINGS', settings: { startingCredits: 6000 } })
    const cheaterAlert = await host.waitFor((m) => m.kind === 'H_SETTINGS_ALERT' && (m as { offenderId: number }).offenderId === cheaterId)
    assert.ok(cheaterAlert, 'host should be alerted about the cheater')
    assert.equal((cheaterAlert as { offenderId: number }).offenderId, cheaterId)

    const kickedCode = await new Promise<number>((resolve) => {
      cheater.ws.on('close', (code) => resolve(code))
      push(host, { kind: 'C_SETTINGS_VERDICT', playerId: cheaterId, action: 'kick' })
      setTimeout(() => resolve(-1), 3000)
    })
    assert.equal(kickedCode, 4001, 'kicked player socket must close with code 4001')
    assert.ok(cheaterId >= 0, 'cheater id should be resolvable')

    guest.ws.close()
    host.ws.close()
  })
})

describe('online server protocol version gate', () => {
  const makeRoom = async (): Promise<{ code: string; hash: string }> => {
    const { body } = await json('/api/rooms', {
      method: 'POST',
      headers: authed(),
      body: JSON.stringify({ hostName: 'Ver', passphrase: 'proto' }),
    })
    const code = (body as { roomCode: string }).roomCode
    return { code, hash: hashPassphrase('proto', code) }
  }

  const joinExpecting = (roomCode: string, hash: string, protocol: number | undefined, want: string): Promise<string | null> =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket(wsBase)
      ws.on('open', () => {
        ws.send(encodeControl({ kind: 'C_JOIN', roomCode, passphraseHash: hash, name: 'Proto' + (protocol ?? 'x'), token: TEST_TOKEN, ...(protocol !== undefined ? { protocol } : {}) }))
      })
      ws.on('message', (data) => {
        const msg = decodeControl(data.toString())
        if (msg.kind === want) {
          ws.close()
          resolve(want === 'H_LOBBY' ? 'joined' : (msg as { message: string }).message)
        }
      })
      ws.on('close', (code) => reject(new Error(`connection closed with ${code} while waiting for ${want}`)))
      ws.on('error', reject)
      setTimeout(() => reject(new Error(`timed out waiting for ${want}`)), 3000)
    })

  it('admits a client inside the grace band and rejects one far outside it', async () => {
    const { code, hash } = await makeRoom()
    assert.ok(await joinExpecting(code, hash, MIN_PROTOCOL_VERSION, 'H_LOBBY'), 'min protocol should join')
    const msg = await joinExpecting(code, hash, 9999, 'H_ERROR')
    assert.ok(msg !== null && /protocol \d+/.test(msg), `expected a protocol mismatch error, got ${msg}`)
  })

  it('admits clients that omit the protocol field (old clients)', async () => {
    const { code, hash } = await makeRoom()
    assert.ok(await joinExpecting(code, hash, undefined, 'H_LOBBY'), 'missing protocol should join')
  })
})

describe('online server wire-frame validation', () => {
  it('relays a valid command but drops malformed frames and kicks repeat offenders', async () => {
    const { body } = await json('/api/rooms', {
      method: 'POST',
      headers: authed(),
      body: JSON.stringify({ hostName: 'Gate', passphrase: 'wire' }),
    })
    const code = (body as { roomCode: string }).roomCode
    const hash = hashPassphrase('wire', code)

    type Sock = {
      ws: WebSocket
      yourId: number
      frames: Array<{ tick: number; commands: EnvelopeCommand[] }>
      msgs: Array<Record<string, unknown>>
      waitForFrames: (pred: (f: Sock['frames'][number]) => boolean, tries?: number) => Promise<boolean>
      waitForMsg: (kind: string, tries?: number) => Promise<boolean>
      waitClose: () => Promise<number | undefined>
    }
    const open = (name: string): Promise<Sock> =>
      new Promise((resolve, reject) => {
        const ws = new WebSocket(wsBase)
        const frames: Sock['frames'] = []
        const msgs: Array<Record<string, unknown>> = []
        const waitForFrames = async (pred: (f: Sock['frames'][number]) => boolean, tries = 40): Promise<boolean> => {
          for (let i = 0; i < tries; i++) {
            if (frames.some(pred)) return true
            await new Promise((r) => setTimeout(r, 50))
          }
          return false
        }
        const waitForMsg = async (kind: string, tries = 40): Promise<boolean> => {
          for (let i = 0; i < tries; i++) {
            if (msgs.some((m) => m.kind === kind)) return true
            await new Promise((r) => setTimeout(r, 50))
          }
          return false
        }
        const waitClose = (): Promise<number | undefined> =>
          new Promise((r) => {
            ws.on('close', (code) => r(code))
            setTimeout(() => r(undefined), 3000)
          })
        let yourId = -1
        ws.on('open', () => {
          ws.send(encodeControl({ kind: 'C_JOIN', roomCode: code, passphraseHash: hash, name, clientId: `wire-${name}-${Date.now()}`, protocol: 21, token: TEST_TOKEN }))
        })
        ws.on('message', (data, isBinary) => {
          if (isBinary) {
            const buf = new Uint8Array(data as ArrayBuffer)
            if (buf[0] === BIN.FRAME) frames.push(decodeFrame(buf))
            return
          }
          const msg = decodeControl(data.toString())
          msgs.push(msg as unknown as Record<string, unknown>)
          if (msg.kind === 'H_ERROR') reject(new Error(`server rejected join: ${(msg as { message: string }).message}`))
          if (msg.kind === 'H_LOBBY') {
            yourId = (msg as { yourId: number }).yourId
            resolve({ ws, yourId, frames, msgs, waitForFrames, waitForMsg, waitClose })
          }
        })
        ws.on('error', reject)
        ws.on('close', (code) => {
          if (code !== 4001) reject(new Error(`connection closed with ${code} before H_LOBBY`))
        })
        setTimeout(() => reject(new Error(`no H_LOBBY for ${name}`)), 3000)
      })

    const host = await open('Gate')
    const guest = await open('Guy')
    const hostId = host.yourId
    const guestId = guest.yourId

    const send = (t: Sock, msg: unknown): void => t.ws.send(encodeControl(msg as Parameters<typeof encodeControl>[0]))
    send(guest, { kind: 'C_READY', ready: true })
    await new Promise((r) => setTimeout(r, 150))
    send(host, { kind: 'C_START' })
    assert.ok(await host.waitForMsg('S_MATCH_START'), 'host should get S_MATCH_START')
    assert.ok(await guest.waitForMsg('S_MATCH_START'), 'guest should get S_MATCH_START')

    // Both sides loaded → the relay starts and frames begin broadcasting.
    send(host, { kind: 'C_LOADED' })
    send(guest, { kind: 'C_LOADED' })
    // Wait until the relay is actually ticking (guest has received an empty frame),
    // then send the command so it cannot race the relay startup.
    assert.ok(await guest.waitForFrames(() => true), 'relay should start broadcasting')
    const baselineN = guest.frames.filter((f) => f.commands.length > 0).length

    const valid = encodeCmd({
      player: hostId,
      seq: 1,
      tick: 0,
      cmd: { type: 'move', entities: [7], x: 480, y: 960 },
    })
    host.ws.send(valid)
    const relayed = await guest.waitForFrames((f) =>
      f.commands.some((c) => c.player === hostId && c.cmd.type === 'move' && c.cmd.entities[0] === 7),
    )
    const seen = guest.frames
      .filter((f) => f.commands.length > 0)
      .map((f) => ({ tick: f.tick, first: { p: f.commands[0].player, t: f.commands[0].cmd.type, seq: f.commands[0].seq } }))
      .slice(-4)
    assert.ok(relayed, `a valid command envelope must be relayed to the other player; guest saw ${JSON.stringify(seen)}, nonEmptyBefore=${baselineN}`)

    // Malformed frames: unknown command type, a truncated envelope, trailing bytes.
    const garbage = [
      new Uint8Array([BIN.CMD, 250]), // unknown type id 250
      new Uint8Array([BIN.CMD, 0, 0, 0, 0, 0, guestId, 1, 0, 0, 0]), // truncated entity list
      (() => {
        const b = new Uint8Array(encodeCmd({ player: guestId, seq: 2, tick: 0, cmd: { type: 'move', entities: [], x: 5, y: 5 } }))
        const withTrail = new Uint8Array(b.length + 1)
        withTrail.set(b)
        withTrail[b.length] = 0xff
        return withTrail
      })(), // valid envelope + trailing byte
    ]
    for (let n = 0; n < 10; n++) guest.ws.send(garbage[n % garbage.length])
    const closeCode = await guest.waitClose()
    assert.equal(closeCode, 4002, 'repeat protocol offenders must be disconnected with code 4002')
    assert.equal(host.ws.readyState, WebSocket.OPEN, 'the innocent player must stay connected')

    guest.ws.close()
    host.ws.close()
  })
})

describe('online server balance-mod gate', () => {
  type Tracked = {
    ws: WebSocket
    msgs: Array<Record<string, unknown>>
    waitForMsg: (pred: string | ((m: Record<string, unknown>) => boolean), tries?: number) => Promise<Record<string, unknown> | undefined>
  }

  const roomCode = async (hostName: string, passphrase: string): Promise<string> => {
    const { status, body } = await json('/api/rooms', {
      method: 'POST',
      headers: authed(),
      body: JSON.stringify({ hostName, passphrase }),
    })
    assert.equal(status, 201)
    return (body as { ok: boolean; roomCode: string }).roomCode
  }

  const openTracked = (code: string, hash: string, name: string): Promise<Tracked> =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket(wsBase)
      const msgs: Array<Record<string, unknown>> = []
      const waitForMsg = async (pred: string | ((m: Record<string, unknown>) => boolean), tries = 40): Promise<Record<string, unknown> | undefined> => {
        const match = typeof pred === 'string' ? (m: Record<string, unknown>) => m.kind === pred : pred
        for (let i = 0; i < tries; i++) {
          const found = msgs.find(match)
          if (found) return found
          await new Promise((r) => setTimeout(r, 50))
        }
        return undefined
      }
      ws.on('open', () => {
        ws.send(encodeControl({ kind: 'C_JOIN', roomCode: code, passphraseHash: hash, name, clientId: `mod-${name}-${Date.now()}`, token: TEST_TOKEN }))
      })
      ws.on('message', (data) => {
        const msg = decodeControl(data.toString()) as unknown as Record<string, unknown>
        msgs.push(msg)
        if (msg.kind === 'H_LOBBY') resolve({ ws, msgs, waitForMsg })
      })
      ws.on('error', reject)
      setTimeout(() => reject(new Error(`no H_LOBBY for ${name}`)), 3000)
    })

  const push = (t: Tracked, m: unknown): void => t.ws.send(encodeControl(m as Parameters<typeof encodeControl>[0]))

  const modFile = {
    meta: { name: 'marathon.json', author: 'Tester', version: '1.2', description: 'Longer games' },
    settings: { sellRefundFraction: 0.4, maxBuildOrders: 4 },
    unitOverrides: { rifleman: { cost: 120 } },
  }

  const lastLobby = (t: Tracked): Record<string, unknown> | undefined => {
    for (let i = t.msgs.length - 1; i >= 0; i--) {
      if (t.msgs[i].kind === 'H_LOBBY') return t.msgs[i]
    }
    return undefined
  }

  const lobbyWithGuestModOk = (guest: Tracked, want: boolean): boolean => {
    const lobby = lastLobby(guest)
    if (!lobby) return false
    const guestRow = (lobby.players as Array<{ host: boolean; modOk?: boolean }>).find((p) => !p.host)
    return !!guestRow && guestRow.modOk === want
  }

  it('host uploads a mod: lobby announces it, settings merge, guests must ack to start', async () => {
    const code = await roomCode('ModHost', 'mod1')
    const hash = hashPassphrase('mod1', code)

    const host = await openTracked(code, hash, 'ModHost')
    const guest = await openTracked(code, hash, 'ModGuest')

    push(host, { kind: 'C_UPDATE_ROOM', modId: 'marathon.json', mod: modFile })

    const announced = await host.waitForMsg((m) => {
      if (m.kind !== 'H_LOBBY') return false
      const info = m.mod as { name?: string; hash?: string; size?: number } | undefined
      return !!info && info.name === 'marathon.json' && typeof info.hash === 'string' && info.hash.length === 8 && (info.size ?? 0) > 0
    })
    assert.ok(announced, 'host should see the mod announced in H_LOBBY')
    const announcedMod = (announced as { mod: { hash: string } }).mod
    const roomHash = announcedMod.hash

    // The host's pick + mod content merge into the room's effective settings.
    const merged = (lastLobby(host) as { settings?: { sellRefundFraction?: number; maxBuildOrders?: number; unitOverrides?: Record<string, Record<string, number>> } }).settings
    assert.equal(merged?.sellRefundFraction, 0.4)
    assert.equal(merged?.maxBuildOrders, 4)
    assert.deepEqual(merged?.unitOverrides, { rifleman: { cost: 120 } })

    // Guests see the requirement and are marked as not-yet-acked; the host is exempt.
    const guestLobby = lastLobby(guest)
    assert.ok((guestLobby as { mod?: unknown }).mod, 'guest lobby should announce the mod')
    assert.ok((guestLobby as { players: Array<{ modOk: boolean }> }).players.some((p) => p.modOk === false), 'guest should start modOk false')
    assert.ok((guestLobby as { players: Array<{ host: boolean; modOk: boolean }> }).players.some((p) => p.host && p.modOk === true), 'host should be exempt (modOk true)')

    // The room mod is downloadable over REST and its content hashes to the announced hash.
    const dl = await json(`/api/rooms/${code}/mod`)
    assert.equal(dl.status, 200)
    const dlBody = dl.body as { ok: boolean; name: string; hash: string; mod: typeof modFile }
    assert.equal(dlBody.ok, true)
    assert.equal(dlBody.name, 'marathon.json')
    assert.equal(dlBody.hash, roomHash)
    // LAN-host semantics: the client installs the downloaded (sanitized) file; it must hash
    // to the same value the server is gating on.
    const sanitized = sanitizeMod(dlBody.mod)
    assert.ok(sanitized, 'downloaded mod should re-sanitize')
    assert.equal(modHash(sanitized), roomHash)

    // Lobby list advertises the mod before anyone joins.
    const list = await json('/api/rooms')
    const listed = (list.body as { rooms: Array<{ id: string; modId?: string }> }).rooms.find((r) => r.id === code)
    assert.equal(listed?.modId, 'marathon.json')

    // A wrong ack doesn't satisfy the gate; the host cannot start.
    push(guest, { kind: 'C_MOD_ACK', hash: '00000000' })
    push(host, { kind: 'C_READY', ready: true })
    push(guest, { kind: 'C_READY', ready: true })
    await new Promise((r) => setTimeout(r, 150))
    push(host, { kind: 'C_START' })
    const blocked = await host.waitForMsg((m) => m.kind === 'H_ERROR' && /mod|install/i.test(String(m.message ?? '')), 20)
    assert.ok(blocked, 'start should be refused while the guest lacks the mod')
    assert.ok(!lobbyWithGuestModOk(guest, true), 'guest should still be modOk false')

    // Correct ack → the gate opens and the match starts for everyone.
    push(guest, { kind: 'C_MOD_ACK', hash: roomHash })
    assert.ok(await guest.waitForMsg(() => lobbyWithGuestModOk(guest, true)), 'guest should become modOk true after the right ack')
    push(host, { kind: 'C_START' })
    assert.ok(await host.waitForMsg('S_MATCH_START'), 'host should get S_MATCH_START')
    assert.ok(await guest.waitForMsg('S_MATCH_START'), 'guest should get S_MATCH_START')

    guest.ws.close()
    host.ws.close()
  })

  it('host can clear the mod and then start without any ack', async () => {
    const code = await roomCode('ClearHost', 'mod2')
    const hash = hashPassphrase('mod2', code)
    const host = await openTracked(code, hash, 'ClearHost')
    const guest = await openTracked(code, hash, 'ClearGuest')

    push(host, { kind: 'C_UPDATE_ROOM', modId: 'short.json', mod: { meta: { name: 'short.json' }, settings: { maxBuildOrders: 3 } } })
    assert.ok(await host.waitForMsg((m) => m.kind === 'H_LOBBY' && !!m.mod), 'mod should be advertised')

    push(host, { kind: 'C_UPDATE_ROOM', modId: '' })
    let sawAnnounced = false
    const cleared = await host.waitForMsg((m) => {
      if (m.kind !== 'H_LOBBY') return false
      if (m.mod && (m as { modId?: string }).modId === 'short.json') {
        sawAnnounced = true
        return false
      }
      return sawAnnounced && (m.modId === undefined || m.modId === '') && m.mod === undefined
    })
    assert.ok(cleared, 'mod should be cleared from the lobby')
    assert.equal(lastLobby(host)?.modId, undefined)

    const guestCleared = await guest.waitForMsg((m) => m.kind === 'H_LOBBY' && (m.modId === undefined || m.modId === '') && m.mod === undefined)
    assert.ok(guestCleared, 'guest should see the mod cleared')
    const afterClear = lastLobby(guest)
    assert.equal((afterClear as { settings: { maxBuildOrders?: number } }).settings.maxBuildOrders, 3, 'sim settings keep the merged value until re-pushed')

    push(guest, { kind: 'C_READY', ready: true })
    await new Promise((r) => setTimeout(r, 150))
    push(host, { kind: 'C_START' })
    assert.ok(await guest.waitForMsg('S_MATCH_START'), 'guest should get S_MATCH_START without a mod ack')
    assert.ok(await host.waitForMsg('S_MATCH_START'), 'host should get S_MATCH_START')

    guest.ws.close()
    host.ws.close()
  })
})

describe('online server room auth gate', () => {
  /** Creates a room over authenticated REST and returns its code + passphrase hash. */
  const roomWith = async (hostName: string, passphrase: string): Promise<{ code: string; hash: string }> => {
    const { status, body } = await json('/api/rooms', {
      method: 'POST',
      headers: authed(),
      body: JSON.stringify({ hostName, passphrase }),
    })
    assert.equal(status, 201)
    const code = (body as { roomCode: string }).roomCode
    return { code, hash: hashPassphrase(passphrase, code) }
  }

  /** Sends C_JOIN and resolves with the first H_ERROR message, or rejects on timeout. */
  const joinExpectingError = (msg: Record<string, unknown>): Promise<string> =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket(wsBase)
      const timer = setTimeout(() => {
        ws.close()
        reject(new Error('no H_ERROR received'))
      }, 4000)
      ws.on('open', () => {
        ws.send(encodeControl(msg as Parameters<typeof encodeControl>[0]))
      })
      ws.on('message', (data) => {
        const m = decodeControl(data.toString())
        if (m.kind === 'H_ERROR') {
          clearTimeout(timer)
          ws.close()
          resolve((m as { message: string }).message)
        }
      })
      ws.on('error', (e) => {
        clearTimeout(timer)
        reject(e)
      })
    })

  /** Sends C_JOIN and resolves true when the socket reaches H_LOBBY. */
  const joinExpectingLobby = (msg: Record<string, unknown>): Promise<boolean> =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket(wsBase)
      const timer = setTimeout(() => {
        ws.close()
        reject(new Error('no H_LOBBY received'))
      }, 4000)
      ws.on('open', () => {
        ws.send(encodeControl(msg as Parameters<typeof encodeControl>[0]))
      })
      ws.on('message', (data) => {
        const m = decodeControl(data.toString())
        if (m.kind === 'H_LOBBY') {
          clearTimeout(timer)
          ws.close()
          resolve(true)
        }
        if (m.kind === 'H_ERROR') {
          clearTimeout(timer)
          ws.close()
          reject(new Error(`join refused: ${(m as { message: string }).message}`))
        }
      })
      ws.on('error', (e) => {
        clearTimeout(timer)
        reject(e)
      })
    })

  it('creating a room requires an active session', async () => {
    const anon = await json('/api/rooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hostName: 'NoAcct', passphrase: '' }),
    })
    assert.equal(anon.status, 401)
    assert.equal((anon.body as { error: string }).error, 'unauthorized')

    const bogus = await json('/api/rooms', {
      method: 'POST',
      headers: authed({ authorization: 'Bearer not-a-real-token' }),
      body: JSON.stringify({ hostName: 'BadTok', passphrase: '' }),
    })
    assert.equal(bogus.status, 401)
    assert.equal((bogus.body as { error: string }).error, 'invalid session')

    // …and a valid session still works.
    const ok = await json('/api/rooms', {
      method: 'POST',
      headers: authed(),
      body: JSON.stringify({ hostName: 'HasAcct', passphrase: '' }),
    })
    assert.equal(ok.status, 201)
  })

  it('a 401 carries WWW-Authenticate: Bearer', async () => {
    const r = await fetch(`${base}/api/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hostName: 'Hdr', passphrase: '' }),
    })
    assert.equal(r.status, 401)
    assert.match(r.headers.get('www-authenticate') ?? '', /bearer/i)
  })

  it('join pre-check requires a session, and auth precedes the room lookup', async () => {
    const { code } = await roomWith('JoinGate', 'jg')

    const anon = await json(`/api/rooms/${code}/join`, { method: 'POST' })
    assert.equal(anon.status, 401)

    const bogus = await json(`/api/rooms/${code}/join`, {
      method: 'POST',
      headers: authed({ authorization: 'Bearer nope' }),
    })
    assert.equal(bogus.status, 401)

    // Unknown room *and* no session → 401, not 404: the status code must not leak which
    // room codes exist.
    const unknownAnon = await json('/api/rooms/ZZZZ/join', { method: 'POST' })
    assert.equal(unknownAnon.status, 401)

    const ok = await json(`/api/rooms/${code}/join`, { method: 'POST', headers: authed() })
    assert.equal(ok.status, 200)
    assert.ok(((ok.body as { ws: string }).ws).endsWith('/ws'))
  })

  it('the public surface stays readable without a session', async () => {
    for (const path of ['/api/status', '/api/rooms', '/api/rooms/search', '/api/leaderboard']) {
      const { status } = await json(path)
      assert.equal(status, 200, `${path} must stay public`)
    }
  })

  it('C_JOIN rejects a missing token and takes no slot', async () => {
    const { code, hash } = await roomWith('WsNoToken', 'nt')
    const clientId = `no-token-${Date.now()}`

    const err = await joinExpectingError({ kind: 'C_JOIN', roomCode: code, passphraseHash: hash, name: 'Anon', clientId })
    assert.equal(err, 'unauthorized')

    // No slot was consumed, so a properly authenticated join still fits.
    assert.ok(await joinExpectingLobby({ kind: 'C_JOIN', roomCode: code, passphraseHash: hash, name: 'Real', clientId: `${clientId}-b`, token: TEST_TOKEN }))
  })

  it('C_JOIN rejects an unverified token (the old shape check let this through)', async () => {
    const { code, hash } = await roomWith('WsBadToken', 'bt')
    const err = await joinExpectingError({
      kind: 'C_JOIN',
      roomCode: code,
      passphraseHash: hash,
      name: 'Garbage',
      clientId: `bad-token-${Date.now()}`,
      token: 'garbage',
    })
    assert.equal(err, 'invalid session')
  })

  it('C_JOIN admits a verified token and spectating is authenticated too', async () => {
    const { code, hash } = await roomWith('WsGood', 'gg')
    // Spectator flag without a token must be refused — it takes a slot like any join.
    const specErr = await joinExpectingError({ kind: 'C_JOIN', roomCode: code, passphraseHash: hash, name: 'Spec', clientId: `spec-${Date.now()}`, spectator: true })
    assert.equal(specErr, 'unauthorized')
    // Spectator flag *with* a token is admitted, and the refused attempt cost no slot.
    assert.ok(await joinExpectingLobby({ kind: 'C_JOIN', roomCode: code, passphraseHash: hash, name: 'Spec', clientId: `spec2-${Date.now()}`, spectator: true, token: TEST_TOKEN }))
  })

  it('a broken auth service is a 503, never an anonymous success', async () => {
    // Build the room while auth is healthy, then break it.
    const { code, hash } = await roomWith('DownAuth', 'da')
    stubAuthBroken = true
    try {
      const r = await fetch(`${base}/api/rooms/${code}/join`, { method: 'POST', headers: authed() })
      assert.equal(r.status, 503)
      assert.equal(((await r.json()) as { error: string }).error, 'auth-unavailable')
      // No WWW-Authenticate on 503: it is a server-side outage, not a credential problem.
      assert.equal(r.headers.get('www-authenticate'), null)

      const create = await fetch(`${base}/api/rooms`, {
        method: 'POST',
        headers: authed(),
        body: JSON.stringify({ hostName: 'DownHost', passphrase: '' }),
      })
      assert.equal(create.status, 503)

      const wsErr = await joinExpectingError({
        kind: 'C_JOIN',
        roomCode: code,
        passphraseHash: hash,
        name: 'Down',
        clientId: `down-${Date.now()}`,
        token: TEST_TOKEN,
      })
      assert.equal(wsErr, 'auth-unavailable')
    } finally {
      stubAuthBroken = false
    }
  })

  it('the room balance mod stays downloadable without a session', async () => {
    // Documented decision: the room mod is host-supplied match configuration, not account
    // data, and the download only runs after an authenticated C_JOIN already succeeded.
    const { code, hash } = await roomWith('ModPub', 'mp')
    assert.ok(
      await joinExpectingLobby({ kind: 'C_JOIN', roomCode: code, passphraseHash: hash, name: 'ModHost', clientId: `modpub-${Date.now()}`, token: TEST_TOKEN }),
    )
    const { status } = await json(`/api/rooms/${code}/mod`)
    assert.equal(status, 404, 'no mod uploaded yet, but the route is reachable anonymously')
  })

  it('the per-account room-write limit holds even from a fresh IP', async () => {
    // Separate spawn with a tiny *account* budget and a generous IP one, so the third
    // 429 can only come from the account-keyed limiter.
    const limited = await spawnOnline({
      SUPABASE_URL: stub.url,
      SUPABASE_ANON_KEY: 'stub-anon',
      SUPABASE_SERVICE_ROLE_KEY: 'stub-service',
      SA_RATE_ROOM_WRITE_PER_ACCOUNT_MIN: '2',
      SA_RATE_ROOM_WRITE_PER_MIN: '200',
    })
    try {
      const post = async (): Promise<number> => {
        const r = await fetch(`${limited.base}/api/rooms`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${TEST_TOKEN}` },
          body: JSON.stringify({ hostName: 'Flooder', passphrase: '' }),
        })
        return r.status
      }
      assert.equal(await post(), 201)
      assert.equal(await post(), 201)
      const blocked = await post()
      assert.equal(blocked, 429, 'third room write in the window must be refused per account')
      assert.match((await fetch(`${limited.base}/api/rooms`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TEST_TOKEN}` }, body: JSON.stringify({ hostName: 'Flooder2', passphrase: '' }) }).then((r) => r.headers.get('retry-after'))) ?? '', /^\d+$/)
    } finally {
      limited.child.kill()
    }
  })

  it('a second account gets its own identity, so slots bind per user', async () => {
    const { code, hash } = await roomWith('TwoUsers', 'tu')
    const joined = await new Promise<{ id: number; name: string }>((resolve, reject) => {
      const ws = new WebSocket(wsBase)
      const timer = setTimeout(() => reject(new Error('no H_LOBBY')), 4000)
      ws.on('open', () => {
        ws.send(encodeControl({ kind: 'C_JOIN', roomCode: code, passphraseHash: hash, name: 'UserB', clientId: `ub-${Date.now()}`, token: TEST_TOKEN_B }))
      })
      ws.on('message', (data) => {
        const m = decodeControl(data.toString())
        if (m.kind === 'H_LOBBY') {
          clearTimeout(timer)
          ws.close()
          const you = (m as { yourId: number }).yourId
          const row = (m as { players: Array<{ id: number; name: string }> }).players.find((p) => p.id === you)
          if (row) resolve(row)
        }
      })
      ws.on('error', reject)
    })
    assert.equal(joined.name, 'UserB')
  })
})