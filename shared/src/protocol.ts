import type { MapData } from './maps.ts'
import { PROTOCOL_VERSION } from './constants.ts'
import type { MatchSettings, WinRule } from './constants.ts'

export type CommandType =
  | 'move'
  | 'attack-move'
  | 'keep-attack'
  | 'guard'
  | 'stop'
  | 'place'
  | 'sell'
  | 'collect'
  | 'queue'
  | 'dequeue'
  | 'reorder-queue'
  | 'attack'
  | 'research'
  | 'build'
  | 'set-spawn-point'
  | 'assign-dock'
  | 'satellite'
  | 'laser'
  | 'sw-choose'
  | 'sw-airstrike'
  | 'sw-emp'
  | 'set-flag-point'
  | 'forfeit'
  | 'max-power'
  | 'ping'
  | 'grenade'
  | 'smoke'
  | 'set-detector'
  | 'set-stealth'
  | 'place-mine'
  | 'remove-mine'
  | 'repair-unit'
  | 'dequeue-research'
  | 'transport-load'
  | 'transport-unload'
  | 'rank-up'
  | 'ally-coop-request'
  | 'ally-coop-vote'
  | 'coop-setting'

/** The three ping flavours players can drop to share intel with their team. */
export type PingType = 'alert' | 'assist' | 'on-my-way'

/** The one-time Super Weapon strike choice a team makes at its SP building. */
export type SwChoice = 'laser' | 'airstrike' | 'emp'

export const SW_CHOICES: SwChoice[] = ['laser', 'airstrike', 'emp']

export interface SimCommand {
  type: CommandType
  entities: number[]
  x: number
  y: number
  buildingType?: string
  unitType?: string
  target?: number
  index?: number
  to?: number
  upgrade?: string
  pingType?: PingType
  /** The APC carrying (or about to carry) units for the transport commands. */
  transportId?: number
  /** Day 16: teammate's accept/decline on the mid-match co-op request. */
  approve?: boolean
  /** Day 16: mid-match co-op toggle (economy / rank / control), issued by any player. */
  coopKey?: 'coopEconomy' | 'coopRank' | 'coopControl'
  coopValue?: string
  /** Super Weapon strike choice for the `sw-choose` command. */
  choice?: SwChoice
}

export interface EnvelopeCommand {
  player: number
  seq: number
  tick: number
  cmd: SimCommand
}

export type BotDifficulty = 'easy' | 'medium' | 'hard'

export interface PlayerSlot {
  id: number
  name: string
  ready: boolean
  host: boolean
  team?: number
  spawn?: number
  color?: number
  spectator?: boolean
  bot?: boolean
  difficulty?: BotDifficulty
  devSettings?: Partial<MatchSettings>
}

export const BIN = {
  CMD: 1,
  FRAME: 2,
  CHECKSUM: 3,
  RELAY_CHECKSUM: 4,
} as const

export const CMD_TYPE_IDS: Record<CommandType, number> = {
  move: 0,
  'attack-move': 1,
  'keep-attack': 16,
  'guard': 17,
  stop: 2,
  place: 3,
  sell: 4,
  collect: 19,
  queue: 5,
  dequeue: 6,
  'reorder-queue': 21,
  attack: 7,
  research: 8,
  build: 9,
  'set-spawn-point': 10,
  'assign-dock': 11,
  satellite: 12,
  laser: 13,
  'sw-choose': 32,
  'sw-airstrike': 33,
  'sw-emp': 34,
  'set-flag-point': 14,
  forfeit: 15,
  'max-power': 18,
  ping: 20,
  grenade: 22,
  smoke: 23,
  'set-detector': 24,
  'set-stealth': 25,
  'place-mine': 26,
  'remove-mine': 27,
  'repair-unit': 28,
  'dequeue-research': 29,
  'transport-load': 30,
  'transport-unload': 31,
  'rank-up': 35,
  'ally-coop-request': 36,
  'ally-coop-vote': 37,
  'coop-setting': 38,
}

export const PING_TYPE_IDS: Record<PingType, number> = {
  alert: 0,
  assist: 1,
  'on-my-way': 2,
}

export const PING_TYPES: PingType[] = ['alert', 'assist', 'on-my-way']

