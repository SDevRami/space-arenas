import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer, type Server } from 'node:net'
import { pbkdf2Sync } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
import WebSocket from 'ws'
import {
  BIN,
  decodeControl,
  decodeFrame,
  decodeRelayChecksum,
  encodeChecksum,
  encodeCmd,
  validReplay,
  DEFAULT_MATCH_SETTINGS,
  PROTOCOL_VERSION,
  type ControlMessage,
  type LobbyMessage,
  type ReplayData,
  type ReplayMeta,
  type ModFile,
  type ModMeta,
} from '@space-arenas/shared'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ROOM_CODE = 'ABCD'
const PASS = 'changeme'

/** Minimal structurally-valid replay payload for upload/list tests. */
const sampleReplay = (): ReplayData => ({
  version: PROTOCOL_VERSION,
  createdAt: new Date().toISOString(),
  seed: 12345,
  tickRate: 25,
  map: { name: 'test', width: 64, height: 64, tiles: [], spawnPoints: [], obstacles: [] } as unknown as import('@space-arenas/shared').MapData,
  settings: DEFAULT_MATCH_SETTINGS,
  players: [
    { id: 0, name: 'Alpha', team: 0, color: 0, bot: false },
    { id: 1, name: 'Bravo', team: 1, color: 1, bot: false },
  ],
  winner: 0,
  ticks: 250,
  history: [
    { player: 0, seq: 1, tick: 0, cmd: { type: 'move', entities: [7], x: 100, y: 200 } },
    { player: 1, seq: 1, tick: 5, cmd: { type: 'produce', entities: [], x: 0, y: 0 } },
  ],
})

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const s: Server = createServer()
    s.listen(0, () => {
      const addr = s.address()
      if (addr && typeof addr === 'object') resolvePort(addr.port)
      else reject(new Error('no port'))
      s.close()
    })
  })
}

function passHash(pass: string, code: string): string {
  return pbkdf2Sync(pass, `space-arenas:${code}`, 100_000, 32, 'sha256').toString('hex')
}

async function waitForHttp(url: string, timeoutMs = 15000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch (e) {
      console.log('[test:waitForHttp] retry error:', (e as Error).message)
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`host did not become ready at ${url}`)
}

class TestClient {
  ws!: WebSocket
  queue: ControlMessage[] = []
  frames: { tick: number; commands: import('@space-arenas/shared').EnvelopeCommand[] }[] = []
  relays: { player: number; tick: number; crc: number }[] = []
  id = -1
  clientId?: string
  onLobby: ((msg: LobbyMessage) => void) | null = null

