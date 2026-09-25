# 10. Adding a "3D" graphics tier — research report

> Research only. No code changes were made for this report.
> Scope: a new graphics quality level `'3d'` (in addition to `low` / `medium` / `high`) with a z-axis,
> 3D models for all objects, real bullet physics and particles, authored in Blender.

---

## 0. The short version

The correct architecture is:

> **Keep the simulation 2D, deterministic, and networked. Make "3D" a pure rendering layer.**

- `low` / `medium` / `high` stay 100% untouched; `'3d'` is additive and client-only.
- The sim stays flat on the x/y grid; all height, arcs and particles are **derived deterministically**
  from existing sim state + the event stream. No protocol change, no replay breakage, no determinism risk.
- **Blender → glTF 2.0 (`.glb`) is the right asset pipeline.**
- The one genuinely risky piece — "real physics for bullets" — has two scopes:
  - **Cosmetic ballistics** (renderer draws true arcs, sim still resolves hits instantly): safe now.
  - **Gameplay ballistics** (travel time in the sim): a new subsystem requiring a `PROTOCOL_VERSION` bump.

---

## 1. Where the game is today (grounded in the actual code)

| Aspect | Current implementation |
|---|---|
| Renderer | **PixiJS v8.6** (`pixi.js` in `client/package.json`), pure 2D |
| Camera | Hard-coded **isometric 2.5D**: `ISO_HALF_W = 32`, `ISO_HALF_H = 16` (`render/camera.ts`); all world→screen math done by hand |
| Depth | Painter's algorithm: sprites sorted by `zIndex = isoY`, plus fixed layer bands (`FIXED_Z_GROUND … FIXED_Z_DEBUG`, `renderer.ts:1470`) |
| Quality levels | `GraphicsQuality = 'low' \| 'medium' \| 'high'` (`ui/graphics.ts:1`); client-only — **not** part of `MatchSettings` |
| What each quality is | Low = simple vector shapes (colored diamond for units); Medium = detailed vector shapes (`shapes.ts`); **High = pre-baked PNG sprites** from `dist/<folder>/<color>/<folder>_<frame>.png` |
| Combat model | **Hitscan.** `fire()` in `combat-system.ts` resolves damage in the same tick, emits `shot-fired`. No flight-time entity. The renderer draws a cosmetic tracer lerping shot origin → target over 10 frames (`renderer.ts:829`), `effects` toggle |
| Effects | Impact rings (14 frames), tracer lines, burn/smoke flicker (`fxFrameTexture`), lightning, laser beam, ghosts, weather overlay, day/night tint — all tick-driven, no runtime RNG |
| Terrain | Flat: `Ground / Cliff / Water / Road / BuildableGround` (`shared/src/maps.ts`). **No elevation data exists** |
| Air units | Already class `'air'` with hover offsets on the 2D plane + ground shadow; own `airLayer` |
| Asset inventory | **13 units** (bulldozer, harvester, scout, rifleman, rocket-trooper, assault-walker, aa-platform, artillery, engineer, apc, fighter, carrier, missile-boat) · **11 buildings** (command-center, power-plant, supply-dock, barracks, war-factory, turret, tech-center, air-force, super-weapon, bunker, dock) · 4 obstacle kinds (rock/tree/wreck/mine) · supply + oil fields · **10 player color palettes** |
| Frame conventions | Units: **8 heading frames** (0001–0008). Buildings: **8 status frames** (build 0/25/50/75% + damage 100/75/50/25%) |
| Determinism law | No `Math.random()`/clock in sim; seeded RNG + fixed timestep; `PROTOCOL_VERSION = 20`; sim changes require version + hash bump, replay compat, updated tests |

### Key structural facts for this feature

1. **Quality is client-only** — adding a 4th tier is additive: extend `QUALITIES`, the gating helpers,
   plus one i18n key. It does **not** touch `MatchSettings` or the wire protocol by itself.
