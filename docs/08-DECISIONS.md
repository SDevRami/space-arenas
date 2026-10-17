# 08 — Decisions (ADR)

**Status:** Living document — every record below was re-verified against the code (protocol revision 22, `MIN_PROTOCOL_VERSION` 20). Records whose original decision was reversed or partially shipped are marked accordingly; designed-but-not-built ideas live in § "Planned / not yet implemented".

Architecture Decision Records capture *why* the project is built the way it is, so future contributors don't silently reverse a decision made under specific constraints. Each record states the decision, its status, the context it was made in, the alternatives rejected, and where the decision now lives in the code (real paths and identifiers).

**Status conventions:** `Accepted` (decided and shipped), `Revised` (accepted, but the original wording was wrong/stale and has been corrected), `Partially shipped` (the decision stands, part of the design has landed, part has not), `Superseded` (replaced by a newer record).

---

## ADR-001 — Deterministic Lockstep; the Simulation Runs on the Clients, Never on the Wire

**Status:** Accepted (refined by ADR-019)
**Date:** 2026-08-07

**Context:** RTS multiplayer needs a fair, bandwidth-cheap, sync-correct architecture on a LAN. Options: (a) lockstep (identical sim everywhere), (b) host-authoritative state broadcast, (c) client-authoritative with arbitration.

**Decision:** Deterministic lockstep. Every client runs the identical simulation (`client/src/core/Simulator.ts` + the fixed-order system pipeline in `client/src/systems/registry.ts`). The server only ever broadcasts **commands** stamped with `(player, seq, tick)` — no state snapshots cross the wire. (The host *process* may run a private shadow simulator, but only to drive server-side bots — see ADR-019; the relay path itself stays state-free.)

**Where it lives:**
- `client/src/core/Simulator.ts`, `client/src/systems/registry.ts` (`SYSTEMS` — fixed order: Input → Placing → Production → Economy → … → Vision → WinLoss → Sync)
- `host/src/relay.ts` (`TickRelay`: 40 ms interval = 25 Hz, `submit()` stamps `(player, seq, tick)`, commands sorted `(player, seq)` before `encodeFrame`)
- `online/src/relay.ts` (same relay for internet rooms)

**Consequences:**
- **For:** lowest bandwidth; perfect fairness; no rubber-banding; replays/spectators fall out for free (the command log *is* the replay — `shared/src/replay.ts`); no server sim load for human players.
- **Against:** determinism is a hard engineering discipline (see ADR-006); desyncs are unforgiving; host drop ends the LAN match (see ADR-012).

**Why not host-authoritative?** A LAN host simulating and broadcasting state has ~10× bandwidth and adds sim latency; the complexity savings are small because the sim must be *replicated* for prediction anyway — lockstep reuses the identical replicated sim with zero state broadcast.

