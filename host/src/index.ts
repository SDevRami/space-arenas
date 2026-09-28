import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { existsSync } from 'node:fs'
import { extname, resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { fileURLToPath } from 'node:url'
import type WebSocket from 'ws'
import { WebSocketServer } from 'ws'
import {
  BIN,
  DEFAULT_PORT,
  PROTOCOL_VERSION,
  decodeChecksum,
  decodeControl,
  encodeControl,
  isValidMod,
  makeMatchStart,
  validReplay,
  type ChatRelayMessage,
  type ControlMessage,
  type EnvelopeCommand,
  type ModFile,
  type ReplayData,
} from '@space-arenas/shared'
import { RoomManager, type HostPlayer, type Room } from './rooms.ts'
import { TickRelay } from './relay.ts'
import { NetBotRunner } from './bots.ts'
import { newSeed } from './passphrase.ts'
import { inviteQrPng, inviteUrl, refreshInviteQr } from './qr.ts'
import { DEFAULT_BEACON_PORT, LanDiscovery, firstLanIp, lanIps } from './discovery.ts'
import { archiveStore } from './archive.ts'
import { MOD_MAX_BYTES, modStore } from './mods.ts'

const ARCHIVE_MAX_BYTES = 64 * 1024 * 1024

/** How long a disconnected player slot is kept before it is forfeited/cleaned up. */
const RECONNECT_GRACE_MS = 12_000

const PORT = Number(process.env.SA_PORT ?? DEFAULT_PORT)
const PASSPHRASE = process.env.SA_PASSPHRASE ?? 'changeme'
const ROOM_CODE = process.env.SA_ROOM_CODE ?? null
const BEACON_PORT = Number(process.env.SA_BEACON_PORT ?? DEFAULT_BEACON_PORT)
const HOST_BASE = typeof __dirname !== 'undefined' ? __dirname : fileURLToPath(new URL('.', import.meta.url))
const CLIENT_DIST = resolve(HOST_BASE, '../../client/dist')
const MAPBUILDER_DIST = resolve(HOST_BASE, '../../mapbuilder/dist')

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.map': 'application/json',
  '.ico': 'image/x-icon',
}

let currentName = process.env.SA_NAME ?? hostname()

const rooms = new RoomManager()
let relay: TickRelay | null = null
const loadedCount = new Map<WebSocket, boolean>()
let pendingForfeits: number[] = []
const reconnectTimers = new Map<number, NodeJS.Timeout>()
const chatLog: Array<{ from: string; text: string; ts: number }> = []

const send = (ws: WebSocket, msg: ControlMessage): void => {
  if (ws.readyState === 1) ws.send(encodeControl(msg))
}

const hostId = (): number => {
  const room = rooms.getRoom()
  if (!room) return -1
  for (const p of room.players.values()) if (p.host) return p.id
  return -1
}

const roomInfo = (): { roomCode: string | null; started: boolean; playerCount: number; maxPlayers: number; passwordRequired: boolean } => {
  const room = rooms.getRoom()
  return {
    roomCode: room && !room.ended ? room.code : null,
    started: room?.started ?? false,
    playerCount: room ? rooms.matchSlots(room).length : 0,
    maxPlayers: room?.maxPlayers ?? 8,
    passwordRequired: room?.passwordRequired ?? false,
  }
}

const endMatch = (winner: number | null): void => {
  const room = rooms.getRoom()
  if (!room || room.ended) return
  room.ended = true
  for (const [, t] of reconnectTimers) clearTimeout(t)
  reconnectTimers.clear()
  const history = relay?.history ?? []
  const ticks = relay?.currentTick ?? 0
  relay?.stop()
  relay = null
  pendingForfeits = []
  loadedCount.clear()
  room.players.forEach((p, ws) => {
    if (p.connected) send(ws, { kind: 'H_GAME_OVER', winner })
  })
  void saveReplay(room, winner, history, ticks)
}

const playerById = (room: Room, id: number): { ws: WebSocket; p: HostPlayer } | null => {
  for (const [ws, p] of room.players) {
    if (p.id === id) return { ws, p }
  }
  return null
}

