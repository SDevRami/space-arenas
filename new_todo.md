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

Tech-center research, two new SimCommands + ECS components. Follow-up fixes folded in: AoE verification, smoke radius, per-unit stealth buy, ability class gate, hotkey audit, disabled already-bought buttons.

| # | Feature | Ref | Notes |
|---|---------|-----|-------|
| 1 | **Grenade ability** — toggle throw with range ring, fuse → red blast | #1a partial | **Done.** HUD toggle button (commands section when a throw-eligible unit is selected) arms a `pendingAbility` in `Game.ts`; right-click inside the throw-ring issues the new `grenade` SimCommand (CMD id 22). `input-system.ts` validates ownership, per-unit `abilityCooldown` (0 = ready, else absolute tick; `grenadeCooldownTicks` default 2.5 s), and `grenadeRange` (default 6 cells) — reasons `ability on cooldown` / `target out of throw range`. Thrown grenades are ECS marker entities with `GrenadeComp` { team, fromX/fromY, x, y, startTick, explodeAt, radius, damage }; new `AbilitiesSystem` (runs right after Combat in the registry) detonates them at `explodeAt` via `explodeAt()` (splash gather + `applyDamage` with teamOverride) and emits `grenade-exploded`. Renderer draws the throw arc + pulsing red blast ring; settings fields `grenadeRange/BlastRadius/Damage/FuseTicks/CooldownTicks`. AoE verified by regression test: an enemy inside the blast takes exactly `grenadeDamage` (45); "no damage" reports stem from the target walking out of the blast during the fuse, out-of-range throws, or air targets (splash skips `class: 'air'`). |
| 2 | **Smoke ability** — cloud makes shots crossing it miss by RNG | #1a partial | **Done.** Same toggle + `smoke` SimCommand (id 23). The canister is thrown like a grenade: `SmokeComp` (team, x, y, radius, `fromX/fromY`, `startTick`, `landTick`, `untilTick`) flies for `grenadeFuseTicks` (1 s) toward the command point, drawn as an in-flight arc that turns into the cloud at `landTick`. Cloud radius drives shot blocking via exported `smokeRadiusAt(tick)` — 0 in flight, grows to full over the first 25% of cloud life, shrinks to 0 over the last 15% near `untilTick = landTick + smokeDurationTicks`. `combat-system.ts` `fire`/`fireGround` check `shotBlockedBySmoke` (shot segment vs cloud circle) then roll `world.rng.next()` (deterministic, one draw) against `smokeMissChance` (0.6) → `shot-missed` event, zero damage; clouds with radius 0 don't block. `SMOKE_RADIUS` is derived as `GRENADE_BLAST_RADIUS * 1.5` (2.25 cells) and `MatchSettings.smokeRadius` updates automatically; test asserts the ratio. Settings: `smokeRange/Radius/DurationTicks/MissChance/CooldownTicks`. |
| 3 | **Stealth upgrade** — per-unit invisibility buy + per-building detector | #5a | **Done.** New research `stealth-tech` (tech center, 400/20 s) unlocks the buy (no retroactive cloaking; `factories.ts` spawns units with `stealth: false`). HUD shows a **Stealth $** button in the command bar for selected owned infantry/vehicle units (`stealthCost` = 200, default, `MatchSettings.stealthCost`). New `set-stealth` SimCommand (id 25) deducts per unit; rejects `cannot stealth this unit` (air), `stealth upgrade not researched`, `unit already stealthed`, `insufficient credits`. Stealthed units are invisible (`isVisibleTo` gate) until they fire → `revealedUntil = tick + stealthRevealTicks` (3 s), or when a detector covers them; a **gold hat icon** renders above their hp bar (hidden while revealed). `detector-upgrade` research (300/15 s) unlocks `set-detector` SimCommand (id 24): buys a detector for `detectorCost` (200) on any finished owned building (`BuildingComp.detector`), revealing stealth in `detectorRange` (12 cells). `stealth-bought` / `detector-bought` events. Settings: `detectorCost/Range`, `stealthRevealTicks`. |
| 4 | **Ability class gate** | — | **Done.** New shared `canThrowBandolier(def)`: `class !== 'air' && id !== 'bulldozer'`. HUD grenade/smoke toggles appear only when the selection holds an eligible owned unit; `Game.ts`'s pending-ability throw path and the sim-side `grenade`/`smoke` handlers reject the rest (`unit cannot use ability`). Tests: 4 eligibility rejects; the AoE test's bulldozer thrower swapped for an unarmed `scout`. |
| 5 | **Hotkeys for the new selection-bar buttons** | — | **Done.** Audit confirmed both new buttons pass `assignUniqueHotkey(...)` → `hotkeySlots` → Ctrl+letter via `hudShortcutByLetter` (`Game.ts:2347`): Stealth → `s`, Detector → `d`. No gaps. |
| 6 | **Already-bought items show disabled, not hidden** | — | **Done.** Research buttons: gates cover `radar`, `satellite`, `stealth-tech` (`ts2.stealthTech`), `detector-upgrade` (`ts2.detectorUnlocked`); space-laser at max level renders a disabled `Max` button instead of disappearing. Detector button renders disabled when the building already has a detector. Stealth button renders disabled when the selection is eligible but every unit is already stealthed. |
| 7 | **HP bar on buildings attacked mid-construction** (polish) | — | **Done.** `renderer.ts` `barSprites` pair gained optional `hpBg`/`hpFill`. When `showBuild && hpFrac < 1` a second red hp bar renders under the blue build-progress bar (color follows the normal hp thresholds); cleanup (`syncBars` + early return) releases the extra sprites. Manual attacks on unfinished buildings already work (`applyDamage` has no `done` gate, only auto-targeting skips `!b.done`); regression test damages an unfinished building without disturbing its `buildProgress`. |
| 8 | **Dev settings + sync** | — | **Done.** `DEV_SCALAR_SECTIONS` gets `abilities` + `stealth` sections (13+ synced fields) and `main.ts` dev section covers `stealthCost`; host `SANITIZE` covers all new keys, hash covers team flags + grenades/smokes comps + unit/building fields, `PROTOCOL_VERSION` → 6, i18n en/ar for hud + dev + toasts. `tests/abilities.test.ts` (23 tests: explode + AoE, cooldown, range, class gate, smoke canister flight / grow + shrink / cloud expiry / radius ratio, stealth buy gates + reveal, detector buy + research gate, determinism). |

**Touch points:** `protocol.ts` (4 new Commands + ids 22–25), `shared/constants.ts` (abilities/stealth settings, derived smoke radius), `shared/balance/units.ts` + `shared/balance/index.ts` (`canThrowBandolier`), `world.ts` (stealth/flags/sets + `isVisibleTo` gate + `detectorNear`), `combat-system.ts` (smoke miss + reveal-on-fire + `explodeAt`), new `abilities-system.ts`, `input-system.ts` (handlers + research/class guards), `factories.ts` (spawn `stealth: false`), `placing-system.ts` (research finalizers = unlock), `hash.ts`, `renderer.ts` (ability ring + arc/blast/smoke FX + stealth hat + dual build/hp bar), `Game.ts` + `hud.ts` (toggles, Stealth/Detector sections, disabled buys, throw filter), `core/events.ts` (`stealth-bought`), `main.ts` + i18n (dev sections), `host/rooms.ts` (SANITIZE), `tests/abilities.test.ts`, `tests/combat.test.ts` (build-site damage), `tests/protocol.test.ts` (id 25)

---

## Day 10 — Engineer + Mines + Research Queue + Abilities Tech + Assets + Per-Unit Toggles (M) ✅ DONE

Engineer (vehicle, war factory, unarmed) with default single-target heal + rank-3 aura ring, `mine-tech`-gated proximity mines, and vehicle run-over — plus a follow-up bundle fused in after the crush rework: tech-center multi-research queue, `abilities-tech` gating grenade/smoke, 4-digit frame + 10-color asset templates, per-unit grenade/mine toggle state, and two asset-path fixes. All 12 new settings mirrored to dev panel + host sanitize.

| # | Feature | Ref | Notes |
|---|---------|-----|-------|
| 1 | **Engineer unit** — war factory unit, heals by right-clicking | #3a | **Done.** New `engineer` unit (vehicle class, hp 150, speed 90, cost 150, 12 s build, produced by `war-factory`, no weapon → never in `world.attacks`). `repair-unit` SimCommand (CMD id 28, uses the standard 4-arg codec) in `input-system.ts`: no research gate, `no engineer selected`/`can't repair`/`target in full health`/`no engineers in range` rejects. `work-system.ts` gained a `repair-unit` job that chases the ally within `engineerHealRange` (2) then heals `engineerHealPerTick` (4) each tick; `healFlashes` cosmetic. |
| 2 | **Mines** — engineer places + removes proximity mines | #6 | **Done.** `place-mine` (CMD 26) + `remove-mine` (CMD 27, target: entity, 4-arg codec). Fixed-point fx→tile fix in input-system (`Math.floor(cmd.x / 1000)`); mines sit at tile centers, arm after `mineArmTicks` (1.5 s), trip on a ground enemy within `mineTriggerRadius` (1), blast `mineBlastRadius` (2) for `mineDamage` (60), kills credited to the placing engineer (`m.owner`). `MinesSystem` + `MineComp`, `mine-exploded` event, `TEAM_MINE_LIMIT` (30), `hash.ts` covers mines. Removal by an idle engineer or bulldozer within `minePlaceRange` (4), gates: research → target exists/ownership → remover class → range. Own team sees own mines (never enemies). |
| 3 | **Friendly-fire toggle** — setting for whether mines damage own team | #6 | **Done.** `MatchSettings.friendlyMineDamage` (default false, dev setting numeric 0/1). When on, own mines trip on, and blast, allied ground units; enemies always trigger. Toasts `minePlaceOn/Off`, `mineRemoveOn/Off`. |
| 4 | **`mine-tech` research** — gates mine placement/removal | — | **Done.** New `mine-tech` upgrade (tech center, 400/20 s) finalizes in `placing-system.ts` → `TeamState.mineTech`; `remove-mine` command rejects `mine tech not researched`, HUD button disabled once researched. i18n `upgrades.names` entries. |
| 5 | **Heal aura at veteran rank** | — | **Done.** `HealSystem` passively heals allied ground units within `engineerHealAuraRadius` (2) once the engineer reaches `engineerHealRank` (3); air never healed; flashes left of the sim hash. Follow-up: selected rank-3+ engineers draw a dotted green ring (`renderer.healAuraRing` + `drawDottedRangeRing`), driven from `Game.onFrame`. |
| 6 | **Vehicle run-over** | — | **Done.** `CrushSystem` (runs with Mines before scenery): a vehicle that steps onto an enemy troop's tile deals `CRUSH_DAMAGE` (20) once on entry; a parked vehicle stops grinding and pairs re-arm after separating — keeps foot soldiers a threat and restored the bot combat tests (grind version collapsed the hard bot's damage to 0). Never crushes allies/air/infantry-only. |
| 7 | **HUD + i18n + dev/sanitize + protocol** | — | **Done.** HUD Place Mine / Remove Mine toggles (Ctrl+`m`, Ctrl+`k`) via `addToggleButton(hotkey?)`; own-mine rendering (`syncMines`, obstacle texture) + green-cross heal flash (`syncHealFlashes`). Dev sections `mines` + `heal` (12 fields), host `SANITIZE` extended, `PROTOCOL_VERSION` → 7, `CMD_TYPE_IDS` 26–29 reflected in protocol test. |
| 8 | **Tech-center multi-research queue** | — | **Done.** `BuildingComp.researchQueue: ResearchOrder[]` (unique `allocId()` per order); head decrements in `placing-system.ts`, `shift()` on complete; `research` command dedupes every researched upgrade, enforces `queueLimit`, emits `research-started`/`research-queued`; new `dequeue-research` command (protocol id 29) refunds and emits `research-cancelled`; `sell` wipes the queue; HUD renders queue-scroll cards with progress fill + cancel-on-click. |
| 9 | **Grenade/smoke behind a tech-center upgrade** | — | **Done.** New `abilities-tech` upgrade (400/20 s) → `TeamState.abilitiesUnlocked` (hashed); `grenade`/`smoke` commands reject with `abilities tech not researched`; `Game.toggleAbility` + right-click throw + HUD buttons all gated; i18n added (en+ar). |
| 10 | **4-digit frames + 10 color folders** | — | **Done.** `graphics.ts` templates `{folder}/{color}/{folder}_{frame}.png`, fields `sf_`/`of_`; `FRAME_TO_DIR` (0001=west+south … 0008=west); `loadUnitDir` replaces `{frame}`; `hud.assetIconUrl` uses frame 0002; on-disk `sd_*` renamed to `sf_*`. |
| 11 | **Per-unit toggle state** | — | **Done.** grenade/smoke/place-mine/remove-mine are now keyed per unit id (`Game.abilityModes`/`mineModes`) instead of a global pending mode; HUD buttons + rings reflect only armed selected units; right-click acts only on armed units; armed state persists per unit across reselection; toggling on a mixed selection arms all eligible (disarms when all already armed); deselect clears maps; dead units pruned each frame. Renderer `abilityRing` → per-unit `abilityRings: Map`. spawn-point/flag remain one-shot input modes. |
| 12 | **`{dir}` asset 404** | — | **Done.** `graphics.ts` migration now adopts ANY legacy unit template containing `{dir}` (caught `v_h/{color}/v_h_{dir}.png` variants); `hud.assetIconUrl` guards against any unresolved `{...}` placeholder. |
| 13 | **PixiJS texture-unload warning** | — | **Done.** `building-sprites.ts` tracks loaded URLs and adds `unloadAllAssetTextures()` (clears caches + `Assets.unload`); `renderer.destroy()` no longer destroys Assets-owned textures directly. |

