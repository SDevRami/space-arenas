# 06 — Data and Save System

**Status:** Implemented. This document enumerates every persistent data structure in the shipped code: all `localStorage` keys, the one remaining IndexedDB database, map file schema, host-side files and the optional online (Supabase) backup/leaderboard tables. Anything designed but absent is explicitly marked "Planned / not yet implemented".

## 1. Storage Backends

| Backend | Used for | Notes |
|---|---|---|
| **localStorage** (origin-scoped) | Every user preference, profile, map library, dev settings, mod selection, rejoin hint | Synchronous; the primary and almost only store. All keys namespaced `space-arenas:` |
| **sessionStorage** | `space-arenas:auth` (login session token + profile mirror) | Cleared on tab close; keeps the token out of persistent storage |
| **IndexedDB** | Legacy map library only (`space-arenas-maps` / store `maps`) | Read once by `migrateLegacyLibrary()` (`client/src/mapbuilder/library.ts`) and copied into `space-arenas:custom-maps`; never written again |
| **Host filesystem** | `archive/*.json` replays (`host/src/archive.ts`, `ARCHIVE_DIR`, overridable via `SA_ARCHIVE_DIR`); `profile/backup.json` local snapshot (`client/src/profile/folder-backup.ts` → host `POST /api/profile`) | The LAN host doubles as a tiny file server |
| **Server database (Supabase)** | `profiles`, `leaderboard`, `matches`, `backups`, mod/map repos and comments (`online/src/supabase.ts`) | Optional; only used by the online mode and the Data tab |

There is **no** IndexedDB store for lobby history, desync dumps or replays — replays live in the host's `archive/` folder or are downloaded as files by the browser. Browser storage is origin-scoped (`scheme://host:port`), which is why the folder backup and cloud backup paths exist (§9).

## 2. localStorage Key Inventory

| Key | Value shape | Written by | Purpose |
|---|---|---|---|
| `space-arenas:audio` | `AudioSettings` JSON | `client/src/audio/settings.ts` | Volume/mute/haptics + sound overrides & tuning |
| `space-arenas:graphics` | `GraphicsSettings` JSON | `client/src/ui/graphics.ts` | Quality, effects, weather, scales, asset paths, camera zoom |
| `space-arenas:lang` | `'en' \| 'ar'` plain string | `client/src/i18n/index.ts` (`setLang`) | UI language (drives RTL via `applyLangAttrs`) |
| `space-arenas:controls` | `Bindings` JSON (action → key) | `client/src/ui/controls.ts` | Hotkeys (`DEFAULT_BINDINGS` baseline) |
| `space-arenas:hud-parts` | `Record<string, boolean>` | `client/src/game/Game.ts` (`persistHudParts`) | Dev-overlay HUD part toggles (`fps`, `ticks`, `sync`; default on) |
| `space-arenas:custom-maps` | `MapData[]` JSON | `client/src/mapbuilder/library.ts` | Custom map library (validated on save; upsert by name) |
| `space-arenas:profile` | `Profile` JSON (`v: 1`) | `client/src/profile/profile.ts` | Commander name, counters, type counts, history, achievements |
| `space-arenas:profile:config` | `ProfileConfig` JSON | `client/src/profile/profile.ts` | `historyCap` + achievement target overrides |
| `space-arenas:mode-records` | `{ v: 2, daily: DailyLevelRecord \| null }` | `client/src/profile/modeRecords.ts` | Daily challenge generation/done ids, XP, streaks |
| `space-arenas:clientId` | 32-hex-char string | `client/src/net/net.ts` (`loadOrCreateClientId`) | Stable per-browser id for reclaiming a player slot on reconnect; **excluded from folder backup dumps** (`IDENTITY_KEYS`) |
| `space-arenas:name` | plain string | `client/src/main.ts` | Last online display name |
| `space-arenas:auth` | `AuthSession` JSON | `client/src/main.ts` (`saveAuth`) — **sessionStorage** | `{ token, email, username, games, wins, highScore }` |
| `space-arenas:mods-active` | `Record<string, boolean>` | `client/src/main.ts` (`saveModsActiveMap`) | Which balance mods are enabled (missing = active) |
| `space-arenas:offline-mod` | plain string (mod name) | `client/src/main.ts` | Mod applied to offline skirmishes when the offline-mod toggle is on |
| `space-arenas:mobile-mode` | `'1'` when on (absent = off) | `client/src/main.ts` (`setMobileMode`) | Mobile UI layout |
| `space-arenas:auto-replay` | `'1' \| '0'` | `client/src/main.ts` | Auto-save replay after LAN/online matches (default off) |
| `space-arenas:dev-settings` | `Partial<MatchSettings>` JSON (`devOverrides`) | `client/src/main.ts` dev panel | Live balance overrides for the next match |
| `space-arenas:dev-defaults` | `Partial<MatchSettings>` JSON (`savedDefaults`) | `client/src/main.ts` dev panel | "Save as default" baseline for the overrides |
| `space-arenas:dev-client-defaults` | `ClientDevSettings` JSON | `client/src/main.ts` dev panel | Local mirror of the `settings.json` `client` block (graphics/audio/profile), so the "modified only" badge works offline |
| `space-arenas:active-match` | `ActiveMatch` JSON | `client/src/main.ts` (`saveActiveMatch` / `readActiveMatch`) | Rejoin hint after a tab reload: `{ addr, code, pass, name, ts }` — note this persists the room `pass` in localStorage until consumed |

