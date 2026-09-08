import { Terrain, type MapData, tileIndex, applyBrightness, type PingType } from '@space-arenas/shared'
import type { World, PingComp } from '../core/world.ts'
import { PING_TICKS } from '../core/world.ts'
import type { Camera } from './camera.ts'

const TERRAIN_COLORS: Record<number, string> = {
  [Terrain.Ground]: '#3a442f',
  [Terrain.Cliff]: '#5c5140',
  [Terrain.Water]: '#2c5877',
  [Terrain.Road]: '#454b4f',
  [Terrain.BuildableGround]: '#424d35',
}

const HIDDEN_BG = '#0b0e15'
const FOG_DARK = 'rgba(0,0,0,0.45)'
const FOG_LIGHT = 'rgba(0,0,0,0.22)'

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

export const PING_COLORS: Record<PingType, string> = {
  alert: '#ff5c5c',
  assist: '#ffd45e',
  'on-my-way': '#7cf27c',
}

export class Minimap {
  readonly canvas = document.createElement('canvas')
  readonly viewport = document.createElement('canvas')
  private ctx: CanvasRenderingContext2D
  private vctx: CanvasRenderingContext2D
  private fogCanvas: HTMLCanvasElement
  private fctx: CanvasRenderingContext2D
  private prevFog: Uint8Array | null = null
  private map: MapData
  private ratio: number
  private base: HTMLCanvasElement | null = null
  private zoom = 1
  private offsetX = 0
  private offsetY = 0
  displayScale = 1
  private lastTick = -1
  private lastRadar = false
  private lastReveal = false
  private lastRe = 0
  private lastOx = NaN
  private lastOy = NaN
  private flashes: Array<{ x: number; y: number; started: number; team: number }> = []

  constructor(map: MapData, sizeFactor = 1) {
    this.map = map
    this.ratio = Math.min((220 * sizeFactor) / map.width, (160 * sizeFactor) / map.height)
    this.canvas.width = Math.ceil(map.width * this.ratio)
    this.canvas.height = Math.ceil(map.height * this.ratio)
    this.ctx = this.canvas.getContext('2d')!
    this.viewport.width = this.canvas.width
    this.viewport.height = this.canvas.height
    this.viewport.style.pointerEvents = 'none'
    this.vctx = this.viewport.getContext('2d')!
    this.fogCanvas = document.createElement('canvas')
    this.fogCanvas.width = map.width
    this.fogCanvas.height = map.height
    this.fctx = this.fogCanvas.getContext('2d')!
    this.clampOffsets()
  }

  private get ratioEff(): number {
    return this.ratio * this.zoom
  }

  get bounds(): { x: number; y: number; w: number; h: number } {
    return { x: 0, y: 0, w: this.canvas.width, h: this.canvas.height }
  }

  toTile(px: number, py: number): { x: number; y: number } {
    const x = Math.floor((px / this.displayScale - this.offsetX) / this.ratioEff)
    const y = Math.floor((py / this.displayScale - this.offsetY) / this.ratioEff)
    return { x: clamp(x, 0, this.map.width - 1), y: clamp(y, 0, this.map.height - 1) }
  }

  zoomBy(factor: number, mx: number, my: number): void {
    const tx = (mx / this.displayScale - this.offsetX) / this.ratioEff
    const ty = (my / this.displayScale - this.offsetY) / this.ratioEff
    this.zoom = clamp(this.zoom * factor, 0.6, 4)
    this.offsetX = mx / this.displayScale - tx * this.ratioEff
    this.offsetY = my / this.displayScale - ty * this.ratioEff
    this.clampOffsets()
  }

  setDisplayScale(scale: number): void {
    this.displayScale = Math.max(1, scale)
    this.canvas.style.width = `${Math.ceil(this.canvas.width * this.displayScale)}px`
    this.canvas.style.height = `${Math.ceil(this.canvas.height * this.displayScale)}px`
    this.viewport.style.width = this.canvas.style.width
    this.viewport.style.height = this.canvas.style.height
  }

  panBy(dx: number, dy: number): void {
    this.offsetX += dx
    this.offsetY += dy
    this.clampOffsets()
  }

