## (a) Online Server — lobby panel (placeholder UI)

### What was added
- New lobby sidebar button **Online Server** (`#tab-online`, i18n `lobby.tab.online`) and panel `#online-panel` in `client/index.html`.
- Panel groups inputs into two columns:
  - **Account**: user name, email, password.
  - **Server**: server link (`wss://…`), database link, server region select (auto / EU / NA / Asia / Middle East / Africa / South America / Oceania).
- Action buttons: **Log in**, **Register**, **Change password**, **Connect**, **Refresh**, plus **+ Create match**, **Join selected**, **Clear table**.
- **Current matches** table (`#online-matches-table`) with columns Room / Map / Players / Status, rendered by `renderOnlineMatches()` in `client/src/main.ts`.

### Behaviour
- All account/server/matchmaking buttons are **wire-only placeholders**: they write a "coming soon" status line (`online.planned`) into `#online-status`. No backend logic, networking or database code was added — the inputs document the planned flow.
- **Refresh** re-renders the empty matches table and shows `online.refreshed`; **Clear table** re-renders the empty state.
- i18n keys added to `client/src/i18n/lang/en.json` and `ar.json` under `online.*`.

### Codebase fit
- Reuses the existing panel system exactly: sidebar button + `hidden-panel` div, plus `setTab()` wiring in `client/src/main.ts` (the `'online'` tab was added to the union type at `setTab`).
- Reuses existing CSS vocabulary (`.panel`, `.ghost`, `.hint`, `.status`, `.net-empty`) and adds small scoped styles (`.online-grid`, `.online-acc`, `.online-actions`, `.lobby-table`).
- No real "online server" module existed before, so nothing interacts with the host/NetClient yet. The table is the intended anchor for future matchmaking.

---

## Sea Army (L+, blocked until core is stable)

**4a** — Naval units (destroyer, submarine, carrier, frigate, missile-boat).
- Full sea-rotation: underwater units, torpedo weapons, naval landing ops.
- Requires sea-only maps, new terrain type `SeaTile`, underwater fog system.
- Naval production building (dock), water obstacles + shoreline mechanics.
- Blocked: needs balanced core ground/air combat first; large scope.

---

## Online Server Backend

- Replace stub account/matchmaking handlers with real WebSocket server.
- Ranked ladder play, persistent player accounts, cloud match history.
- **Cloud profile** (#14 partial): sync stats/achievements across devices.
- Server-side replay validation, anti-cheat.
- **Match replays for online matches** — offline and LAN matches already record `ReplayData` (offline: client-side at `game-over`, uploaded to the host archive; LAN: host `endMatch` saves `relay.history`). When real online matches run through the server, the server should record the relayed command log into the same `ReplayData` format and expose it via a per-account match-history API (list / play / download), instead of the host's local `archive/` folder.

---

## Cloud Mods

**N7c** — Online mod repository: browse, rate, download balance mods.
- Requires online server + account system.
- Community voting, mod versioning, dependency resolution.