Every reader wraps access in `try/catch` and falls back to defaults; a full disk or private mode degrades gracefully (nothing is thrown at the user).

## 3. Settings Store Schemas

### 3.1 Audio (`space-arenas:audio`)

`AudioSettings` (`client/src/audio/settings.ts`): `master` (0–1, default 1), `effects` (0.8), `ambient` (0.35), `ambientInMatch` (0.35), `music` (0.6, lobby track), `muted`, `ambientEnabled`, `musicMuted` (lobby music has its own mute, separate from master), `haptics`, `overrides: Record<string, string>` (per-sound file/folder URL; empty = synth), `tuning: Record<string, { vol, pitch }>` (`TUNING_VOL_MAX` 4, pitch 0.25–4).

### 3.2 Graphics (`space-arenas:graphics`)

`GraphicsSettings` (`client/src/ui/graphics.ts`): `quality`, `effects: Record<EffectId, boolean>`, `weather`, `buildingFill` / `buildingOffset`, `fieldScale` / `fieldOffset`, `obstacleScale` / `obstacleOffset`, `unitScale` / `unitOffset` (per class), `assetPaths: Record<string, string>` (default templates in `DEFAULT_ASSET_PATHS`, `{color}`/`{frame}` placeholders), `hudIconSize`, `fxScale` / `fxOffset`, `projectileBulletSize` / `projectileRocketSize` / `projectileShellSize` / `projectileShellHeight`, `minimapScale`, `victoryCinematicSec`, `zoomMin` / `zoomMax` and `replayZoomMin` / `replayZoomMax`, `spriteLayerOrder`, `uiScale`.

### 3.3 Controls (`space-arenas:controls`)

`Bindings` = `Record<string, string>` mapping action ids (and `slot:1`…`slot:9`) to `KeyboardEvent.key` / mouse names from `DEFAULT_BINDINGS` (e.g. `attackMove: 'a'`, `stop: 's'`, `sell: 'Delete'`, `select: 'left'`, `move: 'right'`).

### 3.4 Language (`space-arenas:lang`)

Plain `'en'` or `'ar'` (`Lang` in `client/src/i18n/index.ts`). Dictionaries are bundled (`lang/en.json`, `lang/ar.json`); changing language re-renders and flips `dir`/`lang` document attributes for RTL.

## 4. Profile Data

### 4.1 `space-arenas:profile` (`PROFILE_KEY`, `PROFILE_VERSION` = 1)

`Profile` (`client/src/profile/profile.ts`): `v`, `name` (default "Commander"), `createdAt`, `counters` (`ProfileCounters`: 24 cumulative counters — games/wins/losses/draws/spectated, kills by class, units trained/lost, buildings built/lost, supply harvested, damage, mines, veteran promotions, grenades, laser/airstrike/EMP strikes, satellite scans, troops transported), `typeCounts` (`unitsTrainedByType`, `buildingsBuiltByType`, `upgradesResearched`), `history: MatchRecord[]` (capped by `historyCap`, default `DEFAULT_PROFILE_HISTORY_CAP` = 50; each has `at`, `mode`, `result`, `map`, `durationSec`, `kills`, `unitsBuilt`, `buildingsBuilt`, `supplyHarvested`, `score`), `achievements: Record<id, { unlockedAt }>`.

### 4.2 `space-arenas:profile:config` (`ProfileConfig`)

`{ historyCap: number, achievementTargets: Partial<Record<string, number>> }` — per-player achievement target overrides (used by `achievementTarget`).

### 4.3 `space-arenas:mode-records` (`MODE_RECORDS_VERSION` = 2)