/** Final cleanup after the reconnect grace window expires for a still-disconnected slot. */
const disconnectFinished = (room: Room, ws: WebSocket, p: HostPlayer): void => {
  rooms.removePlayer(ws)
  if (room.started) {
    const winner = winnerFromRemaining(room)
    if (winner !== null) {
      endMatch(winner)
      return
    }
    if (!p.spectator) {
      if (relay) relay.submitForfeit(p.id)
      else pendingForfeits.push(p.id)
    }
    room.players.forEach((pp, ws2) => {
      if (!pp.connected) return
      send(ws2, { kind: 'H_PLAYER_STATE', players: rooms.slots(room) })
    })
    return
  }
  if (room.players.size === 0) {
    relay?.stop()
    relay = null
    return
  }
  broadcastLobby()
}

/** Gives a disconnected slot a grace window to reclaim via the same clientId. */
const scheduleForfeit = (room: Room, playerId: number): void => {
  if (reconnectTimers.has(playerId)) return
  const t = setTimeout(() => {
    reconnectTimers.delete(playerId)
    const current = rooms.getRoom()
    if (!current || current !== room) return
    const found = playerById(current, playerId)
    if (!found || found.p.connected) return
    disconnectFinished(current, found.ws, found.p)
  }, RECONNECT_GRACE_MS)
  reconnectTimers.set(playerId, t)
}

/** Writes the full command history + match settings into the `archive/` folder
 *  as a JSON file (fire-and-forget so the shutdown path never blocks). */
const saveReplay = (
  room: Room,
  winner: number | null,
  history: EnvelopeCommand[],
  ticks: number,
): Promise<void> => {
  const replay: ReplayData = {
    version: PROTOCOL_VERSION,
    createdAt: new Date().toISOString(),
    seed: room.seed,
    tickRate: 25,
    map: room.map,
    settings: room.settings,
    winRule: room.winRule,
    players: room.startSlots.length > 0 ? room.startSlots : rooms.matchSlots(room),
    winner,
    ticks,
    history,
  }
  return archiveStore.save(replay).catch((err) => {
    console.error('[space-arenas host] replay save failed:', err)
    return undefined
  }).then((name) => {
    if (name) console.log(`[space-arenas host] saved replay: ${name}`)
  })
}

/** The last remaining alliance, if any — counting connected humans AND server-side
 * bots, grouped by their shared `team`. Returns the lowest active slot id of the
 * winning alliance (a player id, matching `yourId` on clients), or null while more
 * than one alliance is still in the match. A single player quitting must not end
 * the match while their teammates (human or bot) are still alive. */
const winnerFromRemaining = (room: { players: Map<WebSocket, HostPlayer>; bots: HostPlayer[] }): number | null => {
  const byTeam = new Map<number, number[]>()
  for (const p of [...room.players.values(), ...room.bots]) {
    if (!p.connected || p.spectator) continue
    const team = p.team ?? p.id
    const list = byTeam.get(team) ?? []
    list.push(p.id)
    byTeam.set(team, list)
  }
  if (byTeam.size !== 1) return null
  return (byTeam.values().next().value as number[]).sort((a, b) => a - b)[0] ?? null
}

const discovery = new LanDiscovery(() => currentName, () => PORT, roomInfo)

const broadcastLobby = (): void => {
  const room = rooms.getRoom()
  if (!room) return
  const slots = rooms.slots(room)
  const hId = hostId()
  room.players.forEach((p, ws) => {
    if (!p.connected) return
    send(ws, {
      kind: 'H_LOBBY',
      roomCode: room.code,
      yourId: p.id,
      hostId: hId,
      players: slots,
      maxPlayers: room.maxPlayers,
      mapName: room.map.name,
      mapId: room.mapId,
      map: room.map,
      passwordRequired: room.passwordRequired,
      winRule: room.winRule,
      settings: room.settings,
      ...(room.modId ? { modId: room.modId } : {}),
    })
  })
}

const pushChat = (entry: { from: string; text: string; ts: number }): void => {
  const last = chatLog[chatLog.length - 1]
  if (last && last.from === entry.from && last.text === entry.text && last.ts === entry.ts) return
  chatLog.push(entry)
  if (chatLog.length > 200) chatLog.splice(0, chatLog.length - 200)
}

const forwardChat = (entry: { from: string; text: string; ts: number }): void => {
  for (const p of discovery.list()) {
    if (lanIps().includes(p.ip) && p.port === PORT) continue
    const url = `http://${p.ip}:${p.port}/api/relay/chat`
    void fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(entry),
    }).catch(() => undefined)
  }
}

