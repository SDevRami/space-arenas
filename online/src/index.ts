import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type WebSocket from 'ws'
import { WebSocketServer } from 'ws'
import {
  BIN,
  PROTOCOL_VERSION,
  decodeChecksum,
  decodeControl,
  encodeControl,
  makeMatchStart,
  type ChatRelayMessage,
  type ControlMessage,
} from '@space-arenas/shared'
import { RoomRegistry, type HostPlayer, type Room } from './rooms.ts'
import { TickRelay } from './relay.ts'
import { newSeed } from './passphrase.ts'
import {
  BACKUPS_MAX_PAYLOAD_BYTES,
  BACKUPS_PURGE_INTERVAL_MS,
  CORS_ALLOW_SOURCES,
  MOD_COMMENT_MAX_CHARS,
  RATE_AUTH_PER_MIN,
  RATE_BACKUP_POST_PER_MIN,
  RATE_LOGIN_PER_ACCOUNT_MIN,
  RATE_MOD_DOWNLOAD_PER_MIN,
  RATE_MOD_REPO_PER_MIN,
  RATE_MOD_WRITE_PER_MIN,
  RATE_READ_PER_MIN,
  RATE_ROOM_WRITE_PER_MIN,
  RATE_WS_HANDSHAKE_PER_MIN,
} from './config.ts'
import { clientIp, rateLimit, sweepRateLimits } from './ratelimit.ts'
import {
  authChangePassword,
  authLogin,
  authMe,
  authRegister,
  dbAddComment,
  dbCreateBackup,
  dbCreateMod,
  dbDeleteBackup,
  dbDeleteMod,
  dbGetBackup,
  dbGetMod,
  dbLeaderboard,
  dbListBackups,
  dbListComments,
  dbListMods,
  dbProbe,
  dbPurgeExpiredBackups,
  dbRateMod,
  dbRecordMatch,
} from './supabase.ts'
import { MOD_MAX_BYTES, modLabel, sanitizeMod } from './mods.ts'

/** How long a REST-created room may sit empty before it is reclaimed. */
const IDLE_ROOM_TTL_MS = 30_000
/** How long a room with no connected players (any state) is kept before closing. */
const EMPTY_ROOM_TTL_MS = 60_000
/** Sweep cadence for idle/empty rooms. */
const SWEEP_INTERVAL_MS = 10_000
/** How long a disconnected player slot is kept before it is forfeited/cleaned up. */
const RECONNECT_GRACE_MS = 30_000

const PORT = Number(process.env.SA_PORT ?? 17321)
/** 'online' enables the public room-directory API; anything else is the safe default. */
const MODE = process.env.SA_MODE ?? 'lan'
const ONLINE = MODE === 'online'
const PUBLIC_URL = process.env.SA_PUBLIC_URL ?? null

const registry = new RoomRegistry()
const relays = new Map<string, TickRelay>()
const loadedCount = new Map<string, Set<WebSocket>>()
const pendingForfeits = new Map<string, number[]>()
const reconnectTimers = new Map<string, Map<number, NodeJS.Timeout>>()
/** Socket → room code binding (set on join, cleared on close). */
const socketRooms = new Map<WebSocket, string>()

const send = (ws: WebSocket, msg: ControlMessage): void => {
  if (ws.readyState === 1) ws.send(encodeControl(msg))
}

const relayFor = (room: Room): TickRelay | null => relays.get(room.code) ?? null

const playerById = (room: Room, id: number): { ws: WebSocket; p: HostPlayer } | null => {
  for (const [ws, p] of room.players) {
    if (p.id === id) return { ws, p }
  }
  return null
}

/** The last remaining alliance, if any (online has no server-side bots). */
const winnerFromRemaining = (room: Room): number | null => {
  const byTeam = new Map<number, number[]>()
  for (const p of room.players.values()) {
    if (!p.connected || p.spectator) continue
    const team = p.team ?? p.id
    const list = byTeam.get(team) ?? []
    list.push(p.id)
    byTeam.set(team, list)
  }
  if (byTeam.size !== 1) return null
  return (byTeam.values().next().value as number[]).sort((a, b) => a - b)[0] ?? null
}

const endMatch = (room: Room, winner: number | null, scores?: Array<{ team: number; score: number }>): void => {
  if (room.ended) return
  room.ended = true
  const timers = reconnectTimers.get(room.code)
  if (timers) {
    for (const t of timers.values()) clearTimeout(t)
    timers.clear()
  }
  relayFor(room)?.stop()
  relays.delete(room.code)
  room.players.forEach((p, ws) => {
    if (p.connected) send(ws, { kind: 'H_GAME_OVER', winner })
  })
  const scoreById = new Map<number, number>()
  for (const s of scores ?? []) scoreById.set(s.team, s.score)
  const liveId = new Map<number, string | undefined>()
  for (const p of room.players.values()) liveId.set(p.id, p.authUserId)
  const participants = room.startSlots
    .filter((s) => !s.spectator)
    .map((s) => ({
      id: s.id,
      username: s.name,
      team: s.team ?? s.id,
      score: scoreById.get(s.id) ?? 0,
      ...(liveId.get(s.id) !== undefined ? { userId: liveId.get(s.id) } : {}),
    }))
  // Phase 2: best-effort persist (never blocks or fails the match flow on DB errors).
  void dbRecordMatch({ map: room.map.name, winner, startedAt: room.startedAt, participants })
}

