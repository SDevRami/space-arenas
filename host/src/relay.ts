import type WebSocket from 'ws'
import {
  BIN,
  decodeEnvelope,
  encodeFrame,
  encodeRelayChecksum,
  type EnvelopeCommand,
} from '@space-arenas/shared'
import type { Room } from './rooms.ts'
import type { NetBotRunner } from './bots.ts'

export class TickRelay {
  private timer: NodeJS.Timeout | null = null
  private tick = 0
  private pending: EnvelopeCommand[] = []
  private forfeitSeq = 0
  readonly history: EnvelopeCommand[] = []

  constructor(
    private readonly room: Room,
    private readonly bots: NetBotRunner | null = null,
  ) {}

  get currentTick(): number {
    return this.tick
  }

  submit(ws: WebSocket, data: Uint8Array): void {
    if (data[0] !== BIN.CMD) return
    const player = this.room.players.get(ws)
    if (!player || player.spectator) return
    const env = decodeEnvelope(data.subarray(1))
    const stamped: EnvelopeCommand = { ...env, player: player.id, tick: this.tick }
    this.pending.push(stamped)
    this.history.push(stamped)
  }

  submitForfeit(playerId: number): void {
    const stamped: EnvelopeCommand = {
      player: playerId,
      seq: 0x80000000 + this.forfeitSeq++,
      tick: this.tick,
      cmd: { type: 'forfeit', entities: [], x: 0, y: 0 },
    }
    this.pending.push(stamped)
    this.history.push(stamped)
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => this.broadcastFrame(), 40)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private broadcastFrame(): void {
    if (this.bots) {
      for (const cmd of this.bots.commandsForTick()) {
        this.pending.push({ ...cmd, tick: this.tick })
      }
    }
    const commands = this.pending
    this.pending = []
    commands.sort((a, b) => a.player - b.player || a.seq - b.seq)
    const payload = encodeFrame(this.tick, commands)
    this.room.players.forEach((p, ws) => {
      if (!p.connected) return
      if (ws.readyState === 1) ws.send(payload)
    })
    this.bots?.step(commands)
    this.tick++
  }

  relayChecksum(ws: WebSocket, tick: number, crc: number): void {
    const player = this.room.players.get(ws)?.id
    if (player === undefined) return
    const payload = encodeRelayChecksum(player, tick, crc)
    this.room.players.forEach((p, ws2) => {
      if (!p.connected) return
      if (ws2.readyState === 1) ws2.send(payload)
    })
  }
}
