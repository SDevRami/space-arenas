# 16 — Netcode & Online

**Status:** Shipped. Space Arenas is a **deterministic lockstep** RTS: every peer runs the identical
simulation from an identical seed + command stream, and only commands and state hashes cross the
wire. Two server roles exist — the **LAN host** (`host/`) and the **online server** (`online/`) —
both acting as pure relays (neither runs an authoritative world), with the online server adding a
Supabase-backed account, leaderboard, mod, map and backup stack.

This document is the code-grounded reference for the network layer: the tick model, the wire
protocol, room/seat lifecycle, the settings and mod gates, spectators, reconnection, desync
detection, replays, and the online account/leaderboard system. Anti-cheat specifics live in
[12 — Online Anti-Cheat](12-ONLINE-ANTI-CHEAT.md); the map repository lives in
[13 — Map Publishing](13-MAP-PUBLISHING-PLAN.md).

---

## 1. Overview

### 1.1 The two server roles

| Role | Workspace | Process | Authoritative sim? | Persistence |
|---|---|---|---|---|
| LAN host | `host/` | Node (`node:http` + `ws`) | No — pure relay, **plus** a private bot sim | Local disk (`archive/`, `mods/`, `invites/`, `profile/`) |
| Online server | `online/` | Node (`node:http` + `ws`) | No — pure relay | Supabase (Postgres) + Render env |

- The **simulation itself** lives in `client/` and `shared/` and runs on every peer
  (`client/src/core/Simulator.ts`, `client/src/systems/*`). The servers never simulate a human
  match.
- The LAN host is the only place that **does** simulate: `host/src/bots.ts` (`NetBotRunner`) wraps a
  real `Simulator` + `BotPlayer` so AI opponents can be relayed as deterministic commands. The
  online server explicitly has no bots (`C_ADD_BOT` → `"Bots are not supported in online matches yet"`,
  `online/src/index.ts`).
- `PROTOCOL_VERSION` is defined in `shared/src/constants.ts` and vendored into the online service by
  `scripts/sync-online-shared.mjs` (see §3.4).

### 1.2 Shared protocol surface

| File | Responsibility |
|---|---|
| `shared/src/protocol.ts` | Command/control message types, binary encode/decode, byte validation, `crc32`. |
| `shared/src/constants.ts` | `SIM_TICK_HZ`, `PROTOCOL_VERSION`, `DEFAULT_PORT`, `DEFAULT_MAX_PLAYERS`, `MatchSettings`, `mergeMatchSettings`, `WIN_RULES`. |
| `shared/src/settings-file.ts` | `profile/settings.json` layers + `fingerprintSettings` + client-settings scrub. |
| `shared/src/mod.ts` | Balance-mod format, validation, `modHash`, `modSettingsDelta`, `canonicalJson`. |
| `shared/src/replay.ts` | `ReplayData`, `validReplay`, `defaultReplayName`. |
| `shared/src/maps.ts` | `MapData`, `validateMap`, map presets. |
| `client/src/net/net.ts` | `NetClient` — the WebSocket client + callbacks. |
| `client/src/net/crypto.ts` | `sha256Hex`, AES-GCM + PBKDF2 helpers for cloud backups. |
| `host/src/index.ts` | LAN HTTP API, WS `/ws`, relay wiring, bots, discovery, static serving. |
| `host/src/relay.ts` | `TickRelay` — LAN frame batching + broadcast. |
| `host/src/rooms.ts` | `RoomManager` — the single LAN room, seats, spawns, settings/mod merge. |
| `online/src/index.ts` | Online HTTP API + WS `/ws`, auth gate, protocol-violation gate, room sweep. |
| `online/src/relay.ts` | `TickRelay` — online frame batching + broadcast (no bots). |
| `online/src/rooms.ts` | `RoomRegistry` — multi-room seats, mod ack, spawns, settings/mod merge. |

---

## 2. Deterministic lockstep

### 2.1 The tick

- The sim runs at **25 Hz**: `SIM_TICK_HZ = 25` and `SIM_TICK_MS = 1000 / 25 = 40` ms
  (`shared/src/constants.ts`).
- All timing constants are derived from ticks via `SECONDS_TO_TICKS` so the sim only ever reasons
  about integer ticks — the basis of determinism.
- The world is created from a **seed** (server-generated, `newSeed()` in
  `host/src/passphrase.ts` / `online/src/passphrase.ts`) plus a **map** and the resolved
  **match settings**. Identical seed + map + settings + command stream ⇒ identical world.

### 2.2 Command flow, tick by tick

1. **Input → command.** The client turns player input into a `SimCommand`
   (`Client/src/core/Simulator.ts` / `client/src/game/Game.ts`) and batches it through
   `Game.issueBatch(cmds)`, which assigns the per-client `seq` and wraps it in an
   `EnvelopeCommand { player, seq, tick, cmd }`.
2. **Client → server.** `NetClient.sendCommand(env)` sends `encodeCmd(env)` as a binary WS message
   tagged `BIN.CMD`.
