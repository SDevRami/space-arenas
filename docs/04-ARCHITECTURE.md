# 04 — Architecture

**Status:** Current — describes the shipped v1.0 engineering structure. Supersedes the earlier v0.1 draft, which described a prototype that no longer matches the code.
**Companion docs:** `03-TECHNICAL-SPECIFICATION.md` (stack), `02-MECHANICS-SPECIFICATION.md` (rules), `01-GAME-DESIGN-DOCUMENT.md` (roles), `08-DECISIONS.md` (rationales).

This is the core engineering document: the ECS design, the game loop lifecycle, the deterministic lockstep netcode, the rendering and persistence layers, and the host/online services that hold the match together.

---

## 1. Repository & Workspace Layout

The repo is an **npm-workspaces monorepo** (`package.json` `workspaces: ["shared","client","host","online"]`).

| Workspace | Role |
|---|---|
| **`shared/`** | Code and data shared by every consumer: constants, protocol codec, fixed-point math, RNG, maps, mod format, replay format, settings registry, balance tables. |
| **`client/`** | The browser game: Vite + TypeScript + PixiJS 8. |
| **`host/`** | Node LAN host server: rooms, authoritative tick relay, bots, LAN discovery, QR invites, replay archive. |
| **`online/`** | Public online service (Express + Supabase): auth, match rooms/relay, profiles, leaderboard, mods, encrypted backups, replay upload, plus the GitHub Pages landing site. |

Root scripts: `npm run dev` (client + host concurrently), `npm run build`, `npm run typecheck`, `npm test` (Vitest), `npm run test:soak` (determinism soak), `npm run lint`, `npm run format`.

### 1.1 Client source map (`client/src/`)

| Directory | Contents |
|---|---|
| `core/` | `world.ts` (the world), `Simulator.ts`, `loop.ts` (`GameLoop`), `hash.ts` (`hashWorld`, CRC32), `events.ts`, `geometry.ts`, `pathfinding.ts` (A*). |
| `ecs/` | `sparse-set.ts` — the single component-store primitive. |
| `systems/` | The 24 simulation systems plus `registry.ts` (`SYSTEMS`, `stepWorld`). |
| `entities/` | `factories.ts` — `spawnUnit`, `spawnBuilding`. |
| `game/` | `Game.ts` (orchestrator), `match.ts` (`MatchConfig`). |
| `net/` | `net.ts` (`NetClient`), `pbkdf2.ts`, `crypto.ts`. |
| `render/` | `renderer.ts`, `camera.ts`, `ground.ts`, `minimap.ts`, `building-sprites.ts`, `shapes.ts`, `weather.ts`, `sprite-bundle.ts`. |
| `input/` | `input.ts` (mouse/touch/keyboard, selection, command mapping). |
| `ui/` | `hud.ts`, `chat.ts`, `controls.ts`, `graphics.ts` + settings panels, catalog, map preview. |
| `ai/` | `bot.ts` — difficulty configs, build orders, targeting. |
| `mapbuilder/` | `editor.ts`, `library.ts`, `worldmap.ts`, `builder.ts`. |
| `stats/` | `stats.ts` (`StatsTracker`), `StatsBoard`. |
| `profile/` | `profile.ts`, `modeRecords.ts`, `recorder.ts`, `achievements.ts`, `ui.ts`, `folder-backup.ts`. |
| `modes/` | `daily.ts` — daily mission generation. |
| `i18n/` | English/Arabic strings with RTL support. |
| `main.ts` | Lobby UI, settings, game-info catalog, entry point. |

---

## 2. Architectural Pattern: ECS-lite

### 2.1 Why ECS

| Criterion | ECS-lite | OOP hierarchy |
|---|---|---|
| Deterministic serialization | Trivial (data-only components) | Painful (object graphs, v-tables) |
| Lockstep state hashing | Natural (walk stores) | Requires reflection |
| Adding a behavior | Add a component + system | Touch a class hierarchy everywhere |
| Iteration control (order matters) | Explicit | Implicit |

The implementation is deliberately small and owned: a `SparseSet<T>` keyed by entity ID with a **sorted `ids` array** for deterministic ID-order iteration. Insertion uses binary search to keep `ids` sorted; deletion removes from both the map and the array.

### 2.2 Definitions

