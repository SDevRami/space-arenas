# 17 — Rendering, Audio & Input

**Status:** Current (code-grounded)

**Project:** Space Arenas — RTS game
**Companion docs:** 03-TECHNICAL-SPECIFICATION.md (stack/build), 04-ARCHITECTURE.md (sim/structure), 05-ASSET-PIPELINE.md (asset storage/paths)

This document covers the three client-only runtime systems: the PixiJS render pipeline, the audio stack, and the input/controls stack. All identifiers below are taken from the source of truth (`client/src/render/*`, `client/src/audio/*`, `client/src/input/*`, `client/src/ui/*`, `client/src/systems/input-system.ts`, `client/src/game/Game.ts`).

---

## 1. Rendering

### 1.1 PixiJS application

The renderer (`client/src/render/renderer.ts`) creates one PixiJS `Application`:

| Setting | Value |
|---|---|
| `resizeTo` | `window` |
| `background` | `0x101418` |
| `antialias` | `true` |
| `resolution` | `Math.min(window.devicePixelRatio, 2)` |
| `autoDensity` | `true` |

- The canvas lives in `#game-canvas` inside `#app`.
- `this.vv = window.visualViewport` is used to heal mobile viewport drift (URL-bar show/hide, rotation) — `render()` re-triggers `onWindowResize()` whenever `window.innerWidth/Height` no longer match the camera's stored viewport.

### 1.2 Scene graph & layer order

One `worldLayer` container holds the world. Its position/scale are driven from the camera each frame: `worldLayer.position.set(camX*zoom + shake.x, camY*zoom + shake.y)` and `worldLayer.scale.set(zoom)`. `worldLayer.sortableChildren = true` and children are sorted by `zIndex`.

**Fixed z-bands** (for children whose order is *not* user-configurable), `renderer.ts` lines 40–45:

| Constant | Value | Applied to |
|---|---|---|
| `FIXED_Z_GROUND` | -80 | `groundSprite` |
| `FIXED_Z_FOG` | -60 | `fog.container` |
| `FIXED_Z_SHADOW` | -40 | `shadowLayer` |
| `FIXED_Z_TEAM` | -20 | `teamLayer` |
| `FIXED_Z_OVERLAY` | 50 | overlay children (see below) |
| `FIXED_Z_DEBUG` | 1000 | debug/path/air-shadow-top |

**`worldLayer` children in add order** (`init()`), with the z applied by `applyFixedLayerZ()`:

| Order | Child | z |
|---|---|---|
| 1 | `groundSprite` | `FIXED_Z_GROUND + delta` |
| 2 | `fog.container` | `FIXED_Z_FOG + delta` |
| 3 | `shadowLayer` | `FIXED_Z_SHADOW + delta` |
| 4 | `teamLayer` | `FIXED_Z_TEAM + delta` |
| 5 | `troopLayer` | configurable `troop` |
| 6 | `vehicleLayer` | configurable `vehicle` |
| 7 | `buildingLayer` | configurable `building` |
| 8 | `hitboxLayer` | configurable `border` |
| 9 | `fieldLayer` | `FIXED_Z_OVERLAY + delta + 0` |
| 10 | `obstacleLayer` | `+1` |
| 11 | `spawnLayer` | `+2` |
| 12 | `flagLayer` (holds `rallyLineG`) | `+3` |
| 13 | `airLayer` | `+4` |
| 14 | `ghostLayer` (holds `ghostOutline`, `rangeRingG`) | `+5` |
| 15 | `barLayer` | `+6` |
| 16 | `veteranPipLayer` | `+7` |
| 17 | `stealthHatLayer` | `+8` |
| 18 | `powerLayer` | `+9` |
| 19 | `teamFlagLayer` | `+10` |
| 20 | `fxLayer` (holds `fxGraphics`) | configurable `effect` |
| 21 | `debugLayer` | `FIXED_Z_DEBUG + delta` |
| 22 | `pathLayer` (holds `pathGraphics`) | `FIXED_Z_DEBUG + delta + 1` |
| 23 | `airShadowTopLayer` | `FIXED_Z_DEBUG + delta + 2` |

