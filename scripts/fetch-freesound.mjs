import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'client', 'dist', 'sound')
const TMP = join(dirname(fileURLToPath(import.meta.url)), '..', 'client', 'dist', 'sound', '.tmp')
const API = 'https://freesound.org/apiv2'
const PAGE = 15

const TOKEN = process.env.FREESOUND_TOKEN
if (!TOKEN) {
  console.error('set FREESOUND_TOKEN (freesound client API key) before running')
  process.exit(1)
}

const ONLY = new Set(process.argv.slice(2))
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

const KINDS = [
  { kind: 'select', q: 'ui click pop interface', min: 0.05, max: 1.2, count: 2, keywords: ['click', 'button', 'ui', 'select', 'pop', 'interface'], rate: 44100, target: -16 },
  { kind: 'move-bleep', q: 'radar blip sonar', min: 0.05, max: 1.5, count: 2, keywords: ['blip', 'sonar', 'radar', 'beep'], rate: 44100, target: -16 },
  { kind: 'alert', q: 'alarm beep warning', min: 0.2, max: 2.5, count: 2, keywords: ['alarm', 'beep', 'alert', 'warning', 'siren'], rate: 44100, target: -16 },
  { kind: 'weapon-rifle', q: 'rifle gunshot shot', min: 0.1, max: 2, count: 3, keywords: ['rifle', 'gunshot', 'shot', 'gun'], rate: 44100, target: -16 },
  { kind: 'weapon-rocket', q: 'missile rocket', min: 0.1, max: 10, count: 3, keywords: ['rocket', 'missile', 'launch', 'whoosh', 'firing'], rate: 44100, target: -16 },
  { kind: 'weapon-cannon', q: 'cannon blast fire', min: 0.2, max: 3, count: 2, keywords: ['cannon', 'blast', 'boom', 'fire', 'explos'], rate: 44100, target: -16 },
  { kind: 'weapon-artillery', q: 'artillery explosion heavy boom', min: 0.5, max: 8, count: 2, keywords: ['artillery', 'cannon', 'boom', 'explos', 'heavy'], rate: 44100, target: -16 },
  { kind: 'weapon-air-cannon', q: 'machine gun rapid fire', min: 0.1, max: 8, count: 2, keywords: ['gun', 'machine', 'rapid', 'fire'], rate: 44100, target: -16 },
  { kind: 'unit-trained', q: 'bell chime ding', min: 0.05, max: 8, count: 2, keywords: ['bell', 'chime', 'ding', 'notification'], rate: 44100, target: -16 },
  { kind: 'building-completed', q: 'hammer construction', min: 0.05, max: 4, count: 2, keywords: ['hammer', 'clank', 'wood', 'construction'], rate: 44100, target: -16 },
  { kind: 'upgrade-completed', q: 'powerup arcade', min: 0.05, max: 8, count: 2, keywords: ['power', 'arcade', 'up'], rate: 44100, target: -16 },
  { kind: 'supply-harvested', q: 'coin pickup collect cash', min: 0.05, max: 1.5, count: 2, keywords: ['coin', 'pickup', 'collect', 'cash', 'money'], rate: 44100, target: -16 },
  { kind: 'combat-hit', q: 'impact punch thud hit', min: 0.05, max: 1.5, count: 3, keywords: ['impact', 'punch', 'hit', 'thud'], rate: 44100, target: -16 },
  { kind: 'laser-strike', q: 'laser', min: 0.1, max: 10, count: 1, keywords: ['laser', 'beam', 'blaster', 'zap'], rate: 44100, target: -16 },
  { kind: 'bomb-strike', q: 'bomb explosion heavy boom', min: 0.5, max: 6, count: 1, keywords: ['boom', 'explos', 'bomb', 'heavy'], rate: 44100, target: -16 },
  { kind: 'emp-strike', q: 'electric zap', min: 0.05, max: 10, count: 1, keywords: ['shock', 'electric', 'zap', 'static', 'spark'], rate: 44100, target: -16 },
  { kind: 'power-down', q: 'power down machine', min: 0.3, max: 10, count: 1, keywords: ['down', 'shutdown', 'machine', 'power', 'hum'], rate: 44100, target: -16 },
  { kind: 'game-over', q: 'fail', min: 0.3, max: 5, count: 1, keywords: ['fail', 'wa', 'wrong', 'buzz'], rate: 44100, target: -16 },
  { kind: 'achievement', q: 'success chime', min: 0.1, max: 10, count: 1, keywords: ['success', 'chime', 'fanfare', 'victory'], rate: 44100, target: -16 },
  { kind: 'ambient-lobby', q: 'space ambient', min: 15, max: 90, count: 2, keywords: ['loop', 'space', 'ambient', 'drone', 'deep'], rate: 22050, target: -20, loop: true },
  { kind: 'ambient-game', q: 'battle ambience', min: 15, max: 90, count: 2, keywords: ['loop', 'battle', 'war', 'ambience', 'drone'], rate: 22050, target: -20, loop: true },
  { kind: 'rain-ambient', q: 'rain loop ambience', min: 15, max: 90, count: 2, keywords: ['loop', 'rain'], rate: 22050, target: -20, loop: true },
  { kind: 'snow-ambient', q: 'wind loop', min: 15, max: 90, count: 2, keywords: ['wind', 'loop'], rate: 22050, target: -20, loop: true },
  { kind: 'storm-ambient', q: 'thunderstorm rain loop thunder', min: 15, max: 90, count: 2, keywords: ['thunder', 'storm', 'rain', 'loop'], rate: 22050, target: -20, loop: true },
]