3. **Stamp.** The relay's `TickRelay.submit(ws, data)` looks up the socket's slot, ignores
   spectators, decodes the envelope, and **re-stamps** it with the authoritative `player` id and the
   relay's current `tick` before pushing it to the pending list and the `history` log.
4. **Batch.** A `setInterval(..., 40)` timer (one sim tick) fires `broadcastFrame()`:
   - (LAN only) drains `NetBotRunner.commandsForTick()` into the pending list;
   - sorts pending commands by `player`, then `seq`;
   - encodes one `BIN.FRAME` (tick + concatenated envelopes);
   - sends it to every connected slot.
5. **Server → client.** `NetClient.onMessage` sees `BIN.FRAME`, calls `decodeFrame`, and dispatches
   `onFrame(tick, commands)`.
6. **Apply.** `Game.applyFrame(tick, commands)` records the commands into `recordHistory` (for a
   local replay) and calls `stepToFrame`, which advances the local world exactly once per tick. If
   the world is not built yet, frames queue in `frameQueue` (capped at 5000) and are drained later.

Consequences that fall out of this design:

- **The relay never reads game state.** It only sees opaque command envelopes; the sim is rebuilt
  on every peer.
- **A command is stamped with the tick it arrived at the relay**, not the client's claimed tick, so
  peers can't rewind/forward the shared timeline.
- **Ordering is deterministic** (`player` then `seq`), so every peer applies the same commands in the
  same order within a tick.

### 2.3 Frame batching & ordering

`host/src/relay.ts` and `online/src/relay.ts` are near-identical `TickRelay` classes:

- `pending: EnvelopeCommand[]` — commands collected since the last broadcast.
- `history: EnvelopeCommand[]` — the full match log, used for late-join / resume sync (§9, §10) and
  for the host's replay file (§12).
- `broadcastFrame()` sorts `(a, b) => a.player - b.player || a.seq - b.seq`, encodes the frame, and
  sends it to every `connected` slot.
- `currentTick` is exposed so a resuming/spectating client can be fast-forwarded.
- `submitForfeit(playerId)` injects a synthetic `forfeit` command with a **high seq base**
  (`0x80000000 + n`) so a server-forced surrender sorts after that player's own commands.

---

## 3. Wire protocol

### 3.1 Transport

One WebSocket per client at path `/ws` (`new WebSocketServer({ server, path: '/ws' })`). Two frame
kinds travel over it:

- **TEXT frames** = JSON control messages (`encodeControl` / `decodeControl`).
- **BINARY frames** = tagged binary payloads; the first byte is a `BIN` tag.

`BIN` (`shared/src/protocol.ts`):

| Tag | Name | Meaning |
|---|---|---|
| `1` | `BIN.CMD` | One command envelope, client → relay. |
| `2` | `BIN.FRAME` | A tick's worth of commands, relay → clients. |
| `3` | `BIN.CHECKSUM` | One client's state hash for a tick, client → relay. |
| `4` | `BIN.RELAY_CHECKSUM` | Relay-stamped state hash, relay → clients. |

Clients never legitimately send `FRAME` or `RELAY_CHECKSUM`; the online server treats those as
protocol violations (§11).

### 3.2 Binary layouts

| Payload | Encoding | Layout |
|---|---|---|
| Command envelope | `encodeEnvelope` / `decodeEnvelope` | `u8 typeId`, `i32 tick`, `u8 player`, `u32 seq`, `u16 entityCount`, `i32[entityCount] entities`, `i32 x`, `i32 y`, then type-specific fields (`encodeEnvelope`). |
| Command frame | `encodeCmd` | `u8 BIN.CMD` + envelope body. |
| Frame | `encodeFrame` / `decodeFrame` | `u8 BIN.FRAME`, `i32 tick`, then concatenated envelopes (decoded by walking `envelopeLength`). |
| Checksum | `encodeChecksum` / `decodeChecksum` | `u8 BIN.CHECKSUM`, `i32 tick`, `u32 crc` (9 bytes). |
| Relay checksum | `encodeRelayChecksum` / `decodeRelayChecksum` | `u8 BIN.RELAY_CHECKSUM`, `u8 player`, `i32 tick`, `u32 crc` (10 bytes). |

All multi-byte fields are little-endian. `crc32` uses the standard `0xedb88320` reflected
polynomial (`shared/src/protocol.ts`).

Type-specific tail fields (all in `encodeEnvelope` / `envelopeLength`):

| Command group | Extra bytes |
|---|---|
| `ping` | `u8 pingType` |
| `place` / `queue` | `u16 len` + name bytes (`buildingType` / `unitType`) |
| `research` | `u16 len` + `upgrade` |
| `sw-choose` | `u16 len` + `choice` |
| `dequeue` / `dequeue-research` | `u8 index` |
| `reorder-queue` | `u8 index`, `u8 to` |
| `attack-move` / `attack` / `build` / `collect` / `assign-dock` / `keep-attack` / `guard` / `remove-mine` / `repair-unit` / `transport-load` | `i32 target` (or `transportId`) |
| `transport-unload` | `i32 transportId`, `i32 index` |
| `set-auto-fire` | `u8 autoFire` |
| `set-formation` | `u8 spreadCode`, `u8 relative` |