**Configurable sprite layers** (`SPRITE_LAYER_KINDS = ['border','troop','vehicle','building','effect']`): `applySpriteLayerOrder()` reads `getGraphics().spriteLayerOrder` (each clamped -50..50 on load/save via `setSpriteLayerOrder`), applies them, calls `applyFixedLayerZ()` to pin the non-configurable children relative to the smallest configurable value (`delta`), sets `hitboxLayer.zIndex = order.border + delta`, then re-sorts. `render()` re-applies only when the order signature changes (1 call per change).

**On the `app.stage`** (not in `worldLayer`): `worldLayer`, then `nightOverlay` (`Graphics`, `eventMode='none'`), then `boxLayer` (holds `boxGraphics`) for the selection rectangle — so selection box and night tint draw above the whole world.

### 1.3 Camera & zoom (`client/src/render/camera.ts`)

| Member | Detail |
|---|---|
| Projection | 2:1 isometric, `ISO_HALF_W=32`, `ISO_HALF_H=16`; sim coordinates are fixed-point (`/1000` per tile) |
| `zoom` | defaults `1`; clamped by `zoomMin/zoomMax` via `setZoomRange(min,max)` (ignores non-finite/≤0 min; max must exceed min; current zoom re-clamped) |
| Ranges | normal `DEFAULT_ZOOM_MIN=0.5` / `DEFAULT_ZOOM_MAX=2.5`; replay/spectate `DEFAULT_REPLAY_ZOOM_MIN=0.4` / `DEFAULT_REPLAY_ZOOM_MAX=5` (`client/src/ui/graphics.ts`; dev-settings adjustable, 0.05–1 and 1–20/50 clamp) |
| `centerOnMap` / `centerOn` | initial camera placement / center on a fixed-point world point |
| `worldToScreen` / `screenToWorld` / `screenToWorldExact` | fixed-point ↔ screen; `screenToWorld` snaps to a tile (`floor(tx)*1000+500`), `screenToWorldExact` is continuous |
| `panBy(dx,dy)` | moves by `dx/zoom` world px |
| `zoomAt(px,py,factor)` | zoom keeping the cursor point fixed; clamped to range |
| `isInView` / `isInViewBox` | culling with a margin (default 64 px) |
| `resize(w,h)` | viewport only; caller re-centers |

### 1.4 Minimap (`client/src/render/minimap.ts`)

- Two canvases: `canvas` (terrain/fog/blips) and an overlay `viewport` canvas (`pointerEvents='none'`) for the viewport rect, attack flashes and pings.
- Terrain colors `TERRAIN_COLORS` (Ground `#3a442f`, Cliff `#5c5140`, Water `#2c5877`, Road `#454b4f`, BuildableGround `#424d35`), with per-map `groundColors` override + `applyBrightness`.
- Fog: `FOG_DARK='rgba(0,0,0,0.45)'` (unexplored), `FOG_LIGHT='rgba(0,0,0,0.22)'` (explored), updated incrementally against `prevFog`.
- Blips: own units `#7cf27c`, enemy `#f07c7c` (2×2 px), buildings `#ffffff` (3×3 px), respecting `world.isVisibleTo`.
- **Radar gate:** without radar (and not revealing all) it clears to `HIDDEN_BG='#0b0e15'` and prints **"CONNECT RADAR"**; `Renderer.render()` calls `minimap.draw(world, localTeam, camera, world.radarActive(localTeam), showAll)`.
- Zoom: `zoomBy(factor, mx, my)` clamped `0.6..4`; `displayScale` (from `DEFAULT_MINIMAP_SCALE=1.6`, clamp 1.2–4) sets CSS size; offsets clamped so the map can't be panned out of view.
- **Attack flashes:** `flashBuilding(startTick, team, x, y)` pushes a flash drawn as a decaying red ring (`age > 30` ticks removed).
- **Pings:** `PING_COLORS` = `alert #ff5c5c`, `assist #ffd45e`, `on-my-way #7cf27c`; only the local team's *alliance* pings are drawn, for `PING_TICKS`, as expanding fading rings + a dot.
- **Viewport rect:** white `strokeRect` from the four screen corners mapped through `camera.screenToWorld`.

