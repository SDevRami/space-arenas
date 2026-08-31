import {
  DEFAULT_MAX_PLAYERS,
  Terrain,
  applyBrightness,
  createEmptyMap,
  tileIndex,
  validateMap,
  type MapData,
  type Obstruction,
  type SpawnPoint,
} from '@space-arenas/shared'

const canvas = document.getElementById('canvas') as HTMLDivElement
const cv = document.createElement('canvas')
cv.width = window.innerWidth
cv.height = window.innerHeight
cv.id = 'game-canvas'
canvas.appendChild(cv)
const ctx = cv.getContext('2d')!

const nameEl = document.getElementById('map-name') as HTMLInputElement
const wEl = document.getElementById('size-w') as HTMLInputElement
const hEl = document.getElementById('size-h') as HTMLInputElement
const brushEl = document.getElementById('brush') as HTMLSelectElement
const toolEl = document.getElementById('tool') as HTMLSelectElement
const objectKindEl = document.getElementById('object-kind') as HTMLSelectElement
const lightEl = document.getElementById('light') as HTMLInputElement
const statusEl = document.getElementById('status') as HTMLDivElement

let map: MapData = createEmptyMap(128, 128)
map.name = 'Custom Map'

const cam = { zoom: 6, x: 0, y: 0 }
let paintHeld = false
let drag: { x0: number; y0: number; x1: number; y1: number } | null = null
let panning = false
let lastPan: { x: number; y: number } | null = null
let spawnTeamCounter = 0

const TILE = 8

const setStatus = (msg: string): void => {
  statusEl.textContent = msg
}

const screenToTile = (px: number, py: number): { x: number; y: number } => {
  const cell = TILE * cam.zoom
  return { x: Math.floor((px - cam.x) / cell), y: Math.floor((py - cam.y) / cell) }
}

const tileToScreen = (x: number, y: number): { x: number; y: number } => {
  const cell = TILE * cam.zoom
  return { x: cam.x + x * cell, y: cam.y + y * cell }
}

const TERRAIN_COLORS: Record<number, string> = {
  [Terrain.Ground]: '#39422f',
  [Terrain.Cliff]: '#5c5140',
  [Terrain.Water]: '#2c5877',
  [Terrain.Road]: '#454b4f',
  [Terrain.BuildableGround]: '#424d35',
}

const TEAM_COLORS = ['#7cf27c', '#f07c7c', '#7cc6f2', '#f2d27c', '#d27cf2']

function paintTerrainAt(tx: number, ty: number): void {
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return
  map.tiles[tileIndex(map, tx, ty)] = Number(brushEl.value)
}