const BAD_TOKENS = ['music', 'song', 'melody', 'guitar', 'piano', 'vocal', 'sing', 'choir', 'drum']

const score = (name, keywords, loop) => {
  const n = name.toLowerCase()
  let s = 0
  for (const k of keywords) if (n.includes(k)) s += 1
  if (loop && n.includes('loop')) s += 2
  for (const b of BAD_TOKENS) if (n.includes(b)) s -= 4
  return s
}

const used = new Set()

const pick = (cfg) => {
  const cands = []
  for (let page = 1; page <= 3 && cands.length < cfg.count * 4; page++) {
    const filter = `duration:[${cfg.min} TO ${cfg.max}] license:"Creative Commons 0"`
    const url = `${API}/search/text/?query=${encodeURIComponent(cfg.q)}&filter=${encodeURIComponent(filter)}&fields=id,name,duration,previews,username&page_size=${PAGE}&page=${page}&token=${TOKEN}`
    const res = spawnSync('curl.exe', ['-s', url], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    sleep(220)
    if (res.status !== 0) break
    let results
    try {
      results = JSON.parse(res.stdout).results ?? []
    } catch {
      break
    }
    if (results.length === 0) break
    for (const r of results) cands.push({ ...r, _score: score(r.name, cfg.keywords, cfg.loop) })
  }
  cands.sort((a, b) => b._score - a._score)
  const picks = []
  for (const c of cands) {
    if (picks.length >= cfg.count) break
    if (used.has(c.id)) continue
    if (c._score < 0) continue
    picks.push(c)
    used.add(c.id)
  }
  if (picks.length === 0) {
    for (const c of cands) {
      if (picks.length >= cfg.count) break
      if (used.has(c.id)) continue
      picks.push(c)
      used.add(c.id)
    }
  }
  return picks
}

const probe = (file) => {
  const res = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' })
  return res.status === 0 ? parseFloat(res.stdout.trim()) : NaN
}

mkdirSync(TMP, { recursive: true })
const rows = []
const manifest = {}
const unresolved = []
let failures = 0
for (const cfg of KINDS) {
  if (ONLY.size > 0 && !ONLY.has(cfg.kind)) continue
  const picks = pick(cfg)
  if (picks.length === 0) {
    unresolved.push(cfg.kind)
    console.warn(`WARN  ${cfg.kind}: no usable candidate — keeping generated files`)
    continue
  }
  const dir = join(OUT, cfg.kind)
  mkdirSync(dir, { recursive: true })
  let written = 0
  for (let i = 0; i < picks.length; i++) {
    const c = picks[i]
    const tmp = join(TMP, `${cfg.kind}-v${i + 1}.mp3`)
    let dl = spawnSync('curl.exe', ['-s', '-L', '-o', tmp, c.previews['preview-hq-mp3']], { maxBuffer: 64 * 1024 * 1024 })
    sleep(220)
    if (dl.status !== 0) {
      failures++
      console.warn(`WARN  ${cfg.kind}/v${i + 1}: download failed`)
      continue
    }
    let dur = probe(tmp)
    if (!Number.isFinite(dur) || dur < cfg.min) {
      dl = spawnSync('curl.exe', ['-s', '-L', '-o', tmp, c.previews['preview-hq-mp3']], { maxBuffer: 64 * 1024 * 1024 })
      sleep(220)
      dur = probe(tmp)
    }
    if (!Number.isFinite(dur) || dur < cfg.min) {
      failures++
      console.warn(`WARN  ${cfg.kind}/v${i + 1}: bad duration ${dur}`)
      continue
    }
    const out = join(dir, `v${i + 1}.wav`)
    const f = spawnSync('ffmpeg', ['-y', '-i', tmp, '-ac', '1', '-ar', String(cfg.rate), '-af', `loudnorm=I=${cfg.target}:TP=-1.5:LRA=9`, out], { maxBuffer: 64 * 1024 * 1024 })
    if (f.status !== 0) {
      failures++
      console.warn(`WARN  ${cfg.kind}/v${i + 1}: ffmpeg convert failed`)
      continue
    }
    written++
    rows.push({ kind: cfg.kind, variant: i + 1, id: c.id, name: c.name, user: c.username, url: `https://freesound.org/people/${encodeURIComponent(c.username)}/sounds/${c.id}/` })
    console.log(`OK    ${cfg.kind}/v${i + 1} <- [${c.id}] ${c.name} (${dur.toFixed(2)}s)`)
  }
  if (written === 0) unresolved.push(cfg.kind)
  else manifest[cfg.kind] = written
}

const existing = JSON.parse(readFileSync(join(OUT, 'manifest.json'), 'utf8'))
for (const k of Object.keys(manifest)) existing[k] = manifest[k]
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(existing, null, 2) + '\n')

