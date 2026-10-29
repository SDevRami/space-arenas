# 05 — Asset Pipeline

**Status:** Current (code-grounded)

**Project:** Space Arenas — RTS game
**Companion docs:** 03-TECHNICAL-SPECIFICATION.md (stack/build), 04-ARCHITECTURE.md (render layer), 17-RENDERING-AUDIO-INPUT.md (render/audio/input runtime)

This document describes how visual and audio assets are stored, resolved, loaded, generated and validated as implemented in the code.

---

## 1. Design Principle: Visual Identity Is Swappable

- Gameplay/sim code only references logical ids (`unitType`, `buildingType`, weapon id, sound id). It never touches textures, pixel positions or animation frames.
- The **renderer** maps id → drawable. At **low/medium** quality the drawable is a procedural vector texture from `client/src/render/shapes.ts`; at **high** quality it is an image sprite from `client/dist/…` resolved via `client/src/ui/graphics.ts` (`DEFAULT_ASSET_PATHS`). Same id, different producer.
- Any per-asset miss falls back to the procedural shape, so the game is never unrenderable and **no asset can affect sim outcome** (render-only seam; tested).

---

## 2. Quality Tiers (shapes vs sprites)

| Quality | Vector art | Image sprites (from `client/dist/…`) |
|---|---|---|
| **low** (default, `GRAPHICS_QUALITY='low'`) | simple `unitShape`/`buildingShape`/`obstacleShape` | no |
| **medium** | richly detailed `mediumUnitShape`/`mediumBuildingShape`/`mediumObstacleShape` | no |
| **high** | same detailed vector art (used as fallback) | yes — `buildingImagesEnabled() === getGraphics().quality === 'high'` (`client/src/render/building-sprites.ts`) |

- Quality is stored in localStorage `space-arenas:graphics` and changed in the Graphics settings (`QUALITIES = ['low','medium','high']`, `client/src/ui/graphics.ts`).
- Procedural textures are generated once via PixiJS `renderer.generateTexture({ target: Graphics, resolution: 8, antialias: true })` and cached in a module `Map` (`client/src/render/shapes.ts`); `clearShapeCache()` destroys them.

---

## 3. `client/dist` — the committed game-asset home

`client/dist` **is committed** (per `.gitignore` lines 9–13 only `client/dist/assets/` and `client/dist/index.html` are ignored, since those are rebuildable Vite output). It is the **web root** the LAN host serves (`CLIENT_DIST = resolve(HOST_BASE, '../../client/dist')`, `host/src/index.ts` line 54).

### 3.1 Committed folders & files (root of `client/dist`)
| Entry | Kind |
|---|---|
| `af, b, bn, cc, cm, d, pp, sd, sp, t, tc, wf` | building sprite frames (per building type) |
| `v_a, v_aa, v_at, v_aw, v_b, v_c, v_e, v_f, v_h, v_mb` | unit sprite frames (per unit) |
| `t_l, t_r, t_s` | additional committed sprite folders |
| `hud` | HUD selection-bar icons (25 `hud_*.png`) |
| `sf` | supply-field frames (25), `of` | oil-field frames (4) |
| `ao` | obstacle images (`rock, tree, wreck, mine`) |
| `sound` | sound folders (one per sound id) + `manifest.json` + `CREDITS.md` + `SPACE.ARENAS_by_SDEVRAMI.mp3` |
| `background` | lobby slide backgrounds `bg_1.png … bg_5.png` |
| `assets` | Vite-hashed JS/CSS (ignored) |
| `index.html`, `sw.js`, `logo.png` | app shell / service worker / logo |

### 3.2 Path templates (`client/src/ui/graphics.ts` → `DEFAULT_ASSET_PATHS`)
Placeholders: `{frame}` = 4-digit zero-padded frame number, `{color}` = 1-based color folder, `{dir}` = legacy heading name, `{type}` = obstacle kind.

