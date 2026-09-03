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

---

## Day 2 — Audio + Haptics + SFX Ready ✅ DONE

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

---

## Day 3 — Controls QoL: Control Groups + Selection + Attack-Move Paint

Client input/selection only, no sim changes.

| # | Feature | Ref | Notes |
|---|---------|-----|-------|
| 1 | **Control groups** — Ctrl+1–9 saves selection, 1–9 recalls it | #21a | `Game.ts` new `Map<number, Set<number>> controlGroups`. Keydown handler for Ctrl+digit saves; digit without Ctrl recalls. Select the group if any unit alive; silently skip if all dead. |
| 2 | **Selection hotkeys** — select-all combat units, select-all harvesters, double-tap idle worker/dozer | #25a+b | `Game.ts` new bindings `selectCombat`, `selectHarvesters`, `selectIdleWorker`, `selectIdleDozer`. Double-tap idle key cycles through idle units (camera pan + selection swap). |
| 3 | **Attack-move paint** — Shift+drag on minimap paints a colored attack-move path overlay | #22a | `renderer.ts` new `attackMovePathG` Graphics layer. `Game.ts` Shift+drag handlers paint points into `attackMovePath: Point[]`. Clear on next attack-move command execution. |

**Touch points:** `Game.ts`, `renderer.ts`, `controls.ts` (new bindings), `input.ts`

---

## Day 4 — Vision & Awareness: Fog Modes + Day/Night + Base Alert

Vision-system + renderer changes.

| # | Feature | Ref | Notes |
|---|---------|-----|-------|
| 1 | **Fog mode toggle** — Classic (no fade), Hard (no memory), Radar-limited | #11a+c | `MatchSettings.fogMode` enum. `vision-system.ts` branches: Classic skips 2→1 decay; Hard decays 2→0 instantly; Radar-limited disables reveal for non-radar units. Lobby dropdown `#fog-mode` in match options. |
| 2 | **Day/night tint** — every 5 min 10 s cycle, 2-min dusk/dawn, tint + fog shrink | #31a | `Game.ts` `dayPhase` (day/dusk/night/dawn), computed from `tick % cycle`. Renderer tints world container; `world.fogFadeDistance` scales by phase. `graphics.ts` `setDayNightTint(phase)`. |
| 3 | **Base-under-attack alert** — audio ping + minimap flash when building takes damage | N5a+b | `combat-system.ts`: when `target` is a building and team differs, emit `base-under-attack` event. `Game.ts` handles event: `hooks.ts` `playAlertPing()`, `minimap.ts` `flashBuilding(entityId, team)`. |

**Touch points:** `vision-system.ts`, `world.ts`, `Game.ts`, `renderer.ts`, `hooks.ts`, `minimap.ts`, `constants.ts`, `index.html` (lobby fog dropdown)

---

## Day 5 — Damage Feedback + Settings + Super Weapon Shake

Renderer + game UI.

| # | Feature | Ref | Notes |
|---|---------|-----|-------|
| 1 | **Hit flash** — unit sprite briefly white on damage | #28a | `renderer.ts` `drawUnit`: when `damageFlash` component exists and `tick - hitTick < 2`, draw white sprite overlay. New ECS `DamageFlashComp { hitTick: number }`. |
| 2 | **Burning fire** — below 25% HP, unit shows fire overlay; destroyed if tick reaches 0 | #28b | `renderer.ts` `drawBurning()`: when `hp < maxHp * 0.25`, draw animated fire sprite (2-frame tween). No sim change (visual only). |
| 3 | **In-match settings** — Escape menu: volume, fog mode, keybinds, confirm-quit | #35a+b | `Game.ts` Escape menu: new overlay with settings panel (volume slider, fog dropdown, control remap link, quit confirm dialog). |
| 4 | **Super weapon camera shake** — enemy camera shakes 0.4 s when SW fires on them | User idea | `renderer.ts`: when `laser-strike` / `satellite` command targets current team's area, apply camera shake (sinusoidal offset on `camera.x/y` for ~24 ticks). `Game.ts` detects SW command on own team, triggers `shakeUntil = tick + 24`. |

**Touch points:** `renderer.ts`, `Game.ts`, `combat-system.ts` (damage flash ECS), `world.ts` (new component)

---

## Day 6 — Communication & Debug: Pings + Spectator + Perf Overlay

Net + renderer + debug tools.

| # | Feature | Ref | Notes |
|---|---------|-----|-------|
| 1 | **Minimap pings** — Alt+click minimap sends a ping to teammates, visible on minimap for 5 s | #23a | `SimCommand::ping { x, y, team }`. `renderer.ts` `drawPings()`: colored circle expanding + fading at (x, y) for 125 ticks. |
| 2 | **Ping types** — 3 ping variants (alert, assist, on-my-way) via Alt+key | #23b | New SimCommand variants `ping-alert`, `ping-assist`, `ping-on-my-way`. Each renders different color/shape on minimap. |
| 3 | **Spectator follow cam** — spectating auto-follows action | #13a | `Game.ts` spectate mode: `followTarget` set to nearest unit-to-combat every 60 ticks; camera lerps to target. Pause → unpause preserves follow. |
| 4 | **Spectator fight cam** — auto-zoom on ongoing fights | #13b | `Game.ts` spectate: when 3+ units fighting within 10-cell radius, zoom to 1.5× and center on fight centroid. Fade out after fight ends. |
| 5 | **Performance overlay** — FPS, sim tick time, entity count, path budget | #36a+b | `debug.ts` `PerfOverlay` class. `Game.ts` toggles with backtick key. Renders `ctx.fillText()` top-left corner. `pathfinding.ts` exposes `budgetUsed` / `budgetMax` counters. |