**Why not client-authoritative?** Open to cheats (units the client claims don't exist); rejected on principle for a competitive RTS.

---

## ADR-002 — ECS-lite (Custom, No Library)

**Status:** Accepted
**Date:** 2026-08-07

**Context:** The sim must serialize to identical integers, iterate hundreds of entities cache-efficiently, and run in browser + Node. Libraries like `bitecs` exist but add abstraction we must trust in determinism-critical paths.

**Decision:** An in-house ECS-lite: integer entities, sparse-set component stores, fixed-order system pipeline. No ECS dependency.

**Where it lives:**
- `client/src/ecs/sparse-set.ts` (the component store)
- `client/src/core/world.ts` (the `World` holding every component set: `transforms`, `units`, `buildings`, `healths`, `visions`, `attacks`, `moves`, `queues`, `harvesters`, `fields`, `oilFields`, `works`, `wrecks`, `satelliteMarkers`, `grenades`, `smokes`, `planes`, `lasers`, `airstrikes`, `empPulses`, `scenery`, `mines`, `transports`)
- `client/src/systems/registry.ts` (`SYSTEMS` fixed iteration order — determinism depends on this list)

**Consequences:**
- **For:** complete control of iteration order (determinism); integer-serializable components; zero magic; runs headless in Node (the host imports the same classes for bots — ADR-019 — and tests run in `tests/`).
- **Against:** we own the machinery (the ECS itself is exercised mainly through the sim/determinism tests).

**Why not OOP?** Component-only data serializes trivially to the wire; OOP object graphs don't. "Air units", "cloaked units", transports etc. were component+system changes, not class-hierarchy surgery.

---

## ADR-003 — PixiJS 8 / WebGL 2D Isometric Renderer

**Status:** Accepted
**Date:** 2026-08-07

**Context:** Need to draw hundreds-to-thousands of simple shapes at 60 FPS now, and use sprite atlases later, all with minimal effort. Candidates: pure Canvas 2D, PixiJS (WebGL 2D), Three.js (WebGL 3D).

**Decision:** PixiJS 8 (`pixi.js` `^8.6.0` in `client/package.json`), 2D isometric projection (`ISO_HALF_W = 32`, `ISO_HALF_H = 16`). A 3D renderer is unnecessary for the shipping game; it remains research only (`docs/10-3D-GRAPHICS-TIER-RESEARCH.md`).

**Where it lives:**
- `client/src/render/camera.ts` (iso world→screen / screen→world math, zoom/pan)
- `client/src/render/renderer.ts` (painter's algorithm: per-sprite `spr.zIndex = isoY`, plus fixed layer bands `FIXED_Z_GROUND (-80) … FIXED_Z_DEBUG (1000)`; dev-tunable sub-layer offsets)
- `client/vite.config.ts` (`manualChunks: { pixi: ['pixi.js'] }` keeps the engine in its own chunk)

**Consequences:**
- **For:** GPU batching; texture-baked shapes reach sprite-grade perf today; PixiJS handles DPR scaling + resize.
- **Against:** ~a few hundred KB dependency; WebGL required (fine: every target browser has it).

**Why not Three.js?** No real 3D geometry/camera needed; iso projection is a 2D transform. See doc 10 for the (unimplemented) 3D-tier plan.

---

## ADR-004 — Node.js Host as a Pure Command Relay + Static Server

**Status:** Accepted (refined by ADR-019)
**Date:** 2026-08-07

**Context:** "One player hosts, others join" over LAN. The host player must run the server on their own machine with minimal friction.

**Decision:** A tiny Node process: HTTP static server for `client/dist` + `ws` WebSocket server + room manager + command relay (`TickRelay`). The host does not simulate for human players and cannot inject state.

**Where it lives:**
- `host/src/index.ts` (`CLIENT_DIST = resolve(HOST_BASE, '../../client/dist')` — the static root; also the runtime sprite-bundle builder, see ADR-014)
- `host/src/rooms.ts` (room lifecycle, map patches validated with `validateMap`)
- `host/src/relay.ts` (`TickRelay`)
- The host has since grown extra *non-sim* duties — LAN discovery (`host/src/discovery.ts`), invite QR codes (`host/src/qr.ts`), replay archiving (`host/src/archive.ts`), mod intake (`host/src/mods.ts`), passphrase hashing (`host/src/passphrase.ts`) — none of them run the match sim.

**Consequences:**
- **For:** no admin rights needed beyond binding a port; testable in CI; provably thin attack surface for state injection.
- **Against:** players must have Node installed (acceptable for LAN play; the `online/` workspace covers the no-Node case).

**Alternative considered:** WebRTC/PeerJS (host in browser, zero server) — rejected: STUN/NAT complexity and unreliable-channel handling for a benefit that matters less than reliable lockstep over TCP.

---

## ADR-005 — LAN Security = Passphrase Hash Gate + Integrity Checks (No Per-Command Crypto)

**Status:** Accepted — mechanism verified; one original claim corrected (see below)
**Date:** 2026-08-07

**Context:** Rooms must be gated against wrong-room joins and casual interference, but this is a trusted-LAN tool, not a public internet service.

**Decision:**
- The client hashes the passphrase itself — WebCrypto `PBKDF2` (pure-TS fallback in `client/src/net/pbkdf2.ts`), salt `space-arenas:<roomCode>`, 100 000 iterations, 32 bytes, SHA-256 — and sends only the hash in `C_JOIN` (`client/src/net/net.ts` `hashPassphrase`/`join`). The host computes the identical hash with `node:crypto` `pbkdf2Sync` (`host/src/passphrase.ts`, `online/src/passphrase.ts`) and compares; the plaintext never reaches the server.
- Integrity: the relay stamps every command with `(player, seq, tick)` server-side (`TickRelay.submit` — clients cannot spoof the player id), and each client broadcasts a CRC32 world hash every 60 ticks (`client/src/systems/sync-system.ts`, relayed via `encodeRelayChecksum`).
- **No per-command signing, no TLS requirement on LAN.**

**Correction to the original record:** a desync does **not** halt the match. `Game.onNetChecksum` (`client/src/game/Game.ts`) compares the relayed hash against the local `pendingChecks` entry; a mismatch only flips `syncOk`, which the HUD surfaces as a `DESYNC!` warning (`client/src/ui/hud.ts`). This is deliberate — a visible warning beats a frozen game on a flaky LAN.

**Consequences:**
- **For:** trivial UX (one passphrase), no key management, honest-mistake protection, active desync *detection*.
- **Against:** not secure against an adversary who controls the host machine or the LAN. Explicitly **out of scope** and documented as such.

**Why not full crypto?** Lockstep already makes each client the source of truth for its own commands; per-command signatures add a key-distribution problem with no security gain inside a trusted LAN. Internet play is the `online/` workspace's concern (`online/src/ratelimit.ts`, `online/src/supabase.ts`).

---

## ADR-006 — Integer-Only Simulation State

**Status:** Accepted
**Date:** 2026-08-07

**Context:** Cross-engine, cross-browser determinism is the #1 project risk. JS floats are IEEE-754 (deterministic *within* one engine), but decimal round-trips and JIT variants make float state fragile.

**Decision:** Sim state is **integer-only**. Positions are fixed-point with 3 decimals (`FX = 1000`: `tile * 1000`). The wire format transmits integers only. `Math.sqrt`/`sin`/`cos` and `Math.random()`/`Date.now()` are banned inside sim code (verified: no `Math.random`/`Date.now` anywhere under `client/src/systems/`; distance uses integer `isqrt`).

**Where it lives:**
- `shared/src/fixed.ts` (`FX`, `tileToFx`, `fxToTile`, `sqDist`, `isqrt`, `dist`)
- `shared/src/rng.ts` (seeded `RNG` / `hashSeed` — the only randomness source)
- `client/src/core/hash.ts` (hash serialization writes every number as big-endian int32 — the hash is exact only under this rule)

**Consequences:**
- **For:** byte-identical behavior across engines; trivially serializable; the state hash is exact.
- **Against:** clumsier math (lookup tables); precision decisions must be made once and documented (they are: fixed-point ×1000).

---

## ADR-007 — Fog of War Is Computed, Never Sent

**Status:** Accepted
**Date:** 2026-08-07

**Context:** Fog board is 1 byte/tile/player; sending it per-tick wastes bandwidth; recomputing it is deterministic.

**Decision:** Fog is derived from `Vision` components each tick. No fog message exists in the protocol.

**Where it lives:** `client/src/systems/vision-system.ts` (`world.fog` per team, 0 = unexplored / 1 = remembered / 2 = visible; decay driven by `fogMode`: `memory` | `classic` | `hard` — `FOG_MODES` in `shared/src/constants.ts`).

**Consequences:**
- **For:** zero bandwidth cost; no fog-specific sync bugs; vision-based features (satellite, radar, stealth detection) are component/system changes.
- **Against:** costs sim CPU (mitigated by direct array writes + a low-res render texture).

---

## ADR-008 — Maps: One Schema, One Validator, Everywhere (Revised)

**Status:** Revised — the original record's "CRC32 checksum embedded in the file" claim is **not implemented** and has been dropped
**Date:** 2026-08-07 (revised)

**Context:** Map builder, client, and host all touch maps. Divergent parsers = impossible-to-diagnose bugs.

**Decision:** One schema (`MapData` in `shared/src/maps.ts`) and one structural validator (`validateMap()` — format tag, size range, tile-array length, spawn/supply/obstruction bounds, brightness range) used by every surface. A map rejected anywhere never reaches a match.

**Where it lives:**
- `shared/src/maps.ts` (`Terrain`, `MapData`, `validateMap`, `MAP_PRESETS`, `mapForPreset`)
- `client/src/mapbuilder/builder.ts` + `client/src/mapbuilder/library.ts` (builder export/import)
- `host/src/rooms.ts` and `online/src/rooms.ts` (host-set map patches validated server-side)
- `online/src/maps.ts` (stored/published maps)
- `tests/maps.test.ts`

**Transport guarantee:** maps travel *inside* the `S_MATCH_START` message (`shared/src/protocol.ts` `MatchStartMessage.map`), so every client simulates the exact same `MapData` the host chose — no out-of-band file exchange.

**Not implemented (was in the original record):** an embedded per-file CRC32 checksum and enforced canonical key order. `MapData` has no checksum field today. See "Planned / not yet implemented".

---

## ADR-009 — Single Faction in v1

**Status:** Accepted
**Date:** 2026-08-07

**Context:** Three asymmetric factions triples balance/content/art work and endangers the LAN-first milestone.

**Decision:** One faction ("Space Legion") with a complete build tree exercising *every* system. All balance data is data, so future factions are content drops, not code surgery.

**Where it lives:** `shared/src/balance/buildings.ts` (11 buildings: command-center, power-plant, supply-dock, barracks, war-factory, turret, tech-center, air-force, super-weapon, bunker, dock), `shared/src/balance/units.ts` (13 units: bulldozer, harvester, scout, rifleman, rocket-trooper, assault-walker, aa-platform, artillery, engineer, apc, fighter, carrier, missile-boat), `shared/src/balance/weapons.ts`, `shared/src/balance/upgrades.ts`, re-exported via `shared/src/balance/index.ts`.

**Consequences:**
- **For:** proves all systems with minimal content surface; balance is data (ADR-020 makes even third-party tweaks data).
- **Against:** less content variety; accepted.

---

## ADR-010 — Procedural Shapes First, Real Assets Behind the Same Seams

**Status:** Partially shipped — PNG sprites (high quality) and real WAV/MP3 audio have landed; the full manifest→atlas pipeline has not
**Date:** 2026-08-07

**Context:** Dev phase needs instant iteration on gameplay; required upfront art would block everything.

**Decision:** All visuals are generated shapes; all audio has a WebAudio synth fallback. The render seam (`visualId → factory` in `client/src/render/shapes.ts`) and the audio seam (`SimEvent → sound kind` in `client/src/audio/hooks.ts`) are designed so real assets swap in without touching sim/netcode.

**Shipped since:** `high` quality renders pre-baked PNG sprites from `client/dist/<folder>/<colorIndex>/<folder>_<frame>.png` (8 frames per color, 10 color subfolders; loaded by `client/src/render/building-sprites.ts`, plus a runtime single-fetch bundle — ADR-014). Audio ships real WAV files per kind plus a lobby MP3 (`docs/11-SOUND-FX-GENERATION.md`).

**Not shipped:** texture atlases, a manifest-driven content pipeline, sprite work for every unit on every quality level (units without sprite folders fall back to vector shapes at all qualities). `scripts/validate-assets.mjs` validates the PNG tree.

**Where it lives:** `client/src/render/shapes.ts`, `client/src/render/building-sprites.ts`, `client/src/audio/hooks.ts` (`synthSfx` fallback), `scripts/validate-assets.mjs`.

---

## ADR-011 — Protocol Versioning Is Strict

**Status:** Accepted (numbers updated: now 22 / 20)
**Date:** 2026-08-07

**Context:** Host and clients can be different builds. Stat data must match across the wire.

**Decision:** An integer `PROTOCOL_VERSION` gates the lobby; existing message types are never mutated — add new types or bump the version; round-trip codec tests are mandatory for every message.

**Where it lives:**
- `shared/src/constants.ts`: `PROTOCOL_VERSION = 0x5c ^ 0x4a` (**22**; XOR-written so the plain number isn't trivially greppable in a minified bundle — explicitly a speed bump, not a security boundary), `MIN_PROTOCOL_VERSION = PROTOCOL_VERSION - 2` (**20**; UX/policy only — the *real* gate is server-side frame validation, so a patched client that speaks a changed wire format is rejected regardless of the integer it claims)
- `shared/src/protocol.ts` (binary wire: `BIN` tags, `encodeFrame`/`decodeEnvelope`, `encodeRelayChecksum`, `validateCommandBytes`)
- `online/src/index.ts` (join-time protocol band check + server-side command-frame validation)
- `tests/protocol.test.ts` (round-trip codec tests)

**Consequences:**
- **For:** version skew is caught at the lobby with a friendly message, never mid-match; no silent desyncs from stat drift.
- **Against:** adding a field to a message is a version bump (slightly slower iteration; acceptable).

---

## ADR-012 — Reconnect: Online Grace Window Shipped, LAN Drop Still Ends the Slot (Partially shipped)

**Status:** Partially shipped — the online reconnect path exists; the original "no reconnect anywhere" claim is superseded for online rooms
**Date:** 2026-08-07

**Context:** A client dropping mid-match breaks lockstep (the tick authority must progress). Reconnect requires either a command-log catch-up or state transfer.

**Decision (v1):** No mid-match reconnect; a dropped LAN slot idles (or is forfeited via `TickRelay.submitForfeit` → a `forfeit` command); a host drop ends the match.

**Shipped since (online rooms only):** each client sends a persistent per-browser `clientId` in `C_JOIN` (`shared/src/protocol.ts`); on disconnect the server opens a **grace window** (`online/src/index.ts` `reconnectTimers`, `online/src/rooms.ts` `reconnectPlayer`) and reclaims the same slot when the same `clientId` returns, sending `S_MATCH_START … resumed: true`. The reconnected client catches up deterministically by replaying the relayed command log from tick zero (`Game.stepToTickSync` in `client/src/game/Game.ts`, seeded from `SpectateSync` history — the same mechanism late-joining spectators use). Spectators never bank daily missions; a resumed slot continues as a spectator-style catch-up.

**Still true:** LAN host drop = match over; **no host migration** anywhere; **no checkpoint save/restore** (catch-up replays the full command log, which grows linearly).

**Where it lives:** `online/src/index.ts`, `online/src/rooms.ts` (`reconnectPlayer`), `shared/src/protocol.ts` (`clientId`, `resumed`), `client/src/game/Game.ts` (`startNet`, `stepToTickSync`, `attachNet`).

---

## ADR-013 — World-State Hash = CRC32

**Status:** Accepted — supersedes the prototype's FNV-1a world hashing
**Date:** post-prototype

**Context:** Desync detection needs a single number that is byte-identical across every client's sim. The prototype used an FNV-1a-based world hash; it was replaced when the hash needed to cover the full component set with exact int32 serialization.

**Decision:** `hashWorld(world)` serializes tick, map size, RNG state, coop settings, every team's economic/ability state, then every component of every entity (fixed component list, numbers as big-endian int32, strings char-by-char) and folds the bytes with **CRC32** (`crc32` from `shared/src/protocol.ts`). The hash is recomputed every tick; every 60th tick it is broadcast to all peers and compared.

**Where it lives:** `client/src/core/hash.ts` (`hashWorld`, `compactHash`), `client/src/systems/sync-system.ts` (60-tick `onSyncTick`), `client/src/game/Game.ts` (`pendingChecks` / `onNetChecksum`), `host/src/relay.ts` (`relayChecksum` relay).

**Consequences:**
- **For:** one cheap function covers all sim state; CRC32 is tiny and dependency-free; mismatch is caught within 2.4 s.
- **Against:** the component list in `hashWorld` must be extended whenever a new component store is added — forgetting it weakens (but never breaks) desync detection.

---

## ADR-014 — `client/dist` Is the Committed Asset Root; Builds Must Not Wipe It

**Status:** Accepted
**Date:** post-prototype

**Context:** Game assets (sprites, sounds, background, index.html for the host to serve) live under `client/dist`, but Vite's default `emptyOutDir: true` would delete them on every build.

**Decision:** Vite outputs to `dist` with **`emptyOutDir: false`**, and the Node host serves that folder directly as the web root. Assets are therefore ordinary tracked files next to build output; builds only ever *add* hashed bundles.

**Where it lives:**
- `client/vite.config.ts` (`outDir: 'dist'`, `emptyOutDir: false` with the comment "assets live inside client/dist (object/color/image) and must survive builds")
- `host/src/index.ts` (`CLIENT_DIST` static root, path-traversal guard `filePath.startsWith(CLIENT_DIST)`)
- Asset folders under `client/dist/`: `<folder>/<colorIndex>/…` sprite trees, `sound/`, `background/`, `hud/`, `assets/`
- **Consequence accepted:** old hashed JS/CSS chunks accumulate in `client/dist/assets` across builds (visible in the tree); they are harmless but never auto-pruned.

**Progressive-load companion:** for slow links the host concatenates every PNG under `client/dist` into one runtime-built bundle served at `assets/sprites.bundle` (`buildSpriteBundle` in `host/src/index.ts`); the client consumes it via `client/src/render/sprite-bundle.ts` and falls back to per-file crawling when the bundle is absent. The bundle is **generated at host startup**, not committed.

---

## ADR-015 — Settings Are Layered: Compiled Defaults → `settings.json` (builtin/user) → Session Overrides

**Status:** Accepted
**Date:** post-Day-settings-file

**Context:** Dev-settings values must survive browser-origin changes, be shareable between host and guests, yet allow a per-session "poke" without polluting the saved defaults.

**Decision:** Three layers:
1. Compiled `DEFAULT_MATCH_SETTINGS` (`shared/src/constants.ts`) — the base.
2. `profile/settings.json`, fetched via the host `/api/settings` endpoint, with a `builtin` layer and a `user` layer ("Save as default" writes `user`), plus a `client` bag for non-synced client-only values (graphics/audio/profile).
3. Per-session `devOverrides` in localStorage — the Dev Settings panel's live edits, layered *over* the saved defaults and deep-merging the four per-entity override maps (`buildingOverrides`/`unitOverrides`/`weaponOverrides`/`upgradeOverrides`) field-by-field.

The effective **defaults** fingerprint (`fingerprintSettings`, canonical-JSON CRC32) is broadcast in the lobby so clients can tell whether their base matches the host's. When client values cross machines (clone, mod, settings import), `sanitizeClientDevSettings` neutralises foreign-origin absolute asset/audio URLs to `''` ("use the bundled default").

**Where it lives:**
- `shared/src/settings-file.ts` (`MatchSettingsFile`, `resolveSettingsFileLayers`, `fingerprintSettings`, `sanitizeClientDevSettings`, `ClientDevSettings`)
- `client/src/main.ts` (`devOverrides` / `savedDefaults`, keys `space-arenas:dev-settings` and `space-arenas:dev-defaults`, `layerDevSettings`, `resolvedDevSettings`, `settingsDefaultsHash`)
- `shared/src/dev-settings-registry.ts` (`DEV_SCALAR_SECTIONS`, `DEV_OVERRIDE_*_FIELDS` — single source of truth for the client form, the host sanitizer and the mod clamps)

**Consequences:**
- **For:** defaults survive fresh browser origins; static hosting (online-only) degrades gracefully to compiled defaults + localStorage; sync chips can flag "Same / Different" per player.
- **Against:** three layers to reason about — mitigated by keeping the layering logic in one function per layer.

---

## ADR-016 — Daily/Profile Tracking Toggles Are Client-Local, Never Broadcast

**Status:** Accepted
**Date:** post-Day-19

**Context:** Whether a match counts toward the daily mission list or the player's profile is a *personal* concern (grinding, achievements), not a shared match rule. Broadcasting it would leak preferences and invite tampering.

**Decision:** Two boolean toggles — `trackDaily` (accept/skip daily missions) and `trackProfile` (count toward profile counters/history/achievements) — live in the local `MatchConfig`/`startNet` options only. They exist in no protocol message and no `MatchSettings` field. Spectators never bank daily missions regardless of the toggle.

**Where it lives:**
- `client/src/game/match.ts` (`MatchConfig.trackDaily` / `trackProfile`)
- `client/src/game/Game.ts` (`startNet(net, msg, opts?)` reads `opts.trackDaily`/`opts.trackProfile`; omitted opts default to historical behaviour — `trackDaily: false`, `trackProfile: true`)
- `client/index.html` + `client/src/main.ts` (`#match-daily-toggle`, `#match-achieve-toggle` in the shared match-options panel used by LAN and online; `netTrackingOpts()`; offline panel has its own `#daily-accept-toggle` / `#match-profile-toggle`)

**Consequences:**
- **For:** privacy and tamper-resistance for free; nothing to sync or version.
- **Against:** a hacked client can lie about its own tracking — accepted, it only affects that player's local profile.

---

## ADR-017 — Collapsible Lobby Sections via Native `<details>`

**Status:** Accepted
**Date:** post-lobby-UI

**Context:** The lobby/lobby-settings UI grew many option groups (map, players, mods, sync panel, dev panel). A JS-toggled accordion adds state, event wiring and accessibility debt.

**Decision:** Every group is a native `<details class="match-section">` / `<details class="dev-group">` with a styled `<summary>`; the Dev Settings panel builds its section and per-object collapsibles programmatically with `document.createElement('details')`. Collapsing is free, keyboard-accessible, and needs zero state management.

**Where it lives:**
- `client/index.html` (dozens of `<details class="match-section" …>` blocks — offline panel, LAN/match panel, mods pickers, `#sync-panel`)
- `client/src/main.ts` (`appendDevSection`, `appendDevItemHeader` — `details.dev-group`)
- `client/src/styles.css` (`.match-section`/`.dev-group` summary styling, `▸`/`▾` markers via `::before`)

**Consequences:**
- **For:** zero-JS interop, RTL-safe (no directional icons), browser-native semantics.
- **Against:** open/closed state is not persisted between visits (sections reopen expanded by default) — accepted for now.

---

## ADR-018 — i18n: English + Arabic Only; RTL Is First-Class

**Status:** Accepted
**Date:** post-i18n

**Context:** The game targets a bilingual audience. Every additional language doubles translation maintenance and QA surface.

**Decision:** Exactly two locales — `en` and `ar`. The language switch sets `document.documentElement.lang` **and `dir` (`rtl` for Arabic)**, so layouts must be direction-agnostic (logical CSS, no hard-coded left/right icons — cf. ADR-017). Dictionary parity is enforced by check scripts, not by runtime code.

**Where it lives:**
- `client/src/i18n/index.ts` (`type Lang = 'en' | 'ar'`, `dicts`, `setLang`, `applyLangAttrs` sets `dir`)
- `client/src/i18n/lang/en.json`, `client/src/i18n/lang/ar.json`
- `docs/check-i18n.cjs`, `docs/check-registry-i18n.cjs` (parity/consistency checks over the dictionaries)

**Consequences:**
- **For:** a complete, honestly-maintained bilingual product; RTL bugs surface early because RTL is exercised constantly.
- **Against:** no third language without a new ADR (adding one is a dictionary + `Lang` union change — cheap, but a maintenance promise).

---

## ADR-019 — Server-Side Bots Run a Host-Side Shadow Simulator

**Status:** Accepted — refines ADR-001/ADR-004 ("the host never simulates" now means "never *for humans* and never *on the wire*")
**Date:** post-net-bots

**Context:** Network matches want AI opponents in bot slots, but the relay-only host has no sim to ask "what would the bot do this tick?".

**Decision:** The host may construct a **private deterministic simulator** stepped with the exact command set it broadcasts, and use it *only* to produce bot commands, which are injected into the relay stamped with the bot's player id. Clients never special-case bot slots — bot commands arrive in the normal frame stream, so a bot player is indistinguishable from a laggy human.

**Where it lives:** `host/src/bots.ts` (`NetBotRunner` — imports `client/src/ai/bot.ts` `BotPlayer` and `client/src/core/Simulator.ts`; `commandsForTick()` + `step(commands)` called from `TickRelay.broadcastFrame`).

**Consequences:**
- **For:** bots in online/LAN rooms with zero protocol changes; the shadow sim is the same deterministic sim, so replays including bots stay valid.
- **Against:** the host now pays sim CPU proportional to bot count (bounded by bot slots); the "host cannot influence the match" property holds only because bot commands go through the same stamped relay path as human commands.

---

## ADR-020 — Balance Mods Are Delta Files, Sanitized Server-Side

**Status:** Accepted
**Date:** post-mods

**Context:** Players want to tweak balance without forking the sim. Whole-definition-table replacement is impossible to validate and trivially breaks determinism for other players.

**Decision:** A "balance mod" is a JSON file of **deltas** — scalar `settings` plus the same four per-entity override maps the dev panel uses (`buildingOverrides`, `unitOverrides`, `weaponOverrides`, `upgradeOverrides`) — riding the existing override-aware accessors and the host sanitizer whitelist. Mods never deep-merge whole tables and never change sim logic; a `requireProtocol` field gates compatibility. The host broadcasts the mod file; clients install it and acknowledge with a canonical-JSON CRC32 hash (`C_MOD_ACK`).

**Where it lives:** `shared/src/mod.ts` (`ModFile`, `modHash`, `canonicalJson`, `requireProtocol`), `host/src/mods.ts`, `online/src/mods.ts`, `client/src/main.ts` (`modFromSettings`, `modSettingsDelta`, `modHash`), lobby UI pickers `#offline-mods-picker` / `#match-mods-picker` in `client/index.html`.

**Consequences:**
- **For:** mods are data the pipeline already understands; the host clamps (`DEV_SANITIZE`/`DEV_OVERRIDE_CLAMP` ranges in `shared/src/dev-settings-registry.ts`) are the wire ceiling; hash mismatch is caught in the lobby.
- **Against:** mods cannot change *mechanics*, only numbers — by design.

---

## Index

| # | Topic | Status |
|---|---|---|
| 001 | Deterministic lockstep; sim on clients, commands on the wire | Accepted |
| 002 | Custom ECS-lite, no library | Accepted |
| 003 | PixiJS 8 / 2D isometric renderer | Accepted |
| 004 | Node host = static server + pure command relay | Accepted (refined by 019) |
| 005 | Passphrase hash gate + CRC32 integrity checks; desync = warning | Accepted (halt claim corrected) |
| 006 | Integer-only simulation (fixed-point ×1000) | Accepted |
| 007 | Fog of war computed, never sent | Accepted |
| 008 | Maps: one schema + one validator everywhere | Revised (embedded checksum dropped — planned) |
| 009 | Single faction in v1 | Accepted |
| 010 | Procedural shapes first; real assets behind the seams | Partially shipped |
| 011 | Strict protocol versioning (22 / MIN 20, XOR-written) | Accepted |
| 012 | Reconnect: online grace window shipped; no host migration | Partially shipped |
| 013 | World hash = CRC32 (supersedes prototype FNV-1a) | Accepted |
| 014 | `client/dist` committed asset root; `emptyOutDir: false` | Accepted |
| 015 | Settings layers: defaults → `settings.json` → `devOverrides` | Accepted |
| 016 | Tracking toggles are client-local, never broadcast | Accepted |
| 017 | Collapsible UI via native `<details>` | Accepted |
| 018 | i18n EN + AR only; RTL first-class | Accepted |
| 019 | Host-side shadow simulator for net bots | Accepted |
| 020 | Balance mods as sanitized delta files | Accepted |

### Shipped since the original index (formerly "Proposed")
- *Hosted matchmaking broker* → shipped as the `online/` workspace (`online/src/index.ts`, `rooms.ts`, `relay.ts`, `ratelimit.ts`, `supabase.ts`).
- *Replay / spectator format* → shipped (`shared/src/replay.ts` `ReplayData`; host archive in `host/src/archive.ts`; spectator catch-up replays the relay command log).
- *Superweapon mechanics* → shipped (laser / airstrike / EMP with upgrade levels — `AIRSTRIKE_MAX_LEVEL`, `EMP_MAX_LEVEL`, `laserLevel` in `shared/src/constants.ts`; systems `laser-system.ts`, `airstrike-system.ts`, `emp-system.ts`).

### Planned / not yet implemented
- Embedded map checksum + canonical key order (ADR-008 revision).
- Deterministic checkpoint save/restore (reconnect currently replays the whole command log; a checkpoint would bound the catch-up cost).
- TLS / server-side auth for non-LAN deployments of the LAN host.
- Host migration on LAN.
- A third i18n language (would supersede ADR-018).
- A 3D graphics tier (research only — `docs/10-3D-GRAPHICS-TIER-RESEARCH.md`).