| Key | Template |
|---|---|
| `building:<id>` | `<folder>/<color>/<folder>_{frame}.png` |
| `unit:<id>` | `<folder>/<color>/<folder>_{frame}.png` (8 heading frames 0001–0008) |
| `hud:<id>` | `hud/hud_<folder>.png` |
| `field:supply` | `sf/sf_{frame}.png` |
| `field:oil` | `of/of_{frame}.png` |
| `obstacle:<k>` | `ao/<k>.png` |
| `fx:burn` | `''` (empty = procedural flame; a user override like `fx/burn/burn_{frame}.png` loads 2 animated frames) |

- Building folder map: `command-center→cc`, `power-plant→pp`, `supply-dock→sd`, `barracks→b`, `war-factory→wf`, `turret→t`, `tech-center→tc`, `air-force→af`, `super-weapon→sp`, `bunker→bn`, `dock→d`, `crypto-miner→cm` (`BUILDING_ASSET_FOLDERS`).
- Unit folder map: `bulldozer→v_b`, `harvester→v_h`, `assault-walker→v_aw`, `aa-platform→v_aa`, `artillery→v_a`, `engineer→v_e`, `fighter→v_f`, `carrier→v_c`, `missile-boat→v_mb`, `apc→v_at` (`UNIT_ASSET_FOLDERS`). `UNIT_ASSET_IDS` also includes `scout`, `rifleman`, `rocket-trooper` (which have no entry in `UNIT_ASSET_FOLDERS` and therefore use the procedural shapes even at high quality, since their `unit:<id>` template resolves empty).
- `HUD_ASSET_IDS` = building ids + unit folder ids (entities with a dedicated selection-bar icon).
- Color slot is a **subfolder** and is 1-based on disk (`fileColor(index) = index + 1`), while the palette index is 0-based (`pp/1/pp_0001.png` … `pp/10/…`). Frames are zero-padded to 4 digits (`padFrame`).
- `resolveAssetTemplate()` guards overrides: while `navigator.onLine === false`, an absolute `http(s)://` override is ignored (returns the bundled template) so the preloader cannot hang on DNS; relative and same-origin (`/…`) overrides are always kept.

### 3.3 Frames & status mapping
- **Buildings:** `BUILDING_STATUS_FRAMES = 8`; `buildingStatusIndex(done, progress, hpFrac)` → frames 1–4 build progress (0/25/50/75%), frame 5 complete, frames 5–8 damage at 100/75/50/25% health.
- **Units:** 8 heading frames; `ANGLE_TO_DIR` bins screen-space angle into `UNIT_DIRECTION_NAMES`, and `FRAME_TO_DIR` maps on-disk 0001–0008 to direction names. `UNIT_SPRITE_WIDTH = 26` for on-screen size parity with vector art.
- **Fields:** supply `sf_0001 … sf_0025` (frame 1 full → frame 25 empty, `supplyFieldStatusTexture`); oil `of_0001 … of_0004` at 100/75/50/25% health (`oilFieldStatusTexture`).

---

## 4. Loading, fallback and the sprite bundle

### 4.1 Preload (high quality)
`preloadAllMatchAssets(onProgress)` (`client/src/render/building-sprites.ts`) warms every asset a match could need: all building types × 8 frames × 10 color indexes, all unit directions × 10 colors, supply/oil frames, obstacles, and burn fx. Each individual `Assets.load` swallows its own errors (never rejects) and the vector fallback covers anything that fails. Targeted helpers (`preloadBuildingSprites`, `preloadUnitSprites`, `preloadFieldSprites`) exist for narrower warm-ups.

### 4.2 Fallback rule
`buildingStatusTexture` / `unitDirectionTexture` / `supplyFieldStatusTexture` etc. return `null` when quality ≠ high, when the type is unknown, or when the texture hasn't resolved yet; the renderer then draws the procedural shape for that frame. Late-resolving images are written into their slot only if still empty, so a slow file never clobbers a loaded one.

