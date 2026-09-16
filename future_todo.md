# TODO / Work Report

Date: 2026-08-18

This report covers the two new lobby sections and the Settings → Controls panel, and whether the UI fits the existing codebase.

---

## (a) Online Server — lobby panel (placeholder UI)

### What was added
- New lobby sidebar button **Online Server** (`#tab-online`, i18n `lobby.tab.online`) and panel `#online-panel` in `client/index.html`.
- Panel groups inputs into two columns:
  - **Account**: user name, email, password.
  - **Server**: server link (`wss://…`), database link, server region select (auto / EU / NA / Asia / Middle East / Africa / South America / Oceania).
- Action buttons: **Log in**, **Register**, **Change password**, **Connect**, **Refresh**, plus **+ Create match**, **Join selected**, **Clear table**.
- **Current matches** table (`#online-matches-table`) with columns Room / Map / Players / Status, rendered by `renderOnlineMatches()` in `client/src/main.ts`.

### Behaviour
- All account/server/matchmaking buttons are **wire-only placeholders**: they write a "coming soon" status line (`online.planned`) into `#online-status`. No backend logic, networking or database code was added — the inputs document the planned flow.
- **Refresh** re-renders the empty matches table and shows `online.refreshed`; **Clear table** re-renders the empty state.
- i18n keys added to `client/src/i18n/lang/en.json` and `ar.json` under `online.*`.

### Codebase fit
- Reuses the existing panel system exactly: sidebar button + `hidden-panel` div, plus `setTab()` wiring in `client/src/main.ts` (the `'online'` tab was added to the union type at `setTab`).
- Reuses existing CSS vocabulary (`.panel`, `.ghost`, `.hint`, `.status`, `.net-empty`) and adds small scoped styles (`.online-grid`, `.online-acc`, `.online-actions`, `.lobby-table`).
- No real "online server" module existed before, so nothing interacts with the host/NetClient yet. The table is the intended anchor for future matchmaking.

---

## (b) Map Builder — lobby panel (placeholder UI)

### What was added
- New sidebar button **Map Builder** (`#tab-mapbuilder`, i18n `lobby.tab.mapbuilder`) and panel `#mapbuilder-panel`.
- **Maps table** (`#mb-maps-table`): lists every built-in map from `MAP_PRESETS` (`@space-arenas/shared`) — #, Name, Players, Variant, Description. Clicking a row selects it (highlighted); built by `renderMapBuilderTable()` in `client/src/main.ts`.
- Toolbar buttons: **Import**, **Export**, **Refresh**, **Clone selected**, **Edit selected**, **Delete selected**.
- **Refresh** clears the selection and re-renders; all other buttons write a "coming soon" status into `#mb-status` (`mapbuilder.planned`).
- i18n keys added to en/ar under `mapbuilder.*`.

### Codebase fit
- Fully driven by existing `MAP_PRESETS`, `t()`/`tn()` and `maps.<id>.desc` translation lookups (same source the offline map picker uses), so the table will stay in sync when a map is added.
- Wired through the same `setTab()` union (`'mapbuilder'`).
- No map-editing engine exists yet (`mapbuilder/` workspace is a separate app), so Clone/Edit/Delete/Import/Export are intentionally stubs that communicate the current state of the feature.

---

## (c) Settings → Controls section (functional rebinding)

### What was added
- New **Controls** section inside the Settings panel with three buttons:
  - **Change controls** → opens the rebinding popup (`#controls-overlay`).
  - **Controls info** → opens an info popup (`#controls-info-overlay`) containing the content that previously lived in the Game Info **Controls** and **Mobile** tabs.
  - **Restore defaults** → wipes saved bindings to factory defaults.
- **Rebinding popup** lists, in three groups:
  - *Keyboard shortcuts* — borders, paths, reveal, minimap, box-select, stop, home, idle worker, idle dozer, game log, attack-move, sell, esc.
  - *HUD selection bar (control groups)* — control-group recall keys 1–9 (Ctrl+key saves the group).
  - *Mouse* — informational rows (fixed, e.g. select / box / pan / zoom / minimap-jump / edge-pan), not rebindable.
- Clicking **Set** on a key/slot row captures the next key; bindings persist in `localStorage` under `space-arenas:controls`; assigning a key already in use swaps it back on the previous holder. **Restore defaults** removes the storage key.

