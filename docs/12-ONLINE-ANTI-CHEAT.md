# 12 — Online Anti-Cheat

**Status:** Shipped (deterrence + transparency layer). This document describes what "anti-cheat"
means for Space Arenas online and — just as importantly — what it deliberately does **not**
guarantee. The full network architecture is in [16 — Netcode & Online](16-NETCODE-AND-ONLINE.md).

---

## 1. Threat model

The authoritative RTS simulation is **client-side**: every peer runs the deterministic sim from a
server-relayed seed plus the command stream (`client/src/core/Simulator.ts`, `shared/src`). Match
values (`MatchSettings`) live in each player's `localStorage` / `profile/settings.json`, so any
player can in principle edit them after a match starts.

Because the server only relays commands, a late edit changes **only the editor's own local world** —
it cannot reach other players' worlds. It still gives the editor an unfair single-client advantage
(e.g. cheaper units), which is exactly what the tamper watch is for.

Online play also has a second concern the LAN host does not: the relay is a public service reachable
by patched clients, so it additionally validates the **raw bytes** of everything it relays.

---

## 2. Enforcement layers

Online anti-cheat is a stack of independent layers; none is a hard security boundary on its own.

### 2.1 Server-side wire validation (the real compatibility/tamper gate)

The online server sees every command envelope, so it validates the **raw bytes** before relaying
(`shared/src/protocol.ts` `validateCommandBytes`, called from `online/src/index.ts`):

- known command type id;
- exact field layout for that type, **no trailing bytes**;
- entity count ≤ `MAX_COMMAND_ENTITIES` (256);
- coordinates within `COORD_MIN`/`COORD_MAX` (±100 000);
- strings ≤ `MAX_COMMAND_STRING_BYTES` (64);
- envelope ≤ `COMMAND_MAX_BYTES` (8192);
- tick within `0..1e9`;
- **the declared `player` id must match the socket's slot**.

A patched old client can bump the protocol integer freely, but if the wire format changed it cannot
produce byte-valid envelopes — this is the real gate, not the version number (§3).

### 2.2 Protocol-violation counter

Malformed command frames, bad checksum frames, and client-sent `BIN.FRAME` / `BIN.RELAY_CHECKSUM`
all call `noteProtocolViolation(ws)` (`online/src/index.ts`). The counter is per socket; at
`PROTOCOL_VIOLATIONS_MAX = 10` the socket is closed with `4002, 'protocol violation'`. Individual
bad frames are dropped, never relayed.

### 2.3 Defaults-mismatch gate

Each client publishes its effective-defaults fingerprint in `C_DEV_SETTINGS.defaultsHash`; the server
stores `defaultsOk`. `C_START` is refused while any seated non-host has `defaultsOk === false`
(`"Dev-settings defaults differ for <name> — sync settings before starting"`). `undefined` (an old
client that never published a hash) never blocks. See
[16 §7](16-NETCODE-AND-ONLINE.md).

### 2.4 Balance-mod gate

A room with a balance mod cannot start until every non-host, non-spectator has acked the matching
`modHash` (`C_MOD_ACK`). This keeps a modded host from starting a match whose rules a guest isn't
running. See [16 §8](16-NETCODE-AND-ONLINE.md).

### 2.5 Tamper watch (deterrence + transparency)

- At match start the server snapshots each non-spectator player's settings fingerprint:
  `devSnap.set(p.id, fingerprintSettingsFor(p.devSettings))`
  (`online/src/index.ts`), where `fingerprintSettingsFor(dev)` =
  `settingsFingerprint(mergeMatchSettings(dev ?? {}))` and `settingsFingerprint` is
  `crc32(stableStringify(settings))` as 8 hex chars (`online/src/sanitize.ts`).
- While the room is started, a `C_DEV_SETTINGS` whose new fingerprint differs from the snapshot:
  1. **warns the offender** via `H_SETTINGS_ALERT`,
  2. **notifies the host** with the offender's name/id (`H_SETTINGS_ALERT` → host popup).
- Alerts are de-duplicated: the same fingerprint is never re-alerted (`room.devAlerted`).
- The **host** chooses a verdict with `C_SETTINGS_VERDICT`:
  - **`kick`** — the offender is forfeited to the relay (their units leave the sim), the slot is
    removed, and the socket is closed with `4001, 'You were removed by the host'`.
  - **`skip`** — the alert is silenced for the current value (`room.devSkipped`), cleared on the
    offender's next *different* value.
- Only the host's verdict is accepted (`"Only the host can decide"`). The watch is
  **online-only**; the LAN host does not run it.

### 2.6 Tick checksums (desync visibility)

