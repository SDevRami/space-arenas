# 13 — Map Publishing

**Status:** Shipped — the community map repository is implemented and wired through the online
server (Supabase-backed). This document reflects the current shipped implementation. Any future
enhancements are explicitly marked as *Planned / not yet implemented*.

This is a companion to the mod repository: it reuses the same authentication, rate limits, RLS
model, and list/browse UX patterns.

---

## 1. Goal

Space Arenas supports custom maps built in the Map Builder; previously, maps were local-only. The
community map repository lets any signed-in player:

- **Publish** a custom map (with a short description).
- **Browse/search/sort** the repository (newest, best-rated, most downloaded, by player count).
- **Download** a published map and load it into the map builder / lobby.
- **Rate and comment** on published maps (owners can delete their own).

Design principle: **parity with mods** where it makes sense. Validation/sanitisation, auth, rate
limits, quotas, RLS and naming all follow the same pipeline.

---

## 2. Asset: `MapData` (shipped)

Maps are represented as `MapData` in `shared/src/maps.ts`:

| Field | Notes |
|---|---|
| `schemaVersion` | `1` |
| `format` | `'space-arenas-map'` |
| `name`, `description`, `author`, `mapVersion` | metadata |
| `width`, `height` | grid size (16..256) |
| `tiles[]`, `groundColors[]` | terrain + per-tile tint |
| `brightness` | global lighting |
| `obstructions`, `supplyFields`, `oilFields`, `spawnPoints` | gameplay objects |
| `credits` | optional starting credits override |

Validation: `validateMap(map)` (`shared/src/maps.ts`) rejects bad formats, out-of-range sizes,
tile-length mismatches, spawn counts outside `2..DEFAULT_MAX_PLAYERS`, missing supply fields,
out-of-bounds objects, negative credits and bad brightness. **Client and server share this
function**, so a map that passes upload validation is guaranteed to load in the existing import
path.

Client Map Builder already supports: export `.json` (`builder.ts` `#mb-export`), import `.json`
(`importMapFile`), IndexedDB library (`mapbuilder/library.ts`), and minimap previewing.

---

## 3. Client changes (shipped)

| Area | Path | Notes |
|---|---|---|
| Map builder | `client/src/mapbuilder/builder.ts` | Export/import existing maps to `.json`. |
| Community UI | `online/public/community.html`, `online/public/app.js` | Three-tab hub **Mods | Maps | My published**; list/grid, filters/sorts, ratings, comments, publish/delete. |
| Publish (repo) | `client/src/main.ts` (maps repo UI) | Publish a selected map from the community repo UI (`POST /api/maps`), validates description (1–160 chars), shows online-error toasts, handles 201/400/401/409/413/429/503. |
| Publish (landing) | `online/public/app.js` | Landing/community page supports publishing a selected map file and listing/browsing the map repo. |
| Import | `client/src/main.ts` / builder | Downloaded published maps are loaded via the existing `.json` import path (uses `validateMap`). |
| i18n | `online/public/app.js` | `community.maps.*`, `community.tab.maps`, `community.mapsUpload.*`, `community.mine.mapsTitle` keys. |

---

## 4. Online server (shipped)

### 4.1 Module `online/src/maps.ts`

| Export | Value/Type | Purpose |
|---|---|---|
| `MAP_MAX_BYTES` | `4 * 1024 * 1024` | Max upload size (same ceiling as mods). |
| `MAPS_MAX_PER_USER` | `20` | Per-account publish quota. |
| `sanitizeMap(json)` | `MapData \| null` | Re-validates with `validateMap`; forces `format/schemaVersion`; scrubs names/descriptions/authors/version to safe lengths. |
| `mapLabel(m, fallback)` | `string` | Human label for repo list. |
| `mapMetrics(m)` | `{ width, height, players }` | Denormalised metrics for the payload-free list. |

### 4.2 Routes in `online/src/index.ts` (via `handleMaps`)

