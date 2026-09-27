# 13. Map Publishing — Plan

**Status:** proposed (not implemented) · **Scope:** let players publish their custom maps to the
community, mirroring the existing balance-mod repository (browse / rate / download / publish / delete).
This doc is the plan; it deliberately reuses the Phase 4 mods pipeline end to end.

---

## 1. Goal

Today custom maps are **local-only**: the map builder saves `MapData` JSON into IndexedDB and can
export/import a `.json` file (`client/src/mapbuilder/`). There is no way to share a map with other
players. This feature adds a **community map repository** so any signed-in player can:

- publish a custom map (with a short description),
- browse/search/sort the repository (newest, best-rated, most downloaded, by player count),
- download maps and load them straight into the map builder / lobby, and
- rate and comment on published maps (owner can delete).

Design principle: **parity with mods**. Where the mods pipeline already solves a problem
(validation, sanitization, rate limits, RLS, quota, naming), the maps pipeline reuses the exact same
pattern. Nothing about determinism or match verification changes — maps are data-only inputs that
already flow through `validateMap` before any match is created.

---

## 2. Asset: `MapData` (already well-defined)

- Format: `shared/src/maps.ts:41` — `MapData` (`format: 'space-arenas-map'`, schemaVersion 1,
  name/description/author/mapVersion, width/height, `tiles[]`, optional `groundColors[]`,
  `brightness`, `obstructions`, `supplyFields`, `oilFields`, `spawnPoints`, `credits`).
- Validation: `validateMap(map)` at `shared/src/maps.ts:112` — already rejects bad formats,
  out-of-range sizes (16..256), tile-length mismatch, spawn counts (2..`DEFAULT_MAX_PLAYERS`),
  missing supply fields, out-of-bounds objects, negative credits, bad brightness. **Client and
  server share this one function**, so a map that passes upload validation is guaranteed loadable
  by the client's existing import path.
- Client pieces already present: export to `.json` (`builder.ts:139 exportSelectedMap`, the
  `#mb-export` button), import from `.json` (`builder.ts:155 importMapFile`), IndexedDB library
  (`mapbuilder/library.ts`), minimap preview (`ui/map-preview.ts`).

---

## 3. Client changes

1. **Publish entry point** — a "Publish" button in the map builder for the currently selected map.
   Shows a small modal asking for a short description (1–160 chars, matching mods). On submit:
   - `POST {SA_ONLINE_URL}/api/maps` with the `MapData` JSON + `{ description }`,
     `Authorization: Bearer <session>`.
   - Handle responses: 201 (done), 401 (login required), 409 (name already taken),
     413 (too large), 400 (invalid map / empty description), 429 (rate limited) + 503.
   - Show the standard online-error toast (same pattern the mods publish modal uses).
2. **Import published maps** — reuse the existing `.json` import + `validateMap` gate; no new code
   needed. Optionally add "Download" buttons inside the builder's lobby map picker later (Phase B).
3. **i18n** — add `mapbuilder.publish*` keys to `client/src/i18n/lang/en.json` and `ar.json`
   (title, description prompt, success, failure, admin-delete notes).

---

## 4. Online server changes

### 4.1 New module `online/src/maps.ts` (mirror of `mods.ts`)

- `MAP_MAX_BYTES = 4 * 1024 * 1024` — worst case is a 256×256 map (65 536 tile ints ≈ 300 KB raw);
  4 MB is generous headroom. Same constant as mods for consistency.
- `MAPS_MAX_PER_USER = 20` — same quota as mods.
- `sanitizeMap(json, expectedUser)` → re-validates with `validateMap`, forces `format` and
  `schemaVersion` to the known-good values, runs `scrubName` (reuse the mods scrubber) on
  `name`/`author`/`mapVersion` and caps `description` at 160 chars. Returns `MapData | null`.
- `mapMetrics(map)` → `{ width, height, players: spawnPoints.length }` for the payload-free list.

### 4.2 Routes in `online/src/index.ts` (mirror of `handleMods`)