### 3.3 Control message catalog

These are the JSON control messages (`ControlMessage` in `shared/src/protocol.ts`).
Direction: **C_ = client → server**, **H_ = server → client**, **S_ = server → client (match
payload)**. "LAN" = `host/`, "Online" = `online/`.

| Kind | Direction | Purpose | LAN | Online |
|---|---|---|---|---|
| `C_JOIN` | client → server | Join/rejoin a room: `roomCode`, `passphraseHash`, `name`, `clientId`, `spectator?`, `token?`, `protocol?`. | Yes | Yes (token required) |
| `H_LOBBY` | server → client | Full lobby snapshot: your id, host id, `players[]`, map, settings, win rule, defaults hash/layers, optional `mod`. | Yes | Yes |
| `C_READY` | client → server | Toggle your ready flag. | Yes | Yes |
| `C_UPDATE_SLOT` | client → server | Change your name/team/spawn/color. | Yes | Yes |
| `C_DEV_SETTINGS` | client → server | Publish your dev-settings layer, `defaultsHash`, and client-only values. | Yes | Yes |
| `C_UPDATE_ROOM` | client → server | Host-only: map/mapId, password, settings, winRule, `mod`/`modId`. | Yes | Yes |
| `C_ADD_BOT` / `C_UPDATE_BOT` / `C_REMOVE_BOT` | client → server | Host-only bot management. | Yes | Rejected |
| `C_START` | client → server | Host starts the match (gated — see §7/§8). | Yes | Yes |
| `C_MOD_ACK` | client → server | Online: "I have the room mod" — `hash` must match the room. | No | Yes |
| `H_ERROR` | server → client | Human-readable error toast. | Yes | Yes |
| `S_MATCH_START` | server → client | Match descriptor: `protocolVersion`, `seed`, `tickRate`, `map`, `players`, host/your ids, `spectator?`, `resumed?`, `settings`, `winRule`. | Yes | Yes |
| `C_LOADED` | client → server | "My world is built" — counts toward the start quorum. | Yes | Yes |
| `H_GAME_OVER` | server → client | Winner id (or null draw). | Yes | Yes |
| `C_GAME_OVER` | client → server | Client report: `winner` + optional per-team `scores` (online uses these for stats). | Yes | Yes |
| `H_PLAYER_STATE` | server → client | Updated mid-match `players[]` (post-forfeit/kick). | Yes | Yes |
| `C_CHAT` | client → server | Send `all`/`team` chat (trimmed to 300 chars). | Yes | Yes |
| `H_CHAT` | server → client | Relayed chat line (`from`, `name`, `text`, `target`, `team`, `ts`). | Yes | Yes |
| `S_SPECTATE_SYNC` | server → client | `currentTick` + full command `log[]` for late-join/resume fast-forward. | Yes | Yes |
| `H_SETTINGS_ALERT` | server → client | Tamper watch: a non-spectator changed settings mid-match (offender + host). | No¹ | Yes |
| `C_SETTINGS_VERDICT` | client → server | Host-only verdict on an alert: `kick` or `skip`. | No¹ | Yes |
| `C_PING` | client → server | Liveness / RTT probe. | Yes | Yes |
| `H_PONG` | server → client | `C_PING` answer. | Yes | Yes |
| `C_FORFEIT` | client → server | Immediate surrender (forfeits the slot to the relay). | No² | Yes |

¹ The tamper watch (`H_SETTINGS_ALERT` / `C_SETTINGS_VERDICT`) is wired **online-only**
(`online/src/index.ts`). The LAN host has no tamper watch.
² The LAN host has no `C_FORFEIT` control case. It does drive a **server-side**
`TickRelay.submitForfeit` from its own disconnect-cleanup path, and the online server uses the same
helper for a host-initiated kick or a forfeit on grace expiry (§4.4).

### 3.4 Versioning

- `PROTOCOL_VERSION = 0x5c ^ 0x4a` (= **22**), XOR-obfuscated so the plain integer isn't trivially
  greppable in a minified bundle (`shared/src/constants.ts`). It is explicitly **not** a security
  boundary.
- `MIN_PROTOCOL_VERSION = PROTOCOL_VERSION - 2` (= **20**). A room admits clients 1–2 versions
  behind.
- On `C_JOIN`, the server rejects only a **claimed** protocol outside `[MIN, PROTOCOL_VERSION]`;
  a client that omits `protocol` is admitted and judged by the bytes it sends
  (`online/src/index.ts`). The **real** compatibility gate is server-side frame validation (§3.5).
- `S_MATCH_START.protocolVersion` is stamped from `makeMatchStart`. The client compares it to its own
  `PROTOCOL_VERSION` and logs a warning if they differ (`Game.startNet`) — feature/replay
  compatibility is then not guaranteed.
- **After changing anything under `shared/src/`, run `npm run sync:online`** to re-vendor it into
  `online/shared/src/`; `npm run check:online-shared` fails the build if the two copies drift.
  The online server compiles only against the vendored copy (`online/tsconfig.json`).

