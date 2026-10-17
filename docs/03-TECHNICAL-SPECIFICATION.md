# 03 — Technical Specification

**Status:** Current (code-grounded)

**Project:** Space Arenas — RTS game
**Companion docs:** 04-ARCHITECTURE.md (structure), 05-ASSET-PIPELINE.md (assets), 08-DECISIONS.md (rationales), 09-TESTING-AND-QA.md (QA)

This document defines the engineering stack, build pipeline, and performance constraints as implemented in the codebase.

---

## 1. Technology Stack

| Layer | Choice | Rationale |
|---|---|---|
| **Language** | TypeScript (strict mode) | Type safety across `shared`, `client`, `host`, `online` with shared protocol/balance types. Configured via `tsconfig.base.json` (strict, noUnusedLocals, noUnusedParameters, noFallthroughCasesInSwitch, isolatedModules, verbatimModuleSyntax, allowImportingTsExtensions, moduleResolution: bundler, target ES2022). |
| **Build tool** | Vite 5+ | Client dev server with HMR; optimized production builds; aliasing of `shared` source for fast hot reload. |
| **Rendering** | **PixiJS 8.6.0** (WebGL 2D) | GPU batching for thousands of sprites/shapes; auto canvas/WebGL detection. |
| **Networking (client)** | Browser `WebSocket` API | Native; used by client to connect to host/relay; no extra deps. |
| **Host server** | **Node.js** + `ws` 8.18.0 | LAN host process running on host player's machine; shares TS code with client via `@space-arenas/shared`. |
| **Audio** | **Web Audio API** (synth + optional file overrides) | Procedural fallback SFX/ambient via synth (`client/src/audio/hooks.ts`), plus per-sound file/variant overrides and optional bundled WAVs/MP3 in `client/dist/sound/`. Lobby music via `HTMLAudioElement` (`client/src/audio/lobby-music.ts`). |
| **State storage** | localStorage (settings), IndexedDB (maps, lobby history) | No backend required for LAN/local settings/maps/lobby history. Settings: `space-arenas:graphics`, `space-arenas:audio`, `space-arenas:controls`. |
| **Testing** | Vitest 2.1.2 | Unit/determinism tests configured in `vitest.config.ts` (`environment: node`, `test.include: ['tests/**/*.test.ts']`, alias `@space-arenas/shared` → `./shared/src/index.ts`). |
| **Workspace** | npm workspaces (`shared`, `client`, `host`, `online`) | One install/build graph; shared types/constants/protocol in `shared/`. |

### Version pins (baseline)

- Node.js ≥ 20 LTS (`SA_REQUIRED_NODE=20` in `run-game.bat`)
- TypeScript ~5.6.3
- Vite ^5.4.8
- PixiJS ^8.6.0
- Vitest ^2.1.2
- `ws` ^8.18.0
- esbuild ^0.24.0
- tsx ^4.19.0
- `@types/node` ^22.7.0

---

## 2. Runtime Targets

| Target | Constraint |
|---|---|
| **Browsers** | Chrome/Edge/Firefox (latest 2 versions). WebGL 1 minimum; WebGL 2 preferred. |
| **Frame rate** | 60 FPS target; 30 FPS minimum acceptable in heavy battles (PixiJS rendering). |
| **Sim tick** | 25 ticks/s fixed (40 ms) |
| **Latency budget** | Input-to-action ≤ 100 ms on LAN; typical RTT < 5 ms, so tick batching dominates. |
| **Devices** | Desktop Windows/macOS/Linux laptops/desktops with WebGL. No GPU requirement beyond WebGL 1. Mobile touch supported via `client/src/input/input.ts` (touch gesture handling; box-select with drag, single-finger pan, two-finger pinch with 0.35 ratio threshold, long-press for alternate right-click command when `boxSelect` active). |

---

## 3. Performance Budgets

| Metric | Budget | Notes |
|---|---|---|
| Sim CPU per tick | **< 8 ms** (of 40 ms) at 400 entities | Core sim in shared/client systems; see 04-ARCHITECTURE.md for hot paths. |
| Render frame | **< 12 ms** GPU at 400 entities + fog overlay | PixiJS batching; fog is a low-res canvas upscaled (nearest) in `FogRenderer` (`FOG_CELL=4`, `client/src/render/ground.ts`). |
| GC | **0 long pauses (> 50 ms)** during a 20-minute match; **< 1 MB new allocations per tick** | Object pooling where applicable; component arrays favored. |
| Memory | < 200 MB heap for a full 2v2 match | Observed within this range in development. |
| Load time (cold) | < 3 s on LAN | Asset loading uses bundled files in `client/dist/` (images, WAVs, MP3) with optional one-request `sprites.bundle`. |
| Network | < 20 KB/s per client during play | Lockstep command stream is tiny. |