2. **Projectiles don't exist** — "bullet physics" is not a tweak, it's a **new subsystem**.
   How it behaves decides the whole feature's risk profile.
3. **There is no Z in the world model** — height must be invented, and its rules must be purely
   cosmetic (or carefully versioned if they change gameplay).

---

## 2. What "3D" should mean here

Four independent axes with different costs and risks:

| Axis | What it is | Sim impact |
|---|---|---|
| **Rendering 3D** | Real 3D engine; models instead of sprites; perspective camera | None (client-only) |
| **Z-height** | Objects/arcs/effects have elevation | None if purely visual |
| **Particles** | GPU particle systems (smoke, sparks, waves, naval splash) | None if deterministically seeded |
| **Bullet physics** | Travel time, gravity, dodging, splash at impact | **None (cosmetic) or a protocol bump (gameplay)** |

A full "3D" tier can cover axes 1–3 and *cosmetic* ballistic arcs in axis 4 while keeping
`PROTOCOL_VERSION` at 20. Only *gameplay-visible* ballistics forces a version bump.

---

## 3. Architecture options

### Option A — Full 3D engine, sim stays 2D **(recommended)**
- Add **three.js** (WebGL2) as a second world renderer. PixiJS v8 has no 3D scene graph, so it stays for
  HUD / banners / bars / screen-space UI; three.js owns the world.
- Gameplay state + event payloads stay the single source of truth; three.js only *presents* it
  (the same relationship `renderer.ts` has to `world` today).
- Camera becomes a real `PerspectiveCamera` (or ortho for the classic RTS look) at
  ~35–40° pitch. Map the existing 2D camera's `zoom` → camera distance so pan/zoom *feel* is preserved.
- Units rotate freely toward heading (kills the 8-frame sprite limitation), turrets/barrels
  rotate independently, buildings raise during construction.

### Option B — 2.5D / faked 3D (cheap caveat)
- Stay on PixiJS; add height ordering, parallax, tilted ground, drop shadows, billboarded
  multi-layer sprites. ~1/4 the cost, but it's "animated diorama," not real 3D.

### Option C — 3D hybrid fallback
- Three.js world, with a billboard-sprite LOD0 for far zoom and models only when zoomed in.
- Adds complexity; not worth it initially.

**Recommendation: Option A, phased.**
- Phase 1 = three.js skeleton + flat terrain + existing shapes as textured quad billboards
  (proves map/units/selection/HUD wiring).
- Phase 2 = real glTF models.
- Phase 3 = height / arcs / particles.
- Phase 4 = polish (lighting, shadows toggle, AA).

---

## 4. The Z-axis (on a flat sim)

The map is flat, so height is a *presentation function*, not data:

- Ground height = 0; water gets a subtle animated shader (waves computed from `world.tick`, deterministic).
- Unit elevation from a deterministic hint: air units already have hover offsets → map them to real altitude
  (keep their ground shadow); naval units bob with a wave phase.
- Buildings sit at y=0, "grow" during construction via the existing progress fraction.
- Depth order = `isoY` from the 2D renderer, which maps 1:1 to the z-buffer in 3D (same painter rule). Free.
- *Deferred (optional):* per-tile heightmap in `MapData` — a protocol change and a map-builder feature; not part of this tier.

**Hidden cost:** move-marker, range circles, build ghost, minimap and selection boxes are computed in
screen space today (`renderer.ts` iso math). They must be remounted to project from the 3D camera.
Mechanical, but the main "surprising" cost.

---

## 5. Bullet physics — the fork in the road

### 5a. Cosmetic ballistics (zero sim risk) — **ship this first**
- Sim keeps resolving hits instantly (identical balance, identical replays).
- Renderer draws each `shot-fired` with a real arc: pure function of already-replicated data
  (start point, end point, weapon type, `world.tick`). Parabolic gravity + travel time for display only.
- Artillery/rockets visually lob; fighters strafe low. **Looks** like real physics, plays exactly the same.
- Determinism: trivial — same numbers on every client; replays render identically.

