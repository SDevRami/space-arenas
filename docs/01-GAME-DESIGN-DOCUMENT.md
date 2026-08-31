# 01 — Game Design Document (GDD)

**Project:** Space Arenas — RTS game
**Version:** 0.1 (Documentation Phase)
**Status:** Draft — supersedes any earlier notes
**Companion docs:** 02-MECHANICS-SPECIFICATION.md (rules), 03-TECHNICAL-SPECIFICATION.md (engineering), 07-IMPLEMENTATION-PLAN.md (roadmap)

---

## 1. Vision Statement

**Space Arenas** is a browser-based real-time strategy game that recreates the core feel of *Command & Conquer: Generals* — base building, resource economy, combined-arms unit production, and tense tactical combat on an isometric battlefield — engineered from the ground up for **deterministic lockstep multiplayer over a LAN**.

The first release is intentionally a **faithful, simplified re-implementation of the Generals formula** with a single playable faction and a complete build tree. The underlying architecture is designed to be the foundation for years of future updates: faction asymmetry, pre-rendered sprites, richer audio, more game modes, and eventually wider multiplayer scenarios.

The development-phase build uses **simple colored shapes** for graphics and **placeholder synth sounds**, letting the team validate *gameplay, netcode, and architecture* before any visual/audio asset production begins.

---

## 2. High-Level Game Description

- **Genre:** Real-Time Strategy (RTS)
- **Perspective:** Isometric camera (fixed-angle projection, free pan + zoom)
- **Sessions:** 2–8 players over a LAN; one player hosts, others join
- **Match structure:** Command Center → Power → Supply → production → army → destroy enemy base
- **Victory:** Destroy all enemy Construction/Command buildings, or eliminate every enemy unit and building.
- **Economy:** Supplies (cash) harvested from supply points on the map, spent on units/buildings/upgrades; Power budget gates which buildings can function.

---

## 3. Core Gameplay Loop

```
┌────────────────────────────────────────────────────────────┐
│                    1 MINUTE LOOP                           │
│  Scout map edge ▸ harvest supply ▸ build power ▸ expand    │
│  production ▸ queue units ▸ attack / defend                │
└───────────────────────────────┬────────────────────────────┘
                                │
┌───────────────────────────────▼────────────────────────────┐
│                    1 MATCH LOOP                            │
│  Early game: economy + scouting                            │
│  Mid game:   force composition, tech, map control          │
│  Late game:  decisive battle, base destruction             │
└───────────────────────────────┬────────────────────────────┘
                                │
┌───────────────────────────────▼────────────────────────────┐
│                  PROGRESSION LOOP (future)                 │
│  v1: matches are self-contained (no meta progression)      │
│  Future: ranked ladders, map packs, cosmetic unlocks       │
└────────────────────────────────────────────────────────────┘
```

### Core loop details

1. **Build:** Place the Command Center, then Power Plants to unlock supply and production structures.
2. **Harvest:** Supply structures (Supply Dock / Harvester units) pull cash from map supply fields into the player's treasury.
3. **Produce:** Barracks produce infantry, War Factory produces vehicles, both consume cash and power.
4. **Fight:** Units auto-engage when ordered to attack or when enemies enter their vision radius; the player micro-manages with RTS controls.
5. **Control:** Fog of war hides enemy activity until units/buildings with vision reveal it. Map control = economy control.
6. **Win:** Eradicate the enemy's Command/Construction structure or their entire force.

---

## 4. Target Audience

| Segment | Description | Priority |
|---|---|---|
| **Primary** | RTS veterans (Generals, C&C, StarCraft, AoE players) who want a free, LAN-capable, browser-based fix | High |
| **Secondary** | Groups of friends playing on the same network (offices, dorms, LAN parties, game nights) | High |
| **Tertiary** | RTS newcomers onboarding through the map builder and skirmish vs. future AI | Medium |

### Audience-driven requirements

- **LAN-first:** Host-and-join within seconds on a shared network; zero cloud account setup.
- **Low hardware floor:** Runs on office laptops; simple shapes guarantee no GPU dependency beyond WebGL 1.
- **Familiarity:** Reuses the Generals mental model so veterans feel at home instantly.
- **Accessibility:** Keyboard + mouse, rebindable controls, zoom, on-screen build menu, minimap.

---

## 5. Game Modes (v1)

| Mode | Players | Notes |
|---|---|---|
| **Skirmish (LAN)** | 2–8 | The core mode. One host, others join via room code + passphrase. |
| **Map Builder** | 1 | Standalone tool. Paint terrain, place supply fields and starting positions, export JSON. |
| **Local test mode** | 1 | Run two (or more) simulated players on one machine; primarily for development and testing lockstep. |

Future: skirmish vs AI, co-op vs AI, ranked ladder, replays.