const maybeStartMatch = (): void => {
  const room = rooms.getRoom()
  if (!room || !room.started) return
  if (loadedCount.size < room.players.size) return
  if (relay) return
  room.players.forEach((p, ws) => {
    if (!p.connected) return
    send(ws, { kind: 'H_PLAYER_STATE', players: rooms.slots(room) })
  })
  relay = new TickRelay(room, room.bots.length > 0 ? new NetBotRunner(room) : null)
  if (pendingForfeits.length > 0) {
    for (const id of pendingForfeits) relay.submitForfeit(id)
    pendingForfeits = []
  }
  relay.start()
}

const handleControl = (ws: WebSocket, msg: ControlMessage): void => {
  const room = rooms.getRoom()
  switch (msg.kind) {
    case 'C_JOIN': {
      if (!room) {
        send(ws, { kind: 'H_ERROR', message: 'No room on this server' })
        return
      }
      // Reclaim an existing slot (player or spectator) for a reconnecting clientId.
      if (msg.clientId) {
        const existing = rooms.reconnectPlayer(ws, msg.clientId)
        if (existing) {
          const pending = reconnectTimers.get(existing.id)
          if (pending) {
            clearTimeout(pending)
            reconnectTimers.delete(existing.id)
          }
          if (room.started) {
            loadedCount.set(ws, true)
            send(ws, { kind: 'H_PLAYER_STATE', players: rooms.slots(room) })
            if (relay) {
              send(ws, { kind: 'S_SPECTATE_SYNC', currentTick: relay.currentTick, log: relay.history })
            }
            return
          }
          broadcastLobby()
          return
        }
      }
      // An already-started match only accepts explicit spectators (re-join popup path).
      if (room.started) {
        if (msg.spectator === true) {
          const res = rooms.joinSpectator(ws, msg.roomCode, msg.passphraseHash, msg.name, msg.clientId)
          if (!res.ok) {
            send(ws, { kind: 'H_ERROR', message: res.error ?? 'join failed' })
            return
          }
          const p = rooms.playerFor(ws)
          if (p) {
            send(ws, { kind: 'H_LOBBY', roomCode: room.code, yourId: p.id, hostId: hostId(), players: rooms.slots(room), maxPlayers: room.maxPlayers, mapName: room.map.name, mapId: room.mapId, map: room.map, passwordRequired: room.passwordRequired, winRule: room.winRule, settings: room.settings, ...(room.modId ? { modId: room.modId } : {}) })
            send(ws, { ...makeMatchStart(room.map, rooms.matchSlots(room), hostId(), p.id, room.seed, 25, room.settings, room.winRule), spectator: true })
            if (relay) {
              send(ws, { kind: 'S_SPECTATE_SYNC', currentTick: relay.currentTick, log: relay.history })
            }
          }
          broadcastLobby()
          return
        }
        send(ws, { kind: 'H_ERROR', message: 'Match already started — no free player slot' })
        return
      }
      const first = room.players.size === 0
      const res = rooms.joinRoom(ws, msg.roomCode, msg.passphraseHash, msg.name, msg.clientId)
      if (!res.ok) {
        send(ws, { kind: 'H_ERROR', message: res.error ?? 'join failed' })
        return
      }
      const p = rooms.playerFor(ws)
      if (p) {
        p.host = first
        p.ready = first
      }
      broadcastLobby()
      break
    }
    case 'C_READY': {
      if (!room) return
      const p = rooms.playerFor(ws)
      if (p && !p.spectator) {
        p.ready = msg.ready
        broadcastLobby()
      }
      break
    }
    case 'C_UPDATE_SLOT': {
      if (!room) return
      rooms.updateSlot(ws, { name: msg.name, team: msg.team, spawn: msg.spawn, color: msg.color })
      broadcastLobby()
      break
    }
    case 'C_DEV_SETTINGS': {
      if (!room) return
      rooms.setDevSettings(ws, msg.settings ?? {})
      broadcastLobby()
      break
    }
    case 'C_UPDATE_ROOM': {
      if (!room) return
      if (!rooms.hostReady(room, ws)) {
        send(ws, { kind: 'H_ERROR', message: 'Only the host can change match options' })
        return
      }
      const res = rooms.updateRoomOptions({ mapId: msg.mapId, map: msg.map, password: msg.password, settings: msg.settings, winRule: msg.winRule, modId: msg.modId })
      if (!res.ok) {
        send(ws, { kind: 'H_ERROR', message: res.error ?? 'update failed' })
        return
      }
      if (msg.password !== undefined) {
        void refreshInviteQr(room.code, room.invitePass, firstLanIp(), PORT)
      }
      broadcastLobby()
      break
    }
    case 'C_ADD_BOT': {
      if (!room) return
      if (!rooms.hostReady(room, ws)) {
        send(ws, { kind: 'H_ERROR', message: 'Only the host can add bots' })
        return
      }
      const res = rooms.addBot(msg.difficulty, { name: msg.name, team: msg.team, spawn: msg.spawn, color: msg.color })
      if (!res.ok) {
        send(ws, { kind: 'H_ERROR', message: res.error ?? 'add failed' })
        return
      }
      broadcastLobby()
      break
    }
    case 'C_UPDATE_BOT': {
      if (!room) return
      if (!rooms.hostReady(room, ws)) {
        send(ws, { kind: 'H_ERROR', message: 'Only the host can edit bots' })
        return
      }
      const res = rooms.updateBot(msg.id, { name: msg.name, team: msg.team, spawn: msg.spawn, color: msg.color, difficulty: msg.difficulty })
      if (!res.ok) {
        send(ws, { kind: 'H_ERROR', message: res.error ?? 'update failed' })
        return
      }
      broadcastLobby()
      break
    }
    case 'C_REMOVE_BOT': {
      if (!room) return
      if (!rooms.hostReady(room, ws)) {
        send(ws, { kind: 'H_ERROR', message: 'Only the host can remove bots' })
        return
      }
      const res = rooms.removeBot(msg.id)
      if (!res.ok) {
        send(ws, { kind: 'H_ERROR', message: res.error ?? 'remove failed' })
        return
      }
      broadcastLobby()
      break
    }
    case 'C_START': {
      if (!room) return
      if (room.started) return
      if (!rooms.hostReady(room, ws)) {
        send(ws, { kind: 'H_ERROR', message: 'Only the host can start' })
        return
      }
      const allReady = [...room.players.values(), ...room.bots].every((p) => p.ready && !p.spectator)
      if (!allReady) {
        send(ws, { kind: 'H_ERROR', message: 'Not all players are ready' })
        return
      }
      room.started = true
      room.seed = newSeed()
      loadedCount.clear()
      rooms.assignSpawns(room)
      room.startSlots = rooms.matchSlots(room)
      room.players.forEach((p, ws2) => {
        if (!p.connected) return
        send(ws2, makeMatchStart(room.map, rooms.matchSlots(room), hostId(), p.id, room.seed, 25, room.settings, room.winRule))
      })
      break
    }
    case 'C_LOADED': {
      loadedCount.set(ws, true)
      maybeStartMatch()
      break
    }
    case 'C_GAME_OVER': {
      if (!room || room.ended) return
      endMatch(msg.winner)
      break
    }
    case 'C_CHAT': {
      if (!room) return
      const p = rooms.playerFor(ws)
      if (!p) return
      const text = msg.text.trim().slice(0, 300)
      if (!text) return
      const target = msg.target === 'team' ? 'team' : 'all'
      const chatMsg: ChatRelayMessage = {
        kind: 'H_CHAT',
        from: p.id,
        name: p.name,
        text,
        target,
        team: p.team ?? p.id,
        ts: Date.now(),
      }
      room.players.forEach((pp, ws2) => {
        if (!pp.connected) return
        if (target === 'team' && (pp.team ?? pp.id) !== chatMsg.team) return
        send(ws2, chatMsg)
      })
      break
    }
    case 'H_LOBBY':
    case 'H_ERROR':
    case 'S_MATCH_START':
    case 'H_GAME_OVER':
    case 'H_PLAYER_STATE':
    case 'H_CHAT':
    case 'S_SPECTATE_SYNC': {
      break
    }
  }
}