- **Entity:** an integer ID allocated sequentially.
- **Component:** plain data in a `SparseSet`; iteration always walks `ids` in ascending order.
- **System:** an object `{ name, update(world, commands) }` with no hidden global state — all state lives on the world or its components.
- **World:** owns every component store, the entity allocator, the event queue, the grid, the fog board, the score/rank/power state, and `tick`.

### 2.3 Component catalogue

| Component | Purpose |
|---|---|
| `Transform` | Fixed-point position (+ facing/velocity where needed). |
| `Unit`, `Building`, `Health` | Identity, team, hp/maxHp, class, veterancy. |
| `Vision` | Vision radius (buildings always 8). |
| `Attack` | Weapon id, cooldown, current target, last attacker. |
| `Move` | Path, waypoints, move state. |
| `Queue` | Production queue (units) and research queue (buildings). |
| `Harvester` | Harvester state machine + assigned dock. |
| `Field`, `OilField` | Resource field state (`trips`, `capturer`, claim/hold timers). |
| `Work` | Bulldozer construction/repair/collect work target. |
| `Wreck` | Collectable wreck value. |
| `Grenade`, `Smoke` | In-flight / active ability effects with `explodeAt` / `untilTick`. |
| `Plane` | Aircraft orbit/reload/ammo state. |
| `Laser`, `Airstrike`, `EmpPulse` | Super-weapon effect state. |
| `SatelliteMarker` | Active satellite reveal. |
| `Mine` | Proximity mine (arm timer, owner). |
| `Transport` | Transport capacity and loaded passengers. |
| `Scenery` | Rocks/trees with destructible HP. |
| `Flashes`, `HealFlashes`, `Pings`, `CrushPairs`, `BuildOrderQueues` | Transient/per-team bookkeeping (not part of the state hash — see §5.3). |

### 2.4 System pipeline (fixed order per tick)

`SYSTEMS` in `client/src/systems/registry.ts` defines the authoritative order:

```
 1  Input        → apply validated player commands for this tick
 2  Placing      → placement validation, power net, research progress, Max Power, defense dome
 3  Production   → advance production queues; spawn units; pause when powered down
 4  Economy      → harvester state machine; banking supplies + bonuses; score
 5  Oil          → oil field claim + periodic income
 6  SupplyCapture→ scout presence capturing/holding supply fields
 7  Movement     → follow paths, separation, stuck relocation, clamping
 8  Mines        → arm, trigger, and detonate proximity mines
 9  Crush        → vehicles crushing infantry contact pairs
10  Transport    → boarding, riding, unloading (APC / carrier / bunker)
11  Scenery      → tree/rock destruction from vehicles standing on them
12  Pathfinding  → A* budgeted per tick; repath, line-of-sight, direct march
13  Work         → Bulldozer build/repair/collect; Engineer targeted heal
14  Combat       → acquire targets, fire, damage, splash, deaths, wrecks, veterancy
15  Abilities    → grenade detonation, smoke expiry, ability cooldown reset
16  Heal         → veteran Engineer passive aura heal
17  Sell         → sell progress, refunds, removal
18  Plane        → aircraft orbit, sortie, reload, air combat
19  Airstrike    → kamikaze squadron spawn, flight, bombs
20  Laser        → space laser wind-up, beam, damage
21  Emp          → EMP pulse disable/expire
22  Vision       → fog decay + source writes, satellite markers
23  WinLoss      → elimination and match-end evaluation (fixed team order)
24  Sync         → recompute `world.lastHash` (CRC32) and broadcast every 60 ticks
```

`stepWorld` is the single per-tick entry point:

```ts
world.rebuildGridIfDirty()
const valid = commands.filter((c) => c.tick === world.tick)
for (const s of SYSTEMS) s.update(world, valid)
world.tick++
```

**Order is load-bearing.** Reordering systems changes results on every client and desyncs matches. Any change requires a determinism test run and a protocol-version bump if command semantics change.

---

## 3. World & State Management

### 3.1 Single source of truth

One `World` per match (`client/src/core/world.ts`). The HUD, renderer, audio, and stats read it; the render layer never writes back into sim state. UI/selection/hotkeys are local-only.

