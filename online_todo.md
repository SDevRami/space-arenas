# Online Server — implementation plan

> Source: `future_todo.md` (vision) + the online-report (gap analysis). This file is the plan:
> each phase is a tracked unit of work with touch points and verification. Mark tasks `✅` as
> they ship and move completed-day records into `new_todo.md` per `AI-INSTRUCTIONS.md` rule 8.

---

## 0. Accepted architecture (decide before P1 — see §8 for open questions)

**Option C (recommended in the report):** a single Render-hosted Node app plays "channel for
game comms" exactly like the current LAN host does today, generalised to many rooms at once.
There is exactly **one production server region** — no region selector anywhere in the UI.

**Repo/folder split (decided):** **one GitHub repo** — `space-arenas` (this repo, pushed to
`https://github.com/SDevRami/space-arenas.git`). The online server + DB live in the
**`online/` folder** inside it:

- The **game repo** keeps the game (client + LAN host + `shared/` + `client/dist` assets). The
  `online/` subfolder is a self-contained server app (`src/`, `shared/` vendored,
  `supabase/migrations/`, `.env.example`). Render/Supabase connect to **this repo**, deploying
  only the `online/` service (Render `rootDir: online`); pushes to `main` auto-deploy the server
  and auto-apply DB migrations.
- The game **connects out** to the deployed server's `wss://` (relay) and `https://` (REST:
  rooms, auth, leaderboard, backups). The server never serves game files.
- `online/shared/` is a vendored copy of the game's `shared/`; run
  `node scripts/sync-online-shared.mjs` after any `shared/src` change (protocol bumps travel together).
- **Phase 1 scope cut (online only):** no server-side bots and no balance mods in online matches
  (the authoritative sim + bot AI are client code the server deliberately does not ship; rooms
  return a clear "not supported online yet" error). These can be revisited later by vendoring the
  sim. LAN mode is untouched.

- The **host client creates the room** and supplies map / settings / mod / seed — hosting
  *decisions* stay on players' devices; Render only relays control + binary frames.
- Reuse the existing protocol & relay semantics: `host/src/rooms.ts` (`RoomManager`),
  `host/src/relay.ts` (`TickRelay`), `host/src/bots.ts` (`NetBotRunner`),
  `client/src/net/net.ts` (`NetClient`) — ported into the server repo.
- The server URL is fixed server-side (`SA_PUBLIC_URL` env / default to the deployed Render origin) —
  it is **never a user input** in the online UI. Only indicators of server/DB connection status are shown.
- The only hard constraint: the current `RoomManager` holds **one room per process**
  (`private room: Room | null`, `host/src/rooms.ts:59-60`) and `host/src/index.ts` is a
  single-room server. Generalising to a keyed registry is the P1 core.

Ground rules unchanged (AI-INSTRUCTIONS):
- Never commit secrets; all config via env vars (`SA_*`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `FREESOUND_TOKEN`-style policy).
- The wire protocol is versioned; add messages only with a protocol bump (`shared/protocol.ts`). Room *directory*/auth traffic is REST and does not touch the sim protocol.
- Rendering/sim rules untouched — online work is networking + persistence + UI only.
- i18n must land in `en.json` **and** `ar.json`.

---

## Phase 1 — Render deployment + multi-room server + real matchmaking

**Goal:** the `#online-panel` becomes functional; players can create, list, search and join
password-protected rooms over the Internet using the existing client protocol unchanged.

### 1.1 Scaffold the server (online/ folder) + deploy to Render via GitHub (auto-deploy on push)
- [x] **Scaffold present:** `online/` already has `package.json`, `tsconfig.json`, `src/index.ts` (health `/api/status`), `shared/` (vendored build of the game `shared/`), `supabase/migrations/001_init.sql`, `.env.example`. Typecheck + build clean.
- [x] **Phase 1 port:** generalize LAN `host/src` logic into `online/src/` — `RoomRegistry` (multi-room `Map<string, Room>`), per-room `TickRelay`, REST `/api/rooms*`, ws control routing per socket→room. `host/` stays untouched for LAN.
- [x] `render.yaml` at **repo root** with `rootDir: online`: build `npm install && npm run build`, start `npm start`, healthcheck `/api/status`, auto-HTTPS/wss. Client is not built/served here.
- [ ] **Connect the game repo to Render** (Render dashboard → New Blueprint → select `space-arenas`): every `git push` to `main` auto-deploys the `online/` service. Secrets/env from Render's dashboard vars, not the repo. *(manual dashboard step — pending Phase 1 ship)*
- [x] Runtime switch in `online/src`: `SA_MODE=online` enables public registry/lobby API; otherwise the API reports disabled (safe default).
- [x] Env vars documented in `.env.example` (no real secrets): `SA_MODE`, `SA_PORT`, `SA_PUBLIC_URL`, `SA_PASSPHRASE`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

