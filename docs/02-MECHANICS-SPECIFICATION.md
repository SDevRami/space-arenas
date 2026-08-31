# 02 — Mechanics Specification

**Project:** Space Arenas — RTS game
**Version:** 0.1
**Companion docs:** 01-GAME-DESIGN-DOCUMENT.md (vision), 04-ARCHITECTURE.md (how mechanics map to systems), 06-DATA-AND-SAVE-SYSTEM.md (schema)

This document is the **authoritative ruleset**. Balance numbers live in code (`shared/balance/`), but the *meaning* of every number is defined here. If this document and a code constant disagree, the document wins until the code is fixed.

---

## 1. Simulation Model

- **Fixed timestep:** 25 logic ticks per second (40 ms per tick). All mechanics below resolve in integer tick counts.
- **Coordinate space:** Integer world tiles (X, Y). Units occupy a tile footprint (1×1 for infantry, 1×2 for vehicles). Building footprints are defined per building (2×2 to 4×4).
- **Determinism:** Every mechanic must resolve identically given identical inputs + seeded RNG. No `Math.random`, no wall-clock in sim.
- **Tick budget:** 40 ms/tick total across all systems, with a **hard target of < 8 ms** simulation CPU per tick on mid-range hardware so rendering has room.

---

## 2. Player Controls

### 2.1 Mouse

| Action | Effect |
|---|---|
| Left-click entity | Select single unit/building |
| Left-click empty | Deselect |
| Left-drag over entities | Box select friendly units |
| Left-click build menu item | Select building/unit for placement or queue |
| Right-click terrain (units selected) | Move command (queue with Shift) |
| Right-click enemy | Attack command (queue with Shift) |
| Right-click friendly unit/building | Guard / repair (if unit type supports) |
| Middle-drag / edge-of-screen | Pan camera |
| Mouse wheel | Zoom camera (clamped) |
| Double-click unit | Select all same type on screen |

### 2.2 Keyboard

| Key | Effect |
|---|---|
| `A` | Attack-move to cursor position |
| `S` | Stop |
| `H` | Select home (Command Center) |
| `Ctrl+1..9` / `1..9` | Create / recall control groups |
| `Esc` | Cancel placement / close menu / pause menu |
| `Space` | Jump to last alert |
| `F1..F4` | Toggle render debug overlays |
| `Tab` | Cycle idle worker/production units |
| `Delete` | Sell selected building (if enabled) |
| `+`/`-` | Game speed (host only, requires resync) |

### 2.3 Control groups & selection rules

- Control groups persist per match, stored client-side (not synced — cosmetic/UX only).
- Box select selects only units (not buildings). Buildings require individual clicks.
- Maximum selectable units per group: 40 (matches practical LAN army sizes; raises with future perf work).

---

## 3. Faction & Tech Tree (v1 — single faction "Space Legion")

One faction, designed to exercise every system. Naming is placeholder; balance data is in `shared/balance/`.

### 3.1 Buildings

| Building | Footprint | Cost | Power | Build Time | Purpose |
|---|---|---|---|---|---|
| **Command Center** | 4×4 | 0 (given) | +0 | 0 (start) | Construction HQ; build-only-if-destroyed-victory condition |
| **Power Plant** | 3×3 | 200 | +50 | 20 s | Unlocks power budget |
| **Supply Dock** | 3×3 | 300 | -10 | 20 s | Summons Harvester; deposits supply |
| **Barracks** | 3×3 | 200 | -10 | 20 s | Produces infantry |
| **War Factory** | 4×3 | 400 | -20 | 30 s | Produces vehicles |
| **Turret Defense** | 2×2 | 150 | -10 | 15 s | Static anti-ground/anti-air defense |
| **Tech Center** (stretch) | 3×3 | 500 | -20 | 40 s | Unlocks upgraded units (future content) |

### 3.2 Units

| Unit | Class | Cost | Build Time | Vision | HP | Role |
|---|---|---|---|---|---|---|
| **Harvester** | Vehicle (supply) | included with Dock | — | 4 tiles | 600 | Auto-collects supply |
| **Scout** | Infantry | 50 | 5 s | 10 tiles | 100 | Fast vision, weak combat |
| **Rifleman** | Infantry | 100 | 10 s | 6 tiles | 200 | Basic combatant |
| **Rocket Trooper** | Infantry (anti-armor) | 150 | 12 s | 6 tiles | 150 | Deals bonus vs vehicles |
| **Assault Walker** | Vehicle | 250 | 15 s | 8 tiles | 400 | Main battle tank |
| **Anti-Air Platform** | Vehicle | 300 | 18 s | 8 tiles | 350 | Ground-to-air |
| **Artillery** | Vehicle (indirect) | 350 | 22 s | 9 tiles | 250 | Long-range area damage, must deploy |