const CMD_TYPES: CommandType[] = ['move', 'attack-move', 'stop', 'place', 'sell', 'queue', 'dequeue', 'attack', 'research', 'build', 'set-spawn-point', 'assign-dock', 'satellite', 'laser', 'set-flag-point', 'forfeit', 'keep-attack', 'guard', 'max-power', 'collect', 'ping', 'reorder-queue', 'grenade', 'smoke', 'set-detector', 'set-stealth', 'place-mine', 'remove-mine', 'repair-unit', 'dequeue-research', 'transport-load', 'transport-unload', 'sw-choose', 'sw-airstrike', 'sw-emp', 'rank-up', 'ally-coop-request', 'ally-coop-vote', 'coop-setting']

const COOP_KEY_IDS: Record<'coopEconomy' | 'coopRank' | 'coopControl', number> = {
  coopEconomy: 0,
  coopRank: 1,
  coopControl: 2,
}
const COOP_KEYS: ('coopEconomy' | 'coopRank' | 'coopControl')[] = ['coopEconomy', 'coopRank', 'coopControl']

const encoder = new TextEncoder()
const decoder = new TextDecoder()

interface Cursor {
  buf: Uint8Array
  view: DataView
  offset: number
}

const readU8 = (c: Cursor): number => {
  const v = c.view.getUint8(c.offset)
  c.offset += 1
  return v
}
const readU16 = (c: Cursor): number => {
  const v = c.view.getUint16(c.offset, true)
  c.offset += 2
  return v
}
const readU32 = (c: Cursor): number => {
  const v = c.view.getUint32(c.offset, true)
  c.offset += 4
  return v
}
const readI32 = (c: Cursor): number => {
  const v = c.view.getInt32(c.offset, true)
  c.offset += 4
  return v
}
const readStr = (c: Cursor): string => {
  const len = readU16(c)
  const bytes = c.buf.subarray(c.offset, c.offset + len)
  c.offset += len
  return decoder.decode(bytes)
}

const grow = (buf: Uint8Array, needed: number): Uint8Array =>
  needed <= buf.length ? buf : new Uint8Array(Math.max(needed, buf.length * 2))

