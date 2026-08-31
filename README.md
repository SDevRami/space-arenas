# Space Arenas — RTS Game

A browser-based real-time strategy game inspired by *Command & Conquer: Generals*. Built with an isometric camera, deterministic lockstep multiplayer over LAN, a full Generals-style build tree for one faction, and a standalone map builder tool.

This is a **development-phase build**: all graphics are simple colored shapes rendered through WebGL (PixiJS), and audio is a set of Web Audio API placeholder hooks. The architecture is designed so pre-rendered sprites and real sound assets can be dropped in later without rewriting gameplay logic.

---

## Quick Links

| Document | Purpose |
|---|---|
| [AI-INSTRUCTIONS.md](./AI-INSTRUCTIONS.md) | Instructions for AI assistants / contributors working in this repo |
| [docs/01-GAME-DESIGN-DOCUMENT.md](./docs/01-GAME-DESIGN-DOCUMENT.md) | GDD — core loop, audience, vision, distribution |
| [docs/02-MECHANICS-SPECIFICATION.md](./docs/02-MECHANICS-SPECIFICATION.md) | Controls, economy, combat, win/loss rules |
| [docs/03-TECHNICAL-SPECIFICATION.md](./docs/03-TECHNICAL-SPECIFICATION.md) | Engine, stack, build pipeline, performance budgets |
| [docs/04-ARCHITECTURE.md](./docs/04-ARCHITECTURE.md) | ECS design, game loop, determinism, GC strategies |
| [docs/05-ASSET-PIPELINE.md](./docs/05-ASSET-PIPELINE.md) | Sprite/sound pipeline, atlas packing, preloading |
| [docs/06-DATA-AND-SAVE-SYSTEM.md](./docs/06-DATA-AND-SAVE-SYSTEM.md) | localStorage/IndexedDB, map files, LAN session data |
| [docs/07-IMPLEMENTATION-PLAN.md](./docs/07-IMPLEMENTATION-PLAN.md) | Prototype → Alpha → Beta → Release roadmap |
| [docs/08-DECISIONS.md](./docs/08-DECISIONS.md) | Architecture Decision Records (why things are built this way) |
| [docs/09-TESTING-AND-QA.md](./docs/09-TESTING-AND-QA.md) | Cross-browser, performance, netcode QA strategy |

---

## Locked Architecture Decisions (v1)

| Area | Decision |
|---|---|
| **Rendering** | WebGL 2D via **PixiJS**; simple shapes in dev phase, sprite-ready render layer |
| **Camera** | Isometric projection (2:1 tile ratio), tile-driven world mapping |
| **Netcode** | **Deterministic lockstep** (simulation runs identically on every client) |
| **Transport** | **WebSocket** via a small Node.js host process (`ws` package); host = one player's machine |
| **Security (LAN)** | Passphrase-gated rooms + signed command stream; no heavy crypto, designed for trusted LANs |
| **Factions** | One faction with a full Generals-style build tree |
| **Economy** | Supplies (cash) + Power (energy budget) dual-resource system |
| **Map Builder** | Standalone in-browser tool in the same repo, exporting JSON map files |
| **Language / Build** | **TypeScript + Vite** |

---

## Repository Layout

