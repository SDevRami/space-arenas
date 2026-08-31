# 03 — Technical Specification

**Project:** Space Arenas — RTS game
**Version:** 0.1
**Companion docs:** 04-ARCHITECTURE.md (structure), 05-ASSET-PIPELINE.md (assets), 08-DECISIONS.md (rationales), 09-TESTING-AND-QA.md (QA)

This document defines the engineering stack, build pipeline, and the strict performance constraints the implementation must respect.

---

## 1. Technology Stack

| Layer | Choice | Rationale |
|---|---|---|
| **Language** | TypeScript (strict mode) | Type safety protects the deterministic sim; compile-time checks across shared protocol code used by client, host, and map builder |
| **Build tool** | Vite 5+ | Instant HMR for dev, optimized production bundles, first-class TS |
| **Rendering** | **PixiJS 8** (WebGL 2D) | GPU batching of thousands of simple shapes at 60 FPS; sprite-ready; canvas context fallback via PixiJS auto-detection |
| **Networking (client)** | Browser `WebSocket` API | Native, no deps, reliable TCP on LAN |
| **Host server** | **Node.js** + `ws` package | Tiny process runs on the host player's machine; same TS protocol code shared with client |
| **Audio** | **Web Audio API** (procedural placeholders) | Zero asset weight, hook-based design for future real audio |
| **State storage** | localStorage (settings), IndexedDB (maps, lobby history) | No backend required |
| **Testing** | Vitest (unit/determinism), Playwright (E2E), custom fuzz harness | See 09-TESTING-AND-QA.md |
| **Workspace** | npm workspaces (`client`, `host`, `mapbuilder`, `shared`) | One install, one build graph, shared protocol/balance code |

### Version pins (baseline)

- Node.js ≥ 20 LTS
- TypeScript ~5.x
- Vite 5.x
- PixiJS 8.x
- Vitest 2.x
- Playwright 1.x
- `ws` 8.x

---

## 2. Runtime Targets

| Target | Constraint |
|---|---|
| **Browsers** | Chrome/Edge/Firefox latest 2 versions; WebGL 1 minimum, WebGL 2 preferred |
| **Frame rate** | 60 FPS target, 30 FPS minimum acceptable during heavy battles |
| **Sim tick** | 25 ticks/s fixed (40 ms) |
| **Latency budget** | Input-to-action ≤ 100 ms perceived on LAN (typical RTT < 5 ms, so budget is dominated by tick batching) |
| **Devices** | Desktop Windows/macOS/Linux laptops & desktops with WebGL; no GPU requirement beyond WebGL 1 |

---

## 3. Performance Budgets (Hard Constraints)

These are measured on a mid-range reference machine (2019 i5 laptop, integrated GPU, Chrome).

| Metric | Budget |
|---|---|
| Sim CPU per tick | **< 8 ms** (of 40 ms budget) at 400 entities |
| Render frame | **< 12 ms** GPU (PixiJS batching) at 400 entities + fog overlay |
| GC | **0 long pauses** (> 50 ms) during a 20-minute match; target **< 1 MB new allocations per tick** in hot systems |
| Memory | < 200 MB heap for a full 2v2 match |
| Load time (cold) | < 3 s on LAN host serving over local network (shapes-only bundle) |
| Network | < 20 KB/s per client during typical play (lockstep commands are tiny) |

### Where the budget is spent (dev-phase shapes)

- Rendering: mostly trivially fast; the **fog-of-war tile overlay** is the dominant cost → pre-render fog into a low-res texture, upscale with nearest-neighbor.
- Sim: pathfinding + combat resolution dominate. Both are optimized in 04-ARCHITECTURE.md.

---

## 4. Project Structure & Workspaces

```
Space Arenas - RTS game - 2.0/
├── shared/src/     # no runtime deps; pure TS (constants, protocol, maps, rng, fixed, balance/)
├── client/src/     # Vite SPA (main.ts, core/, ecs/, systems/, game/, render/, net/, ui/, ai/, etc.)
├── host/src/       # Node server (index.ts, rooms.ts, relay.ts, bots.ts, discovery.ts, passphrase.ts, qr.ts)
├── mapbuilder/src/ # Vite SPA (standalone map editor, legacy — also embedded in client)
├── assets/         # Game sprite PNGs (152 files)
├── tests/          # Vitest test suite (13 files, 121+ tests)
└── docs/
```

- **Dependency rule:** `shared/` may not import from `client/`, `host/`, or `mapbuilder/`. Client may import shared; host may import shared; mapbuilder may import shared. Nothing imports a sibling's app code.
- **Build order:** `shared` (library build or source-aliased) → `client`/`host`/`mapbuilder`. With Vite, aliasing `shared` as source is acceptable to keep HMR snappy.
- **Lint/format:** ESLint + Prettier at repo root; runs on `npm run lint`.

---

## 5. Build Pipeline (Dev & Prod)

### 5.1 Development

```
npm run dev          → starts Vite dev servers (client, mapbuilder) + host in watch mode
npm run dev:client   → client only
npm run dev:host     → host only (TS watch + node --watch)
```

- Vite HMR for `client` and `mapbuilder`; `host` uses `tsx watch` or `node --watch` with a TS loader.
- `shared/` is aliased as source (`resolve.alias`) so edits hot-reload everywhere instantly.

### 5.2 Production build

```
npm run build        → tsc -b + vite build (client, mapbuilder) + tsc build (host)
npm run serve        → serves built client + host server for LAN
```