export const encodeEnvelope = (env: EnvelopeCommand): Uint8Array => {
  const cmd = env.cmd
  const typeName = cmd.type
  const typeId = CMD_TYPE_IDS[typeName]
  const nameSize = (s: string | undefined): number => (s ? encoder.encode(s).length : 0)
  const extra =
    typeName === 'place' || typeName === 'queue' ? nameSize(cmd.buildingType ?? cmd.unitType) + 2
    :     typeName === 'research' ? nameSize(cmd.upgrade) + 2
    : typeName === 'sw-choose' ? nameSize(cmd.choice) + 2
    : typeName === 'dequeue' || typeName === 'dequeue-research' ? 1
    : typeName === 'reorder-queue' ? 2
    : typeName === 'ping' ? 1
    : typeName === 'ally-coop-vote' ? 1
    : typeName === 'coop-setting' ? 1 + nameSize(cmd.coopValue) + 2
    : typeName === 'attack-move' || typeName === 'attack' || typeName === 'build' || typeName === 'collect' || typeName === 'assign-dock' || typeName === 'keep-attack' || typeName === 'guard' || typeName === 'remove-mine' || typeName === 'repair-unit' || typeName === 'transport-load' ? 4
    : typeName === 'transport-unload' ? 8
    : 0

  let buf = new Uint8Array(4 + 4 + 1 + 4 + 2 + cmd.entities.length * 4 + 8 + extra)
  let view = new DataView(buf.buffer)
  let off = 0

  const putU8 = (v: number): void => {
    view.setUint8(off, v)
    off += 1
  }
  const putU16 = (v: number): void => {
    view.setUint16(off, v, true)
    off += 2
  }
  const putU32 = (v: number): void => {
    view.setUint32(off, v, true)
    off += 4
  }
  const putI32 = (v: number): void => {
    view.setInt32(off, v, true)
    off += 4
  }
  const putStr = (s: string): void => {
    const bytes = encoder.encode(s)
    putU16(bytes.length)
    buf = grow(buf, off + bytes.length)
    buf.set(bytes, off)
    view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
    off += bytes.length
  }

  putU8(typeId)
  putI32(env.tick)
  putU8(env.player)
  putU32(env.seq)
  putU16(cmd.entities.length)
  for (const e of cmd.entities) putI32(e)
  putI32(cmd.x)
  putI32(cmd.y)
  if (typeName === 'ping') putU8(PING_TYPE_IDS[cmd.pingType ?? 'alert'])
  if (typeName === 'place') putStr(cmd.buildingType ?? '')
  if (typeName === 'queue') putStr(cmd.unitType ?? '')
  if (typeName === 'research') putStr(cmd.upgrade ?? '')
  if (typeName === 'sw-choose') putStr(cmd.choice ?? '')
  if (typeName === 'dequeue') putU8(cmd.index ?? 0)
  if (typeName === 'dequeue-research') putU8(cmd.index ?? 0)
  if (typeName === 'ally-coop-vote') putU8(cmd.approve ? 1 : 0)
  if (typeName === 'coop-setting') {
    putU8(COOP_KEY_IDS[cmd.coopKey ?? 'coopControl'])
    putStr(cmd.coopValue ?? '')
  }
  if (typeName === 'reorder-queue') {
    putU8(cmd.index ?? 0)
    putU8(cmd.to ?? 0)
  }
  if (typeName === 'attack-move') putI32(cmd.target ?? -1)
  if (typeName === 'attack') putI32(cmd.target ?? -1)
  if (typeName === 'build') putI32(cmd.target ?? -1)
  if (typeName === 'collect') putI32(cmd.target ?? -1)
  if (typeName === 'assign-dock') putI32(cmd.target ?? -1)
  if (typeName === 'keep-attack') putI32(cmd.target ?? -1)
  if (typeName === 'guard') putI32(cmd.target ?? -1)
  if (typeName === 'remove-mine') putI32(cmd.target ?? -1)
  if (typeName === 'repair-unit') putI32(cmd.target ?? -1)
  if (typeName === 'transport-load') putI32(cmd.transportId ?? -1)
  if (typeName === 'transport-unload') {
    putI32(cmd.transportId ?? -1)
    putI32(cmd.index ?? -1)
  }

  return buf.slice(0, off)
}

export const decodeEnvelope = (data: Uint8Array): EnvelopeCommand => {
  const c: Cursor = { buf: data, view: new DataView(data.buffer, data.byteOffset, data.byteLength), offset: 0 }
  const typeId = readU8(c)
  const typeName = CMD_TYPES[typeId] ?? 'stop'
  const tick = readI32(c)
  const player = readU8(c)
  const seq = readU32(c)
  const entityCount = readU16(c)
  const entities: number[] = []
  for (let i = 0; i < entityCount; i++) entities.push(readI32(c))
  const x = readI32(c)
  const y = readI32(c)

  const cmd: SimCommand = { type: typeName, entities, x, y }
  if (typeName === 'ping') cmd.pingType = PING_TYPES[readU8(c)] ?? 'alert'
  if (typeName === 'place') cmd.buildingType = readStr(c)
  if (typeName === 'queue') cmd.unitType = readStr(c)
  if (typeName === 'research') cmd.upgrade = readStr(c)
  if (typeName === 'sw-choose') {
    const s = readStr(c)
    cmd.choice = s === 'laser' || s === 'airstrike' || s === 'emp' ? s : undefined
  }
  if (typeName === 'dequeue') cmd.index = readU8(c)
  if (typeName === 'dequeue-research') cmd.index = readU8(c)
  if (typeName === 'ally-coop-vote') cmd.approve = readU8(c) === 1
  if (typeName === 'coop-setting') {
    cmd.coopKey = COOP_KEYS[readU8(c)] ?? 'coopControl'
    cmd.coopValue = readStr(c)
  }
  if (typeName === 'reorder-queue') {
    cmd.index = readU8(c)
    cmd.to = readU8(c)
  }
  if (typeName === 'attack-move') cmd.target = readI32(c)
  if (typeName === 'attack') cmd.target = readI32(c)
  if (typeName === 'build') cmd.target = readI32(c)
  if (typeName === 'collect') cmd.target = readI32(c)
  if (typeName === 'assign-dock') cmd.target = readI32(c)
  if (typeName === 'keep-attack') cmd.target = readI32(c)
  if (typeName === 'guard') cmd.target = readI32(c)
  if (typeName === 'remove-mine') cmd.target = readI32(c)
  if (typeName === 'repair-unit') cmd.target = readI32(c)
  if (typeName === 'transport-load') cmd.transportId = readI32(c)
  if (typeName === 'transport-unload') {
    cmd.transportId = readI32(c)
    const idx = readI32(c)
    if (idx >= 0) cmd.index = idx
  }

  return { player, seq, tick, cmd }
}

