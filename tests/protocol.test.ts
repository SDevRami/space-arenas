import { describe, expect, it } from 'vitest'
import {
  CMD_TYPE_IDS,
  decodeChecksum,
  decodeControl,
  decodeEnvelope,
  decodeFrame,
  decodeRelayChecksum,
  encodeChecksum,
  encodeControl,
  encodeEnvelope,
  encodeFrame,
  encodeRelayChecksum,
  makeMatchStart,
  crc32,
  type CommandType,
  type EnvelopeCommand,
} from '@space-arenas/shared'
import { generateDefaultMap } from '@space-arenas/shared'

const ALL_TYPES: CommandType[] = ['move', 'attack-move', 'keep-attack', 'guard', 'stop', 'place', 'sell', 'queue', 'dequeue', 'attack', 'research', 'build', 'set-spawn-point', 'set-flag-point', 'assign-dock', 'satellite', 'laser', 'forfeit', 'max-power', 'collect', 'ping', 'reorder-queue', 'grenade', 'smoke', 'set-detector', 'set-stealth']

const makeEnv = (type: CommandType): EnvelopeCommand => {
  const cmd: EnvelopeCommand['cmd'] = { type, entities: [1, 2, 3], x: -12345, y: 67890 }
  if (type === 'place') cmd.buildingType = 'barracks'
  if (type === 'queue') cmd.unitType = 'rifleman'
  if (type === 'dequeue') cmd.index = 2
  if (type === 'reorder-queue') {
    cmd.index = 2
    cmd.to = 4
  }
  if (type === 'attack') cmd.target = 42
  if (type === 'attack-move') cmd.target = 42
  if (type === 'keep-attack') cmd.target = 42
  if (type === 'guard') cmd.target = 42
  if (type === 'build') cmd.target = 99
  if (type === 'assign-dock') cmd.target = 77
  if (type === 'collect') cmd.target = 55
  if (type === 'research') cmd.upgrade = 'radar'
  if (type === 'ping') cmd.pingType = 'alert'
  return { player: 1, seq: 987654321, tick: 123456, cmd }
}

describe('protocol: envelope round-trip', () => {
  it('round-trips every command type', () => {
    for (const type of ALL_TYPES) {
      const env = makeEnv(type)
      const out = decodeEnvelope(encodeEnvelope(env))
      expect(out.cmd.type).toBe(type)
      expect(out.tick).toBe(env.tick)
      expect(out.player).toBe(env.player)
      expect(out.seq).toBe(env.seq)
      expect(out.cmd.entities).toEqual(env.cmd.entities)
      expect(out.cmd.x).toBe(env.cmd.x)
      expect(out.cmd.y).toBe(env.cmd.y)
      expect(out.cmd.buildingType).toBe(type === 'place' ? 'barracks' : undefined)
      expect(out.cmd.unitType).toBe(type === 'queue' ? 'rifleman' : undefined)
      expect(out.cmd.index).toBe(type === 'dequeue' || type === 'reorder-queue' ? 2 : undefined)
      expect(out.cmd.to).toBe(type === 'reorder-queue' ? 4 : undefined)
      expect(out.cmd.target).toBe(type === 'attack' || type === 'attack-move' || type === 'keep-attack' || type === 'guard' ? 42 : type === 'build' ? 99 : type === 'assign-dock' ? 77 : type === 'collect' ? 55 : undefined)
      expect(out.cmd.upgrade).toBe(type === 'research' ? 'radar' : undefined)
      expect(out.cmd.pingType).toBe(type === 'ping' ? 'alert' : undefined)
    }
  })

  it('handles negative coordinates', () => {
    const env: EnvelopeCommand = { player: 0, seq: 1, tick: -5, cmd: { type: 'move', entities: [], x: -999999, y: -1 } }
    const out = decodeEnvelope(encodeEnvelope(env))
    expect(out.cmd.x).toBe(-999999)
    expect(out.cmd.y).toBe(-1)
    expect(out.tick).toBe(-5)
  })
})

describe('protocol: frames', () => {
  it('round-trips a frame with mixed commands', () => {
    const envs = [makeEnv('move'), makeEnv('place'), makeEnv('attack'), makeEnv('dequeue')]
    const frame = encodeFrame(777, envs)
    const out = decodeFrame(frame)
    expect(out.tick).toBe(777)
    expect(out.commands).toHaveLength(4)
    expect(out.commands.map((c) => c.cmd.type)).toEqual(['move', 'place', 'attack', 'dequeue'])
  })

  it('round-trips a frame containing an attack-move command', () => {
    const envs = [makeEnv('attack-move'), makeEnv('move'), makeEnv('attack-move'), makeEnv('stop')]
    const frame = encodeFrame(778, envs)
    const out = decodeFrame(frame)
    expect(out.tick).toBe(778)
    expect(out.commands.map((c) => c.cmd.type)).toEqual(['attack-move', 'move', 'attack-move', 'stop'])
    expect(out.commands[0].cmd.target).toBe(42)
    expect(out.commands[2].cmd.target).toBe(42)
  })

  it('round-trips an empty frame', () => {
    const out = decodeFrame(encodeFrame(0, []))
    expect(out.tick).toBe(0)
    expect(out.commands).toHaveLength(0)
  })
})

