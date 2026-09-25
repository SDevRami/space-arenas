# 11. Sound FX generation — capability report

> Research only. No code changes were made for this report.
> Question: is there a *skill* I can add that lets me generate WAV files for the game's sound FX?

---

## 0. Direct answer (the skill question)

- **No installed skill generates audio.** The only skill available to me right now is
  `customize-opencode` (used for authoring/editing opencode's own configuration, agents and
  skills — i.e. for building *other* skills).
- **A "skill" is a packaged set of instructions + reference scripts** (a folder with a
  SKILL.md and optional utilities). It encodes a workflow and conventions; it does **not**
  grant new underlying model capabilities. Adding an audio skill can neither give me "ears"
  nor latent audio knowledge I don't already have.
- **What I can actually do — real and permanent:** a WAV file is a trivial container
  (44-byte RIFF header + PCM samples). I can **write code that synthesizes samples
  mathematically and emits valid `.wav` bytes** (Node/PowerShell, zero audio dependencies).
  That is ordinary programming, not a hidden skill. Generating "scientific" SFX —
  beeps, laser shots, explosions, whooshes, impacts, chirps, drones — is entirely within
  reach by direct synthesis.
- **The only genuinely useful "skill" here** would be an in-repo one that (a) declares the
  offline synth tool contract (`scripts/synth-fx.mjs` + recipe DSL), (b) fixes naming/output
  to the game's existing override folders, and (c) makes results reproducible across sessions.
  That adds workflow value, not generation power. Running it is itself just a script.

So: **no skill is required to start generating WAVs.** A script is. A skill is optional
consistency glue around the script.

---

## 1. What the game already has (grounding — nothing new needed)

- **`client/src/audio/settings.ts`** — `SOUND_IDS`: the 24 sound kinds
  (`select`, `move-bleep`, `alert`, `weapon-rifle`, `weapon-rocket`, `weapon-cannon`,
  `weapon-artillery`, `weapon-air-cannon`, `unit-trained`, `building-completed`,
  `upgrade-completed`, `supply-harvested`, `combat-hit`, `laser-strike`, `bomb-strike`,
  `emp-strike`, `power-down`, `game-over`, `achievement`, `ambient-lobby`, `ambient-game`,
  `rain-ambient`, `snow-ambient`, `storm-ambient`).
  Per-kind override URL; **empty override = built-in synth fallback.** The three
  weather `*-ambient` ids loop their files like the lobby/game ambient; they are
  baked too (see §3), with the built-in ambient drone kept as the empty-override fallback.
- **`client/src/audio/hooks.ts`** — `AudioHooks` (WebAudio `AudioContext`): `playTone`
  synth with oscillator types (incl. `square`), `sweepTo` exponential sweeps, exponential
  gain decay; weapon combos; **positional falloff** `clamp01(1 - (dist-2)/16)` (~1 at
  center → ~0.3 at 18 tiles), listener = camera center; per-kind **shuffled variant decks**
  with no immediate repeat.
- **Override path convention** (dev-settings Audio panel, `main.ts:1353`): a folder
  `sound/<id>/` under `client/dist` containing `v1.wav, v2.wav, …` is probed until a 404;
  one variant is shuffled per play. A single-file override is also supported. Both
  `ambient-lobby` and `ambient-game` loop their files in shuffled order.
- `i18n` `audioPath` key (en/ar) documents this exact `v1.wav, v2.wav, …` contract.

**Implication:** the game is *already designed* to consume file-based SFX with shuffle
variants and a synth fallback. An offline "WAV bakery" that writes
`client/dist/sound/<id>/v1.wav … vN.wav` plugs in easily — the existing `AudioHooks` file
probe picks the files up automatically.

**Implementation note added during generation:** `playAsset` (`hooks.ts`) originally applied
an exponential gain ramp to **near-zero across the entire file duration** (0.0001 at
`currentTime + audioBuf.duration`), which would destroy any authored envelope — long laser /
boom / arpeggio files decayed to silence by their midpoint. A small fix was applied: the
gain now holds the play volume and only fades over the final **50 ms** of each file, so the
baked envelopes are audible. This was the one runtime change needed; the synth itself was
not otherwise touched. Ambient files were already fine (they use their own 0.5 s crossfade).

---

## 2. How WAV generation works (the mechanics I'd use)

- **Format:** 16-bit PCM, mono. `44100 Hz` for weapon/music-ish content; `22050 Hz` for
  tiny UI blips and long ambience (halves file size).
- **Header:** RIFF (`"RIFF"` + chunk size + `"WAVE"`), `fmt ` chunk (16-byte PCM format),
  `data` chunk + interleaved little-endian samples. A deterministic writer is ~30 lines in
  Node (`fs.writeFileSync` into a `Buffer`; no audio deps).
- **Sample math:** per-recipe float rendering —
  - oscillators by phase accumulator (sine / square / saw / triangle),
  - white / pink / brown noise from a **seeded PRNG** (e.g. mulberry32) — deterministic,
  - attack/decay envelopes (exponential curves, mirroring WebAudio's
    `exponentialRampToValueAtTime`),
  - one-pole low-pass / simple band-pass shaping, ring-mod / tremolo,
  - pitch sweeps (mirroring `sweepTo`),
  - short early echoes for booms and drones.
  Sum → clamp → scale to 16-bit → write.
- **Determinism:** fixed sample rate + fixed per-file seed ⇒ **the same bytes every run** —
  diffable/versionable assets (and previous reports' determinism rule means this is also
  replay-friendly for the *game*, though audio is client-only anyway).
- **Loudness hygiene:** normalize every file to a fixed headroom (≈ −1 dBFS peak, per-class
  RMS targets) with soft-clipping, so shuffled variants don't jump in volume.
