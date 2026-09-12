const STORAGE_KEY = 'space-arenas:audio'

export interface AudioSettings {
  /** Master volume 0..1. */
  master: number
  /** UI / SFX volume 0..1 (scaled by master). */
  effects: number
  /** Ambient (lobby drone / in-game hum) volume 0..1. */
  ambient: number
  /** Master mute. */
  muted: boolean
  /** Ambient layer on/off. */
  ambientEnabled: boolean
  /** Mobile vibration on/off. */
  haptics: boolean
  /** user-provided override URL for a sound type; empty = synth fallback. */
  overrides: Record<string, string>
}

const DEFAULTS: AudioSettings = {
  master: 1,
  effects: 0.8,
  ambient: 0.35,
  muted: false,
  ambientEnabled: false,
  haptics: true,
  overrides: {},
}

/** Every sound kind played in the game, overridable via the dev-settings Audio
 * section. An override may be a single audio file (…/x.wav/.mp3/.ogg/.m4a) or a
 * folder path (`sound/<id>/`) containing `v1.wav, v2.wav, …` — for ordinary
 * sounds one variant is shuffled per play; for `ambient-lobby`/`ambient-game`
 * the files play one-after-another in a shuffled loop. Empty override = synth.
 * The `ambient-lobby` files differ from the `ambient-game` files. */
export const SOUND_IDS = [
  'select',
  'move-bleep',
  'alert',
  'weapon-rifle',
  'weapon-rocket',
  'weapon-cannon',
  'weapon-artillery',
  'weapon-air-cannon',
  'unit-trained',
  'building-completed',
  'upgrade-completed',
  'supply-harvested',
  'combat-hit',
  'laser-strike',
  'bomb-strike',
  'emp-strike',
  'power-down',
  'game-over',
  'ambient-lobby',
  'ambient-game',
] as const
export type SoundId = (typeof SOUND_IDS)[number]

const load = (): AudioSettings => {
  const base: AudioSettings = { ...DEFAULTS, overrides: { ...DEFAULTS.overrides } }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AudioSettings>
      if (typeof parsed.master === 'number' && Number.isFinite(parsed.master)) base.master = clamp01(parsed.master)
      if (typeof parsed.effects === 'number' && Number.isFinite(parsed.effects)) base.effects = clamp01(parsed.effects)
      if (typeof parsed.ambient === 'number' && Number.isFinite(parsed.ambient)) base.ambient = clamp01(parsed.ambient)
      if (typeof parsed.muted === 'boolean') base.muted = parsed.muted
      if (typeof parsed.ambientEnabled === 'boolean') base.ambientEnabled = parsed.ambientEnabled
      if (typeof parsed.haptics === 'boolean') base.haptics = parsed.haptics
      if (parsed.overrides && typeof parsed.overrides === 'object') {
        for (const [k, v] of Object.entries(parsed.overrides)) {
          if (typeof v === 'string') base.overrides[k] = v
        }
      }
    }
  } catch {
    /* storage unavailable */
  }
  return base
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v))

const save = (s: AudioSettings): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
  } catch {
    /* storage unavailable */
  }
}

const state = load()

const changeListeners = new Set<() => void>()
/** Notify consumers (e.g. the live audio context) that a volume/mute setting changed. */
export const onChangeAudio = (cb: () => void): (() => void) => {
  changeListeners.add(cb)
  return () => changeListeners.delete(cb)
}

const notify = (): void => {
  for (const cb of changeListeners) cb()
}

export const getAudio = (): AudioSettings => state

/** Effective effects volume: master * effects (0 when muted). */
export const effectsVolume = (): number => (state.muted ? 0 : state.master * state.effects)

/** Effective ambient volume: master * ambient (0 when muted/disabled). */
export const ambientVolume = (): number => {
  if (state.muted || !state.ambientEnabled) return 0
  return state.master * state.ambient
}

export const isMuted = (): boolean => state.muted

export const setMaster = (v: number): void => {
  state.master = clamp01(v)
  save(state)
  notify()
}

export const setEffects = (v: number): void => {
  state.effects = clamp01(v)
  save(state)
  notify()
}

export const setAmbient = (v: number): void => {
  state.ambient = clamp01(v)
  save(state)
  notify()
}

export const setMuted = (on: boolean): void => {
  state.muted = on
  save(state)
  notify()
}

export const setAmbientEnabled = (on: boolean): void => {
  state.ambientEnabled = on
  save(state)
  notify()
}

export const setHaptics = (on: boolean): void => {
  state.haptics = on
  save(state)
  notify()
}

export const setOverride = (key: string, url: string): void => {
  state.overrides[key] = url
  save(state)
}

export const hapticsEnabled = (): boolean => state.haptics === true && typeof navigator !== 'undefined' && 'vibrate' in navigator
