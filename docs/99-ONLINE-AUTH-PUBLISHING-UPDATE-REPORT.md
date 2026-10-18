# 99 — Online Auth, Publishing Gate & Landing UI Update (Report + Questions)

**Status:** Planned — not yet implemented. This is a report of the current state and questions to clarify before changes.

**Scope:** (1) env var to gate publishing mods/maps (server + client UI), (2) Google OAuth only + unique username enforcement with conflict resolution, (3) landing page changes (remove publishing entry, remove register button from landing; keep register/login only from game).

---

## 1) Current state (grounded in code)

### 1.1 Server (online/)

**Env/config**
- `online/src/config.ts`: reads `SA_RATE_ROOM_WRITE_PER_MIN`, `SA_RATE_ROOM_WRITE_PER_ACCOUNT_MIN`, `SA_RATE_WS_HANDSHAKE_PER_MIN`, `SA_CORS_ALLOW`. Defines rate limits incl. `RATE_MOD_REPO_PER_MIN=60`, `RATE_MOD_DOWNLOAD_PER_MIN=60`, `RATE_MOD_WRITE_PER_MIN=10`, `RATE_MAP_*` same; `MODS_MAX_PER_USER=20`, `MAPS_MAX_PER_USER=20`, `MOD_MAX_BYTES/MAP_MAX_BYTES=4*1024*1024`, `MOD_COMMENT_MAX_CHARS/MAP_COMMENT_MAX_CHARS=500`.
- `online/src/index.ts`: `SA_PORT` (17321), `SA_MODE` ('lan'|'online'), `SA_PUBLIC_URL` (null). Health/info: `GET /api/status` returns `{ ok, service, mode, protocol, minProtocol, rooms, players, registered, db }` (no `features` object).
- `online/src/supabase.ts`: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (service role used for admin ops). Uses plain REST (no `@supabase/supabase-js`).
- No dotenv import; no `.env` in repo; `online/.env.example` shows same vars + `SA_PASSPHRASE` (documented). `render.yaml` declares Render envs (including Supabase keys, SA_MODE=online).

**Auth/accounts**
- Endpoints: `POST /api/auth/register` (email+password+username), `POST /api/auth/login` (email+password), `POST /api/auth/change-password`, `GET /api/auth/me` (bearer). All rate-limited under `auth`/`loginAccount`.
- Validation: username trimmed, length 1–24 chars (`supabase.ts:53-54`). No regex. Case-insensitive uniqueness enforced by DB unique index `profiles_username_unique_key` on `lower(username)` (migration `002_match_records.sql:9`) and pre-check query returns `'username already taken'` (`supabase.ts:56-63`).
- Storage: Supabase Auth for accounts (created via service role `/auth/v1/admin/users`, `email_confirm: true`), `public.profiles` has `user_id (uuid pk fk auth.users)`, `username (text not null)`, `games,wins,high_score,int`, `created_at (timestamptz default now())`. RLS: profiles readable by all, insert/update only own.
- Passwords: delegated to Supabase Auth (admin create + password grant). No local password hashing.
- Sessions: bearer JWT from Supabase Auth; `verifySession` calls `GET /auth/v1/user` with Bearer (`supabase.ts:109`). WebSocket `C_JOIN` verifies session before admitting.
- Race condition note: pre-check + DB unique index; after upsert no explicit translation of unique violation to `'username already taken'` (pre-check reduces races).

**Publishing (mods/maps)**
- Mods: `GET /api/mods/repo` (read), `GET /api/mods/:id` (download, increments downloads), `POST /api/mods` (publish, auth), `DELETE /api/mods/:id` (auth/owner), `POST /api/mods/:id/rate` (auth), `GET /api/mods/:id/comments`, `POST /api/mods/:id/comments` (auth). Quota 20 per user; size 4MB; sanitize via `mods.ts` + shared validators.
- Maps: mirror endpoints under `/api/maps/*` same auth/quota/size rules.
- Auth required for write/rate/comment/delete. Reads are public. No existing gating flag.

