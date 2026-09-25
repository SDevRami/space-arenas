import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/* Adds more CC0 Freesound variants (up to TARGET per kind) to client/dist/sound.
   Existing v*.wav are kept; new files fill up to TARGET. Creative, war/sci-fi RTS
   queries — cross-check the picks in-game (dev settings -> audio -> variant dropdown). */

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'client', 'dist', 'sound')
const TMP = join(dirname(fileURLToPath(import.meta.url)), '..', 'client', 'dist', 'sound', '.tmp')
const API = 'https://freesound.org/apiv2'
const PAGE = 15
const TARGET = 12

const TOKEN = process.env.FREESOUND_TOKEN
if (!TOKEN) {
  console.error('set FREESOUND_TOKEN (freesound client API key) before running')
  process.exit(1)
}

const ONLY = new Set(process.argv.slice(2))
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

const KINDS = [
  { kind: 'select', q: 'mouse click keyboard', alt: 'button press click sound', min: 0.05, max: 1.5, keywords: ['click', 'button', 'ui', 'pop', 'select', 'interface', 'tap', 'key'], melodic: true, rate: 44100, target: -16 },
  { kind: 'move-bleep', q: 'sonar ping radar', alt: 'digital beep tone short', min: 0.05, max: 4, keywords: ['blip', 'sonar', 'radar', 'ping', 'beep', 'pulse', 'beeper'], melodic: true, rate: 44100, target: -16 },
  { kind: 'alert', q: 'alarm klaxon buzzer siren', alt: 'horn klaxon warning blast', min: 0.2, max: 6, keywords: ['alarm', 'siren', 'klaxon', 'buzzer', 'beep', 'warning', 'alert', 'horn'], melodic: true, rate: 44100, target: -16 },
  { kind: 'weapon-rifle', q: 'rifle gunshot burst', alt: 'gunshot single fire gun', min: 0.05, max: 4, keywords: ['rifle', 'gunshot', 'gun', 'shot', 'shoot', 'salvo', 'fire'], rate: 44100, target: -16 },
  { kind: 'weapon-rocket', q: 'missile rocket whoosh launch', alt: 'rocket firing missile flyby', min: 0.1, max: 12, keywords: ['rocket', 'missile', 'launch', 'whoosh', 'flyby', 'firing', 'air defense'], rate: 44100, target: -16 },
  { kind: 'weapon-cannon', q: 'cannon shot boom', alt: 'artillery boom gun blast', min: 0.15, max: 8, keywords: ['cannon', 'boom', 'blast', 'fire', 'explos', 'mortar'], rate: 44100, target: -16 },
  { kind: 'weapon-artillery', q: 'artillery explosion distant boom', alt: 'heavy explosion rumble blast', min: 0.5, max: 10, keywords: ['artillery', 'boom', 'explos', 'shell', 'distant', 'heavy', 'rumble'], rate: 44100, target: -16 },
  { kind: 'weapon-air-cannon', q: 'machine gun fire', alt: 'automatic weapon burst gun fire', min: 0.1, max: 12, keywords: ['machine', 'gun', 'rapid', 'gatling', 'fire', 'burst', 'automatic'], rate: 44100, target: -16 },
  { kind: 'unit-trained', q: 'bell ding notification', alt: 'chime tone completion ding', min: 0.05, max: 10, keywords: ['bell', 'chime', 'ding', 'completion', 'notification', 'signal', 'tiny'], melodic: true, rate: 44100, target: -16 },
  { kind: 'building-completed', q: 'hammer sound', alt: 'carpenter nail hammering construction', min: 0.05, max: 8, keywords: ['hammer', 'clank', 'wood', 'construction', 'build', 'nail', 'pound'], rate: 44100, target: -16 },
  { kind: 'upgrade-completed', q: 'video game powerup arcade', alt: 'level up start coin arcade', min: 0.05, max: 8, keywords: ['power', 'arcade', 'level', 'game', 'up', 'coin', 'start'], melodic: true, rate: 44100, target: -16 },
  { kind: 'supply-harvested', q: 'coin sound', alt: 'cash register money collect', min: 0.05, max: 2.5, keywords: ['coin', 'pickup', 'collect', 'cash', 'ding', 'register', 'money'], melodic: true, rate: 44100, target: -16 },
  { kind: 'combat-hit', q: 'punch impact body hit', alt: 'melee hit thud punch', min: 0.05, max: 2, keywords: ['punch', 'impact', 'hit', 'thud', 'melee', 'body', 'smack'], rate: 44100, target: -16 },
  { kind: 'laser-strike', q: 'laser beam blaster sci-fi pew', alt: 'laser zap shot shoot', min: 0.1, max: 12, keywords: ['laser', 'beam', 'blaster', 'pew', 'zap', 'shoot'], rate: 44100, target: -16 },
  { kind: 'bomb-strike', q: 'explosion blast big boom', alt: 'huge explosion sound', min: 0.4, max: 10, keywords: ['explos', 'bomb', 'blast', 'boom', 'big', 'deep'], rate: 44100, target: -16 },
  { kind: 'airstrike-called', q: 'jet engine', alt: 'airplane flyby distant', min: 0.5, max: 30, keywords: ['jet', 'engine', 'plane', 'aircraft', 'flyover', 'flyby', 'airplane'], rate: 44100, target: -16 },
  { kind: 'grenade-exploded', q: 'grenade explosion', alt: 'small explosion blast', min: 0.2, max: 6, keywords: ['explos', 'grenade', 'blast', 'boom', 'small'], rate: 44100, target: -16 },
  { kind: 'smoke-landed', q: 'spray can aerosol', alt: 'compressed air release', min: 0.1, max: 6, keywords: ['spray', 'aerosol', 'air', 'puff', 'release', 'hiss', 'hiss'], rate: 44100, target: -16 },
  { kind: 'emp-strike', q: 'electric zap spark', alt: 'electric shock static burst', min: 0.05, max: 12, keywords: ['electric', 'zap', 'spark', 'static', 'surge', 'discharge', 'shock'], rate: 44100, target: -16 },
  { kind: 'power-down', q: 'power down', alt: 'machine shutdown powering off', min: 0.2, max: 15, keywords: ['power', 'down', 'shutdown', 'machine', 'motor', 'off'], rate: 44100, target: -16 },
  { kind: 'game-over', q: 'fail sound wrong', alt: 'game over failure buzz', min: 0.2, max: 8, keywords: ['fail', 'game', 'lose', 'wrong', 'buzz', 'trombone', 'waa'], melodic: true, rate: 44100, target: -16 },
  { kind: 'victory', q: 'victory fanfare', alt: 'fanfare trumpet win sound effect', min: 0.3, max: 20, keywords: ['victory', 'win', 'fanfare', 'jingle', 'celebration', 'triumph', 'success', 'trumpet'], melodic: true, rate: 44100, target: -16 },
  { kind: 'achievement', q: 'level up sound', alt: 'success sound video game jingle', min: 0.1, max: 15, keywords: ['victory', 'success', 'chime', 'fanfare', 'jingle', 'complete', 'level', 'celebration'], melodic: true, rate: 44100, target: -16 },
  { kind: 'ambient-lobby', q: 'space ambient drone', alt: 'station ambience hum loop', min: 12, max: 90, keywords: ['space', 'drone', 'ambient', 'station', 'deep', 'hum'], loop: true, rate: 22050, target: -20 },
  { kind: 'ambient-game', q: 'war sounds battle', alt: 'battle ambience combat gunfire', min: 12, max: 90, keywords: ['war', 'battle', 'ambience', 'combat', 'distant', 'gun'], loop: true, rate: 22050, target: -20 },
  { kind: 'rain-ambient', q: 'rain ambience loop', alt: 'rain noise outside rain', min: 10, max: 90, keywords: ['rain', 'patter', 'storm'], loop: true, rate: 22050, target: -20 },
  { kind: 'snow-ambient', q: 'wind ambience loop', alt: 'cold wind storm outdoor', min: 10, max: 90, keywords: ['wind', 'howl', 'blizzard', 'snow', 'cold'], loop: true, rate: 22050, target: -20 },
  { kind: 'storm-ambient', q: 'thunderstorm thunder rumble rain', alt: 'thunder storm heavy rain', min: 10, max: 90, keywords: ['thunder', 'storm', 'rumble', 'rain'], loop: true, rate: 22050, target: -20 },
]

