# 09 — Testing & QA

**Status:** Shipped — grounded in the suites that exist under `tests/` and `online/tests/` and in the current CI workflows. Items the older plan promised but the code does not yet have are marked *Planned — not yet implemented*.

Space Arenas is a deterministic lockstep RTS: every peer runs the identical
simulation from identical inputs, so **determinism is the centre of gravity** of QA.
Most of the serious logic is headless-testable in Node, which is exactly how the
suite is built. Paths and identifiers are in backticks so you can grep them.

---

## 1. How the suites are run

| Suite | Command | Runner / config |
|---|---|---|
| Root Vitest | `npm test` | `vitest run`; config `vitest.config.ts` — `include: ['tests/**/*.test.ts']`, `environment: 'node'`, `@space-arenas/shared` aliased to `shared/src/index.ts`. |
| Root Vitest (watch) | `npm run test:watch` | `vitest`. |
| Determinism soak | `npm run test:soak` | `vitest run tests/determinism --pool=forks --poolOptions.forks.singleFork=true --sequence.concurrency=1 --sequence.shuffle=false` — sequential, single-fork, no shuffling. |
| Online server | `npm test -w online` | Builds first, then `tsx --test tests/online-server.test.ts` (`node:test`). |

The two root suites are separate: the root Vitest run only includes
`tests/**/*.test.ts`, and `online/tests/online-server.test.ts` is **not** part of it
(the online workspace builds and runs it itself).

**Verified current totals** (local `npm test` run):

- **36 test files, 443 tests, all passing** (root Vitest). Duration ≈ 1.8–2.3 min, dominated by `e2e-host.test.ts` and `bot.test.ts`.
- **55 `it(...)` cases** in `online/tests/online-server.test.ts` (`node:test`, 8 `describe` blocks).

> The `README.md` figures (428 Vitest / 19 protocol / 31 online) predate the
> current suites; the numbers above are read from the files and a fresh run.

---

## 2. Root Vitest suite — inventory

All 36 files live directly in `tests/` (no subdirectories). Counts are the actual
`it` cases reported by Vitest (some files use `it.each`, so a file that "looks"
like a dozen cases can expand to more).

### 2.1 Core simulation, determinism & settings

| File | Tests | Covers |
|---|---|---|
| `tests/determinism.test.ts` | 7 | Same-input lockstep (400 ticks), cross-run hash equality (1500 ticks), no-command run, forfeit stays in lockstep. |
| `tests/rng.test.ts` | 9 | `shared/rng.ts` `splitmix32` known vectors, `hashSeed`, reseed determinism. |
| `tests/settings.test.ts` | 11 | `match settings`: two simulators with balance overrides stay in lockstep, etc. |

### 2.2 Protocol, balance, maps & mods

| File | Tests | Covers |
|---|---|---|
| `tests/protocol.test.ts` | 27 | Envelope round-trip, frames, checksums, **stable type ids**, match start, control-message round-trip, settings-file layering, client dev-settings sanitizer. |
| `tests/balance.test.ts` | 11 | `balance: integrity`, `balance: weapons`, `balance: timing`. |
| `tests/maps.test.ts` | 33 | Default map, `validateMap` acceptance/rejection, canonical serialization, creative variants, grid accessors. |
| `tests/mods.test.ts` | 26 | `isValidMod`, `mergeEntityMaps`, `modSettingsDelta`, `modFromSettings`, `modFileName`, `sanitizeMod`, `sanitizeSettings`, `createModStore`. |

### 2.3 Gameplay systems & domain rules