### 3.3 Upgrade path (v1 minimal)

- Power Plant → provides power (no upgrade in v1).
- Future: Tech Center unlocks rank-2 versions of Rocket Trooper and Assault Walker.

### 3.4 Progression rules

- The player starts with one Command Center + one starter Harvester (or Harvester auto-summoned by initial Supply Dock).
- Only **one Command Center per player**. If destroyed and the player has no buildings/units left → loss. If destroyed but units remain → the match continues but the player cannot build (they can only fight with existing forces) — matching Generals' "Construction lost" behavior.

---

## 4. Economy

### 4.1 Supplies (cash)

- **Harvest:** A Supply Dock's Harvester drives to the nearest supply field, loads, returns, and banks **$50 per trip** taking ~6 s round trip on default maps.
- **Treasury:** Cash is a single player-scoped float, stored as integer credits. Starts at **$800** on the default map.
- **Income sources:** supply field harvesting only (no passive income).
- **Max treasury:** 99,999 (soft cap).

### 4.2 Power

- **Budget:** `available = (sum of +power) − (sum of −power demand)`.
- **Power down:** When available < 0, production queues **pause** and defense turrets **deactivate**. Units already built operate normally (Generals behavior).
- **Ordering rule:** Builds are rejected if placing the building would drop power below the required operational threshold of existing structures (i.e., you cannot strand your own buildings). Player is warned, not blocked, in v1 (warning then allowed if they confirm).

### 4.3 Refunds

- Cancelling a queued unit/building refunds 100% of cash (build time not yet elapsed).
- Selling a building refunds 50% of its build cost. Sold buildings are removed from the map.

---

## 5. Building & Placement

- **Placement mode:** Select building from build menu → ghost follows cursor, tinted green (valid) / red (invalid).
- **Validity rules:**
  1. Every footprint tile must be on the map.
  2. No tile may be occupied by another building, unit, or obstruction.
  3. Terrain must be buildable (e.g., not deep water or unbuildable ground).
  4. Must be within the player's **build radius**: 8 tiles from any owned building.
- **Rotation:** Buildings have fixed orientation (facing one of 4 iso axes) unless they are turrets (freely rotated to cursor).
- **Construction animation:** Buildings have a `buildProgress` 0→1 over build time; they are non-functional until 1.0 (except Command Center which starts functional).

---

## 6. Unit Movement & Pathfinding

- **Pathfinding:** A* on the tile grid (see 04-ARCHITECTURE.md). Grid is updated only when buildings/obstacles change (dirty-region rebuild, not full recompute per frame).
- **Movement:** Units move tile-to-tile along the found path at their speed; vehicles require roads-free open ground, infantry can cross light terrain.
- **Speed units:** tiles per tick (e.g., rifleman 0.09 tiles/tick ≈ 2.25 tiles/s). All speeds are exact rationals — no irrational numbers that could desync.
- **Formation:** Move commands place units in a loose line behind the click point; destination is per-unit derived deterministically from a fixed formation pattern (seed = command tick).
- **Collision:** Units cannot overlap; a unit whose path is blocked waits with a short repath timeout (40 ticks). **No physics impulses** — grid occupancy only. This is critical for determinism.
- **Attack-move:** move along path; stop and engage any enemy in vision radius within 2 tiles of path.

---

## 7. Combat

### 7.1 Weapons

| Weapon | Damage | Cooldown | Range | AoE | Targets | Armor Bonus |
|---|---|---|---|---|---|---|
| Rifle | 12 | 10 ticks | 6 tiles | — | Ground | 1.0 |
| Rocket | 25 | 20 ticks | 7 tiles | — | Ground | 2.0 vs armor |
| Walker Cannon | 40 | 15 ticks | 7 tiles | — | Ground | 1.0 |
| AA Missile | 18 | 10 ticks | 8 tiles | — | Air | 1.0 |
| Artillery Shell | 60 | 45 ticks | 12 tiles | 1.5 tiles | Ground | 0.75 (splash) |
| Turret Gun | 20 | 12 ticks | 8 tiles | — | Ground | 1.0 |

