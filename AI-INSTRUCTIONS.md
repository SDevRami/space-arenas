# AI-INSTRUCTIONS.md

Instructions for AI assistants and human contributors working inside this repository. Read this file **before** writing or modifying any code.

This project is a browser RTS in active documentation phase. The nine documents in `docs/` are the authoritative specification. If code and docs disagree, **the docs win** — update the code, and if the docs were wrong, update the docs in the same commit.

---

## 1. Golden Rules

1. **Determinism is law.** The simulation must produce byte-identical outcomes on every client. Any code touching simulation state must never read the clock, `Math.random()`, `Date.now()`, or any platform-specific value. Use the seeded RNG from `shared/rng.ts` and the fixed timestep only.
2. **No magic numbers in simulation code.** All balance values live in `shared/balance/` as typed data. Gameplay tuning edits data files, never system code.
3. **The wire protocol is versioned.** Never change an existing message type. Add new message types with a new version; bump `PROTOCOL_VERSION` in `shared/protocol.ts`.
4. **Render code never mutates simulation state.** Renderers are pure readers + draw calls. If you need a game state change from render code, emit an event into the input queue.
5. **Performance budget is tracked per PR.** Any change that increases per-tick allocations in the hot path needs a justification. See `docs/04-ARCHITECTURE.md § GC & Memory`.
6. **Do not add comments unless they explain a non-obvious WHY.** Code should be self-explanatory; comments must justify decisions, not restate the code.
7. **Never commit secrets.** The LAN passphrase is player-provided at runtime and never stored. No API keys, tokens, or passwords in the repo — ever.

---

## 2. Architecture Conventions

### ECS-lite (see `docs/04-ARCHITECTURE.md`)

- **Components** are plain data objects (no methods). Serializable to/from the lockstep snapshot format.
- **Systems** are pure functions or classes with an `update(ctx)` method. They must be order-independent enough to run in a fixed pipeline order; register their order in `SystemsRegistry`.
- **Entities** are integer IDs, not objects. An entity ID maps into sparse component arrays for cache locality.
- New gameplay feature flow:
  1. Add components + a system in `client/src/systems/`.
  2. Register the system order in `client/src/core/SystemsRegistry.ts`.
  3. Add static balance data in `shared/balance/`.
  4. Add factory functions in `client/src/entities/` (buildings/units) or `client/src/systems/Spawning.ts`.
  5. Add wire messages only if cross-player state is involved.

### Code style

- TypeScript, strict mode (`strict: true`), no `any` in simulation code (see `client/tsconfig.json`).
- Functional style preferred; classes allowed for long-lived singletons (Game, Renderer, NetClient).
- File naming: `kebab-case.ts`. System files are PascalCase classes in kebab-case files (`movement-system.ts` exporting `MovementSystem`).
- No code comments for obvious logic. Type names carry meaning.

### Testing

- Unit tests target pure logic: RNG, pathfinding, combat resolution, protocol codec, map parsing. Run with `npm test`.
- **Determinism tests** are mandatory for any simulation change: run the same command stream twice, assert identical state hash.
- Desync is a release-blocking bug. See `docs/09-TESTING-AND-QA.md`.

---

## 3. Common Tasks

### "Add a new unit"

1. Read `docs/02-MECHANICS-SPECIFICATION.md § Units` for the stat schema.
2. Add the unit entry to `shared/balance/units.ts` (stats, build cost, build time, weapon, vision, movement).
3. Add a factory in `client/src/entities/units.ts` (which components + initial values).
4. If the unit needs a new behavior, add/extend a system under `client/src/systems/`.
5. If the unit fires a weapon, check `shared/balance/weapons.ts`.
6. Add it to the map builder's unit palette (`mapbuilder/src/placement.ts`).
7. Update the docs if the unit introduces a new mechanic.

### "Add a new building"

Same flow as units, but:
- Must define a footprint (`sizeX × sizeY` tiles) in `shared/balance/buildings.ts`.
- If it produces units, it needs a `ProductionQueue` component and the `ProductionSystem`.
- If it consumes/generates power, update `PowerSystem` data.
- Placement validation lives in `client/src/systems/Placing.ts` — add footprint + terrain rules there.

