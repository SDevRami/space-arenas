import { Terrain, tileIndex, type MapData, applyBrightness, PLAYER_COLORS } from '@space-arenas/shared'

const TERRAIN_COLORS: Record<number, string> = {
  [Terrain.Ground]: '#3a442f',
  [Terrain.Cliff]: '#5c5140',
  [Terrain.Water]: '#2c5877',
  [Terrain.Road]: '#454b4f',
  [Terrain.BuildableGround]: '#4a5838',
}

const teamHex = (team: number, resolve: (team: number) => number): string => {
  const idx = resolve(team)
  const c = PLAYER_COLORS[((idx % PLAYER_COLORS.length) + PLAYER_COLORS.length) % PLAYER_COLORS.length]
  return `#${c.toString(16).padStart(6, '0')}`
}

export class MapPreview {
  readonly canvas = document.createElement('canvas')

  constructor(width: number, height: number) {
    this.canvas.width = width
    this.canvas.height = height
  }

  render(map: MapData, resolveTeamColor: (team: number) => number = (team) => team): void {
    const c = this.canvas
    const ctx = c.getContext('2d')!
    const scaleX = c.width / map.width
    const scaleY = c.height / map.height
    const scale = Math.min(scaleX, scaleY)
    const offX = (c.width - map.width * scale) / 2
    const offY = (c.height - map.height * scale) / 2
    ctx.clearRect(0, 0, c.width, c.height)
    ctx.fillStyle = '#0b0e15'
    ctx.fillRect(0, 0, c.width, c.height)

    const px = (x: number): number => offX + x * scale
    const py = (y: number): number => offY + y * scale
    const bright = map.brightness ?? 0

    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const t = map.tiles[tileIndex(map, x, y)]
        const override = map.groundColors?.[tileIndex(map, x, y)]
        ctx.fillStyle = applyBrightness(override && override.length > 0 ? override : (TERRAIN_COLORS[t] ?? '#000'), bright)
        ctx.fillRect(px(x), py(y), Math.ceil(scale), Math.ceil(scale))
      }
    }

    for (const o of map.obstructions) {
      ctx.fillStyle = o.type === 'rock' ? '#6b6256' : o.type === 'tree' ? '#3c5c2e' : '#4d4a43'
      ctx.fillRect(px(o.x), py(o.y), o.w * scale, o.h * scale)
    }

    for (const f of map.supplyFields) {
      const cx = px(f.x) + scale / 2
      const cy = py(f.y) + scale / 2
      const r = Math.max(3, f.radius * scale)
      ctx.strokeStyle = 'rgba(150,230,150,0.85)'
      ctx.lineWidth = Math.max(1, scale * 0.35)
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.stroke()
      ctx.fillStyle = 'rgba(90,160,90,0.30)'
      ctx.fill()
      // crates/supply glyph
      ctx.fillStyle = 'rgba(150,230,150,0.95)'
      const s = Math.max(2.4, scale * 0.8)
      const ox = cx - s / 2
      const oy = cy - s / 2
      ctx.fillRect(ox, oy, s, s)
      ctx.fillStyle = '#0b0e15'
      ctx.beginPath()
      ctx.moveTo(ox + s * 0.5, oy)
      ctx.lineTo(ox + s, oy + s * 0.5)
      ctx.lineTo(ox + s * 0.5, oy + s)
      ctx.lineTo(ox, oy + s * 0.5)
      ctx.closePath()
      ctx.fill()
    }

    for (const f of map.oilFields ?? []) {
      const cx = px(f.x) + scale / 2
      const cy = py(f.y) + scale / 2
      const r = Math.max(3, f.radius * scale)
      ctx.fillStyle = 'rgba(20,22,25,0.75)'
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = 'rgba(240,200,120,0.9)'
      ctx.lineWidth = Math.max(1, scale * 0.35)
      ctx.stroke()
      // oil droplet glyph
      ctx.fillStyle = 'rgba(255,215,130,0.95)'
      ctx.beginPath()
      ctx.arc(cx, cy, Math.max(1.6, scale * 0.5), 0, Math.PI * 2)
      ctx.fill()
    }

    map.spawnPoints.forEach((s, i) => {
      const cx = px(s.x) + scale / 2
      const cy = py(s.y) + scale / 2
      const team = teamHex(s.team, resolveTeamColor)
      const r = Math.max(6, scale * 2.1)
      // outer glow / base ring
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'
      ctx.lineWidth = Math.max(1.5, scale * 0.4)
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.stroke()
      // inner team-colored disc with darker edge
      ctx.fillStyle = team
      ctx.beginPath()
      ctx.arc(cx, cy, r - Math.max(1.5, scale * 0.4), 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = 'rgba(0,0,0,0.45)'
      ctx.lineWidth = 1
      ctx.stroke()
      // label
      ctx.fillStyle = '#ffffff'
      ctx.font = `bold ${Math.max(7, Math.round(scale * 1.8))}px ui-monospace, monospace`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(i + 1), cx, cy + 0.5)
    })
  }
}