### 1.2 Client (client/)

**Landing page (in-game lobby landing)**
- `client/index.html`: `#lobby-landing` (153–163) contains logo, title (`lobby.brand`), hint (`lobby.landingHint`), actions: `#lobby-open-menu` (`lobby.openMenu`) and `#lobby-landing-credits` (`lobby.credits`). No "Publishing" element, no "Register" element on landing.
- `client/src/main.ts`: `showLobby()`/`closeLobbyMenu()` manage landing; `openLobbyMenu()` sets tab to `offline`. `lobbyLandingCredits` opens menu and sets tab to `credits` (213–216).

**Login/register UI (game client)**
- Account overlay/dialog in `index.html` has `#account-register` (line 925), `#account-login`, `#account-change`, `#account-logout`, fields `#account-username`, `#account-email`, `#account-pass`, `#account-newpass`, status `#account-status`.
- TS (`main.ts`): `authPost`/`authApi` wrappers; `adoptToken` calls `GET ${ONLINE_URL}/api/auth/me`; register does `POST ${ONLINE_URL}/api/auth/register` then logs in via `POST ${ONLINE_URL}/api/auth/login`. Token stored in `sessionStorage['space-arenas:auth']` as `AuthSession { token,userId,email,username,... }`. `requireLogin(action)` opens account popup if not authed (used for publish actions).
- Base URL: `ONLINE_URL = ((import.meta.env.VITE_SA_ONLINE_URL as string|undefined)??'http://127.0.0.1:17321').replace(/\/+$/, '')`; configurable via server setup UI (`#server-address`).
- No OAuth UI; only email+password.

**Online panel tabs & publishing**
- Online sub-tabs: Matches/Leaderboard/Data/Mods/Maps (`#online-tab-mods`, `#online-tab-maps`, sections `#online-mods-section`, `#online-maps-section`). Controlled by `setOnlineTab()`. Tabs are always rendered (no disabled state driven by server config).
- Publishing UI: in Mods section `#mods-repo-publish-select`, `#mods-repo-publish`, `#mods-repo-publish-desc`; in Maps `#maps-repo-publish-select`, `#maps-repo-publish`, `#maps-repo-publish-desc`. `publishRepoMod()`/`publishRepoMap()` require login and call `authApi('POST','/api/mods'|'/api/maps')`.
- The game client landing has **no** publishing entry and **no** register button. Those exist only inside the online panel/account UI.

### 1.3 Other landing surface
- `online/public/index.html` and `online/public/app.js` form the online service landing/community page (separate from in-game lobby). The instruction says "remove publishing from the landing page..." — need to clarify which landing page is meant.

---

## 2) Proposed changes & questions

### (1) Gate publishing mods/maps behind env var; disable tabs/UI accordingly

**Goal:** Add a simple boolean env var (default false for first release) so players cannot publish unless enabled. When disabled, the Online panel Mods/Maps tabs should be disabled/hidden relative to the var, and server should reject publish attempts.

**Proposed approach (minimal, grounded):**
- **Server:** add env var, e.g. `SA_ENABLE_PUBLISHING` (default `false`). Parse in `config.ts`. Expose via `GET /api/status` (extend response with `features: { publishing: boolean }` or top-level `publishingEnabled`). Also enforce on write endpoints: `POST /api/mods`, `DELETE /api/mods/:id`, `POST /api/mods/:id/rate`, `POST /api/mods/:id/comments`, and corresponding maps endpoints → return `403 Forbidden` (with message like `'publishing disabled'`) when disabled. (Reads can remain allowed; repo browsing/downloads unaffected.)
- **Client:** on load/fetch of status (or dedicated endpoint), read `publishing` flag. In online panel: disable or hide `#online-tab-mods` and `#online-tab-maps` when disabled. Also disable publish UI controls (select/button/desc) and show a small notice (e.g. "Publishing mods and maps only from game" context) in those sections when disabled. The "publishing mods and maps only from game" message mentioned for landing (item 3) is separate from tabs.