### 5b. Gameplay ballistics (travel time in the sim) — separate, versioned project
- New **projectile entity** integrated per tick (deterministic math — gravity, drag, homing — fully safe computationally).
- But it changes gameplay semantics: dodging, damage-at-impact-point vs target entity, splash at landing,
  blocked mid-flight, line-of-sight, firing-unit killed before impact, fighter behavior — and the whole
  balance table (artillery / missile-boat effectively become different weapons).
- **Must** bump `PROTOCOL_VERSION` (new wire fields / history records), invalidate stored replays,
  new event/command schema, re-check every combat test. A day to wire, a long tail to tune.

**Recommendation:** ship 5a now. Design the tracer/arc layer behind an interface
(`ProjectileShot { origin, target, weaponId, tick }`) so a future 5b can feed it without rewriting the render.

---

## 6. Particles

Today's FX (`fxFrameTexture`, impact rings, burn flicker, tracers) is deterministic and tick-driven —
keep that property. In 3D:

- Use three.js GPU `Points` (InstancedBufferGeometry): smoke, sparks, muzzle flash, ground dust,
  explosions, water wakes/splashes (ties into the naval units), projectile trails, debris.
- **Seed rule:** each effect instance derives its RNG seed from `(world.tick, entityId, eventIndex)` —
  identical on every client, deterministic in replays, visually organic.
- Reuse the existing `effects` toggle and a "3D FX density" sub-setting (mirrors today's dev tunables
  `fxScale` etc. in `ui/graphics.ts`).

---

## 7. Blender pipeline

Blender is the right tool: free, first-class glTF 2.0 exporter, Python-scriptable batch workflows.

### Export standard
- **Format:** glTF 2.0 **binary (`.glb`)** via the built-in exporter.
- **Units:** 1 Blender unit = 1 tile (`TERRAIN_FX = 1000` ⇒ 1 m ≈ 1 tile). Origin at tile center, +Z up.
- **LODs:** 2 per model (`_lod0` hero, `_lod1` low-poly); extreme zoom-out uses the existing PNG
  sprites as camera-facing quads (free fallback).

### Team colors (10 palettes)
Do **not** bake 10 variants per model (that would explode asset size):
- One albedo + a **color-mask texture** (mask channel marks the "team region"); the shader swaps team
  color from the existing `PLAYER_COLORS` palette at runtime. One model, N colors.
- Keeps today's `assetPaths` / color philosophy, expressed as a shader uniform.

### Naming (match existing folder tokens)
```
dist/3d/<folder>/<folder>.glb           # e.g. dist/3d/v_b/v_b.glb
dist/3d/<folder>/<folder>_lod1.glb
dist/3d/<folder>/tex_<name>.ktx2        # compressed textures
```
Reuse existing ids so `validate-assets.mjs`, dev asset-path overrides and preload logic extend cleanly.
(Bonus: `scout`, `rifleman`, `rocket-trooper`, `engineer`, `apc` currently lack PNG folders —
3D can give them proper folders too.)

### Animation remap (respect the frame conventions)
| 2D today | 3D equivalent |
|---|---|
| Unit 8 heading frames | One rig; free rotation from heading |
| Building frames 1–4 (build %) | Construction rig driven by progress fraction (scaffold + scale-in) |
| Building frames 5–8 (damage) | Damage tiers (smoke / embers / cracked materials) |
| Fixed turret | Turret/barrel yaw + pitch toward target |
| Harvester / carrier capacity | Visual cargo fill (deck / workers) |
| Wreck | Collapsed / destroyed variant |

### Tooling
- A **Blender Python add-on** that exports all scenes in one pass (names / LODs / textures right),
  so artists don't run pipelines by hand.
- A `scripts/export-3d.mjs` that validates naming + sizes on CI (sibling of the existing
  `scripts/validate-assets.mjs`).

