# 10 — JSON Balance Mods: Design Report (Day 20, Feature 20.3 / #37a)

**Status: REPORT ONLY — no implementation in this milestone.** This document scopes,
designs and risks a "JSON balance overrides" feature so it can be handed off cleanly.

> Day 20 was re-scoped to the bulldozer multi-build-order queue. Mod support (the
> original Day 20 feature 3) was explicitly deferred and is documented here instead.

---

## 1. What is being asked

> **#37a** — JSON balance mods: lobby toggle to load `balance.json` overrides at
> game start. `match.ts`: if `modPath` is set, `fetch(modPath)` then deep-merge into
> `buildings.ts` / `units.ts` / `weapons.ts` defaults. Lobby: file input or URL field
> for the mod JSON.

The future-facing version (**N7c**) is an *online mod repository* with download,
rating and versioning — out of scope here. This report covers only the offline/URL
"load a JSON file into a match" mechanism.

---

## 2. What the codebase already has (this feature is unusually cheap)

The simulation never reads balance tables directly. Every gameplay lookup already runs
through override-aware accessors in `shared/src/balance/*`:

| Accessor | File | Merge |
|---|---|---|
| `getBuilding(id, s)` | `balance/buildings.ts:147` | `{ ...def, ...(s?.buildingOverrides?.[id] ?? {}) }` |
| `getUnit(id, s)` | `balance/units.ts:173` | same pattern |
| `getWeapon(id, s)` | `balance/weapons.ts:23` | same pattern |
| `getUpgrade(id, s)` | `balance/upgrades.ts:116` | same pattern |

The override records are typed on `MatchSettings` (`shared/src/constants.ts:188-217`):

```ts
export interface BuildingOverrides { cost?; buildTimeTicks?; hp?; powerGen?; powerUse? }
export interface UnitOverrides     { cost?; buildTimeTicks?; hp?; vision?; speed?; capacity?; maxAmmo?; reloadTicks? }
export interface WeaponOverrides   { damage?; cooldownTicks?; range?; splash? }
export interface UpgradeOverrides  { cost?; researchTimeTicks? }
```

and mounted on `MatchSettings` as `buildingOverrides / unitOverrides / weaponOverrides /
upgradeOverrides: Record<string, …>`.

The *client dev-settings panel already edits the exact same shape*:
`main.ts:691-720` (`OVERRIDE_BUILDING_FIELDS`, `OVERRIDE_UNIT_FIELDS`,
`OVERRIDE_WEAPON_FIELDS`, `OVERRIDE_UPGRADE_FIELDS`) drive `MatchSettings.buildingOverrides`
etc. So a mod JSON is, at minimum, **one of these `Record<string, T>` maps**. Because
`sanitizeSettings` (`host/src/rooms.ts`) whitelists `MatchSettings` keys and the host
ships these maps to every client, the transport and determinism plumbing already exist.

### Key consequence

A "deep merge into buildings.ts defaults" is NOT needed and would actually be wrong.
The accessor pattern means a mod file only has to carry *deltas* keyed by entity id —
the same delta shape dev-settings already produces. This keeps every `sanitize` path,
type check, and hash path intact at zero cost.

---

## 3. Scope decision

**Supported (v1):**

1. **Scalar match-setting overrides** — anything in the `SANITIZE` whitelist
   (`host/src/rooms.ts`) plus the four override records.
2. **Per-entity balance deltas** — `buildingOverrides`, `unitOverrides`,
   `weaponOverrides`, `upgradeOverrides`, each `{ "id": { field: value, … } }`.
3. **Single source per match** — one JSON file/URL; no mod stacking in v1.
4. **All game modes** — offline, LAN-with-host, and bot matches. Because overrides flow
   through `MatchSettings`, they work anywhere settings work.

**Not supported (v1):**

