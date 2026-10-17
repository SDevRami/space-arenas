# 18 — Dev Tooling

**Status:** Shipped — mirrors the npm scripts, validation/synthesis scripts, local helper files and the dev-settings registry that exist in this repository. Anything described as *Planned* is not in the code yet.

This document is the map of the project's developer tooling: how the monorepo is
built and tested, how assets and sounds are generated/validated, the two local i18n
completeness checks, the **dev-settings registry** that is the single source of truth
for the in-game Dev panel, and the Windows launcher. Paths and identifiers are in
backticks so you can grep them.

---

## 1. npm scripts

### 1.1 Root scripts (`package.json`)

Root is an npm workspace umbrella (`shared`, `client`, `host`, `online`). It
orchestrates the workspaces; it does not ship code itself.

| Script | Command | What it does |
|---|---|---|
| `npm run dev` | `concurrently -k -n client,host … "npm:dev:client" "npm:dev:host"` | Runs the Vite client and the `tsx watch` host together. |
| `npm run dev:client` | `npm run dev -w client` | Vite dev server for `client/`. |
| `npm run dev:host` | `npm run dev -w host` | `tsx watch src/index.ts` for `host/`. |
| `npm run build` | `npm run build -w shared && … client && … host` | Builds shared (typecheck), then client (Vite), then host (esbuild). |
| `npm run typecheck` | `npm run typecheck -w shared && … client && … host` | `tsc --noEmit` across the three workspaces. |
| `npm test` | `vitest run` | The root Vitest suite (see [09 — Testing & QA](09-TESTING-AND-QA.md)). |
| `npm run test:watch` | `vitest` | Vitest in watch mode. |
| `npm run test:soak` | `vitest run tests/determinism --pool=forks --poolOptions.forks.singleFork=true --sequence.concurrency=1 --sequence.shuffle=false` | Sequential, single-fork determinism soak for lockstep confidence. |
| `npm run lint` | `eslint .` | Flat-config ESLint (see §9). |
| `npm run format` | `prettier --write .` | Prettier write (`.prettierrc`). |
| `npm run validate:assets` | `node scripts/validate-assets.mjs` | Hashes built assets (see §2). |
| `npm run synth:fx` | `node scripts/synth-fx.mjs` | Bakes placeholder WAV sound effects (see §3). |

`dev`, `build` and `typecheck` cover only `shared`/`client`/`host`; `online` is
built, typechecked and tested from its own workspace (§1.2).

### 1.2 Workspace scripts

| Workspace | Key scripts | Notes |
|---|---|---|
| `shared` | `build`, `typecheck` → `tsc -p tsconfig.json --noEmit` | Shared is **type-checked only** — it emits no JS; consumers import its `.ts` sources directly. |
| `client` | `dev` → `vite`; `build` → `tsc --noEmit && vite build`; `preview` → `vite preview`; `typecheck` | Vite bundles the browser app; PixiJS 8 dependency. |
| `host` | `dev` → `tsx watch src/index.ts`; `build` → `esbuild src/index.ts --bundle --platform=node --format=esm --outfile=dist/host.js --external:ws --external:qrcode && npm run typecheck`; `start` → `node dist/host.js` | esbuild single-file bundle; `ws` and `qrcode` stay external. |
| `online` | `dev` → `tsx watch src/index.ts`; `build` → `esbuild src/index.ts … --outfile=dist/online.js --external:ws --alias:@space-arenas/shared=./shared/src/index.ts && npm run typecheck`; `start` → `node dist/online.js`; `test` → `npm run build && tsx --test tests/online-server.test.ts` | Its own build; `online test` rebuilds first, then runs the `node:test` suite. |

**Build-tool split.** `tsc` is used only for type-checking (`--noEmit`). Vite
(`client`) and esbuild (`host`, `online`) do the actual bundling, which is why the
root `build` order is `shared → client → host`.

---

## 2. Asset validation — `scripts/validate-assets.mjs`

A small post-build sanity check for the committed browser bundle.

- Requires `client/dist/` to exist; exits 1 with `client/dist not found — run \`npm run build\` first` otherwise.
- Recursively collects `.js`, `.css` and `.html` files under `client/dist/`.
- For each file: byte length + **SHA-256** hash (via `node:crypto`), printed and collected.
- Writes the full list to `reports/asset-manifest.json` (the `reports/` directory is created on demand and is not part of the tracked docs).
- Fails the run if `client/dist` contains no built assets.

There is **no test/CI gate** on this script — it is run manually.

---

## 3. Sound synthesis — `scripts/synth-fx.mjs`

A deterministic, offline WAV "bakery" that generates placeholder sound effects
(and ambients) into `client/dist/sound/`. It is what `npm run synth:fx` calls.

- **Determinism:** every sample is driven by a seeded `mulberry32` PRNG, so the
  same recipe always produces the same bytes.