### 1.5 Sprite & fx loading, fallbacks (`client/src/render/building-sprites.ts`, `shapes.ts`)

- **Procedural first:** `client/src/render/shapes.ts` bakes vector textures per quality (`textureFor`, `obstacleTexture`, `fieldTexture`, `supplyIconTexture`, `oilIconTexture`, `lightningTexture`, `flagTexture`) via `renderer.generateTexture({resolution: 8, antialias: true})`, cached in a module `Map` and cleared by `clearShapeCache()`.
- **High-quality images** load per-file with Pixi `Assets.load(url)`; `buildingImagesEnabled() === quality === 'high'`. `preloadAllMatchAssets(onProgress)` warms every building frame (1–8) × 10 colors, every unit direction × 10 colors, supply/oil frames, obstacles and burn fx.
- **Missing → vector:** every texture getter returns `null` on miss/unknown/not-yet-loaded and the renderer draws the procedural shape; individual loads swallow their own errors so preload never rejects.
- **Frame mapping:** buildings use `buildingStatusIndex(done, progress, hpFrac)`; units map screen angle → `ANGLE_TO_DIR` bin (8 headings), with on-disk `FRAME_TO_DIR` for 0001–0008; supply `supplyFieldStatusTexture(frac)` (frame 1 full → 25 empty), oil `oilFieldStatusTexture(hpFrac)` (4 damage states); `fxFrameTexture('burn', n)` for the optional burn animation.
- **One-request bundle:** `client/src/render/sprite-bundle.ts` fetches `/assets/sprites.bundle` (u32 header length + JSON `[path,offset,len]` + PNG bytes). The host builds/serves it (`host/src/index.ts::buildSpriteBundle`, route `/assets/sprites.bundle`). **Currently inert:** `textureFromBundle()` in `building-sprites.ts` is stubbed to `return null`, so the per-file path is what runs; the bundle plumbing is implemented but not yet wired into texture adoption.
- **Teardown:** `unloadAllAssetTextures()` clears caches and calls `Assets.unload(urls)` (Assets-owned textures must not be destroyed directly).

### 1.6 Ground & fog (`client/src/render/ground.ts`)

- **Ground:** `buildGroundTexture(map)` paints isometric diamonds per tile onto a canvas (`GROUND_SCALE=0.5`), honoring per-map `groundColors` and `applyBrightness`, with a subtle checker on plain ground; becomes one `Sprite`.
- **Fog:** `FogRenderer` renders fog into a low-res canvas at `FOG_CELL=4` tiles per cell, keeps `cellBest` per cell and only repaints changed cells; upscaled `sprite.scale.set(FOG_CELL, FOG_CELL)`. Alphas: `0 → rgba(0,0,0,0.75)` (unseen), `1 → 0.5` (explored), `2 → 0` (visible).

### 1.7 Weather overlay (`client/src/render/weather.ts`)

- A separate DOM canvas appended to `#app`, `position:absolute; inset:0; pointerEvents:none; zIndex:11` — it sits above the Pixi canvas and never touches sim state (purely cosmetic, uses `Math.random()`).
- `WeatherId = 'none' | 'rain' | 'snow' | 'thunder'` (`WEATHERS` in `client/src/ui/graphics.ts`); per-match weather also selectable in the lobby (`match-weather`).
- Particle counts: `RAIN_PER_PX=0.00045`, `SNOW_PER_PX=0.00018`, capped at `MAX_PARTICLES=1200`; thunder uses rain density ×1.15. Rain drawn as slanted streaks (`#a8c2ec`), snow as drifting circles (`#e8f2ff`) over a faint tint; thunder adds periodic full-screen flashes (`flash`/`nextFlash` counters).
- DPR-aware sizing (`Math.min(devicePixelRatio,2)`); `Game` constructs it as `new WeatherOverlay(document.getElementById('app')!)` and drives `step()`/`draw()`.

### 1.8 Day/night (`client/src/ui/graphics.ts`, `renderer.ts`, `Game.ts`)

