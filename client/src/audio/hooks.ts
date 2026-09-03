import type { SimEvent } from '../core/events.ts'
import { effectsVolume, ambientVolume, getAudio, onChangeAudio } from './settings.ts'

interface ToneOpts {
  freq: number
  dur: number
  type?: OscillatorType
  gain?: number
  /** seconds to sweep from freq up to this (0 = flat). */
  sweepTo?: number
  delay?: number
}

interface SfxOpts {
  /** World (fx) position for positional volume falloff. Omit = play at full volume. */
  x?: number
  y?: number
  /** Optional asset URL override; if set and decodable, the synth is skipped. */
  url?: string
  /** Base gain used if no positional falloff applies. */
  gain?: number
  /** Optional pitch modifier (octaves scale). */
  pitch?: number
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v))

export class AudioHooks {
  private ctx: AudioContext | null = null
  private masterGain: GainNode | null = null
  private ambientGain: GainNode | null = null
  private ambientSource: OscillatorNode | null = null

  /** World (fx) position of the listener — updated by Game each frame from the camera center. */
  listenerX = 0
  listenerY = 0
  private ambientSpec: { freq?: number; type?: OscillatorType; wave?: number } | null = null

  constructor() {
    onChangeAudio(() => {
      if (this.ctx && this.ambientGain) this.refitAmbient()
    })
  }

  unlock(): void {
    if (this.ctx) return
    try {
      this.ctx = new AudioContext()
      this.masterGain = this.ctx.createGain()
      this.masterGain.connect(this.ctx.destination)
      this.ambientGain = this.ctx.createGain()
      this.ambientGain.connect(this.masterGain)
    } catch {
      this.ctx = null
    }
    if (this.ctx && this.ambientSpec) this.buildAmbient(this.ambientSpec)
  }

  /** Scale a sound's volume by distance to the listener; 1 at center, ~0.3 at 18 tiles. */
  private positional(x?: number, y?: number): number {
    if (x === undefined || y === undefined) return 1
    const tile = 1000
    const dx = (x - this.listenerX) / tile
    const dy = (y - this.listenerY) / tile
    const dist = Math.sqrt(dx * dx + dy * dy)
    return clamp01(1 - (dist - 2) / 16)
  }

