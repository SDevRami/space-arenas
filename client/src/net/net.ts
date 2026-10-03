import {
  BIN,
  PROTOCOL_VERSION,
  decodeChecksum,
  decodeControl,
  decodeFrame,
  decodeRelayChecksum,
  encodeChecksum,
  encodeCmd,
  encodeControl,
  type ChatRelayMessage,
  type ControlMessage,
  type EnvelopeCommand,
  type LobbyMessage,
  type MatchSettings,
  type MapData,
  type MatchStartMessage,
  type PlayerSlot,
  type BotDifficulty,
  type SpectateSyncMessage,
  type SettingsAlertMessage,
  type WinRule,
} from '@space-arenas/shared'
import { pbkdf2Sha256Hex } from './pbkdf2.ts'

export interface NetCallbacks {
  onLobby: (msg: LobbyMessage) => void
  onMatchStart: (msg: MatchStartMessage) => void
  onFrame: (tick: number, commands: EnvelopeCommand[]) => void
  onChecksum: (tick: number, crc: number) => void
  onRelayChecksum: (player: number, tick: number, crc: number) => void
  onGameOver: (winner: number | null) => void
  onPlayerState: (players: PlayerSlot[]) => void
  onChat: (msg: ChatRelayMessage) => void
  onSpectateSync: (msg: SpectateSyncMessage) => void
  onSettingsAlert?: (msg: SettingsAlertMessage) => void
  onError: (message: string) => void
  onOpen: () => void
  onClose: () => void
  onPong?: () => void
}

export class NetClient {
  private ws: WebSocket | null = null
  private cb: Partial<NetCallbacks>
  private intentionalClose = false
  myId = -1
  readonly clientId: string

