# 02 — Mechanics Specification

**Status:** Current — the authoritative ruleset for the shipped v1.0 game. Numbers below are the defaults from `shared/src/constants.ts` (`DEFAULT_MATCH_SETTINGS`) and `shared/src/balance/`; mods and match settings may override them.
**Companion docs:** `01-GAME-DESIGN-DOCUMENT.md` (vision/roles), `04-ARCHITECTURE.md` (how mechanics map to systems), `06-DATA-AND-SAVE-SYSTEM.md` (schema).

Balance values live in code. The *meaning* of every value is defined here. Where this document and a constant disagree, treat the constant as the source of truth and open a correction — the intent of this document is to describe the code, not to redesign it.

---

## 1. Simulation Model

- **Fixed timestep:** 25 ticks per second (`SIM_TICK_HZ = 25`, `SIM_TICK_MS = 40`). `SECONDS_TO_TICKS(s) = round(s × 25)`. Every mechanic below resolves in integer tick counts.
- **Coordinate space:** all positions are **fixed-point integers** with `FX = 1000` (`shared/src/fixed.ts`); 1 tile = 1000 fx. `tileToFx(t) = t × 1000`, `fxToTile(x) = floor(x / 1000)`. `isqrt`, `sqDist`, and `dist` are integer helpers — no floating-point in the sim.
- **Determinism:** every mechanic must resolve identically given identical inputs + seeded RNG. No `Math.random`, no wall-clock, no floats in serialized state. (One known sim-side use of `Math.cos`/`Math.sin` exists in `PlaneSystem.orbit` for air-unit orbiting; see §10.)
- **Budget:** each tick must fit within 40 ms wall time; the client catches up by at most 4 ticks after a stall rather than dropping sim steps.

---

## 2. Player Controls

### 2.1 Mouse

| Action | Effect |
|---|---|
| Left-click entity | Select single unit/building |
| Left-drag | Box-select friendly units (buildings excluded) |
| Left-click build-menu item | Enter placement or queue mode |
| Right-click terrain | Move command (queue with modifier) |
| Right-click enemy | Attack command |
| Right-click friendly | Guard / repair (if applicable) |
| Middle-drag / screen edge | Pan camera |
| Mouse wheel | Zoom camera (clamped) |
| Double-click unit | Select all same type on screen |

### 2.2 Command modes

The HUD exposes transient targeting modes that turn the next click into a specific command:

| Mode | Command emitted |
|---|---|
| Attack-move / Keep-attack / Guard toggles | `attack-move`, `keep-attack`, `guard` |
| Auto-fire toggle | `set-auto-fire` |
| Formation (tight / normal / loose / hold) | `set-formation` |
| Ability mode (grenade / smoke) | `grenade` / `smoke` on click |
| Mine mode (place / remove) | `place-mine` / `remove-mine` |
| Unload mode | `transport-unload` (whole transport or a single rider) |
| Spawn point / Flag point | `set-spawn-point` / `set-flag-point` |
| Satellite / Laser / Airstrike / EMP targeting | `satellite` / `laser` / `sw-airstrike` / `sw-emp` |
| Ping mode | `ping` with a `PingType` |

### 2.3 Control groups & selection

- Control groups persist per match, stored client-side only (cosmetic/UX, not synced).
- Box select selects only units; buildings are selected by individual click.
- Selection is bounded by `MAX_COMMAND_ENTITIES = 256` per command envelope.
- Idle-worker cycling and select-all (combat / harvesters / dozers) are bound to dedicated HUD controls.

### 2.4 Touch

On small viewports the HUD swaps to a mobile control cluster with the same command modes; pan/zoom use multi-touch gestures. Selection and command semantics are unchanged.

---

## 3. Fog of War & Vision

### 3.1 Fog modes (`fogMode`)

| Mode | Behavior |
|---|---|
| **memory** (default) | Live vision = 2 (revealed); tiles fade 2 → 1 (fog) when vision is lost and stay dim. |
| **classic** | Seen tiles stay at 2; no decay. |
| **hard** | Tiles fade 2 → 0 (shroud) instantly when vision is lost. |

Fog byte encoding: `0 = shroud`, `1 = fog`, `2 = revealed`.

### 3.2 Vision sources

A tile is written to `2` each tick by any of:
- A unit's or building's vision radius (buildings are always radius 8).
- A satellite marker while it is active.
- A super weapon effect: laser radius `ceil(level × laserRadius)`, EMP radius `ceil`, and airstrike reveal radius 6.

`VisionSystem` applies decay (mode-dependent) before/after source writes. Alliances merge fog per tile (max across allied teams).

### 3.3 Visibility predicate