- **Hit resolution:** deterministic — damage applied on tick of weapon cooldown expiry. No projectile simulation in v1 (instant hit with visual tracer). Artillerery is the exception: it has a 25-tick flight time, resolved deterministically (impact point derived from target position at fire tick + fixed drift).
- **Health & armor:** `effectiveDamage = damage × armorMultiplier`. Buildings have 1000–3000 HP by tier.
- **Death:** HP ≤ 0 → death event: entity removed, death effects triggered (visual only, non-deterministic), and if it's a supply-granting unit nothing else happens.
- **Auto-engage:** Units with a weapon auto-acquire the nearest enemy within their vision radius when idle or attack-moving. Acquisition order is **deterministic** (nearest, then lowest entity ID) — this ordering rule is a hard determinism invariant.
- **Combat feedback:** hit flashes, HP bar above selection, damage numbers (render-layer only).

### 7.2 Vision & Line of Sight

- **Vision radius:** tiles in Manhattan iso distance (map to a circle approximation for gameplay).
- **No line-of-sight blockers in v1** (buildings don't occlude vision). Fog of war is purely radius-based + shroud (never seen).
- **Alert system:** first enemy sighting triggers an audio/UI ping (alert cooldown per player, e.g., 30 ticks).

---

## 8. Fog of War

| Layer | Meaning | Rendering |
|---|---|---|
| **Revealed** | Currently within friendly vision | Full color |
| **Fog** | Seen before, not currently visible | Dark overlay (entities hidden, terrain visible) |
| **Shroud** | Never seen | Black + edge-fade |

- Fog state is per-player, stored as a per-tile byte (`0=shroud, 1=fog, 2=revealed`).
- The fog board is **synced in lockstep**: it is derived deterministically from vision components, so both clients compute identical fog. No fog messages on the wire.
- Spy/vision boons (future): implemented as vision component changes.

---

## 9. Superweapons (Deferred, Reserved)

- Command Center has a reserved build slot for a future **Orbital Strike** structure. Wire protocol reserves message `S_Upgrade` for it. Not in v1.

---

## 10. Win / Loss Conditions

| Condition | Trigger | Result |
|---|---|---|
| **Win** | Destroy ALL enemy Command Centers AND eliminate all enemy units/buildings | Victory |
| **Loss** | Player loses their last Command Center and their last unit/building | Defeat |
| **Draw** | Both players lose simultaneously (e.g., mutual destruction in same tick) | Draw (rare; resolved by tick ordering) |

- **End condition evaluation:** at end of each tick, in a fixed player order. Deterministic.
- **Auto-surrender option:** player may resign from the pause menu → treated as loss.

---

## 11. Timing & Tick Semantics

- All timers are integer tick counts (`buildTimeTicks = seconds × 25`).
- `now = gameState.tick` is the only clock systems may read.
- Command latency model: player input → command message → host relay → delivered with global tick index → all clients apply at that tick. Late commands are dropped or re-ordered per the lockstep rule (see 04-ARCHITECTURE.md § Lockstep).

---

## 12. Multiplayer Mechanics (LAN)

### 12.1 Lobby

1. **Host:** starts host server → generates **room code** (4-char alphanumeric) + prompts host to set a **passphrase** (min 6 chars, hashed client-side before transmit).
2. **Join:** player enters `host-IP:port`, room code, passphrase → server validates → assigns player slot + team.
3. **Slots:** 2–8 players, teams assigned by host (1v1, 2v2, FFA).
4. **Map selection:** host picks a map from host's disk or any player's upload at lobby stage.
5. **Start:** host presses start → every client gets the map file + starting state → sim begins at tick 0.

### 12.2 Security model (LAN-trusted)

- **Passphrase:** PBKDF2 hash (client-side, fixed salt per room) sent once; server stores only the hash. Prevents accidental/wrong-room joins.
- **Command integrity:** each command is tagged with `(playerID, seq, tick)`. Host drops mismatched/duplicate seqs. A CRC32 checksum of the last N ticks is broadcast periodically; mismatched checksum = **desync → match halts with diagnostic** (see 09-TESTING-AND-QA.md).
- **Trust boundary:** this is NOT a security boundary against a hostile actor on the LAN (no per-command signing in v1). It stops honest mistakes and casual griefers. Recorded in 08-DECISIONS.md.

### 12.3 Disconnects

- Graceful leave → player's forces become idle (no autoplay). If it's the host, migration is **not supported in v1** → match ends, all clients return to lobby with a message.
- Timeout: 5 s without any packet → disconnect. Rejoin mid-match is **not supported in v1**.