**Touch points:** `protocol.ts` (5 Commands + ids 26–29), `shared/constants.ts` (mine/heal/crush settings), `shared/balance/units.ts` (engineer, `canThrowBandolier` excludes it), `shared/balance/upgrades.ts` (`mine-tech`, `abilities-tech`), `world.ts` (`MineComp`, `crushPairs`, `healFlashes`, `researchQueue`, `abilitiesUnlocked`), new `mines-system.ts` / `crush-system.ts` / `heal-system.ts`, `work-system.ts` (repair-unit), `input-system.ts` (handlers + fx→tile fix + rejects), `placing-system.ts` (research finalizers/queue), `registry.ts`, `hash.ts`, `renderer.ts` (mines + heal flash + heal aura ring + per-unit ability rings + teardown), `Game.ts` + `hud.ts` (toggles + hotkeys + research queue UI + per-unit modes), `graphics.ts` / `building-sprites.ts` (4-digit/10-color templates + unload), `main.ts` + i18n (dev sections), `host/rooms.ts` (SANITIZE), `events.ts` (`mine-exploded`, `research-queued`, `research-cancelled`), `tests/{mines,engineer,crush,abilities,protocol,bot}.test.ts`

---

## Day 11 — APC Transport (M) ✅ DONE

New unit + transport ECS + load/unload commands.

| # | Feature | Ref | Notes |
|---|---------|-----|-------|
| 1 | **APC vehicle** — war factory unit, carries 10 infantry | #7a | Shipped. New `apc` in `units.ts`: cost 200, HP 250, build 10 s, speed 78, vision 7, war-factory, `transportCapacity: 10`. Vector mini/medium shapes + `UNIT_ASSET_IDS` entry (`v_apc` folder optional). Speed uses game scale (spec `3.0` out of scale); armor/power/range/damage N/A (UnitDef has no such fields). |
| 2 | **Load units** — select troops, click APC → they enter it | #7a | Shipped. `transport-load` (id 30) carries `transportId`; InputSystem validates + queues riders into `TransportComp.loadQueue[]` (no instant removal); `TransportSystem` makes riders walk to the APC while it drives out to meet them, boarding **one per tick** when within `BOARD_RANGE` (2400 fx, above the vehicle/infantry separation floor), taking a full stat snapshot at boarding. Queued riders stay alive until they board, so an APC destroyed mid-load no longer kills them. `hash.ts` + teams-loop hash cover comp + `transportCapacityLevel`; `PROTOCOL_VERSION 7→8`. Boarded passengers die with the APC (11.2). |
| 3 | **Unload button** — APC selection bar has "Unload Here" button → click position to drop all | #7a | Shipped. `transport-unload` (id 31) + `onUnloadClick`/`isUnloadActive` HUD actions; `Game.ts` `pendingUnload` one-shot mode (modeled on pendingFlag); `TransportSystem` (registered after `CrushSystem`) drives to the point (`UNLOAD_RANGE` 2800 fx, also above the separation floor) then disembarks **one passenger per tick** into a stable grid around the point, stats restored. |
| 4 | **Troop Capacity research** — Tech Center upgrade grants +3 slots/level | #7a | Shipped. `transport-capacity` upgrade (cost 300, tech-center) → `TeamState.transportCapacityLevel`; capacity = `10 + level × 3` (`TRANSPORT_CAPACITY_PER_LEVEL`). |

**Touch points:** `units.ts`, `upgrades.ts`, `protocol.ts`, `constants.ts`, new `transport-system.ts` + `transport-system.ts` in `registry.ts`, `world.ts` (TransportComp), `hash.ts`, `input-system.ts`, `placing-system.ts`, `events.ts`, `hud.ts`, `graphics.ts`, `Game.ts`, `shapes.ts`, i18n `en/ar.json`, `tests/transport.test.ts`, `tests/protocol.test.ts` (ALL_TYPES/CMD_TYPE_IDS/round-trip).

---

## Day 12 — Defense Buildings + Weapon Research (S–M) ✅ DONE

Building types + combat + research. Counterplay triangle: dome counters laser, EMP counters power.

| # | Feature | Ref | Notes |
|---|---------|-----|-------|
| 1 | **CC Defense Dome** — absorbs enemy fire, needs power | #8a | New upgrade in `upgrades.ts`: `defense-dome` (tech center). When researched, CC gains `shieldHp: 200`, regenerates 1 HP/tick while powered. `combat-system.ts`: damage to CC redirected to `shieldHp` first. Renderer: blue translucent dome sprite around CC when active. Power drain: 1 power/tick while shield active. |
| 2 | **Defensive walls** — low-cost building, blocks movement, can be placed in lines | #10a | New building type in `buildings.ts`: `wall { hp: 400, cost: 10, power: 0, buildTime: 2, range: 0, damage: 0 }`. Obstruction at placement tile. Wall placement mode: click+drag draws a line of wall segments (like multi-route). `obstruction-system.ts`: walls block ground unit pathfinding. |
| 3 | **Weapon upgrades** — researched at tech center, +25% damage per level, 3 levels | N1a | New upgrade type in `upgrades.ts`: `weapon-upgrade-lv1/lv2/lv3`. `combat-system.ts`: `weaponDamageMultiplier = 1 + 0.25 * teamState.weaponUpgradeLevel`. HUD: research button with escalating cost. |

**Touch points:** `buildings.ts`, `upgrades.ts`, `combat-system.ts`, `world.ts`, `renderer.ts`, `placing-system.ts` (wall drag), `obstruction-system.ts`, `constants.ts`

---

## Day 13 — Super Weapon Variants (M) ✅ DONE

Three strike types player chooses once at the SW building.

| # | Feature | Ref | Notes |
|---|---------|-----|-------|
| 1 | **Laser / Airstrike / EMP choice** — SW building selection bar shows 3 buttons; once chosen, others disabled | #9 | `TeamState.swChoice: 'laser' | 'airstrike' | 'emp' | null`. SW building `hud.ts`: render 3 buttons, disable after first choice. `SimCommand::sw-choose { choice }` sets team state. |
| 2 | **Airstrike** — plane squadron bombs target area | #9 | New SimCommand variant: `sw-airstrike { x, y, team }`. `plane-system.ts`: spawn 4 kamikaze planes that drop bombs at (x, y), deal area damage, no return. Renderer: plane flyover + explosion at target. |
| 3 | **EMP** — disables all enemy buildings + units in radius for 5 s, no damage | #9 | New SimCommand variant: `sw-emp { x, y, team }`. `emp-system.ts` new: mark entities in radius with `empDisabled: true` for 125 ticks. `combat-system.ts` / `work-system.ts` / `production-system.ts` skip disabled entities. Renderer: purple pulse at (x, y). |

**Touch points:** `protocol.ts`, `world.ts`, new `emp-system.ts`, `plane-system.ts`, `renderer.ts`, `hud.ts`, `combat-system.ts`, `production-system.ts`

---

## Day 14 — Player Profile + Achievements (M) ✅ DONE

localStorage + lobby UI. All client-only.

| # | Feature | Ref | Notes |
|---|---------|-----|-------|
| 1 | **Player profile** — local profile screen: name, stats (matches played, win %, units built/lost), match history list | #14 + N4a | New `profile.ts`: localStorage key `space-arenas:profile { name, stats, matchHistory[] }`. `stats.ts` writes to profile on game end. Lobby: new Profile tab with stats grid + history table. |
| 2 | **Achievements** — unlock on milestones (first win, 50 kills, etc.) | #40a | `profile.ts` `achievements[]` with `id`, `name`, `description`, `unlockedAt`. Check triggers in `Game.ts` `onGameOver()`. Lobby: achievements panel with locked/unlocked badges. |
| 3 | **Color unlocks** — unlock new selection colors via achievements | #40b | `profile.ts` `unlockedColors: string[]`. Achievement grants specific color. Lobby color picker filters to unlocked colors. Default: 6 colors; each achievement adds 1. |

**Touch points:** new `profile.ts`, `stats.ts`, `Game.ts`, `main.ts` (lobby tabs), `index.html`

**Follow-up:**
| # | Feature | Notes |
|---|---------|-------|
| 1 | **Spectator career** | Spectators no longer get a lobotomized "loss" profile entry. `Game.ts` `recordProfileMatch` branches to new `recordSpectate()` (`profile.ts`) when `this.spectator`: only the `spectatedMatches` counter + a `'spectate'` history record advance. Spectator achievements (Observer / Field Reporter / War Correspondent) in `achievements.ts` (career.spectator group). |
| 2 | **Gamer username** | Profile panel username input (`profile-username`, 16 chars) → `updateProfileName()`. On save, `applyProfileName()` mirrors it into the online `#net-name` field + `space-arenas:name` storage + `/api/self` (so lobby + match join use it). |
| 3 | **Achievement toasts** | `Game.checkLiveAchievements()` every ~1s of sim time merges profile + live session deltas; newly-satisfied achievements toast via `Hud.achievementToast()` (golden banner, fades) + new `'achievement'` synth SFX (`audio/settings.ts` + `hooks.ts` + `dev.audio.achievement` audio override). |
| 4 | **Log moved** | `.hud-game-log` moved from bottom-left (`bottom: 84px`) to top-left under the header (`top: 48px`), clear of the top-right chat/tools panel. |

---

## Day 15 — Rank-Up / Zero-Hour Progression (M) ✅ DONE

Sim-side progression. Match score (kills, supply, research, expansions) drives a free 3★ rank ladder; rank gates tech + super-weapon upgrades, and the Super Weapon arms the Laser by default with airstrike/EMP unlocked at ★3.

