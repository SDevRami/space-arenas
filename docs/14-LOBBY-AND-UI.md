# 14 — Lobby & UI

**Status:** Shipped — documents the lobby shell, tabs, Settings, Dev Settings, Credits and match options as implemented in `client/src/main.ts`, `client/index.html` and the settings modules under `client/src/ui/`.

This document covers the pre-game **lobby shell** — the landing screen, background
slideshow, collapsible side menu, tab routing, Settings and Dev Settings panels,
Credits, and the match-option sections — plus the shared toggles that decide whether
a match feeds daily missions and profile achievements. In-match HUD rendering lives
in [17 — Rendering, Audio & Input](17-RENDERING-AUDIO-INPUT.md); tab *content* that
belongs to networking/mods/archive is only summarised here.

---

## 1. Shell layout (`client/index.html`, `#lobby`)

- `#lobby` is the full-screen lobby container; it always starts with class `menu-closed`
  (line 151), so the **landing page shows first** and the side menu stays hidden until
  opened.
- `#lobby-bg` is the slideshow backdrop (line 152).
- `#lobby-landing` is the landing overlay: `#lobby-logo` (placeholder `logo.png`,
  hidden on load error), `#lobby-open-menu` ("Open Menu") and
  `#lobby-landing-credits` ("Credits") (lines 153–160).
- `#lobby-menu-toggle` (☰) is the floating menu button (line 164).
- `#lobby-quick-mute` is the floating quick-mute icon, rendered last inside `#lobby`
  (line 889).

### 1.1 Side menu open/close rules

- `openLobbyMenu()` (in `client/src/main.ts`) removes `menu-closed` from `#lobby` and
  **always** calls `setTab('offline')` — opening the menu always lands on Offline.
- `closeLobbyMenu()` adds `menu-closed` back (returns to the landing page).
- `#lobby-menu-toggle` and `#lobby-open-menu` both call `openLobbyMenu()`.
- `#lobby-close-menu` (✕) and `#credits-close` both call `closeLobbyMenu()`.
- `#lobby-landing-credits` removes `menu-closed` **and** switches to `setTab('credits')`
  directly (so the Credits panel is visible immediately).

### 1.2 Background slideshow

| Constant | Value | Meaning |
|---|---|---|
| `LOBBY_BG_COUNT` | `5` | Number of images `background/bg_1.png` … `background/bg_5.png` |
| `LOBBY_BG_SLIDE_MS` | `8000` | Milliseconds each slide is active before advancing |
| `LOBBY_BG_FADE_MS` | `1500` | Cross-fade duration between slides |

- `buildLobbySlides()` creates one `div.lobby-slide` per image and **shuffles** an
  index order, so the *first* image is random each session (`lobbySlideOrder`).
- `startLobbySlideshow()` activates index 0 of the shuffled order and starts an
  `setInterval` that advances `lobbySlideIdx = (idx + 1) % order.length` every
  `LOBBY_BG_SLIDE_MS`, wrapping forever (loop).
- `activateLobbySlide(n)` sets a **random** Ken Burns transform per slide:
  `--kb-x` / `--kb-y` in `randRange(-6, 6)%` and `--kb-scale` in
  `randRange(1.12, 1.24)`, plus `--kb-dur = SLIDE_MS + FADE_MS` and
  `--kb-fade = FADE_MS`. It forces a reflow (`slide.offsetWidth`) so the animation
  restarts from the beginning each time.
- `stopLobbySlideshow()` clears the timer; `startLobbySlideshow()` is a no-op if the
  timer is already running (safe to call repeatedly from `showLobby()`).
- **Blur when menu open:** when `#lobby` does **not** have `menu-closed`, the CSS rule
  `#lobby:not(.menu-closed) #lobby-bg` applies `filter: blur(7px) saturate(0.85)
  brightness(0.72)` and `transform: scale(1.05)` — the slideshow stays visible but
  defocused behind the open menu. Closing the menu removes those styles.

---

## 2. Tabs