| Method & path                 | Auth | Rate-limit bucket | Purpose |
|---|---|---|---|
| `GET /api/maps/repo?q&sort&owner&limit` | none | `mapRepo` | payload-free list (newest/rating/downloads/players sort) |
| `GET /api/maps/:id`           | none | `mapDownload` | returns **raw `MapData`** so the client's existing import path consumes it; bumps `downloads` (same as mods) |
| `POST /api/maps`              | session | `mapWrite` | publish (validate → 400; >4 MB → 413; name dup → 409; quota → 409; unauth → 401) |
| `DELETE /api/maps/:id`        | session | `mapWrite` | owner-only delete (403 for others, 404 missing) |
| `POST /api/maps/:id/rate`     | session | `mapWrite` | rating 1–5, one per user (upsert) |
| `POST /api/maps/:id/comments` | session | `mapWrite` | comment 1–500 chars |

Consistent with mods: `GET` downloads are public and rate-limited; all writes are
session + `RATE_MAP_*_PER_MIN` limited; CORS allow-list unchanged.

---

## 5. Database — `online/supabase/migrations/005_maps.sql`

Clone of `004_mods.sql`, idempotent:

- `public.maps` — `id uuid pk default gen_random_uuid()`, `owner_id` → `auth.users` (cascade),
  `name text not null` + `unique index on lower(name)`, denormalized `meta_author`,
  `meta_description`, `meta_version`, `size_bytes`, `width`, `height`, `players`,
  `require_protocol`, `payload jsonb`, `downloads int default 0`, `created_at`.
  Indexes on `created_at desc`, `downloads desc`, `rating`-supporting (`players`, `owner_id`).
- `public.map_ratings` — `(map_id, user_id)` PK, `rating smallint check 1..5`.
- `public.map_comments` — `body text check (char_length between 1 and 500)`.
- RLS identical to mods: reads by all, writes service-role only (all writes flow through the
  Render server after sanitization).

---

## 6. Landing page (`online/public/`)

- `community.html` gets a **two-tab community hub: Mods | Maps**. Default tab remains Mods.
  Tab switching is a show/hide of two existing-style list sections (same card CSS).
- New `loadCommunityMaps()` in `app.js` mirroring `loadCommunity()`: fetch `SA_ONLINE_URL/api/maps/repo`,
  client-side TTL cache (same ~5 min), handle 503/offline with the existing "repo unavailable" copy.
- Map cards: name, author, player count + grid size chips, description, ★ rating, downloads,
  Publish date; context menu with **Delete** for owner (and the same admin/moderator affordance mods
  have today, if any — parity).
- i18n: add `community.maps.*` keys to both EN and AR dicts in `app.js`.
- Stretch (optional, later): `<canvas>` mini-map thumbnail from `payload.tiles` using
  `shared` terrain colors + `brightness` — reuse the client's minimap idea at low res.
- README: add this doc to the Quick Links table and update the layout note (`docs` 01–12 → 01–13).

---

## 7. Security & fairness notes

- **Data-only, no rules surface.** Maps carry terrain/objects/spawns/credits, never economy or unit
  numbers — the balance-mod API already owns those; no new sanitization surface beyond `validateMap`.
- **Server re-validates.** Even though the client validates before publish, the server runs the same
  `shared` `validateMap` + scrub, so hostile/broken uploads never reach other players' libraries.
- **Size cap + rate limits** reuse the existing buckets, preventing repo spam.
- **Determinism unaffected.** Matches already derive simulation from `MapData` + seed; a fetched
  community map enters exactly the same lockstep path as a local one. No replay/tamper-watch change.

---

## 8. Tests

- `online/test/maps.e2e.test.ts` (mirror of the mods spec):
  publish invalid map → 400; empty description → 400; name collision → 409; quota → 409;
  no session → 401; oversize → 413; repo list sorting/filter; download bumps count and returns raw
  `MapData`; rating upsert range 1–5; comments 1–500; owner deletes, non-owner → 403; lender CORS.
- `shared` — `validateMap` already covered; add cases for the `maps` sanitizer/scrubber in `maps.ts`/`mods.ts` style.
- Client — builder publish button smoke test (mock `fetch`), existing import path untouched.
- Manual verification checklist: publish → appears in repo (EN+AR), download → loads in builder,
  delete as owner, rate/comment round-trip, 429 after hammering, 503 with database unconfigured.

---

## 9. Rollout

1. `005_maps.sql` in Supabase SQL editor (idempotent).
2. `online/src/maps.ts` + routes + `005` policy tests; deploy Render (env unchanged).
3. Client publish modal + i18n; `npm run build` + vitest (`client`, `online`, `shared`).
4. Landing tabs + `loadCommunityMaps()` + i18n; `node --check`, key-coverage + render scripts.
5. Update `done_list.md`; commit & push (Pages auto-deploys `online/public`).