| Method & path | Auth | Rate-limit | Purpose |
|---|---|---|---|
| `GET /api/maps/repo?q&sort&owner&limit` | none | `mapRepo` (`RATE_MAP_REPO_PER_MIN = 60`) | Payload-free list (newest/rating/downloads/players). |
| `GET /api/maps/:id` | none | `mapDownload` (`RATE_MAP_DOWNLOAD_PER_MIN = 60`) | Returns **raw `MapData`** (so the client's import path consumes it). |
| `POST /api/maps` | session | `mapWrite` (`RATE_MAP_WRITE_PER_MIN = 10`) | Publish (validates, enforces size/quota/name dup; 400/401/409/413/503). |
| `DELETE /api/maps/:id` | session | `mapWrite` | Owner-only delete (403 if not owner, 404 if missing). |
| `POST /api/maps/:id/rate` | session | `mapWrite` | Rating 1–5 (upsert). |
| `POST /api/maps/:id/comments` | session | `mapWrite` | Comment (length limited). |

Limits/config (`online/src/config.ts`): `MAP_COMMENT_MAX_CHARS = 500`,
`RATE_MAP_REPO_PER_MIN=60`, `RATE_MAP_DOWNLOAD_PER_MIN=60`, `RATE_MAP_WRITE_PER_MIN=10`.

---

## 5. Database — `online/supabase/migrations/005_maps.sql` (shipped)

Idempotent migration creating:

- `public.maps` — `id uuid PK`, `owner_id` → `auth.users(id)` ON DELETE CASCADE, `name text not null`
  with unique index on `lower(name)`, denormalised `meta_author`, `meta_description`,
  `meta_version`, `size_bytes`, `width`, `height`, `players`, `require_protocol`, `payload jsonb`,
  `downloads int default 0`, `created_at`; indexes on `created_at desc`, `downloads desc`, `players`,
  `owner_id`.
- `public.map_ratings` — `(map_id, user_id)` PK, `rating smallint check (1..5)`, FK to `maps` and
  `auth.users` with cascade.
- `public.map_comments` — `id uuid PK`, `map_id`, `user_id`, `body text check (char_length between 1
  and 500)`, `created_at`, FKs with cascade.
- **RLS** identical to mods: reads readable by all; writes restricted to service role only (all writes
  flow through the Render server after sanitisation).

---

## 6. Community hub (shipped)

- `online/public/community.html` has a **three-tab** community hub: **Mods | Maps | My published**.
  Default tab is Mods. Tab switching toggles panels (`data-tab`).
- `online/public/app.js` implements `loadCommunityMaps()` mirroring `loadCommunity()` for mods:
  fetches `api/maps/repo`, client-side TTL cache (~5 min), handles 503/offline with the same "repo
  unavailable" copy.
- Map cards show name, author, player count + grid size chips, description, ★ rating, downloads, and
  publish date; owner sees a **Delete** action (parity with mods).
- i18n keys for maps cover repo list, upload form, statuses and the "My published" section.

The landing page (`online/public/index.html`) links to `community.html`.

---

## 7. Security & fairness (shipped)

- **Data-only.** Maps carry terrain/objects/spawns/credits only — no economy/unit balance
  definitions. The balance-mod pipeline owns those; no new surface beyond `validateMap`.
- **Server re-validates.** The server runs `shared` `validateMap` + `sanitizeMap` even if the client
  validated before publish, so hostile/broken uploads are rejected.
- **Size cap + rate limits.** `MAP_MAX_BYTES`, per-account quota `MAPS_MAX_PER_USER`, and
  `RATE_MAP_*` limit spam/abuse.
- **Determinism unaffected.** A fetched community map enters exactly the same lockstep path as a
  local map (seed + map + settings). No replay/tamper-watch changes.
- **RLS & service role.** All writes go through the server; Supabase RLS prevents direct anon writes.

---

## 8. Tests (shipped)

`online/tests/online-server.test.ts` includes **"online server map repository"** tests covering:

- `sanitizeMap` validates + scrubs a map file (unit).
- Repo list returns 503 without DB config.
- Map download returns 503 without DB config.
- Map publish requires a session token.
- Map rate requires a session token.
- Map comment POST requires a session token.
- Map delete requires a session token.
- A burst of map uploads is rate-limited with `Retry-After`.

`shared/src/maps.ts` `validateMap` already has comprehensive coverage.

---

## 9. Remaining work (Planned / not yet implemented)

| Item | Status | Notes |
|---|---|---|
| Canvas minimap thumbnail | Planned / not yet implemented | Stretch from the original plan: `<canvas>` minimap thumbnail from `payload.tiles` using shared terrain colors + `brightness` (low-res preview). Not present in the shipped UI. |

---

## Related documents

- [16 — Netcode & Online](16-NETCODE-AND-ONLINE.md) — network stack, mod gate.
- [04 — Architecture](04-ARCHITECTURE.md) — deterministic sim and map ingestion.
- [06 — Data & Save System](06-DATA-AND-SAVE-SYSTEM.md) — local map library/IndexedDB.