**Questions (1):**
1. **Env var name and default.** Confirm: `SA_ENABLE_PUBLISHING` (string/boolean, default `false`) for first release? Any other name preferred?
2. **Where client learns it.** Extend `GET /api/status` to include `publishingEnabled` (or `features.publishing`) or add new `GET /api/features`? Since no features endpoint exists, extending `/api/status` is cheapest (already fetched by client). OK?
3. **Server behavior when disabled.** Should only publish/create/update/delete/rate/comment be blocked (403), or also any write? Reads (`GET /api/mods/repo`, `GET /api/mods/:id`, comments list) allowed? Quotas irrelevant when publishing disabled.
4. **UI treatment of tabs.** "Disable the tabs Mods and Maps relatively to the var" — prefer to disable (grey out, not clickable, `aria-disabled`) rather than hiding entirely? Or hide? Hiding is simpler but removes access to read-only repo; disabling keeps them visible but non-functional. Which behavior?
5. **Render env.** First deploy with value `false`; you'll flip to `true` later via Render env vars. No code change needed when flipping. Correct?

### (1b) Tester-only registration gate (new players)

**Goal:** Add server env var to control whether **new player account registration** is allowed. Login must remain unaffected. For first release, register only a small set of tester accounts; after testing, open registration to everyone.

**Proposed approach:**
- **Server env var:** `SA_TESTERS` (as requested). Treat as boolean truthy when `true`/`1`/`on`. **Default: `true`** (first release: only testers allowed to register). After testing period ends, set to `false` so everyone can register.
- **Scope:** Only affects **new account registration** (`POST /api/auth/register`). **Login** (`POST /api/auth/login`) and all existing sessions must remain unaffected regardless of this value.
- **Enforcement:** In `POST /api/auth/register` handler (online/src/index.ts), before creating account, if not allowed → return `403 Forbidden` with `{ ok: false, error: 'registration is currently restricted to testers' }`. 
- **Expose to client:** Add `testersOnly: boolean` (or `testers: boolean`) to `GET /api/status` so public landing and game client can show/hide register UI appropriately.
- **Notes:** "Testers" are just existing registered accounts (no separate tester role needed). The gate is a global switch to allow or block new registrations.

**Questions (1b):**
1. **Env var name/default.** Confirm `SA_TESTERS` default `true` for first release (testers only), then `false` after testing. Correct as requested?
2. **Message text.** What exact error message should the server return when registration is closed? (e.g. `'registration is currently restricted to testers'` or something else)
3. **Client UI.** On public landing and in game client account UI, when `testers`/`testersOnly` is false (open to everyone), show register flow. When true, hide the "Sign in with Google" registration path and show a small notice like "Registration is currently restricted to testers." Keep "Login" visible in both cases.
4. **Render env.** Set `SA_TESTERS=true` initially, flip to `false` after testing. No code change. Correct.

### (2) Google OAuth only + unique username enforcement + conflict resolution

**Goal:** Switch to Google OAuth only (no more username/password registration). Enforce unique username on account creation; if desired username taken, prompt user to choose another. On login, if username conflicts with another account (compare by creation date) force rename.

**Current:** email+password via Supabase Auth REST; app enforces case-insensitive uniqueness on profiles.username with pre-check + DB index.

**Proposed approach (high-level):**
- **Auth method:** use Supabase OAuth (Google provider). In game client, replace email+password forms with "Sign in with Google" flow. Since online server uses Supabase REST (no supabase-js in server), OAuth flow can be handled via Supabase Auth OAuth endpoints or via the client obtaining session from Supabase and then adopting token to the online server (online server already accepts Supabase access tokens via `GET /auth/v1/user`). Need to clarify flow.
- **Username assignment:** on first OAuth login, account may have no profile username. Need to prompt for a unique username (1–24, case-insensitive unique). Validate against existing profiles; if taken, ask again.
- **Uniqueness enforcement on creation:** same DB constraint (lower(username) unique). Server-side check on setting username (new endpoint: `POST /api/auth/set-username` or extend auth flow) returning `'username already taken'` on collision.
- **Conflict resolution on login:** "make the server check for the player user name when login if he has an existing user name for any reason so the server compare it with the other user name date of account creation so the new one get prompted to change his user name". This implies: when a session is established, if the profile.username conflicts with another profile's username (case-insensitive equal) AND this profile's `created_at` is newer than the older one(s) causing conflict, we must force the newer account to choose a new username. Also need to define "conflict" case (maybe same string). Also what if the older account's username was changed later? The rule is ambiguous.