| # | Feature | Ref | Notes |
|---|---------|-----|-------|
| 1 | **Match score** — deterministic, awarded per sim event | — | `TeamState.score` + `World.awardScore/scoreOf`; kill credit (unit 10 / building 30) from `World.lastAttacker` set in `combat-system.applyDamage` only when the attacker is hostile (self/sell damage never scores), supply 2/trip (`economy-system`), research 15 (`placing-system`), expansion building placed >18 tiles from spawn 25 (`EXPANSION_RADIUS_TILES`). |
| 2 | **Free 3★ rank ladder** — `RANK_COUNT = 3`, `RANK_FLOORS = [500, 1500, 3500]` | #RE q | Rank-up is **free** at the floor; score keeps counting toward the NEXT floor (never consumed). Manual `rank-up` SimCommand (id 35) → `rank-up` event + optional credits prize (`rankUpPrizeCredits` = 100). HUD rank button + overlay (locks via live world state, hidden until 500 & ready) — toast (`achievement` SFX) + log line on promote (Game.ts event drain). |
| 3 | **Rank-gated tech tiers** — `requiredRank` on every upgrade def | — | ★3: `space-laser` + `airstrike-level`/`emp-level`. ★2: `defense-dome`, `weapon-upgrade`. ★1: `stealth-tech`, `detector-upgrade`, `mine-tech`, `abilities-tech`, `transport-capacity`. ★0: `radar`, `satellite`, `dome`-adjacent basics. Research handler rejects below the floor (`star rank required`); HUD shows lock badges + disabled state. |
| 4 | **Laser default + pickable strikes** | — | Super Weapon arms the Space Laser by default; `sw-choose` only accepts airstrike/EMP (laser is rejected: `laser is armed by default`). SW panel shows "laser armed by default" note, only airstrike/EMP as choices. Radar research moved to the Command Center (`radar.availableAt = 'command-center'`). |
| 5 | **Levelable super weapons** — airstrike/EMP become upgrades at ★3 | — | `airstrike-level` / `emp-level` (max lvl `AIRSTRIKE_MAX_LEVEL`/`EMP_MAX_LEVEL` = 2) require the matching weapon armed first (`choose the airstrike/emp` guard), escalating cost `lvl * 1000 + up.cost`; strikes scale damage ×(1+0.5·lvl), radius ×(1+0.15·lvl), EMP duration ×(1+0.5·lvl). HUD shows armed-required badges + disabled states. |
| 6 | **Profile total score + hexagon chart** | — | `MatchRecord.score` (`matchScore.field`) + `totalScore(profile)` (old records default 0). Player card renders a hexagon SVG radar chart (combat / economy / army / expansion / research / intel) + total score; rank-up achievement slides in from top-left (`toast ach slide-in` CSS). Recorder untouched. |

**Touch points:** `shared/constants.ts` (`RANK_COUNT/RANK_FLOORS/score consts/rankUpPrizeCredits/EXPANSION_RADIUS_TILES/AIRSTRIKE_MAX_LEVEL/EMP_MAX_LEVEL`, PROTOCOL_VERSION → 12), `shared/protocol.ts` (`rank-up` id 35), `shared/balance/upgrades.ts` (`requiredRank` + radar `command-center` + sw-level defs), `world.ts` (`TeamState.score/rank/airstrikeLevel/empLevel`, `lastAttacker`, rank helpers, `AirstrikeComp.damage/radius`), `hash.ts` (4 new fields), `input-system.ts` (rank-up handler, sw-choose laser guard, leveled strikes, research gating/costs), `placing-system.ts` (+`SCORE_RESEARCH`, sw-level finalizers), `economy-system.ts` (+`SCORE_SUPPLY_PER_TRIP`), `combat-system.ts` (`lastAttacker`), `airstrike-system.ts` (damage/radius params), `events.ts` (`rank-up`), `hud.ts` (rank btn/overlay/lock badges/SW panel note/onRankUp), `Game.ts` (toast + log + describeEvent), `profile.ts`+`profile/ui.ts` (`score`, `totalScore`, hexagon card), `i18n` en/ar, `styles.css` (`.rank-btn` pulse, `#rank-overlay`, `.lock-badge`, `.sw-panel-note`, toast slide-in, hexagon), `tests/day15.test.ts`, `tests/{protocol,day14}.test.ts` (updates)

**Follow-up (2026-09-13):**
| # | Change | Notes |
|---|--------|-------|
| 1 | **APC/bunker load only infantry** | `transport-load` now rejects every non-`infantry` unit (`only infantry can be transported`) — vehicles/war-factory units can no longer board the APC or garrison a bunker. Tests: APCs reject vehicles, air unit reason updated. |
| 2 | **Bunker "Unload Here" rework** | A garrison building can't teleport troops to the clicked point: the `transport-unload` order now steps troops off around the bunker's own footprint first, then marches each to the clicked position (sim-side in `transport-system.ts`, building branch sets a move for every disembarked passenger). Toast generalized to "troops leave the transport first". Tests: step-off happens near the bunker with a move toward the point; nobody teleports. |
| 3 | **Rank button always visible + score** | `#rank-btn` no longer hides at rank 0 — it always shows the earned stars plus the live match score (`★★ 1,650`, pulsing while the next promotion is ready) so the ladder is reachable from the start. |
| 4 | **Profile hex + (removed) Card popup** | Hex chart enlarged (~200 px, 220 viewBox) with an axis legend (six labeled stats + numbers + colored dots) and colored value-dot circles on the plotted points; a first pass added a "Card" button + popup (player info + achievements) but that was **removed** again on request (`profile.openCard/cardTitle` keys also dropped). i18n en/ar `profile.hex.*`. |
| 5 | **Bunker march uses formation slots** | Instead of every disembarked trooper walking to the exact clicked `(x,y)` (which made them jitter/glitch on arrival), each passenger now gets its own target slot around the point — same `cell 1400` grid `input-system` uses for a multi-unit move order (`marchSlot` in `transport-system.ts`, stable across ticks via `totalDrop = passengers.length + unloadCount`). Tests: distinct targets per trooper. |
| 6 | **Click-to-eject a rider** | The loaded-units list (APC + bunker) is now clickable — clicking one passenger issues `transport-unload { index }`, which drops exactly that rider next to the carrier (no position pick; the click `x/y` is ignored). `TransportComp.pendingOne` (hashed automatically), single-splice in `transport-system.ts`, `transport-unload` wire format gains a second `I32 index` (encode/decode + buffer size, PROTOCOL_VERSION → 13), `hud.unloadRider` hint, `Game.unloadOne`. Tests: APC + bunker eject exactly one unit near the carrier. |
| 7 | **Rank popup → side menu** | The rank ladder stopped being a centered popup (`#rank-overlay`) and became a side menu that slides in from the left edge (`#rank-menu`, `transform: translateX(-100%) → 0` with a dimmed `.rank-menu-backdrop`, still opened by the header star button, Esc / backdrop / ✕ close). Client-UI-only — no protocol/hash change. |

---

## Day 16 — Team Features: Co-op + Shared Control (S–M) ✅ DONE

Team multiplayer features. Both need LAN/online.

| # | Feature | Ref | Notes |
|---|---------|-----|-------|
| 1 | **Co-op shared economy** — toggle in lobby: team shares power + supply | #16a | `MatchSettings.coopEconomy: 'off' | 'power' | 'supply' | 'both'`. Awaiting Day 21 global-mode binding; sim-side the alliance's credits live in ONE slot bank (`World.creditsSlot`, starting credits pooled at boot via `rewireSharedStartingCredits`) and/or a fused power grid (`alliancePowerOf`, identical totals written back to every member). Income/refunds (economy/oil/work/sell systems) land in the shared bank; forge/building/upgrade costs spend from it (input-system `canAfford`/`spendCredits`). |
| 2 | **Shared team control** — chat-vote system: ally can request control, team votes, majority → full team unit control | #12 | `MatchSettings.coopControl: 'off' | 'units' | 'all'` + mid-match unanimous vote: `ally-coop-request` (id 36) / `ally-coop-vote` (id 37, 1 byte `approve`). Bots auto-accept (`World.robotSlots`); once every human accepts the alliance is `coopVoted` permanently (level `'all'` if lobby was off). `World.canControl` gates units (same alliance when not 'off') and buildings (level `'all'`). |

**Touch points:** `protocol.ts` (ids 36/37, PROTOCOL_VERSION → 14), `constants.ts` (Coop enums + MatchSettings fields), `world.ts` (coop state + pool/ladder helpers + `rewireSharedStartingCredits`), `hash.ts` (coopVotes + coopVoted), `events.ts` (`coop-vote-open/coop-accepted/coop-denied`), `input-system.ts` (vote handlers + pooled spends + `canControl` guards), `economy/oil/work/sell` (shared bank), `placing-system.ts` (power fusion ordering), `Game.ts` (robotSlots + credit rewire + alliance-aware selection/action guards), `hud.ts` (shared credits + Team popup + control vote banner), `main.ts` + `index.html` (lobby selects), `rooms.ts` (sanitize), `i18n` en/ar, `tests/day16.test.ts` + `tests/protocol.test.ts`.

**Follow-up (2026-09-13):**
| # | Change | Notes |
|---|--------|-------|
| 1 | **Voted co-op erases the lobby 'off'** | Setting `coopControl: 'none'` with a passed mid-match vote reports level `'all'` permanently (`World.controlLevel`). |
| 2 | **One credit bank fixed before ranks** | `rewireSharedStartingCredits` runs once at boot (after alliances are assigned) so bots + humans open with the combined pool; late rank prizes land on the canonical slot (`rankSlot`). |
| 3 | **Longest ladder-move dump path test** | day16 ladder test verifies the canonical slot gets the prize while member slots stay zeroed. |
| 4 | **No-lobby-offline no-op** | With default `coop*: 'none'`, offline matches behave exactly like before (only alliance vision/fog sharing was already in). |
| 5 | **Host sanitize** | `rooms.ts` imports Coop option lists and clamps inbound lobby settings. |
| 6 | **Two-slot all-one-alliance starts** | Such sims emit `game-over` immediately (WinLoss sees <2 alliances) — the no-ballot vote test filters coop events instead of expecting an empty list. |

**Follow-up (2026-09-14):**
| # | Change | Notes |
|---|--------|-------|
| 1 | **Team button next to Chat** | Header `#team-btn` moved from beside the rank button to between Chat and Menu. |
| 2 | **Co-op reconfiguration mid-match** | New `coop-setting` SimCommand (id **38**, 1-byte key id + string value; `coopKey` `'coopEconomy'|'coopRank'|'coopControl'`). Any non-spectator player can flip the same toggles the lobby has mid-match; deterministic via standard relay (player id + tick stamp, replayed on all clients). |
| 3 | **Credit migration on supply toggle** | `World.recoopCredits(prev,next)` pools members into the canonical slot on enable, splits the canonical bank evenly (remainder stays canonical) on disable; no-op unless a real supply transition. |
| 4 | **Hash coverage** | `hash.ts` now includes the 3 mutable coop settings so replays match. |
| 5 | **HUD Team panel rework** | Panel shows roster + 3 selects (`#coop-eco-select/#coop-rank-select/#coop-control-select`, populated from lobby lists + hints) synced from live world state; control toggle displays `'all'` when a voted alliance's lobby was `'none'`; `syncCoopUi` refreshes the open panel on any coop-setting/ballot signature change. |
| 6 | **Vote banner pointer-events** | `.coop-banner` now keeps `pointer-events: auto` + `max-width`, so the accept/decline buttons stay clickable. |
| 7 | **Protocol/version** | PROTOCOL_VERSION → 15; `coop-setting` added to protocol round-trip + stable-id tests; day16 gains Day 16.6 `coop-setting` block (pool/split/rank merge/control+ballot clear/invalid ignored/determinism). Suite now 347 tests, all green. |

**Follow-up (2026-09-14, revert):** co-op is **lobby-only again** — the mid-match Team system is removed entirely, and the host win-detection no longer ends a co-op match when a single alliance member quits.
| # | Change | Notes |
|---|--------|-------|
| 1 | **In-match co-op removed** | Deleted commands `ally-coop-request`/`ally-coop-vote`/`coop-setting` (ids 36/37/38) from `protocol.ts`; `World.robotSlots`/`coopVotes`/`coopVoted`/`recoopCredits`; vote events (`coop-vote-open`/`coop-accepted`/`coop-denied`); input-system handlers; `Game` hud actions + robotSlots boot lines. Lobby selects + shared bank/rank/control mechanics (`creditsSlot`/`rankSlot`/`controlLevel`) unchanged. |
| 2 | **HUD stripped** | Removed `#team-btn`, coop banner + Team popup markup, `.coop-*`/`.team-btn` CSS, `hud.team` + `hud.coop*` i18n (en+ar). `hud.ts` lost ballot/panel/banner logic; `controlLevel` just returns the lobby setting. |
| 3 | **Win-logic fix** | `host` `winnerFromRemaining` now counts **bots** too (grouped by `team`): a partial quit no longer reduces the match to one alliance. Non-host quit → relay `forfeit` and keep playing; host quit with members still on both sides → `H_GAME_OVER` with `winner: null` (draw), never a false victory. |
| 4 | **Tests** | Removed vote/`coop-setting` blocks (Day 16.5/16.6) + protocol entries; day16 gains alliance win-loss tests (partial vs full elimination). New e2e: allied human quits with enemy bots alive → match continues + forfeit relayed, no `H_GAME_OVER`; host quit in the same setup → surviving ally gets a draw. |
| 5 | **Protocol/version** | PROTOCOL_VERSION → **16**; stable-id map ends at `rank-up` = 35 (36 command types). Full suite green: 339 tests across 30 files; all workspaces typecheck + build. |

