# 11 — Sound FX Generation & the Sound Pipeline

**Status:** Shipped. Baked WAV assets and the lobby MP3 are committed in `client/dist/sound/`;
the generation tooling lives in `scripts/`. Two of the 28 kinds are still synth-only.
**Companion docs:** [05 — Asset Pipeline](05-ASSET-PIPELINE.md) (asset layout),
[17 — Rendering, Audio & Input](17-RENDERING-AUDIO-INPUT.md) (runtime audio system),
[18 — Dev Tooling](18-DEV-TOOLING.md) (the scripts themselves).

---

## 1. Overview — three audio sources

The game never depends on a single way to produce a sound. Every sound kind resolves through
this priority chain, so a missing or broken file always degrades gracefully:

| # | Source | Where it lives | When it is used |
|---|---|---|---|
| 1 | **Baked single file** | `client/dist/sound/<kind>/<short>.wav` listed in `SOUND_FILE_NAMES` | Preferred path — the shipped sound |
| 2 | **Baked variant pool** | `client/dist/sound/<kind>/v1.wav, v2.wav, …` | Fallback when no `SOUND_FILE_NAMES` entry exists (or its file 404s) |
| 3 | **Real-time synth** | WebAudio in `client/src/audio/hooks.ts` | Last resort — always available, needs no asset |

The resolution is implemented in `client/src/audio/hooks.ts` (`AudioHooks`) and the registries
live in `client/src/audio/settings.ts`:

- `SOUND_IDS` — the authoritative list of **28** sound kinds.
- `SOUND_FILE_NAMES` — a map of kind → bundled file name (**26** entries; the two gaps fall
  back to synth and are documented in §9).

---

## 2. The 28 sound kinds

`export type SoundId = (typeof SOUND_IDS)[number]` (`client/src/audio/settings.ts`).

| Kind | Bundled file | Category | Notes |
|---|---|---|---|
| `select` | `slct.wav` | UI | Unit/building selection blip |
| `move-bleep` | `bleep.wav` | UI | Order-confirmation bleep |
| `alert` | `alrt.wav` | UI | Under-attack / warning klaxon |
| `weapon-rifle` | `rfl.wav` | Combat | Small-arms fire |
| `weapon-rocket` | `rct.wav` | Combat | Rocket/missile launch |
| `weapon-cannon` | `cnon.wav` | Combat | Vehicle/main cannon |
| `weapon-artillery` | `art.wav` | Combat | Long-range boom |
| `weapon-air-cannon` | `arcnon.wav` | Combat | Aircraft gun burst |
| `combat-hit` | `ht.wav` | Combat | Impact |
| `laser-strike` | `lsrst.wav` | Superweapon | Space Laser |
| `bomb-strike` | `bmbst.wav` | Superweapon | Airstrike bomb |
| `emp-strike` | `mpst.wav` | Superweapon | EMP pulse |
| `airstrike-called` | `airst.wav` | Superweapon | Jet pass-by when the strike is called |
| `grenade-exploded` | `grndxpl.wav` | Combat | Grenade blast |
| `smoke-landed` | `smk.wav` | Combat | Smoke grenade puff |
| `power-down` | `pwrdn.wav` | Economy | Power deficit / structure unpowered |
| `game-over` | `los.wav` | Match | Defeat sting |
| `victory` | `wn.wav` | Match | Victory sting |
| `achievement` | `ach.wav` | Progression | Achievement unlocked fanfare |
| `supply-harvested` | `splyhrv.wav` | Economy | Harvester delivery / cash |
| `unit-trained` | *(none — synth)* | Production | In `SOUND_IDS`, absent from `SOUND_FILE_NAMES` |
| `building-completed` | `bldcmpl.wav` | Production | Construction finished |
| `upgrade-completed` | *(none — synth)* | Production | Research finished |
| `ambient-lobby` | `ambl.wav` | Ambient | Loops while in the lobby |
| `ambient-game` | `ambg.wav` | Ambient | Loops during a match |
| `rain-ambient` | `ambr.wav` | Weather | Loops during rain |
| `snow-ambient` | `ambs.wav` | Weather | Loops during snow |
| `storm-ambient` | `ambst.wav` | Weather | Loops during thunderstorms |

> Note: the lobby **music** track is **not** a `SoundId`. It is loaded directly by
> `client/src/audio/lobby-music.ts` (see §3.3).