describe('protocol: checksums', () => {
  it('round-trips checksum', () => {
    const c = decodeChecksum(encodeChecksum(1234, 0xdeadbeef))
    expect(c.tick).toBe(1234)
    expect(c.crc).toBe(0xdeadbeef)
  })

  it('round-trips relay checksum', () => {
    const c = decodeRelayChecksum(encodeRelayChecksum(3, 5678, 0x12345678))
    expect(c.player).toBe(3)
    expect(c.tick).toBe(5678)
    expect(c.crc).toBe(0x12345678)
  })

  it('crc32 matches the standard test vector', () => {
    const bytes = Uint8Array.from([0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39])
    expect(crc32(bytes)).toBe(0xcbf43926)
  })
})

describe('protocol: type ids are stable', () => {
  it('maps type names to ids in a fixed order', () => {
    expect(CMD_TYPE_IDS).toEqual({
      move: 0,
      'attack-move': 1,
      'keep-attack': 16,
      'guard': 17,
      stop: 2,
      place: 3,
      sell: 4,
      queue: 5,
      dequeue: 6,
      attack: 7,
      research: 8,
      build: 9,
      'set-spawn-point': 10,
      'assign-dock': 11,
      satellite: 12,
      laser: 13,
      'set-flag-point': 14,
      forfeit: 15,
      'max-power': 18,
      collect: 19,
      ping: 20,
      'reorder-queue': 21,
      grenade: 22,
      smoke: 23,
      'set-detector': 24,
      'set-stealth': 25,
    })
  })
})

describe('protocol: match start', () => {
  it('builds a valid match start message', () => {
    const map = generateDefaultMap()
    const msg = makeMatchStart(map, [{ id: 0, name: 'A', ready: true, host: true }], 0, 0, 999, 25)
    expect(msg.kind).toBe('S_MATCH_START')
    expect(msg.seed).toBe(999)
    expect(msg.tickRate).toBe(25)
    expect(msg.map.name).toBe('The Breach')
    expect(msg.yourId).toBe(0)
  })
})

describe('protocol: control message round-trip', () => {
  it('round-trips match chat', () => {
    const msg = { kind: 'C_CHAT', text: 'hello', target: 'team', team: 2 } as const
    expect(decodeControl(encodeControl(msg))).toEqual(msg)
  })

  it('round-trips a chat relay', () => {
    const msg = { kind: 'H_CHAT', from: 1, name: 'Alpha', text: 'hi', target: 'all', team: 0, ts: 1234 } as const
    expect(decodeControl(encodeControl(msg))).toEqual(msg)
  })

  it('round-trips a spectate sync with a command log', () => {
    const msg = {
      kind: 'S_SPECTATE_SYNC',
      currentTick: 40,
      log: [makeEnv('move'), makeEnv('place'), makeEnv('queue')],
    }
    const out = decodeControl(encodeControl(msg))
    expect(out.kind).toBe('S_SPECTATE_SYNC')
    if (out.kind === 'S_SPECTATE_SYNC') {
      expect(out.currentTick).toBe(40)
      expect(out.log.map((e) => e.cmd.type)).toEqual(['move', 'place', 'queue'])
    }
  })

  it('round-trips slot and room updates', () => {
    const slot = { kind: 'C_UPDATE_SLOT', name: 'Commander X', team: 2 }
    const room = { kind: 'C_UPDATE_ROOM', mapId: 'grand-arena', password: 'secret' }
    expect(decodeControl(encodeControl(slot))).toEqual(slot)
    expect(decodeControl(encodeControl(room))).toEqual(room)
  })

  it('round-trips game over reports', () => {
    const report = { kind: 'C_GAME_OVER', winner: 2 }
    const over = { kind: 'H_GAME_OVER', winner: 0 }
    expect(decodeControl(encodeControl(report))).toEqual(report)
    expect(decodeControl(encodeControl(over))).toEqual(over)
  })

  it('round-trips a lobby message with match options', () => {
    const msg = {
      kind: 'H_LOBBY',
      roomCode: 'ABCD',
      yourId: 0,
      hostId: 0,
      players: [{ id: 0, name: 'Host', ready: true, host: true, team: 0 }],
      maxPlayers: 4,
      mapName: 'Four Corners',
      mapId: 'four-corners',
      passwordRequired: true,
    }
    expect(decodeControl(encodeControl(msg))).toEqual(msg)
  })
})