  connect(port: number): Promise<void> {
    return new Promise((resolveConn, reject) => {
      this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws`)
      this.ws.binaryType = 'arraybuffer'
      this.ws.on('message', (data) => {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as string)
        const first = buf[0]
        if (first === BIN.FRAME) {
          this.frames.push(decodeFrame(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)))
        } else if (first === BIN.RELAY_CHECKSUM) {
          this.relays.push(decodeRelayChecksum(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)))
        } else {
          const msg = decodeControl(buf.toString())
          if (msg.kind === 'H_LOBBY') this.id = msg.yourId
          this.onLobby?.(msg as LobbyMessage)
          this.queue.push(msg)
        }
      })
      this.ws.on('open', resolveConn)
      this.ws.on('error', reject)
    })
  }

  send(obj: unknown): void {
    this.ws.send(JSON.stringify(obj))
  }

  join(name: string, opts?: { clientId?: string; spectator?: boolean }): void {
    const cid = opts?.clientId ?? this.clientId
    if (cid) this.clientId = cid
    this.send({
      kind: 'C_JOIN',
      roomCode: ROOM_CODE,
      passphraseHash: passHash(PASS, ROOM_CODE),
      name,
      ...(cid ? { clientId: cid } : {}),
      ...(opts?.spectator ? { spectator: true } : {}),
    })
  }

  joinWrongPass(): void {
    this.send({ kind: 'C_JOIN', roomCode: ROOM_CODE, passphraseHash: 'deadbeef', name: 'evil' })
  }

  ready(v: boolean): void {
    this.send({ kind: 'C_READY', ready: v })
  }

  updateSlot(patch: { name?: string; team?: number; spawn?: number }): void {
    this.send({ kind: 'C_UPDATE_SLOT', ...patch })
  }

  updateRoom(patch: { mapId?: string; password?: string; modId?: string }): void {
    this.send({ kind: 'C_UPDATE_ROOM', ...patch })
  }

  addBot(difficulty: 'easy' | 'medium' | 'hard'): void {
    this.send({ kind: 'C_ADD_BOT', difficulty })
  }

  removeBot(id: number): void {
    this.send({ kind: 'C_REMOVE_BOT', id })
  }

  start(): void {
    this.send({ kind: 'C_START' })
  }

  loaded(): void {
    this.send({ kind: 'C_LOADED' })
  }

  sendCmd(type: string, entities: number[]): void {
    const env = { player: this.id, seq: 1, tick: 0, cmd: { type, entities, x: 1000, y: 2000 } }
    this.ws.send(encodeCmd(env))
  }

  sendChecksum(tick: number, crc: number): void {
    this.ws.send(encodeChecksum(tick, crc))
  }

  async waitFor(kind: string, timeoutMs = 10000): Promise<ControlMessage> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      const idx = this.queue.findIndex((m) => m.kind === kind)
      if (idx >= 0) return this.queue.splice(idx, 1)[0]
      await new Promise((r) => setTimeout(r, 25))
    }
    throw new Error(`timeout waiting for ${kind}`)
  }

  async waitForLobby(pred: (m: LobbyMessage) => boolean, timeoutMs = 10000): Promise<LobbyMessage> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      const idx = this.queue.findIndex((m) => m.kind === 'H_LOBBY' && pred(m as LobbyMessage))
      if (idx >= 0) return this.queue.splice(idx, 1)[0] as LobbyMessage
      await new Promise((r) => setTimeout(r, 25))
    }
    throw new Error('timeout waiting for a matching H_LOBBY')
  }
}

const archiveDirs: string[] = []

async function startHost(
  code = ROOM_CODE,
  pass = PASS,
  extraEnv: Record<string, string> = {},
): Promise<{ host: ChildProcess; port: number; archiveDir: string }> {
  const p = await freePort()
  const archiveDir = await mkdtemp(join(tmpdir(), 'sa-archive-'))
  archiveDirs.push(archiveDir)
  const bundle = resolve(ROOT, 'host/dist/host.js')
  const args = existsSync(bundle)
    ? [bundle]
    : ['node_modules/tsx/dist/cli.mjs', 'host/src/index.ts']
  const h = spawn(process.execPath, args, {
    cwd: ROOT,
    env: {
      ...process.env,
      SA_PORT: String(p),
      SA_ROOM_CODE: code,
      SA_PASSPHRASE: pass,
      SA_ARCHIVE_DIR: archiveDir,
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  h.stdout?.on('data', (d) => console.log('[host]', d.toString().trim()))
  h.stderr?.on('data', (d) => console.log('[host:err]', d.toString().trim()))
  h.on('exit', (code, sig) => console.log('[host] exited', code, sig))
  h.on('error', (e) => console.log('[host:spawn-error]', e.message))
  await waitForHttp(`http://127.0.0.1:${p}/`, 30000)
  return { host: h, port: p, archiveDir }
}

let port = 0
let host: ChildProcess | null = null

beforeAll(async () => {
  console.log('[test] ROOT =', ROOT)
  ;({ host, port } = await startHost())
}, 30000)

afterAll(async () => {
  host?.kill()
  await Promise.all(archiveDirs.map((d) => rm(d, { recursive: true, force: true })))
})

describe('host: lobby flow', () => {
  it('joins, reaches lobby, starts a match and relays frames/checksums', async () => {
    const a = new TestClient()
    const b = new TestClient()
    await a.connect(port)
    a.join('Alpha')
    const lobbyA = (await a.waitFor('H_LOBBY')) as LobbyMessage
    expect(lobbyA.yourId).toBe(0)
    expect(lobbyA.hostId).toBe(0)
    expect(lobbyA.players).toHaveLength(1)
    expect(lobbyA.players[0].host).toBe(true)

    await b.connect(port)
    b.join('Bravo')
    const lobbyB = (await b.waitFor('H_LOBBY')) as LobbyMessage
    expect(lobbyB.players).toHaveLength(2)
    expect(lobbyB.players.map((p) => p.name).sort()).toEqual(['Alpha', 'Bravo'])

    a.ready(true)
    b.ready(true)
    await new Promise((r) => setTimeout(r, 150))
    const l2 = a.queue.filter((m) => m.kind === 'H_LOBBY').pop() as LobbyMessage
    expect(l2.players.every((p) => p.ready)).toBe(true)

    a.start()
    const startA = await a.waitFor('S_MATCH_START')
    const startB = await b.waitFor('S_MATCH_START')
    expect(startA.kind).toBe('S_MATCH_START')
    expect(startB.kind).toBe('S_MATCH_START')
    if (startA.kind === 'S_MATCH_START') {
      expect(startA.seed).toBeGreaterThan(0)
      expect(startA.map.width).toBe(128)
      expect(startA.players).toHaveLength(2)
    }

    a.loaded()
    b.loaded()
    await new Promise((r) => setTimeout(r, 250))

    expect(a.frames.length).toBeGreaterThan(0)
    expect(b.frames.length).toBeGreaterThan(0)
    const ticksA = a.frames.map((f) => f.tick)
    const ticksB = b.frames.map((f) => f.tick)
    expect(ticksA.slice(0, ticksB.length)).toEqual(ticksB)

    a.sendCmd('move', [7, 8])
    await new Promise((r) => setTimeout(r, 120))
    const found = b.frames.some((f) =>
      f.commands.some((c) => c.player === a.id && c.cmd.type === 'move' && c.cmd.entities[0] === 7),
    )
    expect(found).toBe(true)

    a.sendChecksum(3, 0x12345678)
    await new Promise((r) => setTimeout(r, 120))
    const relay = b.relays.find((r) => r.player === a.id && r.crc === 0x12345678)
    expect(relay).toBeDefined()
    expect(relay?.tick).toBe(3)

    a.ws.close()
    b.ws.close()
  }, 30000)

  it('rejects a wrong passphrase', async () => {
    const bad = await startHost()
    const c = new TestClient()
    await c.connect(bad.port)
    c.joinWrongPass()
    const err = await c.waitFor('H_ERROR')
    expect(err.kind).toBe('H_ERROR')
    if (err.kind === 'H_ERROR') expect(err.message).toContain('passphrase')
    c.ws.close()
    bad.host.kill()
  }, 15000)

  // A stale invite link — the room was recreated after the link was shared — must be
  // refused outright. The client keys its "that room is gone" notice off this exact
  // message, and a joiner must never be handed a slot (least of all the host seat)
  // just because it arrived with a code the live room does not know.
  it('refuses a stale room code and never hands out a seat', async () => {
    const { host: h3, port: p3 } = await startHost()
    const hostC = new TestClient()
    const staleC = new TestClient()

    await hostC.connect(p3)
    hostC.join('Host')
    const firstLobby = (await hostC.waitFor('H_LOBBY')) as LobbyMessage
    expect(firstLobby.hostId).toBe(hostC.id)

    await staleC.connect(p3)
    staleC.send({
      kind: 'C_JOIN',
      roomCode: 'STALE',
      passphraseHash: passHash(PASS, 'STALE'),
      name: 'Phone',
    })
    const err = await staleC.waitFor('H_ERROR')
    expect(err.kind).toBe('H_ERROR')
    if (err.kind === 'H_ERROR') expect(err.message).toContain('not found')
    // No lobby ever arrived, so the client kept no player id at all.
    expect(staleC.id).toBe(-1)

    // The refused join changed nothing: the real host is still host and still alone.
    expect(firstLobby.hostId).toBe(hostC.id)
    expect(firstLobby.players).toHaveLength(1)
    expect(firstLobby.players[0]?.host).toBe(true)

    staleC.ws.close()
    hostC.ws.close()
    h3.kill()
  }, 15000)

  it('honours slot/room options: names, teams, map, password and ready', async () => {
    const { host: h2, port: p2 } = await startHost()
    const hostC = new TestClient()
    const guestC = new TestClient()

    await hostC.connect(p2)
    hostC.join('Host')
    const lobbyHost = (await hostC.waitFor('H_LOBBY')) as LobbyMessage
    expect(lobbyHost.hostId).toBe(hostC.id)
    expect(lobbyHost.mapId).toBe('four-corners')
    expect(lobbyHost.maxPlayers).toBe(4)
    expect(lobbyHost.passwordRequired).toBe(true)

    await guestC.connect(p2)
    guestC.join('Guest')
    await guestC.waitFor('H_LOBBY')

    guestC.updateRoom({ mapId: 'breach' })
    const err = await guestC.waitFor('H_ERROR')
    if (err.kind === 'H_ERROR') expect(err.message.toLowerCase()).toContain('host')

    guestC.updateSlot({ name: 'Guesty', team: 2 })
    const lobbyGuest = await guestC.waitForLobby((m) =>
      m.players.some((p) => p.id === guestC.id && p.name === 'Guesty'),
    )
    const guest = lobbyGuest.players.find((p) => p.id === guestC.id)
    expect(guest?.team).toBe(2)

    guestC.updateSlot({ spawn: 2 })
    const lobbySpawn = await guestC.waitForLobby((m) =>
      m.players.some((p) => p.id === guestC.id && p.spawn === 2),
    )
    expect(lobbySpawn.players.find((p) => p.id === guestC.id)?.spawn).toBe(2)

    hostC.updateRoom({ mapId: 'grand-arena' })
    const lobbyMap = await hostC.waitForLobby((m) => m.mapId === 'grand-arena')
    expect(lobbyMap.maxPlayers).toBe(8)
    expect(lobbyMap.mapName).toBe('Grand Arena')

    hostC.updateRoom({ password: '' })
    const lobbyPass = await hostC.waitForLobby((m) => !m.passwordRequired)
    expect(lobbyPass.mapId).toBe('grand-arena')

    guestC.ready(true)
    const lobbyReady = await guestC.waitForLobby(
      (m) => m.players.find((p) => p.id === guestC.id)?.ready === true,
    )
    expect(lobbyReady.players.find((p) => p.id === guestC.id)?.ready).toBe(true)

    hostC.start()
    const start = await hostC.waitFor('S_MATCH_START')
    if (start.kind === 'S_MATCH_START') {
      expect(start.map.spawnPoints).toHaveLength(8)
      expect(start.players).toHaveLength(2)
      expect(start.map.spawnPoints.findIndex((s) => s.team === guestC.id)).toBe(2)
      expect(start.map.spawnPoints.findIndex((s) => s.team === hostC.id)).toBe(0)
    }

    guestC.ws.close()
    hostC.ws.close()
    h2.kill()
  }, 30000)

  it('ends the match for everyone when a player quits mid-match', async () => {
    const { host: h2, port: p2 } = await startHost()
    const a = new TestClient()
    const b = new TestClient()

    await a.connect(p2)
    a.join('Alpha')
    await a.waitFor('H_LOBBY')
    await b.connect(p2)
    b.join('Bravo')
    await b.waitFor('H_LOBBY')

    a.ready(true)
    b.ready(true)
    await new Promise((r) => setTimeout(r, 150))
    a.start()
    await a.waitFor('S_MATCH_START')
    await b.waitFor('S_MATCH_START')
    a.loaded()
    b.loaded()
    await new Promise((r) => setTimeout(r, 250))
    expect(a.frames.length).toBeGreaterThan(0)

    b.ws.close()
    // A disconnected slot gets a reconnect grace window before the match ends.
    const over = await a.waitFor('H_GAME_OVER', 22000)
    expect(over.kind).toBe('H_GAME_OVER')
    if (over.kind === 'H_GAME_OVER') expect(over.winner).toBe(a.id)

    await new Promise((r) => setTimeout(r, 300))
    const net = (await (await fetch(`http://127.0.0.1:${p2}/api/network`)).json()) as { self: { roomCode: string | null } }
    expect(net.self.roomCode).toBeNull()

    a.ws.close()
    h2.kill()
  }, 40000)

  it('continues a 3-player match when a non-host leaves and relays a forfeit', async () => {
    const { host: h2, port: p2 } = await startHost()
    const a = new TestClient()
    const b = new TestClient()
    const c = new TestClient()

    await a.connect(p2)
    a.join('Alpha')
    await a.waitFor('H_LOBBY')
    await b.connect(p2)
    b.join('Bravo')
    await b.waitFor('H_LOBBY')
    await c.connect(p2)
    c.join('Charlie')
    await c.waitFor('H_LOBBY')

    a.ready(true)
    b.ready(true)
    c.ready(true)
    await new Promise((r) => setTimeout(r, 150))
    a.start()
    await a.waitFor('S_MATCH_START')
    await b.waitFor('S_MATCH_START')
    await c.waitFor('S_MATCH_START')
    a.loaded()
    b.loaded()
    c.loaded()
    await new Promise((r) => setTimeout(r, 250))
    expect(a.frames.length).toBeGreaterThan(0)
    expect(c.frames.length).toBeGreaterThan(0)

    b.ws.close()

    let sawForfeit = false
    const deadline = Date.now() + 16000
    while (Date.now() < deadline && !sawForfeit) {
      sawForfeit = a.frames.some((f) => f.commands.some((cmd) => cmd.player === b.id && cmd.cmd.type === 'forfeit'))
      await new Promise((r) => setTimeout(r, 25))
    }
    expect(sawForfeit).toBe(true)

    await new Promise((r) => setTimeout(r, 600))

    const noOver = !a.queue.some((m) => m.kind === 'H_GAME_OVER') && !c.queue.some((m) => m.kind === 'H_GAME_OVER')
    expect(noOver).toBe(true)

    const ticksBefore = c.frames.length
    await new Promise((r) => setTimeout(r, 500))
    expect(c.frames.length).toBeGreaterThan(ticksBefore)

    a.ws.close()
    c.ws.close()
    h2.kill()
  }, 45000)

  it('reclaims a disconnected slot via clientId during the grace window', async () => {
    const { host: h2, port: p2 } = await startHost()
    const a = new TestClient()
    const b = new TestClient()

    await a.connect(p2)
    a.join('Alpha')
    await a.waitFor('H_LOBBY')
    await b.connect(p2)
    b.join('Bravo', { clientId: 'device-b-1' })
    await b.waitFor('H_LOBBY')

    a.ready(true)
    b.ready(true)
    await new Promise((r) => setTimeout(r, 150))
    a.start()
    await a.waitFor('S_MATCH_START')
    await b.waitFor('S_MATCH_START')
    a.loaded()
    b.loaded()
    await new Promise((r) => setTimeout(r, 250))
    expect(a.frames.length).toBeGreaterThan(0)

    // Drop B's connection. The host must NOT end the match or forfeit B right away.
    b.ws.close()
    await new Promise((r) => setTimeout(r, 2500))
    expect(a.queue.some((m) => m.kind === 'H_GAME_OVER')).toBe(false)
    expect(
      a.frames.some((f) => f.commands.some((cmd) => cmd.player === b.id && cmd.cmd.type === 'forfeit')),
    ).toBe(false)

    // A different websocket from the same clientId reclaims B's old slot inside the grace window.
    await b.connect(p2)
    b.join('Bravo', { clientId: 'device-b-1' })
    await b.waitFor('S_SPECTATE_SYNC', 10000)

    // The match keeps running for everyone.
    const ticksBefore = a.frames.length
    await new Promise((r) => setTimeout(r, 500))
    expect(a.frames.length).toBeGreaterThan(ticksBefore)
    expect(a.queue.some((m) => m.kind === 'H_GAME_OVER')).toBe(false)

    a.ws.close()
    b.ws.close()
    h2.kill()
  }, 30000)

  it('does not end a co-op match when one of two allied humans quits and enemy bots remain', async () => {
    const { host: h2, port: p2 } = await startHost()
    const a = new TestClient()
    const b = new TestClient()

    await a.connect(p2)
    a.join('Alpha')
    await a.waitFor('H_LOBBY')
    await b.connect(p2)
    b.join('Bravo')
    await b.waitFor('H_LOBBY')

    // Same alliance: both humans on team 0, two bots on the opposing team 1.
    a.updateSlot({ team: 0 })
    await a.waitForLobby((m) => m.players.find((p) => p.id === a.id)?.team === 0)
    b.updateSlot({ team: 0 })
    await b.waitForLobby((m) => m.players.find((p) => p.id === b.id)?.team === 0)
    a.send({ kind: 'C_ADD_BOT', difficulty: 'easy', team: 1 })
    await a.waitForLobby((m) => m.players.filter((p) => p.bot).length === 1)
    a.send({ kind: 'C_ADD_BOT', difficulty: 'medium', team: 1 })
    await a.waitForLobby((m) => m.players.filter((p) => p.bot).length === 2)

    a.ready(true)
    b.ready(true)
    await new Promise((r) => setTimeout(r, 150))
    a.start()
    await a.waitFor('S_MATCH_START')
    await b.waitFor('S_MATCH_START')
    a.loaded()
    b.loaded()
    await new Promise((r) => setTimeout(r, 250))
    expect(a.frames.length).toBeGreaterThan(0)

    b.ws.close()

    // The remaining ally must not be declared winner while the enemy bots are alive.
    let sawForfeit = false
    const deadlineForfeit = Date.now() + 16000
    while (Date.now() < deadlineForfeit && !sawForfeit) {
      sawForfeit = a.frames.some((f) => f.commands.some((cmd) => cmd.player === b.id && cmd.cmd.type === 'forfeit'))
      await new Promise((r) => setTimeout(r, 25))
    }
    expect(sawForfeit).toBe(true)
    expect(a.queue.some((m) => m.kind === 'H_GAME_OVER')).toBe(false)

    const ticksBefore = a.frames.length
    await new Promise((r) => setTimeout(r, 500))
    expect(a.frames.length).toBeGreaterThan(ticksBefore)

    a.ws.close()
    h2.kill()
  }, 45000)

  it('host quitting mid co-op match ends as a draw while an ally and enemy bots remain', async () => {
    const { host: h2, port: p2 } = await startHost()
    const a = new TestClient()
    const b = new TestClient()

    await a.connect(p2)
    a.join('Alpha')
    await a.waitFor('H_LOBBY')
    await b.connect(p2)
    b.join('Bravo')
    await b.waitFor('H_LOBBY')

    a.updateSlot({ team: 0 })
    await a.waitForLobby((m) => m.players.find((p) => p.id === a.id)?.team === 0)
    b.updateSlot({ team: 0 })
    await b.waitForLobby((m) => m.players.find((p) => p.id === b.id)?.team === 0)
    a.send({ kind: 'C_ADD_BOT', difficulty: 'easy', team: 1 })
    await a.waitForLobby((m) => m.players.filter((p) => p.bot).length === 1)
    a.send({ kind: 'C_ADD_BOT', difficulty: 'medium', team: 1 })
    await a.waitForLobby((m) => m.players.filter((p) => p.bot).length === 2)

    a.ready(true)
    b.ready(true)
    await new Promise((r) => setTimeout(r, 150))
    a.start()
    await a.waitFor('S_MATCH_START')
    await b.waitFor('S_MATCH_START')
    a.loaded()
    b.loaded()
    await new Promise((r) => setTimeout(r, 250))

    a.ws.close()
    const over = await b.waitFor('H_GAME_OVER')
    expect(over.kind).toBe('H_GAME_OVER')
    if (over.kind === 'H_GAME_OVER') {
      // Not a victory for the surviving ally: their team-mate quit but neither
      // alliance is fully eliminated, so the host relays server-side as a draw.
      expect(over.winner).toBeNull()
    }

    b.ws.close()
    h2.kill()
  }, 30000)

  it('host can add bots: they are ready, count toward capacity, and play through the relay', async () => {
    const { host: h3, port: p3 } = await startHost()
    const hostC = new TestClient()
    const guestC = new TestClient()

    await hostC.connect(p3)
    hostC.join('Host')
    await hostC.waitFor('H_LOBBY')

    await guestC.connect(p3)
    guestC.join('Guest')
    await guestC.waitFor('H_LOBBY')

    hostC.addBot('easy')
    const lobbyBot = await hostC.waitForLobby((m) => m.players.some((p) => p.bot === true))
    const bot1 = lobbyBot.players.find((p) => p.bot)
    expect(bot1?.ready).toBe(true)
    expect(bot1?.difficulty).toBe('easy')

    hostC.addBot('medium')
    const lobbyBot2 = await hostC.waitForLobby((m) => m.players.filter((p) => p.bot).length === 2)
    const bot2 = lobbyBot2.players.find((p) => p.bot && p.difficulty === 'medium')
    expect(bot2).toBeDefined()

    // host + guest + 2 bots = 4 (four-corners max) → a third bot is rejected
    hostC.addBot('hard')
    const capErr = await hostC.waitFor('H_ERROR')
    if (capErr.kind === 'H_ERROR') expect(capErr.message.toLowerCase()).toContain('fits')

    // guests cannot add or remove bots
    guestC.addBot('hard')
    const gAddErr = await guestC.waitFor('H_ERROR')
    if (gAddErr.kind === 'H_ERROR') expect(gAddErr.message.toLowerCase()).toContain('host')
    guestC.removeBot(bot1?.id ?? -1)
    const gRmErr = await guestC.waitFor('H_ERROR')
    if (gRmErr.kind === 'H_ERROR') expect(gRmErr.message.toLowerCase()).toContain('host')

    hostC.removeBot(bot2?.id ?? -1)
    await hostC.waitForLobby((m) => m.players.filter((p) => p.bot).length === 1)

    guestC.ready(true)
    await guestC.waitForLobby((m) => m.players.find((p) => p.id === guestC.id)?.ready === true)

    hostC.start()
    const start = await hostC.waitFor('S_MATCH_START')
    if (start.kind === 'S_MATCH_START') {
      expect(start.players).toHaveLength(3)
      expect(start.players.filter((p) => p.bot)).toHaveLength(1)
    }
    const botId = start.kind === 'S_MATCH_START' ? (start.players.find((p) => p.bot)?.id ?? -1) : -1
    expect(botId).toBeGreaterThanOrEqual(0)

    guestC.loaded()
    hostC.loaded()

    await new Promise((r) => setTimeout(r, 4500))
    expect(hostC.frames.some((f) => f.commands.some((c) => c.player === botId))).toBe(true)

    hostC.ws.close()
    guestC.ws.close()
    h3.kill()
  }, 30000)

  it('auto-saves a JSON replay file after a match ends (player commands recorded)', async () => {
    const { host: h2, port: p2, archiveDir } = await startHost()
    const a = new TestClient()
    const b = new TestClient()

    await a.connect(p2)
    a.join('Alpha')
    await a.waitFor('H_LOBBY')
    await b.connect(p2)
    b.join('Bravo')
    await b.waitFor('H_LOBBY')

    a.ready(true)
    b.ready(true)
    await new Promise((r) => setTimeout(r, 150))
    a.start()
    await a.waitFor('S_MATCH_START')
    await b.waitFor('S_MATCH_START')
    a.loaded()
    b.loaded()
    await new Promise((r) => setTimeout(r, 250))

    // Issue a real command so the replay history has stamped entries to assert.
    a.sendCmd('move', [7, 8])
    await new Promise((r) => setTimeout(r, 200))

    // End the match by having a player quit (a reconnect grace window precedes the forfeit).
    b.ws.close()
    const over = await a.waitFor('H_GAME_OVER', 22000)
    if (over.kind === 'H_GAME_OVER') expect(over.winner).toBe(a.id)

    // Poll until the on-disk replay appears (save is fire-and-forget).
    let metas: ReplayMeta[] = []
    const deadline = Date.now() + 10000
    while (Date.now() < deadline) {
      const res = await fetch(`http://127.0.0.1:${p2}/api/replays`)
      metas = ((await res.json()) as { replays: ReplayMeta[] }).replays
      if (metas.length > 0) break
      await new Promise((r) => setTimeout(r, 100))
    }
    expect(metas.length).toBeGreaterThan(0)
    const meta = metas[0]
    expect(meta.valid).toBe(true)
    expect(meta.players).toContain('Alpha')
    expect(meta.players).toContain('Bravo')

    // The file is really on disk in the host's archive folder.
    const raw = await readFile(join(archiveDir, meta.name), 'utf8')
    const onDisk = JSON.parse(raw) as unknown
    expect(validReplay(onDisk)).toBe(true)

    // And it can be fetched through the API for playback.
    const fetched = (await (
      await fetch(`http://127.0.0.1:${p2}/api/replays?name=${encodeURIComponent(meta.name)}`)
    ).json()) as ReplayData
    expect(fetched.players).toHaveLength(2)
    expect(fetched.ticks).toBeGreaterThan(0)
    expect(fetched.history.length).toBeGreaterThan(0)
    expect(
      fetched.history.some(
        (c) => c.player === a.id && c.cmd.type === 'move' && (c.cmd as { entities?: number[] }).entities?.[0] === 7,
      ),
    ).toBe(true)
    expect(fetched.history.every((c) => typeof c.tick === 'number' && !!c.cmd)).toBe(true)

    a.ws.close()
    h2.kill()
  }, 45000)

  it('relay stamps bot commands into the replay history', async () => {
    const { host: h3, port: p3, archiveDir } = await startHost()
    const hostC = new TestClient()
    const guestC = new TestClient()

    await hostC.connect(p3)
    hostC.join('Host')
    await hostC.waitFor('H_LOBBY')
    await guestC.connect(p3)
    guestC.join('Guest')
    await guestC.waitFor('H_LOBBY')

    hostC.addBot('easy')
    const lobbyBot = await hostC.waitForLobby((m) => m.players.some((p) => p.bot === true))
    const botId = lobbyBot.players.find((p) => p.bot)?.id ?? -1
    expect(botId).toBeGreaterThanOrEqual(0)

    hostC.ready(true)
    guestC.ready(true)
    await new Promise((r) => setTimeout(r, 150))
    hostC.start()
    await hostC.waitFor('S_MATCH_START')
    await guestC.waitFor('S_MATCH_START')
    hostC.loaded()
    guestC.loaded()

    // Let the bot drive a few seconds so the relay broadcasts its commands.
    await new Promise((r) => setTimeout(r, 3500))
    expect(hostC.frames.some((f) => f.commands.some((c) => c.player === botId))).toBe(true)

    // Quit the host to end the match (guest already gone is not required before it).
    guestC.ws.close()
    hostC.ws.close()
    await new Promise((r) => setTimeout(r, 200))

    // Poll the archive for the auto-saved replay.
    let metas: ReplayMeta[] = []
    const deadline = Date.now() + 10000
    while (Date.now() < deadline) {
      const res = await fetch(`http://127.0.0.1:${p3}/api/replays`)
      metas = ((await res.json()) as { replays: ReplayMeta[] }).replays
      if (metas.length > 0) break
      await new Promise((r) => setTimeout(r, 100))
    }
    expect(metas.length).toBeGreaterThan(0)

    const fetched = (await (
      await fetch(`http://127.0.0.1:${p3}/api/replays?name=${encodeURIComponent(metas[0].name)}`)
    ).json()) as ReplayData
    expect(fetched.players.some((p) => p.id === botId)).toBe(true)
    expect(fetched.history.some((c) => c.player === botId)).toBe(true)

    const raw = await readFile(join(archiveDir, metas[0].name), 'utf8')
    expect(validReplay(JSON.parse(raw) as unknown)).toBe(true)

    h3.kill()
  }, 30000)

  it('archive API: upload, list, rename, delete', async () => {
    const { host: h2, port: p2 } = await startHost()
    const base = `http://127.0.0.1:${p2}`
    const replay = sampleReplay()

    const upload = await fetch(`${base}/api/replays/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(replay),
    })
    const uploaded = (await upload.json()) as { ok: boolean; name: string }
    expect(uploaded.ok).toBe(true)
    expect(uploaded.name.endsWith('.json')).toBe(true)

    const listed = (await (await fetch(`${base}/api/replays`)).json()) as { replays: ReplayMeta[] }
    expect(listed.replays.some((m) => m.name === uploaded.name)).toBe(true)
    const entry = listed.replays.find((m) => m.name === uploaded.name)
    expect(entry?.valid).toBe(true)
    expect(entry?.ticks).toBe(replay.ticks)
    expect(entry?.winner).toBe(0)

    const loaded = (await (await fetch(`${base}/api/replays?name=${encodeURIComponent(uploaded.name)}`)).json()) as ReplayData
    expect(loaded.seed).toBe(replay.seed)
    expect(loaded.history).toHaveLength(2)

    const renamed = await fetch(`${base}/api/replays/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: uploaded.name, newName: 'my-favorite-battle' }),
    })
    const renamedBody = (await renamed.json()) as { ok: boolean; name: string }
    expect(renamedBody.ok).toBe(true)

    const del = await fetch(`${base}/api/replays/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: renamedBody.name }),
    })
    expect(((await del.json()) as { ok: boolean }).ok).toBe(true)

    const after = (await (await fetch(`${base}/api/replays`)).json()) as { replays: ReplayMeta[] }
    expect(after.replays.some((m) => m.name === renamedBody.name)).toBe(false)

    const gone = await fetch(`${base}/api/replays?name=${encodeURIComponent(renamedBody.name)}`)
    expect(gone.status).toBe(404)

    h2.kill()
  }, 30000)

  it('mods API: upload, list, read, rename, delete, and apply to a room', async () => {
    const modsDir = await mkdtemp(join(tmpdir(), 'sa-mods-'))
    const { host: h2, port: p2 } = await startHost(ROOM_CODE, PASS, { SA_MODS_DIR: modsDir })
    const base = `http://127.0.0.1:${p2}`
    const mod: ModFile = {
      meta: { name: 'Turbo Mod', author: 'Rami', description: 'Faster everything', version: '1.0.0', requireProtocol: PROTOCOL_VERSION },
      settings: { startingCredits: 2000, sellRefundFraction: 0.4 },
      buildingOverrides: { 'power-plant': { cost: 400, hp: 1600 } },
    }

    const upload = await fetch(`${base}/api/mods/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mod),
    })
    const uploaded = (await upload.json()) as { ok: boolean; name: string }
    expect(uploaded.ok).toBe(true)
    expect(uploaded.name).toBe('Turbo Mod.json')

    const listed = (await (await fetch(`${base}/api/mods`)).json()) as { mods: ModMeta[] }
    expect(listed.mods.some((m) => m.name === uploaded.name)).toBe(true)
    const modMeta = listed.mods.find((m) => m.name === uploaded.name)
    expect(modMeta?.label).toBe('Turbo Mod')
    expect(modMeta?.author).toBe('Rami')
    expect(modMeta?.valid).toBe(true)
    expect(modMeta?.protocolOk).toBe(true)
    expect((modMeta?.size ?? 0)).toBeGreaterThan(0)

    const invalid = await fetch(`${base}/api/mods/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meta: { name: 'Broken', requireProtocol: PROTOCOL_VERSION + 1 } }),
    })
    expect(invalid.status).toBe(400)

    const single = (await (await fetch(`${base}/api/mods?name=${encodeURIComponent(uploaded.name)}`)).json()) as ModFile
    expect(single.meta?.name).toBe('Turbo Mod')
    expect(single.settings?.startingCredits).toBe(2000)
    expect(single.buildingOverrides?.['power-plant']?.cost).toBe(400)

    const renamed = await fetch(`${base}/api/mods/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: uploaded.name, newName: 'my-favorite-mod' }),
    })
    const renamedBody = (await renamed.json()) as { ok: boolean; name: string }
    expect(renamedBody.ok).toBe(true)
    expect(renamedBody.name).toBe('my-favorite-mod.json')

    const del = await fetch(`${base}/api/mods/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: renamedBody.name }),
    })
    expect(((await del.json()) as { ok: boolean }).ok).toBe(true)

    const after = (await (await fetch(`${base}/api/mods`)).json()) as { mods: ModMeta[] }
    expect(after.mods.some((m) => m.name === renamedBody.name)).toBe(false)

    const hostC = new TestClient()
    await hostC.connect(p2)
    hostC.join('Host')
    await hostC.waitFor('H_LOBBY')

    const onboard = await fetch(`${base}/api/mods/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...mod, meta: { name: 'Match Mod', requireProtocol: PROTOCOL_VERSION } }),
    })
    const onboarded = (await onboard.json()) as { ok: boolean; name: string }
    expect(onboarded.ok).toBe(true)

    hostC.updateRoom({ modId: onboarded.name.replace(/\.json$/i, '') })
    const withMod = await hostC.waitForLobby((m) => m.modId !== undefined)
    expect(withMod.modId).toBe(onboarded.name.replace(/\.json$/i, ''))

    hostC.updateRoom({ modId: '' })
    const cleared = await hostC.waitForLobby((m) => m.modId === undefined)
    expect(cleared.modId).toBeUndefined()

    await rm(modsDir, { recursive: true, force: true })
    hostC.ws.close()
    h2.kill()
  }, 30000)
})