### Game wiring (beyond the popup)
- New module `client/src/ui/controls.ts` — default binding table, load/save, uniqueness swap, `getControls()`, `changeBinding()`, `restoreDefaultBindings()`.
- `client/src/game/Game.ts` now resolves every hotkey through the bindings (`keyMatch(e, 'borders')`, etc.), so rebinding takes effect in-match immediately.
- Number keys 1–9 recall control groups (`Game.saveControlGroup`/`recallControlGroup` in `client/src/game/Game.ts`); the prefix modifier is the user-remappable `groupMod` binding (default `Control`, so the default combo is Ctrl+1–9; rebinding it to e.g. Shift dodges browser-reserved Ctrl combos). It is the first field in the Settings → **Change controls** → "Control groups (number keys)" section. The on-screen selection bar no longer consumes numeric hotkeys: command buttons (stop / multi-pos / destroy / attack / guard / spawn / flag / deselect) are unbounded, and build / produce / research buttons use `groupMod + <letter>` (e.g. `Ctrl+B` for barracks, with the 1st–2nd–3rd letter fallback for duplicate first letters) resolved through `Hud.hudShortcutByLetter` + `Hud.assignUniqueHotkey` in `client/src/ui/hud.ts`, which calls the exact same click handlers the on-screen buttons use.
- A **Keys** button (`#keys-toggle`, HUD header) opens an in-match **control groups** panel listing each saved group (`Ctrl+1 — 3 Riflemen, 2 Assault Walker`) with a per-group **Remove** button, maintained by `Game.renderControlGroups`/`clearControlGroup`; it is separate from the Settings rebinding popup.
- `client/src/input/input.ts` reads the `attackMove` binding for the held-`A` attack-move modifier.
- Game Info **Controls** and **Mobile** tabs were removed from the info panel; their content now renders in the Settings **Controls info** popup via `controlsInfoHtml()` in `client/src/main.ts`, reusing the same `info.controls.*` / `info.mobile.*` strings (the tab labels `info.tab.controls`, `info.tab.mobile` were removed from en/ar).

### Codebase fit
- Fits the existing patterns: `.panel`/overlay markup like the Create-match overlay, `classList` `visible` toggling, i18n via `t()`/`translateStatic`, and localStorage keys prefixed `space-arenas:` (matching `dev-settings`, `lang`, `mobile-mode`).
- Behaviour verified by `npm run typecheck` (all 4 workspaces), `npx eslint .`, `npm test` (137/137 pass) and `npm run build -w client` (only the known >500 kB chunk warning).

---

## Verification
- `npm run typecheck` — clean (shared, client, host, mapbuilder).
- `npm run lint` — clean.
- `npm test` — 13 files / 137 tests pass.
- `npm run build -w client` — clean build; only the pre-existing >500 kB chunk-size warning.
- Built `client/dist/index.html` checked: new panels/overlays present, no leftover `info.tab.controls` / `info.tab.mobile` / `data-tab="controls|mobile"` references.

## Remaining / future
- Online Server: replace stub handlers with a real account server + WebSocket matchmaking; populate the matches table from actual room data.

---

## (d) Map Builder as part of the game (report only — no code yet)

The Map Builder is currently a **separate `mapbuilder/` workspace** with its own launcher (`run-mapbuilder.bat`). The lobby panel added in (b) only lists built-in maps and stubs the editor buttons. This report explains how the Map Builder should become part of the game and why the separate launcher is not needed when starting through `run-game.bat`.

### How it becomes part of the game
1. **Adopt the editor engine** — move the map-editing code from `mapbuilder/` into the client app (e.g. `client/src/mapbuilder/`) so the same `MapData` type, `MAP_PRESETS`, `tiles`, and `obstructions` utilities are shared from `@space-arenas/shared`. The editor UI then mounts into the existing lobby: replace the stubbed Clone / Edit / Delete / Import / Export buttons in `#mapbuilder-panel` with handlers that open an editor overlay, exactly like the match-creation and Settings overlays.
2. **Single map pipeline** — editing happens in-memory on `MapData` and produces a validated map object that is handed straight to the game boot path (`Game.startOffline` / `MatchStartMessage`), so custom maps flow through the exact same rendering, pathfinding and spawn logic as built-in ones. A `customMaps` registry in `localStorage` (e.g. `space-arenas:custom-maps`) persists the player's maps and feeds both the Map Builder table and the offline map picker.
3. **Networking (later)** — once the host picks a custom map, it serialises the edited `MapData` into `MatchStartMessage.map` for the room, so every client renders the same terrain. This keeps the editor client-side only; no server-side map storage is needed for offline/LAN play.