- **Output layout:** `client/dist/sound/<kind>/v{n}.wav`, plus
  `client/dist/sound/manifest.json` mapping `kind → variant count`.
- **Sample rates:** SFX at **44100 Hz** (`SR`); ambients at **22050 Hz** (`AMBIENT_SR`).
  Ambient loops are 45 s long; SFX lengths vary per recipe.
- **Signal helpers:** `addTone` (sine/square/saw/triangle with pitch sweep and
  tremolo), `addNoise` (white/pink/brown with one-pole low/high-pass), `envAt`
  (attack/release envelope), and `finalize` (peak-normalise to `0.89` then
  `tanh` soft-clip).
- **Writer:** a hand-rolled 16-bit mono PCM `RIFF/WAVE` writer; `verify` re-reads
  each file and asserts the RIFF header + data length before continuing.

The 24 recipes (kind → variants):

| Group | Kinds |
|---|---|
| UI | `select`, `move-bleep`, `alert` |
| Weapons | `weapon-rifle`, `weapon-rocket`, `weapon-cannon`, `weapon-artillery`, `weapon-air-cannon` |
| Events | `unit-trained`, `building-completed`, `upgrade-completed`, `supply-harvested`, `combat-hit`, `laser-strike`, `bomb-strike`, `emp-strike`, `power-down`, `game-over`, `achievement` |
| Ambients | `ambient-lobby`, `ambient-game`, `rain-ambient`, `snow-ambient`, `storm-ambient` |

---

## 4. Real-sound fetch (optional) — `scripts/fetch-freesound*.mjs`