### 3.5 Server-side frame validation (the real gate)

`validateCommandBytes(data, expectedPlayer)` in `shared/src/protocol.ts` byte-exact-validates a
`BIN.CMD` body before it is relayed. Limits:

| Constant | Value | Meaning |
|---|---|---|
| `MAX_COMMAND_ENTITIES` | `256` | Max entity refs per envelope (a full drag-box). |
| `MAX_COMMAND_STRING_BYTES` | `64` | Max name/upgrade/choice string on the wire. |
| `COORD_MIN` / `COORD_MAX` | `-100_000` / `100_000` | Absolute coordinate bounds. |
| `COMMAND_MAX_BYTES` | `8192` | Any single envelope larger than this is dropped. |

It enforces: known command type id, exact field layout for that type, tick in `0..1e9`, entity count
within limit, coords in range, string length within limit, **no trailing bytes**, and the declared
`player` id **must match the socket's slot**. This gate runs on the **online server only**
(`online/src/index.ts`); the LAN host relays `BIN.CMD` without byte validation. See
[12 — Online Anti-Cheat](12-ONLINE-ANTI-CHEAT.md).

---

## 4. Match lifecycle

### 4.1 Join & lobby

- **Create** (online): `POST /api/rooms` (session + rate limits) → `RoomRegistry.createRoom` picks a
  code, seeds the map (`DEFAULT_MAP_ID = 'four-corners'`), and returns the code.
- **Create** (LAN): `POST /api/create-room`.
- **Join:** the client connects to `/ws` and sends `C_JOIN`. The server validates passphrase
  (`hashPassphrase`, PBKDF2 100k/sha256 over salt `space-arenas:<code>`), capacity, and state, then
  seats the player. The first joiner becomes `host` and starts `ready`.
- Every state change rebroadcasts `H_LOBBY` (players, map, settings, defaults, mod) while
  `!room.ended`.

### 4.2 Start handshake

1. Host sends `C_START`. The server checks: host-only, not already started, **all non-spectators
   ready**, the **mod gate** (§8), and the **defaults gate** (§7). It then sets `seed`, snapshots
   `startSlots`, (online) snapshots the tamper-watch fingerprints, and sends `S_MATCH_START` to every
   connected slot.
2. Each client boots its world and replies `C_LOADED`.
3. The match starts only once **every slot in the room has sent `C_LOADED`**
   (`maybeStartMatch` counts `loaded.size` against `room.players.size`), at which point the
   `TickRelay` starts and `H_PLAYER_STATE` is broadcast.
4. LAN adds a **start-grace timer** (`START_GRACE_MS = 25_000`) so a client that never sends
   `C_LOADED` cannot stall start forever; `clearStartGrace()` is called on start.

### 4.3 In-match relay

The relay runs until the match ends (§4.4). Commands flow per §2.2. Online additionally:

- validates every command frame and every checksum frame (violations → §11);
- serialises control handling per socket (`controlQueue`) so an async `C_JOIN` (session verify) can't
  be overtaken by a `C_READY` behind it.

### 4.4 End of match

- **Natural end:** a client sends `C_GAME_OVER` with the winner (online also sends per-team
  `scores`). The server calls `endMatch`, sends `H_GAME_OVER`, stops the relay, and (online) records
  the match (§13).
- **Forfeit:** `C_FORFEIT` marks the slot forfeited and injects a relay `forfeit` command, so the
  remaining alliance wins deterministically. Online's `C_SETTINGS_VERDICT`-kick does the same via
  `relay.submitForfeit`.
- **Last alliance:** if the last alliance can be derived (e.g. a disconnect cleanup leaves one team),
  the server ends the match with `winnerFromRemaining`.
- LAN additionally **saves a replay** to `archive/` (§12); the online server does not store replays.

---

## 5. Rooms & seats

| Concept | LAN (`host/src/rooms.ts`) | Online (`online/src/rooms.ts`) |
|---|---|---|
| Room count | Single room (`RoomManager.getRoom()`) | Multi-room `Map<string, Room>` |
| Room code | 4 chars from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (`newRoomCode`) | same |
| Passphrase | PBKDF2-100k/sha256, salt `space-arenas:<code>` | same (`hashPassphrase`) |
| Seat ids | `nextPlayerId` from 0 | `nextPlayerId` from 0 |
| Spectator ids | `SPECTATOR_ID_BASE = 100` | `SPECTATOR_ID_BASE = 100` |
| Default map | preset | `DEFAULT_MAP_ID = 'four-corners'` |
| Host | first joiner (`host` + `ready`) | first joiner (`host` + `ready`) |
| Bots | `NetBotRunner` (real sim) | none |
| Room TTL | held until shutdown | idle 30 s / empty 60 s (§5.2) |

### 5.1 Seats, teams, spawns

- `joinRoom` seats a player with `id`, `team = id`, `spawn = id`, `color = id % PLAYER_COLOR_COUNT`
  (`PLAYER_COLOR_COUNT = 10`).
