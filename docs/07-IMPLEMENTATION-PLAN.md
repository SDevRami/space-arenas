# 07 — Implementation Plan

**Status:** Shipped — the phases below reflect the code that exists in this repository today; everything else is marked *Planned — not yet implemented*. Companion tracking lives in `done_list.md`.

This document is both a **status** (what actually exists, with the exact paths) and a
**roadmap** (what is still open). It replaces the earlier aspirational version of this
file, which described unfinished CI, E2E and golden-hash work as if it had landed.

---

## 1. How to read this plan

- **Shipped** — implemented, present in the repo, and (where applicable) covered by a test in `tests/` or `online/tests/`.
- **Placeholder / In progress** — wired into the code but not a finished feature (e.g. campaign mode).
- **Planned — not yet implemented** — designed and documented, but not in the code.
- Status labels follow the convention in `docs/README.md`. Paths are backticked for grepping.

---

## 2. Status snapshot

| Area | Status | Evidence |
|---|---|---|
| npm workspace monorepo (`shared`, `client`, `host`, `online`) | **Shipped** | `package.json` (`workspaces`), `tsconfig.base.json` |
| Deterministic shared core (RNG, fixed-point, protocol, maps, balance) | **Shipped** | `shared/src/rng.ts`, `fixed.ts`, `protocol.ts`, `maps.ts`, `balance/` |
| Simulation & ECS (24 systems, headless `Simulator`) | **Shipped** | `client/src/ecs/`, `client/src/core/Simulator.ts`, `client/src/systems/registry.ts` |
| PixiJS 8 renderer, camera/minimap, weather, day-night | **Shipped** | `client/src/render/` |
| Audio (procedural + baked WAV + diagnostics) | **Shipped** | `client/src/audio/`, `client/dist/sound/` |
| Input & UI shell (HUD, settings, chat, replay save) | **Shipped** | `client/src/input/`, `client/src/ui/` |
| Map builder & library | **Shipped** | `client/src/mapbuilder/` |
| Progression & profile (veterancy, XP/ranks, achievements, daily missions) | **Shipped** | `client/src/profile/`, `tests/day14.test.ts`, `tests/day15.test.ts`, `tests/day19.test.ts` |
| LAN host (rooms, relay, bots, QR invites, discovery, static serving) | **Shipped** | `host/src/`, `tests/e2e-host.test.ts` |
| Online server (auth, matches, mods, maps, backups, rate limits) | **Shipped** | `online/src/`, `online/supabase/migrations/`, `online/tests/online-server.test.ts` |
| Landing page + Community hub (GitHub Pages) | **Shipped** | `online/public/`, `.github/workflows/pages.yml` |
| i18n (English + Arabic, RTL) | **Shipped** | `client/src/i18n/`, `client/src/i18n/lang/{en,ar}.json` |
| Dev tooling (launcher, validator, sound synth, dev-settings registry) | **Shipped** | `run-game.bat`, `scripts/`, `shared/src/dev-settings-registry.ts` |
| Test suites (36 Vitest files / 443 tests; 55 online API tests) | **Shipped** | `tests/`, `online/tests/` — see [09 — Testing & QA](09-TESTING-AND-QA.md) |
| CI test/lint/typecheck gate | **Planned — not yet implemented** | only `.github/workflows/pages.yml` exists |
| Browser E2E (Playwright), fuzz harness, golden hashes | **Planned — not yet implemented** | see [09 — Testing & QA](09-TESTING-AND-QA.md) §11 |
| Campaign / survival scripted modes | **Placeholder** | `client/src/game/match.ts` (`OfflineMode`), `campaign.comingSoon` in `client/src/main.ts` |
| Additional factions, 3D visual tier | **Planned — not yet implemented** | `docs/10-3D-GRAPHICS-TIER-RESEARCH.md` (research only) |

---

## 3. What is shipped, by area

### 3.1 Shared core — `shared/src/`

| File | Role |
|---|---|
| `constants.ts` | `SIM_TICK_HZ = 25`, tick helpers, `PROTOCOL_VERSION`, `MIN_PROTOCOL_VERSION`, the whole `MatchSettings` shape and its defaults. |
| `rng.ts` | Seeded `splitmix32` PRNG + `hashSeed` (deterministic across platforms). |
| `fixed.ts` | Fixed-point maths used by the sim. |
| `protocol.ts` | Binary codec, message families, `CMD_TYPE_IDS` / `PING_TYPE_IDS`, CRC32 checksums. |
| `maps.ts` | Map schema, `validateMap()`, procedural variants. |
| `balance/` | Buildings, units, weapons, upgrades data tables. |
| `mod.ts` | Balance-mod format and merge helpers. |
| `replay.ts` | Replay file format. |
| `settings-file.ts` | Layered settings-file read/write. |
| `dev-settings-registry.ts` | Single source of truth for the Dev panel (see [18 — Dev Tooling](18-DEV-TOOLING.md) §7). |

