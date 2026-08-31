import { Terrain } from '@space-arenas/shared'

export interface WorldImportResult {
  width: number
  height: number
  tiles: number[]
  groundColors: string[]
}

const TILE_PX = 256
const MIN_ZOOM = 3
const MAX_ZOOM = 19

/** Esri World Imagery — free to use, sends CORS headers so tile pixels can be sampled. */
const tileSource = (z: number, x: number, y: number): string =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`

const latLonToWorld = (lat: number, lon: number, z: number): { x: number; y: number } => {
  const n = 1 << z
  const latRad = (lat * Math.PI) / 180
  const x = ((lon + 180) / 360) * n
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  return { x, y }
}

const worldToLatLon = (x: number, y: number, z: number): { lat: number; lon: number } => {
  const n = 1 << z
  const lon = (x / n) * 360 - 180
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI
  return { lat, lon }
}

const rgbToHex = (r: number, g: number, b: number): string =>
  `#${[r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('')}`

/** Turns a satellite pixel into a playable terrain type (drives passability/buildability). */
function classifyPixel(r: number, g: number, b: number): Terrain {
  if (b > r + 18 && b > g + 10 && b > 36) return Terrain.Water
  const avg = (r + g + b) / 3
  if (avg < 62) return Terrain.Cliff
  const sat = Math.max(r, g, b) - Math.min(r, g, b)
  if (g > r + 14 && g >= b) return Terrain.Ground
  if (sat < 26 && avg > 88) return Terrain.Road
  if (r > g && r > b && (avg > 118 || sat < 110)) return Terrain.BuildableGround
  return Terrain.Ground
}

export class WorldMapPanel {
  private readonly overlay: HTMLElement
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private readonly widthEl: HTMLInputElement
  private readonly heightEl: HTMLInputElement
  private readonly zoomEl: HTMLElement
  private readonly statusEl: HTMLElement
  private readonly onImport: (r: WorldImportResult) => void
  private lat = 25.2048
  private lon = 55.2708
  private zoom = 14
  private gridW = 32
  private gridH = 32
  private readonly images = new Map<string, HTMLImageElement>()
  private readonly pending = new Set<string>()
  private readonly data = new Map<string, ImageData>()
  private raf = 0
  private panning = false
  private last = { x: 0, y: 0 }
  private wantImport = false
  private disposed = false
  private readonly loadingText: string

