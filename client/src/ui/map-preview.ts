import { Terrain, tileIndex, type MapData, applyBrightness } from '@space-arenas/shared'
import { TEAM_COLORS } from '../render/renderer.ts'

const TERRAIN_COLORS: Record<number, string> = {
  [Terrain.Ground]: '#3a442f',
  [Terrain.Cliff]: '#5c5140',
  [Terrain.Water]: '#2c5877',
  [Terrain.Road]: '#454b4f',
  [Terrain.BuildableGround]: '#4a5838',
}

const teamHex = (team: number): string => {
  const c = TEAM_COLORS[team % TEAM_COLORS.length]
  return `#${c.toString(16).padStart(6, '0')}`
}

export class MapPreview {
  readonly canvas = document.createElement('canvas')

  constructor(width: number, height: number) {
    this.canvas.width = width
    this.canvas.height = height
  }

  render(map: MapData): void {
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
      ctx.strokeStyle = 'rgba(120,200,120,0.5)'
      ctx.beginPath()
      ctx.arc(px(f.x) + scale / 2, py(f.y) + scale / 2, f.radius * scale, 0, Math.PI * 2)
      ctx.stroke()
    }

    for (const f of map.oilFields ?? []) {
      ctx.fillStyle = 'rgba(200,160,74,0.5)'
      ctx.beginPath()
      ctx.arc(px(f.x) + scale / 2, py(f.y) + scale / 2, f.radius * scale, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = 'rgba(240,200,120,0.9)'
      ctx.stroke()
    }

    map.spawnPoints.forEach((s, i) => {
      const cx = px(s.x) + scale / 2
      const cy = py(s.y) + scale / 2
      ctx.fillStyle = teamHex(s.team)
      ctx.beginPath()
      ctx.arc(cx, cy, Math.max(5, scale * 1.6), 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.fillStyle = '#ffffff'
      ctx.font = `bold ${Math.max(7, Math.round(scale * 1.5))}px ui-monospace, monospace`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(i + 1), cx, cy + 0.5)
    })
  }
}
