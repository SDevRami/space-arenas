import type { WeatherId } from '../ui/graphics.ts'

interface RainDrop {
  x: number
  y: number
  z: number
  speed: number
  len: number
}

interface SnowFlake {
  x: number
  y: number
  r: number
  speed: number
  swell: number
  phase: number
}

const RAIN_PER_PX = 0.00045
const SNOW_PER_PX = 0.00018
const MAX_PARTICLES = 1200

/**
 * Full-viewport overlay rendered above the game canvas (the camera view).
 * Purely cosmetic: it never touches the simulation or gameplay state.
 */
export class WeatherOverlay {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private kind: WeatherId = 'none'
  private drops: RainDrop[] = []
  private flakes: SnowFlake[] = []
  private flash = 0
  private nextFlash = 0
  private width = 0
  private height = 0

  constructor(container: HTMLElement) {
    this.canvas = document.createElement('canvas')
    this.canvas.style.position = 'absolute'
    this.canvas.style.inset = '0'
    this.canvas.style.pointerEvents = 'none'
    this.canvas.style.zIndex = '1'
    container.appendChild(this.canvas)
    this.ctx = this.canvas.getContext('2d')!
    this.resize()
    window.addEventListener('resize', this.resize)
  }

  setWeather(kind: WeatherId): void {
    this.kind = kind
    this.reseed()
  }

  step(): void {
    if (this.kind === 'none') return
    if (this.kind === 'thunder') {
      if (this.flash > 0) this.flash--
      else if (--this.nextFlash <= 0) {
        this.flash = 4
        this.nextFlash = 90 + Math.floor(Math.random() * 160)
      }
    }
    for (const d of this.drops) {
      d.y += d.speed
      d.x -= d.speed * 0.18
      if (d.y > this.height + 8) {
        d.y = -10 - Math.random() * 40
        d.x = Math.random() * this.width
        d.z = 0.4 + Math.random() * 0.6
      }
    }
    for (const f of this.flakes) {
      f.y += f.speed
      f.x += Math.sin((f.phase += 0.02 * f.swell)) * 0.6 * f.swell
      if (f.y > this.height + 8) {
        f.y = -10 - Math.random() * 60
        f.x = Math.random() * this.width
      }
    }
  }

  draw(): void {
    const ctx = this.ctx
    const { width, height } = this
    ctx.clearRect(0, 0, width, height)
    if (this.kind === 'none') return

    if (this.kind === 'snow') {
      ctx.fillStyle = 'rgba(210,225,255,0.06)'
      ctx.fillRect(0, 0, width, height)
    } else if (this.kind === 'rain') {
      ctx.fillStyle = 'rgba(120,150,200,0.06)'
      ctx.fillRect(0, 0, width, height)
    }

    ctx.strokeStyle = '#a8c2ec'
    ctx.lineWidth = 1.4
    for (const d of this.drops) {
      const a = this.kind === 'thunder' ? 0.5 : 0.32
      ctx.globalAlpha = a * d.z
      ctx.beginPath()
      ctx.moveTo(d.x, d.y)
      ctx.lineTo(d.x - 6, d.y + d.len)
      ctx.stroke()
    }
    ctx.globalAlpha = 1

    for (const f of this.flakes) {
      ctx.globalAlpha = 0.55
      ctx.fillStyle = '#e8f2ff'
      ctx.beginPath()
      ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2)
      ctx.fill()
    }

    if (this.kind === 'thunder' && this.flash > 0) {
      ctx.globalAlpha = this.flash > 2 ? 0.35 : 0.16
      ctx.fillStyle = '#cde0ff'
      ctx.fillRect(0, 0, width, height)
    }
    ctx.globalAlpha = 1
  }

  dispose(): void {
    window.removeEventListener('resize', this.resize)
    this.canvas.parentNode?.removeChild(this.canvas)
  }

  private resize = (): void => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    this.width = Math.max(1, window.innerWidth)
    this.height = Math.max(1, window.innerHeight)
    this.canvas.width = Math.floor(this.width * dpr)
    this.canvas.height = Math.floor(this.height * dpr)
    this.canvas.style.width = `${this.width}px`
    this.canvas.style.height = `${this.height}px`
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.reseed()
  }

  private reseed(): void {
    if (this.kind === 'none') {
      this.drops = []
      this.flakes = []
      return
    }
    let n = 0
    if (this.kind === 'thunder') n = Math.min(MAX_PARTICLES, Math.floor(this.width * this.height * RAIN_PER_PX * 1.15))
    else if (this.kind === 'rain') n = Math.min(MAX_PARTICLES, Math.floor(this.width * this.height * RAIN_PER_PX))
    else n = Math.min(MAX_PARTICLES, Math.floor(this.width * this.height * SNOW_PER_PX))
    this.drops = []
    this.flakes = []
    for (let i = 0; i < n; i++) {
      if (this.kind === 'snow') {
        this.flakes.push({
          x: Math.random() * this.width,
          y: Math.random() * this.height,
          r: 1 + Math.random() * 2.2,
          speed: 0.35 + Math.random() * 0.5,
          swell: 0.6 + Math.random() * 1.4,
          phase: Math.random() * Math.PI * 2,
        })
      } else {
        this.drops.push({
          x: Math.random() * this.width,
          y: Math.random() * this.height,
          z: 0.4 + Math.random() * 0.6,
          speed: 7 + Math.random() * 6,
          len: 7 + Math.random() * 7,
        })
      }
    }
    this.flash = 0
    this.nextFlash = 60 + Math.floor(Math.random() * 120)
  }
}