function render(): void {
  ctx.fillStyle = '#0b0e14'
  ctx.fillRect(0, 0, cv.width, cv.height)
  const { x0, y0, x1, y1 } = viewTileBounds()

  ctx.save()
  ctx.translate(cam.x, cam.y)
  ctx.scale(cam.zoom, cam.zoom)

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue
      ctx.fillStyle = applyBrightness(TERRAIN_COLORS[map.tiles[tileIndex(map, x, y)]] ?? '#000', map.brightness ?? 0)
      ctx.fillRect(x * TILE, y * TILE, TILE, TILE)
      if (map.tiles[tileIndex(map, x, y)] === Terrain.BuildableGround) {
        ctx.fillStyle = 'rgba(255,255,255,0.04)'
        ctx.fillRect(x * TILE, y * TILE, TILE, TILE)
      }
      if (map.tiles[tileIndex(map, x, y)] === Terrain.Water) {
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
      ctx.lineWidth = 1 / cam.zoom
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
    ctx.beginPath()
    ctx.arc((f.x + 0.5) * TILE, (f.y + 0.5) * TILE, f.radius * TILE, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(255,212,94,0.35)'
    ctx.fill()
    ctx.strokeStyle = '#ffd45e'
    ctx.stroke()
    ctx.fillStyle = '#ffd45e'
    ctx.font = `bold ${TILE * 0.8}px monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('SUPPLY', (f.x + 0.5) * TILE, (f.y + 0.5) * TILE)
  }

  for (const s of map.spawnPoints) {
    const c = tileToScreen(s.x, s.y)
    ctx.strokeStyle = TEAM_COLORS[s.team % TEAM_COLORS.length]
    ctx.lineWidth = 2 / cam.zoom
    ctx.strokeRect(s.x * TILE, s.y * TILE, 3 * TILE, 3 * TILE)
    ctx.fillStyle = TEAM_COLORS[s.team % TEAM_COLORS.length]
    ctx.font = `${2 * TILE}px monospace`
    ctx.textAlign = 'start'
    ctx.textBaseline = 'alphabetic'
    ctx.fillText(String(s.team), s.x * TILE + TILE * 0.5, s.y * TILE + TILE * 2)
    void c
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.25)'
  ctx.lineWidth = 1 / cam.zoom
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

function viewTileBounds(): { x0: number; y0: number; x1: number; y1: number } {
  const cell = TILE * cam.zoom
  return {
    x0: Math.floor(-cam.x / cell),
    y0: Math.floor(-cam.y / cell),
    x1: Math.ceil((cv.width - cam.x) / cell),
    y1: Math.ceil((cv.height - cam.y) / cell),
  }
}

function newMap(): void {
  const w = Math.max(16, Math.min(256, Number(wEl.value) || 128))
  const h = Math.max(16, Math.min(256, Number(hEl.value) || 128))
  map = createEmptyMap(w, h)
  map.name = nameEl.value.trim() || 'Custom Map'
  spawnTeamCounter = 0
  setStatus(`New map ${w}x${h}.`)
  render()
}

function addObstruction(x0: number, y0: number, x1: number, y1: number): void {
  const x = Math.min(x0, x1)
  const y = Math.min(y0, y1)
  const w = Math.abs(x1 - x0) + 1
  const h = Math.abs(y1 - y0) + 1
  if (x < 0 || y < 0 || x + w > map.width || y + h > map.height) {
    setStatus('Obstruction out of bounds')
    return
  }
  map.obstructions.push({ x, y, w, h, type: objectKindEl.value as Obstruction['type'] })
  setStatus(`Added ${objectKindEl.value} at (${x},${y}) ${w}x${h}.`)
}

function addSupply(tx: number, ty: number): void {
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return
  map.supplyFields.push({ x: tx, y: ty, radius: 3, capacity: 12 })
  setStatus(`Supply field at (${tx},${ty}).`)
}

function addSpawn(tx: number, ty: number): void {
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return
  if (tx + 3 > map.width || ty + 3 > map.height) {
    setStatus('Spawn needs 3 tiles of room')
    return
  }
  const team = spawnTeamCounter
  spawnTeamCounter = (spawnTeamCounter + 1) % DEFAULT_MAX_PLAYERS
  map.spawnPoints.push({ x: tx, y: ty, team } as SpawnPoint)
  setStatus(`Spawn for team ${team} at (${tx},${ty}).`)
}

cv.addEventListener('mousedown', (e) => {
  const rect = cv.getBoundingClientRect()
  const px = e.clientX - rect.left
  const py = e.clientY - rect.top
  if (e.button === 1) {
    panning = true
    lastPan = { x: e.clientX, y: e.clientY }
    return
  }
  if (e.button !== 0) return
  const t = screenToTile(px, py)
  const tool = toolEl.value
  if (tool === 'terrain') {
    paintHeld = true
    paintTerrainAt(t.x, t.y)
  } else if (tool === 'obstruction') {
    drag = { x0: t.x, y0: t.y, x1: t.x, y1: t.y }
  } else if (tool === 'supply') {
    addSupply(t.x, t.y)
  } else if (tool === 'spawn') {
    addSpawn(t.x, t.y)
  }
})

window.addEventListener('mousemove', (e) => {
  if (panning && lastPan) {
    cam.x += e.clientX - lastPan.x
    cam.y += e.clientY - lastPan.y
    lastPan = { x: e.clientX, y: e.clientY }
    return
  }
  if (paintHeld) {
    const rect = cv.getBoundingClientRect()
    const t = screenToTile(e.clientX - rect.left, e.clientY - rect.top)
    paintTerrainAt(t.x, t.y)
  } else if (drag) {
    const rect = cv.getBoundingClientRect()
    const t = screenToTile(e.clientX - rect.left, e.clientY - rect.top)
    drag.x1 = Math.max(0, Math.min(map.width - 1, t.x))
    drag.y1 = Math.max(0, Math.min(map.height - 1, t.y))
  }
})

window.addEventListener('mouseup', (e) => {
  if (e.button === 1) {
    panning = false
    lastPan = null
    return
  }
  if (paintHeld) {
    paintHeld = false
    return
  }
  if (drag) {
    addObstruction(drag.x0, drag.y0, drag.x1, drag.y1)
    drag = null
  }
})

cv.addEventListener('contextmenu', (e) => e.preventDefault())
cv.addEventListener('wheel', (e) => {
  e.preventDefault()
  const rect = cv.getBoundingClientRect()
  const px = e.clientX - rect.left
  const py = e.clientY - rect.top
  const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
  const worldBefore = { x: (px - cam.x) / cam.zoom, y: (py - cam.y) / cam.zoom }
  cam.zoom = Math.max(1, Math.min(24, cam.zoom * factor))
  cam.x = px - worldBefore.x * cam.zoom
  cam.y = py - worldBefore.y * cam.zoom
})

window.addEventListener('resize', () => {
  cv.width = window.innerWidth
  cv.height = window.innerHeight
})

document.getElementById('new-map')!.addEventListener('click', newMap)

lightEl.addEventListener('input', () => {
  map.brightness = Math.max(-10, Math.min(10, Math.round(Number(lightEl.value) || 0)))
})

document.getElementById('save-idb')!.addEventListener('click', async () => {
  const v = validateMap(map)
  if (!v.ok) {
    setStatus(v.errors.join('\n'))
    return
  }
  try {
    await saveToLibrary(map)
    setStatus('Saved to library.')
  } catch {
    setStatus('Library save failed.')
  }
})

document.getElementById('export-btn')!.addEventListener('click', () => {
  const v = validateMap(map)
  if (!v.ok) {
    setStatus(v.errors.join('\n'))
    return
  }
  const blob = new Blob([JSON.stringify(map, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${map.name.replace(/[^\w-]+/g, '_')}.sa-map.json`
  a.click()
  URL.revokeObjectURL(a.href)
  setStatus('Exported. ' + v.errors.length + ' errors')
})

const DB_NAME = 'space-arenas-maps'
const DB_STORE = 'maps'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(DB_STORE, { keyPath: 'name' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function saveToLibrary(m: MapData): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite')
    tx.objectStore(DB_STORE).put({ name: m.name, map: JSON.stringify(m), savedAt: Date.now() })
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

newMap()
function frame(): void {
  render()
  if (drag) {
    const cell = TILE * cam.zoom
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 2
    const p0 = tileToScreen(drag.x0, drag.y0)
    const p1 = tileToScreen(drag.x1, drag.y1)
    ctx.strokeRect(p0.x, p0.y, (p1.x - p0.x) + cell, (p1.y - p0.y) + cell)
  }
  requestAnimationFrame(frame)
}
frame()
