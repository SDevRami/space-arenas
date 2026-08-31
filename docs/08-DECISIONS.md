# 08 — Decisions (ADR)

**Project:** Space Arenas — RTS game
**Version:** 0.1
**Status conventions:** `Accepted` (decided), `Superseded` (replaced by newer ADR), `Proposed` (under review).

Architecture Decision Records capture *why* the project is built the way it is, so future contributors don't silently reverse a decision made under specific constraints.

---

## ADR-001 — Deterministic Lockstep over WebSocket (Accepted)

**Status:** Accepted
**Date:** 2026-08-07

**Context:** RTS multiplayer needs a fair, bandwidth-cheap, sync-correct architecture on a LAN. Options: (a) lockstep (identical sim everywhere), (b) host-authoritative state broadcast, (c) client-authoritative with arbitration.

**Decision:** Deterministic lockstep. The host Node process is a **pure relay** (commands + checksums), never a simulator. All clients run the identical simulation. Host's own browser client uses the same relay path as remote players.

**Consequences:**
- **For:** lowest bandwidth (< 20 KB/s/client); perfect fairness; no rubber-banding; trivial to extend to replays/spectators; no server sim load.
- **Against:** determinism is a hard engineering discipline (integer-only sim, fixed system order, seeded RNG — see 04 § 4); desyncs are unforgiving; host drops = match end (v1).

**Why not host-authoritative?** A LAN host simulating and broadcasting state has ~10× bandwidth and adds sim latency for clients; the complexity savings are small because the sim must be *replicated* for prediction anyway — lockstep reuses the identical replicated sim with zero extra state broadcast.