`SyncSystem` hashes the world every 60 ticks (`client/src/core/hash.ts` `hashWorld`; `crc32`), the
client sends `BIN.CHECKSUM`, the relay rebroadcasts `BIN.RELAY_CHECKSUM`, and
`Game.onNetChecksum` compares the relayed crc to its own recorded hash for that tick, setting
`syncOk` and driving the HUD's in-sync/desync badge. This is **diagnostics, not enforcement** — there
is no rollback. See [16 §11](16-NETCODE-AND-ONLINE.md).

---

## 3. Protocol notes

- The anti-cheat messages `H_SETTINGS_ALERT` and `C_SETTINGS_VERDICT` are part of the shared protocol
  (`shared/src/protocol.ts`). `PROTOCOL_VERSION` is currently **22** (`0x5c ^ 0x4a`) with
  `MIN_PROTOCOL_VERSION = 20` (`shared/src/constants.ts`).
- The version integer is **UX/policy only**; the real gate is server-side byte validation (§2.1). A
  `C_JOIN` that claims a version outside `[MIN, PROTOCOL_VERSION]` is rejected with a
  "server runs protocol X, you have Y" error, but a client that omits the field is admitted and
  judged by the bytes it actually sends.
- The client warns (does not block) when `S_MATCH_START.protocolVersion` differs from its own
  (`Game.startNet`).
- Protocol changes under `shared/src/` are vendored into `online/shared/src/` by
  `scripts/sync-online-shared.mjs` (`npm run sync:online`); `npm run check:online-shared` fails the
  build when the vendored copy drifts, and the root typecheck runs it before `online`.
- `C_DEV_SETTINGS` payloads are sanitised against the shared clamp tables (`sanitizeSettings` in
  `online/src/sanitize.ts`). There is no dedicated per-minute limiter on `C_DEV_SETTINGS` in the
  current code; the tamper-watch alert de-duplication plus the normal lobby broadcast flow bound the
  noise it can create.

---

## 4. What it is NOT

- **Not a hard anti-cheat.** The sim is client code; a determined player can patch anything. The
  watch only makes mid-match value edits **visible** and lets the host act. The server's frozen
  room settings guarantee a cheater's local change never bleeds into other players' worlds.
- **Not a settings "standard."** Joining a lobby with different match values is allowed and shown in
  the per-player sync list (same/diff badges + clone once / clone & save). There is no
  server-enforced "correct" config to join with — only the start gate (§2.3).
- **Not server-authoritative.** The server never simulates an online human match, so it cannot
  validate unit positions, resources, or outcomes. A client may send legal-but-cheating commands
  (e.g. perfect micro) that no layer here detects.
- **Replay files are self-reported.** A saved replay records what the client relayed; it is not
  tamper-proof. The host archive (`archive/`) is server-written but auth-less on the LAN; the online
  server stores no replays at all.
- **Rate limiters are deterrence, not security.** The in-memory sliding-window limiter
  (`online/src/ratelimit.ts`) is process-local on a single Render instance.

---

## 5. Test coverage

`online/tests/online-server.test.ts`:

- **"online server tamper watch"** — fingerprint determinism + value sensitivity; pre-start syncs
  never flagged; same-as-snapshot pushes not flagged; mid-match change → offender warned + host
  alerted once; `skip` silences one repeat and a new value re-alerts; `kick` closes the offender
  socket with `4001`.
- **"online server wire-frame validation"** — relays a valid command, drops malformed frames, and
  kicks repeat offenders (`4002`).
- **"online server protocol version gate"** — admits a client inside the grace band, rejects one far
  outside it, and admits clients that omit the field.
- **"online server balance-mod gate"** — host uploads a mod, guests must ack before start; clearing
  the mod allows start without any ack.
- **"online server room auth gate"** — creating a room and joining need a verified session; an
  unverified token is rejected; spectating is authenticated too; a broken auth service is a 503.

---

## 6. Future hardening ideas (not implemented)

Marked **Planned / not yet implemented** — none of these exist in the current code:

- **Server-authoritative sim / per-client build verification** — requires shipping the sim to Render
  and a large architectural change.
- **Per-match checksum sampling with server adjudication** — today checksums are relayed and shown
  but never acted on server-side.
- **Voluntary replay submission for community review** — the online server stores no replays.
- **Dedicated `C_DEV_SETTINGS` rate limiting** — the current code relies on sanitisation and alert
  de-duplication only.

---

## Related documents

- [16 — Netcode & Online](16-NETCODE-AND-ONLINE.md) — full network architecture.
- [09 — Testing & QA](09-TESTING-AND-QA.md) — test suites and desync triage.