/** Frees a room (and everything tied to it) once the last player has left. */
const closeRoom = (room: Room): void => {
  if (room.started && !room.ended) {
    endMatch(room, winnerFromRemaining(room))
  } else {
    room.ended = true
    relayFor(room)?.stop()
    relays.delete(room.code)
  }
  const timers = reconnectTimers.get(room.code)
  if (timers) {
    for (const t of timers.values()) clearTimeout(t)
    timers.clear()
  }
  loadedCount.delete(room.code)
  pendingForfeits.delete(room.code)
  socketRooms.forEach((code, ws) => {
    if (code === room.code) {
      socketRooms.delete(ws)
      if (ws.readyState === 1) ws.close()
    }
  })
  registry.close(room.code)
}

/** Final cleanup after the reconnect grace window expires for a still-disconnected slot. */
const disconnectFinished = (room: Room, ws: WebSocket, p: HostPlayer): void => {
  registry.removePlayer(room, ws)
  socketRooms.delete(ws)
  if (room.players.size === 0) {
    closeRoom(room)
    return
  }
  if (room.ended) return
  if (room.started) {
    const winner = winnerFromRemaining(room)
    if (winner !== null) {
      endMatch(room, winner)
      return
    }
    if (!p.spectator) {
      const relay = relayFor(room)
      if (relay) relay.submitForfeit(p.id)
      else {
        const list = pendingForfeits.get(room.code) ?? []
        list.push(p.id)
        pendingForfeits.set(room.code, list)
      }
    }
    room.players.forEach((pp, ws2) => {
      if (!pp.connected) return
      send(ws2, { kind: 'H_PLAYER_STATE', players: registry.slots(room) })
    })
    return
  }
  broadcastLobby(room)
}

/** Gives a disconnected slot a grace window to reclaim via the same clientId. */
const scheduleForfeit = (room: Room, playerId: number): void => {
  let timers = reconnectTimers.get(room.code)
  if (!timers) {
    timers = new Map()
    reconnectTimers.set(room.code, timers)
  }
  if (timers.has(playerId)) return
  const t = setTimeout(() => {
    timers.delete(playerId)
    const current = registry.get(room.code)
    if (!current || current !== room) return
    const found = playerById(current, playerId)
    if (!found || found.p.connected) return
    disconnectFinished(current, found.ws, found.p)
  }, RECONNECT_GRACE_MS)
  timers.set(playerId, t)
}