### Why `run-mapbuilder.bat` is not needed with `run-game.bat`
- `run-game.bat` builds and serves the **client app**, which after this integration would bundle the Map Builder editor itself — the game and the editor are the same web page, with the editor reachable via the Map Builder lobby tab.
- The standalone `mapbuilder/` workspace remains useful as a lightweight dev/QA tool, but its functionality (and more) is available inside the game, so players never have to launch a second app.
- This mirrors how the existing lobby panels (Online Server, Settings, Game Info) are already just tabs inside the same single-page client: no separate entry points.

---

## (e) Session progress — fog fade, laser beam, air-force planes, controls, map-builder create

### Fog fade (enemies fade into fog, not pop)
- `world.isVisibleTo` (`client/src/core/world.ts`) now keeps an enemy visible when the entity sits within `settings.fogFadeDistance` cells of any known-visible tile (manhattan ring, squared-distance falloff). Raw tile fog `>= 2` still required for instant visibility.
- Renderer draws the fog overlay **below** the entity/hitbox/field layers so fade-visible units render on top of darkened tiles (layer reorder in `renderer.init`).
- `FOG_FADE_DISTANCE` constant + `MatchSettings.fogFadeDistance` in `shared/src/constants.ts`; new dev-settings "Fog of war" section with a `fogFadeDistance` field (en/ar i18n).

### Space laser — vertical beam
- `ui/graphics.ts` gains a `laserBeam` effect (ON by default) gating the beam visuals.
- `renderer.drawFx` renders the strike as a vertical beam from above the strike spot plus a faint link from the owning `super-weapon` building (or command center for a free shot).
- Cooldown now starts at research completion: `placing-system.ts` sets `laserLastUsed = world.tick` when the `space-laser` research finishes.

### Air Force — 3 planes, uncommandable
- `Game.onCommand` filters `class === 'air'` units out of move / attack / attack-move / set-spawn flows (`groundUnits` helper); `issueMoveCommand` likewise skips empty sets. Planes are ghost-planes that only sortie via `plane-system.ts`.

### Bullet projectile — short moving segment
- `renderer.drawFx` projectiles are now a ~26-unit tracer segment that advances from the shooter toward the target over 10 frames instead of a full static line.

### Controls — mouse flip + zoom/pan keys
- New bindings: `zoomIn` (`=`), `zoomOut` (`-`), `panUp/Down/Left/Right` (`Arrow*`), and mouse actions `select/box/ctrl/move` are now rebindable Left/Right.
- `controls.ts`: `DEFAULT_BINDINGS` extended, `mouseSide()`/`mouseButton()` helpers added; `changeBinding` still swaps occupants so two actions never share a button.
- `input/input.ts` resolves select/move from `mouseButton('select')` / `mouseButton('move')` instead of hardcoded 0/2.
- `Game.onKeyDown` handles zoom (camera `zoomAt`) and arrow pan (`panBy`), guarded by `isTypingTarget` so it doesn't fire while typing.
- `main.ts` `ctrlRowEl` renders Left/Right toggle buttons for flippable mouse rows; Settings hint text updated; `.controls-list` / `.mouse-side` / `.capturing` CSS improved in `index.html`.
- i18n keys `settings.controls.left/right`, `info.controls.zoomIn/zoomOut/panUp/panDown/panLeft/panRight` added in en/ar.

### Map Builder panel
- `#mb-create` button added before Import in the lobby toolbar (`index.html`), wired like the other stubs, with `mapbuilder.create` i18n (en/ar).