export const encodeFrame = (tick: number, commands: EnvelopeCommand[]): Uint8Array => {
  const parts: Uint8Array[] = []
  const header = new Uint8Array(5)
  const view = new DataView(header.buffer)
  view.setUint8(0, BIN.FRAME)
  view.setInt32(1, tick, true)
  parts.push(header)
  for (const env of commands) parts.push(encodeEnvelope(env))
  const total = parts.reduce((a, p) => a + p.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const p of parts) {
    out.set(p, off)
    off += p.length
  }
  return out
}

export const decodeFrame = (data: Uint8Array): { tick: number; commands: EnvelopeCommand[] } => {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const tick = view.getInt32(1, true)
  const commands: EnvelopeCommand[] = []
  let off = 5
  while (off < data.length) {
    const sub = data.subarray(off)
    const env = decodeEnvelope(sub)
    commands.push(env)
    off += envelopeLength(sub)
  }
  return { tick, commands }
}

export const encodeChecksum = (tick: number, crc: number): Uint8Array => {
  const buf = new Uint8Array(9)
  const view = new DataView(buf.buffer)
  view.setUint8(0, BIN.CHECKSUM)
  view.setInt32(1, tick, true)
  view.setUint32(5, crc >>> 0, true)
  return buf
}

export const decodeChecksum = (data: Uint8Array): { tick: number; crc: number } => {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  return { tick: view.getInt32(1, true), crc: view.getUint32(5, true) }
}

export const encodeRelayChecksum = (player: number, tick: number, crc: number): Uint8Array => {
  const buf = new Uint8Array(10)
  const view = new DataView(buf.buffer)
  view.setUint8(0, BIN.RELAY_CHECKSUM)
  view.setUint8(1, player)
  view.setInt32(2, tick, true)
  view.setUint32(6, crc >>> 0, true)
  return buf
}

export const decodeRelayChecksum = (data: Uint8Array): { player: number; tick: number; crc: number } => {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  return { player: view.getUint8(1), tick: view.getInt32(2, true), crc: view.getUint32(6, true) }
}

export const encodeCmd = (env: EnvelopeCommand): Uint8Array => {
  const body = encodeEnvelope(env)
  const out = new Uint8Array(body.length + 1)
  out[0] = BIN.CMD
  out.set(body, 1)
  return out
}

const envelopeLength = (data: Uint8Array): number => {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let off = 1 + 4 + 1 + 4 + 2
  const entityCount = view.getUint16(10, true)
  off += entityCount * 4 + 8
  const typeId = data[0]
  const typeName = CMD_TYPES[typeId] ?? 'stop'
  if (typeName === 'place' || typeName === 'queue' || typeName === 'research' || typeName === 'sw-choose') {
    const len = view.getUint16(off, true)
    off += 2 + len
  } else if (typeName === 'dequeue' || typeName === 'ping' || typeName === 'dequeue-research' || typeName === 'ally-coop-vote') {
    off += 1
  } else if (typeName === 'coop-setting') {
    const len = view.getUint16(off + 1, true)
    off += 1 + 2 + len
  } else if (typeName === 'reorder-queue') {
    off += 2
  } else if (
    typeName === 'attack-move' ||
    typeName === 'attack' ||
    typeName === 'build' ||
    typeName === 'collect' ||
    typeName === 'assign-dock' ||
    typeName === 'keep-attack' ||
    typeName === 'guard' ||
    typeName === 'remove-mine' ||
    typeName === 'repair-unit' ||
    typeName === 'transport-load'
  ) {
    off += 4
  } else if (typeName === 'transport-unload') {
    off += 8
  }
  return off
}

