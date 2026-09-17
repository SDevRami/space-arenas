import type WebSocket from 'ws'
import {
  PLAYER_COLOR_COUNT,
  mapForPreset,
  mapPreset,
  mergeMatchSettings,
  modSettingsDelta,
  validateMap,
  WIN_RULE_DEFAULT,
  type BotDifficulty,
  type MapData,
  type MatchSettings,
  type PlayerSlot,
  type WinRule,
} from '@space-arenas/shared'
import { hashPassphrase, newRoomCode } from './passphrase.ts'
import { sanitizeSettings } from './sanitize.ts'
import { modStore } from './mods.ts'

export interface HostPlayer extends PlayerSlot {
  connected: boolean
  spectator: boolean
  devSettings?: Partial<MatchSettings>
  /** Persistent per-browser id used to reclaim this slot on reconnect. */
  clientId?: string
}

export interface Room {
  code: string
  passphraseHash: string
  passwordRequired: boolean
  invitePass: string
  players: Map<WebSocket, HostPlayer>
  bots: HostPlayer[]
  nextPlayerId: number
  nextSpectatorId: number
  maxPlayers: number
  mapId: string
  map: MapData
  seed: number
  settings: MatchSettings
  /** Dev-panel + match-options settings before any balance mod is applied. */
  baseSettings: MatchSettings
  /** Applied balance-mod filename (`<name>.json`), '' = none. Match-scoped only. */
  modId: string
  winRule: WinRule
  started: boolean
  ended: boolean
  /** Participants (humans + bots) exactly as sent in S_MATCH_START, snapshotted at start
   *  so a replay still includes players who quit mid-match. */
  startSlots: PlayerSlot[]
}

const SPECTATOR_ID_BASE = 100
const DEFAULT_MAP_ID = 'four-corners'

const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v))

export class RoomManager {
  private room: Room | null = null

  createRoom(passphrase: string, fixedCode?: string | null, initialMapId?: string): Room {
    const code = fixedCode ?? newRoomCode()
    const preset = mapPreset(initialMapId ?? DEFAULT_MAP_ID) ?? mapPreset(DEFAULT_MAP_ID)!
    const room: Room = {
      code,
      passphraseHash: hashPassphrase(passphrase, code),
      passwordRequired: passphrase !== '',
      invitePass: passphrase,
      players: new Map(),
      bots: [],
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
    }
    this.room = room
    return room
  }

  getRoom(): Room | null {
    return this.room
  }

