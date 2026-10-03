import type { SimEvent } from '../core/events.ts'
import { effectsVolume, ambientVolume, ambientInMatchVolume, getAudio, getTuning, onChangeAudio, SOUND_FILE_NAMES } from './settings.ts'
import type { WeatherId } from '../ui/graphics.ts'

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

/** Drone params shaping the ambient synth when no override files exist. */
export type AmbientSynthSpec = {
  freq?: number
  type?: OscillatorType
  wave?: number
}

/** Drone spec per ambient sound id (built-in fallback for an empty override). */
export const AMBIENT_SYNTH: Record<string, AmbientSynthSpec> = {
  'ambient-lobby': { freq: 49, type: 'sawtooth', wave: 0.2 },
  'ambient-game': { freq: 55, type: 'sawtooth', wave: 0.35 },
  'rain-ambient': { freq: 62, type: 'sawtooth', wave: 0.6 },
  'snow-ambient': { freq: 38, type: 'triangle', wave: 0.15 },
  'storm-ambient': { freq: 30, type: 'sawtooth', wave: 0.9 },
}

/** Live state of one ambient layer (main or weather). */
interface AmbientState {
  gain: GainNode | null
  kind: string | null
  synthSpec: AmbientSynthSpec
  /** Clean-up token so a stale async build can't start a new layer. */
  gen: number
  buffers: AudioBuffer[]
  order: number[]
  pos: number
  source: OscillatorNode | null
  file: AudioBufferSourceNode | null
}

const newAmbientState = (): AmbientState => ({
  gain: null,
  kind: null,
  synthSpec: {},
  gen: 0,
  buffers: [],
  order: [],
  pos: 0,
  source: null,
  file: null,
})

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v))

export class AudioHooks {
  private ctx: AudioContext | null = null
  private masterGain: GainNode | null = null
  /** Main ambient layer (lobby/in-match drones & file loops). */
  private ambient: AmbientState = newAmbientState()
  /** Weather ambient layer — layered over the main ambient while in a match. */
  private weather: AmbientState = newAmbientState()

  /** World (fx) position of the listener — updated by Game each frame from the camera center. */
  listenerX = 0
  listenerY = 0

  /** Resolved variant file lists per override folder (cached). */
  private variants = new Map<string, string[]>()
  /** In-flight probes per override folder. */
  private variantsLoading = new Map<string, Promise<string[]>>()
  /** Per-sound shuffle deck of variant URLs (SFX, no immediate repeats). */
  private sfxDecks = new Map<string, string[]>()
  private sfxIndex = new Map<string, number>()

  constructor() {
    onChangeAudio(() => {
      if (this.ctx) this.refitAmbient()
    })
  }

  unlock(): void {
    if (this.ctx) return
    try {
      this.ctx = new AudioContext()
      this.masterGain = this.ctx.createGain()
      this.masterGain.connect(this.ctx.destination)
      this.ambient.gain = this.ctx.createGain()
      this.ambient.gain.connect(this.masterGain)
      this.weather.gain = this.ctx.createGain()
      this.weather.gain.connect(this.masterGain)
      this.refitAmbient()
    } catch {
      this.ctx = null
    }
    if (this.ctx && this.ambient.kind) void this.buildLayer(this.ambient, this.ambient.kind, this.ambient.synthSpec)
    if (this.ctx && this.weather.kind) void this.buildLayer(this.weather, this.weather.kind, this.weather.synthSpec)
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
    void this.playVariants(kind, opts)
  }

  /** Files the current override for `kind` resolves to (empty = built-in synth).
   * Uses the same resolution as playback — handy for the dev-settings Play button.
   * Only files that exist are listed (deleting a variant drops it from the shuffle). */
  async availableSounds(kind: string): Promise<string[]> {
    return this.overrideUrls(kind)
  }