`isVisibleTo(world, team, tx, ty)`:
- Own or allied entities are always visible.
- Satellite-active tiles are visible.
- Tiles at fog ≥ 2 are visible.
- Otherwise, entities inside `fogFadeDistance` (default 3 tiles) of the visible area are still shown, fading at the edge.
- Stealthed units are hidden unless `detectorNear` finds a detector building within `detectorRange` (12 tiles) of the unit, or the unit's `revealedUntil >= tick` (recently revealed).

---

## 4. Economy

### 4.1 Supplies (cash)

- **Deposit:** a Harvester in the `to-dock`/`idle` state banks `supplyPerTrip` (default 50) when it reaches its dock, plus a bonus `round(supplyPerTrip × supplyFieldBonus / 100)` when the field's `capturer === team`. The team also earns `SCORE_SUPPLY_PER_TRIP` (2) per successful docking.
- **Loading:** on arriving at a field the Harvester enters `loading` and spends `harvesterLoadTicks` (default 40 t = 1.6 s); the field's `trips` decrement on load completion.
- **Field choice:** `nearestField` picks the closest field with remaining `trips > 0`.
- **Arrival points:** `fieldArrivePoint` / `dockArrivePoint` choose the nearest passable approach tile with deterministic per-harvester spread to avoid stacking.
- **Treasury:** integer credits per team, starting at `startingCredits` (default 800).

### 4.2 Supply capture bonus

`SupplyCaptureSystem` tracks per-field presence:
- A Scout inside the field's radius accumulates `captureTicks`; at `supplyFieldClaimTicks` (default 20 s) the field's `capturer` becomes that team.
- Enemy presence accumulates `holdTicks`; at `supplyFieldHoldTicks` (default 10 s) the capturer is dropped.
- The bonus is `supplyFieldBonus`% (default 25) applied only to trips taken by the owning team. Fields are never exclusive.

### 4.3 Oil fields

`OilSystem`:
- An unowned oil field is claimed by a Scout inside its radius after `oilClaimTicks` (default 20 s).
- The owner banks `oilIncome` (default 50) every `oilIncomeIntervalTicks` (default 10 s).
- Oil fields are destructible (`oilFieldHp`, default 500); destroying one removes its income and reveals a collectable wreck.

### 4.4 Power

`PlacingSystem` recomputes the power net each tick:
- `available = Σ(done powerGen) − Σ(done powerUse)`, with the Command Center generating +10 and the Super Weapon consuming 100.
- On the net flipping from ≥0 to <0 the team receives a `power-down` event; on recovery, `power-restored`. While powered down, production queues do not advance and weaponized buildings do not fire.
- **Max Power** (`max-power` command): a healthy, finished Power Plant sets `maxPowerUntil = tick + maxPowerTicks` (default 30 s) and `maxPowerHpTarget = ceil(maxHp × 0.5)`. While active the plant's `powerGen` counts double and its HP drains toward the target; crossing back to 0 emits `power-boost` / `power-boost-ended`. Only one Max Power may be active per plant.
- **Defense Dome:** with the `defense-dome` research the Command Center gains a shield of `SHIELD_MAX_HP` (200), regenerating `SHIELD_REGEN_PER_TICK` (1) per tick and draining `SHIELD_POWER_DRAIN_PER_TICK` (1) power per tick while the base power net is negative or the Command Center is powered down; otherwise it decays.
- **Co-op:** `coopEconomy = power` (or `both`) sums power generation/consumption across alliance members before the net is computed.

### 4.5 Refunds & wrecks

- **Sell:** `sell` command refunds `sellRefundFraction` (default 0.5) of the building's cost, removed over `sellTicks` (default 3 s).
- **Wrecks:** destroyed buildings (and vehicle/naval units) drop a wreck worth `wreckValueFraction` (default 0.1) of their cost. A Bulldozer collects it by working on it for `wreckCollectTicks` (default 2 s).

---

## 5. Building & Placement

### 5.1 Placement validity (`input-system.placementValid`)

A `place` command is rejected unless **all** of the following hold:
1. The building's `countLimit` is not exceeded (Command Center and Super Weapon are each limited to 1).
2. The full footprint is inside map bounds.
3. The footprint's center tile is explored (fog ≥ 1), else `area unexplored`.
4. Every footprint tile is buildable, otherwise `blocked by existing building` or `cannot build on this terrain`.
5. For a `dock`, at least one edge-adjacent tile is open water, else `dock needs water access`.

### 5.2 Bulldozer orders

