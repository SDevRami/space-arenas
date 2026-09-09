# Active TODO — Daily Task List

Grouped by daily work units. Each day ships one logical feature bundle. No sim-affecting change lands without a `SimCommand` + hash bump + `PROTOCOL_VERSION` increment.

Legend: **S** = small (half-day), **M** = medium (1 day), **L** = large (2+ days)

---

## Day 1 — UI Icons + Wreck Visuals + Sell Polish ✅ DONE

Renderer/UI only, no sim changes. Ships together.

| # | Feature | Ref | Notes |
|---|---------|-----|-------|
| 1 | **Selection bar icons** — small images for buildings, vehicles, troops in the selection bar | User idea | `hud.ts` `buildSlotRows` / `unitSlotRows`: add `<img>` or CSS background beside each entry. Load icon assets from `client/dist/` (new `ic/` subfolder). |
| 2 | **Wreck visuals** — destroyed units leave wreckage sprites, auto-fade after ~30 s | #27a+b | New ECS component `WreckComp { spawnTick: number }`. `renderer.ts` `drawWrecks()` loop, fade alpha. `SimCommand::wreck-fade` not needed (client-only). |
| 3 | **Sell preview** — hover sell button shows ghost highlight + refund label on selected building | #19a | `Game.ts` `sellPreview` state; renderer draws ghost overlay + price label. |
| 4 | **Sell animation** — building shrinks + smoke puff on sell | #19b | `renderer.ts` `drawSellFx()`, 15-frame shrink tween + particle burst. |

**Touch points:** `hud.ts`, `renderer.ts`, `Game.ts` (sell preview state), new icon assets `client/dist/ic/`

**Custom changes on top** (beyond the 4 base tasks):

| # | Feature | Notes |
|---|---------|-------|
| 5 | **Wreck collection** | Bulldozers gather persistent wreck entities via new `collect` SimCommand (id 19) for credits. Player kills drop wrecks (team −1); AI kills skip them. Collection shown via progress bar. |
| 6 | **Timed sell** | Sell is now a timed process: status frames reverse 5→1 over `sellTicks`; refund paid only if it survives (new `sell-system.ts`). Sell animation ends on empty frame `_0001` (not completed `_0005`). |
| 7 | **Per-player color selection** | 10-color palette in shared; lobby/match rows get a color picker matching team/spawn style; spawn markers + match preview render in chosen color. Renderer uses player color everywhere and preloads only in-use colors. |
| 8 | **High-quality asset image system** | Buildings/units/fields/obstacles load baked PNGs from `client/dist/<object>/<color>/<object>_<frame|dir>.png` with `{frame}/{dir}/{color}` tokens (4-digit frames); vector color-tinted fallback when absent. |
| 9 | **Graphics settings + dev Assets section** | Settings → Graphics: quality preset (low/medium/high), single **Effects** toggle, weather, thumbnail size. Dev settings adds per-asset path overrides + building fill/offset, field offset, unit scale. |
| 10 | **Asset folder restructure** | `client/dist` is the single asset home (root `assets/` removed); color subfolders `1..10` scaffolded for every object folder; build keeps authored images (`emptyOutDir: false`). |
| 11 | **Protocol** | PROTOCOL_VERSION bumped to 2; `hash.ts` now includes wrecks (collectable state). |

---

## Day 2 — Audio + Haptic + SFX Ready ✅ DONE

All audio/haptic, no sim changes. Audio settings (master/effects/ambient volume, mute, ambient toggle, haptics toggle) exposed in the Settings → Audio panel.

| # | Feature | Ref | Notes |
|---|---------|-----|-------|
| 1 | **Unit voice bleeps** — short synth blip on select | #30a | `hooks.ts` new `playSelectBleep(unit)` called from `Game.onSelect`. Pitch varies by unit class. |
| 2 | **Per-weapon SFX** — distinct synth sounds for rifle, rocket, cannon, artillery, air-cannon | N7a | `hooks.ts` new `playWeaponSfx(weaponType)`. Called from `combat-system.ts` `fire()`. |
| 3 | **Ambient audio** — lobby menu synth drone, in-game low hum | #29a | `hooks.ts` new ambient layer (gain node, loop buffer). Lobby: `startLobbyAmbient()`. In-game: `startGameAmbient(mapVariant)`. |
| 4 | **Positional SFX** — volume scales by distance from camera center | #29b | `hooks.ts` `panNode` gain calculation in `playSfx()` based on world→screen position. |
| 5 | **Mobile haptics** — vibrate on select/action/damage | #38a | `input.ts` / `Game.ts`: `navigator.vibrate(ms)` calls at key moments (guarded by `'vibrate' in navigator`). |
| 6 | **Real SFX asset hooks** — all `playSfx` calls accept a `url?: string` param for future `.wav`/`.mp3` override; synth is fallback | #29 prep | `hooks.ts` `playSfx(type, opts)` loads `AudioBuffer` from URL if provided, falls back to synth. `AudioContext.decodeAudioData` for asset load. |

**Touch points:** `hooks.ts`, `combat-system.ts`, `Game.ts`, `input.ts`

**Custom changes on top** (beyond the 6 base tasks):

| # | Feature | Notes |
|---|---------|-------|
| 7 | **Settings → Audio panel** | `audio-settings.ts` exposes master / effects / ambient volume sliders plus Mute all, Ambient layer, and Mobile vibration toggles. Ambient layer defaults **off**, still toggleable. |
| 8 | **Dev settings Audio section** | `settings.ts` `SOUND_IDS` route every sound through `playSfx`; a per-sound override in dev settings. `.wav/.mp3/.ogg/.m4a` = single file, else a folder; empty = synth fallback. Grouped UI / Weapons / Events / Ambient. |
| 9 | **Sound variant folders** | Override folder `sound/<id>/` auto-probed for `v1.wav, v2.wav, …` (HEAD probe, cached). Ordinary sounds play one **shuffled** variant per play (no immediate repeats). |
| 10 | **Ambient variant loops** | Distinct `ambient-lobby` and `ambient-game` folders each play their files **one-after-another in a shuffled, infinite loop**; synth drone fallback when empty. |
| 11 | **Toggle fix** | Mute all / Ambient layer / Mobile vibration previously stuck after one toggle; click handler now reads live state via `getAudio()` instead of a stale render-time snapshot. |

---

## Day 3 — Controls QoL: Control Groups + Selection ✅ DONE

Client input/selection only, no sim changes. Point 3 (attack-move paint) is deliberately excluded.