`{ v: 2, daily: DailyLevelRecord | null }` where `DailyLevelRecord` = `{ xp, streak, bestStreak, lastPlayedDayKey, challenge: { generation, doneIds } | null }`. A version mismatch resets the record to `freshModeRecords()`.

Versioning rule here (and for the profile): each store carries its own version field; reading an unknown/newer version falls back to a fresh record rather than throwing — progression data is rebuilt, never corrupted.

## 5. Map Data (canonical schema)

The canonical `MapData` lives in `shared/src/maps.ts` and is used identically by the map builder, the client and the host. Stored in `space-arenas:custom-maps` as an array, exported/imported as JSON files.

```jsonc
{
  "schemaVersion": 1,
  "format": "space-arenas-map",
  "name": "The Breach",
  "description": "…",
  "author": "you",
  "mapVersion": "0.1.0",
  "width": 128, "height": 128,          // MIN_MAP_SIZE 16 … MAX_MAP_SIZE 512
  "tiles": [/* width*height terrain ids, row-major */],
  "groundColors": [/* optional per-tile '#rrggbb' overrides, '' = terrain default */],
  "brightness": 0,                       // optional global light factor −10..+10
  "obstructions": [{ "x": 40, "y": 41, "w": 2, "h": 2, "type": "rock" }],
  "supplyFields": [{ "x": 20, "y": 30, "radius": 3, "capacity": 10 }],
  "oilFields": [{ "x": 50, "y": 12, "radius": 3 }],
  "spawnPoints": [{ "x": 8, "y": 8, "team": 0 }],
  "credits": 800                          // starting credits for this map
}
```

- Terrain ids: `Terrain.Ground=0`, `Cliff=1`, `Water=2`, `Road=3`, `BuildableGround=4` (`isPassableTerrain`, `isBuildableTerrain`).
- `validateMap()` (single shared implementation) checks: `format`; width/height in range; `tiles.length === width*height`; spawn count 2…`DEFAULT_MAX_PLAYERS`, in bounds, unique teams; ≥ 1 supply field with `radius ≥ 1`, `capacity ≥ 1`, in bounds; oil fields in bounds with `radius ≥ 1`; obstructions fully in bounds; `credits ≥ 0`; `brightness` within −10…+10.
- Wire/storage canonicalization: `canonicalStringify(map)` emits a fixed key order with tiles RLE-compressed by `compressTiles` (`[value, runLength]` pairs) — used for map fingerprinting/hashing; there is **no** `checksum` field in `MapData`.
- Presets: `MAP_PRESETS` (8 entries — river/lake/plain/rings/pass/crossroads/hexring/shattered variants) are generated by `mapForPreset` / `generateMap(players, seedText, variant)`, not stored.
- Import seeding: `.json` maps under the repo's `maps/` folder are bundled at build time and imported into the custom library on first run (`seedLibraryFromBundledMaps`), never overwriting a same-named custom map.
- Legacy migration: `migrateLegacyLibrary()` reads the old standalone builder's IndexedDB (`space-arenas-maps`, store `maps`, rows `{ name, map: <json string> }`) **once**, only when the custom library is empty, and copies everything into `space-arenas:custom-maps`. The IndexedDB database is not deleted, just abandoned.

## 6. Dev Settings and `settings.json`

Three coupled stores (§2): `space-arenas:dev-settings` (live `Partial<MatchSettings>` overrides), `space-arenas:dev-defaults` (the saved baseline), `space-arenas:dev-client-defaults` (`ClientDevSettings` = `{ graphics?, audio?, profile? }`, the client-only mirror).

- The dev panel builds a form from these, offers a "Modified only" filter (badge computed against the defaults mirror) and "Save as default".
- "Save as default" additionally persists to the **host** as `profile/settings.json` via `POST /api/settings` (`shared/src/settings-file.ts`, `MatchSettingsFile`):

```jsonc
{
  "v": 1,
  "builtin": { "startingCredits": 5000 },   // shipped/base layer
  "user":    { "sellRefundFraction": 0.4 },  // per-player override layer
  "client":  { "graphics": {}, "audio": {}, "profile": {} }
}
```

- Resolution: `builtin` then `user` layered over the compiled `DEFAULT_MATCH_SETTINGS` (`resolveSettingsFileLayers` + `mergeMatchSettings`); when `/api/settings` is unavailable (static hosting) the client falls back to compiled defaults + localStorage.
- `fingerprintSettings()` (crc32 over `canonicalJson`) identifies the "effective defaults" so lobby sync chips can show whether a client's defaults match the host's.
- `sanitizeClientDevSettings()` neutralises foreign-origin absolute asset/audio URLs whenever client values cross machines (clone, mod, settings import) — the server drops every absolute URL by default.