- New entity/buildable/weapon *types* (needs build-tree + HUD + protocol work).
- Changing sim *logic* (move costs, A* heuristics, AI behavior).
- Maps, scenarios, waves, scripts (this is balance-only; see `future_todo.md`).
- Mod-to-mod dependencies, versioning, online repository (N7c).

---

## 4. Proposed schema (`space-arenas-mod.json`)

```jsonc
{
  "meta": {
    "name": "Marathon Buildings",
    "version": "1.0.0",
    "author": "SDev-Rami",
    "description": "Buildings are 2x pricier but 2x tougher.",
    "requireProtocol": 12           // PROTOCOL_VERSION guard
  },
  "settings": {                     // mergeMatchSettings() target (SANITIZE-able)
    "sellRefundFraction": 0.4,
    "maxBuildOrders": 4             // new Day 20 dev setting, already SANITIZE'd
  },
  "buildingOverrides": {
    "power-plant":   { "cost": 400, "hp": 1600 },
    "command-center":{ "hp": 4000 }
  },
  "unitOverrides": {
    "rifleman":      { "cost": 120, "hp": 80 }
  },
  "weaponOverrides": {
    "turret-gun":    { "range": 12, "splash": 1.5 }
  },
  "upgradeOverrides": {
    "weapon-upgrade":{ "cost": 800 }
  }
}
```

Design decisions baked into the schema:

- **Deltas only, no wholesale redefinition.** Mirrors the dev-settings override shape
  exactly; unknown keys are rejected by the sanitizer, not silently merged.
- **`meta` is informational** except `requireProtocol`, which is validated up-front and
  blocks the match with a clear toast if the running build is too old.
- **`settings` is validated through the existing `SANITIZE` map.** Anything not in the
  whitelist is dropped (the host already clamps/normalizes), so a malicious file cannot
  smuggle arbitrary numbers into the sim. `mergeMatchSettings` handles that arrays/objects
  (the four override records) survive the merge the way they already do today.

---

## 5. Transport & lifecycle

### 5.1 Loading

- **Offline:** lobby *Load mod* file input → parse + validate → attach to the
  `MatchConfig` used by `startOffline` → passed to `new Simulator(...)` as part of
  `Partial<MatchSettings>`. A tiny preview pane shows parsed totals (n buildings
  overridden, n settings changed) and a red banner on validation failure.
- **LAN:** host-only. The lobby *Load mod* file input on the host's side replaces the
  old pattern; the mod object is folded into the room's `MatchSettings` **at room
  creation**, exactly like other host-only toggles (`#match-fog`, `#match-daynight`).
  Clients receive the overridden settings in the existing settings handshake — **the
  mod file itself is never transmitted**, only the sanitized settings, keeping payload
  and attack surface identical to today.
- **URL:** a `modPath` field (`fetch(modPath)`) is equivalent to the file input after
  fetch. Same validation, same rules. Useful for LAN "share this link" workflows, but
  the file-picker path is the primary UX.

### 5.2 Where it plugs in

| Site | Change |
|---|---|
| `shared/src/balance/{buildings,units,weapons,upgrades}.ts` | **None.** Accessor merge already does the work. |
| `shared/src/constants.ts` | **None** (types exist). Possibly a `ModMeta` type + a `isValidMod` guard export. |
| `host/src/rooms.ts` | **None** — `SANITIZE` already whitelists the four override maps (verify `Record` keys survive; if not, normalize to `{}`-safe). |
| `match.ts` / `Game.startOffline` | Feed `settings` from the mod into the existing settings construction. This is the only required wiring. |
| Lobby HTML/JS (`main.ts`) | File input + URL field + preview + validation toast; host-only in LAN. |

---

## 6. Determinism & fairness

- **Deterministic by construction:** overrides live inside `MatchSettings`, which the
  world hashes every tick (`world.lastHash`, `onSyncTick`). Changing a balance value is
  no different from changing `oilIncome` today — identical inputs still produce
  identical state. **No `hash.ts` change.**
