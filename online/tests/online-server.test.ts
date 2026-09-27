import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import WebSocket from 'ws'
import { decodeControl, encodeControl } from '../shared/src/index.ts'
import { hashPassphrase } from '../src/passphrase.ts'
import { rateLimit } from '../src/ratelimit.ts'
import { MOD_MAX_BYTES, modLabel, sanitizeMod } from '../src/mods.ts'
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