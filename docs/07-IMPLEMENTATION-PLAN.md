# 07 — Implementation Plan

**Project:** Space Arenas — RTS game
**Version:** 0.1
**Companion docs:** 04-ARCHITECTURE.md (what to build), 09-TESTING-AND-QA.md (how to verify), 08-DECISIONS.md (why)

The roadmap from empty repo to LAN-playable v1. Each phase ends with **acceptance criteria** that gate the next phase. Estimates assume one focused engineer; double for a solo dev splitting time.

---

## Phase 0 — Documentation (DONE)

The nine design docs + README + AI-INSTRUCTIONS are written. Repository is doc-only.

**Exit criteria:** docs reviewed, all open questions in 01 § 12 triaged, this plan approved.

---

## Phase 1 — Prototype (the vertical slice) ✅ COMPLETE

**Goal:** prove the three riskiest things end-to-end: the deterministic sim loop, the isometric renderer, and LAN host/join — with a barely-playable RTS.

### 1.1 Workspace scaffold
- [x] npm workspaces (`shared`, `client`, `host`, `mapbuilder`) + root scripts (`dev`, `build`, `test`, `lint`).
- [x] TypeScript strict configs; ESLint + Prettier; Vitest wired; shared code aliased for HMR.
- [x] CI stub (GitHub Actions): `lint → typecheck → test → build`.

### 1.2 Shared core
- [x] `shared/rng.ts` — seeded PRNG (Murmur-like finalizer) + unit tests (known vectors).
- [x] `shared/protocol.ts` — message schema (lobby + command + checksum families), binary codec for commands, CRC32 checksums, `PROTOCOL_VERSION`.
- [x] `shared/maps.ts` — map schema + `validateMap()` + procedural generation for 8 map variants.
- [x] `shared/balance/` — buildings/units/weapons/upgrades data tables with runtime override system.

### 1.3 Engine (client)
- [x] `World` class, Map-backed sparse-set component stores, entity allocator.
- [x] Fixed-timestep loop (25 Hz sim / rAF render) with accumulator clamp + interpolation (04 § 2).
- [x] Systems pipeline in fixed order: 15 systems registered in `registry.ts`.
- [x] **Determinism harness:** `Simulator` (headless, 2+ players) + CRC32 state hash + determinism tests.

### 1.4 Rendering (client)
- [x] PixiJS 8 app boot, DPR-aware canvas (Protocol 3, 04 § 6.2).
- [x] Isometric camera (pan/zoom/edge pan), tile→screen transform, culling.
- [x] Shape factories for terrain + units + buildings; team-color texture baking.
- [x] Selection rings, movement waypoints, build ghost preview.
- [x] Fog of war: radius-based reveal overlay with fog fade, dirty-tile low-res texture.

### 1.5 Input & UI shell
- [x] Mouse: select/box-select/right-click move + attack-move; camera controls.
- [x] Keyboard: core hotkeys (`A/S/H`, control groups, `Esc`), fully rebindable.
- [x] HUD: resource panel (credits + power), selection info bar, build menu, production queue.
- [x] Audio placeholder hooks wired to events (Web Audio API procedural tones).

### 1.6 Netcode (host + client) — the other big risk
- [x] Host: Node `ws` server, HTTP static serving, `RoomManager`, lobby (join/leave/ready), passphrase PBKDF2 verify.
- [x] Client: WebSocket connect, lobby screen, room code + passphrase entry.
- [x] Lockstep relay: command buffering, frame assembly by tick, clock sync (RTT moving average + buffer), checksum broadcast every 60 ticks.
- [x] **Two-machine LAN test:** host + 1 client, both render identical state, checksums match.
- [x] Desync halt + diagnostic dump on mismatch.

### 1.7 Prototype gameplay (minimal, Generals-shaped)
- [x] Command Center + Power Plant + Supply Dock (Harvester auto-trip) + Barracks + Rifleman/Scout.
- [x] Building placement validation (footprint, terrain, build radius), build timers, cash deduction.
- [x] Unit move + basic auto-attack; win/loss check (destroy enemy CC).
- [x] Default maps in `shared/balance/` (8 procedural variants) + start script.

**Phase 1 exit criteria:**
- [x] 2-player LAN match: full lobby → play 15 min → clean win/loss, zero desyncs.
- [x] `npm test` green incl. determinism test (same command stream → same hash).
- [x] 60 FPS with 200 moving units on the mid-tier reference machine (03 § 11).
- [x] Load time < 2 s served over LAN from host.

---

## Phase 2 — Alpha (the full Generals core) ✅ COMPLETE

**Goal:** a complete single-faction RTS with the full build tree, real combat, fog of war, pathfinding, and a usable map builder.

### 2.1 Full content
- [x] All buildings + units from 02 § 3 (9 buildings, 8 units, 7 weapons, 3 upgrades).
- [x] Production queues, power-down mechanic, sell/refund rules.
- [x] Combat: weapon table, armor multipliers, cooldowns, splash damage, deterministic target acquisition.
- [x] Deaths, damage feedback (HP bars, flashes), alert system, combat statistics tracking.

### 2.2 Pathfinding
- [x] A* on tile grid with dirty-region rebuilds (04 § 7 pooling), repath on timeout, formation move.
- [x] Grid obstacle updates when buildings place/sell.
- [x] Determinism tests: path found must be byte-identical across runs; blocked scenarios.

### 2.3 Fog of war
- [x] Revealed/fog/shroud board, dirty-tile low-res texture overlay (04 § 6.3), fog fade.
- [x] Vision component changes propagate deterministically; fog is computed, never sent.
- [x] Satellite reconnaissance and laser vision modes.

