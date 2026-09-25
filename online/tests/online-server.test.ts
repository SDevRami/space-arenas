import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import WebSocket from 'ws'
import { decodeControl, encodeControl } from '../shared/src/index.ts'
import { hashPassphrase } from '../src/passphrase.ts'

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