**Why not client-authoritative?** Open to cheats (units the client claims don't exist) and hard to keep fair; rejected on principle for a competitive RTS.

---

## ADR-002 — ECS-lite (Custom, No Library) (Accepted)

**Status:** Accepted
**Date:** 2026-08-07

**Context:** The sim must serialize to identical integers, iterate hundreds of entities cache-efficiently, and run in browser + Node. Libraries like `bitecs` exist but add abstraction we must trust in determinism-critical paths.

**Decision:** A ~400-line in-house ECS-lite: integer entities, sparse-set component stores, fixed-order system pipeline. No ECS dependency.

**Consequences:**
- **For:** complete control of iteration order (determinism), integer-serializable components, zero magic, runs headless in Node for tests.
- **Against:** we own the machinery (must test the ECS itself); less featureful than `bitecs` (we only need what we built).

**Why not OOP?** Component-only data serializes trivially to the wire; OOP object graphs don't. Also, adding "air units" or "cloaked units" later is a component+system change, not a class-hierarchy surgery.

---

## ADR-003 — PixiJS 8 / WebGL 2D (Accepted)

**Status:** Accepted
**Date:** 2026-08-07

**Context:** Need to draw hundreds-to-thousands of simple shapes at 60 FPS now, and drop in sprite atlases later, all with minimal effort. Candidates: pure Canvas 2D, PixiJS (WebGL 2D), Three.js (WebGL 3D).

**Decision:** PixiJS 8, shapes baked to textures at boot. Camera is a 2D isometric projection (2:1 tiles) — a 3D renderer is unnecessary.

**Consequences:**
- **For:** GPU batching = hundreds of entities trivially; texture-baked shapes reach sprite-grade perf today; PixiJS handles DPR scaling + resize; future sprite pass is a factory swap (05 § 1).
- **Against:** ~150 KB gzip dependency; WebGL required (fine: every target browser has it; Canvas fallback path exists but is not a goal).
- **Why not Three.js?** No real 3D geometry/camera needed; iso projection is a 2D transform; Three.js would add complexity with zero gameplay benefit.

---

## ADR-004 — Node.js Host as Pure Relay (Accepted)

**Status:** Accepted
**Date:** 2026-08-07

**Context:** "One player hosts, others join" over LAN. The host player must run the server on their own machine with minimal friction.

**Decision:** A tiny Node process (HTTP static server + `ws` WebSocket server + room manager + relay). The host process never runs the sim.

**Consequences:**
- **For:** host bundle < 50 KB; no admin rights needed beyond binding a port; host is provably unable to cheat via server code; testable in CI on Windows/macOS/Linux.
- **Against:** players must have Node installed (acceptable for a dev-phase tool; a standalone launcher is a post-v1 stretch).
- **Alternative considered:** WebRTC/PeerJS (host in browser, zero server) — rejected for v1: WebRTC adds STUN/NAT complexity and unreliable-channel handling for a benefit (no Node install) that matters less than reliable lockstep over TCP.

---

## ADR-005 — LAN Security = Passphrase Gate + Integrity Checks (No Per-Command Crypto) (Accepted)

**Status:** Accepted
**Date:** 2026-08-07

**Context:** Rooms must be gated against wrong-room joins and casual interference, but this is a trusted-LAN tool, not a public internet service.

**Decision:**
- Passphrase → PBKDF2-SHA256 (client-side, per-room salt, 100k iterations) → hash stored in host memory only.
- Integrity: command `(playerID, seq, tick)` triples + periodic CRC32 of state hash → desync halt on mismatch.
- **No per-command signing, no TLS requirement on LAN** (WebSocket over plain TCP is acceptable on a trusted network; the host prints both `ws://` and can accept a TLS cert later).

**Consequences:**
- **For:** trivial UX (one passphrase), no key management, honest-mistake protection, active desync detection.
- **Against:** not secure against an adversary who controls the host machine, intercepts the LAN, or inspects memory. Explicitly **out of scope** and documented as such.
- **Why not full crypto?** Deterministic lockstep already makes clients the source of truth for their own commands; per-command signatures would add a key-distribution problem with no security gain inside a trusted LAN. If the game later moves to hosted matchmaking, TLS + server-side auth becomes an ADR of its own.

---

## ADR-006 — Integer-Only Simulation State (Accepted)

**Status:** Accepted
**Date:** 2026-08-07

**Context:** Cross-engine, cross-browser determinism is the #1 project risk. JS floats are IEEE-754 (deterministic *within* one engine), but serialization as decimal text (JSON) is not guaranteed identical across engines, and SIMD/no-SIMD paths can differ.

**Decision:** Sim state is **integer-only**. Positions are fixed-point tiles (int32 with 3 decimals of precision: `tileX * 1000`). Percentages are basis points. Distances use squared integers + precomputed tables. The wire format transmits integers only. `Math.sqrt`/`sin`/`cos` are banned in sim (lookup tables where needed).

**Consequences:**
- **For:** byte-identical behavior across engines; trivially serializable; state hash is exact.
- **Against:** some math is clumsier (lookup tables); precision decisions must be made once and documented (they are: fixed-point ×1000).
- **Why not bit-identical floats?** JSON round-trips and JIT variants make it fragile; integer math is provably safe. This is the strongest single determinism guarantee we can make cheaply.

---

## ADR-007 — Fog of War Is Computed, Never Sent (Accepted)

**Status:** Accepted
**Date:** 2026-08-07

**Context:** Fog board is 1 byte/tile/player (128×128 × 8 players ≈ 128 KB of state). Sending it per-tick wastes bandwidth; recomputing it is deterministic.

**Decision:** Fog is derived deterministically from `Vision` components each tick (dirty-tile propagation). No fog data on the wire.

**Consequences:**
- **For:** zero bandwidth cost; no fog-specific sync bugs; vision-based features (spies, radar) become component changes.
- **Against:** costs sim CPU (mitigated by dirty-tile updates + low-res texture render).

---

## ADR-008 — Maps Are Canonical JSON + Checksum, Validated Everywhere (Accepted)

**Status:** Accepted
**Date:** 2026-08-07

**Context:** Map builder, client, and host all touch maps. Divergent parsers = impossible-to-diagnose bugs.

**Decision:** One schema in `shared/maps.ts`, one `validateMap()` used by all three surfaces, canonical key order, CRC32 checksum embedded in the file. Maps rejected on mismatch anywhere.

**Consequences:**
- **For:** builder→game fidelity guaranteed; hand-edit mistakes caught at load; future "map sharing" is just a validated JSON file.
- **Against:** hand-editing JSON is hostile to users (by design — use the builder).

---

## ADR-009 — Single Faction in v1 (Accepted)

**Status:** Accepted
**Date:** 2026-08-07

**Context:** Three asymmetric factions triples balance/content/art work and endangers the LAN-first milestone.

**Decision:** One faction ("Space Legion") with a complete build tree that exercises *every* system (economy, power, production, armor classes, anti-air, indirect fire, defense structures). Second/third factions are post-v1 content drops behind the same data + shape-config seams.

**Consequences:**
- **For:** proves all systems with minimal content surface; balance data is data (no code changes to add factions later).
- **Against:** less content variety for test nights; accepted.

---

## ADR-010 — Procedural Shapes Now, Sprites Later (Accepted)

**Status:** Accepted
**Date:** 2026-08-07

**Context:** Dev phase needs instant iteration on gameplay; art would block everything if required upfront.

**Decision:** All visuals are generated shapes (05 § 2), all audio is synthesized hooks (05 § 3.4). The render seam (`visualId → factory`) and the audio seam (`SimEvent → sound`) are designed so real assets swap in without touching sim/netcode. Asset pipeline (manifest → atlases → progressive load) is fully specced (05 § 3–5) but not implemented until the content pass.

**Consequences:**
- **For:** zero asset weight, instant dev loop, gameplay-first.
- **Against:** visuals are plain (accepted for dev phase); asset work deferred.

---

## ADR-011 — Protocol Versioning Is Strict (Accepted)

**Status:** Accepted
**Date:** 2026-08-07

**Context:** Host and client can be different builds (host is on LAN, guests may not have pulled latest). Stat data must match across the wire.

**Decision:** `PROTOCOL_VERSION` integer gates the lobby. Balance data carries its own version. Existing message types are never mutated — add new types or bump the version. Round-trip codec tests are mandatory for every message.

**Consequences:**
- **For:** version skew is caught at the lobby with a friendly message, never mid-match; no silent desyncs from stat drift.
- **Against:** adding a field to a message is a version bump (slightly slower iteration; acceptable).

---

## ADR-012 — No Mid-Match Reconnect / No Host Migration in v1 (Accepted)

**Status:** Accepted
**Date:** 2026-08-07

**Context:** A client dropping mid-match breaks lockstep (the tick authority must progress). Reconnect requires state transfer or replay-from-checkpoint.

**Decision:** v1: no mid-match reconnect. Drop = idle-ify the force; host drop = end match to lobby. State-dump-based resume and deterministic checkpoint save/restore (06 § 7) are recorded as the path forward if ever needed.

**Consequences:**
- **For:** dramatically simpler netcode; matches are short anyway.
- **Against:** a 5-second network blip ends a match; accepted for v1 LAN context.

---

## ADR Index (Future/Proposed)

| # | Topic | Status |
|---|---|---|
| 013 | Hosted matchmaking broker (transport-agnostic) | Proposed (post-v1) |
| 014 | TLS for non-LAN deployments | Proposed (post-v1) |
| 015 | Replay / spectator format | Proposed (post-v1) |
| 016 | Deterministic checkpoint save/restore | Proposed (post-v1) |
| 017 | Superweapon mechanics (reserved slot) | Proposed (post-v1) |
