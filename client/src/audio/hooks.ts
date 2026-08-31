import type { SimEvent } from '../core/events.ts'

export class AudioHooks {
  private ctx: AudioContext | null = null

  unlock(): void {
    if (this.ctx) return
    try {
      this.ctx = new AudioContext()
    } catch {
      this.ctx = null
    }
  }

  private tone(freq: number, dur: number, type: OscillatorType = 'square', gain = 0.05): void {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    const osc = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, t)
    g.gain.setValueAtTime(gain, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    osc.connect(g)
    g.connect(this.ctx.destination)
    osc.start(t)
    osc.stop(t + dur)
  }

  uiClick(): void {
    this.tone(660, 0.05, 'square', 0.03)
  }

  onEvent(e: SimEvent): void {
    switch (e.type) {
      case 'unit-trained':
        this.tone(880, 0.08)
        break
      case 'building-completed':
        this.tone(520, 0.12, 'triangle', 0.07)
        break
      case 'upgrade-completed':
        this.tone(720, 0.18, 'sine', 0.06)
        break
      case 'supply-harvested':
        this.tone(1320, 0.06, 'sine', 0.04)
        break
      case 'combat-hit':
        this.tone(120 + (e.damage % 80), 0.04, 'sawtooth', 0.025)
        break
      case 'laser-strike':
        this.tone(90, 0.9, 'sawtooth', 0.07)
        this.tone(180, 0.5, 'square', 0.04)
        break
      case 'power-down':
        this.tone(140, 0.25, 'sawtooth', 0.06)
        break
      case 'game-over':
        this.tone(e.winner !== null ? 440 : 220, 0.5, 'triangle', 0.08)
        break
      default:
        break
    }
  }
}