  /** End-to-end diagnosis for `kind`: context state, volumes, resolved files, then
   * fetch+decode of the first file. Rendered by the dev-settings Play button. */
  async diagnose(kind: string): Promise<string> {
    const parts: string[] = []
    if (!this.ctx) parts.push('ctx: none (page not unlocked)')
    else parts.push(`ctx: ${this.ctx.state === 'running' ? 'running' : this.ctx.state}`)
    const a = getAudio()
    parts.push(`vol: fx ${effectsVolume().toFixed(2)} (master ${a.master.toFixed(2)} x effects ${a.effects.toFixed(2)}${a.muted ? ', MUTED' : ''})`)
    const o = getAudio().overrides[kind]
    parts.push(`override: ${o && o.length > 0 ? JSON.stringify(o) : '(none)'}`)
    const urls = await this.overrideUrls(kind)
    if (urls.length === 0) {
      parts.push('resolved: none — built-in synth')
      return parts.join(' | ')
    }
    parts.push(`resolved: ${urls.join(', ')}`)
    if (!this.ctx) return parts.join(' | ')
    const url = urls[0]
    try {
      const resp = await fetch(url)
      if (!resp.ok) return parts.concat(`${url}: HTTP ${resp.status}`).join(' | ')
      const buf = await resp.arrayBuffer()
      parts.push(`${url}: fetched ${buf.byteLength} B`)
      try {
        const ab = await this.ctx.decodeAudioData(buf)
        parts.push(`decoded: ${ab.duration.toFixed(2)}s ${ab.sampleRate}Hz ch${ab.numberOfChannels}`)
      } catch (e) {
        parts.push(`DECODE-FAIL: ${e instanceof Error ? e.message : String(e)}`)
      }
    } catch (e) {
      parts.push(`${url}: FETCH-FAIL ${e instanceof Error ? e.message : String(e)}`)
    }
    return parts.join(' | ')
  }

  /** A short 880 Hz square tone straight through the master gain — proves the
   * audio graph and speakers work independently of any sound files. */
  ping(): void {
    if (!this.ctx) this.unlock()
    this.playTone({ freq: 880, dur: 0.15, type: 'square', gain: 0.25 })
  }

  /** Resolve the override for `kind` into a list of candidate file URLs (empty = synth). */
  /** Resolve audio for `kind` into a list of candidate file URLs (empty = synth).
   * An explicit override (file or folder) wins. With no override the bundled
   * `sound/<kind>/<name>.wav` is probed when `kind` has a bundled name — a single
   * request, no 404 hunting. */
  private async overrideUrls(kind: string): Promise<string[]> {
    const o = getAudio().overrides[kind]
    if (o && o.length > 0) {
      if (/\.(wav|mp3|ogg|m4a)$/i.test(o)) return [o]
      return this.resolveVariants(o, kind)
    }
    const name = SOUND_FILE_NAMES[kind]
    if (!name) return []
    const folder = `sound/${kind}/`
    const cached = this.variants.get(folder)
    if (cached) return cached
    try {
      const resp = await fetch(`${folder}${name}`, { method: 'HEAD' })
      const urls = resp.ok ? [`${folder}${name}`] : []
      this.variants.set(folder, urls)
      return urls
    } catch {
      this.variants.set(folder, [])
      return []
    }
  }

  /** Resolve a folder override into its variant files (probed + cached).
   * Checks the bundled single-file name (`<folder><SOUND_FILE_NAMES[kind]>`)
   * first, falling back to the legacy `v1.wav … v12.wav` pool layout. */
  private async resolveVariants(folder: string, kind: string): Promise<string[]> {
    const cached = this.variants.get(folder)
    if (cached) return cached
    const inflight = this.variantsLoading.get(folder)
    if (inflight) return inflight
    const p = this.probeVariants(folder, kind)
    this.variantsLoading.set(folder, p)
    try {
      const urls = await p
      this.variants.set(folder, urls)
      return urls
    } finally {
      this.variantsLoading.delete(folder)
    }
  }

