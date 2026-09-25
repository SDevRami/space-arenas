import type WebSocket from 'ws'
import {
  PLAYER_COLOR_COUNT,
  mapForPreset,
  mapPreset,
  mergeMatchSettings,
  validateMap,
  WIN_RULE_DEFAULT,
  type MapData,
  type MatchSettings,
  type PlayerSlot,
  type WinRule,
} from '@space-arenas/shared'
import { hashPassphrase, newRoomCode } from './passphrase.ts'
import { sanitizeSettings } from './sanitize.ts'

export interface HostPlayer extends PlayerSlot {
  connected: boolean
  spectator: boolean
  devSettings?: Partial<MatchSettings>
  /** Persistent per-browser id used to reclaim this slot on reconnect. */
  clientId?: string
  /** True once the player sent C_FORFEIT: the slot must not reclaim or wait out grace. */
  forfeited?: boolean
}

export interface Room {
  code: string
  passphraseHash: string
  passwordRequired: boolean
  invitePass: string
  hostName: string
  players: Map<WebSocket, HostPlayer>
  nextPlayerId: number
  nextSpectatorId: number
  maxPlayers: number
  mapId: string
  map: MapData
  seed: number
  settings: MatchSettings
  /** Match-options settings before any (future) balance mod is applied. */
  baseSettings: MatchSettings
  /** Applied balance-mod filename, '' = none. Unsupported online in Phase 1. */
  modId: string
  winRule: WinRule
  started: boolean
  ended: boolean
  /** Participants exactly as sent in S_MATCH_START, snapshotted at start so a replay
   *  still includes players who quit mid-match. */
  startSlots: PlayerSlot[]
  createdAt: number
  lastActivityAt: number
}

const SPECTATOR_ID_BASE = 100
const DEFAULT_MAP_ID = 'four-corners'

export class RoomRegistry {
  private readonly rooms = new Map<string, Room>()

  createRoom(passphrase: string, hostName: string, initialMapId?: string): Room {
    const code = newRoomCode()
    const preset = mapPreset(initialMapId ?? DEFAULT_MAP_ID) ?? mapPreset(DEFAULT_MAP_ID)!
    const now = Date.now()
    const room: Room = {
      code,
      passphraseHash: hashPassphrase(passphrase, code),
      passwordRequired: passphrase !== '',
      invitePass: passphrase,
      hostName,
      players: new Map(),
      nextPlayerId: 0,
      nextSpectatorId: SPECTATOR_ID_BASE,
      maxPlayers: preset.players,
      mapId: preset.id,
      map: mapForPreset(preset),
      seed: 0,
      settings: mergeMatchSettings(),
      baseSettings: mergeMatchSettings(),
      modId: '',
      winRule: WIN_RULE_DEFAULT,
      started: false,
      ended: false,
      startSlots: [],
      createdAt: now,
      lastActivityAt: now,
    }
    this.rooms.set(code, room)
    return room
  }

  /** Room by id/entry code, null when absent or ended. */
  get(code: string): Room | null {
    const room = this.rooms.get(code)
    if (!room || room.ended) return null
    return room
  }

  close(code: string): void {
    const room = this.rooms.get(code)
    if (!room) return
    this.rooms.delete(code)
    room.ended = true
  }

  touch(room: Room): void {
    room.lastActivityAt = Date.now()
  }