- `dayNightTint(phase)` returns `{ color: 0x1a2a44, a: 0.25 * night }` (a=0 at noon).
- `Renderer.setDayNight(phase)` (phase 0 = full day, 1 = full night) repaints `nightOverlay` as a full-screen rect when the milli-phase changes.
- `Game` calls `renderer.setDayNight(world.settings.dayNight ? this.dayPhase(world) : 0)` each frame. `dayPhase()` derives a 0..1 factor from `world.settings.dayNightCycleTicks` and `dayNightTransitionTicks`: day → dusk (`+T`) → night → dawn (`-T`), flat 0/1 in between.

### 1.9 Camera shake

`updateLaserShake(world)` watches active `world.lasers`; while any strike is live it sets an amplitude (8) spanning `startTick..untilTick`, and `shakeOffset(tick)` returns a decaying sine/cosine pixel offset applied to `worldLayer.position` (hard at strike start, zero when it ends). No shake → `{x:0,y:0}`.

### 1.10 Victory cinematic (`client/src/game/Game.ts`)

- `beginCinematic(winner)` (line 803): sets `finished`/`paused`, reads `getGraphics().victoryCinematicSec` (`DEFAULT_VICTORY_CINEMATIC=6`, clamp 0–30). If `secs <= 0` it jumps straight to `showResults(winner)`; otherwise it sets `cinematicActive`, `cinematicWinner`, `cinematicUntil = performance.now() + secs*1000`, writes the localized title (`netTitle`) into `#cinematic-text` (adds `.defeat` class when defeated) and shows `#cinematic-overlay` (`.visible`).
- `onFrame()` closes it when `performance.now() >= cinematicUntil` and calls `showResults(cinematicWinner)`; also reachable from a late `e.winner` event and the replay path.
- `#cinematic-overlay` is one of the `UI_SCALE_TARGETS` (scaled with the HUD).

### 1.11 HUD / UI scaling (`client/src/ui/graphics-settings.ts`)

`uiScale` (0.5–1.5, default `DEFAULT_UI_SCALE=0.8`) sets `style.zoom` on every game-UI container in `UI_SCALE_TARGETS`: `hud, cinematic-overlay, results-overlay, groups-overlay, countdown-overlay, reconnect-overlay, roomfull-overlay, relay-fallback-overlay, diag-overlay, lobby, create-overlay, invite-overlay, controls-overlay, controls-info-overlay, err-box`.

---

## 2. Audio

### 2.1 Model & settings (`client/src/audio/settings.ts`)

`AudioSettings` persisted to localStorage `space-arenas:audio`:

| Field | Default | Meaning |
|---|---|---|
| `master` | 1 | master volume |
| `effects` | 0.8 | UI/SFX volume |
| `ambient` | 0.35 | lobby ambient |
| `ambientInMatch` | 0.35 | in-match ambient |
| `music` | 0.6 | lobby music |
| `muted` | false | master mute |
| `ambientEnabled` | false | ambient layer on/off |
| `musicMuted` | false | lobby music mute (independent of ambient & master) |
| `haptics` | true | mobile vibration |
| `overrides` | `{}` | per-kind file/folder override URL |
| `tuning` | `{}` | per-kind `{vol, pitch}` |

Effective volumes: `effectsVolume = muted ? 0 : master*effects`; `ambientVolume` / `ambientInMatchVolume` are 0 when `muted || !ambientEnabled`, else `master*ambient` / `master*ambientInMatch`; `musicVolume` is 0 when `muted || musicMuted`, else `master*music`. `onChangeAudio(cb)` notifies the live graph; `reloadAudio()` re-reads storage (e.g. after a profile restore). The settings UI (`client/src/ui/audio-settings.ts`) exposes sliders for master/effects/ambient/music/ambientInMatch, toggles for muted/musicMuted/ambientOn/haptics, and a live effective-volume summary.

### 2.2 Autoplay unlock

- `AudioHooks.unlock()` creates the `AudioContext`, master gain, and two ambient gains (`ambient`, `weather`), then `refitAmbient()` and rebuilds any pending layers. Browsers require a user gesture, so the context is created on first interaction.
- Lobby: `client/src/main.ts` installs one-shot `pointerdown`/`keydown` listeners (`unlockLobbyAudio`) that call `lobbyAudio.unlock()`, `lobbyAudio.startLobbyAmbient()` and `startLobbyMusic()`.
- In-match: `Game` calls `this.audio.unlock()` on a canvas pointer event (line 3720) and `startGameAmbient()` / `startWeatherAmbient(getGraphics().weather)` at match start (lines 1178–1183).