const readJson = (req: IncomingMessage, maxBytes = 1_000_000): Promise<Record<string, unknown>> =>
  new Promise((resolveBody, rejectBody) => {
    let data = ''
    req.on('data', (chunk: Buffer) => {
      data += chunk.toString()
      if (data.length > maxBytes) req.destroy()
    })
    req.on('end', () => {
      try {
        resolveBody(data ? (JSON.parse(data) as Record<string, unknown>) : {})
      } catch {
        rejectBody(new Error('bad json'))
      }
    })
    req.on('error', rejectBody)
  })

const writeJson = (res: ServerResponse, code: number, body: unknown): void => {
  res.writeHead(code, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

const handleApi = async (req: IncomingMessage, res: ServerResponse, urlPath: string): Promise<boolean> => {
  if (req.method === 'GET' && urlPath === '/api/room') {
    const r = roomInfo()
    writeJson(res, 200, { ...r, name: currentName, ip: firstLanIp(), port: PORT })
    return true
  }
  if (req.method === 'GET' && urlPath === '/api/invite-qr') {
    const room = rooms.getRoom()
    const png = room ? inviteQrPng(room.code) : null
    if (!png) {
      writeJson(res, 404, { ok: false, error: 'no invite' })
      return true
    }
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' })
    res.end(png)
    return true
  }
  if (req.method === 'GET' && urlPath === '/api/invite-info') {
    const room = rooms.getRoom()
    if (!room || room.ended) {
      writeJson(res, 404, { ok: false, error: 'no room' })
      return true
    }
    const url = inviteUrl(room.code, room.invitePass, firstLanIp(), PORT)
    writeJson(res, 200, { ok: true, url, code: room.code })
    return true
  }
  if (req.method === 'GET' && urlPath === '/api/network') {
    const remote = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '')
    const hostDevice = remote === '127.0.0.1' || remote === '::1' || lanIps().includes(remote)
    const self = { name: currentName, ip: firstLanIp(), port: PORT, hostDevice, ...roomInfo() }
    const peers = discovery
      .list()
      .filter((p) => !(lanIps().includes(p.ip) && p.port === PORT))
      .map((p) => ({
        name: p.name,
        ip: p.ip,
        port: p.port,
        roomCode: p.roomCode,
        started: p.started,
        playerCount: p.playerCount,
        maxPlayers: p.maxPlayers,
        passwordRequired: p.passwordRequired,
      }))
    writeJson(res, 200, { self, players: [self, ...peers], chat: chatLog.slice(-100), hostDevice })
    return true
  }
  if (req.method === 'POST' && urlPath === '/api/self') {
    const body = await readJson(req)
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 16) : ''
    if (name) currentName = name
    writeJson(res, 200, { ok: true, name: currentName })
    return true
  }
  if (req.method === 'POST' && urlPath === '/api/create-room') {
    const body = await readJson(req)
    const passphrase = typeof body.passphrase === 'string' ? body.passphrase : ''
    if (typeof body.name === 'string' && body.name.trim()) currentName = body.name.trim().slice(0, 16)
    const old = rooms.getRoom()
    if (old) {
      relay?.stop()
      relay = null
      loadedCount.clear()
      for (const [, t] of reconnectTimers) clearTimeout(t)
      reconnectTimers.clear()
      old.players.forEach((_p, ws2) => {
        send(ws2, { kind: 'H_ERROR', message: 'Host recreated the room.' })
        ws2.close()
      })
    }
    const room = rooms.createRoom(passphrase)
    void refreshInviteQr(room.code, passphrase, firstLanIp(), PORT)
    writeJson(res, 200, { ok: true, roomCode: room.code, ip: firstLanIp(), port: PORT })
    return true
  }
  if (req.method === 'POST' && urlPath === '/api/chat') {
    const body = await readJson(req)
    const text = typeof body.text === 'string' ? body.text.trim().slice(0, 300) : ''
    const from = typeof body.from === 'string' ? body.from.trim().slice(0, 16) : 'Player'
    if (text) {
      const entry = { from: from || 'Player', text, ts: Date.now() }
      pushChat(entry)
      forwardChat(entry)
    }
    writeJson(res, 200, { ok: true })
    return true
  }
  if (req.method === 'POST' && urlPath === '/api/relay/chat') {
    const body = await readJson(req)
    const text = typeof body.text === 'string' ? body.text.slice(0, 300) : ''
    const from = typeof body.from === 'string' ? body.from.slice(0, 16) : 'Player'
    const ts = typeof body.ts === 'number' ? body.ts : Date.now()
    if (text) pushChat({ from, text, ts })
    writeJson(res, 200, { ok: true })
    return true
  }
  // ----- archive (replay files) -----
  if (req.method === 'GET' && urlPath.startsWith('/api/replays')) {
    const url = new URL(req.url ?? '/api/replays', 'http://localhost')
    const name = url.searchParams.get('name')
    if (name) {
      const replay = await archiveStore.read(name)
      if (!replay) {
        writeJson(res, 404, { ok: false, error: 'replay not found' })
        return true
      }
      writeJson(res, 200, replay)
      return true
    }
    const replays = await archiveStore.list()
    writeJson(res, 200, { replays })
    return true
  }
  if (req.method === 'POST' && urlPath === '/api/replays/upload') {
    const body = await readJson(req, ARCHIVE_MAX_BYTES)
    if (!validReplay(body)) {
      writeJson(res, 400, { ok: false, error: 'invalid replay file' })
      return true
    }
    const name = await archiveStore.save(body)
    writeJson(res, 200, { ok: true, name })
    return true
  }
  if (req.method === 'POST' && urlPath === '/api/replays/rename') {
    const body = await readJson(req)
    const name = typeof body.name === 'string' ? body.name : ''
    const newName = typeof body.newName === 'string' ? body.newName : ''
    if (!name || !newName) {
      writeJson(res, 400, { ok: false, error: 'rename needs name + newName' })
      return true
    }
    const target = await archiveStore.rename(name, newName)
    writeJson(res, target !== null ? 200 : 404, target !== null ? { ok: true, name: target } : { ok: false, error: 'replay not found' })
    return true
  }
  if (req.method === 'POST' && urlPath === '/api/replays/delete') {
    const body = await readJson(req)
    const name = typeof body.name === 'string' ? body.name : ''
    if (!name) {
      writeJson(res, 400, { ok: false, error: 'delete needs name' })
      return true
    }
    const ok = await archiveStore.remove(name)
    writeJson(res, ok ? 200 : 404, ok ? { ok: true } : { ok: false, error: 'replay not found' })
    return true
  }
  // ----- balance mods (match-scoped JSON deltas) -----
  if (req.method === 'GET' && urlPath.startsWith('/api/mods')) {
    const url = new URL(req.url ?? '/api/mods', 'http://localhost')
    const name = url.searchParams.get('name')
    if (name) {
      const mod = await modStore.read(name)
      if (!mod) {
        writeJson(res, 404, { ok: false, error: 'mod not found' })
        return true
      }
      writeJson(res, 200, mod)
      return true
    }
    const mods = await modStore.list()
    writeJson(res, 200, { mods })
    return true
  }
  if (req.method === 'POST' && urlPath === '/api/mods/upload') {
    const body = await readJson(req, MOD_MAX_BYTES)
    if (!isValidMod(body, PROTOCOL_VERSION).ok) {
      writeJson(res, 400, { ok: false, error: 'invalid mod file' })
      return true
    }
    const name = await modStore.save(body as ModFile).catch(() => null)
    writeJson(res, name !== null ? 200 : 400, name !== null ? { ok: true, name } : { ok: false, error: 'invalid mod file' })
    return true
  }
  if (req.method === 'POST' && urlPath === '/api/mods/rename') {
    const body = await readJson(req)
    const name = typeof body.name === 'string' ? body.name : ''
    const newName = typeof body.newName === 'string' ? body.newName : ''
    if (!name || !newName) {
      writeJson(res, 400, { ok: false, error: 'rename needs name + newName' })
      return true
    }
    const target = await modStore.rename(name, newName)
    if (target === null) {
      writeJson(res, 404, { ok: false, error: 'mod not found' })
      return true
    }
    rooms.repointMod(name, target)
    broadcastLobby()
    writeJson(res, 200, { ok: true, name: target })
    return true
  }
  if (req.method === 'POST' && urlPath === '/api/mods/delete') {
    const body = await readJson(req)
    const name = typeof body.name === 'string' ? body.name : ''
    if (!name) {
      writeJson(res, 400, { ok: false, error: 'delete needs name' })
      return true
    }
    const ok = await modStore.remove(name)
    if (!ok) {
      writeJson(res, 404, { ok: false, error: 'mod not found' })
      return true
    }
    rooms.detachMod(name)
    broadcastLobby()
    writeJson(res, 200, { ok: true })
    return true
  }
  return false
}

