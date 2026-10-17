# 15 — Content and Progression

**Status:** Implemented (single-player skirmish content and local progression). Every building, unit, weapon and upgrade below exists in code; the roster is data-driven from `shared/src/balance/`. There is no campaign, no unlockable content and no meta-shop — progression is in-match rank stars, veterancy, the daily-challenge level and the cumulative profile.

## 1. Where Content Lives

- Static balance data (rosters, stats): `shared/src/balance/buildings.ts`, `units.ts`, `upgrades.ts`, `weapons.ts`.
- Tunable constants and match defaults: `shared/src/constants.ts` (`DEFAULT_MATCH_SETTINGS`).
- Runtime stat overrides per match (host lobby "balance tweaks"): `MatchSettings.buildingOverrides` / `unitOverrides` / `upgradeOverrides` / `weaponOverrides`, applied by the `getBuilding` / `getUnit` / `getUpgrade` / `getWeapon` accessors (each merges the override over the static def).
- In-match progression state (score, rank, laser/airstrike/EMP levels, veterancy): `client/src/core/world.ts`.
- Out-of-match progression (profile, achievements, daily level): `client/src/profile/`.

## 2. Buildings (`BUILDINGS` in `shared/src/balance/buildings.ts`)

Fields: `footprint` = [w, h] tiles; times are `buildTimeTicks` converted with `SECONDS_TO_TICKS`; power + means generated, − means consumed when powered.

| id | Name | Footprint | Cost | Build (s) | HP | Power gen/use | Weapon | Produces | Notes / role |
|---|---|---|---|---|---|---|---|---|---|
| `command-center` | Command Center | 4×4 | 500 | 30 | 2000 | +10 / 0 | — | `bulldozer` | HQ; `countLimit: 1`; losing it is the usual defeat condition |
| `power-plant` | Power Plant | 3×3 | 200 | 20 | 800 | +50 / 0 | — | — | Only power source; low power degrades the base |
| `supply-dock` | Supply Dock | 3×3 | 300 | 20 | 800 | 0 / 5 | — | `harvester` | Economy building; also the rally/target for harvester drop-off |
| `barracks` | Barracks | 3×3 | 200 | 20 | 600 | 0 / 5 | — | `rifleman` | Infantry production (also `scout`, `rocket-trooper` via production UI) |
| `war-factory` | War Factory | 4×3 | 400 | 30 | 900 | 0 / 10 | — | `assault-walker` | Vehicle production (also `aa-platform`, `artillery`, `engineer`, `apc`) |
| `turret` | Turret | 2×2 | 150 | 15 | 500 | 0 / 5 | `turret-gun` | — | Static defense, hits air |
| `tech-center` | Tech Center | 3×3 | 500 | 40 | 700 | 0 / 10 | — | — | Research building for most upgrades |
| `air-force` | Air Force | 3×3 | 500 | 25 | 900 | 0 / 15 | — | `fighter` | Air production |
| `super-weapon` | Super Weapon | 4×4 | 1500 | 45 | 1500 | 0 / 100 | — | — | `countLimit: 1`; unlocks/fuels the chosen superweapon; huge power draw |
| `bunker` | Bunker | 2×2 | 250 | 20 | 700 | 0 / 5 | `bunker-gun` | — | Garrison: `transportCapacity: 5` infantry |
| `dock` | Dock | 3×3 | 400 | 30 | 900 | 0 / 10 | — | `carrier` | Naval production (also `missile-boat`) |

## 3. Units (`UNITS` in `shared/src/balance/units.ts`)

Times are `buildTimeTicks` in seconds; `vision` is in tiles; `speed` is tiles/second-class sim speed units as defined by the movement system.

