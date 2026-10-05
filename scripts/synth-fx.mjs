import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SR = 44100
const AMBIENT_SR = 22050
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'client', 'dist', 'sound')

const mulberry32 = (seed) => {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const alloc = (seconds, sr, seed) => {
  let n = Math.max(0, Math.round(seconds * sr))
  if (n & 1) n -= 1
  return { n, samples: new Float32Array(n), sr, rng: mulberry32(seed) }
}

const wave = (p, type) => {
  const ph = ((p % 1) + 1) % 1
  if (type === 'square') return ph < 0.5 ? 1 : -1
  if (type === 'saw') return 2 * ph - 1
  if (type === 'triangle') return 1 - 4 * Math.abs(ph - 0.5)
  return Math.sin(2 * Math.PI * ph)
}

const envAt = (t, dur, atk, release) => {
  const a = Math.min(Math.max(0, atk), dur)
  if (t <= a) return a > 0 ? t / a : 1
  const rest = dur - a
  if (rest <= 0) return 0
  const u = Math.max(0, Math.min(1, (t - a) / rest))
  return Math.cos((Math.PI / 2) * Math.pow(u, release))
}

const addTone = (buf, { start = 0, dur, freq, sweepTo = null, type = 'sine', gain = 1, atk = 0.005, release = 1, tremolo = null }) => {
  const i0 = Math.max(0, Math.round(start * buf.sr))
  let count = Math.min(buf.n, Math.max(0, Math.round(dur * buf.sr)))
  if (i0 + count > buf.n) count = Math.max(0, buf.n - i0)
  let phase = 0
  for (let i = 0; i < count; i++) {
    const t = i / buf.sr
    const f = sweepTo != null && sweepTo > 0 ? freq * Math.pow(sweepTo / freq, t / dur) : freq
    phase = (phase + f / buf.sr) % 1
    let s = wave(phase, type)
    const e = envAt(t, dur, atk, release)
    let k = 1
    if (tremolo) {
      k = 1 - tremolo.depth * 0.5 + tremolo.depth * 0.5 * Math.sin(2 * Math.PI * tremolo.rate * t + tremolo.phase)
    }
    buf.samples[i0 + i] += s * e * k * gain
  }
}

const addNoise = (buf, { start = 0, dur, gain = 1, color = 'white', lowpass = null, lowpassTo = null, highpass = null, atk = 0.005, release = 2 }) => {
  const i0 = Math.max(0, Math.round(start * buf.sr))
  let count = Math.min(buf.n, Math.max(0, Math.round(dur * buf.sr)))
  if (i0 + count > buf.n) count = Math.max(0, buf.n - i0)
  let pink = 0
  let brown = 0
  let lp = 0
  let hp = 0
  for (let i = 0; i < count; i++) {
    const t = i / buf.sr
    const w = buf.rng() * 2 - 1
    let x
    if (color === 'pink') {
      pink = pink * 0.96 + w * 0.04
      x = pink * 3.2
    } else if (color === 'brown') {
      brown = Math.max(-1, Math.min(1, brown * 0.995 + w * 0.03))
      x = brown
    } else {
      x = w
    }
    if (lowpass != null) {
      const cutoff = lowpassTo != null && lowpassTo > 0 ? lowpass * Math.pow(lowpassTo / lowpass, t / dur) : lowpass
      const a = Math.min(1, (2 * Math.PI * cutoff) / buf.sr)
      lp += a * (x - lp)
      x = lp
    }
    if (highpass != null) {
      const a = Math.min(1, (2 * Math.PI * highpass) / buf.sr)
      hp += a * (x - hp)
      x = x - hp
    }
    const e = envAt(t, dur, atk, release)
    buf.samples[i0 + i] += x * e * gain
  }
}

const finalize = (buf) => {
  let peak = 0
  for (let i = 0; i < buf.samples.length; i++) {
    const a = Math.abs(buf.samples[i])
    if (a > peak) peak = a
  }
  const scale = peak > 0 ? 0.89 / peak : 1
  for (let i = 0; i < buf.samples.length; i++) {
    buf.samples[i] = Math.tanh(buf.samples[i] * scale * 1.05) * 0.98
  }
  return buf.samples
}

const compose = (seconds, seed, sr, voices) => {
  const buf = alloc(seconds, sr, seed)
  for (const v of voices) {
    if (v.tone) addTone(buf, v.tone)
    else addNoise(buf, v.noise)
  }
  return finalize(buf)
}

const t = (o) => ({ tone: o })
const ns = (o) => ({ noise: o })

const ambient = (kind, v) => {
  const sr = AMBIENT_SR
  const seconds = 45
  const buf = alloc(seconds, sr, 7000 + kind.length * 100 + v * 7)
  const f0 = kind === 'ambient-lobby' ? 49 : 55
  const lfoRate = kind === 'ambient-lobby' ? 0.2 : 0.35
  const lfoDepth = kind === 'ambient-lobby' ? 18 : 22
  const base = v * 1.7 + kind.length
  let ph = 0
  let brown = 0
  for (let i = 0; i < buf.n; i++) {
    const tt = i / sr
    const mod = Math.sin(2 * Math.PI * lfoRate * tt + base)
    const f = f0 + mod * lfoDepth
    ph = (ph + f / sr) % 1
    const saw = 2 * ph - 1
    const w = buf.rng() * 2 - 1
    brown = Math.max(-1, Math.min(1, brown * 0.996 + w * 0.05))
    const swell = 0.6 + 0.4 * Math.sin(2 * Math.PI * 0.045 * tt + base * 2)
    let s = saw * 0.16 + brown * 0.55
    if (kind === 'ambient-game') {
      const pb = (tt % 1.25) / 1.25
      s += pb < 0.12 ? Math.sin((pb / 0.12) * Math.PI) * 0.12 : 0
    }
    s *= swell
    s += Math.sin(2 * Math.PI * 2048 * tt) * 0.015 * Math.sin(2 * Math.PI * 0.07 * tt + base)
    buf.samples[i] = s
  }
  return finalize(buf)
}

const weatherAmbient = (kind, v) => {
  const sr = AMBIENT_SR
  const seconds = 45
  const seed = 8000 + (kind === 'rain' ? 0 : kind === 'snow' ? 250 : 500) + v * 13
  const buf = alloc(seconds, sr, seed)
  const base = v * 2.3
  let lp = 0
  let brown = 0
  if (kind === 'rain' || kind === 'storm') {
    for (let i = 0; i < buf.n; i++) {
      const tt = i / sr
      const w = buf.rng() * 2 - 1
      if (kind === 'storm') {
        // gust envelope swells the rain bed and lifts its brightness twice a loop
        const gust = Math.pow(Math.max(0, Math.sin((2 * Math.PI * tt) / 11 + base)), 2)
        const cutoff = 1500 + gust * 3400
        lp += Math.min(1, (2 * Math.PI * cutoff) / sr) * (w - lp)
        brown = Math.max(-1, Math.min(1, brown * 0.997 + w * 0.035))
        buf.samples[i] = lp * (0.42 + gust * 0.5) + brown * 0.3 * (1 - gust * 0.4)
      } else {
        lp += Math.min(1, (2 * Math.PI * 4200) / sr) * (w - lp)
        brown = Math.max(-1, Math.min(1, brown * 0.997 + w * 0.03))
        const shimmer = 0.88 + 0.12 * Math.sin(2 * Math.PI * 0.23 * tt + base * 1.3)
        buf.samples[i] = lp * 0.5 * shimmer + brown * 0.5 * 0.3
      }
    }
    if (kind === 'storm') {
      // rumble bursts kept clear of the loop edges so the seam is clean
      for (const at of [6.2, 15.7, 25.3, 35.0]) {
        const a = at + v * 0.4
        addNoise(buf, { start: a, dur: 2.1, gain: 0.3, color: 'brown', lowpass: 300, atk: 0.35, release: 2 })
        addTone(buf, { start: a, dur: 3.8, freq: 50, type: 'sine', gain: 0.45, sweepTo: 28, atk: 0.45, release: 2 })
      }
    } else {
      // sparse drip plinks punctuate the steady hiss
      for (const at of [1.8, 5.4, 9.1, 13.6, 18.2, 22.7, 27.4, 31.9, 36.5, 40.8]) {
        const f = 2000 + buf.rng() * 600
        addTone(buf, { start: at, dur: 0.06, freq: f, type: 'sine', gain: 0.05, sweepTo: f * 0.85, atk: 0.002, release: 0.2 })
      }
    }
  } else {
    // snow — soft dry airy hiss breathing on a slow swell
    let pink = 0
    for (let i = 0; i < buf.n; i++) {
      const tt = i / sr
      const w = buf.rng() * 2 - 1
      pink = pink * 0.96 + w * 0.04
      lp += Math.min(1, (2 * Math.PI * 2200) / sr) * (pink * 3.2 - lp)
      const swell = 0.55 + 0.45 * Math.sin((2 * Math.PI * 0.05) * tt + base)
      buf.samples[i] = lp * swell * 0.6
    }
  }
  return finalize(buf)
}

const recipes = {
  select: () => [0, 1].map((v) => compose(0.1, 11 + v, SR, [t({ dur: 0.08, freq: 700 + v * 60, type: 'square', gain: 0.4 }), t({ dur: 0.06, freq: (700 + v * 60) * 1.5, type: 'square', gain: 0.26, start: 0.02 })])),
  'move-bleep': () => [0, 1].map((v) => compose(0.14, 21 + v, SR, [t({ dur: 0.06, freq: 400 + v * 60, type: 'square', gain: 0.38, sweepTo: (400 + v * 60) * 1.18 }), t({ dur: 0.05, freq: (400 + v * 60) * 1.5, type: 'sine', gain: 0.2, start: 0.07 })])),
  alert: () => [0, 1].map((v) => compose(0.38, 31 + v, SR, [t({ dur: 0.1, freq: 880 + v * 40, type: 'square', gain: 0.4 }), t({ dur: 0.1, freq: (880 + v * 40) * 0.75, type: 'square', gain: 0.4, start: 0.13 }), t({ dur: 0.12, freq: 880 + v * 40, type: 'square', gain: 0.34, start: 0.25 })])),
  'weapon-rifle': () => [0, 1, 2].map((v) => compose(0.13, 41 + v, SR, [t({ dur: 0.05, freq: 1500 + v * 120, type: 'square', gain: 0.4 }), ns({ dur: 0.012, gain: 0.5, lowpass: 6500 }), t({ dur: 0.05, freq: 190 - v * 20, type: 'sine', gain: 0.5, sweepTo: 90 })])),
  'weapon-rocket': () => [0, 1, 2].map((v) => compose(0.4, 51 + v, SR, [t({ dur: 0.22, freq: 360 + v * 30, type: 'saw', gain: 0.4, sweepTo: 110 }), ns({ dur: 0.22, gain: 0.3, lowpass: 2600, lowpassTo: 400 }), t({ dur: 0.18, freq: 85, type: 'sine', gain: 0.6, sweepTo: 55, start: 0.2 }), t({ dur: 0.06, freq: 160, type: 'triangle', gain: 0.3, start: 0.2 })])),
  'weapon-cannon': () => [0, 1].map((v) => compose(0.35, 61 + v, SR, [t({ dur: 0.16, freq: 170 + v * 20, type: 'square', gain: 0.5, sweepTo: 75 }), t({ dur: 0.28, freq: 55, type: 'sine', gain: 0.7 }), ns({ dur: 0.12, gain: 0.35, lowpass: 900 }), ns({ dur: 0.03, gain: 0.3, lowpass: 4500 })])),
  'weapon-artillery': () => [0, 1].map((v) => compose(0.7, 71 + v, SR, [t({ dur: 0.4, freq: 260 - v * 20, type: 'saw', gain: 0.4, sweepTo: 50 }), ns({ dur: 0.5, gain: 0.25, lowpass: 1600, lowpassTo: 250 }), t({ dur: 0.6, freq: 46, type: 'sine', gain: 0.75, sweepTo: 34, start: 0.12 })])),
  'weapon-air-cannon': () => [0, 1].map((v) => compose(0.24, 81 + v, SR, [t({ dur: 0.16, freq: 520 - v * 60, type: 'saw', gain: 0.45, sweepTo: 150 }), ns({ dur: 0.1, gain: 0.35, lowpass: 3000, lowpassTo: 1200, tremolo: { rate: 1, depth: 0 } }), t({ dur: 0.08, freq: 880, type: 'sine', gain: 0.25, start: 0.02, tremolo: { rate: 120, depth: 0.6, phase: v } })])),
  'unit-trained': () => [0, 1].map((v) => compose(0.22, 91 + v, SR, [t({ dur: 0.08, freq: 640 + v * 40, type: 'square', gain: 0.4 }), t({ dur: 0.1, freq: (640 + v * 40) * 1.33, type: 'square', gain: 0.32, start: 0.09 })])),
  'building-completed': () => [0, 1].map((v) => compose(0.3, 101 + v, SR, [t({ dur: 0.14, freq: 520 + v * 30, type: 'triangle', gain: 0.5 }), t({ dur: 0.16, freq: (520 + v * 30) * 1.5, type: 'triangle', gain: 0.4, start: 0.1 })])),
  'upgrade-completed': () => [0, 1].map((v) => compose(0.4, 111 + v, SR, [t({ dur: 0.18, freq: 620 + v * 40, type: 'sine', gain: 0.45, sweepTo: 760 + v * 40 }), t({ dur: 0.2, freq: 930 + v * 40, type: 'sine', gain: 0.35, start: 0.12, sweepTo: 1160 + v * 40 })])),
  'supply-harvested': () => [0, 1].map((v) => compose(0.22, 121 + v, SR, [t({ dur: 0.08, freq: 1320 + v * 80, type: 'sine', gain: 0.4 }), t({ dur: 0.1, freq: 1760 + v * 80, type: 'sine', gain: 0.32, start: 0.08 })])),
  'combat-hit': () => [0, 1, 2].map((v) => compose(0.09, 131 + v, SR, [t({ dur: 0.05, freq: 120 + (v * 37) % 80, type: 'saw', gain: 0.5, sweepTo: 160 + (v * 37) % 80 }), ns({ dur: 0.02, gain: 0.4, lowpass: 5500 }), t({ dur: 0.03, freq: 620 + v * 40, type: 'square', gain: 0.2 })])),
  'laser-strike': () => [compose(0.96, 141, SR, [t({ dur: 0.9, freq: 90, type: 'saw', gain: 0.5, tremolo: { rate: 8, depth: 0.12 } }), t({ dur: 0.7, freq: 180, type: 'square', gain: 0.35 }), t({ dur: 0.9, freq: 90, type: 'sine', gain: 0.3, sweepTo: 130 }), ns({ dur: 0.08, gain: 0.2, lowpass: 1500 })])],
  'bomb-strike': () => [compose(1.32, 151, SR, [t({ dur: 1.2, freq: 60, type: 'sine', gain: 0.9, sweepTo: 38 }), t({ dur: 0.9, freq: 70, type: 'saw', gain: 0.35, sweepTo: 40 }), ns({ dur: 0.85, gain: 0.3, lowpass: 500, lowpassTo: 120 }), ns({ dur: 0.12, gain: 0.4, lowpass: 2200, start: 0.02 })])],
  'emp-strike': () => [compose(0.88, 161, SR, [t({ dur: 0.72, freq: 220, type: 'triangle', gain: 0.55, tremolo: { rate: 24, depth: 0.55 } }), t({ dur: 0.35, freq: 660, type: 'sine', gain: 0.4, sweepTo: 880 }), ns({ dur: 0.2, gain: 0.15, lowpass: 4000 })])],
  'power-down': () => [compose(0.46, 171, SR, [t({ dur: 0.28, freq: 140, type: 'saw', gain: 0.5, sweepTo: 55 }), t({ dur: 0.18, freq: 880, type: 'square', gain: 0.2, start: 0.24, sweepTo: 110 })])],
  'game-over': () => [compose(1.05, 181, SR, [t({ dur: 0.35, freq: 330, type: 'triangle', gain: 0.5 }), t({ dur: 0.4, freq: 262, type: 'triangle', gain: 0.45, start: 0.32 }), t({ dur: 0.6, freq: 196, type: 'sine', gain: 0.4, start: 0.7, sweepTo: 150 })])],
  achievement: () => [compose(0.72, 191, SR, [t({ dur: 0.13, freq: 1318, type: 'triangle', gain: 0.5 }), t({ dur: 0.18, freq: 1760, type: 'triangle', gain: 0.45, start: 0.1 }), t({ dur: 0.28, freq: 2349, type: 'sine', gain: 0.4, start: 0.2 })])],
  'ambient-lobby': () => [ambient('ambient-lobby', 0), ambient('ambient-lobby', 1)],
  'ambient-game': () => [ambient('ambient-game', 0), ambient('ambient-game', 1)],
  'rain-ambient': () => [weatherAmbient('rain', 0), weatherAmbient('rain', 1)],
  'snow-ambient': () => [weatherAmbient('snow', 0), weatherAmbient('snow', 1)],
  'storm-ambient': () => [weatherAmbient('storm', 0), weatherAmbient('storm', 1)],
}

const writeWav = (file, sr, samples) => {
  const n = samples.length
  const data = Buffer.alloc(44 + n * 2)
  data.write('RIFF', 0)
  data.writeUInt32LE(36 + n * 2, 4)
  data.write('WAVE', 8)
  data.write('fmt ', 12)
  data.writeUInt32LE(16, 16)
  data.writeUInt16LE(1, 20)
  data.writeUInt16LE(1, 22)
  data.writeUInt32LE(sr, 24)
  data.writeUInt32LE(sr * 2, 28)
  data.writeUInt16LE(2, 32)
  data.writeUInt16LE(16, 34)
  data.write('data', 36)
  data.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) {
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2)
  }
  writeFileSync(file, data)
}