const HARD_BAD = ['music', 'song', 'melody', 'vocal', 'sing', 'choir']
const INST_BAD = ['guitar', 'piano', 'drum', 'sax', 'trumpet', 'violin', 'organ']

const score = (name, cfg) => {
  const n = name.toLowerCase()
  let s = 0
  for (const k of cfg.keywords) if (n.includes(k)) s += 1
  if (cfg.loop && n.includes('loop')) s += 2
  for (const b of HARD_BAD) if (n.includes(b)) s -= 4
  if (!cfg.melodic) for (const b of INST_BAD) if (n.includes(b)) s -= 3
  return s
}

const usedGlobal = new Set()

const search = (cfg, query, page) => {
  const filter = `duration:[${cfg.min} TO ${cfg.max}] license:"Creative Commons 0"`
  const url = `${API}/search/text/?query=${encodeURIComponent(query)}&filter=${encodeURIComponent(filter)}&fields=id,name,duration,previews,username&page_size=${PAGE}&page=${page}&token=${TOKEN}`
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = spawnSync('curl.exe', ['-s', url], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    sleep(300)
    if (res.status !== 0) continue
    try {
      const data = JSON.parse(res.stdout)
      if (Array.isArray(data.results)) return data.results
      if (data.detail && typeof data.detail === 'string') sleep(800)
    } catch {
      /* retry */
    }
  }
  return []
}