  constructor(overlay: HTMLElement, opts: { onImport: (r: WorldImportResult) => void; loadingText: string }) {
    this.overlay = overlay
    this.onImport = opts.onImport
    this.loadingText = opts.loadingText
    this.canvas = overlay.querySelector<HTMLCanvasElement>('#mb-world-canvas')!
    this.ctx = this.canvas.getContext('2d')!
    this.widthEl = overlay.querySelector<HTMLInputElement>('#mb-world-w')!
    this.heightEl = overlay.querySelector<HTMLInputElement>('#mb-world-h')!
    this.zoomEl = overlay.querySelector<HTMLElement>('#mb-world-zoom')!
    this.statusEl = overlay.querySelector<HTMLElement>('#mb-world-status')!

    this.widthEl.addEventListener('input', () => {
      this.gridW = this.clampDim(this.widthEl.value)
      this.gridH = this.clampDim(this.heightEl.value)
    })
    this.heightEl.addEventListener('input', () => {
      this.gridH = this.clampDim(this.heightEl.value)
      this.gridW = this.clampDim(this.widthEl.value)
    })

    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return
      this.panning = true
      this.last = { x: e.clientX, y: e.clientY }
    })
    window.addEventListener('mousemove', this.onMove)
    window.addEventListener('mouseup', this.onUp)
    this.canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault()
        this.onWheel(e)
      },
      { passive: false },
    )
  }

  private clampDim(v: string): number {
    return Math.max(16, Math.min(256, Math.round(Number(v)) || 32))
  }

  private readonly onMove = (e: MouseEvent): void => {
    if (!this.panning || this.disposed) return
    const dx = e.clientX - this.last.x
    const dy = e.clientY - this.last.y
    this.last = { x: e.clientX, y: e.clientY }
    const wc = latLonToWorld(this.lat, this.lon, this.zoom)
    wc.x -= dx / TILE_PX
    wc.y -= dy / TILE_PX
    const ll = worldToLatLon(wc.x, wc.y, this.zoom)
    this.lat = ll.lat
    this.lon = ll.lon
  }

  private readonly onUp = (): void => {
    this.panning = false
  }

  private onWheel(e: WheelEvent): void {
    const rect = this.canvas.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    const before = latLonToWorld(this.lat, this.lon, this.zoom)
    const targetWx = before.x + (px - this.canvas.width / 2) / TILE_PX
    const targetWy = before.y + (py - this.canvas.height / 2) / TILE_PX
    const ll = worldToLatLon(targetWx, targetWy, this.zoom)
    this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.zoom + (e.deltaY < 0 ? 1 : -1)))
    const wc = latLonToWorld(ll.lat, ll.lon, this.zoom)
    wc.x -= (px - this.canvas.width / 2) / TILE_PX
    wc.y -= (py - this.canvas.height / 2) / TILE_PX
    const center = worldToLatLon(wc.x, wc.y, this.zoom)
    this.lat = center.lat
    this.lon = center.lon
  }

  private selectionRect(): { left: number; top: number; w: number; h: number } {
    const W = this.canvas.width
    const H = this.canvas.height
    const margin = 24
    const availW = W - margin * 2
    const availH = H - margin * 2
    const scale = Math.min(availW / this.gridW, availH / this.gridH)
    const w = this.gridW * scale
    const h = this.gridH * scale
    return { left: (W - w) / 2, top: (H - h) / 2, w, h }
  }

  private cellToWorld(wc: { x: number; y: number }, i: number, j: number): { x: number; y: number } {
    const r = this.selectionRect()
    const px = r.left + (i + 0.5) * (r.w / this.gridW)
    const py = r.top + (j + 0.5) * (r.h / this.gridH)
    return {
      x: wc.x + (px - this.canvas.width / 2) / TILE_PX,
      y: wc.y + (py - this.canvas.height / 2) / TILE_PX,
    }
  }

  private drawTile(ctx: CanvasRenderingContext2D, z: number, tx: number, ty: number, wc: { x: number; y: number }): void {
    const key = `${z}/${tx}/${ty}`
    let img = this.images.get(key)
    if (!img && !this.pending.has(key)) {
      img = new Image()
      img.crossOrigin = 'anonymous'
      this.pending.add(key)
      img.onload = (): void => this.onTileLoaded()
      img.onerror = (): void => {
        this.pending.delete(key)
        this.onTileLoaded()
      }
      img.src = tileSource(z, tx, ty)
      this.images.set(key, img)
    }
    if (img && img.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, (tx - wc.x) * TILE_PX + this.canvas.width / 2, (ty - wc.y) * TILE_PX + this.canvas.height / 2, TILE_PX, TILE_PX)
    }
  }

  private onTileLoaded(): void {
    if (this.disposed) return
    if (this.wantImport) this.tryImport()
  }

  private tileData(z: number, tx: number, ty: number): ImageData | null {
    const key = `${z}/${tx}/${ty}`
    let d = this.data.get(key)
    if (d) return d
    const img = this.images.get(key)
    if (!img || !img.complete || img.naturalWidth === 0) return null
    const c = document.createElement('canvas')
    c.width = TILE_PX
    c.height = TILE_PX
    const g = c.getContext('2d')!
    g.drawImage(img, 0, 0, TILE_PX, TILE_PX)
    d = g.getImageData(0, 0, TILE_PX, TILE_PX)
    this.data.set(key, d)
    return d
  }

  private tryImport(): void {
    const z = this.zoom
    const wc = latLonToWorld(this.lat, this.lon, z)
    const missing: string[] = []
    for (let j = 0; j < this.gridH; j++) {
      for (let i = 0; i < this.gridW; i++) {
        const p = this.cellToWorld(wc, i, j)
        const key = `${z}/${Math.floor(p.x)}/${Math.floor(p.y)}`
        const img = this.images.get(key)
        if (!img || !img.complete || img.naturalWidth === 0) missing.push(key)
      }
    }
    if (missing.length > 0) {
      this.statusEl.textContent = this.loadingText
      return
    }
    this.statusEl.textContent = ''
    this.wantImport = false

    const tiles: number[] = []
    const groundColors: string[] = []
    for (let j = 0; j < this.gridH; j++) {
      for (let i = 0; i < this.gridW; i++) {
        const p = this.cellToWorld(wc, i, j)
        const tx = Math.floor(p.x)
        const ty = Math.floor(p.y)
        const d = this.tileData(z, tx, ty)
        if (!d) {
          this.wantImport = true
          this.statusEl.textContent = this.loadingText
          return
        }
        const u = Math.max(0, Math.min(TILE_PX - 1, Math.floor((p.x - tx) * TILE_PX)))
        const v = Math.max(0, Math.min(TILE_PX - 1, Math.floor((p.y - ty) * TILE_PX)))
        const o = (v * TILE_PX + u) * 4
        const r = d.data[o]
        const g = d.data[o + 1]
        const b = d.data[o + 2]
        tiles.push(classifyPixel(r, g, b))
        groundColors.push(rgbToHex(r, g, b))
      }
    }
    this.onImport({ width: this.gridW, height: this.gridH, tiles, groundColors })
  }

  onImportRequested(): void {
    this.wantImport = true
    this.data.clear()
    this.tryImport()
  }

  open(): void {
    this.disposed = false
    const canvas = this.canvas
    canvas.width = Math.max(480, Math.ceil(canvas.clientWidth || this.overlay.clientWidth || 800))
    canvas.height = Math.max(360, Math.ceil(canvas.clientHeight || this.overlay.clientHeight || 600))
    this.gridW = this.clampDim(this.widthEl.value)
    this.gridH = this.clampDim(this.heightEl.value)
    this.statusEl.textContent = ''
    this.loop()
  }

  private loop(): void {
    if (this.disposed) return
    const ctx = this.ctx
    const W = this.canvas.width
    const H = this.canvas.height
    ctx.fillStyle = '#0b0e14'
    ctx.fillRect(0, 0, W, H)
    const wc = latLonToWorld(this.lat, this.lon, this.zoom)
    const t0x = Math.floor((wc.x * TILE_PX - W / 2) / TILE_PX)
    const t1x = Math.ceil((wc.x * TILE_PX + W / 2) / TILE_PX)
    const t0y = Math.floor((wc.y * TILE_PX - H / 2) / TILE_PX)
    const t1y = Math.ceil((wc.y * TILE_PX + H / 2) / TILE_PX)
    for (let ty = t0y; ty <= t1y; ty++) {
      for (let tx = t0x; tx <= t1x; tx++) {
        this.drawTile(ctx, this.zoom, tx, ty, wc)
      }
    }
    const r = this.selectionRect()
    ctx.fillStyle = 'rgba(88,224,122,0.16)'
    ctx.fillRect(r.left, r.top, r.w, r.h)
    ctx.strokeStyle = '#58e07a'
    ctx.lineWidth = 2
    ctx.strokeRect(r.left, r.top, r.w, r.h)
    ctx.fillStyle = '#dfe6f2'
    ctx.font = '13px monospace'
    ctx.fillText(`{${this.gridW}×${this.gridH}}`, r.left, r.top - 8)
    this.zoomEl.textContent = String(this.zoom)
    this.raf = requestAnimationFrame(() => this.loop())
  }

  dispose(): void {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    window.removeEventListener('mousemove', this.onMove)
    window.removeEventListener('mouseup', this.onUp)
  }
}