---

## Day 17 — Replay System / Archive (M) ✅ DONE

Replays from the host command history are saved, loaded and shared as **JSON files in the local `archive/` folder** (no localStorage). The lobby's side menu gains an **Archive** button opening a replay list with play / rename / delete, plus an upload control to import a replay JSON file.

| # | Feature | Ref | Notes |
|---|---------|-----|-------|
| 1 | **Replay save → JSON in `archive/`** — on game end, host writes `history: EnvelopeCommand[]` + settings to `archive/replay-<name>.json` | #33a | Implemented host-side (not lobby-download — files persist on disk with the host). `endMatch` → `saveReplay` writes `{ version, createdAt, seed, tickRate, map, settings, winRule, players, winner, ticks, history }` via `host/src/archive.ts` (`createArchiveStore`/`archiveStore`), `ARCHIVE_DIR` env-overridable (`SA_ARCHIVE_DIR`). `room.startSlots` snapshots participants at start so leavers stay in the replay. `relay.broadcastFrame` now pushes bot commands into `history` too. |
| 2 | **Archive side-menu button + list** — lobby side menu gains an **Archive** button; click opens a panel listing saved replays (timestamp, map, players, result) | #33a | `#tab-archive` + `#archive-panel` in `index.html`/`styles.css`, wired in `main.ts` (`setTab('archive')`, `refreshArchive`). List via `GET /api/replays` (`ReplayMeta[]`: name/size/createdAt/map/players/winner/ticks/label/valid; corrupt files listed as invalid so they can be deleted). |
| 3 | **Play / Rename / Delete** | #33a | Play fetches `GET /api/replays?name=` then `Game.startReplay(replay)` — spectator-mode world rebuilt from seed/map/settings and driven tick-by-tick with the stamped history (`stepReplayTick`). Rename = `POST /api/replays/rename` (name scrub + collision dedupe). Delete = `POST /api/replays/delete`. |
| 4 | **Upload** — import a replay JSON file | #33a | `POST /api/replays/upload`, `validReplay` guard, 64MB body cap, deduped name; client picker reads + JSON.parses the file client-side first. |
| 5 | **Offline matches also record replays** — extension | #33a | `Game.ts` records each input tick (`recordHistory` stamped with the applied sim tick, `recordTicks` = steps taken, reset per match in `startOffline`). At `game-over` (`saveOfflineReplay`) it builds the same `ReplayData` from `cfg` + `world.settings` (players via `modeCfg.slots`, map `structuredClone`d) and `persistReplay`: POSTs to `/api/replays/upload` when a host serves the page, else downloads the JSON file (uploadable from the Archive tab later). Toasts `game.replaySaved` / `game.replayDownloaded` (en/ar). |
| 6 | **Replay movie player** — spectator HUD + transport bar | #33a | Replay header shows a per-alliance economy column (`hud.setReplayEco`: name, `creditsOf`, fused `alliancePowerOf` bar/use-gen via PLAYER_COLORS accent; hides own credits/power/rank + selection/tools bars via `#hud.replay-hud`). Bottom transport bar (`#replay-bar`): play/pause (`replayPlaying` gate in `onTick`), restart, −10s/+10s jumps, speed cycles 0.25–4× (`GameLoop.setSpeed` — `acc += dt * timeScale`), and a **seek slider**. Seeking is **instant-catch-up, never turbo-plays**: scrub preview (`sliderDragging` lets the thumb follow, no rebuild while dragging) shows the chosen time immediately; then `stepSeek` fast-forwards a 20 ms budget/frame from the current world — or rebuilds from tick 0 on rewind (`buildReplayWorld` + per-frame `replayIndex` continuation) — while the view is **frozen** (replay `onFrame` early-returns, skipping render/events/sfx) and the bar shows `replay.seeking` with the thumb pinned to the target, until `finishSeek` drains events + resets stats/hash/selection and `clearReplayEndState` re-enables playback at **normal speed from that exact tick**. Replay header auto-heights (`#hud.replay-hud .hud-top { height:auto }`) so the eco columns aren't clipped by the 40 px bar; game log moves to the bottom-left; `#replay-bar` raised to z-index 50 so it stays scrubable above the results/cinematic overlays. i18n `replay.*` (en/ar). |

| 7 | **Replay zoom + minimap & selection bar** | #13a | Camera zoom range is dev-settings driven: `zoomMin`/`zoomMax` (0.5–2.5 × default) limit normal matches and `replayZoomMin`/`replayZoomMax` (0.4–5 × default) widen replays/spectate — `Camera.setZoomRange(min,max)` + `zoomAt` clamps via instance `zoomMin/zoomMax`, applied at boot from `getGraphics()` (`GraphicsSettings` loads/saves via localStorage; new dev-settings **Camera zoom** section in main.ts, `setZoomMin/Max` + `setReplayZoomMin/Max` with automatic min < max maintenance). Replays restore the minimap + selection bar: `.hud-selection` is no longer `display:none` under `#hud.replay-hud` (only `#tools-bar`/`#mobile-controls` stay hidden); clicking any unit/building shows hull/HP/rank info (`describeEntity`, `renderer.showAll` is on) and the minimap rail (Map/home/dev/reveal) is usable. A new `#replay-hud-toggle` (⊞) button in the transport bar toggles `#hud.sel-hidden` to hide/unhide minimap + selection info; transport bar and game log ride above the selection bar (`--sel-bar-h` + offsets) and drop back to the bottom when hidden. Box-select now works for spectators/replays (`onBox` skips the `canControl` filter when `this.spectator`). i18n `replay.hud*`, `dev.sections.zoom`, `dev.fields.zoom*` (en/ar). |

**Verified:** typecheck all 4 workspaces clean; full suite **352 tests / 31 files** green (new `tests/archive.test.ts` + e2e for auto-save, bot-in-history, upload/list/rename/delete); full `npm run build` green. **PROTOCOL_VERSION → 17** (spectator sync log + replay history now include bot commands — wire-visible). Offline-replay extension: client typecheck + full `npm test` + `npm run build` re-verified green. Replay movie player: client typecheck + build + full `npm test` (352) re-verified green.

**Touch points:** `relay.ts`, `Game.ts`, `net.ts`, `main.ts` (archive side menu + panel), `index.html`, `styles.css`, new `archive/` folder note (+ `.gitignore`), i18n en/ar

---

## Day 18 — Auto-Reconnect + Spectator Fallback (M) ✅ DONE

Net + client resilience.

| # | Feature | Ref | Notes |
|---|---------|-----|-------|
| 1 | **Same-room reconnect** — if disconnected, try reconnect within 10 s; if host re-accepts, fast-forward via spectate path | #34a | Internet-proof identity = persistent per-browser `clientId` (localStorage, random hex). `JoinMessage` gains `clientId`/`spectator` (`PROTOCOL_VERSION → 18`). Host keeps disconnected slots for a **12 s grace** (`RECONNECT_GRACE_MS`) via `scheduleForfeit`; client retries **7 × 1500 ms** (`attemptReconnect` builds a fresh `NetClient`, token-guarded callbacks) then auto-drops to spectator. On reclaim, host re-binds the slot (`rooms.ts reconnectPlayer`) and sends `H_PLAYER_STATE` + `S_SPECTATE_SYNC { currentTick, log: relay.history }`; client `catchUpSync`/private `stepToTickSync` fast-forward deterministically to the current tick (also used by `applySpectateSync`; shared `attachNet` re-points `this.net`). Reconnect overlay `#reconnect-overlay` (z46) with reconnecting/reconnected/spectating labels. |
| 2 | **Spectator fallback** — if reconnect fails, auto-spectate until game ends | #34c | After max attempts (or player-path rejection while the match runs), the client re-joins as `spectator: true`; `onMatchStart` destroys the running game and boots a fresh one (`makeGame().startNet`) — avoids a second `GameLoop` since `boot()` re-creates the loop. `pendingSpectate` buffering covers the world-not-ready window; withheld spectator broadcasts stay relayed to the player watcher. |
| 3 | **Re-join button** on each LAN match item in the match list | — | Started items render a `.net-actions` div with **Re-join** (`button.rejoin`, green via `makeJoinBtn` → `joinSelectedOrManual`) + the existing **Spectate** (`button.spec`, direct spectator join); waiting items keep a single Join. `btn.disabled`/joining text applied per button. |
| 4 | **Room-full popup** — match already playing + map full → popup with *Back* or *Play as Spectator* | — | Started-and-full rooms refuse joins with "Match already started — no free player slot"; main.ts `onError` matches `/already started/i` while `lobbyState === null` and shows `#roomfull-overlay` (z45): **Back** closes + re-arms `network.status.needCode`; **Play as Spectator** → `connectJoin(..., { spectator: true })`. |

**Verified:** typecheck all 4 workspaces clean; full suite **353 tests / 31 files** green — e2e-host now 12 tests: 4 mid-match-quit tests rewritten for the 12 s grace and a new **"reclaims a disconnected slot via clientId during the grace window"** test (drops ws, asserts no game-over/forfeit, reconnects same clientId, waits `S_SPECTATE_SYNC`, asserts the match continues); full `npm run build` green (`host/dist/host.js` rebuilt — e2e re-run against the new bundle). i18n en/ar (`rejoin`, `roomFull*`, `status.reconnecting/reconnected/spectating`, `game.reconnected`).

**Touch points:** `main.ts`, `net.ts`, `relay.ts`, `rooms.ts`, `host/src/index.ts`, `Game.ts`, `shared/src/{constants,protocol}.ts`, `index.html`, `styles.css`, i18n en/ar, `tests/e2e-host.test.ts`

---

## Lobby bug — LAN persistence when switching sections (DONE)

While in the lobby LAN match panel, creating/joining a match then switching to another lobby section (e.g. settings) and back returned the player to the first panel (match list) and left the current match's join button stuck disabled with "joining…" even though the join succeeded.

**Root causes (client/src/main.ts):**
- `joinBusy` was set `true` in `connectJoin` and only cleared on error/close, so after a successful join it stayed `true` forever — every `renderNetMatches`/`refreshLobbyTexts` pass re-applied the disabled "joining…" text (`setJoinBusy`, line ~2032).
- `tabNetwork` unconditionally called `setTab('network')`, dropping the player out of the match panel.

**Fixes (client/src/main.ts):**
- `onLobby` now calls `setJoinBusy(false)` so the join state clears as soon as the room is entered.
- `tabNetwork` click now routes to `setTab(lobbyState ? 'match' : 'network')` — the player stays inside their joined match until they press Leave. (Same routing to apply for the online tab later.)

Verified: client typecheck clean.

---

## Day 19 — Offline Modes: Survival + Daily + Campaign (M–L) ✅ DONE

Three offline modes behind a mode-list lobby, plus a custom-scenario UI placeholder.

| # | Feature | Ref | Notes |
|---|---------|-----|-------|
| 1 | **Survival mode** — PvE: escaping waves of enemy units, escalating difficulty, career high score on Profile | #15a | `client/src/modes/survival.ts` new `SurvivalDirector` (grace 10s, configurable wave interval, tier-scaled squads, raider steering). `Game.ts` mode `'survival'`; scripted mode skips replay; `recordSurvivalResult()` persists best wave/score. |
| 2 | **Daily challenge** — fixed seed per UTC day, level-up missions only (no leaderboard) | #15b | `client/src/modes/daily.ts`: 4 deterministic missions evaluated per match; `client/src/profile/modeRecords.ts`: streak + battle-pass XP (`DAILY_XP_PER_LEVEL=100`), seed from `dailySeed(dayKey)`. |
| 3 | **Campaign** — scripted linear chapter: collect troops → rebuild old base → defend → take outposts | #15c | `client/src/modes/campaign.ts`: Chapter 1 "Ashes of the Old Base", fixed deterministic map, `CampaignScript.place()/tick()`, HUD objectives with progress, victory/loss + `recordCampaignResult()`. |
| 4 | **Custom Scenario - UI placeholder** | N6a | Upload button + "coming soon" status; real feature moved to `future_todo.md`. |