  /** Probe a folder's audio files: the bundled name for `kind` first, then the
   * legacy `v1.wav … v12.wav` pool. Only files actually present are returned,
   * so deleting a file drops it immediately without 404 noise. */
  private async probeVariants(folder: string, kind: string): Promise<string[]> {
    const probe = async (u: string): Promise<boolean> => {
      try {
        const resp = await fetch(u, { method: 'HEAD' })
        return resp.ok
      } catch {
        return false
      }
    }
    const urls: string[] = []
    const bundled = SOUND_FILE_NAMES[kind]
    if (bundled) {
      const u = `${folder}${bundled}`
      if (await probe(u)) urls.push(u)
    }
    if (urls.length === 0) {
      for (let i = 1; i <= 12; i++) {
        const u = `${folder}v${i}.wav`
        if (await probe(u)) urls.push(u)
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
    const tun = getTuning(kind)
    const scale = this.positional(opts.x, opts.y)
    const g = (opts.gain ?? 0.05) * scale * tun.vol
    if (g <= 0.0001) return
    const p = (opts.pitch ?? 1) * tun.pitch
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
      case 'sw-chosen':
        this.playTone({ freq: 620, dur: 0.12, type: 'triangle', gain: g })
        this.playTone({ freq: 880, dur: 0.18, type: 'triangle', gain: g * 0.7 })
        break
      case 'airstrike-bomb':
        this.playTone({ freq: 180, dur: 1.2, type: 'sawtooth', sweepTo: 45, gain: g * 1.2 })
        this.playTone({ freq: 60, dur: 1.0, type: 'sine', gain: g * 0.8 })
        break
      case 'airstrike-called':
      case 'emp-strike':
        this.playTone({ freq: 210, dur: 0.7, type: 'triangle', gain: g * 0.8 })
        this.playTone({ freq: 660, dur: 0.5, type: 'sine', gain: g * 0.6 })
        this.playTone({ freq: 100, dur: 0.9, type: 'sawtooth', sweepTo: 40, gain: g * 0.5 })
        break
      case 'grenade-exploded':
        this.playTone({ freq: 240, dur: 0.4, type: 'square', sweepTo: 70, gain: g })
        this.playTone({ freq: 90, dur: 0.45, type: 'sawtooth', sweepTo: 40, gain: g * 0.7 })
        break
      case 'smoke-landed':
        this.playTone({ freq: 420, dur: 0.35, type: 'triangle', sweepTo: 160, gain: g * 0.35 })
        this.playTone({ freq: 90, dur: 0.4, type: 'sine', gain: g * 0.2 })
        break
      case 'power-down':
        this.playTone({ freq: 140, dur: 0.25, type: 'sawtooth', gain: g })
        break
      case 'game-over':
        this.playTone({ freq: (opts.pitch ?? 1) >= 1 ? 440 : 220, dur: 0.5, type: 'triangle', gain: g })
        break
      case 'victory':
        this.playTone({ freq: 523, dur: 0.16, type: 'triangle', gain: g * 0.8 })
        this.playTone({ freq: 659, dur: 0.16, type: 'triangle', gain: g * 0.8, delay: 0.14 })
        this.playTone({ freq: 784, dur: 0.16, type: 'triangle', gain: g * 0.8, delay: 0.28 })
        this.playTone({ freq: 1046, dur: 0.42, type: 'sine', gain: g * 0.7, delay: 0.42 })
        break
      case 'achievement':
        this.playTone({ freq: 1318, dur: 0.14, type: 'triangle', gain: g * 0.8 })
        this.playTone({ freq: 1760, dur: 0.2, type: 'triangle', gain: g * 0.7, delay: 0.1 })
        this.playTone({ freq: 2349, dur: 0.28, type: 'sine', gain: g * 0.55, delay: 0.2 })
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
      if (!audioBuf) {
        this.synthSfx(kind, { ...opts, url: undefined })
        return
      }
      const src = ctx.createBufferSource()
      src.buffer = audioBuf
      const g = ctx.createGain()
      const tun = getTuning(kind)
      const scale = this.positional(opts.x, opts.y)
      const vol = effectsVolume() * (opts.gain ?? 1) * scale * tun.vol
      if (vol <= 0.0001) return
      const rate = (opts.pitch ?? 1) * tun.pitch
      const release = Math.max(0, audioBuf.duration - 0.05)
      g.gain.setValueAtTime(vol, ctx.currentTime)
      if (release > 0) g.gain.setValueAtTime(vol, ctx.currentTime + release)
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + audioBuf.duration)
      if (rate !== 1) src.playbackRate.value = rate
      src.connect(g)
      g.connect(master)
      src.start()
    } catch {
      // asset failed to load or decode — fall back to the synth for this kind
      this.synthSfx(kind, { ...opts, url: undefined })
    }
  }