---

## 3. Asset layout — `client/dist/sound/`

```
client/dist/sound/
├── manifest.json                      # kind → number of files in its folder
├── CREDITS.md                         # per-variant Freesound attribution table
├── SPACE.ARENAS_by_SDEVRAMI.mp3       # lobby music (6.69 MB) — outside the SFX pipeline
├── select/slct.wav
├── alert/alrt.wav
├── ambient-lobby/ambl.wav
├── …                                  # one folder per kind
└── weapon-rocket/rct.wav
```

### 3.1 One folder per kind

Each kind owns a folder `client/dist/sound/<kind>/`. The **shipped** state is exactly **one**
file per folder (26 folders), named with the short mnemonic in `SOUND_FILE_NAMES`. Folders with
no `SOUND_FILE_NAMES` entry have no file at all and run on the synth.

### 3.2 `manifest.json`

A flat `kind → count` map (every shipped count is `1`). It is documentation/inspection data for
the asset tooling; the runtime does **not** read it to resolve a sound (it resolves through
`SOUND_FILE_NAMES`, then probes `v1.wav…`).

### 3.3 `SPACE.ARENAS_by_SDEVRAMI.mp3`

The lobby music track sits at the sound root, not inside a kind folder. It is referenced by
absolute-relative URL from `client/src/audio/lobby-music.ts` and has its own volume slider and
mute toggle in Settings (`music` / `musicMuted` in `AudioSettings`), cross-fading in on the lobby
and out when a match starts. It obeys the global **Mute all** but is otherwise independent of the
ambient layers. See [14 — Lobby & UI](14-LOBBY-AND-UI.md) §7.

### 3.4 `CREDITS.md`

A 43 KB attribution table generated by the Freesound fetch scripts: one row per fetched variant
with kind, variant, Freesound sound id + link, name and author. All fetched sounds are **CC0**.

---

## 4. How the runtime resolves a sound (`client/src/audio/hooks.ts`)

1. **Override path** (dev settings). A per-kind override URL stored in `AudioSettings.overrides`
   is used if set and decodable.
2. **`SOUND_FILE_NAMES[kind]`** — the bundled single file. Loaded once, cached in the decoded
   buffer cache.
3. **Legacy pool probe** — if the single file is missing, `sound/<kind>/v1.wav`, `v2.wav`, … are
   probed until a 404; one variant is chosen per play.
4. **Synth** — with no file at all, `AudioHooks` synthesizes the sound (`playTone`, oscillator
   types incl. `square`/`saw`, `sweepTo` exponential sweeps, noise bursts, exponential gain
   decay). Ambient kinds synthesize a drone.

Additional runtime behaviour:

- **Looping** — the three ambient kinds plus `ambient-lobby`/`ambient-game` loop their file(s)
  in shuffled order.
- **Variant decks** — several variants are shuffled with no immediate repeat.
- **Positional falloff** — world-positioned sounds use `clamp01(1 - (dist - 2) / 16)` against the
  camera centre, so distant combat is quieter.
- **Per-kind tuning** — the dev-settings Audio panel stores `tuning` (volume/pitch multipliers
  per kind) and `overrides`, applied on top of the resolved buffer.
- **Layers & mute** — `master`, `effects`, `ambient`, `ambientInMatch`, `music`, `ambientEnabled`,
  `muted`, `musicMuted` combine into the effective levels shown in Settings
  (see [17 — Rendering, Audio & Input](17-RENDERING-AUDIO-INPUT.md)).

---

## 5. Generation tooling (`scripts/`)

Two independent generators write into `client/dist/sound/`, plus a validator.

### 5.1 `scripts/synth-fx.mjs` — procedural synthesis (`npm run synth:fx`)

Zero-dependency math-to-PCM synthesis (44-byte RIFF header + 16-bit mono samples):

| Constant | Value | Meaning |
|---|---|---|
| `SR` | `44100` | Sample rate for SFX |
| `AMBIENT_SR` | `22050` | Sample rate for ambient beds (smaller files) |
| `OUT` | `client/dist/sound` | Output root |

- **Deterministic:** every buffer is seeded through a `mulberry32` PRNG, so re-running the script
  reproduces bit-identical WAVs.