**Touch points:** `Game.ts`, `match.ts` (offline modes + configs), `main.ts` (mode-list lobby + per-mode extras), `profile/ui.ts` (mode records at top of Profile), `i18n` (en/ar), `hud.ts` (objective), new `modes/survival.ts`, `modes/daily.ts`, `modes/campaign.ts`, `profile/modeRecords.ts`. Tests: `tests/day19.test.ts` (20). Suite: 373 tests.

---

## Day 20 — Bulldozer Build-Order Queue + Mod Support (S–M) ✅ DONE

Economy QoL + data config. **Re-scoped mid-day:** the base-template idea was replaced
by a bulldozer multi-build-order queue; mod support became a report-then-implement
deliverable (fully shipped by end of day).

| # | Feature | Ref | Notes |
|---|---------|-----|-------|
| 1 | **Bulldozer build-order queue** — busy dozer queues up to `maxBuildOrders` (default 3, dev settings) building orders; placement stays active so clicks append; WorkSystem auto-starts the next order when the current construct completes/cancels | Day20a | `MatchSettings.maxBuildOrders`; `World.buildOrderQueues` (`Map<dozerId, buildingId[]>`), purged in `removeEntity`; `place` accepts a dozer busy with `construct` while `active+queued < maxBuildOrders`, else rejects `'build order queue full'`; `work-system.ts` frees then `startNextQueued`; Game.ts keeps `pendingPlace` active per click and drops out on a full queue. Deep-fix: `workArrivePoint` only picks build pads in the dozer's passable component (+ working dozers no longer skip separation from *other* buildings) so a merely-blocked route rounds the obstruction instead of falling back to build-from-far; boxed-in test keeps the time fallback as a last resort. Tests: queue/auto-start/stop/full/cleanup. |
| 2 | **JSON balance mods — shipped** | #37a | **Implemented + shipped** (originally report-only; the report `docs/10-MOD-SUPPORT-REPORT.md` preceded the full implementation). Probe schema rides on the override-aware accessors (`getBuilding/getUnit/getWeapon/getUpgrade`) + `SANITIZE`. Delivered: protocol 19, host `ModStore` + `sanitize.ts` + room wiring, client Mods tab (choose/abandon + dev-export picker), 292 balanced entries. Tests: `tests/mods.test.ts`. |

**Touch points:** `constants.ts`, `rooms.ts`, `world.ts` (buildOrderQueues, removeEntity),
`input-system.ts` (place/stop), `work-system.ts` (component-aware pads, startNextQueued),
`movement-system.ts` (separation exemption), `Game.ts` (placement UX + toasts), `events.ts`,
i18n, `tests/construction.test.ts`

### Day 20 verification
- `npm run typecheck` (4 workspaces) — pass
- `npm test` — 393 pass (33 files), incl. queue tests + boxed-in regression + mods suite
- `npm run build` — pass; `npm run lint` — only pre-existing untracked `.js` no-undef + untouched test warnings
- Shipped as commits `d244100` (Day 19 follow-up) → `87a4c8f` (Day 20 queue) → `ebcfada` (Day 20 balance mods)

---

## Day 21 — Military Tactics: Auto-Fire Toggle + Formations (M) ✅ DONE

Input + move + combat stance.

| # | Feature | Ref | Notes |
|---|---------|-----|-------|
| 1 | **Auto-fire toggle** — units that can attack already have guard  stance, so no "hold position" stance needed. Instead: a toggle for **auto-fire at in-range enemies**, default ON (all units attack when an enemy enters fire range). OFF makes idle units passive (they still fire when explicitly ordered / while guard / attack-move / keep-attack). | N3a | `AttackComp.autoFire: boolean` (default true). New SimCommand `set-auto-fire { entities, autoFire }`. `combat-system.ts` idle auto-acquire skipped when `autoFire === false`. HUD **toggle button placed next to Guard** in the selection bar. |
| 2 | **Multi-unit formations** — formation slots apply to any multi-selection (troop *or* vehicle), with **Loose (1.5×)/Tight (0.7×)** density, plus **Hold Current Position**: after commanding a move, units keep the *same relative layout* they had at selection time (offsets from the group centroid are preserved at the destination). | N3b | `UnitComp.formationSpread: 0.7 \| 1 \| 1.5` + `UnitComp.relativeFormation: boolean`. New SimCommand `set-formation { entities, spreadCode, relative }`. `Game.issueMoveCommand` (client): per-unit grid slots scaled by each unit's spread; relative units target `dest + (ownPos − centroid)`. Sim-side `formationSlots` (guard + attack-ground) scaled by spread. HUD: Hold Formation toggle + Tight/Loose density toggles (shown for ≥2 movable owned ground units). |

**Touch points:** `protocol.ts`, `world.ts` (comps), `combat-system.ts`, `input-system.ts`
(commands + formationSlots), `Game.ts` (issueMoveCommand + actions), `hud.ts`, `transport-system.ts`
(snapshot), `factories.ts`, i18n, `tests/day21.test.ts`

### Day 21 verification
- `npm run typecheck` (4 workspaces) — pass
- `npm test` — 400 pass (34 files), incl. new auto-fire/formation/protocol tests
- `npm run build` — pass (host rebuilt: bundled PROTOCOL_VERSION must match for the mods e2e); lint — clean on changed files
- Auto-fire gates BOTH idle auto-acquire and the hit-retaliation reflex (`applyDamage`) when OFF; guard/attack-move/keep-attack stays explicit.
- Formation spread (0.7/1/1.5) scales move + guard grid slots per unit; relative affordance keeps each unit's centroid offset at the new destination.

---

## Day 22 — Supply Field Capture Bonus (M)

Holding a supply field with a scout grants the holder's team a harvest bonus. Capture is non-exclusive: enemy harvesters still take **base** supply from the field — only the holding team's harvesters earn the bonus.

| # | Feature | Ref | Notes |
|---|---------|-----|-------|
| 1 | **Scout-captured supply fields** — a team that leaves a scout near a supply field captures it; its harvesters bank `supplyPerTrip × (1 + bonus%)` per trip, everyone else banks base only. | N2c | `SupplyFieldComp` gains `capturer / captureTicks / capturingScout / holdTicks`. New **`supply-capture-system.ts`** (registered after OilSystem) mirrors the oil-claim pattern: nearest live scout within `radius+1.5` cells of the field center captures after `supplyFieldClaimTicks`; switching target or losing the scout resets progress; a captured field whose scout stays away for `supplyFieldHoldTicks` releases the bonus. `economy-system.ts` unload path applies the bonus for the capturing team; `supply-harvested` event now carries the bonus amount + field id (toast shows "+X (+Y bonus)"). |
| 2 | **Bonus % in dev settings (eco section)** | — | `MatchSettings.supplyFieldBonus` (percent), `supplyFieldClaimTicks`, `supplyFieldHoldTicks` — named defaults `SUPPLY_FIELD_BONUS` (25) / `SUPPLY_FIELD_CLAIM_TICKS` (20 s) / `SUPPLY_FIELD_HOLD_TICKS` (10 s) in `shared/constants.ts`; `DEV_SCALAR_SECTIONS` economy group (main.ts), host `SANITIZE`, i18n en/ar (`dev.fields.supplyField*`). |

**Touch points:** `constants.ts`, `sanitize.ts`, `world.ts` (comp), `supply-capture-system.ts` (new), `registry.ts`, `economy-system.ts`, `events.ts`, `Game.ts` (announce), i18n, `tests/day22.test.ts`

### Day 22 verification
- `npm run typecheck` (4 workspaces) — pass
- `npm test` — 408 pass (35 files), incl. 8 new capture/bonus/determinism tests; existing economy/oil suites still green
- `npm run build` — pass; lint — clean on changed files
- Capture mirrors the oil-claim flow (`supplyFieldClaimTicks` to flip, resets on target switch / scout loss) plus a `supplyFieldHoldTicks` grace before the bonus drops.
- Non-exclusive by design: enemy harvesters always take base `supplyPerTrip`; only the holder's trips add the bonus (event + toast show the bonus amount).
- Docs: `02-MECHANICS-SPECIFICATION.md` §4.1 updated with the capture-bonus rules.

---

## Day 24 — UI/Replay/Asset QoL (M)

Client-side polish: capture feedback, UI scaling, vector-sprite scaling, bunker assets, sprite-layer tuning, and manual replay saving. No sim or wire changes.

| # | Feature | Ref | Notes |
|---|---------|-----|-------|
| 1 | **Capture blip on supply fields** — the ownership dot blinks while a field is mid-capture or mid-hold-release, so an in-progress flip is visible even before it completes. | A | `renderer.ts` `syncFields`: the supply icon's filled dot renders gray (`0x888888`) on alternate 16-tick phases while `capturingScout ≠ 0 && owner ≠ capturer` (blink from the sim `world.tick`, so all clients blink in lockstep); solid team color otherwise. |
| 2 | **UI scale setting** — whole game UI resizable in Settings → Graphics, default 0.8 (≈ browser zoom). | B | `GraphicsSettings.uiScale` (0.5–1.5, `DEFAULT_UI_SCALE = 0.8`) with load clamp; `setUiScale(v)`; `graphics-settings.ts` table row + `applyUiScale()` sets CSS `zoom` on every top-level game-UI container — `#hud` (covers all in-match panels, incl. menu/dev/confirm/selection which live inside it), `#cinematic-overlay`, `#results-overlay`, `#groups-overlay`, `#countdown-overlay`, `#reconnect-overlay`, `#roomfull-overlay`, `#lobby` (covers settings + map builder + net dialogs), `#create-overlay`, `#invite-overlay`, `#controls-overlay`, `#controls-info-overlay`, `#err-box`. i18n en/ar (`settings.graphics.uiScale`/`uiScaleDesc`). |
| 3 | **Unit-scale dev scalar hits vector sprites** — previously only building/vehicle image assets were scaled by `dev.fields.unitScale`; now the same scalar scales troop/vehicle vector shapes too. | C | `renderer.ts` `syncSprite` `else if (kind === 'unit')` branch applies `mult` to the sprite's `scale`. `dev.fields.unitScale.desc` text updated in en/ar to mention vector shapes. |
| 4 | **Bunker sprite assets** — the bunker renders its separate baked image set via the dev asset path, not a shared/factory shape. | D | `BUILDING_ASSET_FOLDERS` in `graphics.ts` gains `bunker: 'bn'`, matching the existing `bunker: 'bn'` in `building-sprites.ts` `FOLDERS` — so `client/dist/bn/…` images are selected automatically. |
| 5 | **Sprite-layer z-order tuning** — every render layer can be re-ordered (border/troop/vehicle/building/effect) from Dev settings; base zones (ground/shadow/team/overlay/debug) stay pinned below/above. | E | `GraphicsSettings.spriteLayerOrder` (per-kind int, clamped −50..50; defaults border 0 / troop 1 / vehicle 2 / building 3 / effect 4) + `setSpriteLayerOrder(kind, v)`; `renderer.ts` splits the old `entityLayer` into `troopLayer`/`vehicleLayer`/`buildingLayer` with `baseEntityLayer(kind, cls)`, sets explicit `zIndex` bands (`FIXED_Z_GROUND -80 / FIXED_Z_FOG -60 / FIXED_Z_SHADOW -40 / FIXED_Z_TEAM -20 / FIXED_Z_OVERLAY 50 / FIXED_Z_DEBUG 1000`, all offset by `0 − min(order)`), enables `worldLayer.sortableChildren` + `sortChildren()`, and live re-applies when the signature changes (checked each `render()`); `main.ts` dev section `layerOrder` with per-kind number inputs; i18n `dev.sections.layerOrder` + `dev.fields.spriteLayer.*`. |
| 6 | **Manual replay saving** — offline replays are no longer auto-archived on quit or game-over; a "Save Replay" button on the pause and results popups saves on demand (one time, then hides). | F | Removed the auto-save call from `onMenuQuitClick` and the offline branch of the `game-over` handler. New `#menu-save-replay` + `#results-save-replay` buttons in `index.html`; `canSaveReplay()` (offline + `recordTicks > 0` + not yet recorded) gates visibility on overlay open, and both handlers call the existing `saveOfflineReplay(winner)` — pause saves `null`, results saves the stored `resultsWinner`. i18n en/ar `menu.saveReplay`. Net-host auto-archive is untouched. |
| 7 | **Every asset gets size + offset sliders** — the dev-settings asset/graphics sliders now cover position (offset) as well as size for every world-drawn asset kind, re-checking buildings/units/fields/obstacles/fx. | G | Buildings already had both (`buildingFill` + `buildingOffset`). New in `graphics.ts`: `unitOffset` (per class, `DEFAULT_UNIT_OFFSET` all 0 — mirrored alongside the existing `unitScale`), `fieldScale` (default 1, next to `fieldOffset`), `obstacleScale` (default 1) + `obstacleOffset` (default 0), `fxOffset` (default 0). Renderer consumption in `renderer.ts`: unit sprites shift `unitOffset * UNIT_SPRITE_WIDTH * mult` in `syncSprite`; field images scale `f.radius * 2 * fieldScale` (supply + oil); obstacle sprites scale by `obstacleScale` and shift by `obstacleOffset * r` (`r = ((w+h)*ISO_HALF_H)/2`) across scenery/mines/wrecks/static-scenery (incl. tree-fall + sell wfx for parity); hit-flash + burning-fire shift by `fxOffset * effectWidthPx`. `main.ts` dev section gains the new number rows; i18n en/ar (`dev.fields.unitOffset.*`, `fieldScale`, `obstacleScale`, `obstacleOffset`, `fxOffset`). |