const server = createServer(async (req, res) => {
  const urlPath = (req.url ?? '/').split('?')[0]
  if (urlPath.startsWith('/api/')) {
    try {
      const handled = await handleApi(req, res, urlPath)
      if (!handled) writeJson(res, 404, { ok: false, error: 'not found' })
    } catch {
      writeJson(res, 400, { ok: false, error: 'bad request' })
    }
    return
  }
  let filePath = ''
  if (urlPath === '/' || urlPath === '/index.html') {
    filePath = resolve(CLIENT_DIST, 'index.html')
  } else if (urlPath === '/mapbuilder' || urlPath === '/mapbuilder/') {
    filePath = resolve(MAPBUILDER_DIST, 'index.html')
  } else if (urlPath.startsWith('/mapbuilder/')) {
    filePath = resolve(MAPBUILDER_DIST, urlPath.slice('/mapbuilder/'.length))
  } else {
    filePath = resolve(CLIENT_DIST, urlPath.replace(/^\/+/, ''))
  }
  if (!filePath.startsWith(CLIENT_DIST) && !filePath.startsWith(MAPBUILDER_DIST)) {
    res.writeHead(403).end('forbidden')
    return
  }
  if (!existsSync(filePath)) {
    res.writeHead(404).end('not found')
    return
  }
  try {
    const data = await readFile(filePath)
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' })
    res.end(data)
  } catch {
    res.writeHead(500).end('read error')
  }
})