- **Parity with the runtime synth:** recipe timbres should mirror `hooks.ts` (same osc
  types, sweep directions, decay shapes) so baked files and the synth fallback feel like the
  same game. Distance/gain are runtime concerns (positional falloff), so files carry only
  "at-listener" loudness.

---

## 3. Recipe map for the 24 baked sound kinds

| Sound id | Timbre recipe (deterministic) | Variants |
|---|---|---|
| `select` | 1.2 kHz short square blip, 60 ms | v2 +40 Hz alt |
| `move-bleep` | two-note sine+square 900→1200 Hz, 80 ms | 2 |
| `alert` | three square beeps 700/1100 Hz | 2 |
| `weapon-rifle` | 6–8 ms noise click + 250 Hz square burst, ~60 ms | 3 (rate/seed jitter) |
| `weapon-rocket` | saw sweep 400→90 Hz, 220 ms + noise whoosh + tail boom | 3 |
| `weapon-cannon` | 140 Hz sine thump + noise body, 250 ms, slow decay | 2 |
| `weapon-artillery` | descending whoosh 600→120 Hz + deep 55 Hz boom, 700 ms | 2 |
| `weapon-air-cannon` | saw 300→80 Hz + bandpassed metal ping, 160 ms | 2 |
| `combat-hit` | 1.4 kHz ring-mod click + noise, 40 ms | 3 |
| `unit-trained` / `building-completed` / `upgrade-completed` | rising 3–4 note square arpeggio (different tops) | 2 each |
| `supply-harvested` | soft chime, sine 1200→1800 Hz, 150 ms | 2 |
| `laser-strike` | fast upward sine+square sweep 200→1600 Hz, 500 ms + thump | 1 |
| `bomb-strike` | long sub-boom 60→40 Hz, 1.2 s + gravelly noise bed | 1 |
| `emp-strike` | descending tremolo buzz (ring mod), 800 ms | 1 |
| `power-down` | descending 900→150 Hz sine, 400 ms | 1 |
| `game-over` | two low descending sine tones (300→220 Hz) | 1 |
| `achievement` | bright major chord (3 notes), 400 ms | 1 |
| `ambient-lobby` / `ambient-game` | looping drone: low sine (40–60 Hz) + filtered brown-noise swell, ~0.1 Hz LFO | 2–4 long files |

**Size budget:** 44.1 kHz 16-bit mono ≈ 5.3 MB/min. Keep one-shot SFX ≤ ~300 KB (most < 60 KB);
a 2-minute ambient ≈ 10 MB → render ambience at **22050 Hz** (or OGG later). All normal.

---

## 4. What a skill would legitimately add — and what it can't

**Would add (workflow value):**
- A repeatable pipeline: `scripts/synth-fx.mjs` (writer + recipe DSL) emitting
  `client/dist/sound/<id>/v1.wav…`, a manifest + regenerate/verify step, loudness/CLI stats.
- Conventions locked in a repo skill file (`.opencode/…` per opencode's skill format — the
  built-in `customize-opencode` skill covers authoring those): naming, sample rate, seed
  rules, verify-with-ear checkpoint — so any future session regenerates variants identically
  and puts files where `AudioHooks` reads them.
- A `validate-audio` check (parse every WAV under `sound/`), sibling to the existing
  `scripts/validate-assets.mjs`.

**Cannot add (honest limits):**
- **Auditioning.** I can't listen. Verification must be byte-validity (parse header),
  duration/peak/RMS stats, and a human ear check.
- **Organic realism.** Deterministic synthesis excels at *synthetic* SFX (UI, lasers,
  explosions, drones) but won't match recorded foley (real gunshots, metal scrapes, voices,
  music). Those need external assets (CC0 foley packs, a DAW, or a musician). A skill can't
  conjure that realism either.

---

## 5. Recommendation

1. No new skill is needed to *start*: the WAV bakery is a normal code task in this repo,
   and the game's audio override system already consumes `sound/<id>/v1.wav…` files.
2. If you want the workflow to stick across sessions, author it as a repo-level skill with
   the built-in conventions documented (I can do that; per the `customize-opencode` skill
   when writing the skill definition).
3. Keep the recipes in sync with `hooks.ts`'s synth so "baked" and "synth" audio match.
4. Reserve any realistic-foley/music ambitions for externally sourced, licensed samples.

---

*Status: implemented (generation + verify). **Generated:** `scripts/synth-fx.mjs` + 39 WAVs in
`client/dist/sound/<id>/v1.wav …` for all 21 `SOUND_IDS` (8.9 MB total; ambiences at 22.05 kHz).
**Runtime tweak:** `hooks.ts` `playAsset` fade narrowed to the final 50 ms so authored envelopes play.
**Enabling:** run the game (host serves `client/dist`), open **Dev settings → Audio** and set each
sound's "Sound override" to `sound/<id>/` (empty = built-in synth fallback). Regenerate anytime
with `npm run synth:fx`. Grounding: `client/src/audio/settings.ts` (SOUND_IDS),
`client/src/audio/hooks.ts` (AudioHooks), `client/src/main.ts` (dev audio panel),
`host/src/index.ts` (`CLIENT_DIST` static root), `scripts/validate-assets.mjs`.

---

> **Day 31 update:** the WAVs in `client/dist/sound/` were replaced with **real CC0
> recordings** fetched from Freesound (`scripts/fetch-freesound.mjs`, needs `FREESOUND_TOKEN`),
> converted to mono PCM at the matching rates (44.1 kHz SFX / 22.05 kHz ambiences); now 24 kinds
> / 45 WAVs, each credited in `client/dist/sound/CREDITS.md`. The bakery (`synth-fx.mjs`)
> remains the offline fallback and the source of the built-in synth drones.