const pick = (cfg, need) => {
  const cands = []
  for (const query of [cfg.q, cfg.alt]) {
    if (cands.length >= need * 4) break
    for (let page = 1; page <= 3; page++) {
      const results = search(cfg, query, page)
      if (results.length === 0) break
      for (const r of results) cands.push({ ...r, _score: score(r.name, cfg) })
      if (cands.length >= need * 4) break
    }
  }
  cands.sort((a, b) => b._score - a._score)
  const picks = []
  const usedHere = new Set()
  const seenNames = new Set()
  const tryAdd = (minScore) => {
    for (const c of cands) {
      if (picks.length >= need) return
      if (c._score < minScore) continue
      if (usedHere.has(c.id)) continue
      const key = c.name.toLowerCase().trim()
      if (seenNames.has(key)) continue
      picks.push(c)
      usedHere.add(c.id)
      seenNames.add(key)
      usedGlobal.add(c.id)
    }
  }
  tryAdd(1)
  tryAdd(0)
  if (picks.length < need) {
    for (const c of cands) {
      if (picks.length >= need) break
      if (usedHere.has(c.id)) continue
      if (seenNames.has(c.name.toLowerCase().trim())) continue
      picks.push(c)
      usedHere.add(c.id)
      seenNames.add(c.name.toLowerCase().trim())
      usedGlobal.add(c.id)
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
let failures = 0
for (const cfg of KINDS) {
  if (ONLY.size > 0 && !ONLY.has(cfg.kind)) continue
  const dir = join(OUT, cfg.kind)
  mkdirSync(dir, { recursive: true })
  let existing = 0
  try {
    for (const f of readdirSync(dir)) {
      if (/^v\d+\.wav$/.test(f)) existing++
    }
  } catch {
    /* noop */
  }
  const need = Math.max(0, TARGET - existing)
  manifest[cfg.kind] = existing
  if (need === 0) {
    console.log(`keep  ${cfg.kind}: already ${existing} variants`)
    continue
  }
  const picks = pick(cfg, need)
  if (picks.length === 0) {
    console.warn(`WARN  ${cfg.kind}: no candidates for +${need} variants (keeping ${existing})`)
    continue
  }
  let added = 0
  for (let i = 0; i < picks.length; i++) {
    const c = picks[i]
    const n = existing + i + 1
    const tmp = join(TMP, `${cfg.kind}-v${n}.mp3`)
    let dl = spawnSync('curl.exe', ['-s', '-L', '-o', tmp, c.previews['preview-hq-mp3']], { maxBuffer: 64 * 1024 * 1024 })
    sleep(260)
    if (dl.status !== 0) {
      failures++
      console.warn(`WARN  ${cfg.kind}/v${n}: download failed`)
      continue
    }
    let dur = probe(tmp)
    if (!Number.isFinite(dur) || dur < cfg.min) {
      dl = spawnSync('curl.exe', ['-s', '-L', '-o', tmp, c.previews['preview-hq-mp3']], { maxBuffer: 64 * 1024 * 1024 })
      sleep(260)
      dur = probe(tmp)
    }
    if (!Number.isFinite(dur) || dur < cfg.min) {
      failures++
      console.warn(`WARN  ${cfg.kind}/v${n}: bad duration ${dur}`)
      continue
    }
    const out = join(dir, `v${n}.wav`)
    const f = spawnSync('ffmpeg', ['-y', '-i', tmp, '-ac', '1', '-ar', String(cfg.rate), '-af', `loudnorm=I=${cfg.target}:TP=-1.5:LRA=9`, out], { maxBuffer: 64 * 1024 * 1024 })
    if (f.status !== 0) {
      failures++
      console.warn(`WARN  ${cfg.kind}/v${n}: ffmpeg convert failed`)
      continue
    }
    added++
    rows.push({ kind: cfg.kind, variant: n, id: c.id, name: c.name, user: c.username, url: `https://freesound.org/people/${encodeURIComponent(c.username)}/sounds/${c.id}/` })
    console.log(`OK    ${cfg.kind}/v${n} <- [${c.id}] ${c.name} (${dur.toFixed(2)}s)`)
  }
  manifest[cfg.kind] = existing + added
  console.log(`DONE  ${cfg.kind}: ${existing} + ${added} = ${existing + added}`)
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

if (rows.length > 0) console.log(`\n${rows.length} new variants fetched -> ${OUT}`)
if (failures > 0) console.log(`FAILURES: ${failures}`)