| # | Feature | Ref | Notes |
|---|---------|-----|-------|
| 1 | **Control groups** — Ctrl+1–9 saves selection, 1–9 recalls it | #21a | `Game.ts` new `Map<number, number[]> controlGroups`. Keydown handler: `Ctrl+digit` saves the current selection (owned units/buildings only); `digit` recalls the group, filtering out any units/buildings no longer alive. Silent skip when empty. |
| 2 | **Selection hotkeys** — select-all combat units, select-all harvesters, double-tap idle worker/dozer | #25a+b | Added `selectCombat` (default `C`) and `selectHarvesters` (default `W`) bindings wired to `Game.selectAllCombat()` / `selectAllHarvesters()` (`Game.ts`). Double-tap idle worker/dozer cycling already existed via `idleWorkers()` + `centerOnIdleWorker()` using `idleCycleIndex` (newest-first camera pan + selection swap). |
| 3 | ~~Attack-move paint~~ | — | **Skipped** per user instruction. |

**Touch points:** `Game.ts`, `renderer.ts`, `controls.ts`, `input.ts`

**Custom changes on top** (beyond the base tasks):

| # | Feature | Notes |
|---|---------|-------|
| 4 | **HUD selection bar hotkey rework** | Command buttons (stop / multi-pos / destroy / attack / guard / spawn / flag / deselect / max power) no longer hold numeric `1/2/3` bindings — the old `slot:N` numbered mapping is gone. Build / produce / research buttons now bind to **`Ctrl + <first letter>`** of the button name (e.g. `Ctrl+B` = Barracks) via `Hud.hudShortcutByLetter`, and show a `Ctrl+X` hint badge. Bound in `hud.ts` (`hotkeySlots` + `firstLetter()`). |
| 5 | **Control-group keys repurposed** | The `slot:1..9` remappable bindings now mean control-group recall; `Ctrl+<key>` saves. `controls.ts` drops the old `slot:10`; `controls-settings.ts` `slotRows()` now returns 1–9. |
| 6 | **Select-all hotkeys added** | New remappable bindings `selectCombat` (`C`) and `selectHarvesters` (`W`) in `controls.ts`, with `settings.controls.entries.*` labels. `Game.selectAllCombat()` (units with a weapon) and `selectAllHarvesters()` select the whole owned fleet and toast a count (new `game.*` i18n keys). The `slots` settings label now reads "Control groups". |
| 7 | **Shortcut-modifier safety (regression fix)** | All `groupMod+<key>` presses in-game are intercepted **before** single-key handlers and `preventDefault()`ed, so the browser can't hijack them and the modifier `keyup` can't be swallowed (browser-reserved combos like Ctrl+T/W can never be blocked at page level — hence the remappable `groupMod`, see #10). `groupMod`+letter dispatches the build-menu shortcut (`Hud.hudShortcutByLetter`); `groupMod`+digit saves a control group. `input.ts` also resets ctrl/shift/alt/attack-move flags on window blur / tab hide, so a stuck modifier can no longer break deselect-on-empty-click or edge-pan (which requires Ctrl). `recallControlGroup` no longer clears the selection for a never-saved group; saved toast uses `game.groupSaved`. |
| 8 | **In-game Keys panel button** | `#keys-toggle` in the HUD header (next to Log) opens a **control-groups panel**: one row per group the player saved this match, showing the key (e.g. `Ctrl+1`) and a live summary of its units (e.g. `3 Riflemen, 2 Assault Walker`), each with a **Remove** button that empties the group (`Game.clearControlGroup`). The panel refreshes every frame while open (dead units are dropped, empty groups auto-removed). It does **not** open the binding-settings overlay — the `keys-toggle` wiring is now Game-owned, `controls-settings.ts` wiring reverted. New `groups.*` + `game.groupCleared` i18n keys. |
| 9 | **Conflicting letter hotkeys fall back** | In `hud.ts`, `firstLetter()` replaced with `Hud.assignUniqueHotkey(label)` which tracks letters used across the whole current menu and picks the first unused letter (1st → 2nd → 3rd …) for every build / produce / research button — e.g. Tech Center and Turret no longer both get `Ctrl+T`. Non-Latin (Arabic) labels keep the first-character fallback. |
| 10 | **Remappable group/shortcut modifier** | New binding `groupMod` (default `Control`) — shown as the **first field of the "Control groups (number keys)" settings section** ("Group modifier (X + number)"). The combo becomes `groupMod` + number (e.g. **Shift+1** after rebinding), which sidesteps browser-reserved combos that pages cannot override (Ctrl+T/W/N etc.). The same modifier drives the build-menu letter shortcuts, the `Ctrl+X` hint badges (`Hud.modifierLabel()`), the Keys panel key labels, and the keydown interception (`Game.modifierHeld(e)` — event flags for Control/Shift/Alt/Meta, held-key tracking `groupModDown` for letter modifiers, reset on window blur). Edge-pan / Ctrl+click keep their own `mod` (Control) binding untouched. |

---

## Day 4 — Vision & Awareness: Fog Modes + Day/Night + Base Alert ✅ DONE

Vision-system + renderer changes.

| # | Feature | Ref | Notes |
|---|---------|-----|-------|
| 1 | **Fog mode toggle** — Classic (no fade), Hard (no memory) | #11a+c | `MatchSettings.fogMode` enum (`memory | classic | hard`). `vision-system.ts` branches: Classic skips the 2→1 decay; Hard decays 2→0 instantly. **Radar-limited was deferred — the codebase has no unit radar flag yet.** Protocol: `PROTOCOL_VERSION` bumped 2→3; host `sanitizeSettings` whitelists the enum. Lobby dropdowns `#start-fog` (offline) + `#match-fog` (network, host-only), synced via `renderMatchOptions`. |
| 2 | **Day/night tint** — 5 min 10 s cycle, ~1-min dusk/dawn transitions | #31a | `Game.ts` `dayPhase` (day → dusk → night → dawn) computed per tick from `MatchSettings.dayNightCycleTicks` (default `DAY_NIGHT_CYCLE_TICKS`, 310 s @ 25 Hz) and `MatchSettings.dayNightTransitionTicks` (default `DAY_NIGHT_TRANSITION_TICKS`, 60 s). `MatchSettings.dayNight` boolean (offline + network, host-only). All three are exposed in the dev-settings panel (day/night section + fog mode select) and clamped by the host `SANITIZE` map. Renderer `setDayNight(phase)` draws a screen-space night tint (`nightOverlay`, max 25 % alpha, blue-dark `0x1a2a44`) above `worldLayer`, below selection box; cached per-tick quantization. `graphics.ts` `dayNightTint(phase)`. Fog-shrink not included (kept cosmetic-only, no `isVisibleTo` change). |
| 3 | **Base-under-attack alert** — audio ping + minimap flash when building takes damage | N5a+b | `combat-system.ts` `applyDamage()`: building damaged by a non-allied attacker (done, not selling) emits `base-under-attack {building, team, x, y}`. `Game.ts` handles it throttled to once per 4 s per team: `hooks.ts` `baseAlert(x, y)` → `playSfx('base-alert')` (new synth + Day-2 `overrides` file path honored, positional), `minimap.ts` `flashBuilding(tick, team, x, y)` (30-tick red pulse), and the `game.events.baseAttacked` log line. |
| 4 | **Turret range ring** — show attack range while placing + on selection | User idea | Client-only (`renderer.ts`). While ghost-placing a building with a weapon (turret): draw the ghost's `turret-gun` range ring (8 tiles, iso-ellipse centered on the transform point combat measures from) **and** faint range rings on all owned turrets, so coverage/overlap is visible before confirming. Additionally, selecting a weapon building (own team) shows its ring (alpha 0.45), with faint rings on every owned turret — same result whether rings come from a placement or a selection. `buildingDefRange()` reads `getWeapon(def.weapon).range`; invalid placement tints its ring red. |

**Touch points:** `vision-system.ts`, `world.ts`, `Game.ts`, `renderer.ts` (ghost range ring + night tint), `hooks.ts`, `minimap.ts`, `constants.ts`, `index.html` (lobby fog dropdown + day/night checkbox), `main.ts`, `host/src/rooms.ts`, `events.ts`, `combat-system.ts`, `graphics.ts`

**Custom changes on top:**

- Fog modes include a third option `classic` ("Classic+ — no fade") where the 2→1 remember-step is skipped entirely (seen tiles stay bright forever), distinct from the default `memory`.
- New `base-under-attack` event + `base-alert` synth sound id (so players can drop their own `base-alert` audio override files, consistent with Day 2's `SOUND_IDS`/override wiring and volume sliders).
- Day/night cycle and transition durations are real `MatchSettings` fields (`dayNightCycleTicks` / `dayNightTransitionTicks`, defaults 310 s / 60 s) rather than constants, so the dev panel (new "Day/night cycle (synced)" section) and network match options can tune them per match.
- Dev panel gains a select row (`makeSelectInput`) for the fog mode (with the `dev-overridden` highlight) — previously only numeric inputs existed.
- Lobby day/night checkboxes styled as a toggle switch (`.check-label` + `appearance:none` thumb); the Keys popup's Remove button got base `ghost`-danger colors (it had sizing only); the Keys header button highlights `.menu-btn.active` while the panel is open.
- Day/night uses a full `day → dusk → night → dawn` profile (dusk + dawn ≈ 2 min combined) rather than a flat sinusoid.
- Lobby labels translated (ar + en).

---

## Day 5 — Damage Feedback + Settings + Super Weapon Shake ✅ DONE

Renderer + game UI.

| # | Feature | Ref | Notes |
|---|---------|-----|-------|
| 1 | **Hit flash** — additive white blaze over a damaged entity | #28a | `world.ts` `DamageFlashComp { hitTick }` + `world.flashes` SparseSet; stamped in `combat-system.applyDamage`; `renderer.ts` draws a shared soft-white radial texture additively (`blendMode 'add'`) over the sprite for 4 ticks, popping slightly as it fades (distinct from the small orange ring bullet-impact sparks). Sized from the entity's **ground footprint** (`effectWidthPx`), never from `spr.scale` — sprite-scale sizing broke because building image textures inflate the logical width (effect too small) vs vector shapes (effect too big). First pass (white-tint of the entity texture) was invisible — `tint 0xffffff` is a no-op multiply — and was replaced with the additive blaze. |
| 2 | **Burning fire** — buildings & vehicles below 25% HP show animated fire overlay | #28b | `renderer.ts`: `burnTex(tick)` returns fx-frame (`fxFrameTexture('burn', 1 + ((tick>>2)&1))`, loaded via `preloadFxFrames('burn')` from dev `fx:burn` asset path) or a 2-frame procedural canvas fallback (`makeFireTex` radial-gradient ellipse, taller flicker variant). `flameSprites` child sprite at `y -= 14`, alpha flicker `0.85 + sin((tick+id)*0.9)*0.15`, hidden when HP recovers above 25%. Both fire and flash are sized from the entity's ground footprint (`effectWidthPx`: `(footprintW+footprintH)*ISO_HALF_W` for buildings, `UNIT_SPRITE_WIDTH*unitScale` for units) divided by the effect texture's own width, so image-textured and vector buildings burn at the same size. Infantry never burn. Also fixed the pre-existing wreck rule: destroyed infantry/aircraft no longer leave a collectable wreck — only buildings and vehicle-class units do (`combat-system.applyDamage` gates `spawnWreck` on `srcKind === 'building' || class === 'vehicle'`). |
| 5 | **Effect size ratio** — flash & fire scale to 0.5× the object's footprint | User idea | `ui/graphics.ts` `fxScale` (+`DEFAULT_FX_SCALE = 0.5`, clamped 0.05–3, persisted): both the hit flash and burning fire now render at `effectWidthPx × fxScale` (after user feedback the first footprint pass was still too big). Exposed as a live dev input under **Assets → FX → "Effect size"** (`main.ts`, `i18n dev.fields.fxScale`); changes apply immediately in-match via `getGraphics().fxScale` |
| 3 | ~~In-match settings~~ — reverted after testing | #35a+b | Built (Escape menu `#menu-settings` + sliders + HUD-size + two-click quit) then **fully reverted** on user request: original Escape menu (resume + quit) restored, `ui/in-menu-settings.ts` removed, `renderSliderRow`/`renderHudSizeRow` exports and `menu.settings`/`menu.controls`/`menu.confirmQuit` i18n keys removed. Fog mode was never in-match (lobby-only). |
| 4 | **Super weapon camera shake** — hard at beam start, fades to 0 exactly when the laser strike ends | User idea | `renderer.ts`: `updateLaserShake(world)` scans live `world.lasers` (tick ∈ [startTick, untilTick)), takes the latest-ending strike and sets `shakeStart/shakeUntil/shakeAmp`; `shakeOffset(tick)` applies a decaying sine to `worldLayer.position` each frame (cosmetic only, outside sim hash). Shake runs for the full `laserDurationTicks` + delay window instead of a fixed 24 ticks. |

**Touch points:** `renderer.ts` (additive hit flash, building/vehicle flames, laser-driven shake), `Game.ts` (damage flash context), `combat-system.ts` (damage flash stamp + wreck gating), `world.ts` (DamageFlashComp), `building-sprites.ts` (fx-frame preload + `fxFrameTexture`), `main.ts` (dev `fx:burn` input row + `fxScale` effect-size input), `ui/graphics.ts` (`fx:burn` default path, `fxScale` + `DEFAULT_FX_SCALE`), `i18n` en/ar (dev `assets.fx`/`assets.burn`/`fields.assetBurn`/`fields.assetFx`/`fields.fxScale` rows)

---

## Day 6 — Communication & Debug: Pings + Minimap Rail + Dev Popup ✅ DONE

Net + renderer + debug tools.

| # | Feature | Ref | Notes |
|---|---------|-----|-------|
| 1 | **Minimap pings** — 3 ping button types (alert/assist/on-my-way) toggle a click-to-ping mode; ping lands on main map + minimap for 5 s | #23a+b (reworked) | Single `SimCommand::ping { x, y, pingType }` (id 20, 1 extra byte) — not three command variants. `world.ts` `PingComp { team, x, y, type, started }` + `world.pings` plain array (`PING_TICKS = 125`), pruned per-`InputSystem.update`, **excluded from sim hash** (cosmetic, mirrors `flashes`). `renderer.ts` draws expanding ring + crosshair + inner fill (color 0xff5c5c alert / 0xffd45e assist / 0x7cf27c on-my-way); `minimap.ts` draws alliance-filtered fading ring + dot. The toggle button arms the mode and a plain click places the ping on the **main canvas and the minimap alike** (Alt+click also accepted — the input layer passes native modifier state); out-of-bounds pings reject with `command-rejected 'ping out of bounds'`. |
| 2 | **Minimap rail** — vertical button rail beside the minimap: 3 ping buttons + Map (M) + Home (H) | #23/36 rework | `Game.ts` `buildMinimapRail()`: buttons carry `data-ping`, sync `.active` states via `syncPingButtons`; the whole block (`mm-wrap` = rail + `mm-inner` canvas/viewport stack) mounts inside the HUD `#selection-bar` (desktop + mobile) — old top-right `#mm-btns`/`#tools-bar` minimap placement removed, mobile `top:56px` positioning dropped. `displayScale` toggles between 1 and the dev-settings `minimapScale` (default 1.6, clamped 1.2–4, `ui/graphics.ts` + lobby dev panel) via `toggleMinimapScale`. |
| 3 | **Dev render toggles B/P/F/N** — hitbox borders, move paths, full reveal, base markers | #36a | Moved into `toggleDevOption('borders'|'paths'|'reveal'|'bases')`, called from the dev-popup **Render** section (`buildDevRenderButtons()`), keyboard shortcuts (b/p/f/n) and mobile tool buttons — toasts + active-state sync in one place. |
| 4 | **Dev popup** — header "Dev" button opens a popup with live perf (FPS, tick, tick rate, entity count, sync status), header-part on/off toggles (FPS/tick/sync, persisted to localStorage), Render toggles (B/P/F/N), and the dev shortcut list | #36a+b rework | `Game.ts`: `#dev-overlay` (close button, Escape, backdrop click); `updateDevOverlay()` re-renders rows while visible (called from `onFrame`); `buildHudPartToggles()` wires `#fps-info`/`#tick-info`/`#sync-info` visibility (buttons stay pinned right via `#log-toggle { margin-left: auto }`); shortcuts read real bindings via `getControls()`. Backtick perf overlay + in-match settings were reworked/descoped. |
| ~ | ~~Spectator follow cam / fight cam~~ — descoped | #13a+b | Not in this milestone per user spec — Day 17 spectator fallback covers the net side. |

**Touch points:** `protocol.ts` (ping command + type ids + binary encode/decode), `world.ts` (`PingComp`/`addPing`, cosmetic-only), `events.ts` (`ping-point`), `input-system.ts` (ping case + prune), `Game.ts` (rail, canvas+minimap pings, dev popup render toggles, HUD-part toggles), `renderer.ts` + `minimap.ts` (ping drawing), `ui/graphics.ts` + `main.ts` (`minimapScale` dev setting), `hud.ts` (`fps` getter), `index.html` + `styles.css` (`#mm-wrap`/`#mm-rail`/`#dev-overlay`, pinned header buttons), `main.ts` precedent, `i18n` en/ar

---

## Day 7 — Build Queue + Waypoint + Victory Screen ✅ DONE

Economy + renderer.

| # | Feature | Ref | Notes |
|---|---------|-----|-------|
| 1 | **Build queue reorder** — drag a card OR ◀/▶ arrows (both) | #17a | Final UX, 2026-09-06: each `.queue-item` wraps `◀` + leaf card + `▶` (left disabled at index 0, right at last). The card is also drag+drop enabled (`.dragging`/`.drag-over` visuals, `suppressClick` so the release click doesn't dequeue, `touch-action: none`, pointer capture + cancel guard) — the drag reorders the wrapper, so arrows and drag share one slot model. Every commit (drop or arrow click) issues `SimCommand::reorder-queue { buildingId, from, to }` (id 21, 2 extra bytes). `input-system.ts` applies the reorder (bounds-checked `splice` move) **and restarts production**: every order's `remainingTicks` is reset to its unit's `buildTimeTicks` — the (new) front order restarts from the beginning. Queues are already hashed → deterministic, no `hash.ts` change. `PROTOCOL_VERSION` bumped 3→4. **Bug fixed:** reorders among identical unit types (e.g. several bulldozers) didn't rebuild the queue UI. Root cause: `ProductionOrder { unitType, remainingTicks }` has no per-order identity, and `queueSignature` compressed the queue to its unit-type sequence — for a CC that only produces bulldozers the sequence is identical before/after any reorder, so the HUD never rebuilt and stale closures froze the front progress bar + arrow disabled states until that order was front again. An earlier `index:unitType` signature still missed it (indexes are position, not identity). **Fix: `ProductionOrder` now carries a stable, deterministic `id` allocated via a new no-side-effect `World.allocId()` (world.ts) — set by both queue sites (`input-system.ts` queue cmd + `work-system.ts` auto-harvester push). `queueSignature` keys on `o.id` sequence, so ANY reorder among identical units rebuilds the HUD immediately. Hash auto-covers the new field (arrays/objects are serialized by key), so lockstep is preserved with no `hash.ts` change.** `tests/queue-reorder.test.ts` now also asserts order ids are unique and that identity (set of ids) survives a reorder. |
| 2 | ~~**Hotkey queueing** — Shift+click queues a unit without deselecting current~~ — postponed | #17b | Units have only a single `MoveComp` (no order queue); would need a new per-unit order stack. Skipped by user decision 2026-09-06 — revisit later. The existing `multiPosMode` (J) already covers ordered waypoint moves. |
| 3 | **Waypoint dotted line** — multi-route draws a green dotted polyline on the map | #24a | `renderer.ts` `drawFx`: manual dashed strokes (9 px dash / 7 px gap) through unconsumed waypoints (`i >= routeIdx`, iso-projected), current point emphasized (alpha 0.95 / r 9). Cleared per-frame with `fxGraphics`, so it vanishes when the route completes. |
| 4 | **Order number badges** — numbered circles on waypoint positions | #24b | Same `drawFx` block: pooled `Text` labels (`routeLabels`, 1-based order `j + routeIdx + 1`) anchored 18 px above each waypoint, hidden beyond the live set via `hideRouteLabels`. |
| 5 | **Victory screen cinematics** — text-only spectator sequence, then stats popup | #32a | On `game-over` all players effectively spectate (world freezes, camera stays interactive) showing only center victory/defeat text (`menu.victory`/`menu.defeat`/`menu.draw`/`menu.over`, defeat tinted red) for a configurable duration, then the existing `StatsBoard` results popup appears. **No dimming background** — `#cinematic-overlay` is fully transparent (`pointer-events: none`), so the battleground stays visible during the wait. Duration = client-only dev setting `victoryCinematicSec` (0–30 s, default 6 — `ui/graphics.ts` + lobby dev panel `dev.sections.match`); 0 skips straight to results. `Game.ts` `beginCinematic()` stages it in the `game-over` handler + `onNetGameOver`; `onFrame` flips to `showResults()` when the timer elapses. Renderer `drawVictoryGlow()` removed. |

**Touch points:** `hud.ts` (arrow buttons + drag+drop on `.queue-item` wrappers, `onReorderClick`, `queueSignature` now keys per-order `id`), `Game.ts` (`reorderQueue`, cinematic state machine + `beginCinematic`/`onNetGameOver`), `renderer.ts` (dotted waypoint line + number badges), `input-system.ts` (reorder case + front-slot production reset), `protocol.ts` (reorder command id 21), `events.ts` (`order-reordered`), `styles.css` (`#cinematic-overlay`/`cinematic-in` + `results-rise` + `.queue-item`/`.q-arrow`/`.queue-card.dragging/.drag-over`), `ui/graphics.ts` + `main.ts` (`victoryCinematicSec` dev setting), `index.html` (`#cinematic-overlay`), `i18n` en/ar (queueMoveLeft/queueMoveRight, dev.sections.match, dev.fields.victoryCinematic, menu.victory/defeat/draw/over), `shared/constants.ts` (PROTOCOL_VERSION 3→4)

---

## Day 8 — Veterancy System (M) ✅ DONE

New ECS component + combat-system + renderer.

| # | Feature | Ref | Notes |
|---|---------|-----|-------|
| 1 | **5 veteran ranks** — cumulative kills → rank-up → stat bonuses | #2a | `UnitComp` gains `veteranRank: 0|1|2|3|4|5` (`VeteranRank`), `killCount: number`. **Status (done):** `factories.ts` initializes both to 0; `applyDamage` (combat-system.ts) credits the kill only when a **unit kills an enemy unit** (friendly/enemy-building kills don't count) and promotes past the thresholds `veteranRank1Kills`…`veteranRank5Kills` (defaults 3/6/9/12/15). Bonus introduced via `veteranRankForKills` + `unitVeteranBonus(world, rank)` in `world.ts` (new `VeteranBonus` interface): damage = 1+(dmg/rank)×rank, range = 1+(rng/rank)×rank, armor = max(`VETERAN_ARMOR_FLOOR`=0.5, 1−(arm/rank)×rank) — the floor stops rank-5 units from becoming invulnerable (rank 5 = ×2.25 / ×1.5 / ×0.5; ranks 3+ clamp to ×0.5 armor). **Applied in sim:** damage ×bonus at the two `fire`/`fireGround` call sites + plane-system goes through `fire()` so it inherits damage+armor; range ×bonus in `CombatSystem.update` (unit attackers only, buildings untouched); armor ×bonus inside `applyDamage` (reduces incoming damage for veteran targets). New `unit-ranked-up` sim event → ascending synth tone + `game.events.rankedUp` HUD log for the local team only. Hash picks up the two new fields automatically (`world.units` comps are serialized by key) — no `hash.ts` change. |
| 2 | **Rank pips** — gold badges attached to the health bar | #2a | **User revision 2 (2026-09-08): gold horizontal line pips instead of stars — ranks 1–4 show that many lines, rank 5 becomes a single star.** Left → right: `rank pips | hp bar | alliance circle` (the green/red ownership dot already sits at `isoX + BAR_W/2 + 8`). `renderer.ts` `syncVeterancy()` draws a per-unit `Graphics` (`veteranPips` map, `veteranPipLayer` between `barLayer` and `powerLayer`), redrawn only when the rank changes (`veteranPipRank` cache): ranks 1–4 = `rank` gold bars (3×12 px, 3 px gap — shapes `|`, `||`, `|||`, `||||`), rank 5 = one gold 5-point star (`VETERAN_PIP_COLOR 0xffcf33`). Row right-aligned to the bar's left edge (`isoX − BAR_W/2 − 9 − width/2`, `barY` = same row as the hp bar). Always drawn (any quality). |
| 3 | **Dev settings** — every veterancy variable editable | #2a | **Done.** All eight sim vars live in `MatchSettings` (synced, so both clients + bots agree): `veteranRank1Kills`…`veteranRank5Kills`, `veteranDamagePerRank` (×/rank), `veteranRangePerRank` (×/rank), `veteranArmorPerRank` (0–1 reduction/rank), backed by `VETERAN_*` defaults in `shared/constants.ts` (+ export `VETERAN_MAX_RANK`, `VETERAN_ARMOR_FLOOR`). New `dev.sections.veterancy` panel section (main.ts `DEV_SCALAR_SECTIONS`) + `dev.units.kills`; i18n en/ar labels + descs. |

**Touch points:** `world.ts` (UnitComp + `VeteranBonus` helpers), `combat-system.ts` (kill credit + damage/range/armor), `factories.ts` (init), `renderer.ts` (`syncVeterancy`), `Game.ts` + `audio/hooks.ts` + `events.ts` (`unit-ranked-up`), `shared/constants.ts` (8 new MatchSettings fields), `main.ts` + i18n (dev panel), `tests/veterancy.test.ts`

---

## Day 9 — Unit Abilities: Grenade/Smoke + Stealth ✅ DONE

Tech-center research, two new SimCommands + ECS components. Both gated by research.

| # | Feature | Ref | Notes |
|---|---------|-----|-------|
| 1 | **Grenade ability** — toggle throw with range ring, fuse → red blast | #1a partial | **Done.** HUD toggle button (commands section when units selected) arms a `pendingAbility` in `Game.ts`; right-click inside the throw-ring issues the new `grenade` SimCommand (CMD id 22). `input-system.ts` validates ownership, per-unit `abilityCooldown` (0 = ready, else absolute tick; `grenadeCooldownTicks` default 2.5 s), and `grenadeRange` (default 6 cells) — reasons `ability on cooldown` / `target out of throw range`. Thrown grenades are ECS marker entities with `GrenadeComp` { team, fromX/fromY, x, y, startTick, explodeAt, radius, damage }; new `AbilitiesSystem` (runs right after Combat in the registry) detonates them at `explodeAt` via `explodeAt()` (splash gather + `applyDamage` with teamOverride) and emits `grenade-exploded`. Renderer draws the throw arc + pulsing red blast ring; settings fields `grenadeRange/BlastRadius/Damage/FuseTicks/CooldownTicks`. |
| 2 | **Smoke ability** — cloud makes shots crossing it miss by RNG | #1a partial | **Done.** Same toggle + `smoke` SimCommand (id 23). `input-system.ts` places a `SmokeComp` marker (team, x, y, radius=2 cells, `untilTick`) for `smokeDurationTicks` (12 s). `combat-system.ts` `fire`/`fireGround` check `shotBlockedBySmoke` (shot segment vs cloud circle) then roll `world.rng.next()` (deterministic, one draw) against `smokeMissChance` (0.6) → `shot-missed` event, zero damage. Cloud fades near expiry in the renderer. Settings: `smokeRange/Radius/DurationTicks/MissChance/CooldownTicks`. |
| 3 | **Stealth upgrade** — invisibility + per-building detector | #5a | **Done.** New research `stealth-tech` (tech center, 400/20 s) sets `TeamState.stealthTech`; spawned units start `stealth: true` (retroactively applied to existing units on research complete). Stealthed units are invisible (`isVisibleTo` gate) until they fire → `revealedUntil = tick + stealthRevealTicks` (3 s), or until covered by a detector. `detector-upgrade` research (300/15 s) unlocks `set-detector` SimCommand (id 24): buys a detector for `detectorCost` (200) on any finished owned building (`BuildingComp.detector`), which reveals stealth in `detectorRange` (12 cells) via `detectorNear`. HUD detector buy-button section + `detector-bought` event. Settings: `detectorCost/Range`, `stealthRevealTicks`. |
| 4 | **Dev settings + sync** | — | `DEV_SCALAR_SECTIONS` gets `abilities` + `stealth` sections (13 synced fields), host `SANITIZE` covers all new keys, hash covers team flags + grenades/smokes comps + unit/building fields, `PROTOCOL_VERSION` at 5, i18n en/ar for hud + dev + toasts. `tests/abilities.test.ts` (11 tests: explode, cooldown, range, smoke miss / no-miss, cloud expiry, stealth reveal, detector buy + research gate, determinism). |

**Touch points:** `protocol.ts` (3 new Commands + ids 22–24), `const-ants.ts`/`upgrades.ts`, `world.ts` (stealth/flags/sets + `isVisibleTo` gate + `detectorNear`), `combat-system.ts` (smoke miss + reveal-on-fire + `explodeAt`), new `abilities-system.ts`, `input-system.ts` (3 handlers + research guards), `factories.ts`, `placing-system.ts` (research finalizers), `hash.ts`, `renderer.ts` (ability ring + arc/blast/smoke FX), `Game.ts` + `hud.ts` (toggles + detector section), `main.ts` + i18n (dev sections), `host/rooms.ts` (SANITIZE), `tests/abilities.test.ts`

---

## Day 9.1 — Follow-ups: grenade AoE, smoke radius, per-unit stealth ✅ DONE

Three follow-up fixes on top of Day 9.

| # | Feature | Notes |
|---|---------|-------|
| 1 | **Grenade AoE verification** | The grenade already damages every enemy within `grenadeBlastRadius` of the landing point (`explodeAt` → `splashDamage` → `applyDamage`). Regression test now pins the exact repro: an enemy inside the blast takes exactly `grenadeDamage` (45) HP. Any in-guilt "no damage" reports stem from the target walking out of the 1.5-cell blast during the 1 s fuse (units move several cells/sec), from throwing out of `grenadeRange`, or from air targets (splash skips `class: 'air'`). |
| 2 | **Smoke radius = 1.5 × grenade blast** | `SMOKE_RADIUS` is now derived (`GRENADE_BLAST_RADIUS * 1.5` = 2.25 cells, up from 2). `MatchSettings.smokeRadius` default updates automatically; test asserts the ratio. |
| 3 | **Per-unit stealth buy** | New `set-stealth` SimCommand (id 25). `stealth-tech` research now only *unlocks* the buy (no retroactive cloaking; `factories.ts` spawns units with `stealth: false`). HUD shows a **Stealth $** button in the command bar for selected owned infantry/vehicle units (`stealthCost` = 200, default, `MatchSettings.stealthCost`); owner must have researched `stealth-tech` and enough credits. Rejects: `cannot stealth this unit` (air), `stealth upgrade not researched`, `unit already stealthed`, `insufficient credits`. Stealthed units render a **gold hat icon above their hp bar** (hidden while revealed). New `stealth-bought` event + hashed via the generic unit-component hash. |

**Touch points:** `shared/constants.ts` (stealthCost field/default, smoke radius derived), `shared/protocol.ts` (`set-stealth` id 25), `host/rooms.ts` + `client/main.ts` (SANITIZE/dev section), `core/events.ts` (`stealth-bought`), `entities/factories.ts` (spawn `stealth: false`), `placing-system.ts` (research = unlock), `input-system.ts` (`set-stealth` handler), `Game.ts` + `hud.ts` (Stealth button), `renderer.ts` (hat layer), i18n en/ar, `tests/abilities.test.ts` (purchase gates + AoE + smoke ratio), `tests/protocol.test.ts` (id 25). `PROTOCOL_VERSION` → 6.

---

---

## Day 10 — Engineer Unit + Mines (M)

New unit type + placement system. Mines have friendly-fire toggle.

| # | Feature | Ref | Notes |
|---|---------|-----|-------|
| 1 | **Engineer unit** — war factory unit, can repair vehicles by right-clicking | #3a | New unit type in `units.ts`: `engineer { hp: 120, speed: 2.2, buildTime: 40, cost: 100, armor: 2, power: 0, range: 0, damage: 0, production: 'war-factory', tech: null }`. `work-system.ts` extends: `UnitRepairJob` for vehicle entities. Right-click on damaged unit → engineer moves to it, heals 2 HP/tick. |
| 2 | **Mines** — engineer can place mine at position, proximity trigger, 4-cell range | #6 | New SimCommand `place-mine { unitId, x, y, team }`. New ECS `MineComp { range: 4, damage: 60, team: number }`. `mine-system.ts` new: check enemy units within range → detonate (deal damage, destroy self). `renderer.ts`: small circular sprite at (x, y). |
| 3 | **Friendly-fire toggle** — lobby option controls whether mines damage own team | #6 | `MatchSettings.friendlyMineDamage: boolean`. `mine-system.ts` checks team match + setting before dealing damage. Lobby checkbox in match options. |

**Touch points:** `units.ts`, `protocol.ts`, `work-system.ts`, new `mine-system.ts`, `world.ts`, `renderer.ts`, `constants.ts`, `index.html` (lobby checkbox)

---

## Day 11 — APC Transport (M)

New unit + transport ECS + load/unload commands.

| # | Feature | Ref | Notes |
|---|---------|-----|-------|
| 1 | **APC vehicle** — war factory unit, carries 10 infantry | #7a | New unit type in `units.ts`: `apc { hp: 250, speed: 3.0, buildTime: 60, cost: 200, armor: 4, power: 0, range: 0, damage: 0, production: 'war-factory', tech: null, transportCapacity: 10 }`. |
| 2 | **Load units** — select troops, click APC → they enter it | #7a | New SimCommand `transport-load { transportId, unitIds: number[] }`. `transport-system.ts` new: validates capacity, moves units into `TransportComp.passengers[]`, units invisible while inside. |
| 3 | **Unload button** — APC selection bar has "Unload Here" button → click position to drop all | #7a | New SimCommand `transport-unload { transportId, x, y }`. `transport-system.ts`: spawns each passenger at offset positions around (x, y). HUD button in `unitSlotRows` when APC is selected. |

**Touch points:** `units.ts`, `protocol.ts`, new `transport-system.ts`, `world.ts`, `hud.ts` (unload button), `Game.ts`

---

## Day 12 — Defense Buildings + Weapon Research (S–M)

Building types + combat + research. Counterplay triangle: dome counters laser, EMP counters power.

| # | Feature | Ref | Notes |
|---|---------|-----|-------|
| 1 | **CC Defense Dome** — absorbs enemy fire, needs power | #8a | New upgrade in `upgrades.ts`: `defense-dome` (tech center). When researched, CC gains `shieldHp: 200`, regenerates 1 HP/tick while powered. `combat-system.ts`: damage to CC redirected to `shieldHp` first. Renderer: blue translucent dome sprite around CC when active. Power drain: 1 power/tick while shield active. |
| 2 | **Defensive walls** — low-cost building, blocks movement, can be placed in lines | #10a | New building type in `buildings.ts`: `wall { hp: 400, cost: 10, power: 0, buildTime: 2, range: 0, damage: 0 }`. Obstruction at placement tile. Wall placement mode: click+drag draws a line of wall segments (like multi-route). `obstruction-system.ts`: walls block ground unit pathfinding. |
| 3 | **Weapon upgrades** — researched at tech center, +25% damage per level, 3 levels | N1a | New upgrade type in `upgrades.ts`: `weapon-upgrade-lv1/lv2/lv3`. `combat-system.ts`: `weaponDamageMultiplier = 1 + 0.25 * teamState.weaponUpgradeLevel`. HUD: research button with escalating cost. |

**Touch points:** `buildings.ts`, `upgrades.ts`, `combat-system.ts`, `world.ts`, `renderer.ts`, `placing-system.ts` (wall drag), `obstruction-system.ts`, `constants.ts`

---

## Day 13 — Super Weapon Variants (M)

Three strike types player chooses once at the SW building.

| # | Feature | Ref | Notes |
|---|---------|-----|-------|
| 1 | **Laser / Airstrike / EMP choice** — SW building selection bar shows 3 buttons; once chosen, others disabled | #9 | `TeamState.swChoice: 'laser' | 'airstrike' | 'emp' | null`. SW building `hud.ts`: render 3 buttons, disable after first choice. `SimCommand::sw-choose { choice }` sets team state. |
| 2 | **Airstrike** — plane squadron bombs target area | #9 | New SimCommand variant: `sw-airstrike { x, y, team }`. `plane-system.ts`: spawn 4 kamikaze planes that drop bombs at (x, y), deal area damage, no return. Renderer: plane flyover + explosion at target. |
| 3 | **EMP** — disables all enemy buildings + units in radius for 5 s, no damage | #9 | New SimCommand variant: `sw-emp { x, y, team }`. `emp-system.ts` new: mark entities in radius with `empDisabled: true` for 125 ticks. `combat-system.ts` / `work-system.ts` / `production-system.ts` skip disabled entities. Renderer: purple pulse at (x, y). |

**Touch points:** `protocol.ts`, `world.ts`, new `emp-system.ts`, `plane-system.ts`, `renderer.ts`, `hud.ts`, `combat-system.ts`, `production-system.ts`

---

## Day 14 — Player Profile + Achievements (M)

localStorage + lobby UI. All client-only.

| # | Feature | Ref | Notes |
|---|---------|-----|-------|
| 1 | **Player profile** — local profile screen: name, stats (matches played, win %, units built/lost), match history list | #14 + N4a | New `profile.ts`: localStorage key `space-arenas:profile { name, stats, matchHistory[] }`. `stats.ts` writes to profile on game end. Lobby: new Profile tab with stats grid + history table. |
| 2 | **Achievements** — unlock on milestones (first win, 50 kills, etc.) | #40a | `profile.ts` `achievements[]` with `id`, `name`, `description`, `unlockedAt`. Check triggers in `Game.ts` `onGameOver()`. Lobby: achievements panel with locked/unlocked badges. |
| 3 | **Color unlocks** — unlock new selection colors via achievements | #40b | `profile.ts` `unlockedColors: string[]`. Achievement grants specific color. Lobby color picker filters to unlocked colors. Default: 6 colors; each achievement adds 1. |

**Touch points:** new `profile.ts`, `stats.ts`, `Game.ts`, `main.ts` (lobby tabs), `index.html`

---

## Day 15 — Team Features: Co-op + Shared Control (S–M)

Team multiplayer features. Both need LAN/online.

| # | Feature | Ref | Notes |
|---|---------|-----|-------|
| 1 | **Co-op shared economy** — toggle in lobby: team shares power + supply | #16a | `MatchSettings.sharedEconomy: boolean`. `economy-system.ts`: when enabled, `world.teamStates[team].supply` / `power` become shared reads (no per-player split). Lobby toggle checkbox. |
| 2 | **Shared team control** — chat-vote system: ally can request control, team votes, majority → full team unit control | #12 | New SimCommand `ally-control-request { fromTeam }` + `ally-control-vote { fromTeam, toTeam, approve }`. `Game.ts` vote tracker: when majority approves, `world.teamControl = 'shared'`. Input: shared selection reads all team units. Only units NOT currently selected by another player are controllable. |

**Touch points:** `protocol.ts`, `economy-system.ts`, `Game.ts`, `world.ts`, `input.ts` (shared selection), `index.html` (lobby)

---

## Day 16 — Replay System (M, LAN only)

Save/load from host command history. No online server needed.

| # | Feature | Ref | Notes |
|---|---------|-----|-------|
| 1 | **Replay save** — on game end, host saves `history: EnvelopeCommand[]` to localStorage | #33a | `relay.ts`: on game over, serialize `history` + `settings` to localStorage key `space-arenas:replay:<timestamp>`. Lobby: Replay tab with saved replays list (timestamp, map, players, result). |
| 2 | **Replay load** — click replay → launch spectator with fast-forward | #33a | `Game.ts` new `startReplay(replayData)`: create room as spectator, inject history, `SpectateSyncMessage` fast-forward (same as existing spectate code path). |
| 3 | **Replay delete** — delete button per replay in lobby | #33a | Lobby replay list: delete button removes from localStorage. |

**Touch points:** `relay.ts`, `Game.ts`, `net.ts`, `main.ts` (lobby replay tab), `index.html`

---

## Day 17 — Auto-Reconnect + Spectator Fallback (M)

Net + client resilience.

| # | Feature | Ref | Notes |
|---|---------|-----|-------|
| 1 | **Same-room reconnect** — if disconnected, try reconnect within 10 s; if host re-accepts, fast-forward via spectate path | #34a | `net.ts` `onClose`: start 10 s retry loop (`new WebSocket(url)`). `relay.ts`: on new connection with existing `clientId`, re-accept and send `SpectateSyncMessage` with current tick + history offset. |
| 2 | **Spectator fallback** — if reconnect fails, auto-spectate until game ends | #34c | `Game.ts`: on reconnect success but room full, enter spectate mode. Existing spectate code handles the rest. |

**Touch points:** `net.ts`, `relay.ts`, `Game.ts`

---

## Day 18 — Survival Waves + Scenario Schema (M–L)

AI wave system + data-driven config.

| # | Feature | Ref | Notes |
|---|---------|-----|-------|
| 1 | **Survival mode** — PvE: waves of enemy units every 2 min, escalating difficulty | #15a | `Game.ts` new mode `survival`. `bot.ts` new `spawnWave(tick, difficulty)`: spawn batch of units at map edges, strength scales with wave number. Lobby: new game mode selector "Survival". |
| 2 | **Daily challenge** — fixed seed/map/settings, stats leaderboard (local) | #15b | `survary.ts`: seed from `Date.now()` at midnight UTC, stored in localStorage. Same wave logic, fixed parameters. Lobby: "Daily Challenge" button loads today's seed. |
| 3 | **Campaign hint tracks** — sequential objectives shown as HUD tips | #15c | `campaign.ts` new: array of `{ trigger: 'wave-clear' | 'unit-killed', message: string }`. HUD: toast notification at top when trigger fires. |
| 4 | **Scenario JSON schema** — data-driven wave definitions, extensible | N6a | `survival.json` schema: `{ waves: [{ delay, units: [{ type, count }], mapVariant }] }`. Loaded by `spawnWave()`. Allows custom scenarios without code changes. |

**Touch points:** `Game.ts`, `bot.ts`, `main.ts` (lobby), new `survival.ts`, new `campaign.ts`, `hud.ts` (toasts)

---

## Day 19 — Base Templates + Mod Support (S–M)

Economy QoL + data config.

| # | Feature | Ref | Notes |
|---|---------|-----|-------|
| 1 | **Save building layout** — in-game button saves current building positions as a template | #20a | `Game.ts` new `saveTemplate(name)`: iterate `world.entities`, filter `buildingComp`, store `{ type, relX, relY }[]` in localStorage `space-arenas:templates`. HUD button in tools bar. |
| 2 | **Build from template** — load template, show ghost preview, click to place all at relative offsets | #20a | `Game.ts` new `loadTemplate(id)`: enter placement mode with ghost buildings rendered at relative offsets. Click to issue batch `SimCommand::place` for each building (if enough supply + power). |
| 3 | **JSON balance mods** — lobby toggle to load `balance.json` overrides at game start | #37a | `match.ts`: if `modPath` set, `fetch(modPath)` then deep-merge into `buildings.ts` / `units.ts` / `weapons.ts` defaults. `constants.ts` `OVERRIDE_BUILDING_FIELDS` / `OVERRIDE_UNIT_FIELDS` already support this pattern. Lobby: file input or URL field for mod JSON. |

**Touch points:** `Game.ts`, `hud.ts`, `placing-system.ts`, `match.ts`, `constants.ts`, localStorage

---

## Day 20 — Military Tactics: Hold Position + Formations (M)

Input + move system.

| # | Feature | Ref | Notes |
|---|---------|-----|-------|
| 1 | **Hold position stance** — unit ignores nearby enemies, holds position until manually ordered | N3a | New SimCommand `hold-position { unitIds }`. `UnitComp.stance: 'attack' | 'hold'`. `combat-system.ts`: auto-fire skipped when `stance === 'hold'`. HUD button in tools bar. |
| 2 | **Formation density modes** — Loose (1.5× spread), Tight (0.7× spread) | N3b | `UnitComp.formationSpread: 1.5 | 0.7`. `move-system.ts`: when computing movement targets, multiply offset by `formationSpread`. HUD toggle button. |

**Touch points:** `protocol.ts`, `world.ts`, `combat-system.ts`, `move-system.ts`, `hud.ts`

---

## Day 21 — Territory Capture: Supply Twist (M)

Capture neutral supply fields for income boost.

| # | Feature | Ref | Notes |
|---|---------|-----|-------|
| 1 | **Neutral supply capture** — send unit to unowned supply field → gains ownership, +20% income | N2c | `EconomySystem`: when a unit stands on a neutral `supplyField` for 5 s (125 ticks), ownership transfers to that unit's team. `renderer.ts`: supply field color changes to team color. `world.ts`: supply field gains `team: number | null`. |

**Touch points:** `economy-system.ts`, `world.ts`, `renderer.ts`, `constants.ts` (capture time, income bonus)

---

## Day 22 — Interactive Tutorial (L)

New game mode overlay with guided walkthrough.

| # | Feature | Ref | Notes |
|---|---------|-----|-------|
| 1 | **Step-by-step walkthrough** — 8-step tutorial: move, build, harvest, attack, abilities, power, win | #39a | `tutorial.ts` new: array of steps `{ instruction, highlight, validate, onComplete }`. HUD: overlay panel with current step + "Next" button. `Game.ts` tutorial mode: blocks commands not related to current step; validates completion before advancing. Maps: pre-set tutorial map with scripted layout. |

**Touch points:** new `tutorial.ts`, `Game.ts`, `hud.ts`, new tutorial map in `maps.ts`, `index.html`

---

## Summary — Estimated Effort

| Day | Bundle | Effort | Sim change? | Status |
|-----|--------|--------|-------------|--------|
| 1 | UI icons + wreck + sell | S | No | ✅ |
| 2 | Audio + haptics + SFX | S | No | ✅ |
| 3 | Control groups + selection (+ bar-hotkey rework) | S | No | ✅ (point 3 skipped) |
| 4 | Fog modes + day/night + base alert | M | Yes | ✅ (radar-limited deferred) |
| 5 | Damage feedback + settings + shake | S | No | |
| 6 | Pings + spectator + perf | M | Yes | |
| 7 | Build queue + waypoint + victory | M | Yes (reorder) | ✅ (feature 2 postponed) |
| 8 | Veterancy | M | Yes | ✅ |
| 9 | Abilities + stealth | M | Yes | ✅ (9.1: AoE test, smoke radius, per-unit stealth) |
| 10 | Engineer + mines | M | Yes | |
| 11 | APC transport | M | Yes | |
| 12 | Dome + walls + weapon upgrade | M | Yes | |
| 13 | Super weapon variants | M | Yes | |
| 14 | Profile + achievements | M | No | |
| 15 | Co-op + shared control | M | Yes | |
| 16 | Replay system | M | No | |
| 17 | Auto-reconnect | M | No | |
| 18 | Survival + scenario | M–L | Yes | |
| 19 | Base templates + mods | S–M | No | |
| 20 | Hold position + formations | M | Yes | |
| 21 | Territory capture (supply) | M | Yes | |
| 22 | Tutorial | L | Yes | |

**Total: ~22 working days**

**Deferred** (see `future_todo.md`): sea army, full territory capture game mode, online server, cloud mods, advanced map builder.