### 4.3 One-request sprite bundle
- **Wire format** (mirrored by `host/src/index.ts::buildSpriteBundle` at line 185 and `client/src/render/sprite-bundle.ts`): `[u32LE header length][JSON Array<[relativePath, offset, length]>][raw PNG bytes…]`.
- The host serves it at **`/assets/sprites.bundle`** (`host/src/index.ts` line 1084), immutable-cached. It walks `CLIENT_DIST` collecting every `.png` and concatenates them, keyed by dist-relative path (e.g. `cc/1/cc_0001.png`).
- The client (`fetchSpritesBundle`) fetches it from `${BASE_URL}assets/sprites.bundle` and slices per-path bytes.
- **Status / caveat:** the glue that turns bundle bytes into textures is currently **stubbed** — `textureFromBundle()` in `client/src/render/building-sprites.ts` (lines 63–65) just `return null`, so the per-file `Assets.load` path is what actually runs. The host route and the client fetch/decode helpers are implemented and ready; only the texture-adoption hook is left inert.

---

## 5. Audio assets (`client/dist/sound/`)

### 5.1 Layout
One folder per sound id (`select, move-bleep, alert, weapon-*, unit-trained, building-completed, …, ambient-lobby, ambient-game, rain-ambient, snow-ambient, storm-ambient`). Plus:
- `manifest.json` — the count of generated variant files per sound id (written by `scripts/synth-fx.mjs`).
- `CREDITS.md` — sound credits.
- `SPACE.ARENAS_by_SDEVRAMI.mp3` — the lobby music track (see `client/src/audio/lobby-music.ts`, `TRACK_URL = ${BASE_URL}sound/SPACE.ARENAS_by_SDEVRAMI.mp3`).

### 5.2 Resolution order (`client/src/audio/hooks.ts` → `overrideUrls`)
For a given sound kind:
1. **Explicit override** (`AudioSettings.overrides[kind]`, localStorage `space-arenas:audio`) pointing at a single file (`…x.wav/.mp3/.ogg/.m4a`) plays that file directly.
2. **Folder override** (`sound/<id>/`) is probed: first the bundled single-file name from `SOUND_FILE_NAMES[kind]`, else the legacy pool `v1.wav … v12.wav` (`probeVariants`). Only files that actually exist are returned (HEAD probes), so deleting a variant drops it from the shuffle with no 404 noise.
3. **No override:** if `SOUND_FILE_NAMES[kind]` exists, the bundled `sound/<kind>/<name>.wav` is HEAD-probed once and cached; otherwise the kind resolves to nothing and the **synth** plays.

### 5.3 Bundled names vs synth-only
`SOUND_IDS` has 28 kinds; `SOUND_FILE_NAMES` maps 26 of them to a bundled WAV (`select→slct.wav`, `move-bleep→bleep.wav`, `alert→alrt.wav`, `weapon-rifle→rfl.wav`, …, `victory→wn.wav`, `achievement→ach.wav`, `ambient-lobby→ambl.wav`, `ambient-game→ambg.wav`, `rain-ambient→ambr.wav`, `snow-ambient→ambs.wav`, `storm-ambient→ambst.wav`).
- **`unit-trained` and `upgrade-completed` are absent from `SOUND_FILE_NAMES`** — their `client/dist/sound/<id>/` folders contain only a `NOSOUNDFORNOW` placeholder, so they are **synth-only** unless a folder override provides files.
- Synth fallback is `AudioHooks.synthSfx()` (plus internal synth-only kinds `base-alert`, `sw-chosen`, `airstrike-bomb`). `onEvent()` maps sim events → kinds (e.g. `airstrike-bomb` → `bomb-strike`).