## 7. Mods

- `space-arenas:mods-active` — `Record<string, boolean>`; a mod missing from the map counts as active (`isModActive`).
- `space-arenas:offline-mod` — name of the mod applied to offline skirmishes (with the offline-mod toggle in the lobby). Match panel mods sync through the lobby `clientSettings`/clone path, not localStorage.

## 8. Host and Server Persistence

- **Replays** (`host/src/archive.ts`): the LAN host archives replays as `<name>.json` under `ARCHIVE_DIR` (project-root `archive/`, overridable with `SA_ARCHIVE_DIR`); `replayFileName` scrubs filesystem-hostile characters and caps at 80 chars. The lobby Archive tab lists/reads/renames/deletes through the host API. Offline matches are not archived — the player downloads a replay file manually (pause/results "Save Replay"); `space-arenas:auto-replay` only auto-saves LAN/online matches.
- **Local folder backup** (`client/src/profile/folder-backup.ts`): the whole localStorage (minus `space-arenas:clientId`) is POSTed to `POST /api/profile` and stored on the host as `profile/backup.json` (`{ v: 1, origin, savedAt, keys }`). Saves run on load, on `pagehide` (keepalive) and on a 30 s heartbeat, but only when a cheap storage fingerprint changes. On startup, if `CORE_STORAGE_KEYS` (`graphics`, `audio`, `profile`, `name`, `clientId`) are missing, missing keys are restored from the host — existing local data always wins.
- **Online accounts** (`online/src/supabase.ts`): `profiles` (`user_id`, `username`, `games`, `wins`, `high_score`), `leaderboard` (mirrors best single-match score; read ordered `score.desc, username.asc`), `matches` (map, winner, started_at, participants with per-player score), `backups` (encrypted blobs). `dbRecordMatch` updates profiles and upserts the leaderboard when a net match finishes.
- **Cloud backups** (Data tab in the lobby, `client/src/main.ts`): payloads of kind `devsettings` (dev settings + defaults + graphics/audio/profile-config/controls/hud-parts/custom-maps/mods/dev-client-defaults) or `profile` (`profile`, `profile:config`, `mode-records`) are encrypted client-side (`encryptPayload`, `client/src/net/crypto.ts`) with a player passphrase; only a `passphraseHash` is stored server-side. Limits (`online/src/config.ts`): `BACKUPS_TTL_DAYS` = 7, `BACKUPS_MAX_PER_USER` = 10, `BACKUPS_MAX_PAYLOAD_BYTES` = 64 KB, purge every 10 min; restore only writes keys present in the blob (empty string = delete that key) and re-sanitises client settings.

## 9. Reset and Export

- Export/import: the Data tab serialises `{ v: 1, kind: 'devsettings' | 'profile', keys }` payloads for download/upload (`collectPayload` in `client/src/main.ts`).
- Full local reset: `resetProfile` clears profile/achievements/daily records; the profile panel's reset button is prompt-guarded. A "reset everything" sweep (clearing the `space-arenas:` localStorage keys listed in §2) is exposed through the dev/data flows; there is no separate IndexedDB cleanup because the legacy map DB is read-only.
- Namespacing: every key starts with `space-arenas:` (colon separator), so hosting the game on a shared domain cannot collide with other apps' data.

## 10. What Is NOT Persisted (and Why)

| Data | Reason |
|---|---|
| Mid-match sim state | The deterministic sim is not resumable; the only rejoin affordance is the `space-arenas:active-match` hint (address/code/name), which offers a fresh reconnect |
| Passphrases for rooms | Never stored except inside the `active-match` rejoin hint's `pass` field (needed to auto-rejoin); cloud backup passphrases exist only as a server-side verification hash |
| Replays in the browser | Offline replays are explicit downloads; LAN/online replays live in the host's `archive/` |
| Lobby history / desync dumps | No such store exists; desync diagnosis uses in-session logs and hashes |
| Match score outside the profile | Match score is ephemeral per match; only the profile `history[].score`, the online `matches` row and the `high_score`/`leaderboard` mirror survive |

## 11. Planned / Not Yet Implemented

- Any schema migration framework (`migrate(name, fromVersion)`): not present — the current strategy is per-store version reset-to-fresh on mismatch.
- IndexedDB use beyond the abandoned legacy map store.
- Cloud sync of the full profile outside the manual, passphrase-encrypted Data-tab backups.