  /** Rooms still open (not ended), newest first. */
  list(): Room[] {
    return [...this.rooms.values()]
      .filter((r) => !r.ended)
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  search(query: string): Room[] {
    const q = query.trim().toLowerCase()
    if (!q) return this.list()
    return this.list().filter(
      (r) => r.code.toLowerCase().includes(q) || r.hostName.toLowerCase().includes(q),
    )
  }

  joinRoom(room: Room, ws: WebSocket, passphraseHash: string, name: string, clientId?: string): { ok: boolean; error?: string } {
    if (room.ended) return { ok: false, error: 'Match over — ask the host to create a new one' }
    if (room.started) return { ok: false, error: 'Match already started' }
    if (room.passphraseHash !== passphraseHash) return { ok: false, error: 'Wrong passphrase' }
    if (room.players.size >= room.maxPlayers) return { ok: false, error: 'Room is full' }
    const player: HostPlayer = {
      id: room.nextPlayerId++,
      name,
      ready: false,
      host: false,
      team: room.nextPlayerId - 1,
      spawn: room.nextPlayerId - 1,
      color: (room.nextPlayerId - 1) % PLAYER_COLOR_COUNT,
      connected: true,
      spectator: false,
      ...(clientId ? { clientId } : {}),
    }
    room.players.set(ws, player)
    return { ok: true }
  }

  joinSpectator(room: Room, ws: WebSocket, passphraseHash: string, name: string, clientId?: string): { ok: boolean; error?: string } {
    if (room.ended) return { ok: false, error: 'Match over — ask the host to create a new one' }
    if (!room.started) return { ok: false, error: 'Match has not started yet' }
    if (room.passphraseHash !== passphraseHash) return { ok: false, error: 'Wrong passphrase' }
    const player: HostPlayer = {
      id: room.nextSpectatorId++,
      name,
      ready: false,
      host: false,
      connected: true,
      spectator: true,
      ...(clientId ? { clientId } : {}),
    }
    room.players.set(ws, player)
    return { ok: true }
  }

  /** Reclaims an existing slot (player or spectator) for a reconnecting clientId.
   *  Re-binds the room slot to the new websocket so the same id/team is kept. */
  reconnectPlayer(room: Room, ws: WebSocket, clientId: string): HostPlayer | null {
    for (const [oldWs, p] of room.players) {
      if (p.clientId && p.clientId === clientId) {
        if (oldWs !== ws) room.players.delete(oldWs)
        p.connected = true
        room.players.set(ws, p)
        return p
      }
    }
    return null
  }

  playerFor(room: Room, ws: WebSocket): HostPlayer | null {
    return room.players.get(ws) ?? null
  }

  playerById(room: Room, id: number): { ws: WebSocket; p: HostPlayer } | null {
    for (const [ws, p] of room.players) {
      if (p.id === id) return { ws, p }
    }
    return null
  }

  updateSlot(room: Room, ws: WebSocket, patch: { name?: string; team?: number; spawn?: number; color?: number }): void {
    const p = this.playerFor(room, ws)
    if (!p || p.spectator) return
    if (patch.name !== undefined) {
      const name = patch.name.trim().slice(0, 16)
      if (name) p.name = name
    }
    if (patch.team !== undefined && Number.isFinite(patch.team)) {
      p.team = Math.max(0, Math.min(room.maxPlayers - 1, Math.floor(patch.team)))
    }
    if (patch.spawn !== undefined && Number.isFinite(patch.spawn)) {
      const spawnCount = room.map.spawnPoints.length
      p.spawn = Math.max(0, Math.min(spawnCount - 1, Math.floor(patch.spawn)))
    }
    if (patch.color !== undefined && Number.isFinite(patch.color)) {
      p.color = Math.max(0, Math.min(PLAYER_COLOR_COUNT - 1, Math.floor(patch.color)))
    }
  }

  setDevSettings(room: Room, ws: WebSocket, settings: Partial<MatchSettings>): void {
    const p = this.playerFor(room, ws)
    if (!p) return
    p.devSettings = sanitizeSettings(settings)
  }

  /** Resolves spawn-point conflicts and rewrites the map spawns to the active player ids. */
  assignSpawns(room: Room): void {
    const players = this.nonSpectators(room).sort((a, b) => a.id - b.id)
    const chosen = new Map<number, HostPlayer>()
    const fallback: HostPlayer[] = []
    for (const p of players) {
      const want = p.spawn ?? p.id
      if (chosen.has(want)) fallback.push(p)
      else chosen.set(want, p)
    }
    const used = new Set(chosen.keys())
    const free: number[] = []
    for (let i = 0; i < room.map.spawnPoints.length; i++) {
      if (!used.has(i)) free.push(i)
    }
    for (const p of fallback) {
      const idx = free.shift()
      if (idx === undefined) break
      chosen.set(idx, p)
    }
    const n = players.length
    room.map.spawnPoints.forEach((s, i) => {
      const p = chosen.get(i)
      s.team = p ? p.id : n + i
    })
  }

  updateRoomOptions(
    room: Room,
    patch: { mapId?: string; map?: MapData; password?: string; settings?: Partial<MatchSettings>; winRule?: WinRule; modId?: string },
  ): { ok: boolean; error?: string } {
    if (patch.modId !== undefined && String(patch.modId ?? '').trim() !== '') {
      return { ok: false, error: 'Balance mods are not supported in online matches yet' }
    }
    if (patch.map !== undefined) {
      const validation = validateMap(patch.map)
      if (!validation.ok) return { ok: false, error: `Invalid custom map: ${validation.errors[0] ?? 'bad map'}` }
      const name = patch.map.name.trim().slice(0, 48) || 'Custom'
      const occupants = room.players.size
      if (occupants > patch.map.spawnPoints.length) {
        return { ok: false, error: `This map fits ${patch.map.spawnPoints.length} players — ${occupants} are in the room` }
      }
      room.mapId = `custom:${name}`
      room.map = JSON.parse(JSON.stringify(patch.map)) as MapData
      room.map.name = name
      room.maxPlayers = room.map.spawnPoints.length
    } else if (patch.mapId !== undefined) {
      const preset = mapPreset(patch.mapId)
      if (!preset) return { ok: false, error: 'Unknown map' }
      const occupants = room.players.size
      if (occupants > preset.players) {
        return { ok: false, error: `This map fits ${preset.players} players — ${occupants} are in the room` }
      }
      room.mapId = preset.id
      room.map = mapForPreset(preset)
      room.maxPlayers = preset.players
    }
    if (patch.settings !== undefined) {
      room.baseSettings = mergeMatchSettings({ ...room.baseSettings, ...sanitizeSettings(patch.settings) })
      room.settings = room.baseSettings
    }
    if (patch.winRule !== undefined) {
      if (patch.winRule === 'standard' || patch.winRule === 'annihilation' || patch.winRule === 'command-center') {
        room.winRule = patch.winRule
      }
    }
    if (patch.password !== undefined) {
      const pass = patch.password
      room.passphraseHash = hashPassphrase(pass, room.code)
      room.passwordRequired = pass !== ''
      room.invitePass = pass
    }
    return { ok: true }
  }

  removePlayer(room: Room, ws: WebSocket): void {
    room.players.delete(ws)
  }

  /** All active (non-spectator) participants: connected humans. */
  nonSpectators(room: Room): HostPlayer[] {
    return [...room.players.values()].filter((p) => !p.spectator)
  }

  /** Marks a slot as disconnected without dropping it, so a matching clientId can reclaim it. */
  disconnectPlayer(room: Room, ws: WebSocket): HostPlayer | null {
    const p = room.players.get(ws)
    if (!p) return null
    p.connected = false
    return p
  }

  slots(room: Room): PlayerSlot[] {
    const slots: PlayerSlot[] = []
    room.players.forEach((p) => {
      slots.push({ id: p.id, name: p.name, ready: p.ready, host: p.host, team: p.team, spawn: p.spawn, color: p.color, spectator: p.spectator, connected: p.connected, difficulty: p.difficulty, ...(p.devSettings !== undefined ? { devSettings: p.devSettings } : {}) })
    })
    return slots.sort((a, b) => a.id - b.id)
  }

  matchSlots(room: Room): PlayerSlot[] {
    const slots: PlayerSlot[] = []
    room.players.forEach((p) => {
      if (p.spectator) return
      slots.push({ id: p.id, name: p.name, ready: p.ready, host: p.host, team: p.team, spawn: p.spawn, color: p.color, difficulty: p.difficulty })
    })
    return slots.sort((a, b) => a.id - b.id)
  }

  hostReady(room: Room, ws: WebSocket): boolean {
    const p = room.players.get(ws)
    return !!p && p.host
  }

  hostId(room: Room): number {
    for (const p of room.players.values()) if (p.host) return p.id
    return -1
  }
}