Construction is issued to a Bulldozer, not instant:
- The player must have a free Bulldozer with fewer than `maxBuildOrders` (default 3) active/queued orders, else `no available bulldozer` / `build order queue full`.
- `buildOrderQueues` auto-starts the next queued construction when the dozer becomes free (`startNextQueued`).
- Building beyond `EXPANSION_RADIUS_TILES` (18) of the team's spawn awards `SCORE_EXPANSION` (25).

### 5.3 Construction & repair (`WorkSystem`)

A Bulldozer builds/repairs a target:
- It works when it reaches a `workPad` (`workPadDistance`, default 1), touches the footprint, or is stuck (`workStuckTicks`, default 45 t).
- **Build:** `buildProgress += 1 / buildTimeTicks` per tick; at completion the building is functional and a `building-completed` event fires. A completed Supply Dock auto-queues one free Harvester.
- **Repair:** heals `(maxHp / buildTimeTicks) × (builderRepairPerTick / 40)` HP per tick, minimum 1 (`builderRepairPerTick` default 40).
- **Collect:** reaches a wreck within `speed × 2 + 400` fx and works `wreckCollectTicks` to bank its value.

### 5.4 Vision of buildings

Every spawned building gets vision radius 8 regardless of its definition; `spawnBuilding` marks the grid dirty, sets `buildProgress` (1 for pre-built, 0 for new), and creates a `TransportComp` if the building has a `transportCapacity`.

---

## 6. Movement & Pathfinding

### 6.1 Grid

`World.rebuildGridIfDirty()` derives from terrain, obstructions, and building footprints:
- `hardBlocked` — non-tree/rock obstructions, scenery rocks, supply/oil field squares, and building footprints.
- `passable` — terrain not Water/Cliff and not hard-blocked.
- `buildable` — terrain is Ground/BuildableGround and not hard-blocked.
- `water` — Water terrain and not hard-blocked.
- `component` / `waterComponent` — 4-neighbour flood-fill connectivity labels.

### 6.2 Movement (`MovementSystem`)

- Each unit moves along its path's waypoints, or directly toward the goal when no path exists.
- `displaceStuckUnits` relocates a unit standing on an impassable tile to the nearest passable tile within `stuckRelocateRadius` (12).
- **Separation:** units push each other apart using `sepVehicle` (1.9), `sepInfantry` (1.25), `buildingMarginVehicle` (0.5), `buildingMarginInfantry` (0.35), and `fieldMargin` (0.4); head-on encounters sidestep deterministically by `lateralSepDist` (0.1) with `samePosJitter` (0.12), capped at `sepMaxPush` (0.32).
- Positions are clamped to `[500, w × 1000 − 500]`.
- An `empStunned` unit's move order is discarded.

### 6.3 Pathfinding (`PathfindingSystem` / `findPath`)

- **A\*** with 8-directional movement; `astarCostStraight` (10) and `astarCostDiagonal` (14); diagonal corner-cutting is blocked. `pathMaxNodes` = 8000, and the system budget is `pathBudgetPerTick` (8) nodes per tick.
- **Direct march:** when the start and goal are on different `component`/`waterComponent` labels, `marchDirect` moves the unit toward the goal with no path, retrying up to `CAP_RETRY_TICKS` (20).
- **Line-of-sight shortcut:** `lineClear` allows direct movement when unobstructed.
- **Repath cooldowns:** `repathCooldownBlockedTicks` (15) when blocked, `repathCooldownFailTicks` (10) when a path fails.
- **Air units** skip pathfinding; **naval** units use the water mask/component.
- Standalone `findPath` (used by bots) budgets `max(8000, area)` nodes when `maxNodes` is omitted.

---

## 7. Combat

### 7.1 Weapons

See `shared/src/balance/weapons.ts` for the table (§7.3 of the GDD). All weapons are instant-hit; `projectile` only selects a cosmetic tracer (`bullet` / `rocket` / `shell`).

### 7.2 Targeting & firing (`CombatSystem`)

The system skips planes, `empStunned` units, unfinished buildings, and powered-down buildings.
- **Range:** `tileToFx(weapon.range) × veteranRange`.
- **Keep-attack leash:** a keep-attacking unit may chase to `chaseLeash` (default 2) × its range from its post; guard units hold their post within `guardArriveCells` (0.4) and never chase.
- **`pickTarget`** excludes: same-team entities, `empStunned` entities, invisible (stealthed) entities, and air entities when the weapon lacks `targetsAir`. It scores candidates with `targetBiasLastHit` (2e7) for the last attacker, `targetBiasFocusFire` (1e6) to focus shared targets, and `targetBiasLowHp` (1e4) to prefer weak targets, minus distance.
- **Firing:** when a target is in range and the weapon cooldown is 0, the weapon fires; cooldown resets to `cooldownTicks`. A garrisoned Bunker fires one volley per passenger; an empty bunker does not fire.
- **Miss chance:** shots fired through a smoke cloud roll against `smokeMissChance` (0.6).