### Dominant costs
- **Fog-of-war**: rendered to a low-res canvas texture in `FogRenderer` (`client/src/render/ground.ts`, `FOG_CELL=4`, `FOG_ALPHA` 0→0.75, 1→0.5, 2→0) and upscaled with nearest-neighbor; only dirty fog tiles are redrawn.
- **Sim**: pathfinding + combat resolution dominate hot paths (see 04-ARCHITECTURE.md).

---

## 4. Project Structure & Workspaces

```text
Space Arenas - RTS game - 2.0/
├── shared/src/     # no runtime deps; pure TS (constants, protocol, maps, rng, fixed, balance)
├── client/src/     # Vite SPA (main.ts, core/, ecs/, systems/, game/, render/, net/, ui/, ai/, mapbuilder/)
├── host/src/       # Node server (index.ts, rooms.ts, relay.ts, bots.ts, discovery.ts, passphrase.ts, qr.ts)
├── online/src/     # Online server (matchmaking + relay + REST/auth, Render deployable)
├── client/dist/    # Committed game assets home (PNG folders + sound WAVs/MP3 + manifest.json; Vite assets ignored)
├── tests/          # Vitest tests (determinism, unit)
├── scripts/        # synth-fx.mjs, validate-assets.mjs
└── docs/
```

- **Dependency rule:** `shared/` imports no app code. Client/host/online may import `shared` (`@space-arenas/shared`). Siblings don’t import app code.
- **Build order:** `shared` → `client` → `host` (root `npm run build`). With Vite, `shared` is aliased to source (`resolve.alias` in `client/vite.config.ts`) for fast HMR.
- **Lint/format:** ESLint + Prettier at repo root (`npm run lint`, `npm run format`).

---

## 5. Build Pipeline (Dev & Prod)

### 5.1 Development
```bash
npm run dev          # starts Vite dev server (client) + host in watch mode (concurrently)
npm run dev:client   # client only (vite)
npm run dev:host     # host only (tsx watch src/index.ts)
```

- Vite HMR for `client`. `host` uses `tsx watch` (`host/package.json`).
- `shared/` aliased as source in client (`../shared/src/index.ts`) so edits hot-reload.

### 5.2 Production build
```bash
npm run build        # shared: tsc --noEmit; client: tsc -p tsconfig.json --noEmit && vite build; host: esbuild bundle + tsc typecheck
npm run start -w host # runs built host (node host/dist/host.js)
```

- **Client:** static files + hashed bundles emitted to `client/dist/`. `vite.config.ts` sets `outDir:'dist'`, `emptyOutDir:false` (comment: assets live in `client/dist` and must survive builds). Ignored rebuildable artifacts: `client/dist/assets/`, `client/dist/index.html` (per `.gitignore` lines 9–13). Other `client/dist/` folders (e.g. `cc,ao,hud,sf,of,sound,af,b,bn,d,pp,sd,sp,t,tc,wf,v_*,t_l,t_r,t_s,background,logo.png,sw.js`) are committed game assets.
- **Host:** bundled to a single ESM script `dist/host.js` via `esbuild` (external: `ws`, `qrcode`), served when host runs. Host serves built client for LAN.
- **Map builder:** ships inside the client bundle (in-game lobby “Map Builder” tab); no separate app.
- **Online:** `online/package.json` builds with `esbuild` to `dist/online.js` and alias `@space-arenas/shared=./shared/src/index.ts` (used for Render deployment with `rootDir: online` per `render.yaml`).

### 5.3 Bundle targets
| Bundle | Size target (gzip) | Notes |
|---|---|---|
| Client JS | < 300 KB | PixiJS split into manual chunk `pixi` (`client/vite.config.ts` lines 31–36). Shapes/low-detail procedural vectors keep code small. |
| Host JS | < 50 KB | No rendering/PixiJS; `ws` external. |
| Audio | 0 KB code | SFX/ambient synth by default; optional bundled WAV/MP3 in `client/dist/sound/` (user or build-generated). |

---

## 6. Protocol (Wire Format) Summary

Defined in `shared/protocol.ts` (referenced). Key points:
- **Encoding:** JSON for lobby/control messages; **binary (DataView)** for high-frequency command stream to minimize LAN bandwidth and preserve determinism.
- **Float determinism:** sim-critical numbers transmitted as integers (fixed-point) or exact strings. JSON `number` is never used for sim state.
- **Message families:** `H_*` (host→client), `C_*` (client→host), `S_*` (sim→client), `R_*` (relay).
- **Versioning:** `PROTOCOL_VERSION` integer; mismatch shows friendly lobby error.
- **Security/host-authority:** passphrase → PBKDF2 client-side (100k iterations) with per-room random salt; hash stored in host memory only for room lifetime (not persisted). Command stream validated by `(playerID, seq, tick)`. Integrity: every 60 ticks host broadcasts `CRC32(stateHash)` of last 60-tick frame; mismatch → halt + diagnostics dump. Not resistant to hostile host (documented in ADR-005).

---

## 7. Cross-Cutting Constraints