**Questions (2):**
1. **OAuth provider:** Google only. Confirm Supabase project has Google OAuth configured (redirect URLs for game client + online landing)? Do you want OAuth flow in the **game client** (in-game lobby) only, or also in `online/public` landing?
2. **Deprecate email/password:** Remove register/login forms that use email+password. Keep `change-password`? Probably not needed for OAuth. Also existing email/password accounts — should they remain functional, or be migrated/disabled? First release going forward is Google-only.
3. **Username prompt timing:** On first Google sign-in (no profile username), show a modal/dialog in game client to choose unique username before proceeding. Correct?
4. **Username policy:** Keep 1–24 chars, case-insensitive unique. Any disallowed chars (spaces? symbols)? Current server only trims and checks length; DB unique on lower(username). Client LAN uses 16-char max — account username is server-side (24). Any change to allowed chars?
5. **Conflict resolution rule (precise):** "compare it with the other user name date of account creation so the new one get prompted to change his user name". Interpret as: at login time, if profile.username equals some other profile.username ignoring case, and this profile.created_at > other.profile.created_at (newer account), then force username change for this account. Also if equal timestamps? Unlikely. Correct? Or do we also need to handle the case where the "existing" username is the one that should win? Also what action on the older account? Probably leave older account's username as-is.
6. **Server endpoint for username change:** Need `POST /api/auth/username` (auth required) that sets username only if unique (case-insensitive) and returns error if taken. Also the conflict check runs on `GET /api/auth/me` and login — if forced rename needed, return a specific error/code (e.g. `needsUsernameChange`) so client prompts.
7. **Migration path:** Any existing accounts with duplicate usernames in practice? Probably not given DB index. But if conflict rule is applied, we need to identify which is newer by created_at. Yes, profiles has `created_at`.

### (3) Landing page changes

**Goal:** "remove publishing from the landing page and replace it with message box 'publishing mods and maps only from game' , also remove the register button from landing page and keep it only from game and the landing page only have login flow"

**Current landing (game client):**
- `#lobby-landing` has Open Menu + Credits. No Publishing, no Register. So game client landing already has no Register and no Publishing. That matches "keep it only from game" for register — so game client is fine as-is? Or do you want to change something else?

**Other landing:**
- `online/public/index.html` / `app.js` is the online service landing page (separate site). That page likely has Login/Register and possibly links to publishing/community. The instruction says "landing page" generically — need to clarify which one(s).

**Questions (3):**
1. **Which landing page?** Is this the in-game lobby landing (`client/index.html` `#lobby-landing`) or the online service landing page (`online/public/*`), or both?
2. **If in-game landing:** currently no Register/Publishing — so maybe just add a message box on landing? "replace it with message box 'publishing mods and maps only from game'". Where? On the landing screen (below hint or in place of something)? The landing currently has hint + two buttons. Do you want to add that message text?
3. **If online/public landing:** remove publishing entry and register button there; keep only login flow. That page has its own UI (`online/public/app.js`, ~81KB). Need to identify elements there.
4. **Login flow scope:** "landing page only have login flow" — does that mean Google login only, and account creation happens post-login via username prompt (as in 2)?

---

## Next steps

Answer the questions above. Then I'll implement in order: (1) publishing gate + tester-only registration (server + client), (3) landing UI changes (for the specified landing page), (2) OAuth + username enforcement/conflict resolution. All changes will be code-grounded and minimal.
