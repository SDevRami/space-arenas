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

  /** Synth drone params for the current ambient layer (used when no audio files exist). */
  private ambientSynthSpec: { freq?: number; type?: OscillatorType; wave?: number } | null = null
  /** Which sound id the ambient layer reads its file overrides from (e.g. 'ambient-lobby'). */
  private ambientKind: string | null = null
  /** Clean-up token so a stale async ambient build can't start a new layer. */
  private ambientGen = 0
  /** Audio buffers backing the ambient file loop. */
  private ambientBuffers: AudioBuffer[] = []
  /** Current shuffled play order over ambientBuffers. */
  private ambientOrder: number[] = []
  private ambientPos = 0
  /** The currently playing ambient file source (null when using the synth drone). */
  private ambientFile: AudioBufferSourceNode | null = null

  /** Resolved variant file lists per override folder (cached). */
  private variants = new Map<string, string[]>()
  /** In-flight probes per override folder. */
  private variantsLoading = new Map<string, Promise<string[]>>()
  /** Per-sound shuffle deck of variant URLs (SFX, no immediate repeats). */
  private sfxDecks = new Map<string, string[]>()
  private sfxIndex = new Map<string, number>()

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
    if (this.ctx && this.ambientKind) this.buildAmbient(this.ambientKind, this.ambientSynthSpec ?? {})
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
   * Play an effect sound. A single-file `opts.url` plays that file directly. Otherwise
   * the user override for `kind` is used: a file path (…/x.wav / .mp3 / .ogg / .m4a)
   * plays that file, while a folder path (…/audio_id/) is probed for `v1.wav, v2.wav,
   * …` and one variant is picked per play (shuffled, no immediate repeats).
   * Positional falloff is applied when `x`/`y` are supplied.
   */
  playSfx(kind: string, opts: SfxOpts = {}): void {
    if (opts.url && opts.url.length > 0) {
      void this.playAsset(kind, opts.url, opts)
      return
    }
    const o = getAudio().overrides[kind]
    if (o && o.length > 0) {
      void this.playVariants(kind, opts)
      return
    }
    this.synthSfx(kind, opts)
  }

  /** Resolve the override for `kind` into a list of candidate file URLs (empty = synth). */
  private async overrideUrls(kind: string): Promise<string[]> {
    const o = getAudio().overrides[kind]
    if (!o || o.length === 0) return []
    if (/\.(wav|mp3|ogg|m4a)$/i.test(o)) return [o]
    return this.resolveVariants(o)
  }

  /** Resolve a folder override into its `v1, v2, …` variant files (probed + cached). */
  private async resolveVariants(folder: string): Promise<string[]> {
    const cached = this.variants.get(folder)
    if (cached) return cached
    const inflight = this.variantsLoading.get(folder)
    if (inflight) return inflight
    const p = this.probeVariants(folder)
    this.variantsLoading.set(folder, p)
    try {
      const urls = await p
      this.variants.set(folder, urls)
      return urls
    } finally {
      this.variantsLoading.delete(folder)
    }
  }

  /** Probe `folder/v1.wav`, `folder/v2.wav`, … until the first one 404s. */
  private async probeVariants(folder: string): Promise<string[]> {
    const urls: string[] = []
    let i = 1
    for (; i <= 100; i++) {
      const u = `${folder}v${i}.wav`
      try {
        const resp = await fetch(u, { method: 'HEAD' })
        if (!resp.ok) break
        urls.push(u)
      } catch {
        break
      }
    }
    return urls
  }

  /** Pick the next variant for a sound from its (auto-shuffled) deck. */
  private nextVariant(kind: string, urls: string[]): string {
    let deck = this.sfxDecks.get(kind)
    let idx = this.sfxIndex.get(kind) ?? 0
    if (!deck || idx >= deck.length) {
      deck = [...urls]
      for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        const tmp = deck[i]
        deck[i] = deck[j]
        deck[j] = tmp
      }
      idx = 0
      this.sfxDecks.set(kind, deck)
      this.sfxIndex.set(kind, 0)
    }
    this.sfxIndex.set(kind, idx + 1)
    return deck[idx]
  }

  /** Play one random variant from the override folder for `kind` (synth if none). */
  private async playVariants(kind: string, opts: SfxOpts): Promise<void> {
    const urls = await this.overrideUrls(kind)
    if (urls.length === 0) {
      this.synthSfx(kind, { ...opts })
      return
    }
    const url = this.nextVariant(kind, urls)
    await this.playAsset(kind, url, opts)
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
      case 'base-alert':
        this.playTone({ freq: 880, dur: 0.09, type: 'square', gain: g * 0.6 })
        this.playTone({ freq: 660, dur: 0.09, type: 'square', gain: g * 0.6, delay: 0.12 })
        this.playTone({ freq: 880, dur: 0.09, type: 'square', gain: g * 0.6, delay: 0.24 })
        break
      case 'unit-trained':
        this.playTone({ freq: 880, dur: 0.08, gain: g })
        break
      case 'building-completed':
        this.playTone({ freq: 520, dur: 0.12, type: 'triangle', gain: g })
        break
      case 'upgrade-completed':
        this.playTone({ freq: 720, dur: 0.18, type: 'sine', gain: g })
        break
      case 'supply-harvested':
        this.playTone({ freq: 1320, dur: 0.06, type: 'sine', gain: g })
        break
      case 'combat-hit':
        this.playTone({ freq: 120 + ((opts.pitch ?? 0) % 80), dur: 0.04, type: 'sawtooth', gain: g })
        break
      case 'laser-strike':
        this.playTone({ freq: 90, dur: 0.9, type: 'sawtooth', gain: g })
        this.playTone({ freq: 180, dur: 0.5, type: 'square', gain: g * 0.6 })
        break
      case 'power-down':
        this.playTone({ freq: 140, dur: 0.25, type: 'sawtooth', gain: g })
        break
      case 'game-over':
        this.playTone({ freq: (opts.pitch ?? 1) >= 1 ? 440 : 220, dur: 0.5, type: 'triangle', gain: g })
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
      const audioBuf = await this.fetchBuffer(url)
      if (!audioBuf) return
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

  /** Start (or refit) the ambient layer; idempotent. The layer reads its file
   * overrides from `kind`, falling back to a synth drone shaped by `synthSpec`
   * when no audio files exist. File variants play one after another in a
   * shuffled order that loops. */
  startAmbient(kind: string, synthSpec: { freq?: number; type?: OscillatorType; wave?: number } = {}): void {
    this.ambientKind = kind
    this.ambientSynthSpec = synthSpec
    if (!this.ctx || !this.ambientGain) return
    void this.buildAmbient(kind, synthSpec)
  }

  private buildSynthAmbient(spec: { freq?: number; type?: OscillatorType; wave?: number }): void {
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

  /** Build the ambient layer for `kind`; uses file variants when present, else the synth drone. */
  private async buildAmbient(kind: string, synthSpec: { freq?: number; type?: OscillatorType; wave?: number }): Promise<void> {
    const ctx = this.ctx
    const ambient = this.ambientGain
    if (!ctx || !ambient) return
    this.stopAmbient()
    this.ambientGen++
    const gen = this.ambientGen
    const urls = await this.overrideUrls(kind)
    if (gen !== this.ambientGen) return
    const buffers: AudioBuffer[] = []
    for (const u of urls) {
      const b = await this.fetchBuffer(u)
      if (gen !== this.ambientGen) return
      if (b) buffers.push(b)
    }
    if (gen !== this.ambientGen) return
    if (buffers.length === 0) {
      this.buildSynthAmbient(synthSpec)
      return
    }
    this.ambientBuffers = buffers
    this.ambientOrder = buffers.map((_, i) => i)
    this.shuffle(this.ambientOrder)
    this.ambientPos = 0
    this.playNextAmbientFile()
  }

  /** Play the next ambient file variant (shuffled rotation, loops). */
  private playNextAmbientFile(): void {
    const ctx = this.ctx
    const ambient = this.ambientGain
    if (!ctx || !ambient) return
    const gen = this.ambientGen
    if (this.ambientPos >= this.ambientOrder.length) {
      this.ambientOrder = this.ambientBuffers.map((_, i) => i)
      this.shuffle(this.ambientOrder)
      this.ambientPos = 0
    }
    const buf = this.ambientBuffers[this.ambientOrder[this.ambientPos++]]
    if (!buf) return
    const src = ctx.createBufferSource()
    src.buffer = buf
    const g = ctx.createGain()
    const t = ctx.currentTime
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(1, t + Math.min(0.5, buf.duration / 2))
    g.gain.setValueAtTime(1, t + buf.duration - Math.min(0.5, buf.duration / 2))
    g.gain.exponentialRampToValueAtTime(0.0001, t + buf.duration)
    src.connect(g)
    g.connect(ambient)
    src.onended = () => {
      if (gen !== this.ambientGen) return
      this.ambientFile = null
      this.playNextAmbientFile()
    }
    src.start(t)
    this.ambientFile = src
  }

  /** Start the lobby ambient layer (own sound id/file overrides). */
  startLobbyAmbient(): void {
    this.startAmbient('ambient-lobby', { freq: 49, type: 'sawtooth', wave: 0.2 })
  }

  /** Start the in-game ambient layer (own sound id/file overrides). */
  startGameAmbient(): void {
    this.startAmbient('ambient-game', { freq: 55, type: 'sawtooth', wave: 0.35 })
  }

  /** Re-apply the current ambient volume value (call after settings change). */
  refitAmbient(): void {
    if (!this.ambientGain) return
    const vol = ambientVolume()
    this.ambientGain.gain.setValueAtTime(vol, this.ctx?.currentTime ?? 0)
  }

  stopAmbient(): void {
    this.ambientGen++
    if (this.ambientSource) {
      try {
        this.ambientSource.stop()
      } catch {
        /* already stopped */
      }
      this.ambientSource = null
    }
    if (this.ambientFile) {
      try {
        this.ambientFile.onended = null
        this.ambientFile.stop()
      } catch {
        /* already stopped */
      }
      this.ambientFile = null
    }
    this.ambientBuffers = []
    this.ambientOrder = []
    this.ambientPos = 0
  }

  /** Fetch + decode an audio file into a buffer; null on failure. */
  private async fetchBuffer(url: string): Promise<AudioBuffer | null> {
    const ctx = this.ctx
    if (!ctx) return null
    try {
      const resp = await fetch(url)
      if (!resp.ok) return null
      const buf = await resp.arrayBuffer()
      return await ctx.decodeAudioData(buf)
    } catch {
      return null
    }
  }

  private shuffle<T>(arr: T[]): void {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      const tmp = arr[i]
      arr[i] = arr[j]
      arr[j] = tmp
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

  /** Alarm when one of our buildings takes enemy damage. */
  baseAlert(x: number, y: number): void {
    this.playSfx('base-alert', { x, y, gain: 0.08 })
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
        this.playSfx('unit-trained')
        break
      case 'building-completed':
        this.playSfx('building-completed', { gain: 0.07 })
        break
      case 'upgrade-completed':
        this.playSfx('upgrade-completed', { gain: 0.06 })
        break
      case 'supply-harvested':
        this.playSfx('supply-harvested', { gain: 0.04 })
        break
      case 'combat-hit':
        this.playSfx('combat-hit', { pitch: e.damage, gain: 0.025 })
        break
      case 'laser-strike':
        this.playSfx('laser-strike', { gain: 0.07 })
        break
      case 'power-down':
        this.playSfx('power-down', { gain: 0.06 })
        break
      case 'game-over':
        this.playSfx('game-over', { pitch: e.winner !== null ? 1 : 0.5, gain: 0.08 })
        break
      default:
        break
    }
  }
}