`setTab(which)` toggles `hidden-panel` on every panel and `active` on every tab
button. The `which` union (from `client/src/main.ts` line 144) is:

`offline | network | match | online | mapbuilder | info | settings | dev | profile | archive | mods | credits`

| Tab ID | Panel ID | Notes |
|---|---|---|
| `#tab-offline` | `#offline-panel` | Default tab; active on menu open |
| `#tab-network` | `#network-panel` | Clicking "Network Play" while inside a joined lobby match keeps you on `#match-panel` (`setTab(lobbyState ? 'match' : 'network')`) |
| (none — hidden) | `#match-panel` | Match Options; shown when `lobbyState` exists (`setTab('match')`), no side-button |
| `#tab-online` | `#online-panel` | Server browser; refreshes match list on show (`refreshOnlineList()`) |
| `#tab-mapbuilder` | `#mapbuilder-panel` | |
| `#tab-info` | `#info-panel` | 13 in-panel sub-tabs via `#info-tabs` |
| `#tab-settings` | `#settings-panel` | Language, Graphics, Audio, Controls (§ 4) |
| `#tab-dev` | `#dev-panel` | Dev Settings form (§ 5) |
| `#tab-profile` | `#profile-panel` | Career stats + achievements (`onProfileTabShown()`) |
| `#tab-mods` | `#mods-panel` | Balance mods list |
| `#tab-archive` | `#archive-panel` | Saved replays (`refreshArchive()` on show) |
| (none) | `#credits-panel` | Reached **only** from `#lobby-landing-credits` on the landing screen; **no `#tab-credits` button exists** |

Side-effects per tab on show: `online` → `refreshOnlineList()`; `match` →
`renderMatchDaily()`; `profile` → `onProfileTabShown()`; `archive` →
`refreshArchive()`; `mods` → `refreshMods()`.

### 2.1 `#tab-mobile` (not a `setTab` tab)

- `#tab-mobile` toggles `body.mobile-mode` and stores `'1'` under
  `space-arenas:mobile-mode` (removed when off).
- It is **not** part of `setTab`; it only toggles a body class / button `active`
  state. It re-reads the stored flag at boot.

### 2.2 Game Info sub-tabs (`#info-tabs`)

`start` (Getting Started) · `units` · `buildings` · `power` · `combat` · `vision` ·
`sea` · `tech` · `super` · `bots` · `maps` · `mods` · `online` — rendered into
`#info-content` by `renderActiveInfoTab()`.

---

## 3. Quick mute

- Element: `#lobby-quick-mute` (button).
- `renderQuickMute()` sets `textContent` to `🔇` when muted, `🔊` otherwise, toggles
  the `muted` class, and sets `title` from `t('lobby.unmuteAll' | 'lobby.muteAll')`.
- The click handler calls `setMuted(!getAudio().muted)` (toggles the global master
  mute in `client/src/audio/settings.ts`).
- It re-renders on `onChangeAudio(renderQuickMute)` **and**
  `onLangChange(() => renderQuickMute())` so icon/tooltip stay in sync with volume
  and language changes.

---

## 4. Settings panel (`#settings-panel`)

Static markup in `client/index.html` (lines 760–790), populated dynamically.

### 4.1 Language

- Buttons `#lang-en` ("English") and `#lang-ar` ("العربية").
- `applyLang(lang)` → `setLang(lang)` (persists `space-arenas:lang`), then
  `translateStatic()` (walks `[data-i18n]`, `[data-i18n-placeholder]`,
  `[data-i18n-title]`) and `syncLangButtons()`.
- `initLang()` runs at boot: `ar` is adopted only if stored exactly `'ar'`, else `en`.
- `setLang` sets `document.documentElement.lang` and `dir` — **`ar` → `dir="rtl"`**,
  `en` → `dir="ltr"` (`client/src/i18n/index.ts` `applyLangAttrs()`), and updates
  `document.title`.
- On language change, `refreshLobbyTexts()` and `renderModPickers()` re-render
  non-static text (`onLangChange` handler in `main.ts`).