The world owns:
- Component stores and the entity allocator.
- The navigation grid (`rebuildGridIfDirty`) derived from terrain, obstructions, and building footprints.
- The per-team fog board.
- Economy (`credits`), power (`powerNet`), score/rank, alliance set, super-weapon state, mod/settings (`world.settings`), `world.winRule`, `world.tick`.

### 3.2 Entities and factories

`client/src/entities/factories.ts`:
- `spawnUnit` sets `health = maxHp = def.hp`, `vision = def.vision`, an `Attack` component when `def.weapon`, an air `PlaneComp` for aircraft, a `HarvesterComp` for harvesters, and a `TransportComp` when `def.transportCapacity`.
- `spawnBuilding` sets vision radius **8** (not from the def), an attack component when armed, a transport component for garrisons, and marks the grid dirty.

### 3.3 Alliances & co-op

Alliance membership is tracked on the world. Fog, economy, rank, and control respect `coopEconomy` / `coopRank` / `coopControl`: shared units at `coopControl = units`, buildings only at `all`.

---

## 4. Game Loop Lifecycle

### 4.1 The tick model

`GameLoop` (`client/src/core/loop.ts`) is a fixed-step accumulator:

- `dt = min(now - lastTime, 250)`; `acc += dt × timeScale`.
- At most `maxSteps = 4` catch-up ticks per frame; exceeding it zeroes the accumulator (the sim runs slow rather than spiralling).
- On a tick error it reports once, zeroes the accumulator, and breaks.
- `frame()` (render) always runs, regardless of whether a sim tick ran.

### 4.2 Sim vs render

- **Sim:** fixed 25 Hz, integer-only; all gameplay resolves here. `SIM_TICK_HZ = 25`, `SIM_TICK_MS = 40`.
- **Render:** `requestAnimationFrame` at display refresh; interpolation is render-only and never fed back into the sim.
- **Input:** stamped with the current tick (`Simulator.makeCommand` → `tick = world.tick`) and consumed at the start of that tick, so sim is framerate-independent.

### 4.3 Speed control

`setSpeed` multiplies the accumulator. Replay playback uses `REPLAY_SPEEDS = [0.25, 0.5, 1, 2, 4]`.

### 4.4 Orchestrator modes (`client/src/game/Game.ts`)

`GameMode = 'offline' | 'net' | 'replay'`.

- **`startOffline(cfg: MatchConfig)`** — local world + `BotPlayer[]`; each tick pushes local commands and bot commands into `sim.step`.
- **`startNet(net, msg, opts?)`** — connects to a `NetClient`; applies relay frames; supports spectators (`localTeam < 0`) who see everything.
- **`startReplay(replay)`** — passive spectate; a seek rebuilds the world from tick 0 via `buildReplayWorld`.

Key methods: `applyFrame` / `stepToFrame` / `drainFrameQueue` (relay frames), `onNetChecksum` / `applySpectateSync` / `catchUpSync` / `stepToTickSync`, `onTick` (per-tick sim driver), `onFrame` (render driver), `collectFinalScores`, `showResults` / `beginCinematic`.

Replays are saved to `/api/replays/upload` with a browser-download fallback, and can auto-save (`space-arenas:auto-replay`).

---

## 5. Determinism (Lockstep Foundation)

This is the highest-risk area; every rule is a hard invariant.

### 5.1 Command frame

Every tick the host assembles a **command frame**: all commands for that tick, sorted `(player, seq)`. Clients apply frames in order to identical initial state with identical deterministic systems, producing identical state.

### 5.2 Determinism rules

1. **Integer arithmetic only in the sim.** Positions are fixed-point (`FX = 1000`); `isqrt`/`sqDist`/`dist` replace `Math.sqrt`. One exception: `PlaneSystem.orbit` uses `Math.cos`/`Math.sin` (see `02-MECHANICS-SPECIFICATION.md` §10.1).
2. **Seeded RNG only** (`shared/src/rng.ts`, splitmix64-style `next64`/`next`/`nextInt`/`state32`). `hashSeed` is FNV-1a. RNG state is part of the world and never consumed by render/audio.
3. **Deterministic iteration** — always by ascending entity ID via the sorted `SparseSet.ids`; never rely on JS `Map`/`Object` key order.
4. **No wall-clock** — the only clock is `world.tick`.
5. **No floats in serialized state** — the wire format is integer-only; the hash covers integer state.
6. **Validated payloads** — `validateCommandBytes` rejects malformed commands; no dynamic code paths from input.