### "Change a balance number"

Edit the data file in `shared/balance/`. Do **not** touch system code. Run determinism tests.

### "Add or change a match-settings (dev/design) variable"

Match settings are the live-tunable gameplay variables defined in `shared/src/constants.ts` (`MatchSettings` + `DEFAULT_MATCH_SETTINGS`). Whenever you add, rename, or change one, you must keep three places in sync — this is a hard rule, not optional:

1. **Simulation source** — `shared/src/constants.ts` (interface field + sensible default) and any consumer in `client/src/systems/` (remember the units convention: spatial distances stored in **cells**, converted to fx with `* 1000` where compared against fx positions).
2. **Dev/design settings form** — `client/src/main.ts` in the `DEV_SCALAR_SECTIONS` array (right section, sensible `unit`/`min`/`max`/`step`). Without an entry here it never appears in the in-game dev-settings editor.
3. **i18n labels** — `client/src/i18n/lang/en.json` and `ar.json` under `dev.fields.<key>.label` / `.desc`.

If the variable affects how a command behaves, also update the **game info** (the Controls "Combat orders" list in `game-info-catalog.ts` + `info.controls.*` strings in `en.json`/`ar.json`), and mention it in the PR description.

Run `npm run typecheck` and `npm test` after any settings change.

### "Change a rendering thing"

Renderers live in `client/src/render/`. They read simulation state only. Follow `docs/05-ASSET-PIPELINE.md` when adding visual assets.

### "Add a network message"

1. Add the message to `shared/protocol.ts` following the existing tagged-union pattern.
2. Implement encode/decode in `shared/protocol.ts` (shared, so host and client stay in sync).
3. Handle it in `host/src/relay.ts` (validation + relay) and `client/src/net/` (application).
4. Bump `PROTOCOL_VERSION` if the message changes an existing behavior.
5. Add a round-trip test in `tests/protocol.test.ts`.

---

## 4. Do / Don't

| Do | Don't |
|---|---|
| Use the seeded RNG (`shared/rng.ts`) | Use `Math.random()` anywhere in `client/src/core`, `client/src/systems`, `shared/`, or `host/src` |
| Read the sim clock from `GameState.tick` | Use `performance.now()` inside systems |
| Serialize floats via the canonical codec | Send raw JS numbers with locale-dependent formatting |
| Add systems to the registry with explicit order | Call one system from inside another |
| Reuse pooled objects in hot loops | Allocate per entity per tick in render or combat |
| Test determinism on every sim change | Ship a change that skipped `npm test` |
| Update `docs/` when design changes | Edit docs after the fact without checking code |

---

## 5. Where Things Live (Quick Map)

| Concern | Path |
|---|---|
| Game loop & tick pipeline | `client/src/core/` |
| ECS primitives | `client/src/ecs/` |
| Gameplay systems | `client/src/systems/` |
| Unit/building factories | `client/src/entities/` |
| Lockstep networking client | `client/src/net/` |
| PixiJS rendering & camera | `client/src/render/` |
| Input & command mapping | `client/src/input/` |
| HUD / minimap / menus | `client/src/ui/` |
| Audio placeholders | `client/src/audio/` |
| Map format & parsing | `shared/maps.ts`, `client/src/maps/` |
| Balance data | `shared/balance/` |
| Wire protocol (shared) | `shared/protocol.ts` |
| LAN host server | `host/src/` |
| Map builder | `mapbuilder/src/` |

---

## 6. Definition of Done

A change is done when:

- [ ] Implements the behavior specified in `docs/` (or updates docs to match, with justification).
- [ ] TypeScript compiles under strict mode.
- [ ] All tests pass, including determinism tests (`npm test`).
- [ ] No new per-tick allocations in hot systems without a documented reason.
- [ ] Any new network message is versioned correctly and round-trip tested.
- [ ] Follows the code style and Do/Don't table above.
- [ ] Any changed match-settings variable is registered in the dev/design settings form (`client/src/main.ts`) **and** has i18n labels (`en.json` / `ar.json`); behavioral changes are reflected in the game info (see "Add or change a match-settings variable").
