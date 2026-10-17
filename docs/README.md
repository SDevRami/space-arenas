# Space Arenas — Documentation

**Status:** Living documentation — mirrors the code in this repository.
**Language:** English (the game UI ships English + Arabic; these docs are English only).

This folder is the complete, code-grounded reference for **Space Arenas**, a
browser-based real-time strategy game. Every document describes a real part of the
current codebase: what it does, why it exists, and the exact rules/conditions it
enforces. When the docs and the code disagree, **the code is the source of truth** —
please update the doc alongside the change.

---

## How to read these docs

| If you want to… | Start here |
|---|---|
| Understand the game as a player | [01 — Game Design Document](01-GAME-DESIGN-DOCUMENT.md), [15 — Content & Progression](15-CONTENT-AND-PROGRESSION.md) |
| Understand the rules/simulation | [02 — Mechanics](02-MECHANICS-SPECIFICATION.md), [04 — Architecture](04-ARCHITECTURE.md) |
| Work on the client (render/audio/input/UI) | [17 — Rendering, Audio & Input](17-RENDERING-AUDIO-INPUT.md), [14 — Lobby & UI](14-LOBBY-AND-UI.md) |
| Work on networking / the servers | [16 — Netcode & Online](16-NETCODE-AND-ONLINE.md), [12 — Online Anti-Cheat](12-ONLINE-ANTI-CHEAT.md) |
| Work on data, saves and progression | [06 — Data & Save System](06-DATA-AND-SAVE-SYSTEM.md), [15 — Content & Progression](15-CONTENT-AND-PROGRESSION.md) |
| Build, test or ship | [03 — Technical Spec](03-TECHNICAL-SPECIFICATION.md), [09 — Testing & QA](09-TESTING-AND-QA.md), [18 — Dev Tooling](18-DEV-TOOLING.md) |
| Understand *why* a choice was made | [08 — Decisions (ADR)](08-DECISIONS.md) |
| See what's next | [07 — Implementation Plan](07-IMPLEMENTATION-PLAN.md) |

---

## Index

| # | Document | Covers |
|---|---|---|
| 01 | [Game Design Document](01-GAME-DESIGN-DOCUMENT.md) | Vision, audience, core loop, game modes, aesthetic direction. |
| 02 | [Mechanics Specification](02-MECHANICS-SPECIFICATION.md) | Simulation rules: economy, power, production, combat, vision, abilities, win/loss. |
| 03 | [Technical Specification](03-TECHNICAL-SPECIFICATION.md) | Stack, targets, performance budgets, monorepo layout, build pipeline. |
| 04 | [Architecture](04-ARCHITECTURE.md) | ECS-lite model, the tick loop, system pipeline order, state management, determinism. |
| 05 | [Asset Pipeline](05-ASSET-PIPELINE.md) | Where assets live (`client/dist`), shapes→sprites, manifests, sound, validation. |
| 06 | [Data & Save System](06-DATA-AND-SAVE-SYSTEM.md) | Every localStorage key / IndexedDB store, schema versioning, backups. |
| 07 | [Implementation Plan](07-IMPLEMENTATION-PLAN.md) | Shipped status of each phase + the roadmap ahead. |
| 08 | [Decisions (ADR)](08-DECISIONS.md) | Accepted architecture decision records and their rationale. |
| 09 | [Testing & QA](09-TESTING-AND-QA.md) | Test suites, determinism/soak testing, desync triage, CI gating. |
| 10 | [3D Graphics Tier Research](10-3D-GRAPHICS-TIER-RESEARCH.md) | Research report: options for adding a "3D" visual tier (not shipped). |
| 11 | [Sound FX Generation](11-SOUND-FX-GENERATION.md) | How baked WAV sound effects are generated and wired. |
| 12 | [Online Anti-Cheat](12-ONLINE-ANTI-CHEAT.md) | Threat model, tamper watch, what it does and does not protect. |
| 13 | [Map Publishing Plan](13-MAP-PUBLISHING-PLAN.md) | Plan for sharing community maps through the online server. |
| 14 | [Lobby & UI](14-LOBBY-AND-UI.md) | The lobby shell: landing screen, slideshow, collapsible menu, tabs, Settings, Credits, match options. |
| 15 | [Content & Progression](15-CONTENT-AND-PROGRESSION.md) | Buildings/units/upgrades/weapons rosters, superweapons, veterancy, XP, ranks, daily missions, achievements. |
| 16 | [Netcode & Online](16-NETCODE-AND-ONLINE.md) | Deterministic lockstep, protocol, LAN host relay, online server, mods, settings layers, replays. |
| 17 | [Rendering, Audio & Input](17-RENDERING-AUDIO-INPUT.md) | PixiJS render pipeline, camera/minimap, weather/day-night, the audio system, and all input. |
| 18 | [Dev Tooling](18-DEV-TOOLING.md) | npm scripts, asset validator, sound synth, i18n checks, the dev-settings form registry. |

---

## The game at a glance

```
┌──────────────┐   deterministic commands    ┌───────────────────────────┐
│   Client     │ ──────────────────────────▶ │  Shared simulation core   │
│ (browser)    │ ◀────────────────────────── │  (shared/src + core/systems)│
└──────┬───────┘        state hashes         └───────────────────────────┘
       │
       │ WebSocket (binary protocol)
       ▼
┌──────────────┐        ┌──────────────────┐        ┌──────────────────┐
│  LAN host    │        │  Online server   │        │  Supabase (DB)   │
│  host/       │        │  online/         │ ─────▶ │  accounts, mods, │
│  relay+rooms │        │  Express API     │        │  backups, maps   │
└──────────────┘        └──────────────────┘        └──────────────────┘
```

- **Client** (`client/`) — Vite + TypeScript + PixiJS. Owns rendering, audio, input,
  the lobby/UI shell and the *simulation itself* (the sim runs on every peer).
- **Shared** (`shared/`) — the deterministic core types, constants, balance tables,
  protocol definitions, settings-file layers and mod format, used by every workspace.
- **LAN host** (`host/`) — a Node server that lists rooms, relays binary frames and
  acts as a pure relay (no authoritative simulation), plus bots, QR invites and the
  static file server for the built client (`client/dist`).
- **Online server** (`online/`) — an Express API on Render backed by Supabase:
  accounts, match browser, leaderboard, mod repository, encrypted progress backups
  and replays.

The simulation is **deterministic lockstep**: every peer runs the identical
simulation from identical inputs, and only commands + state hashes cross the wire.
See [04 — Architecture](04-ARCHITECTURE.md) and [16 — Netcode & Online](16-NETCODE-AND-ONLINE.md).

---

## Documentation conventions

- **Header:** each doc starts with `# NN — Title` and a `**Status:**` line.
- **Grounded claims:** paths and identifiers are written in backticks
  (e.g. ``client/src/core/Simulator.ts``, ``SIM_TICK_HZ``) so you can grep the code.
- **Status labels:** `Shipped` / `In progress` / `Planned — not yet implemented`.
  Anything not in the code is explicitly marked as planned.
- **Tables** carry data (unit/building stats, protocol messages, storage keys);
  **bullet lists** carry rules and conditions.

---

## Internal helpers (intentionally not in this folder's tracked docs)

Two development helper scripts and a dev-settings form dump live in `docs/` locally
but are **git-ignored**; their knowledge is captured in
[18 — Dev Tooling](18-DEV-TOOLING.md):

- `docs/check-i18n.cjs` — verifies EN/AR i18n key completeness.
- `docs/check-registry-i18n.cjs` — verifies the dev-settings registry/i18n parity.
- `docs/dev-form-block.txt` — a dump of the dev-settings form block.