**Touch points:** `renderer/renderer.ts`, `ui/graphics.ts`, `ui/graphics-settings.ts`, `render/building-sprites.ts`, `render/ground.ts` (ground sprite capture for zIndex), `main.ts` (dev section), `game/Game.ts` (replay buttons), `index.html` (+css), `graphics.ts` (+ renderer) asset size/offset, i18n en/ar

### Day 24 verification
- `npm run typecheck` (4 workspaces) — pass
- `npm test` — 408 pass (35 files)
- `npm run build` — pass; lint — clean on changed files
- The blink phase reads `world.tick` and drops no sim writes — render-only, deterministic across clients.
- `uiScale` uses CSS `zoom` (browser-zoom semantics); sprite-layer bands keep fixed anchor zones above/below the tunable middle so negative order values can't sink under the ground or below the team/overlay elements.
- Replay: still one `ReplayData` upload/export through `persistReplay`; only the *trigger* changed (manual instead of automatic).
- Size/offset additions are render-only and clamped (`obstacleScale`/`fieldScale` 0.1–5; offsets −2..2) — they persist through `graphics.save()`/`load()` and leave the wire protocol untouched.

---

## Day 25 — Second Super Weapon QoL: Rank Gate + Tunables + Bunker Salvos (M)

Feature A: hero-style old-feature rework of the super weapon strike. Feature B: the bunker's firepower now scales with its garrison.

| # | Feature | Ref | Notes |
|---|---------|-----|-------|
| 1 | **Per-weapon dev settings** — airstrike/EMP now have their damage/radius/duration as tunable `MatchSettings` vars (previously only the cooldowns were). | A2 | New `MatchSettings` fields `airstrikeBombDamage` (default `AIRSTRIKE_BOMB_DAMAGE` = 50), `airstrikeBombRadius` (default 3), `empRadiusTiles` (default 8), `empDurationTicks` (default 5 s). Consumers switched off the raw constants: input-system `sw-airstrike`/`sw-emp`, `world.empDurationTicks`, renderer EMP pulse fade (`renderer.ts:937`), Game strike-target preview radius. New dev-settings rows under the existing `superWeapon` section (main.ts) + host `SANITIZE` clamps + i18n en/ar. Render/UI-only defaults stay identical to the old constants, so behavior is unchanged unless tuned. |
| 2 | **Strike countdown shows the strike's own name** — the toolbar `#tool-strike` button under the laser button read the laser's label while on cooldown ("Space Laser (Xs)"). | A1 | `Game.ts updateStrikeButton`: ready → the strike name; on cooldown → `tools.strikeCountdown` `"{name} ({s}s)"` with that strike's label + timer; destroyed/powered-down (no cooldown left) → the name again with an "offline — rebuild" title. New i18n `tools.strikeCountdown` / `tools.strikeCooldown` / `tools.strikeUnavailable` (en/ar). |
| 3 | **Second super weapon unlocks at 1★** — the airstrike/EMP *choice* at the Super Weapon is rank-gated. | A3 | `sw-choose` in input-system rejects below `world.rankOf(player) < 1` (`star rank required — reach 1★…`, checked after the super-weapon/already-armed guards). HUD SW panel buttons show the ★1 `rankBadge` and stay disabled until rank 1. Research upgrades (`airstrike-level`/`emp-level`, req 3★) are separate and untouched. |
| 4 | **Bunker fires one bullet per garrisoned trooper** — a full 5-man bunker lets off a 5-bullet salvo at full damage per bullet (was always 1). | B | `combat-system.ts`: `volleys = garrison.passengers.length` for building turrets (bunker), so each occupied troop fires its own `shot-fired` (full `weapon.damage`). Empty-bunker no-fire rule preserved; turrets (no garrison) unchanged; `currentCooldown` still resets once per volley. |

**Touch points:** `shared/constants.ts` (4 new MatchSettings fields + defaults), `host/src/sanitize.ts`, `client/src/systems/input-system.ts` (rank gate + settings consumers), `client/src/core/world.ts` (`empDurationTicks`), `client/src/render/renderer.ts` (EMP fade), `client/src/game/Game.ts` (strike button + preview radius), `client/src/ui/hud.ts` (SW choice rank badges), `client/src/systems/combat-system.ts` (bunker volleys), `client/src/main.ts` (superWeapon dev fields), i18n en/ar (`dev.fields.*` + `tools.strike*`), `tests/day12.test.ts` (salvo test), `tests/day13.test.ts` + `tests/day15.test.ts` (`arm()` rank helpers + new rank-gate test)

### Day 25 verification
- `npm run typecheck` (4 workspaces) — pass
- `npm test` — 410 pass (35 files), incl. new bunker-salvo + sw-choose rank-gate tests; day13/day15 SW suites green
- `npm run build` — pass; lint — clean on changed files
- Settings additions are additive `MatchSettings` fields (no new command ids / wire types) → `PROTOCOL_VERSION` stays 20.
- Bunker salvo and the rank gate are sim-deterministic (no RNG or clock added; extra `fire` calls consume the same seeded RNG on every client).
- New tunables default to the exact old constant values, so balance is unchanged until the dev panel is used.

---

## Day 26 — Rank menu UI rework + automatic rank-up (S)

The rank side menu was rebuilt (star icon → title + info column → locked/unlocked state) and promotion no longer needs a button — it happens the moment the score crosses a floor.

| # | Feature | Ref | Notes |
|---|---------|-----|-------|
| 1 | **Auto rank-up on score** — hitting a star floor promotes instantly, everywhere (players and bots), with the prize granted exactly once. | A | `world.awardScore` now calls `while (this.canRankUp(team)) this.rankUp(team)`. Deterministic (score grants are sim events), so all clients agree; the manual `rank-up` command remains in the protocol as a rejected no-op (replays still end in the same state). |
| 2 | **Rank tier rows rebuilt** — every star gets a left icon + a left-aligned column (title over info) + a locked/unlocked badge. | B | `renderRankOverlay` builds each row as `rank-tier` → `rank-tier-stars` + `rank-tier-copy` (`rank-tier-title` + `rank-tier-info`, flex column) + `rank-tier-state`. The old "Rank Up!" footer button, its `onRankUp` action, and the `hud.rankUpReady/rankUpWait` keys were removed. |

**Touch points:** `client/src/core/world.ts` (auto promote in `awardScore`), `client/src/ui/hud.ts` (overlay rows + dropped button/action), `client/src/game/Game.ts` (dropped `onRankUp` action), `client/index.html` (removed `#rank-up-btn`), `client/src/styles.css` (rank-tier layout), i18n en/ar (`rankUpReady`/`rankUpWait` removed), `tests/day15.test.ts` + `tests/day16.test.ts` (rank ladder now expects automatic promotion)

### Day 26 verification
- `npm run typecheck` (4 workspaces) — pass
- `npm test` — all pass (rank ladder/day16-coop tests updated for automatic promotion)
- `npm run build` — pass; lint — clean on changed files
- Auto rank-up is sim-deterministic (score grants are deterministic sim events → the pending `rank-up` command becomes a harmless rejection in replays).

---

## Day 27 — Sea Army: naval units + dock production ✅ (M)

First naval layer: two ships (troop-transport Carrier, fast Missile Boat) and a shoreline-producing Dock. Naval units only sail on open water; everyone can hit them; sea missiles explode with a splash but never touch aircraft.

| # | Feature | Ref | Notes |
|---|---------|-----|-------|
| 1 | **Naval movement on water** — new `naval` unit class that stands on `Terrain.Water`. | A | `world.ts` gained a water grid: `grid.water` mask + `waterComponent` weights, sharing the existing `hardBlocked` grid. Pathfinding picks the mask per unit (`resolveMask`), movement-system resolves every step/target/stuck/separation against the water mask (a ship crossing a road/bridge cell just contours back into the lake), and input-system `resolveMovePoint` snaps target points to the nearest water (fallback `nearestPassablePoint` else raw coords). Formation/A-move and `pickEntity` include naval (radius 1.3). |
| 2 | **Dock — shoreline production building** — naval producer. | B | `input-system` placement requires every footprint tile buildable land AND at least one tile edge-adjacent to open water (4 edges only; else `'dock needs water access'`). `production-system.findSpawnTile` auto-puts a trained ship on the nearest water tile in the spawn clamp ring (r ≤ 5, Chebyshev, first match) and `set-spawn-point` is confined to that water ring. |
| 3 | **Carrier + Missile Boat units.** | C | Carrier: $600/35 s/HP 900/speed 55/vision 8, unarmed, `transportCapacity 12` — infantry-only boarding; unload is pushed to the nearest land tile (`resolveUnloadPoint`), so transports need no carrier-specific pathing. Missile Boat: $350/20 s/HP 320/speed 80/vision 8, `sea-missile`. `sea-missile`: dmg 60, cooldown 40 t, range 9, splash 1.5, no `targetsAir` — aircraft are immune by design. Everything else can hit ships (`pickTarget`/`fire`/`splashDamage` only skip `'air'`). |
| 4 | **Render / UI wiring.** | D | Sprite folders `v_c` / `v_mb` + `d` (dock); renderer treats naval like vehicle at hover radius, sync-bar offset, `big` shadow, burns, place surfacing and bar offsets/outlines; low + medium shapes for both ships and the dock; hud buildables + dev class tuning (scale/offset) include naval; game-info-catalog rows appear automatically via `UNIT_IDS`/`BUILDINGS`. i18n en/ar: `units.class.naval`, `units.role.carrier/missile-boat`, `names.dock/carrier/missile-boat`, and `dev.fields.unitScale/unitOffset.naval` labels. |

**Deliberate decisions:** naval is NOT stealth-eligible (stealth stays infantry/vehicle-only, matching Day 9 philosophy); bots are untouched by design (they would just fail to place a dock and skip it); map-builder needs no changes (pure terrain).

**Touch points:** `shared/src/balance/units.ts` `buildings.ts` `weapons.ts`, `client/src/core/world.ts` (water masks), `client/src/systems/pathfinding-system.ts` `movement-system.ts` `input-system.ts` `production-system.ts` `combat-system.ts` `profile/recorder.ts`, `client/src/game/Game.ts` (PRODUCERS, pickEntity), `client/src/render/renderer.ts` `building-sprites.ts` `shapes.ts`, `client/src/ui/graphics.ts` `hud.ts`, `client/src/main.ts`, i18n en/ar, `tests/sea-army.test.ts` (12 tests)

### Day 27 verification
- `npm run typecheck` (4 workspaces) — pass
- `npm test` — 422 pass (36 files), incl. new `tests/sea-army.test.ts`; `e2e-host.test.ts` is flaky only when the whole file runs under load (its `startHost()` waitForHttp hiccups; all 3 affected tests pass in isolation and the built `host/dist/host.js` boots + answers HTTP 200 standalone)
- `npm run lint` — no new issues on changed files (remaining errors are pre-existing: untracked `.js` transpiles and untouched `tests/day14.test.ts` unused imports)
- `npm run build` — pass; en/ar.json parse clean
- Naval logic is sim-deterministic (no RNG/clock added; the two new balances are static defs) — `PROTOCOL_VERSION` stays 20.