### 2.3 SFX: synthesis, file overrides, tuning (`client/src/audio/hooks.ts`)

- **Override resolution** (`overrideUrls`): explicit single file → play it; folder → probe bundled `SOUND_FILE_NAMES[kind]` then legacy `v1.wav…v12.wav` (only existing files, HEAD probes, cached); no override → HEAD-probe the bundled `sound/<kind>/<name>.wav` when a name exists, else synth.
- **Playback:** `playSfx(kind, opts)` → `playVariants` (shuffle deck, no immediate repeats) → `playAsset` (fetch + `decodeAudioData` + gain envelope + `playbackRate = pitch*tuning.pitch`); any fetch/decode failure falls back to `synthSfx`.
- **Synth:** `synthSfx` switches per kind (e.g. `select` 720 Hz square pair, `weapon-cannon` 160→80 Hz sweep, `victory` 4-note C-E-G-C arpeggio, `achievement` chime). Internal synth-only kinds: `base-alert`, `sw-chosen`, `airstrike-bomb`.
- **Positional falloff:** `positional(x,y)` scales gain by distance to `listenerX/listenerY` (set by `Game` from the camera center): 1 at center, ~0.3 at 18 tiles (`clamp01(1-(dist-2)/16)`).
- **Tuning:** `getTuning(kind)` (default `{vol:1,pitch:1}`) applied on top of the per-kind gain; clamps `TUNING_VOL_MAX=4`, `TUNING_PITCH_MIN=0.25`, `TUNING_PITCH_MAX=4`.
- **Event mapping:** `onEvent(SimEvent)` maps sim events → kinds (e.g. `airstrike-bomb` → `bomb-strike`, `sw-chosen` → `select`, `unit-ranked-up` → a pitch-by-rank tone).
- **Helpers:** `playSelectBleep(clazz)` (pitch by class: vehicle 0.7, air 1.2, else 1), `playWeaponSfx(weaponId, x, y)` (`rifle→weapon-rifle`, `rocket→weapon-rocket`, `cannon→weapon-cannon`, `artillery→weapon-artillery`, `air-cannon→weapon-air-cannon`, `aa→weapon-rifle`, `turret-gun→weapon-cannon`), `baseAlert(x,y)`, `uiClick()`, `ping()` (880 Hz through master).

### 2.4 Ambient layers

- Two `GainNode` layers: **main** (`ambient`) and **weather**, both under master gain.
- `startAmbient(kind, synthSpec)` (idempotent): if `kind` resolves to files it loads all buffers and plays them one-by-one in a shuffled rotation that loops (`playNextFile` with fade-in/out envelopes); otherwise it builds a synth drone (`buildSynthLayer`: oscillator + sine LFO on frequency, gain from tuning).
- `AMBIENT_SYNTH`: `ambient-lobby` {freq 49, sawtooth, wave 0.2}, `ambient-game` {55, sawtooth, 0.35}, `rain-ambient` {62, sawtooth, 0.6}, `snow-ambient` {38, triangle, 0.15}, `storm-ambient` {30, sawtooth, 0.9}.
- Convenience: `startLobbyAmbient()` → `ambient-lobby`; `startGameAmbient()` → `ambient-game`; `startWeatherAmbient(weather)` maps `rain→rain-ambient`, `snow→snow-ambient`, `thunder→storm-ambient`, `none→stop` (weather layers *over* the main ambient).
- `refitAmbient()` scopes volumes: main layer uses the lobby slider unless the kind is `ambient-game` (in-match slider); the weather layer always uses the in-match slider; both obey `muted` and `ambientEnabled`. `onChangeAudio` triggers a refit.
- `stopAmbient()` / `stopAll()` tear layers/sources down (`stopAll` also stops active SFX sources and bumps the generation token).

### 2.5 Lobby music (`client/src/audio/lobby-music.ts`)