| id | Name | Class | Cost | Build (s) | HP | Vision | Speed | Weapon | Produced by | Role |
|---|---|---|---|---|---|---|---|---|---|---|
| `bulldozer` | Bulldozer | vehicle | 100 | 5 | 300 | 4 | 55 | — | `command-center` | Construction unit; builds every structure |
| `harvester` | Harvester | vehicle | 0 | 8 | 600 | 4 | 60 | — | `supply-dock` | `isHarvester: true`; collects supply and returns it (see §6) |
| `scout` | Scout | infantry | 50 | 5 | 100 | 10 | 120 | — | `barracks` | Fast recon; also holds supply fields for the +25% bonus |
| `rifleman` | Rifleman | infantry | 100 | 10 | 200 | 6 | 90 | `rifle` | `barracks` | Mainline infantry |
| `rocket-trooper` | Rocket Trooper | infantry | 150 | 12 | 150 | 6 | 80 | `rocket` | `barracks` | Anti-armor infantry |
| `assault-walker` | Assault Walker | vehicle | 250 | 15 | 400 | 8 | 72 | `cannon` | `war-factory` | Main battle vehicle |
| `aa-platform` | Anti-Air Platform | vehicle | 300 | 18 | 350 | 8 | 68 | `aa` | `war-factory` | Anti-air only (`targetsAir`) |
| `artillery` | Artillery | vehicle | 350 | 22 | 250 | 9 | 48 | `artillery` | `war-factory` | Long-range splash siege; fragile |
| `engineer` | Engineer | vehicle | 150 | 12 | 150 | 6 | 90 | — | `war-factory` | Support; repairs/heals (heal unlocked at veterancy `ENGINEER_HEAL_RANK` = 3) |
| `apc` | APC | vehicle | 200 | 10 | 250 | 7 | 78 | — | `war-factory` | `transportCapacity: 10` infantry transport |
| `fighter` | Fighter | air | 200 | 15 | 150 | 8 | 130 | `air-cannon` | `air-force` | `capacity: 3`, `maxAmmo: 2`, `reloadTicks` = 5 s — sortie-based air unit |
| `carrier` | Carrier | naval | 600 | 35 | 900 | 8 | 55 | — | `dock` | `transportCapacity: 12` naval transport |
| `missile-boat` | Missile Boat | naval | 350 | 20 | 320 | 8 | 80 | `sea-missile` | `dock` | Naval gunboat with splash |

Grenade/smoke ability rule (`canThrowBandolier`): only ground combat units can throw — `class !== 'air'` and neither `bulldozer` nor `engineer`.

## 4. Weapons (`WEAPONS` in `shared/src/balance/weapons.ts`)

`cooldownTicks` shown in seconds; `projectile` is a cosmetic tracer class (`bullet` / `rocket` / `shell`).

| id | Damage | Cooldown (s) | Range (tiles) | Splash | Air | Projectile | Used by |
|---|---|---|---|---|---|---|---|
| `rifle` | 12 | 1.0 | 6 | — | — | bullet | `rifleman` |
| `rocket` | 25 | 2.0 | 7 | — | — | rocket | `rocket-trooper` |
| `cannon` | 40 | 1.5 | 7 | — | — | bullet | `assault-walker` |
| `aa` | 18 | 1.0 | 8 | — | yes | bullet | `aa-platform` |
| `artillery` | 60 | 4.5 | 12 | 1.5 | — | shell | `artillery` |
| `turret-gun` | 20 | 1.2 | 8 | — | yes | bullet | `turret` |
| `bunker-gun` | 22 | 1.2 | 8 | — | yes | bullet | `bunker` (garrisoned) |
| `air-cannon` | 45 | 3.0 | 7 | — | — | rocket | `fighter` |
| `sea-missile` | 60 | 4.0 | 9 | 1.5 | — | rocket | `missile-boat` |

## 5. Upgrades / Research (`UPGRADES` in `shared/src/balance/upgrades.ts`)

`availableAt` is the building that offers the research; `requiredRank` is the in-match general rank (★) gate (see §7). Order follows `UPGRADE_IDS`.

| id | Name | Cost | Research (s) | Available at | Required rank |
|---|---|---|---|---|---|
| `radar` | Radar | 300 | 15 | `command-center` | 0 |
| `satellite` | Satellite | 500 | 20 | `tech-center` | 0 |
| `space-laser` | Space Laser | 1000 | 40 | `super-weapon` | 3 |
| `stealth-tech` | Stealth Tech | 400 | 20 | `tech-center` | 1 |
| `detector-upgrade` | Detector Upgrade | 300 | 15 | `tech-center` | 1 |
| `mine-tech` | Mine Tech | 400 | 20 | `tech-center` | 1 |
| `abilities-tech` | Grenades & Smoke | 400 | 20 | `tech-center` | 1 |
| `transport-capacity` | Troop Capacity | 300 | 20 | `tech-center` | 1 |
| `defense-dome` | Defense Dome | 500 | 20 | `tech-center` | 2 |
| `weapon-upgrade` | Weapon Upgrade | 400 | 20 | `tech-center` | 2 |
| `airstrike-level` | Airstrike Payload | 1000 | 40 | `super-weapon` | 3 |
| `emp-level` | EMP Overcharge | 1000 | 40 | `super-weapon` | 3 |