- `updateSlot` clamps name (16 chars), team (`0..maxPlayers-1`), spawn (`0..spawnPoints-1`) and color
  (`0..9`).
- `assignSpawns` (at start) resolves spawn conflicts, fills free spawn points, and **rewrites the map
  spawn points to the active player ids** so the sim is spawn-assignment-agnostic.
- `matchSlots` = non-spectator slots in id order; `slots` = everyone (with `connected`, `modOk`,
  `defaultsOk`, `devSettings`, `clientSettings`).

### 5.2 Online room sweep

The online server sweeps every 10 s (`SWEEP_INTERVAL_MS`): a REST-created room with nobody connected
past `IDLE_ROOM_TTL_MS = 30_000`, or any room with no connected players past
`EMPTY_ROOM_TTL_MS = 60_000`, is closed (relay stopped, sockets closed). `closeRoom` ends a started
match via `winnerFromRemaining`.

---

## 6. LAN host vs online server

| Aspect | LAN host (`host/`) | Online server (`online/`) |
|---|---|---|
| Mode | `SA_MODE` unset/`lan` | `SA_MODE=online` |
| Public discovery | UDP beacon on `DEFAULT_BEACON_PORT = 17322`, `APP_TAG = 'space-arenas'` (`LanDiscovery`) | None (REST room list) |
| Room create | `POST /api/create-room` (no auth) | `POST /api/rooms` (session + rate limits) |
| Auth | None | Supabase session token verified on every join (`verifySession`) |
| Bots | Yes (`NetBotRunner`, server sim) | No |
| Frame validation | Not applied (raw relay) | `validateCommandBytes` + protocol-violation counter |
| Tamper watch | No | Yes (`H_SETTINGS_ALERT` / `C_SETTINGS_VERDICT`) |
| Mods | Local store `host/src/mods.ts`, `/api/mods*` | `online/src/mods.ts`, `/api/mods*` (DB) |
| Maps | Local map builder + presets | `/api/maps*` community repo (DB) |
| Replays | Saved to `archive/`, `/api/replays*` | Not stored |
| Static files | Serves built client `client/dist` (+ sprite bundle) | Serves landing pages (`online/public`) |
| Reconnect grace | `RECONNECT_GRACE_MS = 40_000` (`SA_RECONNECT_GRACE_MS`) | `RECONNECT_GRACE_MS = 30_000` |
| Heartbeat | WS ping 10 s / dead 30 s (`WS_PING_MS`, `WS_DEAD_MS`) | Per-request WS handshake rate limit |

### 6.1 LAN host REST surface

`GET /api/room`, `GET /api/invite-qr`, `GET /api/invite-info`, `GET /api/network`, `POST /api/self`,
`POST /api/create-room`, `POST /api/chat`, `POST /api/relay/chat`, `GET/POST /api/replays*`,
`GET/POST /api/mods*`, `GET/POST /api/profile*`, `GET/POST /api/settings`. Static client files are
served only under `CLIENT_DIST`, unless `SA_ALLOW_DOWNLOADS=0` restricts them to loopback
("hosters-only" mode).

### 6.2 Online server REST surface

`GET /api/status`, `POST/GET /api/rooms`, `GET /api/rooms/search`, `POST /api/rooms/:code/join`,
`GET /api/rooms/:code/mod`, `POST /api/auth/register|login|change-password`, `GET /api/auth/me`,
`GET /api/leaderboard`, `GET/POST/DELETE /api/mods*`, `GET/POST/DELETE /api/maps*`,
`GET/POST/DELETE /api/backups*`. CORS uses an allow-list (`SA_CORS_ALLOW`): unset ⇒ `*`; set ⇒ only
listed origins get an echoed `Access-Control-Allow-Origin`.

### 6.3 Invites & LAN discovery

- `inviteUrl` = `http://<ip>:<port>/?code=..&pass=..` (`host/src/qr.ts`); the invite QR is cached and
  written to `invites/invite-<code>.png`, served at `/api/invite-qr`.
- `LanDiscovery` broadcasts a JSON beacon once a second and remembers peers for 20 s; `/api/network`
  lists self + peers + chat.

---

## 7. Settings layers & the defaults-mismatch gate

### 7.1 Layers

`profile/settings.json` (`MatchSettingsFile`, `shared/src/settings-file.ts`):

```json
{
  "v": 1,
  "builtin": { "startingCredits": 5000 },
  "user":    { "sellRefundFraction": 0.4 },
  "client":  { "graphics": {}, "audio": {}, "profile": {} }
}
```

- `builtin` then `user` are layered over the compiled `DEFAULT_MATCH_SETTINGS` via
  `resolveSettingsFileLayers` → `mergeMatchSettings`.
- `client` (`ClientDevSettings`) is **non-synced**: graphics/audio/profile values that travel only
  for cloning, scrubbed by `sanitizeClientDevSettings` (foreign-origin absolute URLs neutralised).
- The LAN host exposes this file at `/api/settings` so defaults survive a fresh browser origin.
- The **online server has no settings file**, so its "effective defaults" are always the compiled
  defaults: `lobbyDefaults()` returns `fingerprintSettingsFor(undefined)`
  (`online/src/index.ts`).