### 7.3 Damage resolution (`applyDamage`)

- The Command Center's Defense Dome shield absorbs damage first (up to `shieldHp`).
- Veteran armor applies as a multiplier, floored so incoming damage is never reduced below `VETERAN_ARMOR_FLOOR` (0.5).
- `lastAttacker` is recorded (unless the attacker is the same team); a hit flash is queued.
- **Reflex counterattack:** if `autoFire !== false` and the victim has no current target, it acquires one.
- **Death:** the entity is removed; buildings and vehicle/naval units drop a wreck worth `wreckValueFraction` of their cost; the killing unit's veteran rank may advance; score is awarded.

### 7.4 Veterancy

- Ranks 1–5 at `veteranRankNKills` = 3 / 6 / 9 / 12 / 15 kills (`VETERAN_MAX_RANK = 5`).
- Per rank N (1-based): damage × (1 + N × 0.25), range × (1 + N × 0.1), armor reduction N × 0.2 (floored at 0.5).
- Only unit-vs-unit kills advance rank; rank never regresses.
- `weapon-upgrade` boosts only rank-5 veterans, up to `WEAPON_UPGRADE_MAX_LEVEL` (3) at +0.25 damage per level.

### 7.5 Crush

`CrushSystem`: a vehicle sharing a tile with an enemy infantry deals `crushDamage` (20) once per contact pair; the pair re-arms after separation (`crushPairs`). `ScenerySystem` separately damages a tree tile a vehicle stands on (`treeHp`, 40).

---

## 8. Abilities & Utility

### 8.1 Grenades & Smoke (`AbilitiesSystem`)

Both require the `abilities-tech` research and are available to combat infantry (`canThrowBandolier`: not air, not Bulldozer, not Engineer).

| Ability | Range | Radius | Effect | Fuse/duration | Cooldown |
|---|---|---|---|---|---|
| **Grenade** | 6 | 1.5 | 45 damage in blast | 1 s fuse | 2.5 s |
| **Smoke** | 6 | 2.25 (`smokeRadius`) | shots through it miss 60% | 12 s | 4 s |

Grenades carry a `explodeAt` tick and detonate then; smokes persist until `untilTick`. Ability cooldowns reset to 0 on expiry.

### 8.2 Mines (`MinesSystem`)

- Requires the `mine-tech` research; cost `mineCost` (50).
- A mine arms after `mineArmTicks` (default 1.5 s), then detonates on an enemy ground unit within `mineTriggerRadius` (1). Damage `mineDamage` (60) in `mineBlastRadius` (2). Air units are unaffected. Allies are hit only if `friendlyMineDamage` is enabled.
- Per-team limit `mineLimit` (30).
- An Engineer (or Bulldozer) places/removes mines within range; removal returns no cost.

### 8.3 Engineer repair & aura (`HealSystem`)

- `repair-unit`: the Engineer chases an ally and heals `engineerHealPerTick` (4) per tick within `engineerHealRange` (2).
- **Aura:** once a unit reaches `engineerHealRank` (3) veterancy, it passively heals nearby allies within `engineerHealAuraRadius` (2) at the same rate.
- Air units cannot be repaired; a target already at full health is rejected.

### 8.4 Transports (`TransportSystem`)

- Capacity `transportCapacityOf`: APC base 10 (+3 per `transport-capacity` research level), Bunker 5, Carrier 12.
- Only infantry may board. Riders queue and board one per tick within `BOARD_RANGE` (2400 fx); a loaded APC drives toward the farthest waiting rider.
- Unloading: a loaded APC drives within `UNLOAD_RANGE` (2800 fx) and drops one passenger per tick into `unloadSlots` spaced by `UNLOAD_SPACING` (800 fx); a Bunker is static and drops riders at `resolveUnloadPoint`. Click-to-eject a single rider uses `pendingOne`.
- Passengers are removed from the world while loaded and restored from a `PassengerRecord` snapshot on unload. They are lost if the transport dies.

---

## 9. Super Weapons

All three strikes share a 60 s cooldown and are rank-gated.

### 9.1 Space Laser (`LaserSystem`)

- Armed by researching `space-laser` (rank 3); sets `laser` and increments `laserLevel`.
- Fires a sustained beam for `laserDurationTicks` (4 s) dealing `laserDamagePerTick` (40) in a radius of `ceil(laserRadius × max(1, laserLevel))` (base 3).
- Wind-up before firing: `laserDelayTicksLv1` (1 s) at level 1, `laserDelayTicksLv2` (0.7 s) at level 2.
- If the Super Weapon is destroyed, the Command Center can fire one free opening shot (`laserFreeShotUsed`); otherwise a Command Center must be alive.
- Requires rank ≥ 1 to target; `laser` command rejects when on cooldown or out of bounds.

