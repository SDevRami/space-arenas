# Online anti-cheat baseline (Phase 5)

**Scope of this document:** what "anti-cheat" means for Space Arenas online after Phase 5,
and what it deliberately does **not** guarantee.

## Threat model

The authoritative RTS sim is **client-side** and runs deterministically from a server-relayed
seed. Match values (`MatchSettings`) live in each player's `localStorage`, so any player can in
principle edit them after a match starts. That edit changes only **their own local world state**
— the host merges match settings **once at start** (`C_START`) and never re-reads late changes,
so a late edit cannot affect the other players' sim. Still, it gives the editor an unfair
single-client advantage (e.g. cheaper units) — which is what the tamper watch is for.

## What the tamper watch does (deterrence + transparency)

- At match start the server snapshots each non-spectator player's settings fingerprint:
  `settingsFingerprint(mergeMatchSettings(p.devSettings))` (`online/src/sanitize.ts`,
  ported from the client's `client/src/main.ts:2160-2183`).
- While the room is started, a `C_DEV_SETTINGS` whose new fingerprint differs from the snapshot:
  1. **warns the offender** via `H_SETTINGS_ALERT`,
  2. **notifies the host** with the offender's name (`H_SETTINGS_ALERT` → host popup).
- The **host** chooses a verdict with `C_SETTINGS_VERDICT`:
  - **Kick** — the offender is forfeited to the relay (their units leave the sim) and the
    socket closes with code `4001`.
  - **Skip for now** — the alert is silenced until the offender pushes a *different* value
    again (no repeated nagging for the same value).
- `C_DEV_SETTINGS` they're inside the normal lobby broadcast flow; the fingerprint only
  changes meaning once `room.started` is true.
- Backpressure: `C_DEV_SETTINGS` is rate-limited through the shared P3 limiter
  (`online/src/ratelimit.ts`) — `RATE_DEV_SETTINGS_PER_MIN` — to deter push-spam.

## What it is NOT

- **Not a hard anti-cheat.** The sim is client code; a determined player can patch anything.
  The watch only makes mid-match value edits **visible** and lets the host act, and frozen
  host settings guarantee a cheater's change never bleeds into other players' worlds.
- **Not a settings "standard".** Joining a lobby with different match values is allowed and
  shown in the per-player sync list (same/diff badges + clone once / clone & save). There is
  no server-enforced "correct" config to join with.
- **Replay files are self-reported.** A saved local replay is a record of what the client
  relayed; it is not tamper-proof and is stored only on the player's machine (Render stores
  nothing).

## Protocol

- New kinds `H_SETTINGS_ALERT` + `C_SETTINGS_VERDICT`; `PROTOCOL_VERSION` bumped 20 → 21
  (`shared/src/protocol.ts`, vendored into `online/shared/` via
  `scripts/sync-online-shared.mjs`). Round-trip covered in `tests/protocol.test.ts`.

## Test coverage

`online/tests/online-server.test.ts` → "online server tamper watch":
- fingerprint determinism + value sensitivity;
- pre-start syncs are never flagged; same-as-snapshot pushes are not flagged;
- mid-match change → offender warned + host alerted once;
- skip silences one repeat; a new value re-alerts;
- kick closes the offender socket with `4001`.

## Future hardening ideas (out of scope)

- Server-authoritative sim / every-client verifies builds — requires shipping the sim to
  Render, a large architectural step (see `online_todo.md` §0 scope cuts).
- Per-player seed or per-match checksum sampling (already present: tick checksums for the
  relay path, `online/src/relay.ts`).
- Community moderation: saved replays uploaded voluntarily to a repository for review.