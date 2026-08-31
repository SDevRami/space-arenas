# 04 — Architecture

**Project:** Space Arenas — RTS game
**Version:** 0.1
**Companion docs:** 03-TECHNICAL-SPECIFICATION.md (stack), 02-MECHANICS-SPECIFICATION.md (rules), 08-DECISIONS.md (rationales)

This is the core engineering document: the ECS design, the game loop lifecycle, the lockstep netcode architecture, and the memory/GC strategies that make the performance budgets in 03 achievable.

---

## 1. Architectural Pattern: ECS-lite

### 1.1 Why ECS (not OOP hierarchy or flat state machines)

| Criterion | ECS-lite | OOP hierarchy | Flat state machine |
|---|---|---|---|
| Deterministic serialization | **Trivial** (data-only components) | Painful (object graphs, methods, v-tables) | Painful |
| Cache locality at 400+ entities | **Excellent** (SoA arrays) | Poor (AoS scattered) | Mixed |
| Adding a behavior (e.g., "air" units later) | **Add a component + system** | Touch class hierarchy | New states everywhere |
| Lockstep snapshot hashing | **Natural** (array-of-component hash) | Requires recursive reflection | Manual |
| Dev iteration speed | **Very high** | Medium | Low |

**Decision:** custom ECS-lite. We deliberately avoid heavy ECS libraries (like `bitecs`) because:
1. The world needs to run identically in browser, Node (host for tests/replays), and the map builder preview.
2. A tiny, owned implementation (< 400 lines) has zero magic and full control over determinism.
3. We control serialization exactly — critical for lockstep.

### 1.2 Definitions

- **Entity:** integer ID. IDs are allocated sequentially from a free-list (reuse after deletion).
- **Component:** plain data object registered by type. Stored in **sparse sets** (Map-backed keyed by entity ID with a sorted ID array for iteration), giving O(1) amortized access and deterministic ID-order iteration.
- **System:** pure object with a `name` string and `update(world: World)` method; no internal mutable global state — all state lives on the world or on components. Systems are pure-ish: given the same world state, they produce the same result.
- **World:** owns all component stores, entity allocator, event queue, grid, fog, and tick counter.

### 1.3 Component catalogue (v1)

| Component | Fields |
|---|---|
| `Transform` | `tileX, tileY, facing` (fixed-point ints) |
| `Unit` | `unitType, team, hp, maxHp, speed` |
| `Building` | `buildingType, team, footprint: [w,h], buildProgress` |
| `Vision` | `radius` (tiles) |
| `Team` | `teamId` |
| `Attack` | `weaponId, range, cooldownTicks, fireCooldown` |
| `Health` | `hp, maxHp, armorClass` |
| `ProductionQueue` | `queue: ProductionOrder[]` (per-building) |
| `Supply` | `maxCashPerTrip, state` (idle → movingToField → loading → returning) |
| `Power` | `generates, consumes` |
| `Placement` | `validTiles` (for placement ghost) |
| `Pathfinding` | `path: Int32Array, pathIndex, blockedTicks` |
| `Ai` *(future)* | reserved |
| `Weapon` | (weapon definitions are data, not components; `Attack` references weaponId) |

### 1.4 System pipeline (fixed order per tick)

```
 0  InputSystem       → consumes command buffer, emits events (place, move, attack, queue)
 1  PlacingSystem     → validates placements, charges cash, starts build timers
 2  ProductionSystem  → advances production queues (pause if power-down)
 3  EconomySystem     → supply harvest trips, treasury updates
 4  OilSystem         → oil field claiming, income ticks
 5  MovementSystem    → follows Pathfinding, separation, obstacle avoidance
 6  ScenerySystem     → tree/rock crush damage from vehicle movement
 7  PathfindingSystem → A* on dirty regions with per-tick budget
 8  WorkSystem        → harvester/builder work assignment, delivery, repair
 9  CombatSystem      → acquire targets, apply cooldowns, resolve hits, splash, deaths
10  PlaneSystem       → orbit behavior, attack/chase for air units
11  LaserSystem       → area damage from space laser superweapon
12  VisionSystem      → recompute per-player fog board (dirty tiles only), satellite markers
13  WinLossSystem     → evaluate end conditions in fixed player order, alliance logic
14  SyncSystem        → hashWorld every tick, broadcast CRC32 checksum every 60 ticks
```

Order is fixed and tested. Reordering is a **breaking change** (desync risk) and requires a determinism test run + protocol version bump if it changes command semantics.

---

## 2. Game Loop Lifecycle

### 2.1 The tick model