### 9.2 Airstrike (`AirstrikeSystem`)

- Armed by `airstrike-level` (rank 3); leveled up to `AIRSTRIKE_MAX_LEVEL` (2).
- `AIRSTRIKE_PLANES` (4) kamikaze planes spawn just off the top edge at speed `AIRSTRIKE_PLANE_SPEED` (500 fx/tick), staggered by `AIRSTRIKE_PLANE_STAGGER_TICKS` (0.3 s), and bomb the target with `airstrikeBombDamage` (50) in `airstrikeBombRadius` (3).
- Level scaling: damage ×(1 + 0.5·level), radius ×(1 + 0.15·level).
- En route the planes reveal a radius-6 area; on arrival each detonates via `explodeAt` and applies damage as an enemy-team hit (`applyDamage(..., -1, team)`).

### 9.3 EMP (`EmpSystem`)

- Armed by `emp-level` (rank 3); leveled up to `EMP_MAX_LEVEL` (2).
- Disables enemy units and buildings in `empRadiusTiles` (8) for `empDurationTicks` (5 s), pushing `empMax(empUntil, untilTick)` onto each target. Stunned entities skip movement, combat, work, and production.
- Level scaling: radius ×(1 + 0.15·level), duration ×(1 + 0.5·level).
- The purple pulse visual lasts `EMP_PULSE_TICKS`, equal to the disable duration.

### 9.4 Arming a second strike (`sw-choose`)

A `sw-choose` command requires: a Super Weapon building alive, rank ≥ 1, a `choice` other than the already-armed `laser`, and `swChoice === null`. Choosing arms the selected strike for the match.

---

## 10. Air & Naval Operations

### 10.1 Air units (`PlaneSystem`)

- Aircraft are produced by the Air Force (capacity 3) and receive a `PlaneComp` with orbit offsets (−900 / 0 / 900 fx) and `maxAmmo`.
- Planes return home to reload (`planeReloadRadius`, 4) after spending `maxAmmo`; reload takes `reloadTicks` (5 s).
- While engaging they orbit the target at `planeOrbitRadius` (1) and sorties within `tileToFx(max(range, vision) × planeSortieMult)` (default ×4).
- **Determinism caveat:** `orbit()` uses `Math.cos`/`Math.sin` for its circular path. This is the one place in the sim that uses floating-point trig; it is tolerated because all clients compute the same values in IEEE-754, but any move to a strictly integer sim must replace it.

### 10.2 Naval units

- The Dock produces the Carrier (transport) and Missile Boat (weapon). Naval units use the water mask/component for pathfinding and spawn on water.
- Missile Boats use `sea-missile` (60 damage, 40 t cooldown, 9 range, 1.5 splash).

---

## 11. Research & Upgrades

### 11.1 Gating

Research requires:
- A live, **finished** building of `availableAt`.
- Rank ≥ `requiredRank` (see the GDD §7.4 table).
- No existing identical research (already-researched rejections: radar, satellite, stealth tech, detector upgrade, mine tech, abilities tech, defense dome).
- A free research slot; the queue is capped at `queueLimit` (10), and only the head of the queue researches.

### 11.2 Completion effects (`PlacingSystem`)

On completion the team receives: score +`SCORE_RESEARCH` (15), an `upgrade-completed` event, and the relevant flag — `radar`, `satellite`, `laser` (with `laserLevel++`, `laserLastUsed = tick`), `stealthTech`, `detectorUnlocked`, `mineTech`, `abilitiesUnlocked`, `transportCapacityLevel++`, `defenseDome`, `weaponUpgradeLevel++` (capped at 3), `airstrikeLevel++` (capped at 2), or `empLevel++` (capped at 2).

### 11.3 Leveled costs (`input-system` `case 'research'`)

- **Space Laser:** `laser base × (level + 1)`.
- **Weapon Upgrade:** `weapon-upgrade base × (level + 1)`.
- **Airstrike / EMP:** `level × 1000 + base`.

Each leveled research also raises its maximum (`laserMaxLevel`, `AIRSTRIKE_MAX_LEVEL`, `EMP_MAX_LEVEL`, `WEAPON_UPGRADE_MAX_LEVEL`) and is gated by the corresponding star-rank requirement.

---

## 12. Score & General Rank