  private playTone(opts: ToneOpts): void {
    const ctx = this.ctx
    const master = this.masterGain
    if (!ctx || ctx.state !== 'running' || !master) return
    const vol = effectsVolume() * (opts.gain ?? 0.05)
    if (vol <= 0.0001) return
    const t = ctx.currentTime + (opts.delay ?? 0)
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = opts.type ?? 'square'
    osc.frequency.setValueAtTime(opts.freq, t)
    if (opts.sweepTo && opts.sweepTo !== opts.freq) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.sweepTo), t + opts.dur)
    }
    g.gain.setValueAtTime(vol, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur)
    osc.connect(g)
    g.connect(master)
    osc.start(t)
    osc.stop(t + opts.dur + 0.02)
  }

  /**
   * Play an effect sound. If `opts.url` is set and decodable, the asset buffer is
   * used; otherwise the synth fallback runs. Positional falloff is applied when
   * `x`/`y` are supplied.
   */
  playSfx(kind: string, opts: SfxOpts = {}): void {
    const url = opts.url ?? getAudio().overrides[kind]
    if (url && url.length > 0) {
      void this.playAsset(kind, url, opts)
      return
    }
    this.synthSfx(kind, opts)
  }

  private synthSfx(kind: string, opts: SfxOpts): void {
    const scale = this.positional(opts.x, opts.y)
    const g = (opts.gain ?? 0.05) * scale
    if (g <= 0.0001) return
    const p = opts.pitch ?? 1
    switch (kind) {
      case 'select': {
        const base = 720 * p
        this.playTone({ freq: base, dur: 0.08, type: 'square', gain: g * 0.4 })
        this.playTone({ freq: base * 1.5, dur: 0.06, type: 'square', gain: g * 0.25, delay: 0.02 })
        break
      }
      case 'move-bleep':
        this.playTone({ freq: 440 * p, dur: 0.06, type: 'square', gain: g * 0.35 })
        break
      case 'weapon-rifle':
        this.playTone({ freq: 1600, dur: 0.05, type: 'square', gain: g * 0.5 })
        break
      case 'weapon-rocket':
        this.playTone({ freq: 300, dur: 0.25, type: 'sawtooth', sweepTo: 120, gain: g * 0.4 })
        break
      case 'weapon-cannon':
        this.playTone({ freq: 160, dur: 0.16, type: 'square', sweepTo: 80, gain: g * 0.55 })
        break
      case 'weapon-artillery':
        this.playTone({ freq: 110, dur: 0.4, type: 'sawtooth', sweepTo: 50, gain: g * 0.6 })
        this.playTone({ freq: 220, dur: 0.2, type: 'triangle', gain: g * 0.3 })
        break
      case 'weapon-air-cannon':
        this.playTone({ freq: 520, dur: 0.18, type: 'sawtooth', sweepTo: 200, gain: g * 0.45 })
        break
      case 'alert':
        this.playTone({ freq: 880, dur: 0.1, type: 'square', gain: g * 0.5 })
        this.playTone({ freq: 660, dur: 0.1, type: 'square', gain: g * 0.5, delay: 0.12 })
        break
      default:
        break
    }
  }

  private async playAsset(kind: string, url: string, opts: SfxOpts): Promise<void> {
    const ctx = this.ctx
    const master = this.masterGain
    if (!ctx || ctx.state !== 'running' || !master) return
    try {
      const resp = await fetch(url)
      if (!resp.ok) return
      const buf = await resp.arrayBuffer()
      const audioBuf = await ctx.decodeAudioData(buf)
      const src = ctx.createBufferSource()
      src.buffer = audioBuf
      const g = ctx.createGain()
      const scale = this.positional(opts.x, opts.y)
      g.gain.setValueAtTime(effectsVolume() * (opts.gain ?? 1) * scale, ctx.currentTime)
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + audioBuf.duration)
      src.connect(g)
      g.connect(master)
      src.start()
    } catch {
      // asset failed to load or decode — fall back to the synth for this kind
      this.synthSfx(kind, { ...opts, url: undefined })
    }
  }

  /** Start (or refit) the ambient layer; idempotent. `freq`/`type`/`wave` shape the drone. */
  startAmbient(spec: { freq?: number; type?: OscillatorType; wave?: number } = {}): void {
    this.ambientSpec = spec
    if (!this.ctx || !this.ambientGain) return
    this.buildAmbient(spec)
  }

  private buildAmbient(spec: { freq?: number; type?: OscillatorType; wave?: number }): void {
    const ctx = this.ctx
    const ambient = this.ambientGain
    if (!ctx || !ambient) return
    if (this.ambientSource) return
    const t = ctx.currentTime
    const src = ctx.createOscillator()
    src.type = spec.type ?? 'sawtooth'
    src.frequency.setValueAtTime(spec.freq ?? 55, t)
    const lfo = ctx.createOscillator()
    lfo.type = 'sine'
    lfo.frequency.setValueAtTime(spec.wave ?? 0.3, t)
    const lfoGain = ctx.createGain()
    lfoGain.gain.setValueAtTime(20, t)
    lfo.connect(lfoGain)
    lfoGain.connect(src.frequency)
    src.connect(ambient)
    src.start(t)
    lfo.start(t)
    this.ambientSource = src
    this.refitAmbient()
  }

  /** Start a lobby ambient drone. */
  startLobbyAmbient(): void {
    this.startAmbient({ freq: 49, type: 'sawtooth', wave: 0.2 })
  }

  /** Start an in-game ambient hum (slightly deeper/present). */
  startGameAmbient(): void {
    this.startAmbient({ freq: 55, type: 'sawtooth', wave: 0.35 })
  }

  /** Re-apply the current ambient volume value (call after settings change). */
  refitAmbient(): void {
    if (!this.ambientGain) return
    const vol = ambientVolume()
    this.ambientGain.gain.setValueAtTime(vol, this.ctx?.currentTime ?? 0)
  }

  stopAmbient(): void {
    if (this.ambientSource) {
      try {
        this.ambientSource.stop()
      } catch {
        /* already stopped */
      }
      this.ambientSource = null
    }
  }

  /** Select bleep — pitch by unit class. */
  playSelectBleep(clazz: string): void {
    const pitch = clazz === 'vehicle' ? 0.7 : clazz === 'air' ? 1.2 : 1
    this.playSfx('select', { pitch })
  }

  uiClick(): void {
    this.playTone({ freq: 660, dur: 0.05, type: 'square', gain: 0.03 })
  }

  /** Play a positional weapon fire sound. */
  playWeaponSfx(weaponId: string, x: number, y: number): void {
    const map: Record<string, string> = {
      rifle: 'weapon-rifle',
      rocket: 'weapon-rocket',
      cannon: 'weapon-cannon',
      artillery: 'weapon-artillery',
      'air-cannon': 'weapon-air-cannon',
      aa: 'weapon-rifle',
      'turret-gun': 'weapon-cannon',
    }
    const kind = map[weaponId]
    if (!kind) return
    this.playSfx(kind, { x, y, gain: 0.05 })
  }

  onEvent(e: SimEvent): void {
    switch (e.type) {
      case 'unit-trained':
        this.playTone({ freq: 880, dur: 0.08 })
        break
      case 'building-completed':
        this.playTone({ freq: 520, dur: 0.12, type: 'triangle', gain: 0.07 })
        break
      case 'upgrade-completed':
        this.playTone({ freq: 720, dur: 0.18, type: 'sine', gain: 0.06 })
        break
      case 'supply-harvested':
        this.playTone({ freq: 1320, dur: 0.06, type: 'sine', gain: 0.04 })
        break
      case 'combat-hit':
        this.playTone({ freq: 120 + (e.damage % 80), dur: 0.04, type: 'sawtooth', gain: 0.025 })
        break
      case 'laser-strike':
        this.playTone({ freq: 90, dur: 0.9, type: 'sawtooth', gain: 0.07 })
        this.playTone({ freq: 180, dur: 0.5, type: 'square', gain: 0.04 })
        break
      case 'power-down':
        this.playTone({ freq: 140, dur: 0.25, type: 'sawtooth', gain: 0.06 })
        break
      case 'game-over':
        this.playTone({ freq: e.winner !== null ? 440 : 220, dur: 0.5, type: 'triangle', gain: 0.08 })
        break
      default:
        break
    }
  }
}
