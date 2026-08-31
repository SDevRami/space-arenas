# 09 — Testing & QA

**Project:** Space Arenas — RTS game
**Version:** 0.1
**Companion docs:** 03-TECHNICAL-SPECIFICATION.md (budgets), 04-ARCHITECTURE.md (test hooks), 07-IMPLEMENTATION-PLAN.md (when tests gate phases)

QA strategy for a deterministic lockstep RTS. The testing pyramid here is unusual: **determinism is the center of gravity** — a desync is a release-blocking bug, and most of the serious logic is testable headlessly.

---

## 1. The Testing Pyramid (adapted)

```
        ┌────────────────────────────┐
        │   Manual LAN test nights   │   ← highest-value, lowest-volume
        ├────────────────────────────┤
        │   E2E (Playwright)         │   ← lobby→game→lobby flows
        ├────────────────────────────┤
        │   Determinism + fuzz       │   ← THE critical layer
        ├────────────────────────────┤
        │   System/unit (Vitest)     │   ← pure logic: RNG, path, combat, codec
        └────────────────────────────┘
```

---

## 2. Unit & System Tests (Vitest, headless, Node)

### 2.1 What gets unit tests

| Module | Cases |
|---|---|
| `shared/rng.ts` | Known-vector sequences; reseed determinism; no platform dependence |
| `shared/protocol.ts` | Round-trip every message type; truncation/corruption rejection; version checks; canonical float-integer encoding |
| `shared/maps.ts` | `validateMap()` acceptance/rejection table; checksum verification; bounds; spawn-distance rule |
| `shared/balance/*` | Referential integrity (weapons exist, buildings referenced by units exist, costs non-negative); footprint sanity (≤ map size) |
| Pathfinding (A*) | Straight/obstacle/boundary/impassable cases; **identical path across 100 runs** |
| Combat resolution | Cooldown math, armor multipliers, acquisition ordering rule (nearest → lowest ID) |
| Economy | Supply trip timing, power-down pause, refunds/sell, treasury bounds |
| Win/loss | Every end-condition permutation incl. simultaneous-loss draw ordering |

### 2.2 Convention

- Every `SimEvent` producer and every system that reads `world.tick` is a unit test candidate. No system ships without at least one test asserting *determinism* (run twice → identical hash) and one asserting *behavior* (expected outcome on a scripted world).

---

## 3. Determinism Testing (The Critical Layer)

### 3.1 The harness

`Simulator` (04 § 10) runs 2+ fake players against a world. Determinism tests:

1. **Same-input determinism:** feed identical command streams twice (fresh worlds) → assert state hash equal after N ticks.
2. **Cross-order determinism:** shuffle command delivery order at the client boundary (same canonical frame) → assert same result. Proves ordering rule works.
3. **Cross-timing determinism:** same stream applied with different frame-rate pacing (simulate 30/60/120 Hz delivery) → same result. Proves wall-clock independence.
4. **Seeded RNG determinism:** consume RNG in a scripted sequence → assert exact sequence; assert render/audio never advance it.
5. **Snapshot determinism:** serialize world → hash; deserialize → hash; must match (locks the serialization contract).
6. **Long-run soak:** 1000 ticks, 200 entities, random scripted commands, hash logged every 60 ticks; CI compares a checked-in golden hash file. Any engine/browser change that shifts the golden hash is flagged.

### 3.2 Fuzz testing

- **Command fuzz:** random valid + invalid command streams (bad targets, out-of-bounds, negative cash, queued on destroyed buildings). Assert: world never throws (graceful rejection), state hash remains reproducible, and invalid commands produce *documented* outcomes (rejection events).
- **Map fuzz:** programmatic map generation (random sizes 64–256, random obstructions/supply fields) → validate → build worlds → run 200 ticks. Catches schema/handling edge cases.
- **Wire fuzz:** mutate valid messages byte-wise → assert codec rejects or safely decodes; never crashes; never yields NaN/Infinity in state.

### 3.3 CI gating

- `npm test` runs: unit + determinism + fuzz (reduced iterations) + golden-hash check.
- Full fuzz runs nightly (long). Golden-hash drift requires an explicit documented `GOLDEN_UPDATE` commit — a deliberate, reviewable determinism change.

---

## 4. Desync Triage (When It Still Happens)

Despite best efforts, desyncs are possible. The triage loop:

1. **Detect:** `SyncSystem` hash mismatch → `DESYNC_HALT`.
2. **Capture:** both clients write a desync report (06 § 3.4): command log, per-tick state hashes, protocol version, map.
3. **Reproduce headlessly:** the report is *exactly* a command stream → feed into `Simulator` → the divergence point is a debugging line.
4. **Bisect:** binary-search ticks between last-matching and first-differing hash; inspect the affected system.
5. **Fix + regress:** add the report as a golden regression test (permanent fixture), fix, and confirm the fixture now passes.
6. **Post-mortem:** record the root cause class (float? iteration order? codec?) in a table below to guide code review.

**Common root-cause classes (tracked):**

| Class | Example | Guard |
|---|---|---|
| Float leakage | `Math.sqrt` crept into combat range check | Code review + banned-math linter rule |
| Iteration order | System iterated a `Map` by insertion order | Review + deterministic iteration rule in 04 § 4.2.3 |
| Clock leak | `performance.now()` in a damage modifier | Same |
| Codec drift | Host serialized 32-bit, client read 16-bit | Mandatory round-trip tests per message |
| Non-atomic state read | Renderer mutated a component via a shared reference | Event bus discipline + frozen read-only view |

---

## 5. Network Testing (LAN focus)