- `RANK_FLOORS = [500, 1500, 3500]` award ★1 / ★2 / ★3; `RANK_COUNT = MAX_RANK = 3`.
- Score sources: `SCORE_UNIT_KILL` (10), `SCORE_BUILDING_KILL` (30), `SCORE_SUPPLY_PER_TRIP` (2), `SCORE_RESEARCH` (15), `SCORE_EXPANSION` (25, for placing beyond `EXPANSION_RADIUS_TILES` = 18 from spawn).
- Promotion is automatic when a floor is crossed (`awardScore`); it can grant `rankUpPrizeCredits` (default 100).
- The explicit `rank-up` command is rejected if the score is below the next floor.

---

## 13. Win / Loss Conditions

- **Elimination (`winloss-system.ts` `isEliminated`):**
  - No units **and** no buildings → eliminated.
  - `annihilation` rule → never eliminated by Command Center loss alone.
  - `command-center` rule → eliminated if the Command Center is gone.
  - `standard` → eliminated if the Command Center is gone **and** there is no Bulldozer **and** `credits + refund < command-center cost`.
- **Match end:** when at most one alliance remains (`activeAlliances.size <= 1`), the winner is that alliance's lowest-ID alive team; if no team survives, the winner is `null` (draw).
- Elimination evaluation is bypassed when `world.gameOver !== null`, when there is at most one team, or when the match is `winless`.
- Forfeit (`forfeit` command) marks the sending team eliminated.

---

## 14. Tick Semantics & Timing

- All timers are integer tick counts; `world.tick` is the only clock the sim may read.
- Commands are stamped by the client with `Simulator.makeCommand` (tick = `world.tick`), and the host **re-stamps** net commands with the relay's current tick.
- `stepWorld` filters the command list to `c.tick === world.tick`, runs every system in order, then increments `world.tick`.

---

## 15. Command Protocol Reference

`SimCommand` fields (`shared/src/protocol.ts`): `type`, `entities`, `x`, `y`, and optionally `buildingType`, `unitType`, `target`, `index`, `to`, `upgrade`, `pingType`, `transportId`, `choice`, `autoFire`, `spreadCode`, `relative`. `EnvelopeCommand` wraps it with `{ player, seq, tick, cmd }`.

### 15.1 Command types (`CMD_TYPE_IDS`)

| Command | ID | Purpose | Key rejection reasons (`input-system`) |
|---|---|---|---|
| `move` | 0 | Move to point | `spawn point out of bounds`, `spawn point blocked`, `flag point out of bounds` |
| `attack-move` | 1 | Move, engaging en route | `N star rank required` |
| `stop` | 2 | Halt | — |
| `place` | 3 | Place a building | `count limit reached`, `area unexplored`, `out of bounds`, `blocked by existing building`, `cannot build on this terrain`, `dock needs water access`, `no available bulldozer`, `build order queue full`, `insufficient credits` |
| `sell` | 4 | Sell a building | `building not finished`, `wrong building` |
| `queue` | 5 | Queue production | `wrong producer`, `air force full`, `queue full (max N)`, `insufficient credits`, `building not finished` |
| `dequeue` | 6 | Cancel queued item | — |
| `attack` | 7 | Attack a target | `target out of range`, `unit cannot attack that target`, `target is stealthed` |
| `research` | 8 | Queue research | `unknown upgrade`, `wrong building`, `N star rank required`, `<upgrade> already researched`, `research queue full`, `laser maxed`, `airstrike maxed`, `emp maxed`, `weapon upgrade maxed`, `insufficient credits` |
| `build` | 9 | Order a Bulldozer to build | `no available bulldozer`, `build order queue full`, `insufficient credits` |
| `set-spawn-point` | 10 | Rally point | `spawn point out of bounds`, `spawn point blocked` |
| `assign-dock` | 11 | Assign Harvester dock | `wrong building` |
| `satellite` | 12 | Reveal via satellite | `satellite not researched`, `tech center destroyed`, `satellite on cooldown`, `satellite target out of bounds` |
| `laser` | 13 | Fire Space Laser | `space laser not researched`, `space laser on cooldown`, `insufficient power`, `laser target out of bounds`, `space laser offline — rebuild the super weapon`, `command center destroyed`, `super weapon destroyed` |
| `sw-choose` | 32 | Arm a second strike | `invalid strike choice`, `laser is armed by default`, `N star rank required — reach 1★ to pick a second super weapon`, `super weapon already armed` |
| `sw-airstrike` | 33 | Call Airstrike | `airstrike not armed — choose it at the super weapon first`, `airstrike on cooldown`, `airstrike target out of bounds` |
| `sw-emp` | 34 | Call EMP | `emp not armed — choose it at the super weapon first`, `emp on cooldown`, `emp target out of bounds` |
| `set-flag-point` | 14 | Set a flag point | `flag point out of bounds` |
| `forfeit` | 15 | Surrender | — |
| `keep-attack` | 16 | Hold-and-pursue-attack | `N star rank required` |
| `guard` | 17 | Guard a post | — |
| `max-power` | 18 | Overdrive a plant | `max power already active`, `requires full health`, `wrong building`, `building not finished` |
| `collect` | 19 | Collect a wreck | `bulldozer is busy` |
| `ping` | 20 | Map ping | `ping out of bounds` |
| `reorder-queue` | 21 | Reorder queue | — |
| `grenade` | 22 | Throw a grenade | `abilities tech not researched`, `unit cannot use ability`, `ability on cooldown`, `target out of throw range` |
| `smoke` | 23 | Lay smoke | same as grenade |
| `set-detector` | 24 | Mount a detector | `detector upgrade not researched`, `building already has a detector` |
| `set-stealth` | 25 | Toggle stealth | `cannot stealth this unit`, `stealth upgrade not researched`, `unit already stealthed`, `insufficient credits` |
| `place-mine` | 26 | Place a mine | `mine tech not researched`, `no engineer selected`, `mine out of range`, `mine limit reached`, `mine out of bounds`, `cannot place mine there`, `insufficient credits` |
| `remove-mine` | 27 | Remove a mine | `no mine there`, `no engineer selected`, `mine out of range` |
| `repair-unit` | 28 | Engineer repairs | `no available engineer`, `cannot repair air units`, `target already at full health` |
| `dequeue-research` | 29 | Cancel research | — |
| `transport-load` | 30 | Load a transport | `no transport selected`, `unit cannot carry passengers`, `only infantry can be transported`, `transport is full` |
| `transport-unload` | 31 | Unload a transport | `no transport selected`, `transport is empty` |
| `rank-up` | 35 | Manual rank-up | `score below next rank floor` |
| `set-auto-fire` | 36 | Toggle auto-fire | `unit cannot auto-fire` |
| `set-formation` | 37 | Formation mode | `cannot formation air units` |