**Touch points:** `protocol.ts` (ping commands), `Game.ts`, `renderer.ts`, `minimap.ts`, `net.ts`, `pathfinding.ts`, new `debug.ts`

---

## Day 7 — Build Queue + Waypoint + Victory Screen

Economy + renderer.

| # | Feature | Ref | Notes |
|---|---------|-----|-------|
| 1 | **Build queue reorder** — drag items in queue panel to reorder | #17a | `hud.ts`: drag handlers on queue item elements. `SimCommand::reorder-queue { buildingId, from, to }`. `production-system.ts` applies reorder. |
| 2 | **Hotkey queueing** — Shift+click queues a unit without deselecting current | #17b | `Game.ts` `onCommand`: when `shift` held, append to queue instead of replacing. `production-system.ts` append-only path. |
| 3 | **Waypoint dotted line** — multi-route draws a green dotted polyline on the map | #24a | `renderer.ts` `drawWaypointLine()`: iterate `multiPos[]`, draw dotted segment + circle markers. Clear after route completes. |
| 4 | **Order number badges** — numbered circles on waypoint positions | #24b | Same renderer block: numbered label next to each waypoint marker. |
| 5 | **Victory screen cinematics** — "Victory" / "Defeat" title, highlight surviving HQs, stats recap | #32a | `Game.ts` `showVictoryScreen()`: overlay with team stats (units built, lost, damage dealt from `StatsTracker`). HQs pulse glow. |

**Touch points:** `hud.ts`, `Game.ts`, `renderer.ts`, `production-system.ts`, `protocol.ts` (reorder command), `stats.ts`

---

## Day 8 — Veterancy System (M)

New ECS component + combat-system + renderer.

| # | Feature | Ref | Notes |
|---|---------|-----|-------|
| 1 | **3 veteran ranks** — cumulative kills → rank-up → stat bonuses | #2a | `UnitComp` gains `veteranRank: 0|1|2`, `killCount: number`. `combat-system.ts`: on kill, increment `killCount`; thresholds 3→rank 1, 6→rank 2. `world.ts` `unitVeteranBonus(rank)` returns { damage×1.25, range×1.1, armor×0.8 }. `hash.ts` includes `veteranRank`. |
| 2 | **Star icons** — 1/2/3 star badge above health bar | #2a | `renderer.ts` `drawVeterancyBadge()`: positioned above health bar, gold star sprites. |

**Touch points:** `world.ts`, `combat-system.ts`, `renderer.ts`, `hash.ts`, `constants.ts` (bonus values)

---

## Day 9 — Unit Abilities: Grenade/Smoke + Stealth (M)

Tech-center research, new SimCommand + ECS components. Both gated by research.

| # | Feature | Ref | Notes |
|---|---------|-----|-------|
| 1 | **Grenade ability** — selected units auto-throw at structures, cooldown | #1a partial | New SimCommand `ability-grenade { unitId, targetId }`. `combat-system.ts`: grenade deals 3× weapon damage to buildings only. `ability-system.ts` new: cooldown per-unit (`abilityCooldown: number`). HUD button in tools bar. |
| 2 | **Smoke ability** — 3 s fog-blocker cloud at target point | #1a partial | New SimCommand `ability-smoke { x, y, team }`. `fog-system.ts` stamps fog `= 2` in 3×3 area for 75 ticks (3 s). Renderer: draw translucent gray overlay at (x, y). |
| 3 | **Stealth upgrade** — invisibility + detector counter | #5a | New `UnitComp.stealth: boolean`, `detector: boolean`. `vision-system.ts`: stealth units hidden unless in range of detector unit or radar building. Research at tech center (`upgrades.ts` new `stealth-tech`). `hash.ts` includes stealth state. |

**Touch points:** `protocol.ts`, `combat-system.ts`, new `ability-system.ts`, `world.ts`, `vision-system.ts`, `upgrades.ts`, `hash.ts`, `hud.ts` (ability buttons)

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
| 3 | Control groups + selection + paint | S | No | |
| 4 | Fog modes + day/night + base alert | M | Yes | |
| 5 | Damage feedback + settings + shake | S | No | |
| 6 | Pings + spectator + perf | M | Yes | |
| 7 | Build queue + waypoint + victory | M | Yes (reorder) | |
| 8 | Veterancy | M | Yes | |
| 9 | Abilities + stealth | M | Yes | |
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