```
┌─────────── Fixed-Sim (25 Hz) ───────────┐
│  simAccumulator += realElapsed           │
│  while (simAccumulator >= SIM_TICK_MS):  │
│      apply queued commands               │
│      run system pipeline (1.4)           │
│      tick++                              │
│      interpolate render state            │
└──────────────────────────────────────────┘
┌─────────── Render (display refresh) ────┐
│  rAF loop → draw interpolated world      │
└──────────────────────────────────────────┘
```

- **Sim:** fixed 25 ticks/s. All gameplay resolves here.
- **Render:** `requestAnimationFrame`, as fast as the display allows (60/120/144 Hz).
- **Interpolation:** render positions are smoothed between the last two authoritative sim positions using `renderLerp` (render-only, never fed back into sim).
- **Input sampling:** input is *not* consumed at render time; it is stamped with the current tick and applied at the start of that tick. Keeps sim independent of frame rate.

### 2.2 Tick budget guard

- `simAccumulator` is clamped (max 4 ticks catch-up) to avoid a "spiral of death" after a browser hiccup; if the machine can't keep up, the game runs slower sim rather than dropping ticks (deterministic clients always progress).
- Profiling overlay shows sim/ms per system (`F4`).

### 2.3 Single-player test mode

- Runs the identical pipeline with a **dummy command producer** (scripted inputs) — this is the determinism test harness and future AI hook. Local test mode = run 2+ players' commands against 2 world instances and diff state hashes every tick.

---

## 3. State Management

### 3.1 Single source of truth

- One `GameWorld` per match. UI, renderer, and audio read it (renderers read a read-only projection view).
- **Command buffer:** a monotonic sequence of `Command` objects tagged `(playerID, seq, tick)`. The sim consumes commands sorted by `(tick, playerID, seq)` — never by arrival time.

### 3.2 UI state vs sim state

| Layer | Store | Sync? |
|---|---|---|
| Sim state (world, components) | `GameWorld` | Yes — lockstep, identical on all clients |
| UI state (panels, selection, hotkeys) | React-free local store / pub-sub | No |
| Input bindings | localStorage | No |
| Match metadata (teams, map) | lobby state on host | Yes — distributed at start |

### 3.3 Event bus

- Systems emit `SimEvent`s into a per-tick queue. After the pipeline, `EventSystem` dispatches to: net layer (for host to relay), audio hooks, UI subscriptions, and analytics hooks. Events never carry mutable world references (they carry entity IDs + values) — preventing accidental renderer mutation.

---

## 4. Determinism (Lockstep Foundation)

This section is the highest-risk area of the entire project. Every rule here is a hard invariant.

### 4.1 Command frame

- Every tick, the host assembles a **command frame**: all commands from all players destined for that tick, in canonical order `(playerID, seq)`.
- Host broadcasts the frame. Clients apply frames in order. Because every client applies identical frames to identical initial state with identical deterministic systems → identical state.

### 4.2 Determinism rules (enforced by design + tests)

1. **Integer arithmetic only in sim.** Positions in tiles: fixed-point (e.g., `tileX * 1000` as int32). Percentages as integer basis points. No `Math.sqrt`, `Math.sin`, `Math.pow` with fractional results in sim (replaced by precomputed lookup tables where needed — e.g., distance uses squared distances + precomputed radius tables).
2. **Seeded RNG only.** `shared/rng.ts` implements a seeded PRNG using a Murmur-like finalizer with golden-ratio increment (`0x9e3779b97f4a7c15`). RNG state is part of the world and is *not* consumed by render/audio.
3. **Deterministic iteration.** Iterate entities by ID ascending. Iterate component arrays in insertion order (which is ID order). Never iterate a JS `Map`/`Object` whose key order could differ.
4. **No wall-clock.** The only time source in sim is `world.tick`. Timeouts use tick counts.
5. **Floating point is banned in serialized state.** Wire format is integer-only (03 § 6). Hash is computed over the integer state.
6. **No dynamic code paths from input.** Command payloads are validated into fixed schema; a malicious payload cannot inject an `eval`-like path.
7. **Cross-engine determinism is guaranteed by (a) integer math, (b) fixed rounding (round-half-up via integer arithmetic), (c) identical system order.**

### 4.3 State hashing

- Debug/release-with-checks builds maintain an **FNV-1a hash** over all component stores each tick (O(n) but cheap; n ≤ ~2000 components).
- `SyncSystem` (item 9) broadcasts this hash every 60 ticks.
- Clients compare; mismatch → `DESYNC_HALT` → dump diagnostics (last 128 commands, per-tick hashes) and return to lobby. Matches that desync are a release-blocker (09-TESTING-AND-QA.md).

### 4.4 Client prediction & latency

