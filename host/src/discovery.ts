import dgram from 'node:dgram'
import os from 'node:os'

export interface RoomInfo {
  roomCode: string | null
  started: boolean
  playerCount: number
  maxPlayers: number
  passwordRequired: boolean
}

export interface PeerInfo {
  name: string
  ip: string
  port: number
  roomCode: string | null
  started: boolean
  playerCount: number
  maxPlayers: number
  passwordRequired: boolean
  lastSeen: number
}

interface BeaconPayload {
  app: string
  name: string
  port: number
  roomCode: string | null
  started: boolean
  playerCount: number
  maxPlayers: number
  passwordRequired: boolean
}

export const APP_TAG = 'space-arenas'
export const DEFAULT_BEACON_PORT = 17322

export const lanIps = (): string[] => {
  const out: string[] = []
  for (const list of Object.values(os.networkInterfaces())) {
    for (const iface of list ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) out.push(iface.address)
    }
  }
  return out
}

export const firstLanIp = (): string => lanIps()[0] ?? '127.0.0.1'

const broadcastAddresses = (): string[] => {
  const out: string[] = ['255.255.255.255']
  for (const list of Object.values(os.networkInterfaces())) {
    for (const iface of list ?? []) {
      if (iface.family !== 'IPv4' || iface.internal) continue
      const ipParts = iface.address.split('.').map(Number)
      const maskParts = iface.netmask.split('.').map(Number)
      const bcast = ipParts.map((part, i) => (part | (~maskParts[i] & 0xff)) & 0xff)
      out.push(bcast.join('.'))
    }
  }
  return [...new Set(out)]
}

export class LanDiscovery {
  private socket: dgram.Socket | null = null
  private readonly peers = new Map<string, PeerInfo>()
  private timer: NodeJS.Timeout | null = null
  private beaconPort = DEFAULT_BEACON_PORT
  private readonly maxAgeMs = 8000

  constructor(
    private readonly getName: () => string,
    private readonly getPort: () => number,
    private readonly getRoomInfo: () => RoomInfo,
  ) {}

  start(beaconPort: number): void {
    this.beaconPort = beaconPort
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    this.socket = socket
    socket.on('error', (err) => {
      console.log(`[space-arenas host] LAN discovery disabled: ${err.message}`)
    })
    socket.on('message', (msg, rinfo) => {
      const peer = this.parseBeacon(msg.toString())
      if (!peer) return
      peer.ip = rinfo.address
      this.remember(peer)
      if (!lanIps().includes(rinfo.address)) this.sendBeacon(socket, rinfo.address)
    })
    socket.bind(beaconPort, () => {
      socket.setBroadcast(true)
      this.timer = setInterval(() => this.sendBeacon(socket), 2000)
      this.sendBeacon(socket)
      console.log(`[space-arenas host] LAN discovery on UDP ${beaconPort}`)
    })
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.socket?.close()
    this.socket = null
  }

  list(): PeerInfo[] {
    const now = Date.now()
    for (const [key, peer] of this.peers) {
      if (now - peer.lastSeen > this.maxAgeMs) this.peers.delete(key)
    }
    return [...this.peers.values()]
  }

  private remember(peer: PeerInfo): void {
    const key = `${peer.ip}:${peer.port}`
    peer.lastSeen = Date.now()
    if (!this.peers.has(key)) console.log(`[space-arenas host] discovered ${peer.name} @ ${peer.ip}:${peer.port}`)
    this.peers.set(key, peer)
  }

  private beaconPayload(): BeaconPayload {
    const r = this.getRoomInfo()
    return {
      app: APP_TAG,
      name: this.getName(),
      port: this.getPort(),
      roomCode: r.roomCode,
      started: r.started,
      playerCount: r.playerCount,
      maxPlayers: r.maxPlayers,
      passwordRequired: r.passwordRequired,
    }
  }

  private parseBeacon(text: string): PeerInfo | null {
    try {
      const b = JSON.parse(text) as BeaconPayload
      if (b.app !== APP_TAG) return null
      return {
        name: b.name,
        ip: '',
        port: b.port,
        roomCode: b.roomCode,
        started: b.started,
        playerCount: b.playerCount,
        maxPlayers: b.maxPlayers,
        passwordRequired: b.passwordRequired,
        lastSeen: Date.now(),
      }
    } catch {
      return null
    }
  }

  private sendBeacon(socket: dgram.Socket, target?: string): void {
    const payload = Buffer.from(JSON.stringify(this.beaconPayload()))
    if (target) {
      socket.send(payload, this.beaconPort, target)
      return
    }
    for (const addr of broadcastAddresses()) {
      try {
        socket.send(payload, this.beaconPort, addr)
      } catch {
        /* one unreachable interface must not break the loop */
      }
    }
  }
}