### 5.1 Automated

- **Protocol tests:** lobby join/leave/ready/start flows, passphrase accept/reject, wrong version rejection, seq violation drop.
- **Relay tests (Node):** N simulated clients → host; assert frame assembly order and tick pacing; inject reordering/duplication → assert canonical result.
- **Fault injection:** kill a client mid-match → idle-ify + announce; kill host → end-to-lobby. Assert no hang/crash in surviving clients.
- **Frame-gap resend:** inject dropped `R_CommandFrame` → client requests `R_Resend` → assert seamless recovery within buffer budget.

### 5.2 Manual (required for release)

- **Two+ real machines on one router:** host + 1..7 clients; smoke every game mode (1v1, 2v2, FFA).
- **Wi-Fi + Ethernet mix** (different jitter profiles): verify adaptive buffer holds (04 § 5.3).
- **Host + client on the same machine** (localhost): verify no special-casing bugs in the relay.
- **Firewall test:** document the port (default 17321) + `netsh`/router note in README; verify UPnP/port-forward instructions are optional (LAN-only, usually none needed).

### 5.3 Latency/UX verification

- Target: perceived input-to-action ≤ 100 ms. Measure with the net overlay (04 § 6); assert buffer depth stays ≤ 6 ticks on stable LAN.
- Confirm client prediction feels responsive even when a guest has a 100 ms RTT (worst realistic LAN Wi-Fi case).

---

## 6. Cross-Browser & Cross-OS Testing

### 6.1 Matrix (Playwright E2E)

| Browser | OS | Scope |
|---|---|---|
| Chrome (latest, prev) | Windows / macOS / Linux | Full: lobby → match → win/loss → desync halt UX |
| Firefox (latest, prev) | Windows / Linux | Full |
| Edge (latest) | Windows | Full |

E2E scenarios:
- Load client → lobby → join room (valid/invalid passphrase) → start → move/attack/queue → finish → return to lobby.
- Desync simulation: inject a forced hash mismatch → assert halt + report dump + clean return.
- Map builder: load → paint → place → validate → export → re-import → same checksum.
- Resize / zoom / DPR change mid-match → no visual breakage, sim unaffected (Protocol 3).

### 6.2 Browser-specific risks

- **Firefox:** WebGL context limits; PixiJS batch shader differences → visually compare screenshots of the F5 visual grid per browser.
- **Safari (future, not v1 target):** WebSocket + WebGL are fine; `devicePixelRatio` quirks → revisit when adding Safari to the matrix.
- **Node host on all three OSes:** `ws` + HTTP static serving smoke-tested in CI on Windows/macOS/Linux runners.

---

## 7. Performance Testing

### 7.1 Automated (in CI, headless Chrome)

- **Sim CPU budget:** `Simulator.step` 1000 ticks with 400 entities; assert avg tick < 8 ms (03 § 3). Fail PR if exceeded by > 20%.
- **Allocation gate:** `global.gc()` before/after a 1000-tick soak in a Node run with `--expose-gc`; assert new heap < threshold (1 MB/tick target). This enforces the zero-alloc rules (04 § 7.3).
- **Golden-hash soak:** same fixture as § 3.1.6 — catches both logic and perf regressions.

### 7.2 Manual (dev overlay)

- `F4` profiler shows per-system ms/tick — use during any content addition to spot hot systems.
- Reference hardware tiers (03 § 11): every Beta milestone validated on low/mid/high.

---

## 8. Hit-Box / Selection Debugging

For an RTS, "hit boxes" are click-selection areas and placement footprints. Tooling:

- `F1` grid overlay shows tile boundaries + entity footprints (units 1×1, vehicles 1×2, buildings w×h).
- Hover highlight shows the exact footprint under the cursor; placement ghost tints valid/invalid tiles (02 § 5).
- A test mode script places entities at known coordinates → assert click maps to the correct entity (regression test for the screen↔tile inverse transform).
- Mouse-to-tile inverse transform has dedicated unit tests for zoom extremes (0.5× and 2.5×) and DPR 1 / 1.5 / 2.

---

## 9. QA Dashboards & Definition of "Green"

| Gate | Requirement |
|---|---|
| PR CI | lint + typecheck + unit + determinism + codec round-trip + allocation gate |
| Nightly | full fuzz (commands/maps/wire), cross-browser E2E smoke, Node OS matrix |
| Phase exit | manual LAN test nights + budget checks on 3 hardware tiers |
| Release | 5 consecutive 20-min LAN matches across 4 maps, 2–8 players, zero desync |

---

## 10. Test Fixtures Directory (Target)

```
tests/
├── unit/           # Vitest suites (shared, balance, pathfinding, combat, economy...)
├── determinism/    # harness + golden hashes + desync regression fixtures
├── fuzz/           # command/map/wire fuzzers + nightly config
├── protocol/       # round-trip + fault-injection relay tests (Node)
├── e2e/            # Playwright specs + screenshots baseline
└── fixtures/
    ├── maps/       # valid + invalid test maps
    └── desync/     # archived real desync reports (regression fixtures)
```

---

## 11. Final QA Checklist (Release)

- [ ] Full CI green on all 3 OS runners.
- [ ] Playwright matrix green (Chrome/FF/Edge, latest+prev).
- [ ] 5×20-min LAN matches, zero desync; desync report feature verified working (triggered on demand).
- [ ] Budgets on low/mid/high hardware within tolerance.
- [ ] Map builder ↔ game checksum fidelity confirmed.
- [ ] README LAN quick-start verified from scratch (fresh Node install → 3 commands → 2 machines).