  constructor(cb: Partial<NetCallbacks>) {
    this.cb = cb
    this.clientId = loadOrCreateClientId()
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url)
      ws.binaryType = 'arraybuffer'
      ws.onopen = () => {
        this.cb.onOpen?.()
        resolve()
      }
      ws.onerror = () => reject(new Error('websocket connect failed'))
      ws.onmessage = (e) => this.onMessage(e.data)
      ws.onclose = () => {
        if (!this.intentionalClose) this.cb.onClose?.()
      }
      this.ws = ws
    })
  }

  private onMessage(data: string | ArrayBuffer): void {
    if (typeof data === 'string') {
      const msg = decodeControl(data)
      this.onControl(msg)
      return
    }
    const buf = new Uint8Array(data as ArrayBuffer)
    const kind = buf[0]
    if (kind === BIN.FRAME) {
      const f = decodeFrame(buf)
      this.cb.onFrame?.(f.tick, f.commands)
    } else if (kind === BIN.CHECKSUM) {
      const c = decodeChecksum(buf)
      this.cb.onChecksum?.(c.tick, c.crc)
    } else if (kind === BIN.RELAY_CHECKSUM) {
      const c = decodeRelayChecksum(buf)
      this.cb.onRelayChecksum?.(c.player, c.tick, c.crc)
    }
  }

  private onControl(msg: ControlMessage): void {
    switch (msg.kind) {
      case 'H_LOBBY':
        this.myId = msg.yourId
        this.cb.onLobby?.(msg)
        break
      case 'S_MATCH_START':
        this.cb.onMatchStart?.(msg)
        break
      case 'H_ERROR':
        this.cb.onError?.(msg.message)
        break
      case 'H_GAME_OVER':
        this.cb.onGameOver?.(msg.winner)
        break
      case 'H_PLAYER_STATE':
        this.cb.onPlayerState?.(msg.players)
        break
      case 'H_CHAT':
        this.cb.onChat?.(msg)
        break
      case 'S_SPECTATE_SYNC':
        this.cb.onSpectateSync?.(msg)
        break
      case 'H_SETTINGS_ALERT':
        this.cb.onSettingsAlert?.(msg)
        break
      case 'H_PONG':
        this.cb.onPong?.()
        break
      case 'C_JOIN':
      case 'C_READY':
      case 'C_START':
      case 'C_LOADED':
      case 'C_CHAT':
      case 'C_UPDATE_SLOT':
      case 'C_UPDATE_ROOM':
      case 'C_ADD_BOT':
      case 'C_UPDATE_BOT':
      case 'C_REMOVE_BOT':
      case 'C_GAME_OVER':
      case 'C_FORFEIT':
        break
    }
  }

  send(msg: ControlMessage): void {
    this.ws?.send(encodeControl(msg))
  }

  async join(roomCode: string, passphrase: string, name: string, spectator = false, token?: string): Promise<void> {
    const hash = await hashPassphrase(passphrase, roomCode)
    this.send({ kind: 'C_JOIN', roomCode, passphraseHash: hash, name, clientId: this.clientId, protocol: PROTOCOL_VERSION, ...(spectator ? { spectator: true } : {}), ...(token ? { token } : {}) })
  }

  ready(ready: boolean): void {
    this.send({ kind: 'C_READY', ready })
  }

  updateSlot(patch: { name?: string; team?: number; spawn?: number; color?: number }): void {
    this.send({ kind: 'C_UPDATE_SLOT', ...patch })
  }

  publishDevSettings(settings: Partial<MatchSettings>): void {
    this.send({ kind: 'C_DEV_SETTINGS', settings })
  }

  /** Host verdict after an H_SETTINGS_ALERT: kick the offender or skip for now. */
  settingsVerdict(playerId: number, action: 'kick' | 'skip'): void {
    this.send({ kind: 'C_SETTINGS_VERDICT', playerId, action })
  }

  updateRoom(patch: { mapId?: string; map?: MapData; password?: string; settings?: Partial<MatchSettings>; winRule?: WinRule; modId?: string }): void {
    this.send({ kind: 'C_UPDATE_ROOM', ...patch })
  }

  addBot(difficulty: BotDifficulty, patch?: { name?: string; team?: number; spawn?: number; color?: number }): void {
    this.send({ kind: 'C_ADD_BOT', difficulty, ...patch })
  }

  updateBot(id: number, patch: { name?: string; team?: number; spawn?: number; difficulty?: BotDifficulty; color?: number }): void {
    this.send({ kind: 'C_UPDATE_BOT', id, ...patch })
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

  sendCommand(env: EnvelopeCommand): void {
    this.ws?.send(encodeCmd(env))
  }

  chat(text: string, target: 'all' | 'team', team: number): void {
    this.send({ kind: 'C_CHAT', text, target, team })
  }

  gameOver(winner: number | null, scores?: Array<{ team: number; score: number }>): void {
    this.send({ kind: 'C_GAME_OVER', winner, ...(scores ? { scores } : {}) })
  }

  /** Surrenders the active match: the server forfeits this slot to the relay
   *  immediately, so the remaining players win without waiting for a grace timer. */
  forfeit(): void {
    this.send({ kind: 'C_FORFEIT' })
  }

  sendChecksum(tick: number, crc: number): void {
    this.ws?.send(encodeChecksum(tick, crc))
  }

  close(): void {
    this.intentionalClose = true
    this.ws?.close()
    this.ws = null
  }
}

export async function hashPassphrase(passphrase: string, roomCode: string): Promise<string> {
  const salt = `space-arenas:${roomCode}`
  const subtle =
    typeof crypto !== 'undefined' && typeof crypto.subtle !== 'undefined' ? crypto.subtle : undefined
  if (subtle) {
    try {
      const enc = new TextEncoder()
      const key = await subtle.importKey('raw', enc.encode(passphrase), { name: 'PBKDF2' }, false, [
        'deriveBits',
      ])
      const bits = await subtle.deriveBits(
        { name: 'PBKDF2', salt: enc.encode(salt), iterations: 100_000, hash: 'SHA-256' },
        key,
        256,
      )
      return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('')
    } catch {
      // subtle is unavailable outside secure contexts - fall through to the pure-JS path
    }
  }
  return pbkdf2Sha256Hex(passphrase, salt, 100_000, 32)
}

const CLIENT_ID_KEY = 'space-arenas:clientId'

/** Returns a stable per-browser id used to reclaim a player slot when reconnecting. */
export function loadOrCreateClientId(): string {
  const existing = localStorage.getItem(CLIENT_ID_KEY)
  if (existing) return existing
  const raw = crypto.getRandomValues(new Uint32Array(4))
  const id = [...raw].map((n) => n.toString(16).padStart(8, '0')).join('')
  try {
    localStorage.setItem(CLIENT_ID_KEY, id)
  } catch {
    /* private mode — id still works for this session */
  }
  return id
}