### 7.1 Strict determinism (sim)
1. Sim never calls `Math.random()`, `Date.now()`, `performance.now()`, `Intl`, or any locale-dependent API.
2. All arithmetic integer or fixed-point; no floating-point division unless provably exact.
3. Object iteration order deterministic (iterate by entity ID, never JS object key order).
4. RNG is seeded PRNG via `shared/rng.ts` (Murmur-like finalizer with golden-ratio increment); reseeded only by explicit sim events. Render-only effects do not consume RNG (e.g. cosmetic weather uses `Math.random()` only in overlay code `client/src/render/weather.ts`).
5. Lockstep checksum: every 60 ticks host broadcasts state hash of command frame for client verification.

### 7.2 Accessibility & input robustness
- Hotkeys rebindable; stored in localStorage (`space-arenas:controls`, `DEFAULT_BINDINGS` in `client/src/ui/controls.ts`).
- Zoom clamps configurable (defaults: normal `zoomMin=0.5/zoomMax=2.5`, replay `replayZoomMin=0.4/replayZoomMax=5` in `client/src/ui/graphics.ts`; Camera enforces via `setZoomRange`).
- DPR-aware sizing: canvas sized in logical units, scaled by `devicePixelRatio` (clamped ≤ 2) in renderer initialization (`client/src/render/renderer.ts` uses `resolution: Math.min(devicePixelRatio,2)`, `autoDensity:true`, `resizeTo:window`).
- Camera math in world units; resolution changes never affect gameplay.
- Edge-pan requires Ctrl + mouse inside canvas and `elementFromPoint` equals canvas (`client/src/input/input.ts`, `EDGE_MARGIN=24`, `EDGE_SPEED=16`).
- Touch support: single-finger pan, two-finger pinch with ratio threshold 0.35, box-select when `boxSelect` active, long-press issues alternate command (keep-attack/guard/attack-move/move) in 500ms (`TOUCH_LONG_PRESS_MS`).

---

## 8. Observability & Debugging

- **Tick profiler:** per-system CPU histogram; rendered via `F4` overlay (production build excludes profiler). See 04-ARCHITECTURE.md.
- **State hashing:** full-state hash each tick in debug builds (matches lockstep checksum).
- **Net debug overlay (`F3`):** per-player RTT, tick delta, buffer depth, dropped/reordered counts.
- **Desync dump:** on checksum mismatch, clients write last 128 commands + state hashes to JSON for triage (per 09-TESTING-AND-QA.md).
- **Dev overlays/utilities:** F5 test grid for visuals (when present), audio diagnostics (`diagnose()`), `availableSounds()` in `AudioHooks`.

---

## 9. Environment & Load Protocols (Phase 3)

| Protocol | Implementation | Reference |
|---|---|---|
| **1 — Environment / asset loading** | Assets live in `client/dist/` (committed). Client loads via Vite-bundled JS/CSS + hashed files in `dist/assets/` and static game assets (PNG/WAV/MP3/manifest.json) in `dist/`. Optional `sprites.bundle` served at `/assets/sprites.bundle` (built by `host/src/index.ts::buildSpriteBundle` and served at route around line ~1084) for single-request preload when per-file crawling occurs. High-quality image loading uses Pixi `Assets.load` with per-file fallback; `building-sprites.ts` includes `textureFromBundle` stub (returns null) path placeholder. Audio uses override resolution (file/folder variants) with synth fallback. Loading logic in lobby/preload: `preloadAllMatchAssets()` warms building/unit/field/obstacle/fx assets when high quality enabled. | 05-ASSET-PIPELINE.md |
| **2 — Performance safety** | Object pooling in hot paths, fixed-size/component arrays, fog low-res canvas, no per-frame string building in hot render paths. Renderer uses fixed z-bands and child containers to minimize sort churn; child zIndex set via `applyFixedLayerZ()`/`applySpriteLayerOrder()`. | 04-ARCHITECTURE.md § GC |
| **3 — Responsiveness / DPR scaling** | Canvas sized via `resizeTo:window`, `resolution: Math.min(devicePixelRatio,2)`, `autoDensity:true`. Camera math in world units (`screenToWorld`/`screenToWorldExact`/`worldToScreen`). Resize preserves center logic; viewport heals on frame when window size drifts (`Game.ts` onFrame check). UI scaling via `uiScale` in graphics settings applied to HUD overlays (dev settings). | 04-ARCHITECTURE.md § Rendering |

---

## 10. Reference Hardware

| Tier | Example | Expected result |
|---|---|---|
| Low | 2016 laptop, HD 520 iGPU | 30 FPS min, ~300 units |
| Mid | 2019 i5 laptop, UHD 620 | 60 FPS, 400+ units |
| High | Desktop GPU, 2021+ | 60 FPS, 1000+ units (headroom) |

Budgets validated during Beta (07-IMPLEMENTATION-PLAN.md Phase 3).