| File | Tests | Covers |
|---|---|---|
| `tests/abilities.test.ts` | 26 | Grenade throw, ability eligibility, abilities research gate, smoke throw, stealth, detectors, lockstep determinism. |
| `tests/combat.test.ts` | 8 | `fire`, `applyDamage`. |
| `tests/construction.test.ts` | 21 | Bulldozer-required construction, build/resume/stop, repair, power tracking, CC rebuilding, spawn points, flags, boxed-in reach. |
| `tests/crush.test.ts` | 6 | Vehicle run-over of infantry. |
| `tests/economy.test.ts` | 3 | `EconomySystem` supply trips/bounds. |
| `tests/engineer.test.ts` | 11 | Engineer single-target heal, healing aura, lockstep determinism. |
| `tests/mines.test.ts` | 19 | Mine placement, detonation, removal, lockstep determinism. |
| `tests/oil.test.ts` | 3 | `OilSystem` claiming/income. |
| `tests/oil-destroy.test.ts` | 3 | Destructible oil fields. |
| `tests/queue-reorder.test.ts` | 6 | Build-queue reorder keeps two simulators in lockstep. |
| `tests/sea-army.test.ts` | 12 | Naval movement on open water, dock shoreline placement, sea missiles/splash, carrier amphibious transport. |
| `tests/transport.test.ts` | 17 | APC boarding/unloading, bunker garrison unloading. |
| `tests/veterancy.test.ts` | 9 | Kill credit / ranks, stat bonuses, lockstep determinism. |
| `tests/vision.test.ts` | 6 | `VisionSystem`. |
| `tests/winloss.test.ts` | 4 | `WinLossSystem` end conditions. |
| `tests/camera.test.ts` | 4 | `Camera.isInViewBox`. |
| `tests/nav-corner.test.ts` | 17 | Units rounding buildings, one-tile corridors, formation points on footprints — no deadlocks. |

### 2.4 AI, replay & crypto helpers

| File | Tests | Covers |
|---|---|---|
| `tests/bot.test.ts` | 11 | Bot determinism, economy over time, army training, combat reach, difficulty scaling. |
| `tests/archive.test.ts` | 10 | `validReplay`, name helpers, `createArchiveStore`. |
| `tests/pbkdf2.test.ts` | 2 | `pbkdf2-sha256` secure-context fallback matches standard vectors and the host passphrase flow. |

### 2.5 Milestone ("Day N") feature suites

| File | Tests | Covers |
|---|---|---|
| `tests/day12.test.ts` | 18 | Defense Dome, Bunker garrison, rank-5 weapon upgrade, research plumbing, determinism. |
| `tests/day13.test.ts` | 11 | Super-weapon choice, Airstrike, EMP strike, determinism. |
| `tests/day14.test.ts` | 17 | Profile games/wins keys, cumulative achievements, `SessionRecorder`, spectator recording. |
| `tests/day15.test.ts` | 15 | Match score, general rank ladder, rank-gated research, leveled super weapons, profile total score. |
| `tests/day16.test.ts` | 15 | Shared supply bank, fused power grid, combined rank ladder, alliance win/loss after partial quits, control sharing. |
| `tests/day19.test.ts` | 12 | Daily mode records, daily seed determinism, daily missions, level/XP. |
| `tests/day21.test.ts` | 7 | Auto-fire toggle, formation commands. |
| `tests/day22.test.ts` | 8 | Supply-field capture bonus (capture + bonus trips deterministic). |

### 2.6 Host end-to-end

| File | Tests | Covers |
|---|---|---|
| `tests/e2e-host.test.ts` | 18 | Spawns a real host process and drives full lobby→match→lobby flows (see §5). |

---

## 3. Determinism testing

Determinism is enforced at two levels:

- **Pure hash equality.** `tests/determinism.test.ts` steps two fresh `World`
  instances with identical command streams and asserts their state hashes match —
  at 400 ticks, across separate runs at 1500 ticks, and with no commands at all.
  A forfeit test proves the match keeps running in lockstep after a player leaves.
- **The hash itself.** `client/src/core/hash.ts` `hashWorld(world)` serialises the
  tick, grid size, RNG state, per-team economy/tech fields and every component
  store into a byte stream, then CRC32s it via `crc32` from `@space-arenas/shared`.
  `compactHash` renders it as 8 hex digits. Iteration is deterministic (component
  ids come from `idsArray()`, teams are sorted).

`client/src/systems/sync-system.ts` runs last in the pipeline
(`client/src/systems/registry.ts` → `SYSTEMS`) and, on every tick,
sets `world.lastHash`; every **60th tick** it fires `world.onSyncTick(hash)`.

**Soak command.** `npm run test:soak` is the long-run determinism check: it pins
Vitest to one fork and no concurrency so timing/scheduling can't mask a divergence.

---

## 4. Protocol & wire-format tests

`tests/protocol.test.ts` (27 tests) exercises `shared/src/protocol.ts`:

- **Envelope round-trip** for every command family and **stable type ids**:
  `CMD_TYPE_IDS` maps 38 command types to fixed integers, and `PING_TYPE_IDS` maps
  the three ping types (`alert`/`assist`/`on-my-way`). The "type ids are stable"
  suite locks these down so a reordering can't silently break wire compatibility.