  /** Start (or refit) the main ambient layer; idempotent. The layer reads its file
   * overrides from `kind`, falling back to a synth drone shaped by `synthSpec`
   * when no audio files exist. File variants play one after another in a
   * shuffled order that loops. */
  startAmbient(kind: string, synthSpec: AmbientSynthSpec = {}): void {
    this.ambient.kind = kind
    this.ambient.synthSpec = synthSpec
    if (!this.ctx) return
    this.refitAmbient()
    void this.buildLayer(this.ambient, kind, synthSpec)
  }

  private buildSynthLayer(state: AmbientState, spec: AmbientSynthSpec): void {
    const ctx = this.ctx
    if (!ctx || !state.gain) return
    if (state.source) return
    const t = ctx.currentTime
    const tun = getTuning(state.kind ?? 'ambient-game')
    const src = ctx.createOscillator()
    src.type = spec.type ?? 'sawtooth'
    src.frequency.setValueAtTime((spec.freq ?? 55) * tun.pitch, t)
    const lfo = ctx.createOscillator()
    lfo.type = 'sine'
    lfo.frequency.setValueAtTime(spec.wave ?? 0.3, t)
    const lfoGain = ctx.createGain()
    lfoGain.gain.setValueAtTime(20, t)
    lfo.connect(lfoGain)
    lfoGain.connect(src.frequency)
    const tunGain = ctx.createGain()
    tunGain.gain.setValueAtTime(Math.max(0.0001, tun.vol), t)
    src.connect(tunGain)
    tunGain.connect(state.gain)
    src.start(t)
    lfo.start(t)
    state.source = src
    this.refitAmbient()
  }

  /** Build the ambient layer for `kind`; uses file variants when present, else the synth drone. */
  private async buildLayer(state: AmbientState, kind: string, synthSpec: AmbientSynthSpec): Promise<void> {
    const ctx = this.ctx
    if (!ctx || !state.gain) return
    this.stopLayer(state)
    state.gen++
    const gen = state.gen
    const urls = await this.overrideUrls(kind)
    if (gen !== state.gen) return
    const buffers: AudioBuffer[] = []
    for (const u of urls) {
      const b = await this.fetchBuffer(u)
      if (gen !== state.gen) return
      if (b) buffers.push(b)
    }
    if (gen !== state.gen) return
    if (buffers.length === 0) {
      this.buildSynthLayer(state, synthSpec)
      return
    }
    state.buffers = buffers
    state.order = buffers.map((_, i) => i)
    this.shuffle(state.order)
    state.pos = 0
    this.playNextFile(state)
  }

  /** Play the next ambient file variant (shuffled rotation, loops). */
  private playNextFile(state: AmbientState): void {
    const ctx = this.ctx
    if (!ctx || !state.gain) return
    const gen = state.gen
    if (state.pos >= state.order.length) {
      state.order = state.buffers.map((_, i) => i)
      this.shuffle(state.order)
      state.pos = 0
    }
    const buf = state.buffers[state.order[state.pos++]]
    if (!buf) return
    const src = ctx.createBufferSource()
    src.buffer = buf
    const g = ctx.createGain()
    const tun = getTuning(state.kind ?? 'ambient-game')
    const peak = Math.max(0.0001, tun.vol)
    const t = ctx.currentTime
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(peak, t + Math.min(0.5, buf.duration / 2))
    g.gain.setValueAtTime(peak, t + buf.duration - Math.min(0.5, buf.duration / 2))
    g.gain.exponentialRampToValueAtTime(0.0001, t + buf.duration)
    if (tun.pitch !== 1) src.playbackRate.value = tun.pitch
    src.connect(g)
    g.connect(state.gain)
    this.refitAmbient()
    src.onended = () => {
      if (gen !== state.gen) return
      state.file = null
      this.playNextFile(state)
    }
    src.start(t)
    state.file = src
  }