- Commands are sent immediately to the host but applied at their **target tick** (host-computed). The client *optimistically renders* the expected result locally (prediction) so UI feels instant; authoritative application at the target tick corrects any divergence.
- Since the sim is deterministic, prediction on a **single local world** equals the authoritative result when the command frame arrives — there is no rollback in v1 (rollback is only needed if a client predicts a tick ahead of the shared frame; we avoid that by never applying a command before its target tick).

---

## 5. Networking Architecture (Lockstep over WebSocket)

### 5.1 Roles

```
 HOST MACHINE                              JOINING CLIENTS
┌──────────────────────────┐              ┌──────────────────────┐
│  Browser client (plays)  │              │  Browser client      │
│  ── local loopback ──────┤              └───────┬──────────────┘
│  Node host server        │◄── WebSocket ────────┘
│   • lobby/rooms          │
│   • command relay        │
│   • checksum broadcast   │
│   • HTTP static serving  │
└──────────────────────────┘
```

- The host player runs the Node server *and* the browser client. The browser client talks to `localhost`; other clients talk to the host's LAN IP. Both paths use the identical protocol.
- **Zero-config join:** host prints `http://<ip>:PORT` + room code; friends paste it.

### 5.2 Message flow (normal play)

```
Player A inputs → C_MoveCommand(playerID, seq, tick, payload)
   → sent to host
Host: validates seq → buffered until tick T
   → assembles R_CommandFrame(tick=T, [A:cmd, B:cmd, ...])
   → broadcasts frame to all clients (including host's own browser client)
Each client: applies frame at tick T
```

### 5.3 Clock sync

- Host is the **tick authority**. Host emits `S_Tick` heartbeats; clients derive their sim clock from `(hostTick, rttEstimate)`. Clients buffer up to `targetBufferTicks` (default 6 = 240 ms) of frames to absorb jitter; the buffer depth is adaptive (increase on jitter, decrease on stable low jitter).
- No NTP needed — LAN RTTs are < 5 ms; a simple moving-average RTT + fixed buffer suffices.

### 5.4 Bandwidth math

- Command ≈ 24 bytes binary. Per tick per player ≈ 24 B. At 25 Hz with 8 players ≈ 4.8 KB/s total. Checksum frame every 60 ticks adds negligible overhead. **Budget: < 20 KB/s per client** leaves huge headroom (03 § 3).

### 5.5 Reconnect / migration

- v1: no mid-match reconnect; no host migration. Disconnect handling in 02-MECHANICS-SPECIFICATION.md § 12.3. Rejoin-by-replay from state dump is a post-v1 stretch.

---

## 6. Rendering Architecture (PixiJS)

### 6.1 Layers

```
Stage
├── WorldLayer (Container, isometric-transformed)
│   ├── GroundLayer      (tile quads, batched by texture/color)
│   ├── FogLayer         (pre-rendered low-res texture, per-team)
│   ├── EntityLayer      (batched unit/building shapes)
│   ├── SelectionLayer   (rings, waypoints, build ghosts)
│   └── EffectLayer      (tracers, flashes — render-only, non-deterministic)
├── MinimapLayer (UI)
└── UILayer (DOM overlay: menus, panels, chat)
```

- **Camera:** isometric projection with tile ratio 2:1 (W:H). Camera state `{worldX, worldY, zoom}` in world units. Screen transform: `screenX = (worldX - worldY) * tileW/2 * zoom`, `screenY = (worldX + worldY) * tileH/2 * zoom`, translated by camera offsets. All camera math is deterministic-to-render (render-only, never in sim).
- **Zoom:** clamped [0.5, 2.5]; zoom scales the world container, never touches sim coordinates (gameplay is resolution-independent).
- **Culling:** viewport rectangle in world tiles → render only visible tiles + a 2-tile margin. Essential at 256×256 maps.
- **Batching:** PixiJS batching handles grouping; we keep shapes as `Graphics` converted to textures once at boot (`generateTexture`) so the hot path draws pre-baked textures, not live `Graphics` calls.

### 6.2 Protocol 3 — DPR & responsiveness

1. **Logical units:** all UI + world math in CSS pixels (`logicalWidth × logicalHeight`).
2. **Backing store:** canvas sized `logical * dpr` with `dpr = min(devicePixelRatio, 2)` (cap prevents 4K laptops from burning GPU for zero visible gain).
3. **Resize:** on `resize`/`orientationchange`, recompute canvas size + PixiJS `renderer.resize`, keep world camera anchored (center stays fixed). Debounce 100 ms.
4. **Blur control:** because backing = `logical * dpr` with integer dpr, sprites land on pixel boundaries when zoom = 1 → crisp edges. Zoom != 1 uses `roundPixels: true` in PixiJS to avoid bleeding between adjacent tile textures.
5. **HDR/contrast:** no HDR in v1.