### Volume estimate
13 units + 11 buildings + 4 obstacle types + 2 field kinds + wrecks ≈ **~31 hero models** (+ LODs).
For a competent stylized-model artist this is roughly **30–60 working days** (units ~1–2d each,
buildings ~1d), plus rig/animation. Engineering side (three.js integration, shaders, loader, camera)
is roughly **5–10 working days** with the phased plan.

---

## 8. Slotting in as a 4th quality tier

Quality is client-only, so this is clean:

- Extend `GraphicsQuality` with `'3d'`, append to `QUALITIES`, gate the renderer entry point
  (`quality === '3d'` → run 3D world; else run the existing Pixi world).
- Leave `low / medium / high` untouched. `'3d'` auto-falls back to `high` if WebGL2 is unavailable.
- Add i18n `settings.graphics.quality.3d` (en/ar); reuse the existing quality-chip UI.
- Screen-space UI (health bars, banners, stealth hats, veteran pips, selection) currently lives on its
  own `zIndex` bands → *project* those onto the 3D scene instead of re-authoring.
- Add 3D-only sub-settings (shadow quality, FX density, AA) under the same graphics panel,
  mirroring today's dev tunables.

---

## 9. Performance & compatibility

- **Requires WebGL2** (universal on modern browsers; the game already uses WebGL via Pixi).
  Auto-downgrade to `high` if unavailable.
- **`InstancedMesh`** for armies (units share geometry — a 100-unit battle is 1–2 instanced draw calls
  per type); **object pooling** for particles.