- **Lockstep-safe:** the host ships the final sanitized settings; every client starts
  from them. There is no per-client divergence window.
- **Discrepancy risk is limited to the known one:** if a client loads a *different*
  mod than the host, checksums desync — the host's settings are authoritative, the same
  mechanism that already catches a tampered `sanitizeSettings`.
- **Fairness:** balance mods are an all-teams affair (applied to shared defaults, not
  per-player). A v1 rule: one mod per room, applied uniformly, recorded in the replay's
  `cfg.settings` so replays remain deterministic against the original mod.

---

## 7. Security considerations

1. **Never `eval`, `JSON.parse` only.** The file must be strict JSON.
2. **Whitelist, don't deep-merge free-form.** `settings` keys go through `SANITIZE`
   (clamping prevents e.g. `cost: -1e9`). The four override records accept only the
   typed fields; unknown fields are dropped. Consider importing the existing dev
   `OverrideFieldDef` bounds (`main.ts:691-720`) as the shared clamp table so file mods
   and dev-panel mods use identical limits.
3. **Protocol guard:** `meta.requireProtocol !== PROTOCOL_VERSION` → refuse the file
   at load (never mid-match).
4. **LAN threat model is unchanged** (see `docs/04-ARCHITECTURE.md` § trust): the host
   is already trusted to set every `MatchSettings` value; shipping a mod is no new
   privilege. Remote `modPath` fetching keeps `fetch` to explicit user-provided URLs only.
5. **Replay integrity:** persist the applied (sanitized) settings, not the raw file, so
   a later replay doesn't need network access to the mod source.

---

## 8. UI plan (lobby only, no in-match)

- **Lobby row "Balance mod"** under the existing match options: `[Load JSON]` + optional
  `[or paste URL]`, plus a *Clear mod* button.
- Preview line once loaded: `"power-plant (4 fields), rifleman (2), settings (3)"`.
- On validation failure: toast `mod.invalid` (en/ar), keep the previous mod.
- Dev-settings panel keeps its own overrides untouched; the last-applied source wins
  (a deliberate "dev overrides or mod file, not both" rule to avoid surprise).

New i18n keys (en + ar parity required): `mod.invalid`, `mod.protocolMismatch`,
`mod.preview`, `mod.spinner` etc.

---

## 9. Tests to add (when implemented)

- `shared`: `isValidMod` — accepts a good file, rejects unknown fields, clamps numbers,
  enforces protocol version.
- `host`: `sanitizeSettings` preserves the four override records verbatim; drops
  non-whitelisted settings keys.
- `sim`: two simulators with the same mod settings stay in lockstep (reuse the
  determinism harness); a building with modded `cost` prices correctly (afford/spend).
- `bot`: a modded economy (cheap supply dock) is used by the bot without throwing.
- `replay`: replay hash stays stable against the same mod; a different mod diverges the
  checksum.

---

## 10. Effort & risk

| Item | Effort | Risk |
|---|---|---|
| Schema + `isValidMod` guard | S | Low |
| Lobby file/URL input + preview | S–M | Low |
| `match.ts`/`Game.startOffline` wiring | S | Low |
| Host room plumbing (settings already ship) | S | Low |
| i18n + tests | M | Low |
| **Total** | **~1–1.5 dev days** | **Low; no sim-logic changes** |

**Recommendation:** implement behind the existing override plumbing (accessors + SANITIZE)
as a *v1 balance-only* feature; never attempt deep-merge of whole def tables. Keep online
repository (N7c) and scripting (custom scenarios) out of scope.

---

## 11. Handoff notes / deferred

- Original Day 20 feature 3 robbed of its slot by the re-scope to the build-order queue;
  this file is that feature's contract.
- `new_todo.md` Day 20 table and the Summary row should be updated to reflect:
  "Day 20 = build-order queue ✅; JSON mods documented, deferred to a future day (report:
  `docs/10-MOD-SUPPORT-REPORT.md`)".