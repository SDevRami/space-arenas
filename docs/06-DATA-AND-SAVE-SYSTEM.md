# 06 — Data & Save System

**Project:** Space Arenas — RTS game
**Version:** 0.1
**Companion docs:** 02-MECHANICS-SPECIFICATION.md (game rules), 03-TECHNICAL-SPECIFICATION.md (protocol), 04-ARCHITECTURE.md (data flow)

This document defines every persisted data structure: settings, map files, lobby history, and what is deliberately **not** persisted. It also covers the browser storage backends and versioning strategy.

---

## 1. Storage Backend Selection

| Backend | Used for | Why |
|---|---|---|
| **localStorage** | Settings, hotkey bindings, last-host connection details, dev flags | Synchronous, tiny, perfect for prefs |
| **IndexedDB** | Map library, exported maps, lobby history, desync diagnostic dumps | Larger blobs, async, queryable, survives cache clears |
| **SessionStorage** | Active lobby state (current room code, passphrase hint) | Cleared when the tab closes — keeps passphrases out of persistent storage |
| **Server memory (host process)** | Room passphrase hash, active player list | Ephemeral by design (08-DECISIONS ADR-005) |
| **Filesystem (host)** | None in v1 | Host is stateless; maps are sent in-memory during a match |

**No backend API, no cloud, no leaderboards in v1.** The "save system" is entirely local by design — this keeps LAN sessions self-contained.

---

## 2. Schema Versioning (Global Rule)

Every persisted structure carries a `schemaVersion` integer. Rules:

1. **Bump on breaking change.** Reading a higher version than the app supports → user-friendly migration error + option to clear.
2. **Migrators:** `migrate(name, fromVersion)` map in `client/src/storage/migrations.ts`; forward-only, tested.
3. **Never silently drop user data:** migrations preserve what can be preserved; unknown fields are preserved verbatim in a `legacy` bag.

---

## 3. Schema Definitions

### 3.1 Settings (`localStorage:space-arenas.settings.v1`)

```jsonc
{
  "schemaVersion": 1,
  "graphics": {
    "zoomSpeed": 1.0,          // 0.5–2.0
    "edgePan": true,
    "dprCap": 2,               // max devicePixelRatio used
    "showFogEdges": true
  },
  "audio": {
    "master": 0.8,             // 0–1
    "sfx": 0.8,
    "ui": 0.6,
    "muted": false
  },
  "controls": {
    "bindings": { "A": "attack_move", "S": "stop", "H": "home", "space": "alert" },
    "scrollWheelZoomInverted": false
  },
  "net": {
    "defaultPort": 17321,
    "lastHostAddress": null,
    "lastRoomCode": null       // session-only; not persisted past tab close
  },
  "dev": {
    "debugOverlays": false
  }
}
```

- `bindings` maps logical action names (from 02 § 2.2) to keys. Unknown action names are ignored gracefully on load.

### 3.2 Map file (`IndexedDB:maps` + exported `.sa-map.json`)

The **canonical map schema** lives in `shared/maps.ts` and is used identically by client, host, and map builder. This guarantees builder→game fidelity.

```jsonc
{
  "schemaVersion": 1,
  "format": "space-arenas-map",
  "name": "The Breach",
  "description": "Two supply clusters split by a river.",
  "author": "you",
  "mapVersion": "0.2.0",
  "size": { "width": 128, "height": 128 },       // 64–256 inclusive
  "tiles": [
    // width*height entries, row-major. Terrain id per tile.
    // 0=ground, 1=cliff, 2=water, 3=road, 4=buildable-ground
  ],
  "obstructions": [
    // static rocks/wrecks: { "x": 40, "y": 41, "w": 2, "h": 2, "type": "rock" }
  ],
  "supplyFields": [
    { "x": 20, "y": 30, "radius": 3, "capacity": 10 }   // capacity = trips before field depletes
  ],
  "spawnPoints": [
    { "x": 8, "y": 8,  "team": 0 },
    { "x": 120, "y": 120, "team": 1 }
  ],
  "startingState": {
    "credits": 800,
    "startsWith": [ "command-center" ]
  },
  "rules": {                                    // optional overrides
    "powerDown": "warning",                      // "warning" | "block"
    "maxPlayers": 8
  },
  "checksum": "crc32-of-canonical-serialization"
}
```