---

## 6. Aesthetic Vision

### Development phase (v1)

- **Graphics:** Flat-colored polygons via PixiJS. Each unit/building type has a distinct silhouette + accent color, size-scaled by role (infantry ≈ 1 tile, vehicles 1–2 tiles, buildings 2–4 tiles).
- **Terrain:** Isometric tile grid with per-tile base color + subtle height tint. Supply fields are visually distinct clusters.
- **Team colors:** Player 0 = blue, player 1 = red, player 2+ = green/yellow/purple/cyan. Team color overlays all owned entities.
- **Feedback:** Selection rings, movement waypoints, build progress bars, damage flashes, attack tracers — all simple shapes.

### Production phase (future)

- **Pre-rendered sprites:** Units/buildings as sprite-sheet animations (idle, walk, attack, death), terrain tilesets, building damage states.
- **Effects:** Explosions, muzzle flashes, smoke, fog of war edge gradients.
- **UI skinning:** Replaces the default dev HUD.
- The render layer from v1 is designed so swapping a shape factory for a sprite factory is a drop-in change (see 05-ASSET-PIPELINE.md).

### Audio (placeholder now)

- Web Audio API synth hooks: `unit.trained`, `building.placed`, `combat.hit`, `combat.explosion`, `economy.supply`, `ui.click`, `net.join`, `net.leave`. Each is a short procedural blip. Replaceable with real assets later (see 05-ASSET-PIPELINE.md § Audio).

---

## 7. Player Experience (The "Feel")

- **Responsive:** < 100 ms from click to command acknowledgment; client-side prediction hides lockstep latency.
- **Legible:** Every entity reads instantly from silhouette + team color; build costs visible before placement.
- **Fair:** Deterministic sim + LAN latency (typically < 5 ms) means no rubber-banding, no host advantage beyond simulation of the tick clock.
- **Approachable:** Default hotkeys match Generals conventions; a pause menu lists every control.

---

## 8. Monetization & Distribution

### v1 (this phase)

- **Free, open, local.** No monetization. Distribution is the repo + a `npm run` start script; host launches server, friends connect to `host-IP:port`.

### Future options (non-binding, recorded for architecture awareness)

- **Cosmetic-only store** (team colors, decals, map tilesets) — must not affect balance. Deterministic sim requires cosmetics to be render-layer only.
- **Map pack DLC / workshop-style sharing** — maps are JSON files; a marketplace would host these JSON files, gated by validation.
- **Optional hosted matchmaking** — the LAN host protocol is transport-agnostic; a hosted broker could route WebSocket sessions later without changing the lockstep core.
- **Ads are not planned** — the game is designed for LAN party use and offline play.

---

## 9. Scope Guardrails (What v1 Is NOT)

| Not in v1 | Why |
|---|---|
| Three asymmetric factions | Balance + content scope; one faction proves the systems |
| Real sprites/audio assets | Dev phase uses shapes/placeholders by design |
| Cloud/hosted multiplayer | LAN-only; protocol is broker-ready later |
| Campaign / missions | Skirmish + map builder only |
| AI opponent | Added in Beta/Release phase as stretch |
| Replays / spectator | Post-release feature; wire format leaves room |
| Mobile / touch | Desktop first |

---

## 10. Success Metrics (Design)

| Metric | Target (v1) |
|---|---|
| Time from lobby to first unit trained | < 4 minutes on default map |
| Average match length | 12–25 minutes (2v2) |
| Ping-of-death desync rate | 0 across 200 consecutive LAN matches |
| First-click responsiveness | < 100 ms perceived |
| Max simultaneous units at 60 FPS | ≥ 400 on mid-range hardware |

---

## 11. References & Inspirations

- **Command & Conquer: Generals / Zero Hour** — primary inspiration: build flow, economy, faction roles, World Builder.
- **StarCraft** — feedback density, hotkey design, unit clarity.
- **Age of Empires** — map/placement conventions, control group ergonomics.
- **Factorio** (technical) — deterministic headless simulation patterns; belt/grid performance mindset.

---

## 12. Open Design Questions (Tracked)

These are deferred and recorded here so they aren't silently decided by code:

1. Exact unit roster size for v1 (baseline target: ~12 units + ~8 buildings, mirroring Generals' core). *Being finalized in 02.*
2. Whether supply trucks auto-route or are micro'd (baseline: Generals-style auto route with waypoint override).
3. Whether fog of war includes "shroud" (never-seen) vs "fog" (seen-then-hidden) — baseline: both, shroud = black, fog = dark overlay.
4. Superweapons (Generals' particle cannon / nuke) — deferred to post-v1; the Command Center will have a build slot reserved for it.
5. Default map sizes: target 128×128 tiles, builder supports 64–256.