export const crc32 = (data: Uint8Array): number => {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i]
    for (let k = 0; k < 8; k++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

export interface JoinMessage {
  kind: 'C_JOIN'
  roomCode: string
  passphraseHash: string
  name: string
}
export interface LobbyMessage {
  kind: 'H_LOBBY'
  roomCode: string
  yourId: number
  hostId: number
  players: PlayerSlot[]
  maxPlayers: number
  mapName: string
  mapId: string
  passwordRequired: boolean
  winRule?: WinRule
  settings?: Partial<MatchSettings>
  map?: MapData
}
export interface ReadyMessage {
  kind: 'C_READY'
  ready: boolean
}
export interface UpdateSlotMessage {
  kind: 'C_UPDATE_SLOT'
  name?: string
  team?: number
  spawn?: number
  color?: number
}
export interface AddBotMessage {
  kind: 'C_ADD_BOT'
  difficulty: BotDifficulty
  name?: string
  team?: number
  spawn?: number
  color?: number
}
export interface UpdateBotMessage {
  kind: 'C_UPDATE_BOT'
  id: number
  name?: string
  team?: number
  spawn?: number
  color?: number
  difficulty?: BotDifficulty
}
export interface RemoveBotMessage {
  kind: 'C_REMOVE_BOT'
  id: number
}
export interface UpdateRoomMessage {
  kind: 'C_UPDATE_ROOM'
  mapId?: string
  map?: MapData
  password?: string
  settings?: Partial<MatchSettings>
  winRule?: WinRule
}
export interface StartMessage {
  kind: 'C_START'
}
export interface ErrorMessage {
  kind: 'H_ERROR'
  message: string
}
export interface MatchStartMessage {
  kind: 'S_MATCH_START'
  protocolVersion: number
  seed: number
  tickRate: number
  map: MapData
  players: PlayerSlot[]
  hostId: number
  yourId: number
  spectator?: boolean
  settings?: Partial<MatchSettings>
  winRule?: WinRule
}
export interface LoadedMessage {
  kind: 'C_LOADED'
}
export interface GameOverMessage {
  kind: 'H_GAME_OVER'
  winner: number | null
}
export interface GameOverReportMessage {
  kind: 'C_GAME_OVER'
  winner: number | null
}
export interface PlayerStateMessage {
  kind: 'H_PLAYER_STATE'
  players: PlayerSlot[]
}
export interface MatchChatMessage {
  kind: 'C_CHAT'
  text: string
  target: 'all' | 'team'
  team: number
}
export interface ChatRelayMessage {
  kind: 'H_CHAT'
  from: number
  name: string
  text: string
  target: 'all' | 'team'
  team: number
  ts: number
}
export interface SpectateSyncMessage {
  kind: 'S_SPECTATE_SYNC'
  currentTick: number
  log: EnvelopeCommand[]
}

export interface DevSettingsMessage {
  kind: 'C_DEV_SETTINGS'
  settings: Partial<MatchSettings>
}

export type ControlMessage =
  | JoinMessage
  | LobbyMessage
  | ReadyMessage
  | UpdateSlotMessage
  | UpdateRoomMessage
  | AddBotMessage
  | UpdateBotMessage
  | RemoveBotMessage
  | StartMessage
  | ErrorMessage
  | MatchStartMessage
  | LoadedMessage
  | GameOverMessage
  | GameOverReportMessage
  | PlayerStateMessage
  | MatchChatMessage
  | ChatRelayMessage
  | SpectateSyncMessage
  | DevSettingsMessage

export const decodeControl = (data: string | ArrayBuffer): ControlMessage => {
  const text = typeof data === 'string' ? data : new TextDecoder().decode(data)
  return JSON.parse(text) as ControlMessage
}

export const encodeControl = (msg: ControlMessage): string => JSON.stringify(msg)

export const makeMatchStart = (
  map: MapData,
  players: PlayerSlot[],
  hostId: number,
  yourId: number,
  seed: number,
  tickRate: number,
  settings?: Partial<MatchSettings>,
  winRule?: WinRule,
): MatchStartMessage => ({
  kind: 'S_MATCH_START',
  protocolVersion: PROTOCOL_VERSION,
  seed,
  tickRate,
  map,
  players,
  hostId,
  yourId,
  ...(settings !== undefined ? { settings } : {}),
  ...(winRule !== undefined ? { winRule } : {}),
})