Notes:

- The three `super-weapon` researches (laser, airstrike payload, EMP overcharge) are the "leveled superweapon" tier (Day 15) and cost 1000 each with a 40 s research time.
- Researching anything awards `SCORE_RESEARCH` (15) match score once per completed research (`placing-system.ts` → `world.awardScore`).
- `Weapon Upgrade` levels to `WEAPON_UPGRADE_MAX_LEVEL` = 3; the per-level cost is `weaponUpgradeCost(team, baseCost)` = `baseCost × (level + 1)`.

## 6. Economy

- Starting credits: `DEFAULT_CREDITS` = 800 (`startingCredits` in `DEFAULT_MATCH_SETTINGS`).
- Supply: each completed harvester trip banks `SUPPLY_PER_TRIP` = 50 credits plus a percentage bonus, and awards `SCORE_SUPPLY_PER_TRIP` (2) match score (`economy-system.ts`). Supply fields have a finite number of trips (`trips` on the field).
- Supply-field control bonus: holding a supply field with a scout grants `SUPPLY_FIELD_BONUS` = +25 % per trip; claiming takes `SUPPLY_FIELD_CLAIM_TICKS` = 20 s and holding ticks every `SUPPLY_FIELD_HOLD_TICKS` = 10 s.
- Oil fields: owned oil fields pay `OIL_INCOME` = 50 credits every `OIL_INCOME_INTERVAL_TICKS` = 10 s; claiming takes `OIL_CLAIM_TICKS` = 20 s; oil fields have `OIL_FIELD_HP` = 500 and can be destroyed.
- Power: `power-plant` `powerGen` 50 (HQ +10); buildings draw `powerUse`. The `super-weapon` alone draws 100.

## 7. Match Score and Commander (General) Rank

Deterministic sim events grant match score so every host and client agree on promotions (`world.ts` → `awardScore`):

| Source | Points | Constant | Where |
|---|---|---|---|
| Unit destroyed (combat kill) | 10 | `SCORE_UNIT_KILL` | `world.ts` (on entity destruction, killer via `lastAttacker`) |
| Building destroyed | 30 | `SCORE_BUILDING_KILL` | same |
| Harvester trip docked | 2 | `SCORE_SUPPLY_PER_TRIP` | `economy-system.ts` |
| Research completed | 15 | `SCORE_RESEARCH` | `placing-system.ts` |
| Expansion near a new spot | 25 | `SCORE_EXPANSION` (within `EXPANSION_RADIUS_TILES` = 18) | `input-system.ts` |

Rank rules (`world.ts`):

- `RANK_FLOORS` = [500, 1500, 3500]; `MAX_RANK` (`RANK_COUNT`) = 3 stars.
- Promotion is automatic inside `awardScore` — while `canRankUp(team)` the sim calls `rankUp(team)`; no player action or button exists.
- `rankUp` grants a free credits prize (`rankUpPrizeCredits`, default 100 — nothing is consumed) and emits a `rank-up` event.
- Co-op: when teams share a co-op ladder, score/rank land on the alliance slot (`rankSlot(team)`); the lobby co-op rank mode is chosen from `COOP_RANK_OPTIONS` = `none | score | level | both`.
- Rank gates: `requiredRank` on upgrades (§5) and the `sw-choose` command for airstrike/EMP (rank 3). The Space Laser is the exception — it is free and always armed once researched (see §8).
- HUD: the top-left rank button and the `#rank-menu` side panel (`client/src/ui/hud.ts`) list the three tiers with star glyphs, the current score and the next floor (`hud.rankFloor`).

## 8. Superweapons

Three weapons, all tied to the `super-weapon` building (and, for airstrike/EMP, to the rank-3 `sw-choose` lock-in — `input-system.ts` rejects the choice below the required rank):