- Fallback: `t(key)` looks up the active dict, falls back to `en`, then returns the
  key itself.

### 4.2 Graphics section (`#graphics-*`)

Rendered by `client/src/ui/graphics-settings.ts` (`initGraphicsSettings()` →
`renderGraphicsList`):

- `#graphics-quality-line` — current quality line.
- `#graphics-effects` — effect/option rows (weather chips `WEATHERS`,
  `hudIconSize` number 8–64, UI scale, …) driven by `EFFECT_ROWS` /
  `getGraphics()`.
- Weather chips write `setWeather(...)` (`none | rain | snow | thunder`).
- `uiScale` is applied live to every container in `UI_SCALE_TARGETS` (hud,
  overlays, `#lobby`, …) via `el.style.zoom`.
- `#graphics-status` shows `settings.graphics.saved` feedback.

### 4.3 Audio section (`#audio-settings`)

Rendered by `client/src/ui/audio-settings.ts` (`initAudioSettings()`). Rows (in
order): **sliders** Master, Effects, Lobby ambient, Music, In-match ambient;
**toggles** Mute, Music mute, Ambient on, Haptics. Each row writes the matching
setter in `client/src/audio/settings.ts` (`setMaster`, `setEffects`, `setAmbient`,
`setMusic`, `setAmbientInMatch`, `setMuted`, `setMusicMuted`, `setAmbientEnabled`,
`setHaptics`). A summary line shows the effective volumes
(`settings.audio.effective`) recomputed by `refreshEffective()`.

### 4.4 Controls section (`#ctrls-*`)

- `#ctrls-change` opens the rebinding overlay, `#ctrls-info` opens the controls-info
  overlay, `#ctrls-restore` calls `restoreDefaultBindings()` (removes
  `space-arenas:controls` and resets `DEFAULT_BINDINGS`).
- Keyboard rows are rebindable (`changeBinding` swaps duplicates); mouse rows
  (`select`, `box`, `ctrl`, `move`, `pan`, `zoom`, `minimapJump`, `edgePan`) are
  **reference-only** (fixed). Slot rows `slot:1`…`slot:9` and the `groupMod`
  modifier row come from `slotRows()` / `groupModRow()`
  (`client/src/ui/controls.ts`).

---

## 5. Dev Settings panel (`#dev-panel`)

Static toolbar (lines 792–816) + form `#dev-settings-form` built by
`buildDevForm()` in `client/src/main.ts`. The data model is
`shared/src/dev-settings-registry.ts`.

### 5.1 Keys and layering

| Key | Constant | Content |
|---|---|---|
| `space-arenas:dev-settings` | `DEV_STORAGE_KEY` | Session **overrides** (`devOverrides: Partial<MatchSettings>`) |
| `space-arenas:dev-defaults` | `DEV_DEFAULTS_KEY` | Saved **defaults** (`savedDefaults`) |
| `space-arenas:dev-client-defaults` | `DEV_CLIENT_KEY` | Local mirror of `profile/settings.json` `client` block |

- Effective values: `resolvedDevSettings()` = `mergeMatchSettings(layerDevSettings(savedDefaults, devOverrides))`
  — `savedDefaults` is the base, `devOverrides` deep-merges on top (the four
  `*Overrides` maps merge per-id/per-field).
- `settingsDefaultsHash()` fingerprints `mergeMatchSettings(savedDefaults)` (the
  effective *defaults*, without session overrides) and is broadcast so host and
  clients can detect mismatched bases before a match.
- On boot: `dev-defaults` → `savedDefaults`, `dev-settings` → `devOverrides`,
  `dev-client-defaults` → `settingsFile.client`; then `buildDevForm()` and
  `loadSettingsFile()` fold in the host's `profile/settings.json` (local data
  always wins).

### 5.2 Form structure (`buildDevForm()`)

- **Synced sections** from `DEV_SCALAR_SECTIONS` (economy, satellite, power, laser,
  superWeapon, fog, abilities, stealth, dayNight, mines, heal, worldFields, movement,
  combat, veterancy, planes, pathfinding) — each becomes `details.dev-group` with a
  `dev-table`. `fog` also emits an `fogMode` select row.