### Follow-up fixes (feedback round)
- **Air Force capacity** — the queue gate in `input-system.ts` now counts *queued* air orders (not just planes already flying) against `ud.capacity` (3), so you can no longer queue more than 3 fighters per `air-force`. The HUD produce button applies the same gate so the button disables once 3 are alive-or-queued.
- **Fighter auto-sortie** — `PlaneSystem` now acquires targets: with cooldown ready it runs `pickTarget` (exported from `combat-system.ts`) over a `4×max(weapon.range, unit.vision)` sortie radius, then chases (`setChase`), fires once via `fire`, and returns to hover. Planes still ignore move/attack commands.
- **Bullet projectile** — `addProjectile` takes the shooter's `team`; `renderer.drawFx` draws a ~110-fx tracer segment (not a dot) with a bright head, gold for own shots and red (`0xff5a5a`) for enemy shots. `Game.ts` passes `e.team` from `shot-fired`.
- **Laser beam** — beam height extended to 6000 so its origin is off-screen; the bright origin circle was removed.
- **Controls — modifier rows** — `edgePan` ("Edge-scroll the camera", Ctrl+edge) and `ctrl` ("Add / remove from selection", Ctrl+click) now share a rebindable `mod` key (default `Control`) rendered as a normal key + *Set* button; `input.ts` reads `getControls().mod` for both edge-pan and additive selection. Only `select` / `box` / `move` remain Left/Right-flippable.
- **HUD slots** — slot 10 added, bound to key `0` (`controls.ts` `DEFAULT_BINDINGS`, `slotRows()`, `Game.ts` loop now 1–10).
- **Graphics effect rows CSS** — `.controls-list .ctrl-row` / `.ctrl-label` / `.ctrl-desc` styled; ON/OFF toggle gets `.on` (green) / `.off` styles.

### Verification
- `npm run typecheck`, `npm run lint`, `npm test` (13 files / 137 tests), `npm run build -w client` all green.

---

## (f) Session progress — commandable fighters, held-key speed fix, laser levels

### Fighters are commandable + orbit the air-force
- Removed the `class === 'air'` exclusion everywhere in `Game.onCommand` (`groundUnits` helper deleted) and `issueMoveCommand`, so selected fighters accept **move**, **attack** (right-click / A+click on an enemy) and **attack-move** commands like ground units.
- `plane-system.ts` rewritten: planes now obey an explicit `moves` component while a player command is active, chase/fire on `a.target` (player attack or auto-acquired), fire on the ground at `a.targetPos` for attack-move, and otherwise **hover in a circular orbit** around their home building (`ORBIT_RADIUS = 1000`, phase offset by plane id). Auto-sortie still runs when idle and in range.
- `fireGround` (bombing a point) exported from `combat-system.ts` for the attack-move case.

### Held-key "game speeds up" bug
- Root cause: in offline mode `Game.issueBatch` called `this.sim.step(envs)` synchronously, so every auto-repeated keydown of **S** (stop) advanced the world one extra tick instantly.
- Fix: offline commands are buffered into `Game.pendingCmds` and flushed inside `Game.onTick` (which already steps the sim at the `SIM_TICK_MS` cadence via `GameLoop`), so issuing commands can no longer out-pace the simulation clock. Net mode is unchanged (commands still relayed immediately).

### Laser upgrade levels (lv.1 / lv.2)
- `World.TeamState` gains `laserLevel` (initialised 0 at both team-init sites in `world.ts`), hashed in `core/hash.ts`.
- `placing-system.ts` increments `laserLevel` when `space-laser` research completes; research itself no longer re-runs after `laserLevel >= 2` (`input-system.ts` research gate + HUD button hidden when maxed).
- Strike radius scales with level: `World.laserStrikeRadius(team)` (`settings.laserRadius * max(1, level)`); research cost scales per level via `World.laserUpgradeCost`. Used by the `laser` command (`input-system.ts`), the renderer's strike beam (`l.radius`) and targeting reticle (`renderer.ts`).
- Labels: the tools fire button and the HUD research button show `tools.laserLevel` ("Space Laser lv.{lv}") — the HUD button labels the *next* level (lv.1 → lv.2), and shows the scaled price.
- **Fog reveal**: `vision-system.ts` stamps the fog `= 2` across the laser's radius for each team while a laser entity is alive, so the strike lights up the area; the existing 2→1 decay restores fog after the beam ends.
### Verification
- `npm run typecheck`, `npm run lint`, `npm test` (13 files / 137 tests), `npm run build -w client` all green.

---

## (g) Session progress — fighter ammo/reload, dev settings groups, map builder integrated