- Space Laser (`space-laser` research, requiredRank 3): cooldown `LASER_COOLDOWN_TICKS` = 60 s, radius `LASER_RADIUS` = 3 tiles × laser level, duration `LASER_DURATION_TICKS` = 4 s, `LASER_DAMAGE_PER_TICK` = 40; max level `LASER_MAX_LEVEL` = 2 (`laserMaxLevel`), strike delay improves per level (`laserDelayTicksLv1` 1 s / `laserDelayTicksLv2` 0.7 s); upgrade cost scales `baseCost × (level + 1)`. Availability (`laserAvailable`): the team must have researched it; the first shot is free after building a `command-center` (`laserFreeShotUsed`), afterwards a completed `super-weapon` is required; disabled while `powerDown`.
- Airstrike (`swChoice = 'airstrike'`): `AIRSTRIKE_PLANES` = 4 planes, `AIRSTRIKE_BOMB_DAMAGE` = 50 per bomb, `AIRSTRIKE_BOMB_RADIUS` = 3, cooldown `AIRSTRIKE_COOLDOWN_TICKS` = 60 s. Levels via `airstrike-level` (max `AIRSTRIKE_MAX_LEVEL` = 2): damage ×(1 + 0.5·level), radius ×(1 + 0.15·level).
- EMP (`swChoice = 'emp'`): radius `EMP_RADIUS_TILES` = 8, stun `EMP_DURATION_TICKS` = 5 s, cooldown `EMP_COOLDOWN_TICKS` = 60 s. Levels via `emp-level` (max `EMP_MAX_LEVEL` = 2): radius ×(1 + 0.15·level), duration ×(1 + 0.5·level). `empStunned(id)` disables units/buildings until `empUntil`.

All three require a live `super-weapon` building and a powered team (`powerDown` blocks them); each has a `*Available` / `*CooldownRemaining` pair in `world.ts`.

## 9. Veterancy (Unit Experience)

- Kill thresholds (`constants.ts`): rank 1 at 3 kills, 2 at 6, 3 at 9, 4 at 12, 5 at 15; `VETERAN_MAX_RANK` = 5.
- Per-rank bonuses: damage +`VETERAN_DAMAGE_PER_RANK` (0.25 = +25 %), range +`VETERAN_RANGE_PER_RANK` (0.1), armor +`VETERAN_ARMOR_PER_RANK` (0.2 damage reduction, floored at `VETERAN_ARMOR_FLOOR` = 0.5).
- Promotions increment the profile counter `veteranPromotions` (used by the `veteran-cert` and `war-hero` achievements).

## 10. Daily Missions and Daily Level (`client/src/modes/daily.ts`, `client/src/profile/modeRecords.ts`)

- The daily challenge is deterministic and generation-based, not date-based: `generateDailyMissions(generation)` shuffles the five mission kinds and picks `DAILY_MISSION_COUNT` = 4. The list persists until every mission is done (`resolveDailyChallenge` bumps `generation` only then).
- Mission kinds (`KINDS`), each with a jittered target (±1/3 down to +1/2 of base) and fixed XP:

  | Kind | Base target | XP | Satisfied when |
  |---|---|---|---|
  | `win` | 1 | 40 | The daily match is won |
  | `train` | 10 | 30 | `unitsTrained` ≥ target |
  | `build` | 6 | 30 | `buildingsBuilt` ≥ target |
  | `destroy` | 8 | 30 | `kills` ≥ target |
  | `supply` | 600 | 25 | `supplyHarvested` ≥ target |

- XP banks only for missions newly finished in a play (`recordDailyResult`); level = `xp / DAILY_XP_PER_LEVEL` (100), with the remainder shown as progress (`dailyLevel` / `dailyLevelXp`). The daily level only grows (battle-pass style) and is local only — no leaderboard.
- Streak: consecutive UTC days played (`todayKey`, `isNextUtcDay`), tracked as `streak` / `bestStreak` with `lastPlayedDayKey`.
- Persisted under `space-arenas:mode-records` (`MODE_RECORDS_KEY`, `MODE_RECORDS_VERSION` = 2) as `ModeRecords.daily: DailyLevelRecord`.
- UI: the Daily tab shows level, streak and mission progress; the results note uses `daily.resultsNote*` (`Game.ts`); the profile panel shows the daily card (`profile/ui.ts`).

## 11. Achievements (`client/src/profile/achievements.ts`)

