import { Terrain, type MapData, tileIndex, applyBrightness } from '@space-arenas/shared'
import { ISO_HALF_H, ISO_HALF_W } from './camera.ts'
import { Container, Sprite, Texture } from 'pixi.js'

const GROUND_SCALE = 0.5

const GROUND_COLORS: Record<number, string> = {
  [Terrain.Ground]: '#39422f',
  [Terrain.Cliff]: '#5c5140',
  [Terrain.Water]: '#2c5877',
  [Terrain.Road]: '#454b4f',
  [Terrain.BuildableGround]: '#424d35',
}

function diamond(ctx: CanvasRenderingContext2D, cx: number, cy: number, hw: number, hh: number, color: string): void {
  ctx.beginPath()
  ctx.moveTo(cx, cy - hh)
  ctx.lineTo(cx + hw, cy)
  ctx.lineTo(cx, cy + hh)
  ctx.lineTo(cx - hw, cy)
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()
}

export function buildGroundTexture(map: MapData): { texture: Texture; sprite: Sprite; canvasW: number; canvasH: number } {
  const hw = ISO_HALF_W * GROUND_SCALE
  const hh = ISO_HALF_H * GROUND_SCALE
  const canvasW = Math.ceil((map.width + map.height) * hw)
  const canvasH = Math.ceil((map.width + map.height) * hh)
  const canvas = document.createElement('canvas')
  canvas.width = canvasW
  canvas.height = canvasH
  const ctx = canvas.getContext('2d')!
  const bright = map.brightness ?? 0
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const t = map.tiles[tileIndex(map, x, y)]
      const cx = (x - y) * hw + canvasW / 2
      const cy = (x + y) * hh
      const override = map.groundColors?.[tileIndex(map, x, y)]
      const base = override && override.length > 0 ? override : (GROUND_COLORS[t] ?? GROUND_COLORS[Terrain.Ground])
      diamond(ctx, cx, cy, hw, hh, applyBrightness(base, bright))
      if (t === Terrain.Ground && (!override || override.length === 0)) {
        const checker = (x + y) % 2 === 0
        diamond(ctx, cx, cy, hw, hh, checker ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)')
      }
    }
  }
  const texture = Texture.from(canvas)
  const sprite = new Sprite(texture)
  sprite.scale.set(1 / GROUND_SCALE, 1 / GROUND_SCALE)
  sprite.x = -canvasW
  sprite.y = 0
  return { texture, sprite, canvasW, canvasH }
}

const FOG_CELL = 4
const FOG_ALPHA: Record<number, string> = {
  0: 'rgba(0,0,0,0.75)',
  1: 'rgba(0,0,0,0.5)',
  2: 'rgba(0,0,0,0)',
}

export class FogRenderer {
  private sprite: Sprite
  private tex: Texture
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private fw: number
  private fh: number
  private cellTileIdx: Int32Array
  private cellBest: Uint8Array

  constructor(map: MapData) {
    const hw = ISO_HALF_W
    const hh = ISO_HALF_H
    this.fw = Math.ceil(map.width / FOG_CELL)
    this.fh = Math.ceil(map.height / FOG_CELL)
    const canvasW = Math.ceil((this.fw + this.fh) * hw)
    const canvasH = Math.ceil((this.fw + this.fh) * hh)
    this.canvas = document.createElement('canvas')
    this.canvas.width = canvasW
    this.canvas.height = canvasH
    this.ctx = this.canvas.getContext('2d')!
    this.tex = Texture.from(this.canvas)
    this.sprite = new Sprite(this.tex)
    this.sprite.scale.set(FOG_CELL, FOG_CELL)
    this.sprite.x = (-canvasW / 2) * FOG_CELL
    this.sprite.y = 0
    this.sprite.eventMode = 'none'
    const cellCount = this.fw * this.fh
    this.cellTileIdx = new Int32Array(cellCount * FOG_CELL * FOG_CELL)
    for (let fy = 0; fy < this.fh; fy++) {
      for (let fx = 0; fx < this.fw; fx++) {
        const base = (fy * this.fw + fx) * FOG_CELL * FOG_CELL
        for (let dy = 0; dy < FOG_CELL; dy++) {
          for (let dx = 0; dx < FOG_CELL; dx++) {
            const x = fx * FOG_CELL + dx
            const y = fy * FOG_CELL + dy
            this.cellTileIdx[base + dy * FOG_CELL + dx] = x < map.width && y < map.height ? tileIndex(map, x, y) : -1
          }
        }
      }
    }
    this.cellBest = new Uint8Array(cellCount).fill(255)
  }

  get container(): Sprite {
    return this.sprite
  }

  update(fog: Uint8Array): void {
    const ctx = this.ctx
    const fw = this.fw
    const fh = this.fh
    const cellBest = this.cellBest
    const idx = this.cellTileIdx
    const hw = ISO_HALF_W
    const hh = ISO_HALF_H
    let changed = false
    for (let fy = 0; fy < fh; fy++) {
      for (let fx = 0; fx < fw; fx++) {
        const base = (fy * fw + fx) * FOG_CELL * FOG_CELL
        let best = 0
        for (let i = 0; i < FOG_CELL * FOG_CELL; i++) {
          const ti = idx[base + i]
          if (ti >= 0) {
            const v = fog[ti]
            if (v > best) best = v
          }
        }
        if (best === cellBest[fy * fw + fx]) continue
        cellBest[fy * fw + fx] = best
        const cx = (fx - fy) * hw + this.canvas.width / 2
        const cy = (fx + fy) * hh + hh * 0.75
        ctx.globalCompositeOperation = 'destination-out'
        diamond(ctx, cx, cy, hw, hh, '#000')
        ctx.globalCompositeOperation = 'source-over'
        if (best < 2) diamond(ctx, cx, cy, hw, hh, FOG_ALPHA[best])
        changed = true
      }
    }
    if (changed) this.tex.source.update()
  }
}

export function addGroundTo(worldLayer: Container, map: MapData): void {
  const { sprite } = buildGroundTexture(map)
  worldLayer.addChild(sprite)
}