---

## Day 28 — Sound FX generation ✅ (S, No)

First file-based SFX set: a deterministic WAV bakery plus 39 generated files covering every
sound kind, and one runtime fix so the baked envelopes actually play.

| # | Feature | Ref | Notes |
|---|---------|-----|-------|
| 1 | **`scripts/synth-fx.mjs` — deterministic WAV bakery** | A | Seeded PRNG + phase-accumulator oscillators + shaped noise with attack/release envelopes, exponential sweeps and tremolo; RIFF PCM-16 writer that self-verifies headers. Recipes for all 21 `SOUND_IDS` (with shuffle variants), 44.1 kHz one-shots / 22.05 kHz ambience; per-file normalization (~ −1 dBFS) with soft-clip. Seed-fixed ⇒ identical bytes every run. |
| 2 | **Generated assets** | B | `client/dist/sound/<id>/v1…vN.wav` — 39 files, 8.9 MB total. The host serves `client/dist` as its static root, so the existing `AudioHooks` variant probe (`v1.wav, v2.wav, …`) picks them up; `vite build` preserves them (`emptyOutDir: false`). Enabled per kind via **Dev settings → Audio** override = `sound/<id>/`. |
| 3 | **Runtime envelope fix** | C | `hooks.ts playAsset` used to exponential-ramp gain to ~0.0001 **across the entire file duration**, which would destroy any baked envelope (long lasers/booms/arpeggios fell silent by their midpoint). Now holds the play volume and fades only the final 50 ms of each file. Ambient was already fine (its own 0.5 s crossfade). |

**Note:** `opts.pitch` (class select-bleep, game-over win/lose) is runtime-only and never
scaled file playback before or after this change — file-based sounds play at baked pitch.

**Touch points:** `scripts/synth-fx.mjs` (new), `client/dist/sound/*` (generated), `client/src/audio/hooks.ts` (playAsset fade), `package.json` (`synth:fx` script), `docs/11-SOUND-FX-GENERATION.md`

### Day 28 verification
- `npm run typecheck -w client` — pass; `npm run build -w client` — pass; `dist/sound` intact (39 files / 21 kinds) after build
- WAV headers verified byte-level by the tool (RIFF/WAVE + chunk sizes); output is deterministic and normalized
- Awaiting **human listening test** — enable per kind in Dev settings → Audio (override `sound/<id>/`); regenerate anytime with `npm run synth:fx`

## Day 29 — Audio diagnostics + tuning + playable generated SFX (S, No)

Dev-settings audio instrumentation and the debugging of "generated SFX silent while ambient
plays": the generated WAVs were proven valid and decodable in a real browser, and the dev
panel now splits the remaining possibilities into a visible diagnosis.

| # | Feature | Ref | Notes |
|---|---------|-----|-------|
| 1 | **Headless decode proof** | A | Generated WAVs fetched **from the live host** and decoded in headless Chrome via CDP: `select`/`weapon-rocket`/`ambient-lobby` all `decodeAudioData` OK (correct durations/sample rates). File side is NOT the failure. |
| 2 | **Silent-null trap fix** | B | `playAsset`: when `fetchBuffer` returns null (decode failure swallowed), it silently returned — now falls back to the built-in `synthSfx` so a kind can never be unconditionally silent. |
| 3 | **`diagnose(kind)`** | C | `hooks.ts`: resolves ctx state, effective fx volume, current override, resolved URLs, then fetch+decode of the first file. Rendered by the dev **Play** button status bar and `console.warn('[audio diagnose] …')`. |
| 4 | **`ping()` + Ping button** | D | Bare 880 Hz square tone straight through the master gain (no files/tuning) — proves the AudioContext + speakers independently of the file path; added as the first row of Dev settings → Audio. |
| 5 | **Per-sound tuning + quick pathing** | E | Volume (0–4) & pitch (0.25–4) inputs per sound kind persist to `AudioSettings.tuning`; Play preview forces gain 1 + no positional falloff; **Use generated** / **Synth** buttons set/clear `sound/<id>/`. Both i18n (en/ar). |
| 6 | **Probe-free resolution (no 404 noise)** | F | `scripts/synth-fx.mjs` writes `sound/manifest.json` (variant counts); `overrideUrls` resolves variants by count instead of HEAD-probing to a 404, so the console stays clean. |

**Touch points:** `client/src/audio/hooks.ts`, `client/src/audio/settings.ts`, `client/src/main.ts`,
`scripts/synth-fx.mjs`, `client/src/i18n/lang/{en,ar}.json`, `client/dist/sound/manifest.json`

### Day 29 verification
- Headless Chrome (x64) + CDP against `http://127.0.0.1:17321` — all sampled WAVs fetch+decode OK
- `npm run typecheck -w client` — pass; `npm run build -w client` — pass; `dist/sound` 40 files intact after build
- Remaining variable is **per-machine runtime state** (fx volume, muted, OS speakers, autoplay): the Ping button + Play-button diagnosis now pinpoint which

---

## Day 30 — Weather: looping ambient sounds + full-screen overlay fix (S, No)

The Weather feature gained per-weather looping ambient audio paths in the dev-settings
(Audio → Weather) and the in-match overlay scale bug (small box in the top-left corner
instead of full-screen) was fixed.

| # | Feature | Ref | Notes |
|---|---------|-----|-------|
| 1 | Weather ambient ids in dev settings | A | `rain-ambient` / `snow-ambient` / `storm-ambient` added to `SOUND_IDS`; a new "Weather ambient (looping)" group renders the 3 rows (override path + use-generated/synth + tune + Play preview via `AMBIENT_SYNTH`), i18n en/ar. |
| 2 | Two-layer ambient in `AudioHooks` | B | Main layer (lobby/in-match) + new weather layer refactored to shared `AmbientState` / `buildLayer` / `playNextFile` / `stopLayer`; exported `AMBIENT_SYNTH` drone map; new `startWeatherAmbient(weather)` maps rain/snow/thunder → `*-ambient` ids and `none` stops the layer. The weather layer is gated by `ambientInMatchVolume()` (obey mute + ambient-layer toggle + in-match slider) and layers **over** the game drone; `stopAmbient()` stops both layers. |
| 3 | Full-screen overlay fix | C | `WeatherOverlay` was appended inside `#hud`, which gets `zoom` = UI scale (default 0.8) → `window.innerWidth`-sized canvas rendered ~80% anchored top-left. Moved to `#app` (unzoomed, 100%×100%) with `z-index: 11` (above `#hud` z10; below chat 35 / dev 38 / menu 40 — same global layering as before). |
| 4 | In-match wiring | D | `Game.start`: `this.audio.startWeatherAmbient(getGraphics().weather)` right after `setWeather`; weather is fixed at match config so one call at start suffices. |

**Touch points:** `client/src/audio/hooks.ts`, `client/src/audio/settings.ts`,
`client/src/main.ts`, `client/src/game/Game.ts`, `client/src/render/weather.ts`,
`client/src/i18n/lang/{en,ar}.json`

### Day 30 verification
- `npm run typecheck -w client` — pass; `npm run build -w client` — pass (bundle `index-BGH3k2CD.js`)
- `client/dist/sound` 46 files (45 WAVs + manifest) intact after build; weather audio baked: `rain-ambient`/`snow-ambient`/`storm-ambient` × 2 variants each, 45 s loops @ 22.05 kHz (rain = steady hiss + drip plinks, snow = soft airy hiss with slow swell, storm = rain bed + gust swells + 4 rumble bursts clear of the loop seam)
- Awaiting **human check**: overlay now covers the full screen; weather ambience in-match obeys the Ambient toggle + in-match slider

---

## Day 31 — Real CC0 sounds for all 24 kinds (S, No)

Replaced the synth-generated WAVs in `client/dist/sound` with real recorded sounds fetched from
Freesound (all **CC0**), matching each kind's manifest counts.

| # | Feature | Ref | Notes |
|---|---------|-----|-------|
| 1 | Freesound fetch pipeline | A | New `scripts/fetch-freesound.mjs`: searches the Freesound API (CC0 only, duration-filtered, name-keyword scoring), downloads HQ previews, converts via ffmpeg to mono PCM (44.1 kHz SFX / 22.05 kHz ambients, `loudnorm` matched), writes `v{n}.wav` per kind, updates `manifest.json`, and keeps `CREDITS.md` (merged across runs). Key read from `FREESOUND_TOKEN` env only — never stored. |
| 2 | All 24 kinds populated | B | 45 WAVs: SFX from click/blip/gun/cannon/powerup/impact/boom/zap/fail/chime sources; ambiences from genuine loop recordings (space, battlefield, rain, wind, rain+thunder). Every soundtracked entry credited in `client/dist/sound/CREDITS.md`. |
| 3 | Sample-rate guarantees | C | SFX at 44.1 kHz mono, ambients at 22.05 kHz mono; verified with `ffprobe`; `manifest.json` regenerated to match disk (24 kinds / 45 variants). |

**Touch points:** `scripts/fetch-freesound.mjs`, `client/dist/sound/*` (45 WAVs +
`manifest.json` + `CREDITS.md`)

### Day 31 verification
- All 24 kinds present, manifest counts == actual `v{n}.wav` files; spot-checked rates/channels (`44.1 kHz mono` sfx / `22.05 kHz mono` ambient) and durations via `ffprobe`
- No build step needed (static assets); `.tmp` removed
- **Note:** like `ambient-lobby`/`ambient-game`, real sounds play once the override path is set (Dev settings → Audio → "Use generated" fills `sound/<id>/`); empty override = built-in synth fallback

---

## Day 32 — Auditionable sound variants: 12 per kind + batch fetch (S, No)

Bumped every sound kind from 1–2 real files to **12 variants** so each sound can be auditioned and swapped, keeping the war/sci-fi sound-pack style.

| # | Feature | Ref | Notes |
|---|---------|-----|-------|
| 1 | Batch variant fetch pipeline | A | New `scripts/fetch-freesound-many.mjs`: tops up each kind to `TARGET = 12` (keeps existing `v*.wav`), searches two stylized queries per kind (primary + alt) with name-keyword scoring, melodic-flag (skip instrument penalties) and loop-bonus (`+2`) rules, CC0 + duration filters, then downloads/ffmpeg-converts to mono (`44.1 kHz` SFX / `22.05 kHz` ambients, `loudnorm`), retrying bad downloads once. Merges `manifest.json` (count per kind) and `CREDITS.md`; `ONLY <kind>` argv filter for targeted re-runs. Key still `FREESOUND_TOKEN` env only. |
| 2 | All 24 kinds → 12 variants | B | Third-pass tuned the thin pools (`sonar ping`, `mouse click keyboard`, `level up sound`, `hammer sound`, `power down`, …) and one-off filled the only gap (`power-down/v6`, id 159399). Result: **288 WAVs** (24 × 12), `manifest.json` == disk for every kind. |
| 3 | Variant audition selector | C | Dev panel Audio rows got a variant `<select>` (`dev-audio-variant`) between Play and the override input. Lists the override's files via `availableSounds(id)` (manifest count → `v1..vN`) — for SFX kinds only; ambiences keep the ~4 s layer preview. Play with a variant selected calls the new public `hooks.ts` `playAudition(kind, url)` (route alias `playAsset` gain 1, synth fallback); Auto = shuffled play like in-game. i18n `dev.fields.audioVariant` added in en + ar; CSS matches `.dev-audio-btn`. |

**Touch points:** `scripts/fetch-freesound-many.mjs`, `client/dist/sound/*` (288 WAVs + `manifest.json` + `CREDITS.md`), `client/src/audio/hooks.ts` (`playAudition`), `client/src/main.ts` (`audioRow` variant select), `client/src/i18n/lang/en.json` + `ar.json`, `client/src/styles.css`

### Day 32 verification
- All 24 kinds at `12/12`; `manifest.json` counts == files on disk (288), verified by script
- Spot-checked `ffprobe`: SFX `44100,1` mono, ambients `22050,1` mono, sane durations; only strays would be `.tmp` (removed)
- `npm run typecheck -w client` + `npm run build -w client` clean; `eslint` clean on touched files; built bundle contains `playAudition` / `dev-audio-variant` / `audioVariant`
- `vite build` keeps `dist/sound` (emptyOutDir: false) — 288 WAVs intact after rebuild