  /** Start a pulsing alert flash for a building being attacked. `startTick` is the world tick it began. */
  flashBuilding(startTick: number, team: number, x: number, y: number): void {
    this.flashes.push({ x, y, started: startTick, team })
  }

  private clampOffsets(): void {
    const w = this.canvas.width
    const h = this.canvas.height
    const dw = this.map.width * this.ratioEff
    const dh = this.map.height * this.ratioEff
    this.offsetX = dw <= w ? (w - dw) / 2 : clamp(this.offsetX, w - dw, 0)
    this.offsetY = dh <= h ? (h - dh) / 2 : clamp(this.offsetY, h - dh, 0)
  }

  private baseCanvas(): HTMLCanvasElement {
    if (this.base) return this.base
    const c = document.createElement('canvas')
    c.width = this.canvas.width
    c.height = this.canvas.height
    const g = c.getContext('2d')!
    const m = this.map
    const bright = m.brightness ?? 0
    for (let y = 0; y < m.height; y++) {
      for (let x = 0; x < m.width; x++) {
        const t = m.tiles[tileIndex(m, x, y)]
        const override = m.groundColors?.[tileIndex(m, x, y)]
        g.fillStyle = applyBrightness(override && override.length > 0 ? override : (TERRAIN_COLORS[t] ?? '#000'), bright)
        g.fillRect(x * this.ratio, y * this.ratio, Math.ceil(this.ratio), Math.ceil(this.ratio))
      }
    }
    this.base = c
    return c
  }

  private updateFog(world: World, localTeam: number): void {
    const fog = world.fog.get(localTeam)
    if (!fog) return
    const m = this.map
    const g = this.fctx
    const pf = this.prevFog
    if (!pf) {
      this.prevFog = fog.slice()
      for (let y = 0; y < m.height; y++) {
        for (let x = 0; x < m.width; x++) {
          const v = fog[tileIndex(m, x, y)]
          if (v === 1) {
            g.fillStyle = FOG_LIGHT
            g.fillRect(x, y, 1, 1)
          } else if (v === 0) {
            g.fillStyle = FOG_DARK
            g.fillRect(x, y, 1, 1)
          }
        }
      }
      return
    }
    for (let y = 0; y < m.height; y++) {
      for (let x = 0; x < m.width; x++) {
        const i = tileIndex(m, x, y)
        const v = fog[i]
        if (v === pf[i]) continue
        pf[i] = v
        g.clearRect(x, y, 1, 1)
        if (v === 1) {
          g.fillStyle = FOG_LIGHT
          g.fillRect(x, y, 1, 1)
        } else if (v === 0) {
          g.fillStyle = FOG_DARK
          g.fillRect(x, y, 1, 1)
        }
      }
    }
  }

  draw(world: World, localTeam: number, camera: Camera, radar: boolean, revealAll = false): void {
    const ctx = this.ctx
    const re = this.ratioEff
    const { offsetX, offsetY } = this
    const dirty = world.tick !== this.lastTick || radar !== this.lastRadar || revealAll !== this.lastReveal || re !== this.lastRe || offsetX !== this.lastOx || offsetY !== this.lastOy
    if (!radar && !revealAll) {
      if (dirty) {
        this.lastTick = world.tick
        this.lastRadar = radar
        this.lastReveal = revealAll
        this.lastRe = re
        this.lastOx = offsetX
        this.lastOy = offsetY
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
        ctx.fillStyle = HIDDEN_BG
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
        ctx.fillStyle = '#5a6a8a'
        ctx.font = 'bold 11px monospace'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('CONNECT RADAR', this.canvas.width / 2, this.canvas.height / 2)
      }
      this.vctx.clearRect(0, 0, this.viewport.width, this.viewport.height)
      return
    }
    if (dirty) {
      this.lastTick = world.tick
      this.lastRadar = radar
      this.lastReveal = revealAll
      this.lastRe = re
      this.lastOx = offsetX
      this.lastOy = offsetY
      this.updateFog(world, localTeam)
      ctx.save()
      ctx.beginPath()
      ctx.rect(0, 0, this.canvas.width, this.canvas.height)
      ctx.clip()
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
      const base = this.baseCanvas()
      ctx.drawImage(base, offsetX, offsetY, base.width * this.zoom, base.height * this.zoom)
      const m = this.map
      ctx.drawImage(this.fogCanvas, offsetX, offsetY, m.width * re, m.height * re)
      world.units.forEach((id, u) => {
        if (!world.isVisibleTo(localTeam, id, revealAll)) return
        const t = world.transforms.require(id)
        ctx.fillStyle = u.team === localTeam ? '#7cf27c' : '#f07c7c'
        ctx.fillRect((t.x / 1000) * re + offsetX - 1, (t.y / 1000) * re + offsetY - 1, 2, 2)
      })
      world.buildings.forEach((id) => {
        if (!world.isVisibleTo(localTeam, id, revealAll)) return
        const t = world.transforms.require(id)
        ctx.fillStyle = '#ffffff'
        ctx.fillRect((t.x / 1000) * re + offsetX - 1, (t.y / 1000) * re + offsetY - 1, 3, 3)
      })
      ctx.restore()
    }
    this.drawViewport(camera, re, offsetX, offsetY)
    this.drawFlashes(world, re, offsetX, offsetY)
    this.drawPings(world, localTeam, re, offsetX, offsetY)
  }