- **Override groups:** Buildings, Units, Weapons, Upgrades — one
  `details.dev-object` per entity with rows from `DEV_OVERRIDE_*_FIELDS`.
- **Client-only sections** (group `client`) — presentation values from
  `getGraphics()` (e.g. `buildingFill`, unit scales, projectile sizes, minimap,
  zoom, `uiScale`, sprite layer order) that never reach the host.
- Row commit: if the entered value equals the default it clears the override
  (`clearDevScalar` / `clearDevOverride`); otherwise it stores `SECONDS_TO_TICKS(v)`
  when `seconds: true`, else the raw value.

### 5.3 Toolbar filters

- `#dev-search` (text) → `devFilterText`.
- `.dev-tab` group buttons `data-dev-group = all | synced | client` → `DevGroup`.
- `#dev-modified` checkbox ("Modified only") → `devFilterModified`.
- `applyDevFilters()` hides each `tr.dev-row` failing **all three** filters
  (`dev-row-hidden`) and hides any `details.dev-group` with no visible rows.

### 5.4 Action buttons

| Button | ID | Behaviour |
|---|---|---|
| Save changes | `#dev-save` | `saveDevOverrides()` → localStorage; flushes folder backup (`saveLocalProfile()`), optional silent cloud dev-backup, `pushDevSettingsToHost()` |
| Export as Mod | `#dev-export` | Prompts for a name, builds `modFromSettings(resolvedDevSettings(), …)` and downloads `<name>.json`; also POSTs `/api/mods/upload` (reports "no host" offline) |
| Reset to defaults | `#dev-reset` | `devOverrides = {}` (keeps `savedDefaults`), rewrites key, pushes to host |
| **Save as default** | `#dev-save-default` | Confirms, then **snapshots** `resolvedDevSettings()` into `savedDefaults`, clears `devOverrides`, writes both `dev-defaults` and `dev-client-defaults`, and mirrors into `profile/settings.json` (`user = savedDefaults`, `client = clientDevSettings()`, preserving `builtin`) via `/api/settings` |
| Close all sections | `#dev-collapse` | Sets every `details` in the form to `open = false` |

`pushDevSettingsToHost()` publishes `resolvedDevSettings()`, `settingsDefaultsHash()`
and `wireClientDevSettings()`; when this client is the room host it also
`updateRoom({ settings })`.

---

## 6. Credits panel (`#credits-panel`)

- Static content (lines 876–887): title `credits.h1`, paragraphs `credits.intro`,
  `credits.author`, `credits.builtWith`, `credits.thanks`, and a
  `#credits-close` button.
- Opened from the landing screen (`#lobby-landing-credits` → remove `menu-closed` +
  `setTab('credits')`); `#credits-close` calls `closeLobbyMenu()` (back to landing).

---

## 7. Lobby music and volume/mute

- `client/src/audio/lobby-music.ts` loads
  `${BASE_URL}sound/SPACE.ARENAS_by_SDEVRAMI.mp3` into an `HTMLAudioElement` with
  `loop = true` — **lobby only**; it is stopped on match start (`stopLobbyMusic()`).
- `startLobbyMusic()` is called from `showLobby()` (only when `lobbyAmbientUnlocked`).
- Fade in/out uses `FADE_MS = 1200`; live volume/mute changes fade over `300 ms`
  (`syncVolume()` on `onChangeAudio`).
- Target volume = `musicVolume()` = `master × music`, or `0` when `muted` or
  `musicMuted` (`client/src/audio/settings.ts`).
- Autoplay is retried on the next unlock (`tryPlay()`); a locked context is ignored.

---

## 8. Match-option `match-section` collapsibles

- Option blocks in `#offline-panel` and `#match-panel` are `<details class="match-section">`
  (Map, Progression, Match settings, Balance mod, Players & win condition, …).