  joinRoom(ws: WebSocket, roomCode: string, passphraseHash: string, name: string, clientId?: string): { ok: boolean; error?: string } {
    const room = this.room
    if (!room || room.code !== roomCode) return { ok: false, error: 'Room not found' }
    if (room.ended) return { ok: false, error: 'Match over — ask the host to create a new one' }
    if (room.started) return { ok: false, error: 'Match already started' }
    if (room.passphraseHash !== passphraseHash) return { ok: false, error: 'Wrong passphrase' }
    if (room.players.size + room.bots.length >= room.maxPlayers) return { ok: false, error: 'Room is full' }
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

  addBot(difficulty: BotDifficulty, patch?: { name?: string; team?: number; spawn?: number; color?: number }): { ok: boolean; error?: string } {
    const room = this.room
    if (!room) return { ok: false, error: 'No room on this server' }
    if (room.started) return { ok: false, error: 'Match already started' }
    if (room.players.size + room.bots.length >= room.maxPlayers) {
      return { ok: false, error: `This map fits ${room.maxPlayers} players` }
    }
    const bot: HostPlayer = {
      id: room.nextPlayerId++,
      name: patch?.name?.trim().slice(0, 16) || `Bot ${room.bots.length + 1}`,
      ready: true,
      host: false,
      team: patch?.team !== undefined ? clamp(patch.team, 0, room.maxPlayers - 1) : room.nextPlayerId - 1,
      spawn: patch?.spawn !== undefined ? clamp(patch.spawn, 0, room.map.spawnPoints.length - 1) : room.nextPlayerId - 1,
      color: patch?.color !== undefined ? clamp(patch.color, 0, PLAYER_COLOR_COUNT - 1) : (room.nextPlayerId - 1) % PLAYER_COLOR_COUNT,
      connected: true,
      spectator: false,
      bot: true,
      difficulty,
    }
    room.bots.push(bot)
    return { ok: true }
  }

  updateBot(id: number, patch: { name?: string; team?: number; spawn?: number; color?: number; difficulty?: BotDifficulty }): { ok: boolean; error?: string } {
    const room = this.room
    if (!room) return { ok: false, error: 'No room on this server' }
    if (room.started) return { ok: false, error: 'Match already started' }
    const bot = room.bots.find((b) => b.id === id)
    if (!bot) return { ok: false, error: 'Bot not found' }
    if (patch.name !== undefined && patch.name.trim()) bot.name = patch.name.trim().slice(0, 16)
    if (patch.team !== undefined && Number.isFinite(patch.team)) {
      bot.team = clamp(Math.floor(patch.team), 0, room.maxPlayers - 1)
    }
    if (patch.spawn !== undefined && Number.isFinite(patch.spawn)) {
      bot.spawn = clamp(Math.floor(patch.spawn), 0, room.map.spawnPoints.length - 1)
    }
    if (patch.color !== undefined && Number.isFinite(patch.color)) {
      bot.color = clamp(Math.floor(patch.color), 0, PLAYER_COLOR_COUNT - 1)
    }
    if (patch.difficulty !== undefined) bot.difficulty = patch.difficulty
    return { ok: true }
  }

  removeBot(id: number): { ok: boolean; error?: string } {
    const room = this.room
    if (!room) return { ok: false, error: 'No room on this server' }
    if (room.started) return { ok: false, error: 'Match already started' }
    const idx = room.bots.findIndex((b) => b.id === id)
    if (idx < 0) return { ok: false, error: 'Bot not found' }
    room.bots.splice(idx, 1)
    return { ok: true }
  }

  joinSpectator(ws: WebSocket, roomCode: string, passphraseHash: string, name: string, clientId?: string): { ok: boolean; error?: string } {
    const room = this.room
    if (!room || room.code !== roomCode) return { ok: false, error: 'Room not found' }
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
  reconnectPlayer(ws: WebSocket, clientId: string): HostPlayer | null {
    const room = this.room
    if (!room) return null
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

  playerFor(ws: WebSocket): HostPlayer | null {
    if (!this.room) return null
    return this.room.players.get(ws) ?? null
  }

  updateSlot(ws: WebSocket, patch: { name?: string; team?: number; spawn?: number; color?: number }): void {
    const p = this.playerFor(ws)
    const room = this.room
    if (!p || !room || p.spectator) return
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

  setDevSettings(ws: WebSocket, settings: Partial<MatchSettings>): void {
    const p = this.playerFor(ws)
    if (!p || !this.room || p.bot) return
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

  /** Effective settings for play: base (dev) settings merged with the active balance mod.
   *  A mod only ever rides on top of `baseSettings` — it never mutates them. */
  private effectiveSettings(room: Room): MatchSettings {
    const base = room.baseSettings
    if (!room.modId) return base
    const mod = modStore.readSync(room.modId)
    if (!mod) return base
    return mergeMatchSettings({ ...base, ...modSettingsDelta(base, mod) })
  }

  /** Rebuilds `room.settings` from `baseSettings` (+ mod if set). Call after any change. */
  private recomputeSettings(room: Room): void {
    room.settings = this.effectiveSettings(room)
  }

  updateRoomOptions(
    patch: { mapId?: string; map?: MapData; password?: string; settings?: Partial<MatchSettings>; winRule?: WinRule; modId?: string },
  ): { ok: boolean; error?: string } {
    const room = this.room
    if (!room) return { ok: false, error: 'No room' }
    if (patch.modId !== undefined) {
      const next = String(patch.modId ?? '').trim()
      if (!next) {
        room.modId = ''
      } else {
        if (!modStore.readSync(next)) return { ok: false, error: `Unknown mod: ${next}` }
        room.modId = next
      }
    }
    if (patch.map !== undefined) {
      const validation = validateMap(patch.map)
      if (!validation.ok) return { ok: false, error: `Invalid custom map: ${validation.errors[0] ?? 'bad map'}` }
      const name = patch.map.name.trim().slice(0, 48) || 'Custom'
      const occupants = room.players.size + room.bots.length
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
      const occupants = room.players.size + room.bots.length
      if (occupants > preset.players) {
        return { ok: false, error: `This map fits ${preset.players} players — ${occupants} are in the room` }
      }
      room.mapId = preset.id
      room.map = mapForPreset(preset)
      room.maxPlayers = preset.players
    }
    if (patch.settings !== undefined) {
      room.baseSettings = mergeMatchSettings({ ...room.baseSettings, ...sanitizeSettings(patch.settings) })
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
    this.recomputeSettings(room)
    return { ok: true }
  }

  /** Called when a mod file is deleted: detaches it from the room if in use. */
  detachMod(name: string): void {
    const room = this.room
    if (room && room.modId === name) {
      room.modId = ''
      this.recomputeSettings(room)
    }
  }

  /** Called after a mod file is renamed: repoints the room to the new filename. */
  repointMod(oldName: string, newName: string): void {
    const room = this.room
    if (room && room.modId === oldName) {
      room.modId = newName
      this.recomputeSettings(room)
    }
  }

  removePlayer(ws: WebSocket): void {
    if (!this.room) return
    this.room.players.delete(ws)
  }

  /** All active (non-spectator) participants: connected humans plus server-side bots. */
  nonSpectators(room: Room): HostPlayer[] {
    return [...room.players.values(), ...room.bots].filter((p) => !p.spectator)
  }

  /** Marks a slot as disconnected without dropping it, so a matching clientId can reclaim it. */
  disconnectPlayer(ws: WebSocket): HostPlayer | null {
    if (!this.room) return null
    const p = this.room.players.get(ws)
    if (!p) return null
    p.connected = false
    return p
  }

  slots(room: Room): PlayerSlot[] {
    const slots: PlayerSlot[] = []
    room.players.forEach((p) => {
      slots.push({ id: p.id, name: p.name, ready: p.ready, host: p.host, team: p.team, spawn: p.spawn, color: p.color, spectator: p.spectator, bot: p.bot, difficulty: p.difficulty, ...(p.devSettings !== undefined ? { devSettings: p.devSettings } : {}) })
    })
    for (const b of room.bots) {
      slots.push({ id: b.id, name: b.name, ready: b.ready, host: false, team: b.team, spawn: b.spawn, color: b.color, spectator: false, bot: true, difficulty: b.difficulty })
    }
    return slots.sort((a, b) => a.id - b.id)
  }

  matchSlots(room: Room): PlayerSlot[] {
    const slots: PlayerSlot[] = []
    room.players.forEach((p) => {
      if (p.spectator) return
      slots.push({ id: p.id, name: p.name, ready: p.ready, host: p.host, team: p.team, spawn: p.spawn, color: p.color, bot: p.bot, difficulty: p.difficulty })
    })
    for (const b of room.bots) {
      slots.push({ id: b.id, name: b.name, ready: b.ready, host: false, team: b.team, spawn: b.spawn, color: b.color, bot: true, difficulty: b.difficulty })
    }
    return slots.sort((a, b) => a.id - b.id)
  }

  hostReady(room: Room, ws: WebSocket): boolean {
    const p = room.players.get(ws)
    return !!p && p.host
  }
}