  /** Draw decaying pulse rings at recently-attacked buildings. */
  private drawFlashes(world: World, re: number, offsetX: number, offsetY: number): void {
    if (this.flashes.length === 0) return
    const ctx = this.vctx
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i]
      const age = world.tick - f.started
      if (age > 30) {
        this.flashes.splice(i, 1)
        continue
      }
      const a = 1 - age / 30
      ctx.strokeStyle = `rgba(255,80,80,${a.toFixed(2)})`
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc((f.x / 1000) * re + offsetX, (f.y / 1000) * re + offsetY, 3 + age * 0.2, 0, Math.PI * 2)
      ctx.stroke()
    }
  }

  /** Draw expanding, fading ping markers — only for the local team's alliance. */
  private drawPings(world: World, localTeam: number, re: number, offsetX: number, offsetY: number): void {
    if (localTeam < 0 || world.pings.length === 0) return
    const ctx = this.vctx
    const myAlliance = world.allianceOf(localTeam)
    for (const p of world.pings) {
      if (world.allianceOf(p.team) !== myAlliance) continue
      this.drawPing(ctx, world, p, re, offsetX, offsetY)
    }
  }

  private drawPing(ctx: CanvasRenderingContext2D, world: World, p: PingComp, re: number, offsetX: number, offsetY: number): void {
    const age = world.tick - p.started
    if (age >= PING_TICKS) return
    const a = 1 - age / PING_TICKS
    const x = p.x * re + offsetX
    const y = p.y * re + offsetY
    ctx.strokeStyle = PING_COLORS[p.type]
    ctx.globalAlpha = Math.max(a, 0.25)
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(x, y, 2 + age * 0.1, 0, Math.PI * 2)
    ctx.stroke()
    ctx.globalAlpha = Math.max(a * 0.9, 0.3)
    ctx.beginPath()
    ctx.arc(x, y, 0.8, 0, Math.PI * 2)
    ctx.fillStyle = PING_COLORS[p.type]
    ctx.fill()
    ctx.globalAlpha = 1
  }

  private drawViewport(camera: Camera, re: number, offsetX: number, offsetY: number): void {
    const corners = [
      camera.screenToWorld(0, 0),
      camera.screenToWorld(camera.viewWidth, 0),
      camera.screenToWorld(0, camera.viewHeight),
      camera.screenToWorld(camera.viewWidth, camera.viewHeight),
    ]
    let minTx = Infinity
    let minTy = Infinity
    let maxTx = -Infinity
    let maxTy = -Infinity
    for (const c of corners) {
      const tx = Math.floor(c.x / 1000)
      const ty = Math.floor(c.y / 1000)
      if (tx < minTx) minTx = tx
      if (ty < minTy) minTy = ty
      if (tx > maxTx) maxTx = tx
      if (ty > maxTy) maxTy = ty
    }
    const ctx = this.vctx
    ctx.clearRect(0, 0, this.viewport.width, this.viewport.height)
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 1
    ctx.strokeRect(minTx * re + offsetX, minTy * re + offsetY, (maxTx - minTx + 1) * re, (maxTy - minTy + 1) * re)
  }
}