Shared is type-checked (`tsc --noEmit`) but emits nothing — consumers import the `.ts` sources directly.

### 3.2 Client simulation — `client/src/`

Deterministic, headless-first: `core/Simulator.ts` drives `World` + `stepWorld()`
(`systems/registry.ts`), running 24 systems in a fixed order — Input, Placing,
Production, Economy, Oil, SupplyCapture, Movement, Mines, Crush, Transport,
Scenery, Pathfinding, Work, Combat, Abilities, Heal, Sell, Plane, Airstrike,
Laser, Emp, Vision, WinLoss, **Sync**.

- **ECS:** sparse-set component stores in `client/src/ecs/`.
- **Systems:** one file per system under `client/src/systems/`.
- **Determinism:** `core/hash.ts` (`hashWorld` → `crc32`) + `systems/sync-system.ts`
  (every 60th tick emits `world.onSyncTick`).
- **Bots:** `ai/bot.ts` with 3 difficulty levels (covered by `tests/bot.test.ts`).

### 3.3 Presentation, input & content

- **Render:** `render/` (PixiJS 8 renderer, camera, minimap, ground, shapes,
  weather, sprite bundle).
- **Audio:** `audio/` (Web Audio hooks, haptics, settings) with baked WAVs in
  `client/dist/sound/`.
- **Input:** `input/` (mouse/touch, selection, command mapping).
- **UI:** `ui/` (HUD, chat, controls, graphics/audio settings, map preview,
  game-info catalog) + the lobby/panels in `main.ts` and `index.html`.
- **Map builder:** `mapbuilder/` (editor, library, worldmap).
- **Progression:** `profile/` (profile, achievements, mode records, recorder,
  folder backup) and `stats/` (per-team combat statistics).
- **Modes:** `modes/daily.ts` (daily missions). Campaign exists only as a
  placeholder — `game/match.ts` types `OfflineMode = 'bots' | 'campaign'`, and the
  campaign panel surfaces `campaign.comingSoon`.

### 3.4 LAN host — `host/src/`

`index.ts` (bootstrap + static serving of `client/dist`), `rooms.ts`,
`relay.ts` (lockstep frame relay, **no authoritative simulation**), `bots.ts`,
`passphrase.ts` (PBKDF2 verify), `discovery.ts` (UDP beacon), `qr.ts` (invites),
`archive.ts` (replays), `mods.ts`, `sanitize.ts`.

Exercised end-to-end by `tests/e2e-host.test.ts` (18 tests).

### 3.5 Online server — `online/`

`src/` — `index.ts`, `config.ts`, `rooms.ts`, `relay.ts`, `passphrase.ts`,
`ratelimit.ts`, `sanitize.ts`, `mods.ts`, `maps.ts`, `supabase.ts`.

Persistence in `online/supabase/migrations/`:
`001_init.sql`, `002_match_records.sql`, `003_backups.sql`, `004_mods.sql`,
`005_maps.sql`.

Deployed on Render (`render.yaml`, `rootDir: online`) with `SA_MODE`, `SA_PORT`,
`SA_PASSPHRASE`, `SA_PUBLIC_URL`, `SUPABASE_*` from `.env.example`.

The landing page and Community hub (`online/public/`) are deployed to GitHub Pages
by `.github/workflows/pages.yml`.

### 3.6 Tooling & quality

- **Launcher:** `run-game.bat` (self-checking Windows boot).
- **Scripts:** `scripts/validate-assets.mjs`, `synth-fx.mjs`,
  `fetch-freesound.mjs`, `fetch-freesound-many.mjs`, `sync-online-shared.mjs`.
- **Static checks:** `eslint.config.js`, `.prettierrc`, `tsconfig.base.json`.
- **Docs:** this file, [09 — Testing & QA](09-TESTING-AND-QA.md) and
  [18 — Dev Tooling](18-DEV-TOOLING.md) are code-grounded.

---

## 4. Quality status

See [09 — Testing & QA](09-TESTING-AND-QA.md) for the full inventory. Headlines:

- **443 Vitest tests in 36 files** (`tests/`), all green; `npm run test:soak` is the sequential determinism soak.
- **55 `node:test` cases** in `online/tests/online-server.test.ts` (run by `npm test -w online`, which builds first).
- Determinism is guarded both by hash-equality tests and by the runtime `SyncSystem` comparison (indicator only — no auto-halt).
- The only CI workflow deploys the landing page; **there is no CI test/lint gate**.

---

## 5. Roadmap (open work)

Ordered roughly by risk-reduction, not effort.

| # | Item | Status | Notes |
|---|---|---|---|
| 1 | CI gating: run `lint`, `typecheck` and both test suites on push/PR | *Planned — not yet implemented* | Today only `.github/workflows/pages.yml` exists. |
| 2 | Desync report capture + auto-halt + regression fixtures | *Planned — not yet implemented* | Currently a `syncOk` flag and a HUD indicator only (09 §9). |
| 3 | Playwright browser E2E (lobby → match → results, map builder round-trip) | *Planned — not yet implemented* | No Playwright dependency exists. |
| 4 | Fuzz harness (commands / maps / wire) + pinned golden hashes | *Planned — not yet implemented* | Determinism is currently covered by fixed scripted streams. |
| 5 | Allocation / performance budget gate (`--expose-gc`) | *Planned — not yet implemented* | |
| 6 | Campaign + survival scripted modes | *Placeholder* | `OfflineMode = 'bots' \| 'campaign'`; UI shows `campaign.comingSoon`; `world.ts` documents the scripted-mode end-condition hook. |
| 7 | Second / third faction | *Planned — not yet implemented* | Balance tables are single-faction today. |
| 8 | 3D visual tier | *Planned — not yet implemented* | Research only: `docs/10-3D-GRAPHICS-TIER-RESEARCH.md`. |
| 9 | Cross-OS host smoke in CI; allocation and font/DPR regressions | *Planned — not yet implemented* | |
| 10 | Ongoing balance passes + community growth | Ongoing | Per `README.md` status: released; local dev, community and balance passes continue from here. |

Already shipped and sometimes mistaken for open work: **online map publishing**
(`online/src/maps.ts` + `POST /api/maps`, repo/rate/comment endpoints called from
`client/src/main.ts`, migration `005_maps.sql`) and the **balance-mod repository**
(`online/src/mods.ts`, migration `004_mods.sql`, Community hub UI).

---

## 6. Risk register

| Risk | Likelihood | Impact | Mitigation in place |
|---|---|---|---|
| Determinism drift (float / iteration order) | High | Critical | Integer/fixed-point sim, seeded RNG, `hashWorld` + `SyncSystem`, 443-test suite incl. `tests/determinism.test.ts`. |
| Wire-format/codec drift between client, host and online | Medium | High | `shared/src/protocol.ts` as the single codec, stable `CMD_TYPE_IDS`, round-trip tests (27), protocol-version grace band (`PROTOCOL_VERSION = 22`, `MIN_PROTOCOL_VERSION = 20`). |
| Host/client and balance-mod input can desync or inject bad values | High | High | `DEV_SANITIZE` / `DEV_OVERRIDE_CLAMP` in `shared/src/dev-settings-registry.ts`, `sanitize.ts` on host + online, `sanitizeMod`/`sanitizeSettings` tests. |
| Online abuse (spam, scraping, forged tokens) | Medium | High | `online/src/ratelimit.ts` + session gates; covered by the room-auth and rate-limit suites in 09 §8. |
| Un-gated regressions (no CI) | High | Medium | Local gates only (`npm test`, `npm run lint`, `npm run typecheck`); CI is item 1 in §5. |
| Scope creep (factions, real art, 3D) | High | High | Explicitly deferred in §5; `docs/10` is research only. |

---

## 7. Definition of done (per increment)

For a change to be considered done:

- `npm run lint`, `npm run typecheck` and `npm test` all pass locally.
- Any behaviour change in the simulation adds or updates a `tests/` case (determinism *and* behaviour).
- Any protocol/message change bumps `PROTOCOL_VERSION` and keeps `CMD_TYPE_IDS` stable, with `tests/protocol.test.ts` updated.
- Any new `MatchSettings` field is added to `shared/src/dev-settings-registry.ts` **and** to both language files — then re-check with `node docs/check-i18n.cjs` and `node docs/check-registry-i18n.cjs`.
- Docs (`docs/`), `README.md` and `done_list.md` are updated to match the change.

---

## 8. Milestone history

The day-by-day log (Days 1–35) and the online-server phases (P1–P5, all marked
shipped and verified live) are kept in **`done_list.md`** — that file is the
authoritative chronological record; this document is the consolidated status view.