### 2.4 Multiplayer hardening
- [x] 2–8 players, team assignment (1v1, 2v2, FFA), host map selection + broadcast.
- [x] Adaptive buffer depth, disconnect handling + host-loss end.
- [x] Passphrase flow end-to-end; wrong-code/wrong-passphrase UX.

### 2.5 Map Builder
- [x] Terrain paint (ground/cliff/water/road/buildable), height hints.
- [x] Obstruction placement, supply field placement, spawn point setup, starting state editor.
- [x] Validation + save to localStorage library + load from file + world import.
- [x] Builder preview renders with the same renderer (identical look). Integrated into client.

### 2.6 Additional features (beyond original spec)
- [x] AI bots with 3 difficulty levels, build orders, army management, oil claiming.
- [x] Oil field economy (claiming, income ticks, destruction).
- [x] Destructible scenery (trees, rocks) with crush damage.
- [x] Air units with orbit mechanics, ammo/reload.
- [x] Space laser superweapon with cooldown and targeting.
- [x] Upgrades system (radar, satellite, space-laser research).
- [x] Work/repair system (dozer construction, repair to full HP).
- [x] LAN auto-discovery via UDP beacon.
- [x] QR code invite links.
- [x] Chat system (lobby + in-game).
- [x] Weather effects (rain, snow, thunder).
- [x] i18n with English + Arabic + RTL support.
- [x] 121+ passing tests.

**Phase 2 exit criteria:**
- [x] Full build tree playable; economy/power/combat/fog/pathing all functional in 4+ LAN matches.
- [x] 8-player FFA runs 20 min with zero desyncs on LAN.
- [x] Map builder can reproduce the default map 1:1 (checksum-valid).
- [x] `npm test` green incl. pathfinding + fog determinism suites.

---

## Phase 3 — Beta & Release

**Goal:** performance hardening, robustness, cross-browser QA, packaging.

### 3.1 Performance (Protocol 2)
- [ ] Zero-alloc tick audit: profiler overlay; fix hot allocations; CI allocation gate (04 § 7.3).
- [ ] Object pooling complete for commands/events/path buffers/effects.
- [ ] Fog + render batching tuned; verify 400 entities / 60 FPS on mid-tier, 30 FPS floor on low-tier (03 § 11).
- [ ] Long-session memory test: 60-min 2v2 with heap < 200 MB, no GC pause > 50 ms.

### 3.2 Robustness
- [ ] Fail-safe checksums everywhere (already in Phase 1–2); add full-state FNV-1a each tick in debug.
- [ ] Frame-gap resend stress test (inject artificial drops); reconnect-after-drop UX.
- [ ] Browser backgrounding behavior verified (04 § 11).

### 3.3 Cross-browser & cross-OS QA
- [ ] Chrome / Edge / Firefox matrix (latest 2 versions) — Playwright E2E suite.
- [ ] Windows / macOS / Linux host-process tests (ws server + HTTP serving).
- [ ] DPR/zoom/resize regression suite (Protocol 3).

### 3.4 Packaging & distribution
- [ ] `npm run build` produces: `client-dist`, `mapbuilder-dist`, single-file `host` bundle.
- [ ] Host launcher script (`run-lan.ps1` / `run-lan.sh`): prints LAN IP + URL + room code.
- [ ] README quick-start rewritten as a 3-step LAN guide.
- [ ] Optional: simple offline installer-free zip for LAN party hosts.

### 3.5 Release candidate
- [ ] 5 consecutive 20-min matches, 4 different maps, 2–8 players, zero desync.
- [ ] All docs finalized; changelog written.
- [ ] Tag `v1.0.0-alpha` → `v1.0.0`.

**Phase 3 exit criteria:** v1.0.0 shipped; LAN test guide published in README.

---

## Phase 4+ — Post-v1 Backlog (Recorded, Not Committed)

- ~~Skirmish vs AI~~ ✅ Done (3 difficulty levels, build orders, army management).
- Second/third factions (uses `shared/balance` + shape configs only).
- Pre-rendered sprite + audio asset pass (pipeline already designed in 05).
- Replays & spectator mode (wire format leaves room).
- ~~Superweapon structures~~ ✅ Done (space laser with cooldown, targeting, area damage).
- Optional hosted matchmaking broker (transport-agnostic protocol).
- Save/restore via deterministic checkpoint (06 § 7).

---

## Dependency Graph (What Blocks What)

```
Phase 1.1 scaffold
  └─ 1.2 shared        └─ 1.3 engine
        └─ 1.4 render  └─ 1.6 netcode
              └─ 1.5 input/UI  └─ 1.7 gameplay
                    Phase 2 content/pathfinding/fog/net-hardening
                          └─ 2.5 map builder (needs 1.4 + 2.2)
                                Phase 3 perf/QA/packaging
```

- Map builder is scheduled late in Alpha because it reuses the renderer and pathfinding-grid validation; building it earlier duplicates work.
- Netcode starts early (Phase 1) because lockstep is the highest project risk — fail fast.

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Determinism bugs (float, iteration order) | High | Critical | Integer-only sim, ordering rule, hashing, fuzz tests (09) |
| PixiJS batching perf at 400+ entities | Medium | High | Texture baking (05 § 2.2), culling, fog low-res (04 § 6.3) |
| LAN host UX friction (IP/port/firewall) | Medium | Medium | Single URL print, 3-step guide, default port + UPnP note |
| Scope creep into 3 factions / real art | High | High | Guardrails in 01 § 9; exit criteria gate phases |
| WebSocket binary codec drift host/client | Medium | Medium | Shared `shared/protocol.ts` + round-trip tests |

---

## Definition of Done (per phase)

- All checklist items complete, exit criteria green.
- `npm run lint`, `npm run typecheck`, `npm test` pass.
- Docs updated to match any code-level decisions made during the phase.