- `fingerprintSettings(settings)` = `crc32(canonicalJson(settings))` as 8 hex chars
  (`shared/src/settings-file.ts`).

### 7.2 The gate

- Each client publishes its layer via `C_DEV_SETTINGS`, including `defaultsHash`
  (`NetClient.publishDevSettings`).
- The server stores `defaultsOk = (msg.defaultsHash === undefined) ? undefined : (hash === own)`
  (`RoomManager.setDevSettings` / `RoomRegistry.setDevSettings`).
- `C_START` is refused when any seated non-host has `defaultsOk === false`:
  `"Dev-settings defaults differ for <name> — sync settings before starting"`.
  `undefined` (an old client that never published a hash) **never blocks**.
- `H_LOBBY` carries the host's `defaultsHash`, `defaults` layers and `defaultsClient`, so a
  mismatching guest can adopt the host's base.

This exists because match settings live in each player's storage; starting on a different base would
make the two worlds diverge before the first command.

---

## 8. Mod distribution & verification

A **balance mod** is a JSON file of deltas (`shared/src/mod.ts`) that rides the same override-aware
accessors as the dev panel and never changes sim logic:

```json
{
  "meta": { "name": "...", "author": "...", "description": "...", "version": "1.0.0", "requireProtocol": 22 },
  "settings": { "sellRefundFraction": 0.4 },
  "buildingOverrides": { "power-plant": { "cost": 400, "hp": 1600 } }
}
```

- `isValidMod(json, protocolVersion)` — strict JSON validation; `meta.requireProtocol` must match the
  running protocol; a `client` block requires `requireProtocol`.
- `modHash(mod)` = `crc32(canonicalJson(mod))` hex — the content identity.
- `modSettingsDelta(base, mod)` pre-merges the mod's scalars + four override maps; the result feeds
  `mergeMatchSettings`.
- `modFromSettings(patch, meta, client?)` builds a mod from a dev-settings patch ("Export Mod").

Distribution & the start gate:

1. The host selects a mod. **Online requires the file content**: `C_UPDATE_ROOM` with `mod`; the
   server runs `sanitizeMod`, stores `room.mod` / `room.modId`, and `recomputeSettings` sets
   `room.settings = base + modSettingsDelta`.
2. `H_LOBBY` broadcasts a `RoomMod` (name/label/author/description/version/`hash`/size) — guests use
   `hash` to check their local copy.
3. A guest with the matching file sends `C_MOD_ACK { hash }`; the server accepts it only when the
   hash matches the room mod (`setModAck`).
4. `C_START` is refused unless `allNonSpectatorsHaveMod(room)` (every non-host, non-spectator has
   `modAck === modHash`); otherwise the error names `missingModPlayers(room)`.

Limits (`online/src/mods.ts`): `MOD_MAX_BYTES = 4 MiB`, `MODS_MAX_PER_USER = 20`. Online mods are
stored in Supabase (`004_mods.sql`) with a public download at `GET /api/rooms/:code/mod`.

---

## 9. Spectators

- Spectator ids start at `SPECTATOR_ID_BASE = 100` (so they can never collide with player ids).
- A spectator is only admitted **after the match has started** (`joinSpectator` rejects
  `"Match has not started yet"`), either by an explicit `C_JOIN { spectator: true }` or the
  re-join popup path.
- The server sends the spectator an `H_LOBBY`, then `S_MATCH_START` with `spectator: true`, then
  `S_SPECTATE_SYNC { currentTick, log }`.
- The client's `Game.applySpectateSync` → `stepToTickSync` fast-forwards the local world to
  `currentTick` by replaying `log`, and seeds `recordHistory` from the log so a spectator's saved
  replay is complete.
- Spectators are excluded from readiness, spawn assignment, the mod/defaults gates, and daily
  mission banking.

---

## 10. Reconnection & resume

- Every client has a persistent `clientId` (`loadOrCreateClientId`, key `space-arenas:clientId`;
  `regenerateClientId` rotates it).
- On drop, the server keeps the slot (marked `connected: false`) for a grace window:
  **LAN 40 s** (`RECONNECT_GRACE_MS`, `SA_RECONNECT_GRACE_MS`), **online 30 s**
  (`RECONNECT_GRACE_MS`). When it expires, the slot is forfeited/cleaned (`disconnectFinished`).
- A reconnect is a fresh `C_JOIN` with the same `clientId`:
  - LAN rejects a clientId already actively connected elsewhere
    (`"Client ID in use by another active connection"`); online re-binds the slot to the verified
    account.
  - If the match has started, the server re-sends `S_MATCH_START` (online, with `resumed: true`),
    `H_PLAYER_STATE`, and `S_SPECTATE_SYNC` so the client catches up.
- The client reconnect loop (in `client/src/main.ts`): `RECONNECT_MAX_ATTEMPTS = 7`,
  `RECONNECT_RETRY_MS = 1500`; if the player slot can't be reclaimed it **falls back to spectator**
  (`reconnectPhase = 'spectator'`) and reboots into a spectator game.