### 1.2 `RoomRegistry`: many rooms (ported into `online/src/`)
- [x] `online/src/rooms.ts`: `RoomRegistry` holds `Map<string, Room>` keyed by room code; methods take the room (`createRoom`, `joinRoom`, `joinSpectator`, `reconnectPlayer`, `updateSlot`, `updateRoomOptions`, `assignSpawns`, `removePlayer`, `disconnectPlayer`, `hostReady` …). Reuses the LAN `Room`/`HostPlayer` shapes.
- [x] `online/src/index.ts`: per-connection room binding (`ws → roomId`); control handlers (`C_JOIN`, `C_READY`, …) resolve the room from the socket; relay per room (`Map<roomId, TickRelay>`); `endMatch`/`maybeStartMatch` operate on a room key.
- [x] Room lifecycle + expiry: REST-created rooms must receive a `C_JOIN` within `IDLE_ROOM_TTL` (30 s); the WS connection keeps the room alive; rooms empty for `EMPTY_ROOM_TTL` are closed; sweep runs every 10 s.
- [x] **No bots, no mods online (Phase 1):** `C_ADD_BOT`/`C_UPDATE_BOT`/`C_REMOVE_BOT` and non-empty `modId` return `H_ERROR 'not supported online yet'`.
- [x] Bump `PROTOCOL_VERSION` only if a control message actually changes shape — prefer none in P1 (messages are semantically identical, just routed).

### 1.3 Room directory + matchmaking API (REST, server-held, not in DB)
- [x] `GET /api/rooms` — snapshot of open rooms: `{ id, hostName, mapName, players, maxPlayers, status, passwordRequired, created }` (no `region` — single server).
- [x] `POST /api/rooms` (create) — body `{ hostName, mapId?, password }` (password optional/empty = public room) → `{ ok, roomCode }`; the creator then joins over ws.
- [x] `GET /api/rooms/search?q=` — lookup by host username **or** room id.
- [x] `POST /api/rooms/{code}/join` — light pre-check: room exists, not full/ended; returns `{ ok, ws: 'wss://…' }`. (Password is still fully validated by the existing `C_JOIN` passphrase-hash flow.)
- [x] Room expiry sweep (see §1.2) keeps the directory tidy; inventory is memory-only (heartbeats not persisted).

### 1.4 Online lobby panel wiring (`client/`)
- [x] `#online-panel` layout (top → bottom):
  1. Two buttons on the first row: **My Account** and **Server Setup** (i18n `online.myAccount` / `online.serverSetup`).
  2. Below them: **search bar** + the **live rooms table** from `GET /api/rooms`.
  3. Below the table: **Join** / **Create** buttons — both use the existing LAN match panels (Create opens the LAN create overlay which includes a password field; Join opens a password popup for protected rooms); password comes from the popup.