### 15.2 Ping types

`PingType = alert | assist | on-my-way` (`PING_TYPE_IDS` 0/1/2). Pings are cosmetic (`PING_TICKS = 125`) and do not affect simulation state.

### 15.3 Envelope validation

`validateCommandBytes` gates every inbound command: length 16…8192 bytes; known command type; `entities` ≤ `MAX_COMMAND_ENTITIES` (256); strings ≤ `MAX_COMMAND_STRING_BYTES` (64); coordinates within `[COORD_MIN, COORD_MAX]` (±100000); player-id must match; no trailing bytes. Binary transport kinds (`BIN`): `CMD` 1, `FRAME` 2, `CHECKSUM` 3, `RELAY_CHECKSUM` 4.

---

## 16. Multiplayer Mechanics

### 16.1 Lobby

1. **Host** starts a room → generates a room code and an optional passphrase.
2. **Join** by entering the address, room code, and passphrase; the passphrase is hashed with PBKDF2-SHA256 (100 000 iterations, salt `space-arenas:<roomCode>`) before transmit.
3. **Slots** 2–8 with host-assigned teams, spawns, and colors; bot slots (`easy` / `medium` / `hard`) can be added/edited/removed.
4. **Map / mod / settings** are chosen by the host; a balance mod is distributed by hash and must be acknowledged (`C_MOD_ACK`) by every guest before start.
5. **Start** sends `S_MATCH_START` carrying the protocol version, seed, tick rate, map, players, and settings; each client builds an identical world from the same seed.

### 16.2 Security model (LAN-trusted)

- The passphrase prevents accidental/wrong-room joins; it is **not** a hostile-actor security boundary.
- Commands are validated server-side (`validateCommandBytes`) and re-stamped; the relay sorts by `(player, seq)` and never simulates gameplay.
- Periodic CRC32 checksums (every 60 ticks via `SyncSystem`) are broadcast; a mismatch is a desync and halts the match with diagnostics.
- `PROTOCOL_VERSION = 0x5c ^ 0x4a` (=22); `MIN_PROTOCOL_VERSION = PROTOCOL_VERSION − 2` (=20). Version mismatches are rejected server-side.
- **Dev settings guard:** a non-spectator changing synced settings mid-match triggers `H_SETTINGS_ALERT`; the host answers with a kick or skip verdict (`C_SETTINGS_VERDICT`).

### 16.3 Disconnects & spectators

- LAN: no host migration and no mid-match rejoin. The online service has a reconnect grace window at the lobby/relay layer.
- Spectators (`localTeam < 0`) receive `S_SPECTATE_SYNC` with the full command log and current tick, then rebuild the world deterministically.
- Game-over reports (`C_GAME_OVER`) carry final per-team scores for the leaderboard.