- `TRACK_URL = ${import.meta.env.BASE_URL}sound/SPACE.ARENAS_by_SDEVRAMI.mp3`; an `HTMLAudioElement` with `loop` and `preload='auto'`.
- `startLobbyMusic()` / `stopLobbyMusic()` fade over `FADE_MS=1200`; `syncVolume()` (wired to `onChangeAudio`) fades to the effective music volume (300 ms) or pauses at zero. Lobby-only — never during a match. `tryPlay()` swallows autoplay rejections and retries on the next unlock.

### 2.6 Mute model

Four independent gates compose multiplicatively: **master mute** (`muted` zeroes everything), **effects** (master×effects), **ambient** (`ambientEnabled` gate + `ambient`/`ambientInMatch` sliders), **music** (`musicMuted` gate + `music` slider). The ambient and music mutes are separate from each other and from master mute.

### 2.7 Haptics (`client/src/audio/haptics.ts`)

`navigator.vibrate`, gated by `hapticsEnabled()` (`haptics && 'vibrate' in navigator`): `hapticSelect()`=15 ms, `hapticAction()`=30 ms, `hapticDamaged()`=`[25,30,25]`.

### 2.8 Diagnostics

`availableSounds(kind)` lists the files the override resolves to; `diagnose(kind)` reports context state, effective volumes, the override, resolved files, then fetch+decode of the first file (context/HTTP/decode result). `ping()` proves the graph + speakers independent of any files.

---

## 3. Input

### 3.1 InputManager (`client/src/input/input.ts`)

Attaches to the canvas/window: `mousedown`/`mousemove`/`mouseup`/`mouseleave`, `wheel` (`passive:false`), `keydown`/`keyup`, `blur`, `visibilitychange`, and (when touch is enabled) `touchstart`/`touchmove`/`touchend`/`touchcancel` (`passive:false`). It tracks `mouseWorld`/`mouseScreen`, modifier flags, box-select state and touch gestures, and emits callbacks: `onCommand`, `onClick`, `onBox`, `onPan`, `onZoom`.

### 3.2 Mouse