Two optional scripts replace the synthesized placeholders with real **CC0**
recordings from [Freesound](https://freesound.org):

| Script | Purpose |
|---|---|
| `scripts/fetch-freesound.mjs` | Fetches a small starting set (2–3 variants) per kind. |
| `scripts/fetch-freesound-many.mjs` | Tops each kind up toward `TARGET = 12` variants, keeping existing `v*.wav`. |

Shared behaviour:

- Requires the environment variable `FREESOUND_TOKEN` (a Freesound client API key); exits early if unset.
- Uses the `curl.exe` binary for HTTP, plus `ffprobe`/`ffmpeg` to probe duration and convert the HQ MP3 preview to mono PCM at the target rate with `loudnorm`.
- Reads/writes the same `client/dist/sound/` tree and `manifest.json`; **keeps the generated files** for any kind it cannot resolve.
- Writes `client/dist/sound/CREDITS.md` (a table of kind / variant / sound id / name / author).

These are manual tools — not wired into any npm script, build or CI. The variants
are cross-checked in-game via the Dev panel's audio section (§7).

---

## 5. Online shared vendoring — `scripts/sync-online-shared.mjs`

The `online/` folder is deployed standalone (Render `rootDir: online`), so it
carries a vendored copy of the shared sources.

- Copies `shared/src/` → `online/shared/src/`, **only `.ts` files** (directories
  and TS sources; no `.js`).
- Deletes the destination first, then re-copies, so removals propagate.
- Run it **after any change under `shared/src/`** — especially `protocol.ts` /
  `PROTOCOL_VERSION` — before pushing the online service.

---

## 6. i18n completeness checks (local helpers)

Two small CommonJS scripts live in `docs/` locally (git-ignored) and verify that
the English + Arabic language files stay in sync with the code. Their knowledge is
captured here.

### 6.1 `docs/check-i18n.cjs`

- Reads `client/src/i18n/lang/en.json` and `client/src/i18n/lang/ar.json`, flattening both to dotted key sets.
- Scans `client/src/main.ts` and `client/index.html` for:
  - string literals matching `(dev|mods|offline|lobby|app|results|profile)\.[A-Za-z0-9_.]+`;
  - `data-i18n`, `data-i18n-placeholder`, `data-i18n-title` attribute values.
- Prints every used key missing from `en.json` and from `ar.json`.

### 6.2 `docs/check-registry-i18n.cjs`

Cross-checks the **dev-settings registry** (`shared/src/dev-settings-registry.ts`)
against the language files. It extracts, via regex:

- `title: '…'` → must exist as `dev.sections.<title>`;
- `{ key: '…'` → `dev.fields.<key>.label` and `.desc`;
- `{ field: '…'` → `dev.overrides.<field>.label` and `.desc`;
- `unit: '…'` → `dev.units.<mapped>` (raw unit strings are mapped, e.g. `hp/tick → hpPerTick`, `0–1 → fraction`, `% → percent`).

It prints any missing EN / AR keys.

Neither script is wired into an npm script or CI; run them with `node docs/check-i18n.cjs`.

---

## 7. The Dev settings registry & panel

### 7.1 `shared/src/dev-settings-registry.ts` — the single source of truth

This file owns **everything the Dev panel needs to render**, so the client form,
the host sanitizer and the balance-mod clamps all read the same values. Editing a
range or adding a field is a one-file change. Exports:

| Export | Shape | Role |
|---|---|---|
| `DEV_SCALAR_SECTIONS` | `DevScalarSectionDef[]` — `{ title, fields[] }`; each field is `{ key, unit?, min, max, step, seconds? }` | Product-level `MatchSettings` scalars grouped into titled sections; `seconds: true` means *stored in ticks, edited in seconds*. |
| `DEV_OVERRIDE_BUILDING_FIELDS` | `DevOverrideFieldDef[]` | Editable per-building fields. |
| `DEV_OVERRIDE_UNIT_FIELDS` | `DevOverrideFieldDef[]` | Editable per-unit fields. |
| `DEV_OVERRIDE_WEAPON_FIELDS` | `DevOverrideFieldDef[]` | Editable per-weapon fields. |
| `DEV_OVERRIDE_UPGRADE_FIELDS` | `DevOverrideFieldDef[]` | Editable per-upgrade fields. |
| `DEV_SANITIZE` | `Record<string, { min, max }>` | Host-side clamp for every numeric `MatchSettings` scalar accepted from clients (dev panel, room updates, balance-mod files). Values are raw ticks/units and intentionally a touch wider than the UI. |
| `DEV_OVERRIDE_CLAMP` | `Record<string, { min, max }>` | Host clamp for per-field values inside the override maps. |

A `DevOverrideFieldDef` may carry `only: string[]`, restricting the field to
specific entity ids (e.g. `capacity`/`maxAmmo`/`reloadTicks` only for `fighter`;
`powerGen` only for `power-plant`; `splash` only for `artillery`).

Scalar sections (in file order): `economy`, `satellite`, `power`, `laser`,
`superWeapon`, `fog`, `abilities`, `stealth`, `dayNight`, `mines`, `heal`,
`worldFields`, `movement`, `combat`, `veterancy`, `planes`, `pathfinding`.

### 7.2 The two Dev surfaces in the client

Do not confuse the two:

| Element | Where | What it is |
|---|---|---|
| `#dev-overlay` (`client/index.html`) | in-game | The debug overlay: `#dev-perf`, `#dev-hud-toggles`, `#dev-render-btns`, `#dev-shortcuts`, `#dev-close`. |
| `#dev-panel` (`client/index.html`) | lobby, `hidden-panel` | The **Dev Settings** form (the registry-driven UI). Toggled by the Dev menu button `#dev-btn`. |

The Dev Settings pane contains the toolbar (`#dev-search`, three `.dev-tab`
buttons with `data-dev-group` = `all`/`synced`/`client`, and the `#dev-modified`
checkbox), the form host `#dev-settings-form`, a `#dev-status` line, and the
actions `#dev-save` ("Save changes") and `#dev-export` ("Export as Mod").

### 7.3 The form block — `client/src/main.ts`

The registry-driven form lives in `client/src/main.ts` (dumped locally to
`docs/dev-form-block.txt`). It keeps a flat list of rows and re-builds itself from
the registry whenever a value changes. The core pieces:

| Identifier | Role |
|---|---|
| `DevGroup = 'synced' \| 'client'` | A row is either a synced match variable or a client-only presentation value. |
| `devRows` / `DevRowHandle` | Registered rows `{ row, group, search, isOverridden }`. |
| `devFilterGroup` / `devFilterText` / `devFilterModified` | Active filters (All/Synced/Client, text, "modified only"). |
| `applyDevFilters()` | Hides rows that fail the filters, then hides any `details.dev-group` section with no visible rows. |
| `setDevFilterGroup()` | Sets the tab and re-applies filters. |
| `appendDevSection()` / `appendDevItemHeader()` | Build visible `<details>` sections and per-entity sub-sections. |
| `makeTable()` | Builds the 5-column table head using `t('dev.colSetting')`, `dev.colValue`, `dev.colUnit`, `dev.colDefault`, `dev.colActions`. |
| `appendDevSubhead()` / `appendDevRow()` | Sub-heading rows and the generic 5-cell row; `appendDevRow` registers the row and toggles `dev-overridden`. |
| `makeNumberRow()` / `makeTextRow()` / `makeSelectRow()` | Number inputs (with `min`/`max`/`step` + reset), text inputs (client asset paths), and selects. |
| `makeAudioRow()` | Audio rows: path override (apply/clear + play) and per-sound `vol`/`pitch` tuning. |
| `buildOverrideInputs()` | Reuses `makeNumberRow` for the per-entity override maps. |
| `buildDevForm()` | Clears `devFormEl` and rebuilds every section from the registry; ends with `applyDevFilters()`. |
| `refreshDevForm()` | `buildDevForm()` + `renderActiveInfoTab()`. |

Grouping: match-variable sections are created with group `'synced'`; presentation
sections (building fill/offset, asset paths, unit scale/offset, field/obstacle/fx,
minimap, layer order, projectile fx, zoom, match cinematics, audio, profile
targets) are group `'client'` (the `makeTextRow` and most presentation rows are
hard-coded `'client'`).

### 7.4 Profile-target rows

If `PROFILE_TARGET_FIELDS` is non-empty, a final "profile" section lets you tune
achievement targets, persisted through `loadProfileConfig` /
`saveProfileConfig(window.localStorage)` and re-rendered via `renderProfilePanel()`.

---

## 8. Windows launcher — `run-game.bat` + `tools/`

`run-game.bat` is the zero-install Windows entry point. It is a self-checking
launcher, not a wrapper around `npm run dev`.

- **Arguments / env:** `SA_PORT` (default `17321`, arg 1), `SA_PASSPHRASE`
  (default `changeme`, arg 2), optional `SA_ROOM_CODE` (arg 3). `SA_REQUIRED_NODE`
  is `20`. Setting `SA_CHECK_ONLY` runs the checks and exits without starting.
- **Node self-healing:** prefers a system Node ≥ 20; falls back to a portable
  `lib\node\node.exe`; last resort silently installs a bundled `lib\*.msi`.
- **Checks:** Node, npm, dependencies (`node_modules`), Windows Firewall (adds an
  inbound rule for Node on Private networks when run as Administrator), port
  availability, source presence, disk space and folder writability.
- **Cleanup:** stops leftover `run-game.bat __bg_*` workers, leftover
  `host/dist/host.js` / loading-server node processes, and anything still
  listening on `SA_PORT`; auto-selects the next free port if needed.
- **Loading page:** starts `node tools/loading-server.mjs`, waits for its
  `tools/.loading-pid`, opens `http://localhost:%SA_PORT%/`, then stops it before
  hosting so the port is handed to the real host.
- **Build + run:** builds `shared`, `client`, `host` in a background worker
  (`__bg_build`) while an in-place progress bar animates, prints LAN URLs, and
  finally runs `node host/dist/host.js`. `__bg_deps` runs `npm install` if needed.

| Tool file | Role |
|---|---|
| `tools/loading-server.mjs` | Minimal `node:http` server that serves the loading page on `SA_PORT` and writes its PID to `tools/.loading-pid`. |
| `tools/loading-page.html` | The static "Starting…" page shown until the host is ready. |

---

## 9. Static checks & CI reality

| Check | Command | Config | Scope |
|---|---|---|---|
| Lint | `npm run lint` | `eslint.config.js` (flat config) | Ignores `**/dist/**`, `**/node_modules/**`, `scripts/**`, `tools/**`; `@typescript-eslint/no-unused-vars` is `error` (with `argsIgnorePattern: '^_'`), `no-explicit-any` is `warn`. |
| Format | `npm run format` | `.prettierrc` | `semi: false`, `singleQuote: true`, `trailingComma: "all"`, `printWidth: 100`, `tabWidth: 2`. |
| Typecheck | `npm run typecheck` | `tsconfig.base.json` (strict, `verbatimModuleSyntax`, `allowImportingTsExtensions`) + per-workspace `tsconfig.json` | `shared`, `client`, `host`. |

**CI:** the only GitHub Actions workflow is `.github/workflows/pages.yml`, which
deploys `online/public/` to GitHub Pages on pushes that touch it (and on
`workflow_dispatch`). There is **no** CI job that runs lint, typecheck or the test
suites — those are local gates today. Wiring them into CI is *Planned / not yet
implemented* (see [09 — Testing & QA](09-TESTING-AND-QA.md) §12).

---

## 10. Configuration reference

| File | Purpose |
|---|---|
| `vitest.config.ts` | Root Vitest config: `include: ['tests/**/*.test.ts']`, `environment: 'node'`, `@space-arenas/shared` alias to `shared/src/index.ts`. |
| `tsconfig.base.json` | Shared strict compiler options inherited by every workspace. |
| `eslint.config.js` | Flat ESLint config (`js.recommended` + `tseslint.configs.recommended`). |
| `.prettierrc` | Prettier formatting rules. |
| `.env.example` | Template for the online server (`SA_MODE`, `SA_PORT`, `SA_PASSPHRASE`, `SA_PUBLIC_URL`, `SUPABASE_*`) — real values live only in Render. |
| `render.yaml` | Render Blueprint for the `online/` service (`rootDir: online`, build/start commands, health check `/api/status`). |
| `run-game.bat` | Windows launcher (§8). |
| `client/dist/` | Committed browser assets (sprites, WAV sound, `manifest.json`, `CREDITS.md`) consumed by the client and validated/synthesized by §2–§4. |