- Online reconnect requires a **verified session token**; if it expired, the client re-prompts for
  login. A dropped auth service is a 503 (retry), never an anonymous fallback.

---

## 11. Desync detection & diagnostics

- The client's `SyncSystem` (`client/src/systems/sync-system.ts`) computes `hashWorld(world)` **every
  tick** and fires `world.onSyncTick(hash)` when `world.tick % 60 === 0` (**every 60 ticks = 2.4 s**).
- `hashWorld` (`client/src/core/hash.ts`) folds the tick, map size, RNG state, cooperative-settings
  modes, every team's economy/power/research/SW state, and every ECS component set into a byte
  stream, then returns a `crc32`. `compactHash` renders it as 8 hex chars.
- On `onSyncTick` the client stores the hash in `pendingChecks` and sends `encodeChecksum(tick, crc)`
  (`NetClient.sendChecksum`).
- The relay rebroadcasts it as `BIN.RELAY_CHECKSUM` (`TickRelay.relayChecksum`).
- `Game.onNetChecksum(player, tick, crc)` compares the relayed crc against its own `pendingChecks` for
  that tick, but **only for its own player id** (`if (player !== this.localTeam) return`), and sets
  `syncOk`. The HUD shows `hud.inSync` / `hud.desync`.
- There is **no automatic rollback or correction** — checksums are visibility/diagnostics only. The
  online server validates checksum frame shape (9 bytes, tick in range) and counts malformed ones as
  protocol violations.
- Online protocol violations (`noteProtocolViolation`): unknown/trailing/out-of-range commands,
  player-id mismatch, bad checksum frames, and client-sent `FRAME`/`RELAY_CHECKSUM` all increment a
  per-socket counter; at `PROTOCOL_VIOLATIONS_MAX = 10` the socket is closed with
  `4002, 'protocol violation'`.

---

## 12. Replay recording & archive

- **Format:** `ReplayData` (`shared/src/replay.ts`) = `version`, `createdAt`, `seed`, `tickRate`,
  `map`, `settings`, `winRule`, `players` (start slots), `winner`, `ticks`, and `history` (every
  relayed `EnvelopeCommand`).
- **Host recording:** at `endMatch`, `host/src/index.ts` calls `saveReplay`, which writes a JSON file
  into `archive/` via `archiveStore` (`host/src/archive.ts`). Start slots are snapshotted so players
  who quit mid-match still appear.
- **Client recording:** in net mode `Game.applyFrame` pushes every command into `recordHistory`
  (and `recordTicks`); a late-joining spectator seeds `recordHistory` from `S_SPECTATE_SYNC.log`.
- **Playback:** `Game.startReplay(replay)` rebuilds the deterministic world from the stored
  seed/map/settings and drives ticks with `history`; the watcher is a passive spectator and no
  profile entry is recorded.
- **Validation:** `validReplay` is a structural check (`version`, `seed`, `tickRate`, `map.width`,
  `players[].id`, `history[].tick`/`cmd`, `winner`, `ticks`).
- **LAN API:** `GET /api/replays` (list), `POST /api/replays/upload`, `/api/replays/rename`,
  `/api/replays/delete`. `replayFileName` and `defaultReplayName` produce safe
  `replay-YYYYMMDD-HHMMSS.json` names.
- **Online:** replays are **not** stored on the server; a screenshot-style record-keeping is the
  player's local responsibility.

---

## 13. Online accounts, leaderboard & progression separation

### 13.1 Accounts

- Supabase-backed (`online/src/supabase.ts`). Routes: `POST /api/auth/register`,
  `POST /api/auth/login`, `POST /api/auth/change-password`, `GET /api/auth/me`.
- `verifySession(token)` calls `authMe`; a missing/invalid token is 401, an unreachable auth service
  is 503. **Online play requires a real account** — there is no anonymous fallback.
- Every online player and spectator slot is bound to a verified account id
  (`p.authUserId = session.userId`).

### 13.2 Match records & leaderboard

- On `C_GAME_OVER` the online server calls `endMatch`, which builds `participants` from the start
  slots (id, username, team, score, account id) and calls `dbRecordMatch`.
- `dbRecordMatch` inserts a `matches` row, then per bound account updates `profiles`
  (`games + 1`, `wins + (winner match)`, `high_score = max(old, score)`) and upserts the
  `leaderboard` mirror.
- `GET /api/leaderboard` returns `dbLeaderboard(100)` ordered by score desc.

### 13.3 Separation from achievements / daily missions

- **Online** stats (games/wins/high score/leaderboard) are the only server-side progression, keyed by
  account, written only through `dbRecordMatch`.
- **Local** progression — achievements, XP, ranks, daily missions — is client-side **localStorage
  only**: `client/src/modes/daily.ts` (`resolveDailyChallenge`, `generateDailyMissions`,
  `recordDailyResult` in `client/src/profile/modeRecords.ts`). It never leaves the machine and the
  server never sees it.
- Net matches may count toward the local daily list (`Game.startNet` with `trackDaily`), but
  spectators never bank missions, and the online server has no concept of them.