### 5.4 Ambient & music
- Ambient layers (`startLobbyAmbient`, `startGameAmbient`, `startWeatherAmbient`) play file variants in a shuffled, looping rotation when files exist; otherwise they build a synth drone from `AMBIENT_SYNTH` (e.g. `ambient-lobby` freq 49 saw, `ambient-game` freq 55 saw, `rain-ambient` 62 saw, `snow-ambient` 38 triangle, `storm-ambient` 30 saw). Weather map: `rain→rain-ambient`, `snow→snow-ambient`, `thunder→storm-ambient`.
- Lobby music uses an `HTMLAudioElement` (`client/src/audio/lobby-music.ts`), looping with a 1200 ms fade (`FADE_MS`), lobby-only, and obeys `musicVolume()` (master × music, zeroed by `muted` or `musicMuted`).
- Tuning: per-sound `AudioTuning {vol, pitch}` clamped to `TUNING_VOL_MAX=4`, `TUNING_PITCH_MIN=0.25`, `TUNING_PITCH_MAX=4` (`client/src/audio/settings.ts`).

---

## 6. Background / logo assets

- Lobby slide backgrounds are `client/dist/background/bg_1.png … bg_5.png`, referenced in `client/src/main.ts` line 239 as `url("${BASE_URL}background/bg_${i}.png")`.
- `client/dist/logo.png` is the game logo (served from the web root).

---

## 7. Placeholder / asset generation (`scripts/synth-fx.mjs`)

`npm run synth:fx` regenerates the bundled sound set procedurally:
- Writes `client/dist/sound/<id>/v<N>.wav` for each sound id and `client/dist/sound/manifest.json`.
- SFX are synthesized at 44.1 kHz, ambient loops at 22.05 kHz (~45 s), using a seeded `mulberry32` RNG (deterministic output for a given seed).
- The result is the committed WAV pool the audio loader reads; users can replace/override individual files or folders without touching code.

---

## 8. Asset validation (`scripts/validate-assets.mjs`)

`npm run validate:assets`:
- Requires `client/dist` to exist (fails with `client/dist not found — run \`npm run build\` first`).
- Walks `client/dist` collecting every `.js`, `.css`, `.html`, hashes each with sha256, prints them, and writes `reports/asset-manifest.json`.
- Fails if `client/dist` contains no built assets.
- (`reports/` is git-ignored; see `.gitignore`.)

---

## 9. How the build serves assets

| Mode | Web root | Notes |
|---|---|---|
| **LAN host (prod)** | `client/dist` | `host/src/index.ts` resolves requests under `CLIENT_DIST`; `/` and `/index.html` → `client/dist/index.html`; anything else resolves under `client/dist` with a path-traversal guard. Vite-hashed files under `/assets/` get `Cache-Control: public, max-age=31536000, immutable`; everything else (index.html, sprites, sounds) is ETag/Last-Modified revalidated `no-cache`. `/assets/sprites.bundle` is generated on demand. |
| **`vite dev` / `vite preview`** | client source root + `client/public` | Dev server serves from the Vite root; `import.meta.env.BASE_URL` prefixes resolve static game assets (PNG/WAV/MP3) that live under `client/dist` when that folder is the served root. Dev proxy: `/api` and `/ws` → `SA_PROXY_TARGET` (default `http://localhost:17321` / `ws://localhost:17321`). |

- Optional service worker (`client/public/sw.js`, `CACHE_VERSION='space-arenas-v1'`) is registered from `client/index.html` (guarded to localhost/https). It precaches `./index.html` and `./`, serves `/assets/` cache-first, cache-first for `/cc/`, `/sf/`, `/of/`, `/ao/` and `*.wav`, network-first for documents/scripts/styles, and network-first by default.

---

## 10. QA / determinism notes

- **No asset affects sim outcome.** A missing image or sound degrades only the render/audio layer (vector shape / synth fallback) and cannot desync a match; this is by design and tested.
- High-quality image loading is a pure render concern (`building-sprites.ts` caches textures keyed by type/frame/color and exposes `unloadAllAssetTextures()` for teardown via `Assets.unload`).
- Override files/folders are user-provided and can be swapped or deleted at any time; the loader re-probes and falls back automatically.
- `npm run validate:assets` can be wired into CI to fail fast when built client output is missing or empty.