- **Client:** static files + hashed bundles. Served by the host's Node process over HTTP (so friends only need one URL: `http://host-ip:PORT`).
- **Host:** bundled to a single Node script (`esbuild` or `tsc` output) so the host player runs `node host.js` without a full dev toolchain.
- **Map builder:** static files, optionally also served by the host process under `/mapbuilder`.

### 5.3 Bundle targets

| Bundle | Size target (gzip) | Notes |
|---|---|---|
| Client JS | < 300 KB | PixiJS is the big dependency (~150 KB gzip); shapes-only code is tiny |
| Host JS | < 50 KB | No rendering, no PixiJS |
| Mapbuilder JS | < 200 KB | Reuses shared + PixiJS for preview |
| Audio | 0 KB | Procedural placeholders |

---

## 6. Protocol (Wire Format) Summary

Defined fully in `shared/protocol.ts`. Key decisions:

- **Encoding:** JSON for lobby/control messages (readable, debug-friendly); **binary (DataView) for the high-frequency command stream** to keep LAN bandwidth tiny and encoding deterministic.
- **Float determinism:** all sim-critical numbers are transmitted as integers (fixed-point) or exact strings. JSON `number` is never used for sim state. Reason: JSON round-trips can alter float text encoding across engines — a determinism hazard. See 04-ARCHITECTURE.md § Determinism.
- **Message families:**
  - `H_*` host → client (room info, game start, player slots)
  - `C_*` client → host (join, passphrase hash, commands, ready)
  - `S_*` sim → client (broadcast tick checksums, game over) — *from host to clients*
  - `R_*` relay (host→clients: authoritative command frame per tick)
- **Versioning:** `PROTOCOL_VERSION` integer. Mismatch = friendly error at lobby.

---

## 7. Security & LAN Trust Model

- **Passphrase → PBKDF2 (client-side, 100k iterations, per-room random salt), 256-bit hash** stored in the host server's memory only for the room lifetime. Not persisted.
- **Command stream:** `(playerID, seq, tick)` triple; host validates seq monotonic per player. Duplicate/reordered/late commands are handled per lockstep rule.
- **Integrity check:** every 60 ticks, host broadcasts `CRC32(stateHash)` of the last 60-tick command frame. Client mismatch → halt + diagnostics dump.
- **Non-goal (v1):** not resistant to a hostile attacker with control of the host machine or the network itself. Documented in 08-DECISIONS.md ADR-005.
- **No secrets in repo:** passphrases are runtime-only. `.env` is git-ignored (host port config only).

---

## 8. Cross-Cutting Constraints

### 8.1 Strict determinism rules (repeat from AI-INSTRUCTIONS, binding)

1. Sim code never calls `Math.random()`, `Date.now()`, `performance.now()`, `Intl`, or any locale-dependent API.
2. All arithmetic in sim is integer or fixed-point rationals. No floating-point division unless provably exact.
3. Object iteration order in systems must be deterministic (iterate by entity ID, never by JS object key order).
4. The RNG (`shared/rng.ts`) is a seeded PRNG using a Murmur-like finalizer with golden-ratio increment; reseeded only by explicit sim events (e.g., death animations *do not* consume RNG; weapon scatter does, via seeded sequence).

### 8.2 Accessibility & input robustness

- All hotkeys rebindable; stored in localStorage.
- Zoom clamps; minimum 80% scale; UI scaling via `devicePixelRatio`-aware layout (Protocol 3, § 10).

---

## 9. Observability & Debugging

- **Tick profiler:** per-system CPU histogram, rendered with `F4` overlay (production build excludes profiler).
- **State hashing:** full-state FNV-1a hash each tick in debug builds (matches lockstep checksum).
- **Net debug overlay (`F3`):** per-player RTT, tick delta, buffer depth, dropped/reordered counts.
- **Desync dump:** on checksum mismatch, clients write the last 128 commands + state hashes to a JSON file for `docs/09` triage.

---

## 10. Environment & Load Protocols (summary of Phase 3 Protocols)

The three strict protocols from the brief:

| Protocol | Summary | Full detail |
|---|---|---|
| **1 — Environment / asset loading** | Shapes phase has zero external assets; only code + protocol. When assets arrive (05), preload pipeline: JSON manifest → texture atlases → audio sprites → UI → gameplay-ready. Client bundles first paint from code so loading is instant. | 05-ASSET-PIPELINE.md |
| **2 — Performance safety** | Object pooling for hot entities, fixed-size component arrays, zero-alloc tick target, fog pre-rendered to low-res texture, no per-frame string building. | 04-ARCHITECTURE.md § GC |
| **3 — Responsiveness / DPR scaling** | Canvas sized in logical units, scaled by `devicePixelRatio` (clamped ≤ 2), re-rendered on resize + orientation change; camera math in world units so resolution never changes gameplay. | 04-ARCHITECTURE.md § Rendering |

---

## 11. Reference Hardware Profiling Matrix

| Tier | Example | Expected result |
|---|---|---|
| Low | 2016 laptop, HD 520 iGPU | 30 FPS min, 300 units |
| Mid | 2019 i5 laptop, UHD 620 | 60 FPS, 400+ units |
| High | Desktop GPU, 2021+ | 60 FPS, 1000+ units (headroom for future) |

Budgets are re-validated in Beta (07-IMPLEMENTATION-PLAN.md Phase 3).
