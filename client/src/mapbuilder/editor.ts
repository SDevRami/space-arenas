import { DEFAULT_MAX_PLAYERS, Terrain, applyBrightness, clampMapSize, createEmptyMap, tileIndex, type MapData, type Obstruction } from '@space-arenas/shared'

export const TERRAIN_COLORS: Record<number, string> = {
  [Terrain.Ground]: '#39422f',
  [Terrain.Cliff]: '#6a5c4a',
  [Terrain.Water]: '#2c5877',
  [Terrain.Road]: '#454b4f',
  [Terrain.BuildableGround]: '#424d35',
}

const TEAM_COLORS = ['#7cf27c', '#f07c7c', '#7cc6f2', '#f2d27c', '#d27cf2']

export type ToolKind = 'paint' | 'spawn' | 'supply' | 'oil' | 'fill' | 'erase' | 'obstruction'

export interface EditorCallbacks {
  onDirtyChange: (dirty: boolean) => void
}

export const FIXED_SUPPLY_SIZE = 4
export const FIXED_OIL_RADIUS = 2

type Cell = { x: number; y: number }

/** Supply/square footprints are stored with an optional w/h; f.x/f.y is the CENTER (gameplay). */
export const supplyRect = (f: MapData['supplyFields'][number]): { x: number; y: number; w: number; h: number } => {
  const w = f.w ?? f.radius * 2
  const h = f.h ?? f.radius * 2
  return { x: f.x - Math.floor(w / 2), y: f.y - Math.floor(h / 2), w, h }
}

/** Oil square in tile coordinates, centered on the field's (x, y). */
export const oilSquare = (o: { x: number; y: number; radius: number }): { x: number; y: number; w: number; h: number } => {
  return { x: o.x - o.radius, y: o.y - o.radius, w: o.radius * 2, h: o.radius * 2 }
}

const cloneMap = (m: MapData): MapData => JSON.parse(JSON.stringify(m)) as MapData

const TILE = 8

