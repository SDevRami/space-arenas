import { musicVolume, onChangeAudio } from './settings.ts'

/** The lobby-only background song, shipped in `client/dist/sound/`. Served from the
 *  web root, so `BASE_URL` resolves it both when the host serves `client/dist` and
 *  under `vite preview`. It never plays during a match. */
const TRACK_URL = `${import.meta.env.BASE_URL}sound/SPACE.ARENAS_by_SDEVRAMI.mp3`

/** Cross-fade duration (ms) used for start/stop and mute transitions. */
const FADE_MS = 1200

let el: HTMLAudioElement | null = null
let fadeTimer: number | null = null
/** Whether the lobby *wants* the track playing (independent of the audio graph). */
let wanted = false

const ensureEl = (): HTMLAudioElement | null => {
  if (typeof Audio === 'undefined') return null
  if (!el) {
    el = new Audio(TRACK_URL)
    el.loop = true
    el.preload = 'auto'
    el.volume = 0
  }
  return el
}

const clearFade = (): void => {
  if (fadeTimer !== null) {
    clearInterval(fadeTimer)
    fadeTimer = null
  }
}

const fadeTo = (target: number, ms: number, onDone?: () => void): void => {
  const a = el
  if (!a) return
  clearFade()
  const from = a.volume
  if (ms <= 0 || Math.abs(from - target) < 0.001) {
    a.volume = Math.max(0, Math.min(1, target))
    onDone?.()
    return
  }
  const start = performance.now()
  fadeTimer = window.setInterval(() => {
    const t = Math.min(1, (performance.now() - start) / ms)
    a.volume = Math.max(0, Math.min(1, from + (target - from) * t))
    if (t >= 1) {
      clearFade()
      onDone?.()
    }
  }, 40)
}

const tryPlay = (a: HTMLAudioElement): void => {
  if (!a.paused) return
  void a.play().catch(() => {
    /* still locked by the autoplay policy — retried on the next unlock/start */
  })
}

/** Start (or resume) the lobby music with a fade-in. Safe to call repeatedly. */
export const startLobbyMusic = (): void => {
  const a = ensureEl()
  if (!a) return
  wanted = true
  tryPlay(a)
  fadeTo(musicVolume(), FADE_MS)
}

/** Fade the lobby music out and pause it (used when a match starts). */
export const stopLobbyMusic = (): void => {
  wanted = false
  const a = el
  if (!a) return
  fadeTo(0, FADE_MS, () => { a.pause() })
}

/** Re-apply the effective music volume live (slider / mute / mute-all changes). */
const syncVolume = (): void => {
  const a = el
  if (!a) return
  const v = musicVolume()
  if (!wanted) {
    a.volume = 0
    return
  }
  if (v > 0) {
    tryPlay(a)
    fadeTo(v, 300)
  } else {
    fadeTo(0, 300, () => { a.pause() })
  }
}

onChangeAudio(syncVolume)
