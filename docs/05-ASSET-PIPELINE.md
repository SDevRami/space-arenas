# 05 — Asset Pipeline

**Project:** Space Arenas — RTS game
**Version:** 0.1
**Companion docs:** 03-TECHNICAL-SPECIFICATION.md (stack/load protocols), 04-ARCHITECTURE.md (render layer)

**Phase reality:** v1 ships with **zero external assets** — all visuals are procedurally generated shapes, all audio is Web Audio synthesis. This document defines (A) how the procedural "assets" are built today, and (B) the exact pipeline that will ingest pre-rendered sprites/sounds later **without changing any gameplay or netcode code**.

---

## 1. Design Principle: Visual Identity Is Swappable

- Gameplay code only knows **`visualId`** (e.g., `"rifleman"`, `"barracks"`, `"supply-field"`, `"explosion-small"`).
- A **`Renderer`** maps `visualId → drawable`. In v1 the drawable is a `ShapeFactory` output; in the future it is a `SpriteFactory` output. Same `visualId`, different factory. This single seam is the entire asset upgrade path.
- The sim never references textures, positions in pixels, or animation frames. All visual timing (animation, effects) is driven by the renderer's own clock, not sim ticks.

---

## 2. Procedural Asset Generation (v1)

### 2.1 Shapes registry (`client/src/render/shapes/`)

Each visual type implements `ShapeFactory → { generateTexture(): Texture }`:

| Family | Generation rule | Distinctive trait |
|---|---|---|
| Infantry | Small vertical quad + head circle | Team-color torso; weapon tint by role |
| Vehicles | Chassis rectangle + turret quad + wheels | Larger footprint; turret rotates |
| Buildings | Footprint-tinted slab + raised block + roof stripe | Size = footprint; power lines = power buildings |
| Supply fields | Cluster of 3–5 pill shapes in a circle | Bright amber/gold color |
| Terrain | Per-tile base quad + edge highlight | Height tint for cliffs; water = blue |
| Projectiles | Thin stretched quad (tracer) | Team color |
| Effects | Expanding circles / flash quads | Non-deterministic, render-only |

### 2.2 Texture baking

- At boot, `ShapeFactory.generateTexture()` runs once per `visualId` and caches a `Texture` (PixiJS `generateTexture` from a `Graphics` object).
- The hot render path then draws cached textures only — no per-frame `Graphics` calls (perf requirement from 04 § 6.1).
- **Team-color variants:** generate the base texture per team color at boot (small count: ~24 visual types × up to 8 teams = < 200 textures; each is a few hundred bytes in VRAM). Alternative (shader tint) is noted for the sprite phase.

### 2.3 Where "asset files" live in v1

- No binary files. Shape configs are TS data in `client/src/render/shapes/config.ts` (colors, sizes, offsets). This is the entire art table for v1.

---

## 3. Future Sprite Pipeline (Design-Completed, Ready to Implement)

### 3.1 Source of truth: manifest

- `public/assets/manifest.json` — versioned list of every asset: `{ id, type: sprite|tileset|audio|ui, src, packedIn, meta }`.
- The manifest is the **single load driver**. The game loads exactly what the manifest declares and nothing else.

### 3.2 Build-time processing

| Tool | Job |
|---|---|
| **TexturePacker** (or free tier) | Pack sprite frames into atlases; output `.json` + `.png` |
| **Tiled / custom** | Terrain tileset packing + tileset collision metadata |
| **audiosprite** | WAV/MP3/Ogg → single `audio.sprites.json` + `.ogg`/`.m4a` bundle |
| **Vite plugin** | Generates the manifest from a source directory + verifies referenced files exist; fails the build on missing/broken refs |

### 3.3 Pre-loading logic (Protocol 1 — Environment)

```
1. Load manifest.json              (tiny, first)
2. Load UI atlas + fonts           (needed for menus)
3. Load terrain tileset            (needed for map render)
4. Load entity atlas (units/bldgs) (deferred to match start → "first frame after lobby")
5. Load audio sprite               (deferred, after first user interaction — autoplay policy)
```

- **Progressive:** the game can render everything with placeholder shapes until step 4/5 complete; swap happens in-place when loaded. No hard loading screen required in v1.
- **Budgets (from 03 § 3):** cold load < 3 s on LAN. Manifest-driven load reports progress for a progress bar if assets ever exceed that.

### 3.4 Audio pipeline (future)

- **Audio sprite context:** one context, one shared buffer per bundle, `start()` with offset/duration for each sound — avoids dozens of decode buffers and enables near-zero-latency triggers.
- **Audio bus mapping:** `audio/` module maps *game events* → *sound ids* (e.g., `unit.trained → "sfx_build_done"`). Gameplay code never calls audio directly; it fires `SimEvent`s. This is already the architecture in 04 § 3.3 — real audio drops into the existing hook with zero gameplay changes.
- **Placeholder→real swap:** `client/src/audio/hooks.ts` currently synthesizes; later it looks up the audio sprite. Same signature.

---

## 4. Atlas Conventions (Future)

- Atlases on a **2-power grid**, 2048 max dimension, inset 1 px (bleed) to prevent edge artifacts under nearest/linear sampling.
- Naming: `units-{faction}-{scale}.json/png`, `buildings-{faction}-{scale}.json/png`, `terrain-{tileset}.json/png`, `ui-atlas.json/png`.
- **Damage states:** buildings get 2 damage frames per 50% HP bracket (future). Mapping `building.damageState` → frame is a render-layer concern.

---

## 5. Runtime Asset Manager (`client/src/render/AssetManager`)

```
AssetManager
├── load(manifestUrl)        → pipeline (3.3), reports progress
├── getTexture(visualId, team?) → cached Texture | placeholder shape
├── getSound(soundId)        → AudioSprite handle
├── getTileset(tilesetId)    → tile texture table + metadata
└── stats()                  → bytes, count, misses (dev overlay)
```

- **Miss behavior:** any `getTexture` miss falls back to the procedural shape (guarantees the game is never unrenderable, even if an atlas fails to load).
- AssetManager is render-layer only; zero coupling to sim.

---

## 6. Map Assets

- Maps are JSON (not binary assets) — full schema in 06-DATA-AND-SAVE-SYSTEM.md. Terrain visuals reference `tilesetId`; the tileset asset provides the visual, the map provides the logical terrain (buildable, height, water).
- Map builder preview uses the same AssetManager, so maps render identically in builder and game.

---

## 7. Compression & Delivery

| Asset class | Delivery | Notes |
|---|---|---|
| Procedural shapes | Generated in code | 0 KB download |
| Future textures | PNG (lossless) or WebP; atlas | Gzip/Brotli via Vite |
| Future audio | Ogg (Vorbis) primary, m4a fallback; audiosprite bundle | Browser feature-detect chooses |
| Maps | Minified JSON + CRC hash | Tiny (< 50 KB for 256×256) |

---

## 8. Versioning & Cache Busting

- Vite hashes bundle filenames automatically.
- Asset manifest carries a `schemaVersion`; game refuses manifests with mismatched versions (prevents sprite/stat skew).
- Audio/map/atlas files include `?v=<hash>` query strings from the manifest.

---

## 9. QA Hooks for Assets

- Dev overlay `F5` renders every registered visual on a test grid (instant visual regression check).
- Boot-time validation logs missing/mismatched manifest entries; fails fast in CI (`npm run validate:assets`).
- Determinism note: **no asset affects sim outcome**. Even a missing texture can't desync the match (fallback shape is render-only). This is by design and is tested.