- **Frame & checksum** messages (`CMD: 1`, `FRAME: 2`, `CHECKSUM: 3`,
  `RELAY_CHECKSUM: 4`).
- **Control-message round-trip** and **match-start** messages.
- **Settings-file layering** and the **client dev-settings sanitizer**.

**Protocol versioning.** `shared/src/constants.ts` defines
`PROTOCOL_VERSION = 0x5c ^ 0x4a` (= **22**) and `MIN_PROTOCOL_VERSION = PROTOCOL_VERSION - 2`
(= **20**). The online server's "protocol version gate" suite (§8) admits clients
inside the grace band, rejects those far outside it, and admits old clients that
omit the field entirely.

---

## 5. Host end-to-end (`tests/e2e-host.test.ts`)

This is the only true end-to-end suite: it spawns a real host (the built
`host/dist/host.js`, or `tsx` when running from source), then speaks the actual
WebSocket protocol to it. The 18 cases cover:

- join → reach lobby → start a match → relay frames and checksums; wrong-passphrase rejection;
- `C_PING` / `H_PONG` (host device reported);
- `SA_ALLOW_DOWNLOADS=0` refusing remote static downloads while still serving loopback;
- stale room-code refusal; slot/room options (names, teams, map, password, ready);
- a player quitting mid-match ends it for everyone; a non-host leaving continues a 3-player match with a relayed forfeit;
- slot reclaim via `clientId` during the grace window; rejecting a second live connection that reuses an active `clientId`;
- co-op edge cases (an ally quitting while enemy bots remain; the host quitting → draw);
- host-added bots (ready, count toward capacity, play through the relay);
- auto-saving a JSON replay after a match, and relay-stamped bot commands in the replay history;
- the `archive` API (upload/list/rename/delete), the `mods` API (upload/list/read/rename/delete/apply) and the `settings` API (round-trips `profile/settings.json` and gates guests on effective defaults).

Because it launches real processes and waits on sockets, this suite dominates the
wall-clock time of the run.

---

## 6. Balance integrity

`tests/balance.test.ts` guards the data tables in `shared/src/balance/`:

- **integrity** — referenced entities exist and costs are non-negative;
- **weapons** — weapon values are sane;
- **timing** — timing values are consistent.

The domain suites (combat, transport, veterancy, mines, sea-army, …) then prove
those tables produce the intended *behaviour*.

---

## 7. Static / supporting checks

These are run manually (see [18 — Dev Tooling](18-DEV-TOOLING.md)):

| Check | File | What it validates |
|---|---|---|
| i18n completeness | `docs/check-i18n.cjs` | Every `dev`/`mods`/`offline`/`lobby`/`app`/`results`/`profile` key used in `client/src/main.ts` + `client/index.html` exists in **both** `client/src/i18n/lang/en.json` and `ar.json`. |
| Registry i18n | `docs/check-registry-i18n.cjs` | The dev-settings registry's sections/fields/units all have `dev.sections.*`, `dev.fields.*`, `dev.overrides.*` and `dev.units.*` keys in EN + AR. |
| Asset manifest | `scripts/validate-assets.mjs` | Hashes every built `.js`/`.css`/`.html` in `client/dist` (SHA-256) into `reports/asset-manifest.json`. |

Both `docs/*.cjs` helpers are git-ignored local tools; neither is wired into an npm
script or CI.

---

## 8. Online server suite (`online/tests/online-server.test.ts`)

A `node:test` suite (55 `it` cases across 8 `describe` blocks), run by
`npm test -w online` — which **builds the server first** (`esbuild`) and then runs
`tsx --test`. It drives the Express API and a WebSocket round-trip. Areas:

| Describe | What it covers |
|---|---|
| `online server API` | `status` reports mode + protocol; create/list/find rooms; join pre-check `ws` URL and 404 on unknown rooms; CORS preflight allows `Authorization` and `DELETE`. |
| DB-unconfigured routes | `status` reports `db:false`; auth (`register`/`login`/`change-password`/`me`) and leaderboard return **503** without Supabase env. |
| disabled mode | All API room endpoints return 503 when `SA_MODE != online`. |
| backups + rate limiting | `rateLimit` slides with time; backups require a session token; a burst of uploads is rate-limited with `Retry-After`. |
| mod repository | `sanitizeMod` unit; repo/download 503 without DB; upload/rate/comment/delete require a session; upload burst rate-limited. |
| map repository | `sanitizeMap` unit; repo/download 503 without DB; publish/rate/comment/delete require a session; upload burst rate-limited. |
| CORS allow-list | Only echoes `ACAO` for an allowed origin when `SA_CORS_ALLOW` is set. |
| websocket join | Host + guest lobby round-trip over `/ws`; wrong passphrase rejected. |
| tamper watch | Settings fingerprint is deterministic and value-sensitive; mid-match settings changes are flagged and the host can kick or skip. |
| protocol version gate | Admits a client inside the grace band, rejects one far outside it, and admits old clients that omit `protocolVersion`. |
| wire-frame validation | Relays a valid command but drops malformed frames and kicks repeat offenders. |
| balance-mod gate | Host uploads a mod: lobby announces it, settings merge, guests must ack before start; host can clear the mod and start with no ack. |
| room auth gate | Creating a room and `C_JOIN` require a verified session; a 401 carries `WWW-Authenticate: Bearer`; public read surface stays open; per-account room-write limits hold from a fresh IP. |

The server-side sanitizers (`online/src/sanitize.ts`) are covered as units inside
this same file.

---

## 9. Desync detection (what actually happens)

The client does **not** hard-halt on a hash mismatch. Instead:

1. `SyncSystem` calls `world.onSyncTick(hash)` every 60 ticks;
2. `Game.ts` (`world.onSyncTick`, ~line 1169) stores the hash in
   `pendingChecks` and, when connected, sends it via `net.sendChecksum(tick, hash)`;
3. when a peer's checksum arrives, `Game.onNetChecksum(player, tick, crc)` compares
   it to the local `pendingChecks` entry and sets `syncOk = mine === crc`;
4. the HUD renders `hud.inSync` / `hud.desync` (`client/src/ui/hud.ts`), and the dev
   perf panel shows `dev.perfSync`.

So a divergence is **surfaced** (the sync indicator flips to "desync") rather than
halting the match, and there is no automatic report dump. A richer triage flow —
halt, desync report capture, bisect and a checked-in regression fixture — is
*Planned — not yet implemented*.

---

## 10. Manual QA & release checklist

Automated coverage is strong for logic but thin for presentation and cross-browser
behaviour. Before a release, verify manually:

- [ ] **LAN nights:** two or more real machines on one router; smoke 1v1, 2v2 and FFA; confirm the sync indicator stays "in sync".
- [ ] **Mixed transports:** Wi-Fi + Ethernet on the same match.
- [ ] **Localhost:** host and client on one machine (no special-casing bugs in the relay).
- [ ] **Firewall / port:** the default port is `17321`; verify the README/launcher guidance and that no manual port-forwarding is required on LAN.
- [ ] **Map builder:** paint → place → validate → export → re-import → same checksum.
- [ ] **Replays:** a saved replay re-plays without divergence.
- [ ] **i18n:** both English and Arabic (RTL) render with no missing keys — run the §7 helpers first.
- [ ] **Online:** room create/join, account flows, backups, mod repository and tamper-watch verdicts against a deployed server.

`run-game.bat` (Windows) automates the local prerequisites (Node/npm/deps/port/
firewall) before hosting — see [18 — Dev Tooling](18-DEV-TOOLING.md) §8.

---

## 11. What is *not* tested / automated

Be explicit about the gaps so they aren't mistaken for coverage:

| Gap | Status |
|---|---|
| CI runs lint / typecheck / tests | *Planned — not yet implemented.* The only workflow is `.github/workflows/pages.yml` (GitHub Pages deploy of `online/public`). There is **no** test, lint or typecheck gate. |
| Playwright / browser E2E | *Planned — not yet implemented.* No Playwright dependency or specs exist. |
| Command / map / wire **fuzz** harness | *Planned — not yet implemented.* Determinism is covered by fixed scripted streams, not random fuzzing. |
| Golden-hash file / `GOLDEN_UPDATE` flow | *Planned — not yet implemented.* Hashes are compared between runs in-process, not pinned to a checked-in file. |
| Allocation / performance gate | *Planned — not yet implemented.* No `--expose-gc` allocation budget or CI perf gate. |
| Cross-OS host smoke in CI | *Planned — not yet implemented.* |
| Desync report capture + auto-halt | *Planned — not yet implemented* (see §9). |

Older revisions of this document described the rows above as if they shipped; they
did not. Treat the table as the current truth.