const wss = new WebSocketServer({ server, path: '/ws' })

wss.on('connection', (ws) => {
  ws.on('message', (data) => {
    const buf = data as Buffer
    if (buf[0] === BIN.CMD) {
      if (relay) relay.submit(ws, new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength))
      return
    }
    if (buf[0] === BIN.CHECKSUM) {
      if (relay) {
        const c = decodeChecksum(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength))
        relay.relayChecksum(ws, c.tick, c.crc)
      }
      return
    }
    try {
      handleControl(ws, decodeControl(buf.toString()))
    } catch {
      send(ws, { kind: 'H_ERROR', message: 'malformed message' })
    }
  })

  ws.on('close', () => {
    const room = rooms.getRoom()
    const leaver = room ? rooms.playerFor(ws) : null
    const wasHost = leaver?.host === true
    if (leaver) rooms.disconnectPlayer(ws)
    loadedCount.delete(ws)
    if (!room) return
    if (room.ended) return
    if (!leaver) {
      if (!wasHost) return
    }
    if (wasHost) {
      for (const [, t] of reconnectTimers) clearTimeout(t)
      reconnectTimers.clear()
      rooms.removePlayer(ws)
      if (room.started) {
        endMatch(winnerFromRemaining(room))
        return
      }
      room.ended = true
      room.players.forEach((_p, ws2) => {
        send(ws2, { kind: 'H_ERROR', message: 'Host disconnected. Match ended.' })
        ws2.close()
      })
      return
    }
    // Give the slot a grace window so the player can reconnect with the same clientId.
    scheduleForfeit(room, leaver.id)
  })
})