export class MapBuilderEditor {
  private readonly el: HTMLDivElement
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private map: MapData
  private original: string
  private brush: Terrain = Terrain.Ground
  private customColor: string | null = null
  private tool: ToolKind = 'paint'
  private brushSize = 1
  private objectKind: Obstruction['type'] = 'rock'
  private brightness = 0
  private zoom = 6
  private minZoom = 1
  private maxZoom = 24
  private cam = { x: 0, y: 0 }
  private painting = false
  private panning = false
  private lastPan = { x: 0, y: 0 }
  private spawnCounter = 0
  private raf = 0
  private pointer = { x: -1, y: -1 }
  dirty = false
  private readonly cb: EditorCallbacks
  private ro: ResizeObserver | null = null
  private readonly onWinMove = (e: MouseEvent): void => this.onMove(e)
  private readonly onWinUp = (e: MouseEvent): void => this.onUp(e)
  private readonly onWinResize = (): void => {
    const wrap = this.el
    const body = wrap.parentElement
    this.canvas.width = Math.max(320, Math.ceil(wrap.clientWidth || body?.clientWidth || 1000))
    this.canvas.height = Math.max(320, Math.ceil(wrap.clientHeight || body?.clientHeight || 600))
    this.updateZoomBounds()
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom))
  }

  constructor(root: HTMLElement, cb: EditorCallbacks) {
    this.cb = cb
    this.el = root as HTMLDivElement
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'mb-canvas'
    this.ctx = this.canvas.getContext('2d')!
    this.canvas.addEventListener('mousedown', (e) => this.onDown(e))
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault())
    this.el.appendChild(this.canvas)

    this.onWinResize()
    window.addEventListener('resize', this.onWinResize)
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.onWinResize())
      this.ro.observe(this.el)
    }

    this.map = createEmptyMap(128, 128)
    this.map.name = 'New Map'
    this.original = JSON.stringify(this.map)
    this.centerOnMap()

    window.addEventListener('mousemove', this.onWinMove)
    window.addEventListener('mouseup', this.onWinUp)
    this.canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault()
        this.onWheel(e)
      },
      { passive: false },
    )

    this.loop()
  }

  get currentMap(): MapData {
    return cloneMap(this.map)
  }

  open(map: MapData): void {
    this.map = cloneMap(map)
    this.ensureGroundColors()
    this.brightness = map.brightness ?? 0
    this.original = JSON.stringify(this.map)
    this.spawnCounter = map.spawnPoints.length % DEFAULT_MAX_PLAYERS
    this.dirty = false
    this.centerOnMap()
    this.cb.onDirtyChange(false)
  }

  /** Zoom bounds derived from map size: out = whole map visible, in = one tile fills the view. */
  private updateZoomBounds(): void {
    const m = this.map
    if (!m || this.canvas.width === 0) return
    const fitX = this.canvas.width / (m.width * TILE)
    const fitY = this.canvas.height / (m.height * TILE)
    this.minZoom = Math.max(0.05, Math.min(fitX, fitY))
    this.maxZoom = Math.max(24, this.minZoom * 4)
  }

  /** Frames the whole map, centered, at the fit-for-size zoom. */
  private centerOnMap(): void {
    this.updateZoomBounds()
    this.zoom = this.minZoom
    const cell = TILE * this.zoom
    this.cam = {
      x: (this.canvas.width - this.map.width * cell) / 2,
      y: (this.canvas.height - this.map.height * cell) / 2,
    }
  }

  private setDirty(): void {
    this.dirty = JSON.stringify(this.map) !== this.original
    this.cb.onDirtyChange(this.dirty)
  }

  private screenToTile(px: number, py: number): { x: number; y: number } {
    const cell = TILE * this.zoom
    return { x: Math.floor((px - this.cam.x) / cell), y: Math.floor((py - this.cam.y) / cell) }
  }

  /** Maps a client-space point into canvas buffer pixels, cancelling any CSS scaling of the canvas. */
  private toCanvas(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect()
    const sx = rect.width > 0 ? this.canvas.width / rect.width : 1
    const sy = rect.height > 0 ? this.canvas.height / rect.height : 1
    return { x: (clientX - rect.left) * sx, y: (clientY - rect.top) * sy }
  }

  private viewBounds(): { x0: number; y0: number; x1: number; y1: number } {
    const cell = TILE * this.zoom
    return {
      x0: Math.floor(-this.cam.x / cell),
      y0: Math.floor(-this.cam.y / cell),
      x1: Math.ceil((this.canvas.width - this.cam.x) / cell),
      y1: Math.ceil((this.canvas.height - this.cam.y) / cell),
    }
  }

  setBrush(b: Terrain): void {
    this.brush = b
    this.customColor = null
  }

  /** Paints with a free custom color (hex) on Ground terrain; null restores the terrain palette. */
  setBrushColor(hex: string | null): void {
    this.customColor = hex && hex.length > 0 ? hex : null
    if (this.customColor) this.brush = Terrain.Ground
  }

  setTool(t: ToolKind): void {
    this.tool = t
  }

  setObjectKind(t: Obstruction['type']): void {
    this.objectKind = t
  }

  setBrightness(b: number): void {
    this.map.brightness = Math.max(-10, Math.min(10, Math.round(b)))
    this.brightness = this.map.brightness
    this.setDirty()
  }

  setBrushSize(n: number): void {
    this.brushSize = Math.max(1, Math.min(8, Math.round(n)))
  }

  /** Cells covered by the brush footprint centered on (tx, ty). Size 1 is always a 1x1 square. */
  private brushCells(tx: number, ty: number): Cell[] {
    const s = this.brushSize
    const half = Math.floor(s / 2)
    const start = -half + (s % 2 === 0 ? 1 : 0)
    const end = half
    const out: Cell[] = []
    for (let dy = start; dy <= end; dy++) {
      for (let dx = start; dx <= end; dx++) {
        out.push({ x: tx + dx, y: ty + dy })
      }
    }
    return out
  }

  /** Ensures the per-tile color override array exists and matches the current map size. */
  private ensureGroundColors(): void {
    const m = this.map
    const len = m.width * m.height
    if (!m.groundColors || m.groundColors.length !== len) {
      m.groundColors = new Array<string>(len).fill('')
    }
  }

  private tileColor(t: number, i: number): string {
    const c = this.map.groundColors?.[i]
    return c && c.length > 0 ? c : (TERRAIN_COLORS[t] ?? '#000')
  }

  /** Resizes the map: copies the overlapping tile region, drops out-of-bounds objects. */
  resize(w: number, h: number): void {
    w = clampMapSize(w)
    h = clampMapSize(h)
    const m = this.map
    if (w === m.width && h === m.height) {
      this.setDirty()
      return
    }
    const tiles = new Array<number>(w * h).fill(Terrain.Ground)
    const colors = new Array<string>(w * h).fill('')
    const copyW = Math.min(w, m.width)
    const copyH = Math.min(h, m.height)
    const srcColors = m.groundColors ?? []
    for (let y = 0; y < copyH; y++) {
      for (let x = 0; x < copyW; x++) {
        tiles[y * w + x] = m.tiles[y * m.width + x]
        colors[y * w + x] = srcColors[y * m.width + x] ?? ''
      }
    }
    m.tiles = tiles
    m.groundColors = colors
    m.width = w
    m.height = h
    m.spawnPoints = m.spawnPoints
      .filter((s) => s.x + 3 <= w && s.y + 3 <= h)
      .map((s, i) => ({ ...s, team: i }))
    m.supplyFields = m.supplyFields.filter((f) => {
      const r = supplyRect(f)
      return r.x >= 0 && r.y >= 0 && r.x + r.w <= w && r.y + r.h <= h
    })
    m.oilFields = (m.oilFields ?? []).filter((o) => o.x + o.radius <= w && o.y + o.radius <= h && o.x - o.radius >= -1 && o.y - o.radius >= -1)
    m.obstructions = m.obstructions.filter((o) => o.x + o.w <= w && o.y + o.h <= h)
    this.spawnCounter = m.spawnPoints.length % DEFAULT_MAX_PLAYERS
    this.centerOnMap()
    this.setDirty()
  }

  /** Applies map metadata mid-edit without treating it as the reset point. */
  applyInfo(info: { name?: string; description?: string; variant?: string }): void {
    if (info.name !== undefined) this.map.name = info.name.trim() || this.map.name
    if (info.description !== undefined) this.map.description = info.description
    if (info.variant !== undefined) this.map.mapVersion = info.variant.trim()
    this.setDirty()
  }

  /** Clears all changes: new maps return to empty, edits return to the opened/saved version. */
  reset(): void {
    this.map = JSON.parse(this.original) as MapData
    this.spawnCounter = this.map.spawnPoints.length % DEFAULT_MAX_PLAYERS
    this.setDirty()
  }

  /** Replaces the whole grid with an auto-drawn world import; clears all placed objects. */
  importWorld(tiles: number[], groundColors: string[], w: number, h: number): void {
    const m = this.map
    m.width = clampMapSize(w)
    m.height = clampMapSize(h)
    m.tiles = tiles
    m.groundColors = groundColors.slice()
    m.spawnPoints = []
    m.supplyFields = []
    m.oilFields = []
    m.obstructions = []
    this.spawnCounter = 0
    this.centerOnMap()
    this.setDirty()
  }

  paintTerrainAt(tx: number, ty: number): void {
    const m = this.map
    this.ensureGroundColors()
    for (const c of this.brushCells(tx, ty)) {
      if (c.x < 0 || c.y < 0 || c.x >= m.width || c.y >= m.height) continue
      const i = tileIndex(m, c.x, c.y)
      m.tiles[i] = this.brush
      m.groundColors![i] = this.customColor ?? ''
    }
    this.setDirty()
  }

  /** Flood fill: repaints the contiguous same-colour region at (tx, ty), bounded by other colours. */
  fillAt(tx: number, ty: number): void {
    const m = this.map
    if (tx < 0 || ty < 0 || tx >= m.width || ty >= m.height) return
    const source = m.tiles[tileIndex(m, tx, ty)]
    if (source === this.brush) return
    this.ensureGroundColors()
    const stack: Cell[] = [{ x: tx, y: ty }]
    while (stack.length > 0) {
      const { x, y } = stack.pop()!
      if (x < 0 || y < 0 || x >= m.width || y >= m.height) continue
      const i = tileIndex(m, x, y)
      if (m.tiles[i] !== source) continue
      m.tiles[i] = this.brush
      m.groundColors![i] = this.customColor ?? ''
      stack.push({ x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 })
    }
    this.setDirty()
  }

  /** Removes spawns / supply / oil / obstructions whose footprint intersects the brush footprint. */
  eraseAt(tx: number, ty: number): void {
    const m = this.map
    const isIn = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < m.width && y < m.height
    const cells = this.brushCells(tx, ty).filter((c) => isIn(c.x, c.y))
    if (cells.length === 0) return
    const before = m.spawnPoints.length + m.supplyFields.length + (m.oilFields?.length ?? 0) + m.obstructions.length
    for (const c of cells) {
      m.spawnPoints = m.spawnPoints.filter((s) => !(c.x >= s.x && c.x < s.x + 3 && c.y >= s.y && c.y < s.y + 3))
      m.supplyFields = m.supplyFields.filter((f) => {
        const r = supplyRect(f)
        return !(c.x >= r.x && c.x < r.x + r.w && c.y >= r.y && c.y < r.y + r.h)
      })
      m.oilFields = (m.oilFields ?? []).filter(
        (o) => !(Math.abs(c.x - o.x) <= o.radius && Math.abs(c.y - o.y) <= o.radius),
      )
      m.obstructions = m.obstructions.filter((o) => !(c.x >= o.x && c.x < o.x + o.w && c.y >= o.y && c.y < o.y + o.h))
    }
    m.spawnPoints.forEach((s, i) => {
      s.team = i
    })
    this.spawnCounter = m.spawnPoints.length % DEFAULT_MAX_PLAYERS
    const after = m.spawnPoints.length + m.supplyFields.length + (m.oilFields?.length ?? 0) + m.obstructions.length
    if (before !== after) this.setDirty()
  }

  private clearCellObstructions(tx: number, ty: number): void {
    this.map.obstructions = this.map.obstructions.filter((o) => {
      const overlapX = tx >= o.x - 1 && tx <= o.x + o.w
      const overlapY = ty >= o.y - 1 && ty <= o.y + o.h
      return !(overlapX && overlapY)
    })
  }

  private renumberSpawns(): void {
    this.map.spawnPoints.sort((a, b) => a.team - b.team)
    for (let i = 0; i < this.map.spawnPoints.length; i++) this.map.spawnPoints[i].team = i
    this.spawnCounter = this.map.spawnPoints.length % DEFAULT_MAX_PLAYERS
  }

  private commitSpawn(tx: number, ty: number): void {
    if (tx < 0 || ty < 0 || tx + 3 > this.map.width || ty + 3 > this.map.height) return
    this.clearCellObstructions(tx, ty)
    this.map.spawnPoints.push({ x: tx, y: ty, team: this.spawnCounter })
    this.renumberSpawns()
    this.setDirty()
  }

  /** Fixed-size square supply field placed from the clicked cell (top-left), like a spawn spot. */
  private commitSupply(tx: number, ty: number): void {
    const w = FIXED_SUPPLY_SIZE
    const h = FIXED_SUPPLY_SIZE
    if (tx < 0 || ty < 0 || tx + w > this.map.width || ty + h > this.map.height) return
    if (!this.rectValid(tx, ty, w, h)) return
    this.map.supplyFields.push({ x: tx + w / 2, y: ty + h / 2, radius: w / 2, capacity: 24, w, h })
    this.setDirty()
  }

  private commitOil(tx: number, ty: number): void {
    const m = this.map
    const r = FIXED_OIL_RADIUS
    if (tx < 0 || ty < 0 || tx + r * 2 > m.width || ty + r * 2 > m.height) return
    if (!this.rectValid(tx, ty, r * 2, r * 2)) return
    if (m.oilFields.some((o) => Math.abs(o.x - (tx + r)) < r + 1 && Math.abs(o.y - (ty + r)) < r + 1)) return
    m.oilFields.push({ x: tx + r, y: ty + r, radius: r })
    this.setDirty()
  }

  private commitObstruction(tx: number, ty: number): void {
    const m = this.map
    const cells = this.brushCells(tx, ty).filter((c) => c.x >= 0 && c.y >= 0 && c.x < m.width && c.y < m.height)
    if (cells.length === 0) return
    const xs = cells.map((c) => c.x)
    const ys = cells.map((c) => c.y)
    const x = Math.min(...xs)
    const y = Math.min(...ys)
    const w = Math.max(...xs) - x + 1
    const h = Math.max(...ys) - y + 1
    if (x + w > m.width || y + h > m.height) return
    m.obstructions = m.obstructions.filter((o) => {
      const overlapX = x < o.x + o.w && x + w > o.x
      const overlapY = y < o.y + o.h && y + h > o.y
      return !(overlapX && overlapY)
    })
    m.obstructions.push({ x, y, w, h, type: this.objectKind })
    this.setDirty()
  }

  // ----- input -----

  private onDown(e: MouseEvent): void {
    const { x: px, y: py } = this.toCanvas(e.clientX, e.clientY)
    if (e.button === 1) {
      this.panning = true
      this.lastPan = { x: e.clientX, y: e.clientY }
      return
    }
    if (e.button !== 0) return
    const t = this.screenToTile(px, py)
    if (this.tool === 'paint') {
      this.painting = true
      this.paintTerrainAt(t.x, t.y)
    } else if (this.tool === 'fill') {
      this.fillAt(t.x, t.y)
    } else if (this.tool === 'erase') {
      this.eraseAt(t.x, t.y)
    } else if (this.tool === 'spawn') {
      this.commitSpawn(t.x, t.y)
    } else if (this.tool === 'supply') {
      this.commitSupply(t.x, t.y)
    } else if (this.tool === 'oil') {
      this.commitOil(t.x, t.y)
    } else if (this.tool === 'obstruction') {
      this.commitObstruction(t.x, t.y)
    }
  }

  private onMove(e: MouseEvent): void {
    const { x: px, y: py } = this.toCanvas(e.clientX, e.clientY)
    this.pointer = { x: px, y: py }
    if (this.panning) {
      this.cam.x += e.clientX - this.lastPan.x
      this.cam.y += e.clientY - this.lastPan.y
      this.lastPan = { x: e.clientX, y: e.clientY }
      return
    }
    if (this.painting) {
      const t = this.screenToTile(px, py)
      this.paintTerrainAt(t.x, t.y)
    }
  }

  private onUp(e: MouseEvent): void {
    if (e.button === 1) {
      this.panning = false
      return
    }
    if (this.painting) {
      this.painting = false
    }
  }

  private onWheel(e: WheelEvent): void {
    const { x: px, y: py } = this.toCanvas(e.clientX, e.clientY)
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
    const worldBefore = { x: (px - this.cam.x) / this.zoom, y: (py - this.cam.y) / this.zoom }
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * factor))
    this.cam.x = px - worldBefore.x * this.zoom
    this.cam.y = py - worldBefore.y * this.zoom
  }

  // ----- render -----

  private render(): void {
    const ctx = this.ctx
    const map = this.map
    ctx.fillStyle = '#0b0e14'
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
    const { x0, y0, x1, y1 } = this.viewBounds()

    ctx.save()
    ctx.translate(this.cam.x, this.cam.y)
    ctx.scale(this.zoom, this.zoom)

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue
        const i = tileIndex(map, x, y)
        ctx.fillStyle = applyBrightness(this.tileColor(map.tiles[i], i), this.brightness)
        ctx.fillRect(x * TILE, y * TILE, TILE, TILE)
        if (map.tiles[i] === Terrain.Water) {
          ctx.fillStyle = 'rgba(255,255,255,0.25)'
          ctx.font = `bold ${TILE * 0.7}px monospace`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText('w', x * TILE + TILE / 2, y * TILE + TILE / 2)
        }
      }
    }

    for (const o of map.obstructions) {
      const cx = (o.x + o.w / 2) * TILE
      const cy = (o.y + o.h / 2) * TILE
      const s = Math.min(o.w, o.h) * TILE
      ctx.save()
      ctx.translate(cx, cy)
      if (o.type === 'tree') {
        ctx.fillStyle = '#3d2b1f'
        ctx.fillRect(-s * 0.1, 0, s * 0.2, s * 0.4)
        ctx.fillStyle = '#3f8f3a'
        ctx.beginPath()
        ctx.arc(0, -s * 0.1, s * 0.35, 0, Math.PI * 2)
        ctx.fill()
        ctx.beginPath()
        ctx.arc(-s * 0.2, -s * 0.35, s * 0.25, 0, Math.PI * 2)
        ctx.fill()
        ctx.beginPath()
        ctx.arc(s * 0.2, -s * 0.35, s * 0.25, 0, Math.PI * 2)
        ctx.fill()
        ctx.beginPath()
        ctx.arc(0, -s * 0.45, s * 0.28, 0, Math.PI * 2)
        ctx.fill()
      } else if (o.type === 'rock') {
        ctx.fillStyle = '#7a7488'
        ctx.beginPath()
        ctx.moveTo(-s * 0.4, s * 0.3)
        ctx.lineTo(-s * 0.3, -s * 0.2)
        ctx.lineTo(0, -s * 0.38)
        ctx.lineTo(s * 0.28, -s * 0.25)
        ctx.lineTo(s * 0.4, 0)
        ctx.lineTo(s * 0.25, s * 0.3)
        ctx.lineTo(-s * 0.15, s * 0.35)
        ctx.closePath()
        ctx.fill()
        ctx.strokeStyle = 'rgba(15,15,25,0.45)'
        ctx.lineWidth = 1 / this.zoom
        ctx.stroke()
      } else {
        ctx.fillStyle = '#5c5256'
        ctx.fillRect(-s * 0.45, -s * 0.3, s * 0.9, s * 0.6)
        ctx.fillStyle = '#4a3f45'
        ctx.fillRect(-s * 0.35, -s * 0.42, s * 0.7, s * 0.18)
      }
      ctx.restore()
    }

    for (const f of map.supplyFields) {
      const r = supplyRect(f)
      ctx.save()
      ctx.globalAlpha = 0.35
      ctx.fillStyle = '#ffd45e'
      ctx.fillRect(r.x * TILE, r.y * TILE, r.w * TILE, r.h * TILE)
      ctx.restore()
      ctx.strokeStyle = '#ffd45e'
      ctx.lineWidth = 1.2 / this.zoom
      ctx.strokeRect(r.x * TILE, r.y * TILE, r.w * TILE, r.h * TILE)
      ctx.fillStyle = '#ffd45e'
      ctx.font = `bold ${TILE * 0.8}px monospace`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('SUPPLY', (r.x + r.w / 2) * TILE, (r.y + r.h / 2) * TILE)
    }

    for (const o of map.oilFields ?? []) {
      const sq = oilSquare(o)
      ctx.fillStyle = 'rgba(40,40,30,0.8)'
      ctx.fillRect(sq.x * TILE, sq.y * TILE, sq.w * TILE, sq.h * TILE)
      ctx.strokeStyle = '#d9a34a'
      ctx.lineWidth = 1.2 / this.zoom
      ctx.strokeRect(sq.x * TILE, sq.y * TILE, sq.w * TILE, sq.h * TILE)
      ctx.fillStyle = '#d9a34a'
      ctx.font = `bold ${TILE * 0.8}px monospace`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('OIL', (sq.x + sq.w / 2) * TILE, (sq.y + sq.h / 2) * TILE)
    }

    for (const s of map.spawnPoints) {
      const c = TEAM_COLORS[s.team % TEAM_COLORS.length]
      ctx.strokeStyle = c
      ctx.lineWidth = 2 / this.zoom
      ctx.strokeRect(s.x * TILE, s.y * TILE, 3 * TILE, 3 * TILE)
      ctx.fillStyle = c
      ctx.font = `${2 * TILE}px monospace`
      ctx.textAlign = 'start'
      ctx.textBaseline = 'alphabetic'
      ctx.fillText(String(s.team + 1), s.x * TILE + TILE * 0.6, s.y * TILE + TILE * 2.1)
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.18)'
    ctx.lineWidth = 1 / this.zoom
    for (let x = x0; x <= x1 + 1; x++) {
      ctx.beginPath()
      ctx.moveTo(x * TILE, y0 * TILE)
      ctx.lineTo(x * TILE, (y1 + 1) * TILE)
      ctx.stroke()
    }
    for (let y = y0; y <= y1 + 1; y++) {
      ctx.beginPath()
      ctx.moveTo(x0 * TILE, y * TILE)
      ctx.lineTo((x1 + 1) * TILE, y * TILE)
      ctx.stroke()
    }

    ctx.restore()
  }

  private rectValid(x: number, y: number, w: number, h: number): boolean {
    if (x < 0 || y < 0 || x + w > this.map.width || y + h > this.map.height) return false
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        if (this.map.tiles[tileIndex(this.map, x + dx, y + dy)] === Terrain.Water) return false
      }
    }
    return true
  }

  private drawGhostAt(px: number, py: number): void {
    if (this.painting) return
    const ctx = this.ctx
    const t = this.screenToTile(px, py)
    const rects: Array<{ x: number; y: number; w: number; h: number }> = []
    let valid = false
    if (this.tool === 'paint' || this.tool === 'erase') {
      for (const c of this.brushCells(t.x, t.y)) {
        const cell = c
        if (cell.x < 0 || cell.y < 0 || cell.x >= this.map.width || cell.y >= this.map.height) continue
        rects.push({ x: cell.x * TILE, y: cell.y * TILE, w: TILE, h: TILE })
      }
      valid = rects.length > 0
    } else if (this.tool === 'spawn') {
      valid = t.x >= 0 && t.y >= 0 && t.x + 3 <= this.map.width && t.y + 3 <= this.map.height
      rects.push({ x: t.x * TILE, y: t.y * TILE, w: 3 * TILE, h: 3 * TILE })
    } else if (this.tool === 'supply') {
      valid = this.rectValid(t.x, t.y, FIXED_SUPPLY_SIZE, FIXED_SUPPLY_SIZE)
      rects.push({ x: t.x * TILE, y: t.y * TILE, w: FIXED_SUPPLY_SIZE * TILE, h: FIXED_SUPPLY_SIZE * TILE })
    } else if (this.tool === 'oil') {
      valid =
        t.x >= 0 && t.y >= 0 && t.x + FIXED_OIL_RADIUS * 2 <= this.map.width && t.y + FIXED_OIL_RADIUS * 2 <= this.map.height && this.rectValid(t.x, t.y, FIXED_OIL_RADIUS * 2, FIXED_OIL_RADIUS * 2)
      const sq = oilSquare({ x: t.x + FIXED_OIL_RADIUS, y: t.y + FIXED_OIL_RADIUS, radius: FIXED_OIL_RADIUS })
      rects.push({ x: sq.x * TILE, y: sq.y * TILE, w: sq.w * TILE, h: sq.h * TILE })
    } else if (this.tool === 'obstruction') {
      let inside = true
      for (const c of this.brushCells(t.x, t.y)) {
        if (c.x < 0 || c.y < 0 || c.x >= this.map.width || c.y >= this.map.height) {
          inside = false
          continue
        }
        rects.push({ x: c.x * TILE, y: c.y * TILE, w: TILE, h: TILE })
      }
      valid = inside && rects.length > 0
    } else if (this.tool === 'fill') {
      const cell = t
      if (cell.x < 0 || cell.y < 0 || cell.x >= this.map.width || cell.y >= this.map.height) return
      rects.push({ x: cell.x * TILE, y: cell.y * TILE, w: TILE, h: TILE })
      valid = true
    } else {
      return
    }
    if (rects.length === 0) return
    ctx.save()
    ctx.translate(this.cam.x, this.cam.y)
    ctx.scale(this.zoom, this.zoom)
    ctx.globalAlpha = 0.4
    ctx.fillStyle = valid ? '#58e07a' : '#ff5a6a'
    for (const r of rects) ctx.fillRect(r.x, r.y, r.w, r.h)
    ctx.globalAlpha = 1
    ctx.strokeStyle = valid ? '#58e07a' : '#ff5a6a'
    ctx.lineWidth = 2 / this.zoom
    for (const r of rects) ctx.strokeRect(r.x, r.y, r.w, r.h)
    ctx.restore()
  }

  private loop(): void {
    this.render()
    if (!this.painting && this.pointer.x >= 0) this.drawGhostAt(this.pointer.x, this.pointer.y)
    this.raf = requestAnimationFrame(() => this.loop())
  }

  dispose(): void {
    cancelAnimationFrame(this.raf)
    this.ro?.disconnect()
    this.ro = null
    window.removeEventListener('mousemove', this.onWinMove)
    window.removeEventListener('mouseup', this.onWinUp)
    window.removeEventListener('resize', this.onWinResize)
    this.canvas.remove()
  }
}