- **Primitives:** `wave()` (sine/square/saw/triangle), `addTone()` (attack/release envelope,
  `sweepTo` frequency glide, tremolo), `ns()` (filtered noise bursts), `compose()` (mixes parts
  into one buffer).
- **`writeWav()` + `verify()`** — emits the file, then re-reads it and asserts the `RIFF`/`WAVE`
  magic and the data-chunk length.
- **Output:** for each recipe it writes `v1.wav, v2.wav, …` (2–3 variants per kind) and records
  `manifest[kind] = variantCount`.

### 5.2 `scripts/fetch-freesound.mjs` / `fetch-freesound-many.mjs` — real recordings

Fetches **CC0** previews from [Freesound](https://freesound.org), converts them to mono PCM WAV
loudness-matched, and appends attribution rows to `client/dist/sound/CREDITS.md`.

- `fetch-freesound-many.mjs` fills each kind up to `TARGET = 12` variants.
- Each entry in its `KINDS` table carries search terms, an alternate query, and `min`/`max`
  duration filters — e.g. `weapon-rocket` searches "missile rocket whoosh launch".
- This is the source of the kinds with no synth recipe: `airstrike-called`, `grenade-exploded`,
  `smoke-landed`, `victory`.

### 5.3 `scripts/validate-assets.mjs` (`npm run validate:assets`)

Walks `client/dist`, hashes every asset (SHA-256) and writes `reports/asset-manifest.json`,
providing a reproducible inventory for release checks.

---

## 6. Working with the sound pipeline

### Regenerate the procedural sounds

```bash
npm run synth:fx
```

### Replace a shipped sound with your own recording

1. Drop the file at `client/dist/sound/<kind>/<name>.wav` (mono PCM WAV recommended).
2. Add or change the entry in `SOUND_FILE_NAMES` in `client/src/audio/settings.ts`
   (e.g. `alert: 'my-alarm.wav'`).
3. Rebuild — the host serves `client/dist` as the web root, so the file resolves automatically.
   (`npm run dev` serves the source root instead, so it will 404 there; test with the built app,
   e.g. `run-game.bat` or `npm run preview -w client`.)

You can also point a per-kind override URL at any audio file from the dev-settings Audio panel
without touching code.

### Add a brand-new sound kind

1. Add the id to `SOUND_IDS` in `client/src/audio/settings.ts` (and its `SoundId` union).
2. Add it to `SOUND_FILE_NAMES` and place the file under `client/dist/sound/<id>/`.
3. Optionally add a recipe to `scripts/synth-fx.mjs` (so a synth fallback exists) and a `KINDS`
   entry to the fetch script (for CC0 variants).
4. Play it via `AudioHooks` and add any i18n text for the dev-settings Audio panel row.

---

## 7. Caveat: generator output ≠ shipped layout

Both generators emit the **variant pool** layout (`v1.wav, v2.wav, …`, 2–12 files per kind), but
the committed assets are a **curated single short-named file per kind** (`slct.wav`, `alrt.wav`,
…), and the committed `manifest.json` records a count of `1` for every kind.

Consequences to be aware of:

- Re-running `npm run synth:fx` writes `vN.wav` files **alongside** the shipped short-named files
  — it does not overwrite them (different file names) — and rewrites `manifest.json` with counts
  of 2–3.
- Because `SOUND_FILE_NAMES` is consulted first, the shipped single file always wins; the pool
  files would only be used if that entry were removed.
- The shipped short-named files are therefore **not** reproducible by `synth:fx` alone; they were
  curated from the generator/fetch output.

---

## 8. Licensing

- Synthesized sounds are generated in-repo — no external licence applies.
- Fetched recordings are all **CC0** (no attribution required); `client/dist/sound/CREDITS.md`
  still records the sound id, name and author for every variant.
- `SPACE.ARENAS_by_SDEVRAMI.mp3` is by **SDEVRAMI** (credited on the in-game Credits panel).

---

## 9. Planned / not yet implemented

- **Baked files for `unit-trained` and `upgrade-completed`** — both have synth recipes and
  fetch queries but no bundled WAV, so they always synthesize.
- **Multi-variant pools in the shipped build** — the runtime supports `v1.wav…` pools, but only
  one file per kind ships to keep the repository small.
- **Streaming/`decodeAudioData` for the lobby MP3** — currently loaded via `HTMLAudioElement`
  with a manual fade loop; a WebAudio buffer path with the same graph as the SFX is not built.