---

## Day 33 — Variant selection by existing files + match-victory sound (S, No)

Follow-up to Day 32: the in-game random picker must only play variants the player chose to keep, and a win must sound different from a loss.

| # | Feature | Ref | Notes |
|---|---------|-----|-------|
| 1 | Random picker plays only existing files | A | The dev-audio variant `<select>` was removed (no per-sound menu). Instead `hooks.ts` `overrideUrls` treats `manifest.json` as an upper-bound hint and probes each `v1..vN` with HEAD, returning only files that exist (gaps allowed, cached per override value per session). Deleting `client/dist/sound/<kind>/v*.wav` drops it from the shuffle deck immediately; keeping none falls back to the synth. So keeping only `select/v8.wav` → only v8 can be chosen. |
| 2 | Match-victory sound kind | B | New `victory` in `SOUND_IDS` (`settings.ts`), dev Audio → Events row, i18n label `dev.audio.victory` (en "Match victory" / ar "فوز المباراة"), synth fallback = ascending triangle arpeggio (C5-E5-G5-C6). On `game-over` the win/loss/draw sound now plays from `Game.ts` (knows `localTeam`): win → `victory`, loss → `game-over` (full pitch), draw → `game-over` (0.5 pitch); the old one-sound-for-all case was removed from `hooks.onEvent`. |
| 3 | 12 victory variants fetched | C | `fetch-freesound-many.mjs` gained the `victory` entry (fanfare/trumpet-RPG, CC0, melodic) → 12 WAVs in `client/dist/sound/victory/`, manifest + CREDITS updated. |

**Touch points:** `client/src/audio/hooks.ts` (`overrideUrls`→`existingFiles` probe, removed `playAudition`), `client/src/main.ts` (removed variant select, victory row), `client/src/game/Game.ts` (win/loss/draw sfx), `client/src/audio/settings.ts`, `client/src/i18n/lang/en.json` + `ar.json`, `scripts/fetch-freesound-many.mjs`, `client/dist/sound/victory/*`

### Day 33 verification
- `npm run typecheck -w client`, `eslint` (touched files), `npm run build -w client` all clean
- Current bundle: `playAudition`/`dev-audio-variant`/`audioVariant` absent; `Match victory` + Arabic label present; probe code minified in
- The player's surviving files (e.g. `select/v8.wav` only) are intact after build — sound dir not wiped (emptyOutDir: false); FEEDBACK: many kinds now hold 1 (or 0) user-kept variants, `bomb-strike`/`emp-strike`/`victory` still 12 — re-fetch or re-trim as desired
- **Note:** `manifest.json` counts now mean "pool size fetched", not "files present" — the client probes reality at runtime

---

## Day 34 — Missing-sound fixes (emp/airstrike/grenade/smoke) + rank-up toast text (S, No)

FEEDBACK: some in-game parts had no sound (emp, airstrike hit, grenade, smoke), and the golden/slide-in rank-up toast carried the wrong header text (it said "Achievement unlocked").

| # | Feature | Ref | Notes |
|---|---------|-----|-------|
| 1 | New sound kinds | A | Added `airstrike-called` (incoming flyover whistle), `grenade-exploded` (crunchy blast), `smoke-landed` (soft poof) to `SOUND_IDS` (`settings.ts`) + dev Audio → Events rows (`main.ts`) + i18n `dev.audio.*` labels (en/ar). 12 real CC0 variants each fetched into `client/dist/sound/` (airstrike-called 11 after deleting one dup id 623015 twice-picked; manifest patched to 11). |
| 2 | Event → sound wiring | B | `hooks.ts onEvent`: `airstrike-called` → flyover whistle (positional), `airstrike-bomb` now positional + louder (`bomb-strike` 0.1), `emp-strike` positional + louder (0.09) + meatier synth (sawtooth sweep 100→40), new `grenade-exploded` positional synth (square sweep 240→70 + saw). |
| 3 | Smoke landing sound | C | No sim event exists for smoke landing; added client-only `announceSmokeLandings()` in `Game.ts` (new `announcedSmokes` set) that plays `smoke-landed` at the canister position on `tick >= landTick`, pruning ids as clouds clear. No protocol/hash change. |
| 4 | Rank-up toast text | D | `hud.ts` `achievementToast` gained an optional `header` (defaults to `profile.toastTitle`); `Game.ts` passes new `game.rankUpHeader` ("Rank up!" / "ترقية الرتبة!") so rank-ups no longer show "Achievement unlocked". |

**Touch points:** `client/src/audio/hooks.ts`, `client/src/audio/settings.ts`, `client/src/game/Game.ts`, `client/src/ui/hud.ts`, `client/src/main.ts`, `client/src/i18n/lang/en.json` + `ar.json`, `scripts/fetch-freesound-many.mjs`, `client/dist/sound/{airstrike-called,grenade-exploded,smoke-landed}/*`

### Day 34 verification
- `npm run typecheck -w client` clean; `npm run build -w client` built in 12s; new ids + `rankUpHeader` + en/ar labels present in current bundle
- ffprobe spot checks: new WAVs are 44100 Hz mono pcm_s16le; manifest == files (airstrike-called 11, grenade-exploded 12, smoke-landed 12)
- eslint repo-wide fails on pre-existing browser-global `no-undef` noise (config lacks env — unrelated to these changes; no new unused-var errors in touched files)
- **Note:** smoke landing sound is client-only (no sim event → no `SimCommand`/hash/PROTOCOL change needed)

---

## Day 35 — Online server Phase 1: single-repo + multi-room server + live lobby panel (M, No)

DECISION (user): **one GitHub repo** `space-arenas` (pushed to `https://github.com/SDevRami/space-arenas.git`). The online server + DB live in the self-contained `online/` subfolder; Render/Supabase connect to the same repo (Render `rootDir: online`, Supabase migrations dir `online/supabase`). NO server-side bots and NO balance mods in online matches in Phase 1 (sim + bot AI are client code; the server returns a clear "not supported online yet" error). `online_todo.md` rewritten to match.

| # | Feature | Notes |
|---|---------|-------|
| 1 | Workspaces + deploy file | `online` added to root `package.json` workspaces; `render.yaml` moved to **repo root** with `rootDir: online`, healthcheck `/api/status`, auto-HTTPS/wss, `sync:false` secrets; `online/.gitignore` + `.env.example` |
| 2 | Server port | `online/src/passphrase.ts` (newRoomCode/newSeed/hashPassphrase), `sanitize.ts` (whitelist+clamp table, override maps), `rooms.ts` (`RoomRegistry` — `Map<string, Room>` multi-room: create/join/joinSpectator/reconnectPlayer/updateSlot/updateRoomOptions/assignSpawns/removePlayer/disconnectPlayer/hostReady, per-room hostName/timestamps, `modId` rejected unless empty), `relay.ts` (`TickRelay` minus bots), `index.ts` (per-socket room binding, per-room relay `Map<code,TickRelay>`, `C_ADD/UPDATE/REMOVE_BOT` + non-empty `modId` → `H_ERROR 'not supported online yet'`) |
| 3 | REST + runtime switch | `GET /api/status`, `GET /api/rooms`, `GET /api/rooms/search?q=`, `POST /api/rooms` {hostName,password,mapId}, `POST /api/rooms/{code}/join` → `{ok, ws}`; `SA_MODE=online` enables the lobby API else 503 (tests cover both) |
| 4 | Lifecycle | `IDLE_ROOM_TTL` 30 s (REST-created awaiting `C_JOIN`), `EMPTY_ROOM_TTL` 60 s, sweep every 10 s; `RECONNECT_GRACE_MS` 12 s reconnect slots; no bots in `winnerFromRemaining` |
| 5 | Tests | `online/tests/online-server.test.ts` via `tsx --test` (spawns built server): status, create/list/search/join pre-check, 503-disabled, live 2-player ws lobby (`C_JOIN` → `H_LOBBY`), wrong-passphrase reject — **8 passing** |
| 6 | Client lobby panel | `client/index.html` `#online-panel` rebuilt: **My Account** + **Server Setup** buttons, user-name + search bar, live rooms table (Room/Host/Map/Players/Status via `renderOnlineMatches`), Join/Create reusing the LAN create overlay + new password popup (`#joinpass-overlay`); new overlays `#account-overlay` (Phase-2 fields) + `#server-overlay` (status-only: ping `/api/status` green/red dot + DB "Phase 2" indicator); server origin bundled via `VITE_SA_ONLINE_URL` (default `http://127.0.0.1:17321`); no region select |
| 7 | Join/create netcode | `connectJoin` now accepts full `wss://` addresses; create branches to `POST ${ONLINE_URL}/api/rooms` when opened from the online panel; name mirrors bi-directional (`#online-name` ↔ LAN name ↔ `applyProfileName`, localStorage `space-arenas:name`); `setTab('online')` auto-refreshes + 10 s poll while visible |

**Touch points:** `online/src/{index,rooms,relay,sanitize,passphrase}.ts`, `online/tests/online-server.test.ts`, `online/package.json`, root `render.yaml` + `package.json`, `client/src/main.ts`, `client/index.html`, `client/src/styles.css`, `client/src/i18n/lang/{en,ar}.json`, `online_todo.md`

### Day 35 verification
- `npm run typecheck` root (shared/client/host/mapbuilder) clean; `online` typecheck + `esbuild` bundle (81.3 kb) + **8/8 tests pass**
- `npm run build -w client` OK (23.5 s); bundle contains `api/rooms`, overlay ids + default origin; served `dist/index.html` has new panel (region select gone)
- No sim/protocol change → no `SimCommand`/hash/PROTOCOL bump (control messages semantically identical, just routed per-room)
- **Still pending (after deploy):** Render/Supabase dashboard linking, `VITE_SA_ONLINE_URL` set to the Render origin, 2-client online match + reconnect/spectator manual checks

---

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
| 9 | Abilities + stealth | M | Yes | ✅ |
| 10 | Engineer + mines | M | Yes | |
| 11 | APC transport | M | Yes | |
| 12 | Dome + walls + weapon upgrade | M | Yes | |
| 13 | Super weapon variants | M | Yes | |
| 14 | Profile + achievements | M | No | |
| 15 | Rank-up / progression | M | Yes | ✅ |
| 16 | Co-op + shared control | M | Yes | |
| 17 | Replay system | M | No | |
| 18 | Auto-reconnect | M | No | |
| 19 | Survival + scenario | M–L | Yes | |
| 20 | Bulldozer build-order queue (+ mod report) | S–M | Yes | ✅ (mods deferred → report) |
| 21 | Hold position + formations | M | Yes | ✅ |
| 22 | Territory capture (supply) | M | Yes | ✅ |
| 24 | UI/Replay/Asset QoL | M | No | ✅ |
| 25 | Second super weapon QoL (rank gate + tunables + bunker salvos) | M | Yes | ✅ |
| 26 | Rank menu UI rework + automatic rank-up | S | Yes | ✅ |

| 27 | Sea Army: naval units + dock production | M | Yes | ✓ |
| 28 | Sound FX generation (WAV bakery + 39 SFX) | S | No | ✓ |
| 29 | Studio audio diagnostics + tuning + split lobby/in-match ambience | S | No | ✓ |
| 29 | Audio diagnostics + tuning + playable generated SFX | S | No | ✓ |
| 30 | Weather ambient sounds + full-screen overlay fix | S | No | ✓ |
| 31 | Real CC0 sounds for all 24 kinds (Freesound fetch) | S | No | ✓ |
| 32 | 12 auditionable variants per sound + variant audition selector | S | No | ✓ |
| 33 | Variant selection by existing files + match-victory sound | S | No | ✓ |
| 34 | Missing-sound fixes (emp/airstrike/grenade/smoke) + rank-up toast text | S | No | ✓ |
| 35 | Online server Phase 1 (single repo, multi-room server, live lobby panel) | M | No | ✓ |

**Total: ~25 working days**

**Deferred** (see `future_todo.md`): full territory capture game mode, online server Phase 2 (accounts/leaderboard) + first deploy, cloud mods, advanced map builder.