- **Shadows are the real cost:** default to blob shadows (matching today's shadow blobs);
  real shadow maps as an opt-in `'3d'` sub-setting.
- **Bundle impact:** three.js ≈ 150–170 kB gzip; models/textures loaded on demand per match —
  only folders used and only colors in play (exactly like today's `preloadBuildingSprites`).
- **Textures:** KTX2/BasisU (+ optional DRACO / meshopt geometry compression).
  Budget ~2K albedo / 1K mask per hero, lower for LOD1.
- **Memory:** 64×64 maps imply potentially thousands of units under stress; LOD + instancing keep
  draw calls bounded.

---

## 10. Effort, risks, sequencing

### Rough budget (focused team)
| Phase | Scope | Est. effort |
|---|---|---|
| P0 | three.js integration spike + camera remap + flat terrain as billboards | 2–3 days |
| P1 | Models pipeline: Blender export add-on + loader / LOD / preload + team-color shader | 3–5 days (artist runs in parallel) |
| P2 | Height / arcs / cosmetic ballistics + particle system | 3–5 days |
| P3 | Lighting / shadow toggle / AA / finish FX (naval wakes, weather in 3D) | 3–5 days |
| Art | ~31 hero models + LODs + animations | 30–60 days (parallelizable with P0–P3) |

### Risk register
| Risk | Mitigation |
|---|---|
| **Determinism creep** (render math feeding back into the sim) | Hard rule: 3D layer is read-only over `world` + events (same as current renderer) |
| Protocol / replay breakage from ballistics | Ship cosmetic arcs first; gameplay ballistics = separate versioned task |
| Screen-space UI disconnect in 3D | Reuse existing layered containers; project, don't re-author |
| Asset scale mismatch (models ≠ sprite footprint) | Define 1 m = 1 tile up front; bounds/silhouette parity checks in export validator |
| Build / CI bloat from binary assets | Validate sizes + naming in `export-3d.mjs`; KTX2 textures at build time |
| WebGL2 missing | Auto `'3d'` → `'high'` (same tunable-quality philosophy) |

### Sequencing recommendation
1. **P0 first** — proves camera / UI / projection wiring with zero new art (reuse existing PNGs as
   billboards). Days, not weeks, to a verdict.
2. Expose the new tier early ("3D beta") while art lands incrementally; unmodeled types keep the
   vector-shape / billboard fallback.
3. Cosmetic ballistics + particles ride along in P2.
4. **Defer** gameplay ballistics and per-tile heightmaps to separate todo entries, each with its own
   `PROTOCOL_VERSION` decision.

---

## 11. Bottom line

- **Tooling:** Blender → glTF 2.0 (`.glb`) is exactly right.
- **Architecture:** keep a 2D, deterministic, networked sim; add three.js as a pure presentation layer.
  "3D" then costs a client file, an i18n string, and a WebGL2 feature-detect — no protocol change,
  no replay breakage, no determinism risk.
- **Bullets:** render real arcs now; reserve genuine travel-time ballistics for its own versioned feature.
- **Effort:** ~15–20 engineering days phased (P0→P3) + a parallel **30–60 day** 3D-art production.
  The biggest business risk is animation/art scope, not the code.

---

## 12. Animation in the 3D tier (Option A)

### 12.1 Core principle: zero animation state in the sim
The sim stores no animation state today and must keep it that way. It stores only
`transform.x/y`, `class`, balance `speed`, work state, combat target + `reloadTicks` /
hit ticks, hp / build / fill fractions, production progress. Everything seen is re-derived
per frame. Precedent exists already: `renderer.ts` computes facing live as
`unitDirFromScreenAngle(Math.atan2(sy, sx))` from the movement delta — there is **no heading
field** on any entity.

A 3D rig's pose controller is a pure function of replicated data:

```text
pose = f(world, entityId, world.tick)   // + a render-side sub-tick t∈[0,1)
                                        //   interpolating the last two tick snapshots
```

No `Math.random()`, no `Date.now()`, no wall-clock in pose math. Phases are seeded by
`world.tick + id` — exactly the existing flame-flicker pattern
(`Math.sin((tick + id) * 0.9)`, `renderer.ts:1738`). This keeps replays frame-identical.

### 12.2 Inputs already available (all replicated)
| Signal | Source | Drives |
|---|---|---|
| Instantaneous direction / moving weight | transform delta between last two ticks | yaw, locomotive blend, gait on/off |
| Moving vs stopped | `world.moves` (path / pathIndex / chase) | idle⇄walk |
| Aim point | combat target, `world.tick - hit.hitTick < 4` | turret/barrel yaw+pitch, recoil, muzzle flash |
| Work | `world.works` kind + progress; `world.harvesters` dock/field/trips | drill / blade / arm poses, cargo-fill visual |
| Fractions | hp %, build %, powerdown, veteran, stealth | damage tiers, scaffold, smoke, hats |
| Cycle phase | `id` + `tick` | rotor/wheel spin, wave bob, footsteps |

### 12.3 Per-unit rig = 4 pose layers
1. **Locomotion** (chassis/legs/wheels): blend from `gate(speed)` — balance `speed` is in
   fx/tick (deterministic). Wheels roll ∝ distance/circumference; tracks scroll UV; walkers
   take a gait cycle whose **phase = distanceMoved ÷ cycleLen** (distance from the replicated
   path → identical on every client); hover/naval bob on `sin((tick+id)·k)` and bank into
   turns; air spins rotors (id-seeded) and pitches/rolls with velocity.
2. **Aim** (turret/barrel/head override layer, per-model mask): yaw/pitch toward attack target
   when in range, else movement heading. Render-side smoothing must be **tick-based** (fixed
   turn constant per tick), not rAF `deltaTime`, to stay deterministic.
3. **Gesture/FX** (event ring buffer): muzzle flash, recoil push, shell eject, impact spark,
   heal sparkle — fixed-duration windows keyed to an event's tick stamp, same model as
   `addImpact` / `flashing` today. Never loops unaided.
4. **State** (pose override): EMP (idle + electric particles), stealth (alpha flicker), dying
   (fixed-length death anim → wreck mesh), building-contact poses (pad/edge) when constructing.

Transitions are pure predicates with fixed tick durations:
`IDLE ─speed>0→ MOVE ─target & reload ready→ ATTACK ─reloadTicks elapsed→ MOVE/IDLE`;
`ANY ─hp≤0→ DEAD`.

### 12.4 Buildings
Derived from replicated `world.buildings`: `done`/`hp` drive the **construction scaffold +
4 damage tiers** (today's status-frame fractions), `researchProgress` → antenna pulse,
`spawnProgress` → dock crane / war-factory hatch / hangar doors, turret target tracking,
powered/powerdown → lights. Functional idle loops (turbines, cranes, rotating radar) use
id-seeded phase.

### 12.5 Pitfall to avoid
Never let velocity interpolation or frame-timed animation feed sim-visible state, and never
key pose *phase* to real time — only to `tick`. `performance.now`-driven camera shake stays
disjoint from entity pose, as the 2D FX layer already behaves.

---

## 13. The 3D map and the nav algorithm (Option A)

### 13.1 Nav stays 2D — the 3D map is its visualization
Pathfinding runs on per-class **mask arrays** built deterministically in `world.ts`
(`rebuildGridIfDirty`): `grid.passable` (Ground / BuildableGround / Road → ground + infantry),
`grid.water` (→ naval), `component` (connected-region IDs → unreachable-goal pruning).

`findPath` (`client/src/core/pathfinding.ts:74`) is plain **A\*** over 2D tile cells
(straight=10, diagonal=14, cached typed-array scratch, `maxNodes` guard, `findPathNear`
fallback). `movement-system.ts` steps units along cardinal waypoint centers at `speed`
fx/tick, then applies separation (lateral suppression, building/field push-out
`pushAwayFromRect`, mask-validated positions, stuck-relocation to nearest mask cell). Air
units ignore the masks entirely (direct-line). The 3D renderer reads this same output —
**nothing about it changes.**

### 13.2 Congruence rule: "props carry the Z"
- **Ground/BuildableGround/Road render flat at y=0.** Units always walk on y=0; no visual
  hills to clip into.
- Every height lives on things the mask already blocks: obstacles (rock/tree/wreck/mine),
  **buildings** (raised pedestals of exposed rock so they look grounded), **cliff tiles**
  (perched meshes with a shear edge — impassable today, dressing), fields (props).
- **Water renders as its own lower plane** (y = −h); naval floats at `y_water + bob`; a
  beach/bluff ring at the Water↔Ground boundary sells the elevation. The masks do the
  gripping/docking exactly as today — zero nav change.
- Result: walkable tiles are flat, so a unit can never visually walk through a hill it can't
  path over, because hills are only drawn where the mask says "blocked".

### 13.3 Picking & UI back-projection
Cursor ray from the 3D camera hits the **y=0 plane** → fx `x,y` → tile → existing
`input-system` semantics (selection box, move/build commands). Range circles, move-marker,
build ghosts and order badges become **decals on the y=0 plane** instead of iso math. The
minimap stays a separate 2D bitmap; fog / pings / radar untouched.

### 13.4 Real 3D nav (deferred — protocol change, not this tier)
True elevation (slopes/ramps) is a *sim* change:
- `MapData` gains per-tile `elev` → format + checksum + **`PROTOCOL_VERSION` bump**, map-builder update.
- A\* gains a 3rd cost (`base + k·|Δelev|`), max-climbable-slope passability, bridge/ramp
  cells; connected-components and `lineClear` become 3D (does the shell clear the crest?);
  `movement-system` moves in z from an interpolated heightmap and separation considers z;
  range/dps-vs-arc re-tuned.
- Separate feature with its own day-plan + version gate — **not** part of the '3D' quality tier.

### 13.5 Recommendation
- v1 = "flat but jeweled" (13.2). Nav untouched, 1:1 mask↔mesh.
- Add a dev toggle painting the `passable`/`water` masks over the ground mesh so any future
  mask↔mesh drift is visible (spirit of the existing debug layer).

---

*Status: research only, no code changes. See `docs/04-ARCHITECTURE.md` / `docs/05-ASSET-PIPELINE.md` for the systems this report extends.*