### 5.3 State hashing (`client/src/core/hash.ts`)

`hashWorld(world)` produces a **CRC32** over the integer state: tick, width/height, `rngState`, co-op settings, and the per-team fields, then every component store — `transforms`, `units`, `buildings`, `healths`, `visions`, `attacks`, `moves`, `queues`, `harvesters`, `fields`, `oilFields`, `works`, `wrecks`, `satelliteMarkers`, `grenades`, `smokes`, `planes`, `lasers`, `airstrikes`, `empPulses`, `scenery`, `mines`, `transports`.

`compactHash` renders it as 8 hex digits. Transient/cosmetic stores — `flashes`, `healFlashes`, `pings`, `crushPairs`, `buildOrderQueues` — are **excluded**.

`SyncSystem` sets `world.lastHash = hashWorld(world)` every tick and broadcasts (via `onSyncTick`) when `tick % 60 === 0`.

### 5.4 Client prediction & latency

Commands go to the host but are applied at their **target tick**; there is no rollback because the sim never applies a command before its target tick. Local prediction equals the authoritative result once the frame arrives.

---

## 6. Networking Architecture (Lockstep over WebSocket)

### 6.1 Roles

The **host does not simulate the game**. It runs an authoritative tick relay and integrity checks only. Every client (including the host's own browser client on `localhost`) runs the identical sim. This keeps the host tiny and prevents host-side gameplay cheating.

### 6.2 LAN host server (`host/src/`)

| Module | Role |
|---|---|
| `index.ts` | Node entry: HTTP static serving + WebSocket server wiring. |
| `rooms.ts` | Room state: players, map, settings, win rule, mod, password hash. |
| `relay.ts` | `TickRelay` — the authoritative 40 ms clock. |
| `bots.ts` | `NetBotRunner` — steps bot AI server-side on the same command stream. |
| `sanitize.ts` | Bounds/clamping on match settings (min/max over 40+ parameters). |
| `passphrase.ts` | PBKDF2 passphrase verification. |
| `discovery.ts` | UDP LAN beacon for zero-config discovery. |
| `qr.ts` | QR-code invite images. |
| `mods.ts` | Balance-mod distribution by content hash. |
| `archive.ts` | Replay archive storage. |

`TickRelay` (`host/src/relay.ts`): a `setInterval(..., 40)` `broadcastFrame()` that (a) appends bot commands, (b) sorts pending by `(player, seq)`, (c) `encodeFrame(tick, commands)` to every connected non-spectator, (d) steps bots, (e) increments `tick`. Inbound commands are re-stamped with the relay tick and recorded to `history`. `submitForfeit` injects a synthetic `forfeit` command (`seq = 0x80000000 + n`). `relayChecksum` re-broadcasts a client's CRC to all players as a `RELAY_CHECKSUM`.

### 6.3 Client transport (`client/src/net/net.ts`)

`NetClient` wraps a WebSocket (`binaryType = 'arraybuffer'`). Binary frames carry a leading kind byte (`BIN`): `CMD` 1, `FRAME` 2, `CHECKSUM` 3, `RELAY_CHECKSUM` 4. Control traffic is JSON (`decodeControl`/`encodeControl`) over text frames, dispatched through `NetCallbacks` (`onLobby`, `onMatchStart`, `onFrame`, `onChecksum`, `onRelayChecksum`, `onGameOver`, `onPlayerState`, `onChat`, `onSpectateSync`, `onSettingsAlert`, `onError`, …).

### 6.4 Protocol (`shared/src/protocol.ts`)

- **Commands:** `CMD_TYPE_IDS` maps 38 command names to IDs; `encodeEnvelope`/`decodeEnvelope` produce a compact binary form; `validateCommandBytes` enforces length/type/count/coordinate/ownership bounds.
- **Control messages:** `ControlMessage` is a discriminated union — join/lobby/ready/start/loaded/mod-ack/error/match-start/game-over/spectate-sync/chat/dev-settings/settings-alert/ping/pong/forfeit/update-slot/update-room/add-bot/update-bot/remove-bot.
- **Versioning:** `PROTOCOL_VERSION = 0x5c ^ 0x4a` (=22); `MIN_PROTOCOL_VERSION = PROTOCOL_VERSION − 2` (=20). The integer is an admission gate; the real compatibility enforcement is server-side frame validation.
- **Security:** `validateCommandBytes` and re-stamping prevent spoofed player ids and out-of-range coordinates; passphrase joins use PBKDF2-SHA256 (100 000 iterations, salt `space-arenas:<roomCode>`). This is LAN-trusted, not a hostile-actor boundary.

### 6.5 Desync detection

`SyncSystem` broadcasts a CRC every 60 ticks. Clients compare local vs relayed checksums; a mismatch halts the match with diagnostics (last commands + per-tick hashes) and returns to lobby.

### 6.6 Online service (`online/`)

A separate Express + Supabase service (`online/src/`) that mirrors the room/relay model but adds accounts, persistence, and rate limiting: `relay.ts`, `rooms.ts`, `sanitize.ts`, `passphrase.ts`, `ratelimit.ts`, `supabase.ts`, `maps.ts`, `mods.ts`, `config.ts`, `index.ts`. SQL migrations live under `online/supabase/migrations/`. The landing site is served from `online/public/` via GitHub Pages.

---

## 7. Rendering Architecture (PixiJS 8)

`client/src/render/renderer.ts` builds a PixiJS `Application` with a layered scene graph and fixed `zIndex` bands (ground −80, fog −60, shadow −40, team −20, overlay 50, debug 1000) so dev-tunable sprite layers can be inserted without colliding with fixed bands.

- **Camera** (`camera.ts`): isometric 2:1 projection (`ISO_HALF_W`/`ISO_HALF_H`); `worldToScreen`/`screenToWorld`/`screenToWorldExact`; pan and clamped zoom.
- **Ground/fog** (`ground.ts`): terrain quads plus a `FogRenderer` that reads the per-team fog board.
- **Shapes/sprites** (`shapes.ts`, `building-sprites.ts`, `sprite-bundle.ts`): procedurally generated shapes and pre-rendered placeholder sprites; `textureFor`/`fieldTexture`/`obstacleTexture` etc. cache textures. Building sprites carry status frames.
- **Minimap** (`minimap.ts`): a separate scaled view with its own rail and toggle.
- **Weather** (`weather.ts`): `WeatherOverlay` — rain/snow/thunderstorm and day/night tint. **Purely cosmetic**; `setDayNight` is applied by `Game.onFrame`, and `weather.step()/draw()` run only when unpaused. No gameplay effect.
- **Camera math is render-only**; it never enters the sim.

---

## 8. Input & UI

- **Input** (`client/src/input/input.ts`): mouse/touch/keyboard capture, edge-pan, hover world point, box-select rectangle, and command interpretation (`ClickInfo`, `BoxInfo`). It emits high-level intents that `Game` turns into `SimCommand`s.
- **HUD** (`client/src/ui/hud.ts`): credits/power/score/rank readouts, selection details, build/research menus, tools bar, game log, and per-team stats board. `hud.update(...)` runs once per render frame from world state.
- **Graphics settings** (`ui/graphics.ts`): `getGraphics()` + `effectEnabled` gate optional effects (impacts, projectiles) so they can be disabled for performance.
- **Control groups, pings, formation toggles, and super-weapon targeting** live in `Game.ts` as local UI state, never in the sim.

---

## 9. AI Bot (`client/src/ai/bot.ts`)

- Difficulties `easy | medium | hard`; `BOT_CONFIGS` tune decision interval, credit reserve/floor, army threshold, attack interval, power margin, harvester/dozer caps, scout count, and target production lists.
- The bot emits ordinary `SimCommand`s through `sim.makeCommand` — it has no privileged access.
- `ATTACK_PRIORITY` ranks targets (war-factory > barracks > tech-center/turret > supply-dock > power-plant > command-center).
- `isGroundSplit` (own spawn on a separate component from enemy spawns) switches strategy to air-force + fighter production and air targeting.
- LAN/online bots run server-side in `host/src/bots.ts` (`NetBotRunner`) on the same command stream.

---

## 10. Persistence & Profile

- **Profile** (`client/src/profile/profile.ts`): name, XP, level, stats, match history (cap 50, `PROFILE_VERSION = 1`), encrypted backups (`folder-backup.ts`).
- **Mode records** (`modeRecords.ts`): per-mode results (`MODE_RECORDS_VERSION = 2`).
- **Recorder** (`recorder.ts`): session event capture.
- **Achievements** (`achievements.ts`): evaluated live (~1 s cadence) and at match end.
- **Daily missions** (`client/src/modes/daily.ts`): `DAILY_MISSION_COUNT = 4`, deterministic per `generation`, kinds win/train/build/destroy/supply, `DAILY_XP_PER_LEVEL = 100`.
- **Settings persistence** (`shared/src/settings-file.ts`, `dev-settings-registry.ts`): layered defaults + `settings.json` over compiled defaults, with a `defaultsHash` exchanged in the lobby to detect base mismatches.
- **Replays** (`shared/src/replay.ts`): `{ version, seed, tickRate, map, settings, winRule, players, winner, ticks, history }`.
- **Browser storage keys:** `space-arenas:mode-records`, `space-arenas:profile`, `space-arenas:profile:config`, `space-arenas:graphics`, `space-arenas:auto-replay`, `space-arenas:hud-parts`, `space-arenas:clientId`.

---

## 11. Maps & Data Flow

1. **Map source** → `shared/src/maps.ts` validates and materializes `MapData` (terrain grid, oil/supply fields, obstructions, spawn points, brightness/colors, meta).
2. **World init** → the host distributes the map + seed + settings once via `S_MATCH_START`; every client constructs an identical world.
3. **Balance data** → `shared/src/balance/` (`buildings.ts`, `units.ts`, `weapons.ts`, `upgrades.ts`), moddable via `shared/src/mod.ts` (per-ID overrides merged by `getBuilding`/`getUnit`/`getWeapon`/`getUpgrade`).
4. **Map builder** → `client/src/mapbuilder/` author/preview/editor/library, exporting JSON maps consumable by the game.

`Terrain`: Ground=0, Cliff=1, Water=2, Road=3, BuildableGround=4. Water/Cliff are impassable; Ground/BuildableGround are buildable.

---

## 12. Testing Hooks & Failure Handling

### 12.1 Testability

- `stepWorld(world, commands)` is the atomic entry point — feed a command stream, step N ticks, read `world.lastHash`. Determinism and fuzz tests use it.
- `Simulator` = headless world + command producers; runs identically in Node (CI) and the browser.
- Test suites under `tests/` cover determinism, balance, protocol, pathfinding, vision, economy, oil, mines, crush, transport, veterancy, sea army, construction, win/loss, and more. `npm run test:soak` runs the determinism soak in a single fork, sequentially.
- Debug overlays (grid, paths, net, profiler) are gated by a dev build flag and toggled from the dev overlay.

### 12.2 Failure matrix

| Failure | Detection | Recovery |
|---|---|---|
| Sim exceeds 40 ms/tick | Tick profiler / `GameLoop` | Accumulator clamped; sim runs slower; no desync (ticks stay deterministic) |
| Missing command frame | Client tick gap | `catchUpSync` / spectate-sync resync; otherwise desync halt |
| Checksum mismatch | `SyncSystem` + `NetClient` checksums | Desync halt with diagnostics; return to lobby |
| Client disconnect | Relay `connected` flag / timeout | Online: reconnect grace at lobby; LAN: match ends (no host migration) |
| Browser tab backgrounded | `visibilitychange` / large `dt` | `dt` capped at 250 ms; ≤4 catch-up ticks; accumulator zeroed on overflow |
| Settings mismatch across clients | `defaultsHash` in lobby / `H_SETTINGS_ALERT` | Adopt host defaults or host issues a kick/skip verdict |

---

## 13. Summary of Hard Invariants

1. `SYSTEMS` order in `registry.ts` is fixed and must not be reordered.
2. The host relays and validates; it never simulates gameplay.
3. The sim is integer-only and wall-clock-free, with `world.tick` as its only clock.
4. State hashing covers exactly the stores listed in §5.3 — adding a gameplay-relevant store requires updating `hashWorld`.
5. Every command is validated and re-stamped before entering a frame.
6. Rendering, audio, weather, and camera are strictly downstream of the sim and never write back into it.