---

## 17. Match Settings Reference

`MatchSettings` (`shared/src/constants.ts`) exposes every tunable above, merged over `DEFAULT_MATCH_SETTINGS` via `mergeMatchSettings`. Notable groups:

| Group | Fields (defaults) |
|---|---|
| **Economy** | `startingCredits` 800, `supplyPerTrip` 50, `harvesterLoadTicks` 40, `oilIncome` 50, `oilIncomeIntervalTicks` 250, `oilClaimTicks` 500, `supplyFieldBonus` 25, `supplyFieldClaimTicks` 500, `supplyFieldHoldTicks` 250 |
| **Power** | `maxPowerTicks` 750, `rankUpPrizeCredits` 100 |
| **Fog / vision** | `fogMode` memory, `fogFadeDistance` 3, `dayNight` false, `dayNightCycleTicks` 7750, `dayNightTransitionTicks` 1500 |
| **Satellite** | `satelliteRevealTicks` 150, `satelliteCooldownTicks` 750 |
| **Super weapons** | `laserCooldownTicks` 1500, `laserRadius` 3, `laserDurationTicks` 100, `laserDamagePerTick` 40, `laserMaxLevel` 2, `laserDelayTicksLv1` 25, `laserDelayTicksLv2` 18, `airstrikeCooldownTicks` 1500, `empCooldownTicks` 1500, `airstrikeBombDamage` 50, `airstrikeBombRadius` 3, `empRadiusTiles` 8, `empDurationTicks` 125 |
| **Combat** | `crushDamage` 20, `chaseLeash` 2, `guardArriveCells` 0.4, `targetBiasLastHit` 2e7, `targetBiasFocusFire` 1e6, `targetBiasLowHp` 1e4, `defaultSplash` 0.4, `samePosJitter` 0.12, `lateralSepDist` 0.1 |
| **Abilities** | `grenadeRange` 6, `grenadeBlastRadius` 1.5, `grenadeDamage` 45, `grenadeFuseTicks` 25, `grenadeCooldownTicks` 63, `smokeRange` 6, `smokeRadius` 2.25, `smokeDurationTicks` 300, `smokeMissChance` 0.6, `smokeCooldownTicks` 100 |
| **Stealth / detection** | `detectorCost` 200, `detectorRange` 12, `stealthCost` 200, `stealthRevealTicks` 75 |
| **Mines** | `mineCost` 50, `minePlaceRange` 4, `mineTriggerRadius` 1, `mineBlastRadius` 2, `mineDamage` 60, `mineArmTicks` 38, `mineLimit` 30, `friendlyMineDamage` false |
| **Engineer** | `engineerHealPerTick` 4, `engineerHealRange` 2, `engineerHealAuraRadius` 2, `engineerHealRank` 3 |
| **Movement / path** | `sepVehicle` 1.9, `sepInfantry` 1.25, `sepMaxPush` 0.32, `buildingMarginVehicle` 0.5, `buildingMarginInfantry` 0.35, `fieldMargin` 0.4, `stuckRelocateRadius` 12, `repathCooldownBlockedTicks` 15, `repathCooldownFailTicks` 10, `astarCostStraight` 10, `astarCostDiagonal` 14, `pathBudgetPerTick` 8, `pathMaxNodes` 8000 |
| **Air** | `planeOrbitRadius` 1, `planeReloadRadius` 4, `planeSortieMult` 4 |
| **Veterancy** | `veteranRank1..5Kills` 3/6/9/12/15, `veteranDamagePerRank` 0.25, `veteranRangePerRank` 0.1, `veteranArmorPerRank` 0.2 |
| **Construction** | `builderRepairPerTick` 40, `workPadDistance` 1, `workStuckTicks` 45, `maxBuildOrders` 3, `queueLimit` 10, `sellRefundFraction` 0.5, `sellTicks` 75, `wreckValueFraction` 0.1, `wreckCollectTicks` 50, `spawnRange` 2 |
| **Fields / scenery** | `oilFieldHp` 500, `treeHp` 40, `rockHp` 220, `supplyFieldCapacity` 0 (auto), `supplyFieldRadius` 0 (auto), `oilFieldRadius` 0 (auto) |
| **Co-op** | `coopEconomy` none, `coopRank` none, `coopControl` none |
| **Overrides** | `buildingOverrides`, `unitOverrides`, `weaponOverrides`, `upgradeOverrides` — per-ID patches used by mods |

**Win rule:** `WIN_RULES = ['standard', 'annihilation', 'command-center']`, default `standard`.