### 6.3 Fog rendering (perf-critical)

- Fog board is per-team 1-byte-per-tile. On vision change, only dirty tiles are copied into a low-res `Texture` (e.g., 1 texel = 4×4 tiles) with nearest-neighbor sampling. The texture is overlaid on `GroundLayer`. This keeps fog rendering O(dirty tiles), not O(map).

---

## 7. GC & Memory Strategy (Protocol 2)

Target: **zero per-tick allocations in hot systems**, no GC pauses > 50 ms.

### 7.1 Object pooling

| Pool | Reuse strategy |
|---|---|
| `Command` objects | Pooled by net layer; clear + recycle per tick |
| `SimEvent` objects | Pooled; drained and recycled each tick |
| Path buffers | Per-entity `Int32Array` allocated once, resized sparingly; A* uses a reusable open/closed set with generation counters (no per-query allocation) |
| Tracer/effect visuals | Fixed pool (e.g., 64); oldest reused when exhausted |
| UI DOM nodes | Not pooled (UI layer is not hot); event listeners bound once, never per-frame |

### 7.2 Sparse-set component stores

- `SparseSet<T>`: Map-backed keyed by entity ID with a sorted ID array for deterministic iteration. Iteration walks the sorted ID array (deterministic ID-order). Insertion uses binary search to maintain sorted order; deletion removes from both the Map and the sorted array.

### 7.3 Rules that keep GC silent

1. No closures allocated in systems that run per tick (hoist them).
2. No string concatenation in per-tick UI updates (use cached DOM text nodes; numbers formatted only on change).
3. No `Array.map/filter` in hot loops — use for-loops.
4. No `new` in `update()` of a system — reuse pooled instances.
5. A CI gate flags allocation hotspots via a profiler snapshot in the determinism test suite (test that `gc()` reports < threshold new memory over 1000 ticks).

### 7.4 Memory bounds

- Component stores pre-reserve capacity for target entity counts (units 400, buildings 200, effects 256) to avoid resize re-allocation mid-match.

---

## 8. Map & Data Flow

1. **Map file (JSON)** → validated by `shared/maps.ts` schema → `MapData` (tile grid, supply fields, start positions, meta).
2. **World init:** at game start, the host broadcasts the map **once** (or each client loads it by hash from its own store; host is authoritative). All clients construct identical `MapData` → identical world init.
3. **Balance data:** bundled into client+host via `shared/balance/` — must match versions or the protocol version check fails at lobby (prevents stat skew between host/client).

---

## 9. Host Server Architecture

```
Node process
├── HTTP server (serves client/mapbuilder static files)
├── WebSocket server (ws)
│   ├── RoomManager   → rooms {id, passphraseHash, players[], map, state}
│   │                   settings sanitization (min/max bounds on 40+ params)
│   ├── TickRelay     → 25 Hz tick relay, command sorting, frame assembly, broadcast
│   ├── NetBotRunner  → server-side bot stepping (delegates to client Bot class)
│   └── LanDiscovery  → UDP beacon for zero-config LAN peer discovery
└── QR generator      → invite link QR code PNGs
```

- The host server does **not run the simulation** — it only relays commands and asserts integrity. Clients run the sim (pure lockstep). This keeps the host process tiny (~50 KB bundle) and identical in trust model to a pure relay.
- **Edge case — host = player:** the host's own browser client is just another relay client on `localhost`; no special privilege path in the relay (prevents accidental host-cheating code).

---

## 10. Testing Hooks Built Into the Architecture

- `World.step(commands)` is the atomic test entry point: feed a command stream, step N ticks, read state hash. Determinism tests and the fuzz harness both use it.
- `Simulator` class = headless world + command producers (2+ fake players) — runs in Node for CI speed, identical code as browser.
- Debug overlays (`F1` grid, `F2` pathfinding, `F3` net, `F4` profiler) are gated by an `IS_DEV` build flag and stripped in production.

---

## 11. Failure Handling Matrix

| Failure | Detection | Recovery |
|---|---|---|
| Sim takes > 40 ms/tick | Tick profiler | Frame drops on that machine (sim runs slower than realtime); no desync (ticks are deterministic regardless of wall time) |
| Command frame missing at expected tick | Client detects gap in tick sequence | Request `R_Resend(frameTick)`; host re-sends from buffer (last 300 ticks). If unrecoverable → desync halt |
| Checksum mismatch | SyncSystem | `DESYNC_HALT` + dump + lobby return |
| Client disconnect | 5 s no-packet timeout | Idle-ify force; announce; if host → end match (v1) |
| Browser tab backgrounded | Visibility API | Sim continues (deterministic); buffer absorbs; on return, catch-up (max 4 ticks/clamp) |