### Fighter ammo + reload
- `shared/src/balance/units.ts`: `fighter` gains `maxAmmo: 2`, `reloadTicks: SECONDS_TO_TICKS(5)`; `shared/src/balance/weapons.ts`: `air-cannon` damage raised 30 → 45.
- `UnitDef` / `UnitOverrides` (`shared/src/constants.ts`) gain `maxAmmo` / `reloadTicks` / `capacity` fields so dev settings can override them.
- `PlaneComp` (`client/src/core/world.ts`) now carries `ammo` + `reloadTicks`, initialised at spawn by `production-system.ts` (`ud.maxAmmo ?? 2`).
- `plane-system.ts`: hover point follows a move command's destination; while `p.ammo <= 0` the plane returns home (`p.home`) and reloads (`reloadTicks` countdown → `ammo = maxAmmo`, targets/moves cancelled while reloading); every shot (attack / attack-move / auto-sortie) decrements `ammo`.

### Laser level cap via dev settings
- `LASER_MAX_LEVEL = 2` added to `shared/src/constants.ts`; `MatchSettings.laserMaxLevel` field + default; laser level cap now read from `world.laserMaxLevel()` in `input-system.ts` and `hud.ts`.
- Dev settings: new scalar `laserMaxLevel` (unit `levels`); `OVERRIDE_UNIT_FIELDS` gains `capacity`, `maxAmmo`, `reloadTicks` (fighter-only); `DEV_UNIT_KEYS` gains `levels`/`rounds` (the `cells/s` key is quoted — an unquoted key breaks the object literal).

### Dev settings groups + wide panel
- `appendDevSection` / `appendDevItemHeader` now emit `<details class="dev-group">` + `.dev-group-body` so every variable groups under its object (header shows ` — fields` suffix); CSS block added to `client/index.html`.
- `.panel.wide` gets `max-width: none` so the map-builder panel spans the lobby width (`#lobby .panel.wide`).

### Map builder — full integration
- New `client/src/mapbuilder/library.ts`: custom maps live in `localStorage` under `space-arenas:custom-maps` (the standalone map-builder app instead used a separate IndexedDB store, which is why maps never appeared in-game). `allMapEntries()` = presets + customs as `MapEntry` (`custom:<name>` ids); `saveCustomMap` validates + upserts; `migrateLegacyLibrary()` imports the old IndexedDB library once.
- New `client/src/mapbuilder/editor.ts` (`MapBuilderEditor` class): TILE=8 canvas inside `.mb-canvas-wrap`, wheel zoom + middle-drag pan, brushes Ground (terrain swatches 0/1/3) / Water, tools Paint / Spawn (3×3 team box) / Supply (drag rectangle, stored as optional `w`/`h`) / Oil, red/green ghost preview, `open`/`reset` (reset restores the opened/saved version), dirty tracking with callback, `applyInfo` for name/description/variant.
- Lobby `#mapbuilder-panel`: toolbar Create / Import / Export / Refresh / Clone / Edit / Delete now real (was stubs). Editor overlay (`#mapbuilder-overlay`) with Back (confirm popup when dirty), Reset, Map info popup (name / players / variant / description), Save → `saveCustomMap` + tables refresh live.
- Offline map picker (`renderMapSelect`/`selectPreset`) and online match map select (`renderMatchOptions` + change handler) now iterate `allMapEntries()`; custom maps preview via `entryToMap` and render through the shared `MapPreview`.
- Host: `UpdateRoomMessage`/`LobbyMessage` gain `map?: MapData`; `updateRoomOptions` accepts a validated custom map payload (`custom:<name>`), sets `maxPlayers` from spawn count, contacts room capacity (host broadcasts `map` so non-host clients can preview). `net.ts.updateRoom` forwards `map`.
- i18n: `mapbuilder.*` expanded (create/import/export/refresh/clone/edit/delete/back/reset/mapInfo/save/brush/tools/confirm/info statuses) in en/ar.

### Verification
- `npm run typecheck` (shared, client, host), `npm run lint`, `npm test` (13 files / 137 tests), `npm run build -w client` all green.

---

## (h) Map builder polish round — canvas stretch, header, tools, dynamic zoom

### Canvas stretch + cursor offset (fixed)
- The editor canvas buffer was sized `body.height − sidebar.height` while the CSS stretched it to the full body height (the sidebar is a flex item already at full height), so tiles rendered as vertical rectangles and the cursor pointer math (CSS px) misaligned with the buffer.
- `onWinResize` now sizes the buffer to exactly `wrap.clientWidth × wrap.clientHeight`, so buffer == display == pointer pixels (1:1).