- Each panel has a **Close all sections** button: `#offline-collapse` /
  `#match-collapse` → `collapseSections(panelId)` sets `s.open = false` for every
  `details` inside that panel.

### 8.1 Offline modes (`#offline-mode-list`)

- Buttons with `data-mode`: `bots` (Bots Match, default/`active`) and `campaign`.
- `setOfflineMode(mode)` toggles `.active`, shows `#offline-options` +
  `#offline-daily-extras` only for `bots`, and shows `#offline-campaign-extras`
  only for `campaign`.
- `offlineMode` defaults to `'bots'`.
- Starting a **campaign** match shows `campaign.comingSoon` — the scripted campaign
  is **Planned — not yet implemented** (placeholder section).

### 8.2 Offline extras

- `#offline-daily-extras` — daily header (`#daily-day-label`,
  `#daily-level-label`), mission list `#daily-missions-list`, plus the two tracking
  toggles (§ 9).
- `#offline-mods-picker` — `#offline-mod-toggle` + `#offline-mod-select`
  (`space-arenas:offline-mod`).
- Shared match fields: `#start-credits`, `#start-weather`, `#start-fog`,
  `#start-daynight`, `#win-rule` + `#win-rule-desc`, `#players-list`,
  `#add-bot-btn`, `#start-btn`, `#offline-status`.

---

## 9. Progression tracking toggles

Two independent opt-in switches exist in each launch path, read as
`trackDaily` / `trackProfile`:

| Context | Daily toggle | Profile toggle | Hint elements |
|---|---|---|---|
| Offline (bots) | `#daily-accept-toggle` | `#match-profile-toggle` | `#daily-accept-hint`, `#match-profile-hint` |
| Shared match panel (LAN + online) | `#match-daily-toggle` | `#match-achieve-toggle` | `#match-daily-hint`, `#match-achieve-hint` |

- `updateTrackingHints()` rewrites all four hint strings from
  `daily.acceptOn/Off` and `daily.profileOn/Off` on every toggle change and on
  re-render (`renderMatchDaily()`).
- Offline config reads the offline toggles (`trackDaily: dailyAcceptToggle.checked`,
  `trackProfile: matchProfileToggle.checked`); net/online reads
  `netTrackingOpts()` (`trackDaily: netDailyToggle.checked`,
  `trackProfile: netProfileToggle.checked`).
- Rules:
  - **Daily** — the mission list is attached to every bots match, but only counts
    (live Mission popup + XP on finish) when the Accept toggle is on.
  - **Profile** — decides whether the match feeds counters, history and
    achievements at all (`recordProfileMatch()` returns early when off).
  - The shared match-options toggles mirror the offline block and are used for
    LAN/online matches (`netTrackingOpts()`).

---

## 10. i18n / RTL

- All static text carries `data-i18n` / `data-i18n-placeholder` / `data-i18n-title`;
  `translateStatic()` re-applies them on language change.
- Dictionaries: `client/src/i18n/lang/en.json` and `ar.json`.
- **Arabic enables RTL:** `document.documentElement.dir = 'rtl'` for `ar`, `'ltr'`
  for `en` (`applyLangAttrs()`).
- Helper checks live in `docs/check-i18n.cjs` and `docs/check-registry-i18n.cjs`
  (git-ignored local helpers — see [18 — Dev Tooling](18-DEV-TOOLING.md)).

---

## 11. Status summary

| Feature | Status |
|---|---|
| Landing page + random-start Ken Burns cross-fade slideshow (5 images) | Shipped |
| Collapsible side menu (always opens on Offline) | Shipped |
| Credits panel | Shipped |
| Quick-mute icon + lobby music track + music/mute volume | Shipped |
| Settings (language/RTL, graphics, audio, controls) | Shipped |
| Dev Settings (form, group/text/modified filters, Save as default) | Shipped |
| Match-option collapsibles + tracking toggles | Shipped |
| Offline **Campaign** mode | **Planned — not yet implemented** (placeholder) |
| `#tab-credits` as a side-menu tab | Not implemented (Credits opens from landing) |