- [x] **My Account** button (`#account-overlay`) → popup holding the account inputs (username / email / password — wired in Phase 2). Username mirrors to `#online-name` (the `applyProfileName` + field-input mirrors at `main.ts`).
- [x] **Server Setup** button (`#server-overlay`) → popup that shows **status only**: live + green/red indicator for **server connection** (pings `/api/status`) and a "Phase 2" indicator for **DB**. No input fields for server/DB URLs — the URL is fixed server-side, never editable in the UI.
- [x] Rooms table renders live from the registry (`renderOnlineMatches()`), not a placeholder row; search filters by host username or room id client-side.
- [x] **Server origin** is bundled into the game client via Vite build-time `VITE_SA_ONLINE_URL`, defaulting to `http://127.0.0.1:17321` (the online server's default port) so dev works out of the box; production builds set it to the deployed Render origin. The game client never contains server code — it just points at this URL.
- [x] **Join** handler reuses `connectJoin(addr, code, pass, name)` (which now also accepts full `wss://` addresses); password comes from the popup.
- [x] i18n: new keys in `en.json` + `ar.json` under `online.*`.
- [x] No region select anywhere in the online panel (deferred to future multi-zone deployment — out of scope).

### 1.5 Verification
- [x] `npm run typecheck` (all workspaces) + `online` `npm test` (8 integration tests: status, create/list/search/join pre-check + 503-disabled, live 2-player ws lobby, wrong-passphrase reject). Client + online builds green.
- [ ] Determinism untouched: matches still tick from a seeded relay — run a 2-client online match with the old client bundle targeting the deployed `/ws`. *(after deploy)*
- [ ] Reconnect/spectator paths (`RECONNECT_GRACE_MS`, `S_SPECTATE_SYNC`) behave identically across rooms. *(after deploy)*
- [ ] Manual lobby test on the deployed URL. *(after deploy)*

---

## Phase 2 — Accounts, online profiles, leaderboard

**Goal:** email/password accounts (Supabase Auth) + "Quick match / Leaderboard" sub-tabs.

### 2.1 Supabase project bootstrap (GitHub-linked migrations, in the `online/` folder)
- [ ] **Connect Supabase to the game repo** (Supabase → Project → Settings → Integrations → GitHub): migrations path `online/supabase/migrations`, auto-apply on push. *(manual dashboard step — needed before live DB)*
- [x] Tables (`001_init.sql` + `002_match_records.sql` in `online/supabase/migrations/`): `profiles (user_id uuid pk, username unique-ci, games, wins, high_score)`, `matches (id, map, winner, started_at, participants jsonb, score jsonb)`, `leaderboard (user_id, score, rank, username)` with RLS (profiles/leaderboard readable, profiles own-row writes, service-role writes for matches/leaderboard).
- [x] Row-level security: profiles readable, own-row writes; leaderboard readable.
- [x] Server-only client (service-role key via env) for lookups the anon key must not see.
- [x] Secret keys never committed: `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` live only in Render env vars (or `.env.example` placeholders); `online/supabase_keys.txt` is gitignored.

### 2.2 Auth endpoints on the host (`/api/auth/*`)
- [x] `register` / `login` / `change-password` — proxy to Supabase Auth (email + password), return session token (server returns it over the API; client keeps it in sessionStorage, never logged). Registration uses the admin users API with `email_confirm: true` (no confirmation emails).
- [x] `GET /api/auth/me` — Bearer-token profile lookup (also used by the server to bind a joined slot to an account via `C_JOIN.token`).
- [x] Token persisted in client sessionStorage only; username mirrored into `#online-name` via `applyAuthUsername`.
- [x] Graceful degradation: with `SUPABASE_*` env missing, auth/leaderboard endpoints return 503 `{ error: 'database not configured' }` and roaming still works.

### 2.3 Lobby account + extra tabs
- [x] **My Account** popup full auth UI: register / login / change-password / logout; status line; logged-in summary (games/wins/best). Session restored from sessionStorage and re-validated via `/api/auth/me`.
- [x] `#online-panel` gains secondary tabs **Matches / Leaderboard** beside the rooms table; Refresh button shared.
- [x] **Leaderboard**: `GET /api/leaderboard` → table of rank/user/score; own row highlighted + `(you)`; i18n en+ar.
- [x] Match results: client reports `C_GAME_OVER` with per-team `scores`; server records the match + profile `games`/`wins`/`high_score` (server-side, trusted source), keyed by the account bound to each slot at join.
- [x] **Server Setup** popup shows DB indicator (`/api/status` → `db: true/false`); still no URL input fields.

### 2.4 Verification
- [x] `npm run typecheck` (shared/online/client) + `npm test -w online` (14 tests incl. DB-unconfigured 503/401 paths) + client build green.
- [ ] Register → login → change password round-trips against Supabase (test env project). *(after Render env vars + migrations applied)*
- [ ] Leaderboard reflects a completed 2-player match. *(after deploy)*

---

## Phase 3 — Data backup with expiry + abuse hardening (Data tab)

**Goal:** move a player's game (dev-settings + local profile) to another PC via encrypted,
expiring backup blobs, plus a rate-limit layer so public write endpoints (auth, room create,
backups, and later P4 comments/ratings) stay abuse-resistant. Nothing else is stored on the DB.

**Decided:** TTL **7 days** (player sees the expiry countdown + date in the UI); per-account
**quota** (max 10 backups, ≤ 64 KB each); **Web Crypto AES-GCM** client-side encryption
(PBKDF2 passphrase → key, random salt+IV; only ciphertext touches the server).

- [ ] `003_backups.sql`: `backups (id uuid pk default gen_random_uuid(), user_id uuid not null ref profiles(user_id), kind text check (kind in ('devsettings','profile')), payload text not null, passphrase_hash text not null, created_at timestamptz not null default now(), expires_at timestamptz not null)` + index on `expires_at` (purge) and `user_id`.
- [ ] `POST /api/backups` (auth) — body `{ kind, payload, passphraseHash }`; stores with `expires_at = now + 7 days` (TTL constant `backups.ttlDays`, `online/src/config.ts`); quota: row count ≥ 10 → 409, payload > 64 KB → 413; returns `{ ok, id, expiresAt }`.
- [ ] `GET /api/backups` (auth) — my backups list (id, kind, created, expires, expired?).
- [ ] `GET /api/backups/{id}` (auth, ownership-checked) — payload unless expired (410) or `passphraseHash` mismatch (403).
- [ ] `DELETE /api/backups/{id}` (auth, ownership) — used from the UI.
- [ ] Expired purge: sweep every 10 min (pattern of the room TTL sweep) + skip-on-read.
- [ ] Client encryption: AsyncCrypto helper (AES-GCM + PBKDF2, salt/IV stored beside ciphertext in `payload`); `passphraseHash = sha256(passphrase)` lets the server reject wrong passphrases without shipping blobs.
- [ ] "Data" tab UI (online panel, visible when logged in): list my backups with kind + expiry countdown ("expires in N days · DATE") — the TTL feedback the player asked for; upload Dev-settings / upload Profile buttons with a "stored for 7 days" note; restore (asks passphrase, decrypts client-side, writes to the same storage keys dev-settings/profile use); delete.
- [ ] i18n en+ar (`backup.*` keys).
- [ ] **Rate limiting (zero-dep, in-memory sliding window, keyed by client IP):** shared helper `online/src/ratelimit.ts` applied to REST + ws. Limits: register/login/change-password **5/min/IP** (login also **10/min/account**), room create + join pre-check **10/min/IP**, ws handshake **20/min/IP**, backups POST **10/min/IP**, `/api/auth/me` + `/api/leaderboard` GET **60/min/IP**. Respond 429 `{ error, retryAfter }` + `Retry-After`; client i18n error; trust Render's `X-Forwarded-For` for the client IP (fallback to socket remote-address in dev). Reused unchanged by P4 comment/rating endpoints.
- [ ] Verification: online REST tests — auth-required, ownership, quota 409, size 413, TTL 7-day write then purge (unit), wrong passphrase 403, 429 after a burst. Client typecheck + build green. Manual: backup→restore round-trip on a second profile under the same account, expiry countdown visible.

---

## Phase 4 — Landing page + online mod repository

**Goal:** public game-info page at `/` served by Render + community mod repository
(browse / rate / download / vote / comment).

- [ ] Static landing page (HTML/CSS) at `/` (game at a sub-path like `/game/`): game info, system requirements, how-to-join, screenshots.
- [ ] Mod repository backed by DB: `mods (id, name, description, owner_id, size_bytes, downloads, rating_avg, rating_count, votes)`; file blob kept in existing `modStore` format (`/api/mods*` shape reused, `host/src/mods.ts` + `isValidMod` validation).
- [ ] `/api/mods/repo` (browse+filter), `/api/mods/{id}/rate` (1–5, one per user), `/api/mods/{id}/vote`, `/api/mods/{id}/comments` (list/post).
- [ ] Download = mod JSON via existing `/api/mods?name=`; client "Mods" tab gains an "Online repository" section reusing `fetchModByName` (`main.ts:594`).
- [ ] Landing page is not dependent on the game client; served by the `online/` Render service (same repo, future sub-route like `/` while the API stays under `/api/*`).
- [ ] i18n for the tab additions; verification: rate+comment appear for other users; download imports a valid `ModFile`.

---

## Phase 5 — Local replay save + anti-cheat baseline

**Goal:** per-client local replay saves; enforce the existing sync as the online anti-cheat floor.

- [ ] **Save replay (local):** button downloads the `ReplayData` blob (same shape `archiveStore` writes, `host/src/index.ts:157-182`) to a local file for each client; optional auto-save toggle. Existing server-side archive stays.
- [ ] **Anti-cheat baseline:** online matches mandate the already-built glue: dev-settings sync `C_DEV_SETTINGS` + `mergeMatchSettings`/`cloneDevSettingsFrom` (`main.ts:2858-2917`) and `BIN.CHECKSUM`/`RELAY_CHECKSUM` cross-check; host rejects settings deltas beyond a sanity window.
- [ ] Document that this is deterrence, not real anti-cheat (`docs/`).
- [ ] Verification: replay file replays on a clean machine; a tampered settings delta is rejected by the relay.

---

## Cross-cutting concerns
- **No secrets in repo** (AI-INSTRUCTIONS §1.7): Render env + Supabase keys via `.env.example` only.
- **Deployment model — one repo, `online/` folder, git push = deploy:**
  - **Game repo `space-arenas`** (pushed to `https://github.com/SDevRami/space-arenas.git`) holds the game *and* the self-contained `online/` server app.
  - Render links to this repo (Blueprint, `rootDir: online`) and Supabase links to the same repo (migrations path `online/supabase/migrations`); a `git push` to `main` auto-deploys the server and auto-applies DB migrations. Manual linking is one-time dashboard setup (never anything secret in the repo; `.env.example` documents the vars).
  - `shared/` stays the single source of protocol truth; `online/shared/` is the vendored copy (sync script `scripts/sync-online-shared.mjs`), and `PROTOCOL_VERSION` is bumped in both together.
- **i18n** always in `en.json` AND `ar.json`; new `online.*`/`leaderboard.*`/`backup.*`/`mods.*` keys.
- **Protocol**: no existing message changed; new zero-byte-flag messages get a `PROTOCOL_VERSION` bump + `tests/protocol.test.ts` round-trip.
- **Perf**: room directory uses REST+heartbeats (not tick-path allocations); never allocate in `TickRelay` hot loop.
- **Abuse**: every public endpoint and the ws handshake sits behind the shared in-memory rate limiter (`online/src/ratelimit.ts`, P3); quota + size caps on stored blobs; secrets only in env (AI-INSTRUCTIONS §1.7).
- **Tracker**: each shipped phase gets its Day section + summary row in `new_todo.md`.

---

## Status table

| Phase | Scope | Effort | Sim change? | Status |
|-------|-------|--------|-------------|--------|
| P1 | Render deploy · multi-room server · real matchmaking | L | No | □ |
| P2 | Accounts · profiles · leaderboard (Supabase) | M | No | ◐ code+verif done; live DB after deploy |
| P3 | Expiring data backups (Data tab) + rate limiting/abuse hardening | M | No | □ |
| P4 | Landing page · mod repository · ratings/comments | M | No | □ |
| P5 | Local replay save · anti-cheat baseline | S | No | □ |

---

## Open questions (blocking P1 kickoff — see report §7)

1. **Hoster position:** Option B/C (Render relays, host client supplies config) approved — or must the host *device* literally run the socket server over a tunnel?
2. **Password model:** one shared room password (like today's passphrase) or per-player credentials?
3. **Leaderboard source:** server-reported results at `H_GAME_OVER` (trusted) vs client self-report (MVP-simple)?
4. **Backup TTL:** fixed **7 days**, quota 10 rows / 64 KB per account, AES-GCM client-side encryption — **decided** (P3).
5. **Landing/game split:** game under `/game/` on the same Render app (matches current `CLIENT_DIST` static serving) ?