- 43 achievements in 7 groups: `economy` (5), `army` (11), `research` (6), `combat` (10), `superweapons` (4), `career` (4), `spectator` (3).
- Progress model: each `AchievementDef` is either `stat`-based (a `ProfileCounters` field with a `target`) or `countType`-based (`building` / `unit` / `upgrade` with a `typeId` read from `ProfileTypeCounts` maps). `achievementProgress` computes the current value; `achievementTarget(config, def)` allows per-player target overrides via `ProfileConfig.achievementTargets`.
- Unlocking: `evaluateAchievements(profile, config)` runs after matches and stamps `profile.achievements[id] = { unlockedAt }`; nothing else is granted (no rewards).
- UI: the Profile tab renders grouped lists with progress bars and unlock dates (`profile/ui.ts` → `achievementsMarkup`).

## 12. Profile and Records (`client/src/profile/profile.ts`)

- Stored in `localStorage` key `space-arenas:profile` (`PROFILE_KEY`, `PROFILE_VERSION` = 1) plus `space-arenas:profile:config` (`ProfileConfig`: `historyCap` default `DEFAULT_PROFILE_HISTORY_CAP` = 50, achievement target overrides). Commander name defaults to `DEFAULT_PROFILE_NAME` = "Commander" and is editable (same length cap as the match-name field).
- `ProfileCounters` (cumulative, monotonic): `gamesPlayed`, `wins`, `losses`, `draws`, `spectatedMatches`, `kills`, `killsInfantry`, `killsVehicle`, `killsAir`, `killsBuilding`, `unitsTrained`, `unitsLost`, `buildingsBuilt`, `buildingsLost`, `supplyHarvested`, `damageDealt`, `minesPlaced`, `veteranPromotions`, `grenadesLobbed`, `laserStrikes`, `airstrikes`, `empStrikes`, `satelliteScans`, `troopsTransported`.
- `ProfileTypeCounts`: `unitsTrainedByType`, `buildingsBuiltByType`, `upgradesResearched` (per-id maps for type-scoped achievements).
- `MatchRecord` history entries: `at`, `mode` (`offline` / `net` / `replay`), `result` (`win` / `loss` / `draw` / `spectate`), `map`, `durationSec`, `kills`, `unitsBuilt`, `buildingsBuilt`, `supplyHarvested`, `score`. Capped at `historyCap` (oldest dropped); `recordSpectate` appends spectate entries.
- `totalScore(profile)` = sum of `history[].score` — the profile's headline "Total Score".
- Profile panel: total score, hexagon radar chart (combat / economy / army / expansion / research / intel axes with fixed caps), stat tiles (games, wins, losses, win rate, spectated, kills, supplies, units trained, buildings built, achievements unlocked, time played), daily mode card, rename field and a reset button (`profile-reset`, prompt-guarded).
- Reset (`resetProfile`) rebuilds a `freshProfile`; the folder-backup path mirrors profile keys to the server (see doc 06 §9).

## 13. Online Leaderboard vs Local Progression

Three separate scoring systems coexist; they are not interchangeable:

| System | Scope | Granularity | Persistence |
|---|---|---|---|
| Match score / rank stars (§7) | One match, in-sim | Per-match, deterministic events; resets every match | Ephemeral; mirrored into the match record's per-player `score` |
| Online leaderboard | Account, cross-match best | Highest single-match score | Supabase `leaderboard.score` = `profiles.high_score` = max(existing, match score) (`online/src/supabase.ts` → `dbRecordMatch`); ordered `score.desc, username.asc` |
| Local profile total | Device, cumulative | Sum of all recorded matches | `totalScore()` over `profile.history` in `localStorage` |

- Only **online/net matches recorded by the server** feed the leaderboard: `dbRecordMatch` updates `profiles.games/wins/high_score` and upserts the leaderboard row with the player's best score. Offline skirmishes never reach the server, so they count only in the local profile.
- Achievements and daily missions are independent of the leaderboard: achievements read cumulative local counters (all modes), and daily missions read a single daily match result (`DailyMatchResult`). Neither grants score, and leaderboard standing does not unlock them.
- Spectator matches increment `spectatedMatches` (and the spectator achievements) but contribute no score anywhere.

## 14. Planned / Not Yet Implemented

- Campaign missions and any campaign-specific content: no code exists; there is no campaign module, mission file format or campaign state.
- Battle pass / meta-shop / unlockable cosmetics: nothing beyond the local daily level (§10) exists.
- Cross-device progression sync of profile/achievements beyond the folder-backup JSON mirror (doc 06 §9); the daily level is explicitly "local only" (`modeRecords.ts` comment).