if (ROOM_CODE) {
  const room = rooms.createRoom(PASSPHRASE, ROOM_CODE)
  void refreshInviteQr(room.code, room.invitePass, firstLanIp(), PORT)
}

archiveStore.ensure()

server.listen(PORT, () => {
  console.log(`[space-arenas host] listening on http://0.0.0.0:${PORT}`)
  console.log(`[space-arenas host] join: http://<this-machine-lan-ip>:${PORT}`)
  const room = rooms.getRoom()
  if (room) {
    console.log(`[space-arenas host] room code: ${room.code}`)
    console.log(`[space-arenas host] passphrase: ${PASSPHRASE}`)
  }
})

discovery.start(BEACON_PORT)

// --- keyboard shutdown -------------------------------------------------
// When the host is run in the launcher window (run-game.bat), pressing 'c'
// stops the game cleanly. The batch script then frees the port and closes.
if (process.stdin?.isTTY) {
  try {
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.on('data', (chunk: Buffer) => {
      const input = chunk.toString()
      if (input.includes('c') || input.includes('C') || input.includes('\u0003')) {
        console.log('\n[space-arenas host] "c" pressed - stopping the game...')
        stopHost()
      }
    })
  } catch {
    // stdin unusable here (e.g. spawned with pipes); Ctrl+C in the console still works.
  }
}

process.on('SIGINT', stopHost)

function stopHost(): void {
  if (process.stdin?.isTTY) {
    try {
      process.stdin.setRawMode(false)
    } catch {
      /* raw mode was never enabled */
    }
  }
  try {
    server.close()
  } catch {
    /* already closed */
  }
  try {
    discovery.stop()
  } catch {
    /* not started */
  }
  process.exit(0)
}