const credits = new Map()
try {
  for (const line of readFileSync(join(OUT, 'CREDITS.md'), 'utf8').split('\n')) {
    const m = line.match(/^\| (.+?) \| v(\d+) \| \[(\d+)\]\((https:\/\/freesound.*)\) \| (.+?) \| (.+) \|$/)
    if (m) credits.set(`${m[1]}/v${m[2]}`, { kind: m[1], variant: +m[2], id: +m[3], url: m[4], name: m[5], user: m[6] })
  }
} catch {
  /* no credits yet */
}
for (const r of rows) credits.set(`${r.kind}/v${r.variant}`, r)
let cred = '# Sound credits\n\n'
cred += 'Real sounds fetched from [Freesound](https://freesound.org), all **CC0** (no attribution required).\n'
cred += 'Each WAV under `sound/<kind>/` is a mono PCM conversion of the Freesound HQ preview (loudness-matched).\n\n'
cred += '| kind | variant | sound id | name | author |\n|---|---|---|---|---|\n'
const sorted = [...credits.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.variant - b.variant)
for (const r of sorted) cred += `| ${r.kind} | v${r.variant} | [${r.id}](${r.url}) | ${r.name.replace(/\|/g, '/')} | ${r.user} |\n`
writeFileSync(join(OUT, 'CREDITS.md'), cred)

rmSync(TMP, { recursive: true, force: true })

if (rows.length > 0) console.log(`\n${rows.length} sounds fetched -> ${OUT}`)
if (unresolved.length > 0) console.log(`UNRESOLVED (kept generated): ${unresolved.join(', ')}`)
if (failures > 0) console.log(`FAILURES: ${failures}`)