```
Space Arenas - RTS game - 2.0/
├── README.md
├── AI-INSTRUCTIONS.md
├── docs/                      # All design & engineering documentation
│   ├── 01-GAME-DESIGN-DOCUMENT.md
│   ├── 02-MECHANICS-SPECIFICATION.md
│   ├── 03-TECHNICAL-SPECIFICATION.md
│   ├── 04-ARCHITECTURE.md
│   ├── 05-ASSET-PIPELINE.md
│   ├── 06-DATA-AND-SAVE-SYSTEM.md
│   ├── 07-IMPLEMENTATION-PLAN.md
│   ├── 08-DECISIONS.md
│   └── 09-TESTING-AND-QA.md
├── client/                    # Browser game client (Vite + TypeScript)
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   └── src/
│       ├── main.ts            # Lobby UI, settings, game info catalog
│       ├── core/              # Game loop, determinism, RNG, event bus, pathfinding
│       ├── ecs/               # Entity-Component-System (sparse-set component stores)
│       ├── systems/           # 15 ECS systems (see docs/04 § 1.4)
│       ├── entities/          # Factory functions for buildings/units
│       ├── game/              # Game orchestrator, match config
│       ├── net/               # WebSocket client, binary protocol codec, PBKDF2
│       ├── render/            # PixiJS renderer, camera, minimap, sprites, weather
│       ├── input/             # Mouse/touch input, selection, command mapping
│       ├── ui/                # HUD, chat, controls, graphics settings
│       ├── audio/             # Web Audio placeholder hooks
│       ├── ai/                # Bot AI (difficulty configs, build orders, targeting)
│       ├── mapbuilder/        # In-browser map editor (editor, library, worldmap)
│       ├── stats/             # Per-team combat statistics tracker
│       ├── i18n/              # Internationalization (EN + AR, RTL support)
│       └── i18n/lang/         # Language JSON files
├── host/                      # Node.js host server for LAN sessions
│   ├── package.json
│   ├── src/
│   │   ├── index.ts           # HTTP + WebSocket server, room/lobby relay
│   │   ├── rooms.ts           # Room lifecycle, settings validation, passphrase auth
│   │   ├── relay.ts           # 25 Hz tick relay, command sorting, checksum broadcast
│   │   ├── bots.ts            # Server-side bot stepping
│   │   ├── discovery.ts       # UDP LAN beacon for auto-discovery
│   │   ├── passphrase.ts      # Room code generation, passphrase hashing
│   │   └── qr.ts              # QR code generation for invite links
│   └── tsconfig.json
├── mapbuilder/                # Standalone in-browser map editor (legacy, embedded in client)
│   ├── index.html
│   ├── package.json
│   └── src/
│       └── main.ts
├── shared/                    # Code shared by client, host, and mapbuilder
│   ├── src/
│   │   ├── constants.ts       # Game constants, match settings, overrides
│   │   ├── protocol.ts        # Binary wire-format message types + CRC32
│   │   ├── maps.ts            # Map schema, procedural generation, validation
│   │   ├── rng.ts             # Seeded PRNG (Murmur-like finalizer)
│   │   ├── fixed.ts           # Fixed-point math utilities
│   │   └── balance/           # Buildings, units, weapons, upgrades data tables
│   └── package.json
├── assets/                    # Game sprite PNGs (152 files, directional variants)
├── tests/                     # Vitest test suite (13 files, 121+ tests)
├── scripts/                   # Build/validation scripts
├── tools/                     # CLI utilities (QR generator)
└── package.json               # Root monorepo orchestration (npm workspaces)
```

---

## Quick Start (Current State)

**Phase 2 (Alpha) is complete.** The game is playable with:
- Full build tree (9 buildings, 8 units, 7 weapons, 3 upgrades)
- Dual-resource economy (Supplies + Power)
- A* pathfinding with dirty-region rebuilds
- Fog of war with satellite/laser reconnaissance
- Oil field economy
- Destructible scenery
- Air units with orbit mechanics
- Space laser superweapon
- AI bots (3 difficulty levels)
- LAN multiplayer with passphrase auth + QR invite codes
- Standalone map builder (integrated into client)
- i18n (English + Arabic with RTL support)
- 121+ passing tests (determinism, balance, pathfinding, protocol, etc.)

### Running the Game

```bash
npm install
npm run dev        # Starts Vite dev servers + host server
```

Detailed commands and acceptance criteria live in the roadmap documents above.

---

## Contributing / AI-Assist

Read [AI-INSTRUCTIONS.md](./AI-INSTRUCTIONS.md) before writing any code. It encodes the invariants (determinism rules, ECS conventions, protocol versioning) that all contributors — human or AI — must respect.

---

## Status

**Phase 2 (Alpha) — Complete.** All core gameplay systems are implemented and functional. The game is playable in LAN multiplayer with AI bots, a full build tree, fog of war, pathfinding, oil economy, and a map builder. 121+ tests pass including determinism verification.

**Next: Phase 3 (Beta)** — performance hardening, object pooling, zero-alloc tick audit, cross-browser QA, and packaging.