- **Buttons** come from bindings: `mouseButton('move')` / `mouseButton('select')` → 2 (right) or 0 (left) via `mouseSide` (swap the `move`/`select` binding to `'right'`/`'left'`).
- **Right-click command:** on mouseup within 6 px of mousedown it emits `onCommand(kind, world)` where `kind` precedence is **keep-attack > guard > attack-move > move** (from the held `keepAttack`/`guard`/`attackMove` keys).
- **Left-click / box-select:** a drag under 6 px emits `onClick` (with ctrl/shift/alt and `touch:false`); a larger drag emits `onBox` with the screen rect. When a "paint" mode is active (`setPaint(true)`) every left click emits `onClick` instead.
- **Middle-drag** pans. **Wheel** zooms by ×1.15 (or ÷1.15) at the cursor, `preventDefault`.
- **Edge-pan:** `edgePanVelocity()` returns a velocity only when the **Ctrl (`mod`) modifier is held**, the mouse is inside the canvas, and `document.elementFromPoint` at the cursor is the canvas itself (so it won't pan while over HUD). `EDGE_MARGIN=24`, `EDGE_SPEED=16`.

### 3.3 Touch / mobile

- Enabled via `setTouchEnabled(true)` (touch listeners are only attached then).
- **Single finger:** a tap under `TOUCH_DRAG_SLOP=8` emits `onClick(touch:true)`; a drag pans. A long-press (`TOUCH_LONG_PRESS_MS=500`) emits an alternate command with the same keep-attack/guard/attack-move/move precedence (unless box-select mode is active).
- **Box-select mode** (`boxSelect`): single-finger drag draws a box, emitted on release; tap emits `onClick(touch:true)`.
- **Two fingers:** pinch-zoom once the distance ratio deviates by more than **0.35** from the start, zooming about the pinch midpoint; lifting a finger falls back to single-finger mode.

### 3.4 Keyboard & bindings (`client/src/ui/controls.ts`)

- Bindings persist to `space-arenas:controls`, merged over `DEFAULT_BINDINGS` (only known ids accepted). `changeBinding(id, key)` **swaps** any other action already bound to that key (no duplicates). `restoreDefaultBindings()` clears storage and resets.
- `CONTROL_ROWS` drives the settings table (kinds `key`/`slot`/`mouse`); `slotRows()` returns the 9 control-group slots; `groupModRow()` is the group modifier; `modifierLabel()` renders `Ctrl`/`Shift`/`Alt`/`Meta` or an uppercase letter.
- Defaults (excerpt): `esc:Escape`, `borders:b`, `paths:p`, `bases:n`, `minimap:m`, `boxSelect:x`, `stop:s`, `home:h`, `idleWorker:i`, `idleDozer:d`, `selectCombat:c`, `selectHarvesters:w`, `log:l`, `attackMove:a`, `keepAttack:k`, `guard:g`, `multiPos:j`, `sell:Delete`, `spawnPoint:v`, `flag:r`, `zoomIn:=`, `zoomOut:-`, `panUp/Down/Left/Right:Arrows`, `mod:Control`, `groupMod:Control`, `select/box/ctrl:left`, `move:right`, `slot:1..9: 1..9`.

### 3.5 Selection & control groups (`client/src/game/Game.ts`)

- `InputManager` emits clicks/boxes; `Game` resolves them against world entities (own-team filter via `world.canControl`) to build `selection`.
- **Control groups:** `controlGroups = Map<number, number[]>`. `saveControlGroup(n)` stores the current controllable selection (toast confirms); `recallControlGroup(n)` re-selects the stored ids that are still owned/alive. Groups are pruned as entities die.
- **Modifier:** `modifierHeld(e)` uses `groupMod` (Control/Shift/Alt/Meta, or a tracked `groupModDown` for a plain key). With the modifier held and not typing in a field, `slot:1..9` **saves** group *i*; the group **key label** shown in the UI is `` `${modifierLabel()}+${slot}` `` (`groupKeyLabel`).
- **Escape** (`esc`) cascades: hide chat → close menu → close dev overlay → cancel any pending mode (place, laser, airstrike, emp, spawn point, flag, unload, ping, multi-pos, ability/mine modes, attack/keep-attack/guard) → clear selection.

### 3.6 Command routing (`client/src/systems/input-system.ts`)

`InputSystem.update` applies validated player commands to the sim. Supported `case`s include: `move, attack-move, keep-attack, guard, grenade, smoke, set-detector, set-stealth, set-auto-fire, set-formation, place-mine, remove-mine, repair-unit, transport-load, transport-unload, stop, attack, build, collect, set-spawn-point, set-flag-point, assign-dock, satellite, laser, sw-choose, sw-airstrike, sw-emp, max-power, place, forfeit, sell, queue, dequeue, reorder-queue, ping, dequeue-research, research, rank-up`.

Key helpers (all deterministic):
- `resolveMovePoint(world, x, y, naval)` snaps a target to a passable tile; **naval** selections snap to the **water** mask (`nearestPassablePoint`) so fleets aren't stranded on a beach.
- `formationSlots(world, ids, cx, cy)` lays units on a deterministic grid around a center — cell `2400` if any vehicle/naval, else `1400`, scaled by each unit's `formationSpread`, index-ordered so identical command streams produce identical slots. Used by move/guard/attack orders.
- `placementValid(world, player, buildingType, tx, ty)` validates a `place` order: unknown type, `countLimit`, in-bounds, `placementExplored` fog check, `grid.buildable` per footprint tile (distinguishing "blocked by existing building" vs "cannot build on this terrain"), and for `dock` at least one footprint edge tile must be **open water**.
- `canAcceptBuildOrder` enforces the dozer construct-queue limit (`settings.maxBuildOrders`); `forfeitPlayer` sells/refunds and clears oil-field claims.

---

## 4. Determinism & robustness notes

- **Weather and shake are render-only** and use `Math.random()`/frame time — they never feed the sim.
- **Day/night** is derived purely from `world.tick` + settings, so it is deterministic across clients.
- **Audio** reads only local settings and network-free file probes; it cannot affect sim state.
- **Input** normalizes keyboard identity via `eventKeyChar` (so Shift+1 resolves to `1`, not `!`) and blocks hotkeys while typing in text fields (`isTypingTarget`).
- **Missing assets** degrade to vector shapes / synth audio — never to a crash or a desync.