**Rules for map integrity (hard):**

1. `checksum` is computed over the canonical serialization (fixed key order, integer-only). The game validates on load and on receive from host. A bad checksum → reject map, don't play.
2. All coordinates are integers within `size`.
3. Spawn points: ≥ 2, ≤ 8, each ≥ 24 tiles from every other spawn (measured Manhattan).
4. Every map must contain ≥ 1 supply field cluster.
5. The map builder emits canonical order automatically; hand-editing JSON risks a checksum mismatch (by design).

### 3.3 Lobby history (`IndexedDB:lobbyHistory`)

```jsonc
{
  "schemaVersion": 1,
  "recentRooms": [
    { "host": "192.168.1.20", "port": 17321, "roomCode": "K7QD", "lastSeen": 1782123456 }
  ]
}
```

- Useful for "join the same room again"; `lastRoomCode` never stores passphrases.

### 3.4 Desync diagnostic dumps (`IndexedDB:desyncReports`)

```jsonc
{
  "schemaVersion": 1,
  "id": "desync-2026-08-07T12-00-00Z",
  "protocolVersion": 7,
  "matchId": "abc123",
  "expectedHash": "0x9f2c…",
  "receivedHash": "0x1ab8…",
  "tick": 4120,
  "mapName": "The Breach",
  "commandLog": [ { "tick": 4060, "player": 0, "seq": 8901, "type": "move", "data": {…} } ],
  "stateHashes": [ { "tick": 4060, "hash": "0x…" } ]
}
```

- Written by both clients on `DESYNC_HALT`. Exported via a button in the pause menu ("Export desync report") for dev triage (09-TESTING-AND-QA.md § 6).

---

## 4. What Is NOT Persisted (and Why)

| Data | Reason |
|---|---|
| Passphrases | Session-only (SessionStorage); hashed in host memory; never on disk |
| Match replays | Post-v1 feature; wire format leaves room |
| Match result history | No leaderboard in v1 |
| Sim state mid-match | Deterministic sim can't be "resumed" by a disconnected client safely in v1 |
| Raw binary assets | They're code-shape-generated or build-bundled; no runtime download |

---

## 5. IndexedDB Access Layer (`client/src/storage/`)

- **Wrapper:** `idb.ts` — promise-based thin wrapper (no dependency needed; raw IndexedDB is fine at this scale).
- **Stores:** `maps` (key = map name+version), `lobbyHistory`, `desyncReports`, `kv` (generic settings backup).
- **Transactions:** single-object reads/writes only; never hold transactions open across `await` boundaries (browser will close them).
- **Quota safety:** maps are capped at 256×256 (~130 KB JSON); desync reports capped at last 20; lobby history capped at last 50. Pruning on write.

---

## 6. Map Lifecycle

```
Map Builder                          Game (client)
──────────                           ─────────────
paint/place → export .sa-map.json ─▶ file picker → validate schema+checksum
            → save to IndexedDB ───▶ map library (lobby picker)
                                     host selects map → broadcast to clients
                                     → clients validate → sim init (04 § 8)
```

- **Validation runs everywhere maps are loaded:** builder export, client import, host receive. One shared `validateMap()` in `shared/maps.ts` — no duplicated rules.

---

## 7. Save-Lessness as a Feature

- No "save game" in v1 — matches are ≤ 30 minutes and LAN sessions are social/synchronous.
- If future patches add campaign/skirmish vs AI, a **deterministic checkpoint** becomes feasible: store `{tick, stateHash, commandLogSinceStart}` and replay to resume. The ECS serialization in 04 makes this straightforward later. Recorded as a design note, not a requirement.

---

## 8. Backup & Reset

- Settings export/import as JSON (button in Options).
- "Reset all local data" clears IndexedDB + relevant localStorage keys (dev menu).
- localStorage is namespaced (`space-arenas.`) to avoid collisions if the game is ever hosted on a shared domain.