const verify = (file, sr, samples) => {
  const raw = readFileSync(file)
  const okRiff = raw.toString('latin1', 0, 4) === 'RIFF' && raw.toString('latin1', 8, 12) === 'WAVE'
  const actual = raw.readUInt32LE(4)
  const expected = 36 + samples.length * 2
  if (!okRiff || actual !== expected) throw new Error(`corrupt: ${file}`)
}

let files = 0
let bytes = 0
const rows = []
const manifest = {}
for (const [kind, make] of Object.entries(recipes)) {
  const sr = kind.startsWith('ambient') || kind.endsWith('-ambient') ? AMBIENT_SR : SR
  const dir = join(OUT, kind)
  mkdirSync(dir, { recursive: true })
  const audio = make()
  manifest[kind] = audio.length
  audio.forEach((samples, i) => {
    const file = join(dir, `v${i + 1}.wav`)
    writeWav(file, sr, samples)
    verify(file, sr, samples)
    const size = (samples.length * 2 + 44) / 1024
    files++
    bytes += samples.length * 2 + 44
    rows.push([`${kind}/v${i + 1}.wav`, (samples.length / sr).toFixed(2) + 's', `${sr / 1000}kHz`, size.toFixed(1) + 'KB'])
  })
}
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')

for (const r of rows) console.log(r.join('\t'))
console.log(`\n${files} files, ${(bytes / 1024).toFixed(0)} KB total -> ${OUT}`)
console.log(`manifest -> ${join(OUT, 'manifest.json')} (${Object.keys(manifest).length} kinds)`)