const broadcastLobby = (room: Room): void => {
  if (room.ended) return
  const slots = registry.slots(room)
  const hId = registry.hostId(room)
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

const maybeStartMatch = (room: Room): void => {
  if (!room.started || room.ended) return
  const loaded = loadedCount.get(room.code)
  if (!loaded || loaded.size < room.players.size) return
  if (relays.has(room.code)) return
  room.players.forEach((p, ws) => {
    if (!p.connected) return
    send(ws, { kind: 'H_PLAYER_STATE', players: registry.slots(room) })
  })
  const relay = new TickRelay(room)
  const forfeits = pendingForfeits.get(room.code)
  if (forfeits && forfeits.length > 0) {
    for (const id of forfeits) relay.submitForfeit(id)
    pendingForfeits.delete(room.code)
  }
  relays.set(room.code, relay)
  relay.start()
}

interface RoomContext {
  room: Room
  relay: TickRelay | null
}

const roomForSocket = (ws: WebSocket): RoomContext | null => {
  const code = socketRooms.get(ws)
  if (!code) return null
  const room = registry.get(code)
  if (!room) return null
  return { room, relay: relayFor(room) }
}

/** Verifies a Supabase session token and binds the socket's player slot to the account.
 *  Re-reads the socket→room mapping only after the token round-trip resolves, because at
 *  C_JOIN time the join handler has not finished registering the socket yet. */
const bindAccountToken = async (ws: WebSocket, token?: string): Promise<void> => {
  if (!token) return
  const res = await authMe(token)
  if (!res.ok || !res.data) return
  const room = registry.get(socketRooms.get(ws) ?? '')
  if (!room) return
  const p = registry.playerFor(room, ws)
  if (p) p.authUserId = res.data.userId
}

const handleControl = (ws: WebSocket, msg: ControlMessage): void => {
  const ctx = roomForSocket(ws)
  switch (msg.kind) {
    case 'C_PING':
      send(ws, { kind: 'H_PONG' })
      break
    case 'C_JOIN': {
      if (msg.token) void bindAccountToken(ws, msg.token)
      if (!msg.roomCode) {
        send(ws, { kind: 'H_ERROR', message: 'No room specified' })
        return
      }
      const room = registry.get(msg.roomCode)
      if (!room) {
        send(ws, { kind: 'H_ERROR', message: 'Room not found' })
        return
      }
      // Reclaim an existing slot (player or spectator) for a reconnecting clientId.
      if (msg.clientId) {
        const existing = registry.reconnectPlayer(room, ws, msg.clientId)
        if (existing) {
          socketRooms.set(ws, room.code)
          const timers = reconnectTimers.get(room.code)
          const pending = timers?.get(existing.id)
          if (pending) {
            clearTimeout(pending)
            timers?.delete(existing.id)
          }
          if (room.started) {
            const loaded = loadedCount.get(room.code) ?? new Set()
            loaded.add(ws)
            loadedCount.set(room.code, loaded)
            send(ws, { ...makeMatchStart(room.map, registry.matchSlots(room), registry.hostId(room), existing.id, room.seed, 25, room.settings, room.winRule), ...(existing.spectator ? { spectator: true } : {}), resumed: true })
            send(ws, { kind: 'H_PLAYER_STATE', players: registry.slots(room) })
            const relay = relayFor(room)
            if (relay) send(ws, { kind: 'S_SPECTATE_SYNC', currentTick: relay.currentTick, log: relay.history })
            return
          }
          broadcastLobby(room)
          return
        }
      }
      // An already-started match only accepts explicit spectators (re-join popup path).
      if (room.started) {
        if (msg.spectator === true) {
          const res = registry.joinSpectator(room, ws, msg.passphraseHash, msg.name, msg.clientId)
          if (!res.ok) {
            send(ws, { kind: 'H_ERROR', message: res.error ?? 'join failed' })
            return
          }
          socketRooms.set(ws, room.code)
          const p = registry.playerFor(room, ws)
          if (p) {
            send(ws, {
              kind: 'H_LOBBY',
              roomCode: room.code,
              yourId: p.id,
              hostId: registry.hostId(room),
              players: registry.slots(room),
              maxPlayers: room.maxPlayers,
              mapName: room.map.name,
              mapId: room.mapId,
              map: room.map,
              passwordRequired: room.passwordRequired,
              winRule: room.winRule,
              settings: room.settings,
              ...(room.modId ? { modId: room.modId } : {}),
            })
            send(ws, { ...makeMatchStart(room.map, registry.matchSlots(room), registry.hostId(room), p.id, room.seed, 25, room.settings, room.winRule), spectator: true })
            const relay = relayFor(room)
            if (relay) send(ws, { kind: 'S_SPECTATE_SYNC', currentTick: relay.currentTick, log: relay.history })
          }
          broadcastLobby(room)
          return
        }
        send(ws, { kind: 'H_ERROR', message: 'Match already started — no free player slot' })
        return
      }
      const first = room.players.size === 0
      const res = registry.joinRoom(room, ws, msg.passphraseHash, msg.name, msg.clientId)
      if (!res.ok) {
        send(ws, { kind: 'H_ERROR', message: res.error ?? 'join failed' })
        return
      }
      socketRooms.set(ws, room.code)
      registry.touch(room)
      const p = registry.playerFor(room, ws)
      if (p) {
        p.host = first
        p.ready = first
      }
      broadcastLobby(room)
      break
    }
    case 'C_READY': {
      if (!ctx) return
      const p = registry.playerFor(ctx.room, ws)
      if (p && !p.spectator) {
        p.ready = msg.ready
        registry.touch(ctx.room)
        broadcastLobby(ctx.room)
      }
      break
    }
    case 'C_UPDATE_SLOT': {
      if (!ctx) return
      registry.updateSlot(ctx.room, ws, { name: msg.name, team: msg.team, spawn: msg.spawn, color: msg.color })
      registry.touch(ctx.room)
      broadcastLobby(ctx.room)
      break
    }
    case 'C_DEV_SETTINGS': {
      if (!ctx) return
      registry.setDevSettings(ctx.room, ws, msg.settings ?? {})
      broadcastLobby(ctx.room)
      break
    }
    case 'C_UPDATE_ROOM': {
      if (!ctx) return
      if (!registry.hostReady(ctx.room, ws)) {
        send(ws, { kind: 'H_ERROR', message: 'Only the host can change match options' })
        return
      }
      const res = registry.updateRoomOptions(ctx.room, { mapId: msg.mapId, map: msg.map, password: msg.password, settings: msg.settings, winRule: msg.winRule, modId: msg.modId })
      if (!res.ok) {
        send(ws, { kind: 'H_ERROR', message: res.error ?? 'update failed' })
        return
      }
      broadcastLobby(ctx.room)
      break
    }
    case 'C_ADD_BOT':
    case 'C_UPDATE_BOT':
    case 'C_REMOVE_BOT': {
      if (!ctx) return
      send(ws, { kind: 'H_ERROR', message: 'Bots are not supported in online matches yet' })
      break
    }
    case 'C_START': {
      if (!ctx) return
      const { room } = ctx
      if (room.started || room.ended) return
      if (!registry.hostReady(room, ws)) {
        send(ws, { kind: 'H_ERROR', message: 'Only the host can start' })
        return
      }
      const allReady = [...room.players.values()].every((p) => p.ready && !p.spectator)
      if (!allReady) {
        send(ws, { kind: 'H_ERROR', message: 'Not all players are ready' })
        return
      }
      room.started = true
      room.seed = newSeed()
      room.startedAt = Date.now()
      const loaded = new Set<WebSocket>()
      loadedCount.set(room.code, loaded)
      registry.assignSpawns(room)
      room.startSlots = registry.matchSlots(room)
      room.players.forEach((p, ws2) => {
        if (!p.connected) return
        send(ws2, makeMatchStart(room.map, registry.matchSlots(room), registry.hostId(room), p.id, room.seed, 25, room.settings, room.winRule))
      })
      break
    }
    case 'C_LOADED': {
      if (!ctx) return
      const loaded = loadedCount.get(ctx.room.code)
      if (loaded) loaded.add(ws)
      maybeStartMatch(ctx.room)
      break
    }
    case 'C_GAME_OVER': {
      if (!ctx) return
      if (ctx.room.ended) return
      endMatch(ctx.room, msg.winner, msg.scores)
      break
    }
    case 'C_FORFEIT': {
      if (!ctx) return
      const { room } = ctx
      if (!room.started || room.ended) return
      const p = registry.playerFor(room, ws)
      if (!p || p.spectator) return
      p.forfeited = true
      const relay = relayFor(room)
      if (relay) {
        // Squeeze the surrender into the sim: the forfeiting player's entities
        // are removed and the win is decided deterministically by the last
        // remaining alliance — works for 1v1 and multi-member teams alike.
        relay.submitForfeit(p.id)
      } else {
        const list = pendingForfeits.get(room.code) ?? []
        list.push(p.id)
        pendingForfeits.set(room.code, list)
      }
      break
    }
    case 'C_CHAT': {
      if (!ctx) return
      const { room } = ctx
      const p = registry.playerFor(room, ws)
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

const bearerToken = (req: IncomingMessage): string => {
  const auth = req.headers.authorization ?? ''
  return auth.startsWith('Bearer ') ? auth.slice(7) : ''
}

/** Applies the sliding-window limiter; writes the 429 (with Retry-After) and returns true when over. */
const limited = (res: ServerResponse, scope: string, limit: number, key: string): boolean => {
  const r = rateLimit(`${scope}:${key}`, limit)
  if (r.ok) return false
  const secs = r.retryAfterSeconds
  res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': String(secs) })
  res.end(JSON.stringify({ ok: false, error: 'too many requests', retryAfter: secs }))
  return true
}

/** Cross-origin headers: the game runs on localhost/LAN and calls this server's REST API.
 *  With no allow-list configured (dev/LAN) every origin is allowed; when `SA_CORS_ALLOW`
 *  is set only the listed origins get an echoed `Access-Control-Allow-Origin`, so browsers
 *  block the API for any other frontend (Render stays callable by the game/landing pages). */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

const corsHeaders = (req: IncomingMessage): Record<string, string> => {
  if (CORS_ALLOW_SOURCES.length === 0) return CORS
  const origin = req.headers.origin
  if (typeof origin === 'string' && CORS_ALLOW_SOURCES.includes(origin)) {
    return { ...CORS, 'Access-Control-Allow-Origin': origin, Vary: 'Origin' }
  }
  const withoutOrigin: Record<string, string> = { ...CORS }
  delete withoutOrigin['Access-Control-Allow-Origin']
  return withoutOrigin
}

/** ws(s) base for clients to connect to (Render sets SA_PUBLIC_URL, locally the request host). */
const publicWsBase = (req: IncomingMessage): string => {
  const httpBase = PUBLIC_URL ?? `http://${req.headers.host ?? 'localhost'}`
  return httpBase.replace(/^http/, 'ws').replace(/\/$/, '')
}

const cleanName = (v: unknown, max = 16): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')

const roomSummary = (room: Room): Record<string, unknown> => ({
  id: room.code,
  hostName: room.hostName,
  mapName: room.map.name,
  players: registry.matchSlots(room).length,
  maxPlayers: room.maxPlayers,
  status: room.started ? 'started' : room.players.size >= room.maxPlayers ? 'full' : 'lobby',
  passwordRequired: room.passwordRequired,
  created: room.createdAt,
})

/** Phase 3: expiring, encrypted data backups. All routes require a signed-in account. */
const handleBackups = async (req: IncomingMessage, res: ServerResponse, urlPath: string): Promise<boolean> => {
  if (req.method === 'POST' && urlPath === '/api/backups') {
    if (limited(res, 'backupPost', RATE_BACKUP_POST_PER_MIN, clientIp(req))) return true
    if (!bearerToken(req)) {
      writeJson(res, 401, { ok: false, error: 'login required' })
      return true
    }
    const body = await readJson(req)
    const me = await authMe(bearerToken(req))
    if (!me.ok || !me.data) {
      writeJson(res, 401, { ok: false, error: 'invalid session' })
      return true
    }
    const payload = typeof body.payload === 'string' ? body.payload : ''
    if (payload === '') {
      writeJson(res, 400, { ok: false, error: 'payload required' })
      return true
    }
    if (Buffer.byteLength(payload, 'utf8') > BACKUPS_MAX_PAYLOAD_BYTES) {
      writeJson(res, 413, { ok: false, error: 'payload too large' })
      return true
    }
    const kind = body.kind === 'profile' ? 'profile' : 'devsettings'
    const passphraseHash = typeof body.passphraseHash === 'string' ? body.passphraseHash.slice(0, 64) : ''
    if (passphraseHash === '') {
      writeJson(res, 400, { ok: false, error: 'passphraseHash required' })
      return true
    }
    const result = await dbCreateBackup(me.data.userId, kind, payload, passphraseHash)
    if (!result.ok) {
      const code = result.error === 'database not configured' ? 503 : result.error === 'backup quota reached' ? 409 : result.error === 'payload too large' ? 413 : 400
      writeJson(res, code, result)
      return true
    }
    writeJson(res, 201, result)
    return true
  }
  if (req.method === 'GET' && urlPath === '/api/backups') {
    if (limited(res, 'read', RATE_READ_PER_MIN, clientIp(req))) return true
    if (!bearerToken(req)) {
      writeJson(res, 401, { ok: false, error: 'login required' })
      return true
    }
    const me = await authMe(bearerToken(req))
    if (!me.ok || !me.data) {
      writeJson(res, 401, { ok: false, error: 'invalid session' })
      return true
    }
    const result = await dbListBackups(me.data.userId)
    writeJson(res, result.ok ? 200 : result.error === 'database not configured' ? 503 : 400, result)
    return true
  }
  const restore = urlPath.match(/^\/api\/backups\/([^/]+)\/restore$/)
  const idPath = urlPath.match(/^\/api\/backups\/([^/]+)$/)
  if (req.method === 'POST' && restore && restore[1]) {
    if (limited(res, 'read', RATE_READ_PER_MIN, clientIp(req))) return true
    if (!bearerToken(req)) {
      writeJson(res, 401, { ok: false, error: 'login required' })
      return true
    }
    const me = await authMe(bearerToken(req))
    if (!me.ok || !me.data) {
      writeJson(res, 401, { ok: false, error: 'invalid session' })
      return true
    }
    const body = await readJson(req)
    const passphraseHash = typeof body.passphraseHash === 'string' ? body.passphraseHash : ''
    const result = await dbGetBackup(me.data.userId, restore[1])
    const row = result.data
    if (!result.ok || !row) {
      writeJson(res, result.error === 'database not configured' ? 503 : result.error === 'backup not found' ? 404 : 400, result)
      return true
    }
    if (new Date(row.expiresAt).getTime() <= Date.now()) {
      writeJson(res, 410, { ok: false, error: 'backup expired' })
      return true
    }
    if (passphraseHash === '' || passphraseHash !== row.passphraseHash) {
      writeJson(res, 403, { ok: false, error: 'wrong passphrase' })
      return true
    }
    writeJson(res, 200, { ok: true, data: { id: row.id, kind: row.kind, payload: row.payload, createdAt: row.createdAt, expiresAt: row.expiresAt } })
    return true
  }
  if (req.method === 'DELETE' && idPath && idPath[1]) {
    if (limited(res, 'read', RATE_READ_PER_MIN, clientIp(req))) return true
    if (!bearerToken(req)) {
      writeJson(res, 401, { ok: false, error: 'login required' })
      return true
    }
    const me = await authMe(bearerToken(req))
    if (!me.ok || !me.data) {
      writeJson(res, 401, { ok: false, error: 'invalid session' })
      return true
    }
    const result = await dbDeleteBackup(me.data.userId, idPath[1])
    writeJson(res, result.ok ? 200 : result.error === 'database not configured' ? 503 : 400, result)
    return true
  }
  writeJson(res, 405, { ok: false, error: 'method not allowed' })
  return true
}

/** Phase 4: community mod repository (browse / download / publish / rate / comment). */
const handleMods = async (req: IncomingMessage, res: ServerResponse, urlPath: string): Promise<boolean> => {
  const idPath = urlPath.match(/^\/api\/mods\/([^/]+)\/(rate|comments)$/)
  const downloadPath = urlPath.match(/^\/api\/mods\/([^/]+)$/)

  if (req.method === 'GET' && urlPath === '/api/mods/repo') {
    if (limited(res, 'modRepo', RATE_MOD_REPO_PER_MIN, clientIp(req))) return true
    const url = new URL(req.url ?? '/api/mods/repo', 'http://localhost')
    const q = url.searchParams.get('q') ?? ''
    const sort = url.searchParams.get('sort') ?? 'newest'
    const owner = url.searchParams.get('owner') ?? ''
    const result = await dbListMods({ q: q.slice(0, 80), sort, owner: owner.slice(0, 64) || undefined })
    writeJson(res, result.ok ? 200 : result.error === 'database not configured' ? 503 : 400, { ok: result.ok, error: result.error ?? undefined, mods: result.data ?? [] })
    return true
  }

  if (req.method === 'GET' && downloadPath && downloadPath[1]) {
    if (limited(res, 'modDownload', RATE_MOD_DOWNLOAD_PER_MIN, clientIp(req))) return true
    const result = await dbGetMod(downloadPath[1])
    if (!result.ok || !result.data) {
      writeJson(res, result.error === 'database not configured' ? 503 : result.error === 'mod not found' ? 404 : 400, result)
      return true
    }
    // Same body shape the LAN `/api/mods?name=` returns, so the client's existing
    // mod-import code can feed it straight into the local host's upload endpoint.
    writeJson(res, 200, result.data.payload)
    return true
  }

  if (req.method === 'POST' && urlPath === '/api/mods') {
    if (limited(res, 'modWrite', RATE_MOD_WRITE_PER_MIN, clientIp(req))) return true
    if (!bearerToken(req)) {
      writeJson(res, 401, { ok: false, error: 'login required' })
      return true
    }
    const me = await authMe(bearerToken(req))
    if (!me.ok || !me.data) {
      writeJson(res, 401, { ok: false, error: 'invalid session' })
      return true
    }
    const body = await readJson(req, MOD_MAX_BYTES)
    const clean = sanitizeMod(body)
    if (!clean) {
      writeJson(res, 400, { ok: false, error: 'invalid mod file' })
      return true
    }
    const name = modLabel(clean.meta)
    const description = clean.meta?.description?.trim() ?? ''
    if (description === '') {
      writeJson(res, 400, { ok: false, error: 'a short description is required (1-160 characters)' })
      return true
    }
    const payloadBytes = Buffer.byteLength(JSON.stringify(clean), 'utf8')
    if (payloadBytes > MOD_MAX_BYTES) {
      writeJson(res, 413, { ok: false, error: 'mod file too large' })
      return true
    }
    const result = await dbCreateMod(me.data.userId, {
      name,
      author: clean.meta?.author?.slice(0, 60) ?? '',
      description: description.slice(0, 160),
      version: clean.meta?.version?.slice(0, 24) ?? '',
      requireProtocol: clean.meta?.requireProtocol ?? PROTOCOL_VERSION,
      sizeBytes: payloadBytes,
      payload: clean,
    })
    if (!result.ok) {
      const code = result.error === 'database not configured' ? 503 : result.error === 'mod quota reached' || result.error === 'name already taken' ? 409 : 400
      writeJson(res, code, result)
      return true
    }
    writeJson(res, 201, { ok: true, id: result.data?.id })
    return true
  }

  if (req.method === 'DELETE' && downloadPath && downloadPath[1]) {
    if (limited(res, 'modWrite', RATE_MOD_WRITE_PER_MIN, clientIp(req))) return true
    if (!bearerToken(req)) {
      writeJson(res, 401, { ok: false, error: 'login required' })
      return true
    }
    const me = await authMe(bearerToken(req))
    if (!me.ok || !me.data) {
      writeJson(res, 401, { ok: false, error: 'invalid session' })
      return true
    }
    const result = await dbDeleteMod(me.data.userId, downloadPath[1])
    if (!result.ok) {
      const code = result.error === 'database not configured' ? 503 : result.error === 'not owner' ? 403 : result.error === 'mod not found' ? 404 : 400
      writeJson(res, code, result)
      return true
    }
    writeJson(res, 200, { ok: true })
    return true
  }

  if (req.method === 'POST' && idPath && idPath[1] && idPath[2] === 'rate') {
    if (limited(res, 'modWrite', RATE_MOD_WRITE_PER_MIN, clientIp(req))) return true
    if (!bearerToken(req)) {
      writeJson(res, 401, { ok: false, error: 'login required' })
      return true
    }
    const me = await authMe(bearerToken(req))
    if (!me.ok || !me.data) {
      writeJson(res, 401, { ok: false, error: 'invalid session' })
      return true
    }
    const body = await readJson(req)
    const rating = Math.round(Number(body.rating))
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      writeJson(res, 400, { ok: false, error: 'rating must be 1-5' })
      return true
    }
    const result = await dbRateMod(idPath[1], me.data.userId, rating)
    if (!result.ok) {
      const code = result.error === 'database not configured' ? 503 : result.error === 'mod not found' ? 404 : 400
      writeJson(res, code, result)
      return true
    }
    writeJson(res, 200, { ok: true, ...result.data })
    return true
  }

  if (req.method === 'GET' && idPath && idPath[1] && idPath[2] === 'comments') {
    if (limited(res, 'modRepo', RATE_MOD_REPO_PER_MIN, clientIp(req))) return true
    const result = await dbListComments(idPath[1])
    if (!result.ok && !result.data) {
      writeJson(res, result.error === 'database not configured' ? 503 : result.error === 'mod not found' ? 404 : 400, result)
      return true
    }
    writeJson(res, 200, { ok: true, comments: result.data ?? [] })
    return true
  }

  if (req.method === 'POST' && idPath && idPath[1] && idPath[2] === 'comments') {
    if (limited(res, 'modWrite', RATE_MOD_WRITE_PER_MIN, clientIp(req))) return true
    if (!bearerToken(req)) {
      writeJson(res, 401, { ok: false, error: 'login required' })
      return true
    }
    const me = await authMe(bearerToken(req))
    if (!me.ok || !me.data) {
      writeJson(res, 401, { ok: false, error: 'invalid session' })
      return true
    }
    const body = await readJson(req)
    const text = typeof body.body === 'string' ? body.body.trim() : ''
    if (text === '' || text.length > MOD_COMMENT_MAX_CHARS) {
      writeJson(res, 400, { ok: false, error: `comment must be 1-${MOD_COMMENT_MAX_CHARS} characters` })
      return true
    }
    const result = await dbAddComment(idPath[1], me.data.userId, text)
    if (!result.ok) {
      const code = result.error === 'database not configured' ? 503 : result.error === 'mod not found' ? 404 : 400
      writeJson(res, code, result)
      return true
    }
    writeJson(res, 201, { ok: true })
    return true
  }

  writeJson(res, 405, { ok: false, error: 'method not allowed' })
  return true
}

const handleApi = async (req: IncomingMessage, res: ServerResponse, urlPath: string): Promise<boolean> => {
  if (req.method === 'GET' && urlPath === '/api/status') {
    writeJson(res, 200, {
      ok: true,
      service: 'space-arenas-online',
      mode: MODE,
      protocol: PROTOCOL_VERSION,
      rooms: registry.list().length,
      players: registry.list().reduce((n, r) => n + registry.matchSlots(r).length, 0),
      db: await dbProbe(),
    })
    return true
  }
  if (req.method === 'POST' && urlPath === '/api/rooms') {
    if (!ONLINE) {
      writeJson(res, 503, { ok: false, error: 'online lobby disabled (SA_MODE=online required)' })
      return true
    }
    if (limited(res, 'roomWrite', RATE_ROOM_WRITE_PER_MIN, clientIp(req))) return true
    const body = await readJson(req)
    const hostName = cleanName(body.hostName) || 'Host'
    if (cleanName(hostName).length < 1) {
      writeJson(res, 400, { ok: false, error: 'hostName required' })
      return true
    }
    const passphrase = typeof body.passphrase === 'string' ? body.passphrase.slice(0, 128) : ''
    const mapId = typeof body.mapId === 'string' ? body.mapId.slice(0, 64) : undefined
    const room = registry.createRoom(passphrase, hostName, mapId)
    writeJson(res, 201, { ok: true, roomCode: room.code })
    return true
  }
  if (req.method === 'GET' && urlPath === '/api/rooms') {
    if (!ONLINE) {
      writeJson(res, 503, { ok: false, error: 'online lobby disabled (SA_MODE=online required)' })
      return true
    }
    writeJson(res, 200, { rooms: registry.list().map(roomSummary) })
    return true
  }
  if (req.method === 'GET' && urlPath.startsWith('/api/rooms/search')) {
    if (!ONLINE) {
      writeJson(res, 503, { ok: false, error: 'online lobby disabled (SA_MODE=online required)' })
      return true
    }
    const url = new URL(req.url ?? '/api/rooms/search', 'http://localhost')
    const q = url.searchParams.get('q') ?? ''
    writeJson(res, 200, { rooms: registry.search(q).map(roomSummary) })
    return true
  }
  if (req.method === 'POST' && urlPath.startsWith('/api/rooms/') && urlPath.endsWith('/join')) {
    if (!ONLINE) {
      writeJson(res, 503, { ok: false, error: 'online lobby disabled (SA_MODE=online required)' })
      return true
    }
    if (limited(res, 'roomWrite', RATE_ROOM_WRITE_PER_MIN, clientIp(req))) return true
    const code = urlPath.slice('/api/rooms/'.length, -'/join'.length)
    const room = registry.get(code)
    if (!room) {
      writeJson(res, 404, { ok: false, error: 'Room not found' })
      return true
    }
    if (room.started || room.ended) {
      writeJson(res, 409, { ok: false, error: 'Match already started' })
      return true
    }
    if (room.players.size >= room.maxPlayers) {
      writeJson(res, 409, { ok: false, error: 'Room is full' })
      return true
    }
    writeJson(res, 200, { ok: true, ws: `${publicWsBase(req)}/ws`, roomCode: room.code })
    return true
  }
  if (req.method === 'POST' && urlPath === '/api/auth/register') {
    if (limited(res, 'auth', RATE_AUTH_PER_MIN, clientIp(req))) return true
    const body = await readJson(req)
    const result = await authRegister(
      String(body.email ?? '').trim(),
      String(body.password ?? ''),
      String(body.username ?? '').trim(),
    )
    writeJson(res, result.ok ? 201 : result.error === 'database not configured' ? 503 : 400, result)
    return true
  }
  if (req.method === 'POST' && urlPath === '/api/auth/login') {
    const body = await readJson(req)
    if (limited(res, 'auth', RATE_AUTH_PER_MIN, clientIp(req))) return true
    if (limited(res, 'loginAccount', RATE_LOGIN_PER_ACCOUNT_MIN, String(body.email ?? '').trim().toLowerCase())) return true
    const result = await authLogin(String(body.email ?? '').trim(), String(body.password ?? ''))
    writeJson(res, result.ok ? 200 : result.error === 'database not configured' ? 503 : 401, result)
    return true
  }
  if (req.method === 'POST' && urlPath === '/api/auth/change-password') {
    if (limited(res, 'auth', RATE_AUTH_PER_MIN, clientIp(req))) return true
    const body = await readJson(req)
    const token = typeof body.token === 'string' ? body.token : ''
    const result = await authChangePassword(token, String(body.newPassword ?? ''))
    writeJson(res, result.ok ? 200 : result.error === 'database not configured' ? 503 : 400, result)
    return true
  }
  if (req.method === 'GET' && urlPath === '/api/auth/me') {
    if (limited(res, 'read', RATE_READ_PER_MIN, clientIp(req))) return true
    const result = await authMe(bearerToken(req))
    writeJson(res, result.ok ? 200 : 401, result)
    return true
  }
  if (req.method === 'GET' && urlPath === '/api/leaderboard') {
    if (limited(res, 'read', RATE_READ_PER_MIN, clientIp(req))) return true
    const result = await dbLeaderboard(100)
    writeJson(res, result.ok ? 200 : 503, result)
    return true
  }
  if (urlPath === '/api/backups' || urlPath.startsWith('/api/backups/')) {
    return handleBackups(req, res, urlPath)
  }
  if (urlPath === '/api/mods' || urlPath.startsWith('/api/mods/')) {
    return handleMods(req, res, urlPath)
  }
  return false
}

const server = createServer(async (req, res) => {
  // CORS is per-request: with an allow-list, only permitted origins get an ACAO echo.
  for (const [k, v] of Object.entries(corsHeaders(req))) res.setHeader(k, v)
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }
  const urlPath = (req.url ?? '/').split('?')[0]
  if (urlPath === '/') {
    writeJson(res, 200, { service: 'space-arenas-online', mode: MODE, protocol: PROTOCOL_VERSION, health: '/api/status' })
    return
  }
  if (urlPath.startsWith('/api/')) {
    try {
      const handled = await handleApi(req, res, urlPath)
      if (!handled) writeJson(res, 404, { ok: false, error: 'not found' })
    } catch {
      writeJson(res, 400, { ok: false, error: 'bad request' })
    }
    return
  }
  writeJson(res, 404, { ok: false, error: 'not found' })
})

const wss = new WebSocketServer({ server, path: '/ws' })

wss.on('connection', (ws, request) => {
  if (!rateLimit(`wsHandshake:${clientIp(request)}`, RATE_WS_HANDSHAKE_PER_MIN).ok) {
    ws.close(4403, 'too many requests')
    return
  }
  ws.on('message', (data) => {
    const buf = data as Buffer
    if (buf[0] === BIN.CMD) {
      const ctx = roomForSocket(ws)
      if (ctx?.relay) ctx.relay.submit(ws, new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength))
      return
    }
    if (buf[0] === BIN.CHECKSUM) {
      const ctx = roomForSocket(ws)
      if (ctx?.relay) {
        const c = decodeChecksum(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength))
        ctx.relay.relayChecksum(ws, c.tick, c.crc)
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
    const code = socketRooms.get(ws)
    if (!code) return
    socketRooms.delete(ws)
    const room = registry.get(code)
    if (!room) return
    const leaver = registry.playerFor(room, ws)
    if (!leaver) return
    // An explicit surrender was already relayed via C_FORFEIT: drop the slot so
    // it cannot reclaim, and let the sim decide the match outcome. Do not close
    // the room or open a reconnect window for a gone-by-choice player.
    if (leaver.forfeited) {
      registry.removePlayer(room, ws)
      if (!room.ended && room.started) {
        room.players.forEach((pp, ws2) => {
          if (pp.connected) send(ws2, { kind: 'H_PLAYER_STATE', players: registry.slots(room) })
        })
      }
      return
    }
    const wasHost = leaver.host === true
    registry.disconnectPlayer(room, ws)
    loadedCount.get(room.code)?.delete(ws)
    if (room.ended) return
    if (wasHost) {
      const timers = reconnectTimers.get(room.code)
      if (timers) {
        for (const t of timers.values()) clearTimeout(t)
        timers.clear()
      }
      registry.removePlayer(room, ws)
      if (room.started) {
        closeRoom(room)
        return
      }
      room.ended = true
      room.players.forEach((_p, ws2) => {
        send(ws2, { kind: 'H_ERROR', message: 'Host disconnected. Match ended.' })
        ws2.close()
      })
      closeRoom(room)
      return
    }
    // Let the remaining players see this slot as disconnected immediately.
    if (!wasHost) {
      if (room.started) {
        room.players.forEach((pp, ws2) => {
          if (pp.connected) send(ws2, { kind: 'H_PLAYER_STATE', players: registry.slots(room) })
        })
      } else {
        broadcastLobby(room)
      }
    }
    // Give the slot a grace window so the player can reconnect with the same clientId.
    scheduleForfeit(room, leaver.id)
  })
})

/** Reclaims REST-created rooms nobody joined and closes long-empty rooms. */
setInterval(() => {
  sweepRateLimits()
  for (const room of registry.list()) {
    const connected = [...room.players.values()].some((p) => p.connected)
    const idle = Date.now() - room.lastActivityAt
    if (connected) continue
    if (room.ended) {
      registry.close(room.code)
      socketRooms.forEach((c, ws) => {
        if (c === room.code) ws.close()
      })
      continue
    }
    if (room.players.size === 0 && idle > IDLE_ROOM_TTL_MS) {
      registry.close(room.code)
      continue
    }
    if (idle > EMPTY_ROOM_TTL_MS) {
      registry.close(room.code)
      socketRooms.forEach((c, ws) => {
        if (c === room.code) ws.close()
      })
    }
  }
}, SWEEP_INTERVAL_MS)

/** Phase 3: periodically drop backups past their 7-day TTL. */
setInterval(() => {
  void dbPurgeExpiredBackups()
}, BACKUPS_PURGE_INTERVAL_MS)

server.listen(PORT, () => {
  console.log(`[space-arenas-online] listening on http://0.0.0.0:${PORT} (mode=${MODE}, protocol=${PROTOCOL_VERSION})`)
  if (!ONLINE) {
    console.log('[space-arenas-online] lobby API disabled — set SA_MODE=online to expose room creation/search')
  }
})