### 13.4 Database schema

Migrations in `online/supabase/migrations/`:

| File | Tables | RLS |
|---|---|---|
| `001_init.sql` | `profiles`, `matches`, `leaderboard` | reads public; writes owner/service-role |
| `002_match_records.sql` | match-record support | — |
| `003_backups.sql` | `backups` | service-role only |
| `004_mods.sql` | `mods`, `mod_ratings`, `mod_comments` | reads public; writes service-role |
| `005_maps.sql` | `maps`, `map_ratings`, `map_comments` | reads public; writes service-role |

All writes flow through the Render server (service role) after sanitisation, so RLS keeps direct
anon writes out.

---

## 14. Constants & limits

| Constant | Value | Location |
|---|---|---|
| `SIM_TICK_HZ` | `25` | `shared/src/constants.ts` |
| `SIM_TICK_MS` | `40` | `shared/src/constants.ts` |
| `DEFAULT_PORT` | `17321` | `shared/src/constants.ts` |
| `DEFAULT_MAX_PLAYERS` | `8` | `shared/src/constants.ts` |
| `PROTOCOL_VERSION` | `22` (`0x5c ^ 0x4a`) | `shared/src/constants.ts` |
| `MIN_PROTOCOL_VERSION` | `20` | `shared/src/constants.ts` |
| `PLAYER_COLOR_COUNT` | `10` | `shared/src/constants.ts` |
| `MAX_COMMAND_ENTITIES` | `256` | `shared/src/protocol.ts` |
| `MAX_COMMAND_STRING_BYTES` | `64` | `shared/src/protocol.ts` |
| `COORD_MIN` / `COORD_MAX` | `-100000` / `100000` | `shared/src/protocol.ts` |
| `COMMAND_MAX_BYTES` | `8192` | `shared/src/protocol.ts` |
| `SPECTATOR_ID_BASE` | `100` | `host/src/rooms.ts`, `online/src/rooms.ts` |
| `PROTOCOL_VIOLATIONS_MAX` | `10` | `online/src/index.ts` |
| `IDLE_ROOM_TTL_MS` | `30000` | `online/src/index.ts` |
| `EMPTY_ROOM_TTL_MS` | `60000` | `online/src/index.ts` |
| `RECONNECT_GRACE_MS` | `40000` (LAN) / `30000` (online) | `host/src/index.ts`, `online/src/index.ts` |
| `START_GRACE_MS` | `25000` | `host/src/index.ts` |
| `WS_PING_MS` / `WS_DEAD_MS` | `10000` / `30000` | `host/src/index.ts` |
| `DEFAULT_BEACON_PORT` | `17322` | `host/src/discovery.ts` |
| `MOD_MAX_BYTES` / `MODS_MAX_PER_USER` | `4 MiB` / `20` | `online/src/mods.ts` |
| `MAP_MAX_BYTES` / `MAPS_MAX_PER_USER` | `4 MiB` / `20` | `online/src/maps.ts` |
| `BACKUPS_TTL_DAYS` / `BACKUPS_MAX_PER_USER` | `7` / `10` | `online/src/config.ts` |
| `RECONNECT_MAX_ATTEMPTS` / `RECONNECT_RETRY_MS` | `7` / `1500` | `client/src/main.ts` |

### 14.1 Deployment environment

`render.yaml` builds/starts the `online/` subfolder (`SA_MODE=online`, `SA_PORT=17321`,
`healthCheckPath: /api/status`). Required env (`online/.env.example`): `SA_PASSPHRASE`,
`SA_PUBLIC_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, optional
`SA_CORS_ALLOW`, `SA_TESTER_EMAILS`, `SA_FORBIDDEN_USERNAME`, `SA_FORBIDDEN_USERNAME_EMAILS`.

---

## 15. Tests & tooling

- `online/tests/online-server.test.ts` covers: status/lobby REST, DB-unconfigured 503s, disabled-mode
  503s, backups + rate limiting, mod repository, map repository, CORS allow-list, WS lobby round-trip
  + wrong passphrase, the tamper watch, the protocol-version gate, wire-frame validation
  (drop malformed → kick at 10 with `4002`), the balance-mod gate, and the room auth gate.
- `scripts/sync-online-shared.mjs` (`npm run sync:online`) vendors `shared/src/*.ts` into
  `online/shared/src/`; `scripts/check-online-shared.mjs` (`npm run check:online-shared`) fails on any
  missing, extra or changed file. Root `npm run typecheck` runs the check first and then typechecks
  `online`, so drift breaks locally instead of on the Render deploy.

---

## Related documents

- [12 — Online Anti-Cheat](12-ONLINE-ANTI-CHEAT.md) — threat model, tamper watch, wire validation.
- [13 — Map Publishing](13-MAP-PUBLISHING-PLAN.md) — the community map repository.
- [04 — Architecture](04-ARCHITECTURE.md) — ECS-lite model, the tick loop, determinism.
- [06 — Data & Save System](06-DATA-AND-SAVE-SYSTEM.md) — storage keys, settings file, backups.