  /** Start the lobby ambient layer (own sound id/file overrides). */
  startLobbyAmbient(): void {
    this.startAmbient('ambient-lobby', AMBIENT_SYNTH['ambient-lobby'])
  }

  /** Start the in-game ambient layer (own sound id/file overrides). */
  startGameAmbient(): void {
    this.startAmbient('ambient-game', AMBIENT_SYNTH['ambient-game'])
  }

  /** Start the weather ambient layer for `weather`; it layers over the main
   * ambient (the lobby/in-game drone keeps playing underneath). `none` stops it. */
  startWeatherAmbient(weather: WeatherId): void {
    const WEATHER_AMBIENT: Record<Exclude<WeatherId, 'none'>, string> = {
      rain: 'rain-ambient',
      snow: 'snow-ambient',
      thunder: 'storm-ambient',
    }
    const kind: string | null = weather === 'none' ? null : WEATHER_AMBIENT[weather]
    this.weather.kind = kind
    this.weather.synthSpec = kind ? AMBIENT_SYNTH[kind] ?? {} : {}
    if (!this.ctx) return
    this.stopLayer(this.weather)
    if (kind) void this.buildLayer(this.weather, kind, this.weather.synthSpec)
    this.refitAmbient()
  }

  /** Re-apply the current ambient volume values (call after a settings change).
   * The main layer is scoped: lobby ambient uses the lobby slider, in-match uses
   * the in-match slider; the weather layer always uses the in-match slider.
   * Both obey `muted` and the ambient-layer toggle. */
  refitAmbient(): void {
    const t = this.ctx?.currentTime ?? 0
    if (this.ambient.gain) {
      const vol = this.ambient.kind === 'ambient-game' ? ambientInMatchVolume() : ambientVolume()
      this.ambient.gain.gain.setValueAtTime(vol, t)
    }
    if (this.weather.gain) {
      this.weather.gain.gain.setValueAtTime(ambientInMatchVolume(), t)
    }
  }

  private stopLayer(state: AmbientState): void {
    state.gen++
    if (state.source) {
      try {
        state.source.stop()
      } catch {
        /* already stopped */
      }
      state.source = null
    }
    if (state.file) {
      try {
        state.file.onended = null
        state.file.stop()
      } catch {
        /* already stopped */
      }
      state.file = null
    }
    state.buffers = []
    state.order = []
    state.pos = 0
  }

  stopAmbient(): void {
    this.stopLayer(this.ambient)
    this.stopLayer(this.weather)
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
      case 'shield-hit':
        this.playTone({ freq: 320, dur: 0.09, type: 'sine', gain: 0.045 })
        break
      case 'laser-strike':
        this.playSfx('laser-strike', { gain: 0.07 })
        break
      case 'sw-chosen':
        this.playSfx('select', { gain: 0.05 })
        break
      case 'airstrike-called':
        this.playSfx('airstrike-called', { x: e.x, y: e.y, gain: 0.07 })
        break
      case 'airstrike-bomb':
        this.playSfx('bomb-strike', { x: e.x, y: e.y, gain: 0.1 })
        break
      case 'emp-strike':
        this.playSfx('emp-strike', { x: e.x, y: e.y, gain: 0.09 })
        break
      case 'grenade-exploded':
        this.playSfx('grenade-exploded', { x: e.x, y: e.y, gain: 0.08 })
        break
      case 'power-down':
        this.playSfx('power-down', { gain: 0.06 })
        break
      case 'unit-ranked-up':
        this.playTone({ freq: 660 + e.rank * 180, dur: 0.14, type: 'triangle', gain: 0.06 })
        break
      default:
        break
    }
  }
}
