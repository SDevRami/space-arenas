import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import WebSocket from 'ws'
import { decodeControl, decodeFrame, encodeControl, encodeCmd, BIN, MIN_PROTOCOL_VERSION, type EnvelopeCommand } from '../shared/src/index.ts'
import { hashPassphrase } from '../src/passphrase.ts'
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

before(async () => {
  const port = await freePort()
  child = spawn(process.execPath, ['dist/online.js'], {
    env: { ...process.env, SA_MODE: 'online', SA_PORT: String(port) },
    stdio: 'ignore',
  })
  base = `http://127.0.0.1:${port}`
  wsBase = `ws://127.0.0.1:${port}/ws`
  const up = await waitFor(async () => {
    const r = await fetch(`${base}/api/status`)
    return r.ok && ((await r.json()) as { ok?: boolean }).ok === true
  })
  assert.ok(up, 'server did not come up')
})

after(() => {
  child?.kill()
})

const json = async (path: string, init?: RequestInit): Promise<{ status: number; body: unknown }> => {
  const r = await fetch(`${base}${path}`, init)
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
      headers: { 'content-type': 'application/json' },
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
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    assert.equal(status, 200)
    const j = join as { ok: boolean; ws: string }
    assert.equal(j.ok, true)
    assert.ok(j.ws.endsWith('/ws'))
  })

  it('join pre-check 404s on an unknown room', async () => {
    const { status } = await json('/api/rooms/ZZZZ/join', { method: 'POST' })
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
  it('status reports db:false when SUPABASE env is missing', async () => {
    const { status, body } = await json('/api/status')
    assert.equal(status, 200)
    assert.equal((body as { db: boolean }).db, false)
    assert.equal((body as { registered: number | null }).registered, null)
  })

  it('auth register returns 503 without DB config', async () => {
    const { status, body } = await json('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'x', email: 'x@x.com', password: '123456' }),
    })
    assert.equal(status, 503)
    assert.equal((body as { error: string }).error, 'database not configured')
  })

  it('auth login returns 503 without DB config', async () => {
    const { status } = await json('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'x@x.com', password: '123456' }),
    })
    assert.equal(status, 503)
  })

  it('auth change-password returns 503 without DB config', async () => {
    const { status } = await json('/api/auth/change-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 't', newPassword: '123456' }),
    })
    assert.equal(status, 503)
  })

  it('auth me returns 401 for a bogus token without DB config', async () => {
    const { status } = await json('/api/auth/me', { headers: { authorization: 'Bearer bogus' } })
    assert.equal(status, 401)
  })

  it('leaderboard returns 503 without DB config', async () => {
    const { status, body } = await json('/api/leaderboard')
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
    const { status, body } = await json('/api/mods/repo')
    assert.equal(status, 503)
    assert.equal((body as { error: string }).error, 'database not configured')
  })

  it('mod download returns 503 without DB config', async () => {
    const { status, body } = await json('/api/mods/00000000-0000-0000-0000-000000000000')
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
    const { status, body } = await json('/api/maps/repo')
    assert.equal(status, 503)
    assert.equal((body as { error: string }).error, 'database not configured')
  })

  it('map download returns 503 without DB config', async () => {
    const { status, body } = await json('/api/maps/00000000-0000-0000-0000-000000000000')
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
      headers: { 'content-type': 'application/json' },
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
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hostName: 'Locked', passphrase: 'right' }),
    })
    const code = (body as { roomCode: string }).roomCode
    const good = hashPassphrase('right', code)
    const bad = hashPassphrase('wrong', code)
    assert.notEqual(good, bad)

    const err = await new Promise<string>((resolve, reject) => {
      const ws = new WebSocket(wsBase)
      ws.on('open', () => {
        ws.send(encodeControl({ kind: 'C_JOIN', roomCode: code, passphraseHash: bad, name: 'Sneaky' }))
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
      headers: { 'content-type': 'application/json' },
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
          ws.send(encodeControl({ kind: 'C_JOIN', roomCode: code, passphraseHash: hash, name, clientId: `tamper-${name}-${Date.now()}` }))
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
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hostName: 'Ver', passphrase: 'proto' }),
    })
    const code = (body as { roomCode: string }).roomCode
    return { code, hash: hashPassphrase('proto', code) }
  }

  const joinExpecting = (roomCode: string, hash: string, protocol: number | undefined, want: string): Promise<string | null> =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket(wsBase)
      ws.on('open', () => {
        ws.send(encodeControl({ kind: 'C_JOIN', roomCode, passphraseHash: hash, name: 'Proto' + (protocol ?? 'x'), ...(protocol !== undefined ? { protocol } : {}) }))
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
      headers: { 'content-type': 'application/json' },
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
          ws.send(encodeControl({ kind: 'C_JOIN', roomCode: code, passphraseHash: hash, name, clientId: `wire-${name}-${Date.now()}`, protocol: 21 }))
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