### Map info popup rework
- Replaced the disabled "Players" select with **Width × Height** number inputs (16–256) + a **Save** button; Save applies name/variant/description (`applyInfo`) and calls new `editor.resize(w, h)` (crop/pad tiles, drop out-of-bounds spawns/supply/oil/obstructions).

### New tools + brush options
- **Fill** tool: flood fill of the contiguous same-colour region with the selected brush colour.
- **Erase** tool: removes spawns / supply / oil / obstructions intersecting the brush footprint (spawn teams renumber).
- **Brush size** slider (1–8) and **shape** (Square / Round); `brushCells()` yields size 1 as a 1×1 square for any shape; paint + erase + their ghosts use the footprint (round shape uses cell-centre distance to the footprint centre).
- **Supply field** is now a fixed 4×4 square placed on click (no drag) with red/green ghost; **oil field** renders as a square (`oilSquare()`) whose ghost uses the same centred geometry.

### Dynamic zoom by map size
- `updateZoomBounds()`: min zoom = whole map fits (`min(canvasW/(w·TILE), canvasH/(h·TILE))`, floor 0.05), max zoom = 24 (or `minZoom·4`).
- `centerOnMap()` frames and centres the whole map; wheel zoom clamps to `[minZoom, maxZoom]`; window resize recomputes bounds; `open()` / `resize()` recentre.

### Verification
- `npm run typecheck -w client`, `npm run lint`, `npm run build -w client` all green.

---

# Deferred Features — Future Development

These features are deferred: either too large, blocked on the online server, or dependent on features not yet built.

---

## Sea Army (L+, blocked until core is stable)

**4a** — Naval units (destroyer, submarine, carrier, frigate, missile-boat).
- Full sea-rotation: underwater units, torpedo weapons, naval landing ops.
- Requires sea-only maps, new terrain type `SeaTile`, underwater fog system.
- Naval production building (dock), water obstacles + shoreline mechanics.
- Blocked: needs balanced core ground/air combat first; large scope.

---

## Territory Capture — Full Game Mode (L, after N2c proof-of-concept)

**N2a** — Full territory capture game mode with capturable HQ buildings.
- Requires N2c (supply capture twist) to be implemented and validated first.
- Game mode selector in lobby: Conquest / Territory Capture / Survival.
- Capturable HQ buildings on the map, win by holding majority.

---

## Online Server Backend

- Replace stub account/matchmaking handlers with real WebSocket server.
- Ranked ladder play, persistent player accounts, cloud match history.
- **Cloud profile** (#14 partial): sync stats/achievements across devices.
- Server-side replay validation, anti-cheat.
- **Match replays for online matches** — offline and LAN matches already record `ReplayData` (offline: client-side at `game-over`, uploaded to the host archive; LAN: host `endMatch` saves `relay.history`). When real online matches run through the server, the server should record the relayed command log into the same `ReplayData` format and expose it via a per-account match-history API (list / play / download), instead of the host's local `archive/` folder.

---

## Cloud Mods

**N7c** — Online mod repository: browse, rate, download balance mods.
- Requires online server + account system.
- Community voting, mod versioning, dependency resolution.

---

## Map Builder — Advanced Features

- Collaborative editing (multiplayer map editing).
- Trigger/scripting system for custom game modes.
- Terrain heightmap, water flow direction, fog-of-war prebake.
- See existing work in sections (b) and (d)–(h) above.

---

## Custom Scenario — Real Feature (M, after 19.4 UI placeholder)

The Day 19.4 custom-scenario button is a wire-only placeholder ("coming soon"). The real feature:
- **Import**: upload a scenario `.json` (map seed/variant + wave definitions in the data-driven schema: `{ waves: [{ delay, units: [{ type, count }], mapVariant }] }` plus optional match settings overrides).
- **Validate + run**: schema-check the file, then start an offline survival-style match (`mode: 'custom'`) using the imported waves/map instead of the auto-composed ones.
- **Export**: save the currently active custom scenario back to `.json` for sharing.
- **Library**: a small localStorage list of saved custom scenarios with rename/delete/duplicate.
