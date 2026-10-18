import './styles.css'
import { BUILDINGS, UNITS, UPGRADES, WEAPONS, SIM_TICK_HZ, SECONDS_TO_TICKS, crc32, mergeMatchSettings, DEFAULT_MATCH_SETTINGS, DEFAULT_CREDITS, PLAYER_COLORS, FOG_MODES, COOP_ECONOMY_OPTIONS, COOP_RANK_OPTIONS, COOP_CONTROL_OPTIONS, validReplay, replayDateLabel, modFromSettings, modSettingsDelta, modHash, PROTOCOL_VERSION, fingerprintSettings, resolveSettingsFileLayers, sanitizeClientDevSettings, DEV_SCALAR_SECTIONS, DEV_OVERRIDE_BUILDING_FIELDS, DEV_OVERRIDE_UNIT_FIELDS, DEV_OVERRIDE_WEAPON_FIELDS, DEV_OVERRIDE_UPGRADE_FIELDS, type DevOverrideFieldDef, type ModFile, type ModMeta, type RoomMod, type ClientDevSettings, type MatchSettingsFile, type MatchSettings, type WinRule, type FogMode, type ReplayData, type ReplayMeta } from '@space-arenas/shared'
import { MAP_PRESETS, mapForPreset, validateMap, type MapData } from '@space-arenas/shared'
import { Game } from './game/Game.ts'
import { AudioHooks, AMBIENT_SYNTH } from './audio/hooks.ts'
import { NetClient } from './net/net.ts'
import type { LobbyMessage, MatchStartMessage, SettingsAlertMessage } from '@space-arenas/shared'
import type { MatchConfig, OfflineMode } from './game/match.ts'
import { resolveDailyChallenge } from './modes/daily.ts'
import { loadModeRecords, dailyLevel, dailyLevelXp, DAILY_XP_PER_LEVEL } from './profile/modeRecords.ts'
import { MapPreview } from './ui/map-preview.ts'
import { createPlayerRow } from './ui/player-row.ts'
import { BOT_DIFFICULTIES, type BotDifficulty } from './ai/bot.ts'
import { initControlsSettings } from './ui/controls-settings.ts'
import { preloadAllMatchAssets, preloadFxFrames } from './render/building-sprites.ts'
import { WEATHERS, type WeatherId, type GraphicsSettings, getGraphics, setWeather, setBuildingFill, setBuildingOffset, setFieldOffset, setFieldScale, setObstacleScale, setObstacleOffset, setUnitScale, setUnitOffset, setAssetPath, setFxScale, setFxOffset, setMinimapScale, setVictoryCinematicSec, setZoomMin, setZoomMax, setReplayZoomMin, setReplayZoomMax, setSpriteLayerOrder, setProjectileBulletSize, setProjectileRocketSize, setProjectileShellSize, setProjectileShellHeight, DEFAULT_BUILDING_FILL, DEFAULT_BUILDING_OFFSET, DEFAULT_FIELD_OFFSET, DEFAULT_FIELD_SCALE, DEFAULT_OBSTACLE_SCALE, DEFAULT_OBSTACLE_OFFSET, DEFAULT_UNIT_SCALE, DEFAULT_UNIT_OFFSET, DEFAULT_FX_SCALE, DEFAULT_FX_OFFSET, DEFAULT_MINIMAP_SCALE, DEFAULT_VICTORY_CINEMATIC, DEFAULT_ZOOM_MIN, DEFAULT_ZOOM_MAX, DEFAULT_REPLAY_ZOOM_MIN, DEFAULT_REPLAY_ZOOM_MAX, DEFAULT_SPRITE_LAYER_ORDER, DEFAULT_PROJECTILE_BULLET_SIZE, DEFAULT_PROJECTILE_ROCKET_SIZE, DEFAULT_PROJECTILE_SHELL_SIZE, DEFAULT_PROJECTILE_SHELL_HEIGHT, DEFAULT_ASSET_PATHS, SPRITE_LAYER_KINDS, UNIT_ASSET_IDS, HUD_ASSET_IDS, OBSTACLE_ASSET_TYPES, reloadGraphics } from './ui/graphics.ts'
import { getAudio, setOverride, setTuning, reloadAudio, setMuted, onChangeAudio, TUNING_VOL_MAX, TUNING_PITCH_MIN, TUNING_PITCH_MAX, type SoundId } from './audio/settings.ts'
import { startLobbyMusic, stopLobbyMusic } from './audio/lobby-music.ts'
import { initLang, setLang, getLang, t, tn, translateStatic, onLangChange, type Lang } from './i18n/index.ts'
import { allMapEntries, entryToMap, findMapEntry, migrateLegacyLibrary, saveCustomMap, seedLibraryFromBundledMaps, type MapEntry } from './mapbuilder/library.ts'
import { initProfilePanel, renderProfilePanel, onProfileTabShown } from './profile/ui.ts'
import { loadProfileConfig, saveProfileConfig } from './profile/profile.ts'
import { restoreLocalProfile, saveLocalProfile } from './profile/folder-backup.ts'
import { decryptPayload, encryptPayload, sha256Hex } from './net/crypto.ts'

const ERROR_HIDE_TIMEOUT_MS = 8000
const COUNTDOWN_SECONDS = 5
const MAX_NAME_LENGTH = 16
const NAME_DEBOUNCE_MS = 500
const MAX_CHAT_LINES = 100
const POLL_INTERVAL_MS = 2500
const AUTO_JOIN_DELAY_MS = 600
/** Grace period before a dead invite link is stripped, so the notice stays readable. */
const INVITE_GONE_REDIRECT_MS = 2600
/** Base lobby-refresh cadence; grows with backoff while the online server is unreachable. */
const ONLINE_LOBBY_POLL_MS = 5000
const ONLINE_LOBBY_POLL_MAX_MS = 60_000
/** How long the lobby toast stays on screen. */
const LOBBY_TOAST_MS = 4200

const COLOR_HEXES = PLAYER_COLORS.map((c) => `#${c.toString(16).padStart(6, '0')}`)

const errBox = document.getElementById('err-box') as HTMLDivElement
let errCount = 0
let errHideTimer: number | null = null
const showErr = (message: string): void => {
  console.error('[page error]', message)
  if (errCount >= 5) return
  errCount++
  errBox.textContent += `${message}\n`
  errBox.style.display = 'block'
  if (errHideTimer !== null) window.clearTimeout(errHideTimer)
  errHideTimer = window.setTimeout(() => {
    errBox.style.display = 'none'
    errBox.textContent = ''
    errCount = 0
    errHideTimer = null
  }, ERROR_HIDE_TIMEOUT_MS)
}
window.addEventListener('error', (e) => showErr(e.message ?? String(e.error)))
window.addEventListener('unhandledrejection', (e) => showErr(String(e.reason)))

let game: Game | null = null
let net: NetClient | null = null
let localTeam = 0
let lobbyEl: HTMLElement | null = null

// ---------- lobby ambient audio ----------

const lobbyAudio = new AudioHooks()
let lobbyAmbientUnlocked = false
const unlockLobbyAudio = (): void => {
  if (lobbyAmbientUnlocked) return
  lobbyAudio.unlock()
  lobbyAudio.startLobbyAmbient()
  startLobbyMusic()
  lobbyAmbientUnlocked = true
  window.removeEventListener('pointerdown', unlockLobbyAudio, true)
  window.removeEventListener('keydown', unlockLobbyAudio, true)
}
window.addEventListener('pointerdown', unlockLobbyAudio, true)
window.addEventListener('keydown', unlockLobbyAudio, true)

const hideLobby = (): void => {
  stopLobbyMusic()
  stopLobbySlideshow()
  ;(document.getElementById('lobby') as HTMLDivElement).style.display = 'none'
}

const showLobby = (): void => {
  game = null
  const wasNet = net !== null
  const wasOnline = wasNet && isOnlineAddr(lastJoin?.addr)
  if (wasNet) {
    net = null
    lobbyState = null
  }
  stopPing()
  clearActiveMatch()
  ;(document.getElementById('lobby') as HTMLDivElement).style.display = 'flex'
  if (lobbyAmbientUnlocked) startLobbyMusic()
  startLobbySlideshow()
  if (wasNet) {
    setTab(wasOnline ? 'online' : 'network')
    if (wasOnline) void refreshOnlineList(true)
  }
  // Returning from a match means new daily progress — refresh the bots tab list.
  if (offlineMode === 'bots') renderDaily()
}

const makeGame = (): Game => new Game(document.body, { onQuit: showLobby })

;(window as unknown as { spaceArenas: { get game(): Game | null } }).spaceArenas = {
  get game() {
    return game
  },
}

// ---------- tabs ----------

const offlinePanel = document.getElementById('offline-panel') as HTMLDivElement
const networkPanel = document.getElementById('network-panel') as HTMLDivElement
const matchPanel = document.getElementById('match-panel') as HTMLDivElement
const onlinePanel = document.getElementById('online-panel') as HTMLDivElement
const mapbuilderPanel = document.getElementById('mapbuilder-panel') as HTMLDivElement
const infoPanel = document.getElementById('info-panel') as HTMLDivElement
const settingsPanel = document.getElementById('settings-panel') as HTMLDivElement
const devPanel = document.getElementById('dev-panel') as HTMLDivElement
const profilePanel = document.getElementById('profile-panel') as HTMLDivElement
const archivePanel = document.getElementById('archive-panel') as HTMLDivElement
const modsPanel = document.getElementById('mods-panel') as HTMLDivElement
const creditsPanel = document.getElementById('credits-panel') as HTMLDivElement
const tabOffline = document.getElementById('tab-offline') as HTMLButtonElement
const tabNetwork = document.getElementById('tab-network') as HTMLButtonElement
const tabOnline = document.getElementById('tab-online') as HTMLButtonElement
const tabMapBuilder = document.getElementById('tab-mapbuilder') as HTMLButtonElement
const tabInfo = document.getElementById('tab-info') as HTMLButtonElement
const tabSettings = document.getElementById('tab-settings') as HTMLButtonElement
const tabDev = document.getElementById('tab-dev') as HTMLButtonElement
const tabProfile = document.getElementById('tab-profile') as HTMLButtonElement
const tabArchive = document.getElementById('tab-archive') as HTMLButtonElement
const tabMods = document.getElementById('tab-mods') as HTMLButtonElement

const setTab = (which: 'offline' | 'network' | 'match' | 'online' | 'mapbuilder' | 'info' | 'settings' | 'dev' | 'profile' | 'archive' | 'mods' | 'credits'): void => {
  offlinePanel.classList.toggle('hidden-panel', which !== 'offline')
  networkPanel.classList.toggle('hidden-panel', which !== 'network')
  matchPanel.classList.toggle('hidden-panel', which !== 'match')
  onlinePanel.classList.toggle('hidden-panel', which !== 'online')
  mapbuilderPanel.classList.toggle('hidden-panel', which !== 'mapbuilder')
  infoPanel.classList.toggle('hidden-panel', which !== 'info')
  settingsPanel.classList.toggle('hidden-panel', which !== 'settings')
  devPanel.classList.toggle('hidden-panel', which !== 'dev')
  profilePanel.classList.toggle('hidden-panel', which !== 'profile')
  archivePanel.classList.toggle('hidden-panel', which !== 'archive')
  modsPanel.classList.toggle('hidden-panel', which !== 'mods')
  creditsPanel.classList.toggle('hidden-panel', which !== 'credits')
  tabOffline.classList.toggle('active', which === 'offline')
  tabNetwork.classList.toggle('active', which === 'network')
  tabOnline.classList.toggle('active', which === 'online')
  tabMapBuilder.classList.toggle('active', which === 'mapbuilder')
  tabInfo.classList.toggle('active', which === 'info')
  tabSettings.classList.toggle('active', which === 'settings')
  tabDev.classList.toggle('active', which === 'dev')
  tabProfile.classList.toggle('active', which === 'profile')
  tabArchive.classList.toggle('active', which === 'archive')
  tabMods.classList.toggle('active', which === 'mods')
  if (which === 'online') void refreshOnlineList()
  if (which === 'match') renderMatchDaily()
  if (which === 'profile') onProfileTabShown()
  if (which === 'archive') void refreshArchive()
  if (which === 'mods') void refreshMods()
}

tabOffline.addEventListener('click', () => setTab('offline'))
tabNetwork.addEventListener('click', () => {
  // Keep the player inside the lobby match they joined (until they leave it).
  setTab(lobbyState ? 'match' : 'network')
})
tabOnline.addEventListener('click', () => setTab('online'))
tabMapBuilder.addEventListener('click', () => setTab('mapbuilder'))
tabInfo.addEventListener('click', () => setTab('info'))
tabSettings.addEventListener('click', () => setTab('settings'))
tabDev.addEventListener('click', () => setTab('dev'))
tabProfile.addEventListener('click', () => setTab('profile'))
tabArchive.addEventListener('click', () => setTab('archive'))
tabMods.addEventListener('click', () => setTab('mods'))

// ---------- lobby shell: landing page, side-menu toggle, background slideshow ----------

const lobbyRoot = document.getElementById('lobby') as HTMLDivElement
const lobbyBgEl = document.getElementById('lobby-bg') as HTMLDivElement
const lobbyMenuToggle = document.getElementById('lobby-menu-toggle') as HTMLButtonElement
const lobbyCloseMenu = document.getElementById('lobby-close-menu') as HTMLButtonElement
const lobbyOpenMenu = document.getElementById('lobby-open-menu') as HTMLButtonElement
const lobbyLandingCredits = document.getElementById('lobby-landing-credits') as HTMLButtonElement
const creditsCloseBtn = document.getElementById('credits-close') as HTMLButtonElement
const lobbyLogo = document.getElementById('lobby-logo') as HTMLImageElement

/** Open the side menu (the classic lobby tabs + panel) — always lands on Offline. */
const openLobbyMenu = (): void => {
  lobbyRoot.classList.remove('menu-closed')
  setTab('offline')
}
/** Close the side menu and return to the game landing page. */
const closeLobbyMenu = (): void => {
  lobbyRoot.classList.add('menu-closed')
}

lobbyMenuToggle.addEventListener('click', openLobbyMenu)
lobbyOpenMenu.addEventListener('click', openLobbyMenu)
lobbyCloseMenu.addEventListener('click', closeLobbyMenu)
creditsCloseBtn.addEventListener('click', closeLobbyMenu)
lobbyLandingCredits.addEventListener('click', () => {
  lobbyRoot.classList.remove('menu-closed')
  setTab('credits')
})
// The logo is a placeholder the author replaces later; hide it when missing.
lobbyLogo.addEventListener('error', () => {
  lobbyLogo.style.display = 'none'
})

// Background slideshow: placeholder images (bg_1.png …), random start order, cross-fade,
// each slide slowly zoom-pans (Ken Burns) in a random direction.
const LOBBY_BG_COUNT = 5
const LOBBY_BG_SLIDE_MS = 8000
const LOBBY_BG_FADE_MS = 1500
let lobbySlideTimer: number | null = null
let lobbySlideIdx = 0
const lobbySlides: HTMLDivElement[] = []
let lobbySlideOrder: number[] = []

const randRange = (min: number, max: number): number => min + Math.random() * (max - min)

const buildLobbySlides = (): void => {
  if (lobbySlides.length) return
  for (let i = 1; i <= LOBBY_BG_COUNT; i++) {
    const slide = document.createElement('div')
    slide.className = 'lobby-slide'
    slide.style.backgroundImage = `url("${import.meta.env.BASE_URL}background/bg_${i}.png")`
    lobbyBgEl.appendChild(slide)
    lobbySlides.push(slide)
  }
  // Shuffle so the first image is random each session.
  lobbySlideOrder = lobbySlides.map((_, i) => i)
  for (let i = lobbySlideOrder.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = lobbySlideOrder[i]
    lobbySlideOrder[i] = lobbySlideOrder[j]
    lobbySlideOrder[j] = tmp
  }
}

const activateLobbySlide = (n: number): void => {
  const slide = lobbySlides[lobbySlideOrder[n]]
  if (!slide) return
  slide.style.setProperty('--kb-dur', `${LOBBY_BG_SLIDE_MS + LOBBY_BG_FADE_MS}ms`)
  slide.style.setProperty('--kb-fade', `${LOBBY_BG_FADE_MS}ms`)
  slide.style.setProperty('--kb-x', `${randRange(-6, 6)}%`)
  slide.style.setProperty('--kb-y', `${randRange(-6, 6)}%`)
  slide.style.setProperty('--kb-scale', `${randRange(1.12, 1.24)}`)
  for (const s of lobbySlides) s.classList.remove('active')
  // Force a reflow so the pan/zoom animation restarts from the beginning.
  void slide.offsetWidth
  slide.classList.add('active')
}

const startLobbySlideshow = (): void => {
  buildLobbySlides()
  if (!lobbySlides.length || lobbySlideTimer !== null) return
  lobbySlideIdx = 0
  activateLobbySlide(0)
  lobbySlideTimer = window.setInterval(() => {
    lobbySlideIdx = (lobbySlideIdx + 1) % lobbySlideOrder.length
    activateLobbySlide(lobbySlideIdx)
  }, LOBBY_BG_SLIDE_MS)
}

const stopLobbySlideshow = (): void => {
  if (lobbySlideTimer !== null) {
    clearInterval(lobbySlideTimer)
    lobbySlideTimer = null
  }
}

startLobbySlideshow()

// Quick mute shortcut (floating icon in the lobby) — toggles the global "mute all".
const quickMuteBtn = document.getElementById('lobby-quick-mute') as HTMLButtonElement
const renderQuickMute = (): void => {
  const m = getAudio().muted
  quickMuteBtn.textContent = m ? '🔇' : '🔊'
  quickMuteBtn.title = t(m ? 'lobby.unmuteAll' : 'lobby.muteAll')
  quickMuteBtn.classList.toggle('muted', m)
}
quickMuteBtn.addEventListener('click', () => setMuted(!getAudio().muted))
renderQuickMute()
onChangeAudio(renderQuickMute)
onLangChange(() => renderQuickMute())

initProfilePanel(applyProfileName)

// ---------- archive (saved replays) ----------

const archiveListEl = document.getElementById('archive-list') as HTMLDivElement
const archiveFileEl = document.getElementById('archive-file') as HTMLInputElement
const archiveUploadBtn = document.getElementById('archive-upload') as HTMLButtonElement
const archiveRefreshBtn = document.getElementById('archive-refresh') as HTMLButtonElement

const txt = (key: string): string => t(key)

const archiveRow = (meta: ReplayMeta): HTMLDivElement => {
  const row = document.createElement('div')
  row.className = 'archive-row' + (meta.valid ? '' : ' corrupt')
  const name = document.createElement('span')
  name.className = 'archive-col archive-name'
  name.textContent = meta.label
  const map = document.createElement('span')
  map.className = 'archive-col archive-map'
  map.textContent = meta.map || txt('archive.unknown')
  const date = document.createElement('span')
  date.className = 'archive-col archive-date'
  date.textContent = meta.createdAt ? replayDateLabel(meta.createdAt) : '—'
  const dur = document.createElement('span')
  dur.className = 'archive-col archive-dur'
  dur.textContent = meta.valid ? Math.round(meta.ticks / 25).toLocaleString('en-US') + 's' : '—'
  const actions = document.createElement('span')
  actions.className = 'archive-col archive-actions'
  const play = document.createElement('button')
  play.className = 'ghost'
  play.textContent = meta.valid ? txt('archive.play') : txt('archive.invalid')
  play.disabled = !meta.valid
  play.addEventListener('click', () => playReplay(meta))
  const rename = document.createElement('button')
  rename.className = 'ghost'
  rename.textContent = txt('archive.rename')
  rename.addEventListener('click', () => renameReplay(meta))
  const del = document.createElement('button')
  del.className = 'ghost danger'
  del.textContent = txt('archive.delete')
  del.addEventListener('click', () => deleteReplay(meta))
  actions.append(play, rename, del)
  row.append(name, map, date, dur, actions)
  return row
}

const setArchiveList = (metas: ReplayMeta[]): void => {
  archiveListEl.textContent = ''
  if (metas.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'hint'
    empty.textContent = txt('archive.empty')
    archiveListEl.appendChild(empty)
    return
  }
  for (const meta of metas) archiveListEl.appendChild(archiveRow(meta))
}

const refreshArchive = async (): Promise<void> => {
  try {
    const res = await fetch('/api/replays')
    const data = (await res.json()) as { replays?: ReplayMeta[] }
    setArchiveList(data.replays ?? [])
    archiveListEl.classList.remove('error')
  } catch {
    const err = document.createElement('div')
    err.className = 'hint error'
    err.textContent = txt('archive.unreachable')
    archiveListEl.textContent = ''
    archiveListEl.appendChild(err)
  }
}

const playReplay = async (meta: ReplayMeta): Promise<void> => {
  try {
    const res = await fetch(`/api/replays?name=${encodeURIComponent(meta.name)}`)
    if (!res.ok) {
      errBox.textContent = txt('archive.missing')
      return
    }
    const replay = (await res.json()) as ReplayData
    if (game) {
      game.destroy()
      game = null
    }
    game = makeGame()
    hideLobby()
    await game.startReplay(replay)
  } catch {
    errBox.textContent = txt('archive.unreachable')
  }
}

const renameReplay = async (meta: ReplayMeta): Promise<void> => {
  const next = window.prompt(txt('archive.renamePrompt'), meta.label)
  if (next === null || next.trim() === '' || next.trim() === meta.label) return
  try {
    const res = await fetch('/api/replays/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: meta.name, newName: next.trim() }),
    })
    if (res.ok) await refreshArchive()
    else errBox.textContent = txt('archive.renameFail')
  } catch {
    errBox.textContent = txt('archive.unreachable')
  }
}

const deleteReplay = async (meta: ReplayMeta): Promise<void> => {
  if (!window.confirm(txt('archive.deleteConfirm'))) return
  try {
    const res = await fetch('/api/replays/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: meta.name }),
    })
    if (res.ok) await refreshArchive()
  } catch {
    errBox.textContent = txt('archive.unreachable')
  }
}

archiveUploadBtn.addEventListener('click', () => archiveFileEl.click())
archiveFileEl.addEventListener('change', () => {
  const file = archiveFileEl.files?.[0]
  if (!file) return
  void (async () => {
    try {
      const text = await file.text()
      const parsed = JSON.parse(text) as unknown
      if (!validReplay(parsed)) {
        errBox.textContent = txt('archive.invalidFile')
        return
      }
      const res = await fetch('/api/replays/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: text,
      })
      if (res.ok) {
        archiveFileEl.value = ''
        await refreshArchive()
      } else {
        errBox.textContent = txt('archive.invalidFile')
      }
    } catch {
      errBox.textContent = txt('archive.invalidFile')
    }
  })()
})
archiveRefreshBtn.addEventListener('click', () => void refreshArchive())

// ---------- balance mods ----------

const MODS_ACTIVE_KEY = 'space-arenas:mods-active'
const OFFLINE_MOD_KEY = 'space-arenas:offline-mod'

const modsListEl = document.getElementById('mods-list') as HTMLDivElement
const modsFileEl = document.getElementById('mods-file') as HTMLInputElement
const modsUploadBtn = document.getElementById('mods-upload') as HTMLButtonElement
const modsRefreshBtn = document.getElementById('mods-refresh') as HTMLButtonElement

const offlineModToggleEl = document.getElementById('offline-mod-toggle') as HTMLInputElement
const offlineModSelectEl = document.getElementById('offline-mod-select') as HTMLSelectElement
const offlineModHintEl = document.getElementById('offline-mod-hint') as HTMLDivElement

const matchModToggleEl = document.getElementById('match-mod-toggle') as HTMLInputElement
const matchModSelectEl = document.getElementById('match-mod-select') as HTMLSelectElement
const matchModHintEl = document.getElementById('match-mod-hint') as HTMLDivElement
const matchModSyncEl = document.getElementById('match-mod-sync') as HTMLDivElement
const matchModNoteEl = document.getElementById('match-mod-note') as HTMLDivElement

let modsCache: ModMeta[] = []
let modsUnreachable = false
let offlineModName = ''

const modsActiveMap = (): Record<string, boolean> => {
  try {
    const raw = localStorage.getItem(MODS_ACTIVE_KEY)
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {}
  } catch {
    return {}
  }
}

const saveModsActiveMap = (m: Record<string, boolean>): void => {
  try {
    localStorage.setItem(MODS_ACTIVE_KEY, JSON.stringify(m))
  } catch {
    /* storage unavailable */
  }
}

const isModActive = (name: string): boolean => modsActiveMap()[name] !== false

const setModActive = (name: string, active: boolean): void => {
  const m = modsActiveMap()
  m[name] = active
  saveModsActiveMap(m)
  renderMods()
  renderModPickers()
}

const activeMods = (): ModMeta[] =>
  modsCache.filter((m) => m.valid && m.protocolOk !== false && isModActive(m.name))

const modSizeLabel = (size: number): string =>
  size >= 1024 * 1024 ? `${(size / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`

const modDescriptionFor = (meta: ModMeta): string => {
  const parts: string[] = []
  if (meta.author) parts.push(meta.author)
  if (meta.version) parts.push(`v${meta.version}`)
  if (meta.description) parts.push(meta.description)
  return parts.join(' · ')
}

const downloadMod = async (meta: ModMeta): Promise<void> => {
  try {
    const res = await fetch(`/api/mods?name=${encodeURIComponent(meta.name)}`)
    if (!res.ok) return
    const data = await res.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(data)
    a.download = meta.name
    a.click()
    URL.revokeObjectURL(a.href)
  } catch {
    /* host unreachable */
  }
}

const modRow = (meta: ModMeta): HTMLDivElement => {
  const row = document.createElement('div')
  row.className = 'mod-row' + (isModActive(meta.name) ? '' : ' off')
  const title = document.createElement('span')
  title.className = 'mod-title'
  title.textContent = meta.label
  title.title = meta.description ?? meta.label
  const size = document.createElement('span')
  size.className = 'archive-col mod-meta'
  size.textContent = modSizeLabel(meta.size)
  const status = document.createElement('span')
  const active = isModActive(meta.name)
  status.className = 'mod-status' + (!meta.valid ? ' bad' : active ? ' good' : ' off-state')
  status.textContent = !meta.valid
    ? t('mods.invalid')
    : meta.protocolOk === false
      ? t('mods.protocol')
      : active
        ? t('mods.active')
        : t('mods.deactivated')
  const actions = document.createElement('span')
  actions.className = 'archive-col archive-actions'
  const toggle = document.createElement('button')
  toggle.className = 'ghost'
  toggle.disabled = !meta.valid
  toggle.textContent = meta.protocolOk === false ? t('mods.invalid') : active ? t('mods.deactivate') : t('mods.activate')
  toggle.addEventListener('click', () => setModActive(meta.name, !isModActive(meta.name)))
  const dl = document.createElement('button')
  dl.className = 'ghost'
  dl.textContent = t('mods.download')
  dl.disabled = !meta.valid
  dl.addEventListener('click', () => void downloadMod(meta))
  const rename = document.createElement('button')
  rename.className = 'ghost'
  rename.textContent = t('mods.rename')
  rename.addEventListener('click', () => void renameMod(meta))
  const del = document.createElement('button')
  del.className = 'ghost danger'
  del.textContent = t('mods.delete')
  del.addEventListener('click', () => void deleteMod(meta))
  actions.append(toggle, dl, rename, del)
  row.append(title, size, status, actions)
  return row
}

const setModsList = (metas: ModMeta[], unreachable = false): void => {
  modsListEl.textContent = ''
  if (unreachable) {
    const err = document.createElement('div')
    err.className = 'hint error'
    err.textContent = t('mods.unreachable')
    modsListEl.appendChild(err)
    return
  }
  if (metas.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'hint'
    empty.textContent = t('mods.empty')
    modsListEl.appendChild(empty)
    return
  }
  for (const meta of metas) modsListEl.appendChild(modRow(meta))
}

const renderMods = (): void => {
  setModsList(modsCache, modsUnreachable)
}

const renderModPickers = (): void => {
  const mods = activeMods()
  const fill = (select: HTMLSelectElement): void => {
    const prev = select.value
    select.innerHTML = ''
    const none = document.createElement('option')
    none.value = ''
    none.textContent = t('mods.none')
    select.appendChild(none)
    for (const m of mods) {
      const opt = document.createElement('option')
      opt.value = m.name
      opt.textContent = m.label
      select.appendChild(opt)
    }
    if (mods.some((m) => m.name === prev)) select.value = prev
  }
  fill(offlineModSelectEl)
  fill(matchModSelectEl)

  if (modsUnreachable) {
    offlineModToggleEl.disabled = true
    offlineModSelectEl.disabled = true
    offlineModHintEl.textContent = t('mods.unreachable')
    return
  }

  const hasMods = mods.length > 0
  offlineModToggleEl.disabled = false
  if (offlineModName && !mods.some((m) => m.name === offlineModName)) offlineModName = ''
  const persist = (): void => {
    try {
      if (offlineModName) localStorage.setItem(OFFLINE_MOD_KEY, offlineModName)
      else localStorage.removeItem(OFFLINE_MOD_KEY)
    } catch {
      /* storage unavailable */
    }
  }
  if (offlineModToggleEl.checked && offlineModName) {
    offlineModSelectEl.value = offlineModName
    offlineModSelectEl.disabled = !hasMods
    const sel = mods.find((m) => m.name === offlineModName)
    offlineModHintEl.textContent = sel ? modDescriptionFor(sel) : hasMods ? t('mods.pickHint') : t('mods.noMods')
  } else {
    offlineModSelectEl.value = hasMods ? offlineModSelectEl.value || '' : ''
    offlineModSelectEl.disabled = true
    offlineModHintEl.textContent = hasMods ? t('mods.pickHint') : t('mods.noMods')
  }
  persist()
}

const refreshMods = async (): Promise<void> => {
  try {
    const res = await fetch('/api/mods')
    const data = (await res.json()) as { mods?: ModMeta[] }
    modsCache = data.mods ?? []
    modsUnreachable = false
    setModsList(modsCache, false)
  } catch {
    modsCache = []
    modsUnreachable = true
    setModsList([], true)
  }
  renderModPickers()
  renderRepoPublishSelect()
}

const renameMod = async (meta: ModMeta): Promise<void> => {
  const next = window.prompt(t('mods.renamePrompt'), meta.label)
  if (next === null || next.trim() === '' || next.trim() === meta.label) return
  try {
    const res = await fetch('/api/mods/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: meta.name, newName: next.trim() }),
    })
    if (!res.ok) {
      errBox.textContent = t('mods.renameFail')
      return
    }
    if (offlineModName === meta.name) offlineModName = ''
    await refreshMods()
  } catch {
    errBox.textContent = t('mods.unreachable')
  }
}

const deleteMod = async (meta: ModMeta): Promise<void> => {
  if (!window.confirm(t('mods.deleteConfirm'))) return
  try {
    const res = await fetch('/api/mods/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: meta.name }),
    })
    if (res.ok && offlineModName === meta.name) offlineModName = ''
    await refreshMods()
  } catch {
    errBox.textContent = t('mods.unreachable')
  }
}

const uploadModFile = async (file: File): Promise<boolean> => {
  try {
    const text = await file.text()
    JSON.parse(text)
    const res = await fetch('/api/mods/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: text,
    })
    if (!res.ok) return false
    await refreshMods()
    return true
  } catch {
    return false
  }
}

modsUploadBtn.addEventListener('click', () => modsFileEl.click())
modsFileEl.addEventListener('change', () => {
  const file = modsFileEl.files?.[0]
  if (!file) return
  void (async () => {
    const ok = await uploadModFile(file)
    modsFileEl.value = ''
    if (!ok) errBox.textContent = t('mods.invalidFile')
  })()
})
modsRefreshBtn.addEventListener('click', () => void refreshMods())

const fetchModByName = async (name: string): Promise<ModFile | null> => {
  try {
    const res = await fetch(`/api/mods?name=${encodeURIComponent(name)}`)
    if (!res.ok) return null
    return (await res.json()) as ModFile
  } catch {
    return null
  }
}

offlineModToggleEl.addEventListener('change', () => {
  if (!offlineModToggleEl.checked) {
    offlineModName = ''
    renderModPickers()
  } else {
    if (offlineModName && activeMods().some((m) => m.name === offlineModName)) {
      renderModPickers()
    } else {
      const first = activeMods()[0]
      offlineModName = first ? first.name : ''
      renderModPickers()
    }
  }
})

offlineModSelectEl.addEventListener('change', () => {
  offlineModName = offlineModSelectEl.value
  renderModPickers()
})

const applyMatchMod = async (name: string): Promise<void> => {
  const m = activeMods().find((x) => x.name === name)
  if (name !== '' && !m) {
    matchModToggleEl.checked = false
    return
  }
  let mod: ModFile | undefined
  if (isOnlineAddr(lastJoin?.addr) && name !== '') {
    // Online rooms ride the host's file: upload the content so the server can compute
    // effective settings and hand other players a download to join.
    mod = (await fetchModByName(name)) ?? undefined
    if (!mod) {
      setMatchStatus(t('mods.uploadFailed'), true)
      return
    }
  }
  net?.updateRoom({ modId: name, mod })
  setMatchStatus(name === '' ? t('mods.cleared') : m ? t('mods.applied', { n: m.label }) : t('mods.cleared'))
}

matchModToggleEl.addEventListener('change', () => {
  if (!lobbyState || lobbyState.yourId !== lobbyState.hostId) return
  if (matchModToggleEl.checked) {
    const name = matchModSelectEl.value
    const m = activeMods().find((x) => x.name === name)
    if (!m) {
      matchModToggleEl.checked = false
      return
    }
    void applyMatchMod(name)
  } else {
    void applyMatchMod('')
  }
})

matchModSelectEl.addEventListener('change', () => {
  if (!matchModToggleEl.checked || !lobbyState || lobbyState.yourId !== lobbyState.hostId) return
  void applyMatchMod(matchModSelectEl.value)
})

const loadOfflineModSelection = (): void => {
  try {
    offlineModName = localStorage.getItem(OFFLINE_MOD_KEY) ?? ''
  } catch {
    offlineModName = ''
  }
  offlineModToggleEl.checked = offlineModName !== ''
}

const syncMatchModUi = (msg: LobbyMessage, isHost: boolean): void => {
  const picker = document.getElementById('match-mods-picker')
  if (!picker) return
  matchModNoteEl.innerHTML = ''
  matchModSyncEl.textContent = ''
  if (!isHost) {
    picker.style.display = 'none'
    const online = isOnlineAddr(lastJoin?.addr)
    if (msg.modId) {
      const line = document.createElement('div')
      line.className = 'match-note'
      if (online && msg.mod) {
        const info = msg.mod
        const me = msg.players.find((p) => p.id === msg.yourId)
        line.textContent = t('mods.hostMod', { n: onlineModLabel(info) }) + (me?.modOk === true ? ' ✓' : '')
        matchModNoteEl.appendChild(line)
        const dl = document.createElement('button')
        dl.className = 'ghost'
        dl.textContent = t('mods.getCopy')
        dl.addEventListener('click', () => showModRequirement(info))
        matchModNoteEl.appendChild(dl)
        void checkOnlineRoomMod(msg)
      } else {
        const known = modsCache.find((m) => m.name === msg.modId) ?? activeMods().find((m) => m.name === msg.modId)
        line.textContent = known ? t('mods.hostMod', { n: known.label }) : t('mods.hostModUnknown', { n: msg.modId })
        matchModNoteEl.appendChild(line)
        const dl = document.createElement('button')
        dl.className = 'ghost'
        dl.textContent = t('mods.getCopy')
        dl.addEventListener('click', () => {
          const a = document.createElement('a')
          a.href = `/api/mods?name=${encodeURIComponent(msg.modId ?? '')}`
          a.download = msg.modId ?? 'mod.json'
          a.click()
        })
        matchModNoteEl.appendChild(dl)
      }
    } else {
      if (online) modReqOverlayEl.classList.remove('visible')
      const line = document.createElement('div')
      line.className = 'match-note'
      line.textContent = t('mods.noneForMatch')
      matchModNoteEl.appendChild(line)
    }
    return
  }
  picker.style.display = ''
  const active = activeMods()
  const on = !!msg.modId
  matchModToggleEl.checked = on
  matchModToggleEl.disabled = active.length === 0
  matchModSelectEl.disabled = !on
  const current = active.find((m) => m.name === msg.modId)
  matchModSelectEl.value = current ? msg.modId! : on && active.length > 0 ? active[0].name : ''
  matchModHintEl.textContent = current
    ? modDescriptionFor(current)
    : on
      ? t('mods.unknownSelected')
      : active.length === 0
        ? t('mods.noModsHost')
        : t('mods.pickHint')
  matchModSyncEl.textContent = on ? t('mods.syncHint') : ''
}

loadOfflineModSelection()
void refreshMods()

// ---------- online room: balance-mod download-to-join popup ----------

const modReqOverlayEl = document.getElementById('modreq-overlay') as HTMLDivElement
const modReqHintEl = document.getElementById('modreq-hint') as HTMLDivElement
const modReqMetaEl = document.getElementById('modreq-meta') as HTMLDivElement
const modReqStatusEl = document.getElementById('modreq-status') as HTMLDivElement
const modReqDownloadBtn = document.getElementById('modreq-download') as HTMLButtonElement
const modReqCancelBtn = document.getElementById('modreq-cancel') as HTMLButtonElement

/** Popup's room mod — what the Download button installs (set only when required). */
let onlineRequiredMod: RoomMod | null = null

/** Re-runs the online mod presence check once per (room, mod hash). */
let onlineModCheckedKey = ''

const onlineModLabel = (info: RoomMod): string => (info.label && info.label !== info.name ? info.label : info.name)

const modMetaLine = (info: RoomMod): string => {
  const parts: string[] = []
  if (info.label && info.label !== info.name) parts.push(info.label)
  if (info.author) parts.push(info.author)
  if (info.version) parts.push(`v${info.version}`)
  if (info.description) parts.push(info.description)
  parts.push(modSizeLabel(info.size))
  return parts.join(' · ')
}

const showModRequirement = (info: RoomMod): void => {
  onlineRequiredMod = info
  modReqHintEl.textContent = t('mods.requiredBody', { n: onlineModLabel(info) })
  modReqMetaEl.textContent = modMetaLine(info)
  modReqStatusEl.textContent = t('mods.requiredMissing')
  modReqStatusEl.classList.remove('good')
  modReqDownloadBtn.disabled = false
  modReqOverlayEl.classList.add('visible')
}

/** Fetches the room's mod from the online server, installs it into the local LAN host
 *  (so the sim picks it up), activates it, then acks the room. True on success. */
const installOnlineRoomMod = async (info: RoomMod): Promise<boolean> => {
  modReqStatusEl.textContent = t('mods.requiredInstalling')
  modReqDownloadBtn.disabled = true
  try {
    const res = await fetch(`${ONLINE_URL}/api/rooms/${encodeURIComponent(lastJoin?.code ?? '')}/mod`)
    if (!res.ok) return false
    const data = (await res.json()) as { ok?: boolean; hash?: string; mod?: ModFile }
    if (!data.ok || !data.mod || !data.hash) return false
    const up = await fetch('/api/mods/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data.mod),
    })
    if (!up.ok) return false
    await refreshMods()
    setModActive(info.name, true)
    applyModClientBlock(data.mod)
    net?.ackMod(data.hash)
    return true
  } catch {
    return false
  } finally {
    modReqDownloadBtn.disabled = false
  }
}

const checkOnlineRoomMod = async (msg: LobbyMessage): Promise<void> => {
  if (!msg.mod) return
  const key = `${msg.roomCode}:${msg.mod.hash}`
  if (onlineModCheckedKey === key) return
  onlineModCheckedKey = key
  const local = await fetchModByName(msg.mod.name)
  const match = local !== null && modHash(local) === msg.mod.hash
  if (match) {
    setModActive(msg.mod.name, true)
    net?.ackMod(msg.mod.hash)
    modReqOverlayEl.classList.remove('visible')
  } else {
    showModRequirement(msg.mod)
  }
}

modReqDownloadBtn.addEventListener('click', () => {
  const info = onlineRequiredMod
  if (!info) return
  void (async () => {
    const ok = await installOnlineRoomMod(info)
    if (ok) {
      modReqStatusEl.textContent = t('mods.requiredDone')
      modReqStatusEl.classList.add('good')
    } else {
      modReqStatusEl.textContent = t('mods.requiredFail')
      modReqStatusEl.classList.remove('good')
    }
  })()
})

modReqCancelBtn.addEventListener('click', () => {
  modReqOverlayEl.classList.remove('visible')
})

// ---------- language ----------

initLang()

const syncLangButtons = (): void => {
  const lang = getLang()
  langEnBtn.classList.toggle('active', lang === 'en')
  langArBtn.classList.toggle('active', lang === 'ar')
}

const langEnBtn = document.getElementById('lang-en') as HTMLButtonElement
const langArBtn = document.getElementById('lang-ar') as HTMLButtonElement

const applyLang = (lang: Lang): void => {
  setLang(lang)
  translateStatic()
  syncLangButtons()
}

langEnBtn.addEventListener('click', () => applyLang('en'))
langArBtn.addEventListener('click', () => applyLang('ar'))
onLangChange(() => {
  refreshLobbyTexts()
  renderModPickers()
})
syncLangButtons()
translateStatic()

// ---------- mobile mode ----------

const tabMobile = document.getElementById('tab-mobile') as HTMLButtonElement
const MOBILE_KEY = 'space-arenas:mobile-mode'

const setMobileMode = (on: boolean): void => {
  document.body.classList.toggle('mobile-mode', on)
  tabMobile.classList.toggle('active', on)
  try {
    if (on) localStorage.setItem(MOBILE_KEY, '1')
    else localStorage.removeItem(MOBILE_KEY)
  } catch {
    /* storage unavailable */
  }
}

tabMobile.addEventListener('click', () => {
  setMobileMode(!document.body.classList.contains('mobile-mode'))
})

try {
  if (localStorage.getItem(MOBILE_KEY) === '1') setMobileMode(true)
} catch {
  /* storage unavailable */
}

// ---------- online server (Phase 1) ----------

/** Server origin the client talks REST to. Overridable at build time via VITE_SA_ONLINE_URL.
 *  Defaults to the local online server so the panel works out of the box in dev. */
const ONLINE_URL = ((import.meta.env.VITE_SA_ONLINE_URL as string | undefined) ?? 'http://127.0.0.1:17321').replace(/\/+$/, '')
const ONLINE_WS_BASE = ONLINE_URL.replace(/^http/, 'ws')

/** Whether a join address targets the online server (has a ws/wss scheme) vs LAN (ip:port). */
const isOnlineAddr = (addr: string | null | undefined): boolean => /^wss?:\/\//i.test(addr ?? '')

const onlineStatusEl = document.getElementById('online-status') as HTMLDivElement
const onlineStatRegisteredEl = document.getElementById('online-stat-registered') as HTMLElement
const onlineStatOnlineEl = document.getElementById('online-stat-online') as HTMLElement
const onlineStatMatchesEl = document.getElementById('online-stat-matches') as HTMLElement
const onlineMatchesBody = document.getElementById('online-matches-table')!.querySelector('tbody')!
const onlineNameEl = document.getElementById('online-name') as HTMLInputElement
const onlineSearchEl = document.getElementById('online-search') as HTMLInputElement
const accountOverlay = document.getElementById('account-overlay') as HTMLDivElement
const accountUsernameEl = document.getElementById('account-username') as HTMLInputElement
const accountGoogleBtn = document.getElementById('account-google') as HTMLButtonElement
const accountAnonUsernameEl = document.getElementById('account-anon-username') as HTMLInputElement
const accountAnonHintEl = document.getElementById('account-anon-hint') as HTMLParagraphElement
const accountSetUsernameBtn = document.getElementById('account-setusername') as HTMLButtonElement
const accountUsernameSetupEl = document.getElementById('account-username-setup') as HTMLDivElement
const accountUsernameHintEl = document.getElementById('account-username-hint') as HTMLParagraphElement
const serverOverlay = document.getElementById('server-overlay') as HTMLDivElement
const serverAddressEl = document.getElementById('server-address') as HTMLInputElement
const serverIndEl = document.getElementById('server-ind') as HTMLDivElement
const dbIndEl = document.getElementById('db-ind') as HTMLDivElement
const accountStatusEl = document.getElementById('account-status') as HTMLDivElement
const accountAnonEl = document.getElementById('account-anon') as HTMLDivElement
const accountAuthedEl = document.getElementById('account-authed') as HTMLDivElement
const accountProfileSummaryEl = document.getElementById('account-profilesummary') as HTMLDivElement
const accountLogoutBtn = document.getElementById('account-logout') as HTMLButtonElement
const leaderboardStatusEl = document.getElementById('leaderboard-status') as HTMLDivElement
const leaderboardBody = document.getElementById('leaderboard-table')!.querySelector('tbody')
const onlineMatchesSection = document.getElementById('online-matches-section') as HTMLDivElement
const onlineLeaderboardSection = document.getElementById('online-leaderboard-section') as HTMLDivElement
const onlineTabMatchesBtn = document.getElementById('online-tab-matches') as HTMLButtonElement
const onlineTabLeaderboardBtn = document.getElementById('online-tab-leaderboard') as HTMLButtonElement
const onlineTabDataBtn = document.getElementById('online-tab-data') as HTMLButtonElement
const onlineTabModsBtn = document.getElementById('online-tab-mods') as HTMLButtonElement
const onlineTabMapsBtn = document.getElementById('online-tab-maps') as HTMLButtonElement
const onlinePublishingNoticeEl = document.getElementById('online-publishing-notice') as HTMLParagraphElement
const onlineDataSection = document.getElementById('online-data-section') as HTMLDivElement
const onlineModsSection = document.getElementById('online-mods-section') as HTMLDivElement
const onlineMapsSection = document.getElementById('online-maps-section') as HTMLDivElement
const dataStatusEl = document.getElementById('data-status') as HTMLDivElement
const dataPassEl = document.getElementById('data-pass') as HTMLInputElement
const dataListEl = document.getElementById('data-list') as HTMLDivElement
const dataUploadDevBtn = document.getElementById('data-upload-dev') as HTMLButtonElement
const dataUploadProfileBtn = document.getElementById('data-upload-profile') as HTMLButtonElement
const joinpassOverlay = document.getElementById('joinpass-overlay') as HTMLDivElement
const joinpassInputEl = document.getElementById('joinpass-input') as HTMLInputElement
const joinpassOkBtn = document.getElementById('joinpass-ok') as HTMLButtonElement

interface OnlineRoom {
  id: string
  hostName: string
  mapName: string
  players: number
  maxPlayers: number
  status: 'lobby' | 'started' | 'full'
  passwordRequired: boolean
  created: number
}
let onlineRooms: OnlineRoom[] = []
let selectedOnlineRoom: OnlineRoom | null = null
let creatingOnline = false
let onlineRoomsEtag: string | null = null

const onlineName = (): string => onlineNameEl.value.trim() || 'Commander'

try {
  onlineNameEl.value = localStorage.getItem('space-arenas:name') ?? onlineName()
} catch {
  onlineNameEl.value = onlineName()
}

const setOnlineStatus = (text: string, isError = false): void => {
  onlineStatusEl.textContent = text
  onlineStatusEl.classList.toggle('error', isError)
}

const lobbyToastEl = document.getElementById('lobby-toast') as HTMLDivElement
let lobbyToastTimer: number | null = null
/** Short-lived lobby notice. Used for the "sign in to do that" prompts and for auth
 *  failures, where the panel status line alone is too quiet to notice. */
const lobbyToast = (text: string, isError = false): void => {
  lobbyToastEl.textContent = text
  lobbyToastEl.classList.toggle('error', isError)
  lobbyToastEl.classList.remove('hidden-el')
  if (lobbyToastTimer !== null) window.clearTimeout(lobbyToastTimer)
  lobbyToastTimer = window.setTimeout(() => {
    lobbyToastEl.classList.add('hidden-el')
    lobbyToastTimer = null
  }, LOBBY_TOAST_MS)
}

const ind = (el: HTMLDivElement, cls: 'ok' | 'bad' | 'wait', label: string): void => {
  el.className = `online-ind ${cls}`
  el.innerHTML = `<span class="dot"></span><span>${label}</span>`
}

const roomFilter = (): string => onlineSearchEl.value.trim().toLowerCase()

const renderOnlineMatches = (): void => {
  onlineMatchesBody.innerHTML = ''
  const query = roomFilter()
  const rooms = query
    ? onlineRooms.filter((r) => r.id.toLowerCase().includes(query) || r.hostName.toLowerCase().includes(query))
    : onlineRooms
  if (rooms.length === 0) {
    const tr = document.createElement('tr')
    const td = document.createElement('td')
    td.colSpan = 5
    td.className = 'net-empty'
    td.textContent = t('online.noMatches')
    tr.appendChild(td)
    onlineMatchesBody.appendChild(tr)
    selectedOnlineRoom = null
    return
  }
  for (const r of rooms) {
    const tr = document.createElement('tr')
    if (selectedOnlineRoom && selectedOnlineRoom.id === r.id) tr.classList.add('selected')
    const roomTd = document.createElement('td')
    roomTd.textContent = `${r.id}${r.passwordRequired ? ' 🔒' : ''}`
    const hostTd = document.createElement('td')
    hostTd.textContent = r.hostName
    const mapTd = document.createElement('td')
    mapTd.textContent = r.mapName
    const playersTd = document.createElement('td')
    playersTd.textContent = `${r.players}/${r.maxPlayers}`
    const statusTd = document.createElement('td')
    statusTd.textContent = r.status === 'started' ? t('network.inMatch') : t('network.waiting', { n: r.players, m: r.maxPlayers })
    tr.appendChild(roomTd)
    tr.appendChild(hostTd)
    tr.appendChild(mapTd)
    tr.appendChild(playersTd)
    tr.appendChild(statusTd)
    tr.addEventListener('click', () => {
      selectedOnlineRoom = r
      for (const tr2 of onlineMatchesBody.querySelectorAll('tr')) tr2.classList.remove('selected')
      tr.classList.add('selected')
    })
    onlineMatchesBody.appendChild(tr)
  }
}

const applyOnlineStats = (s: { rooms?: number; players?: number; registered?: number | null }): void => {
  const fmt = (v: number | null | undefined): string => (v === null || v === undefined ? '–' : String(v))
  onlineStatMatchesEl.textContent = fmt(s.rooms)
  onlineStatOnlineEl.textContent = fmt(s.players)
  onlineStatRegisteredEl.textContent = fmt(s.registered)
}

/** Live servers expose registered/online players in the `/api/rooms` payload.
 *  A server running an older build omits them — fall back to `/api/status` there
 *  so the online-stats row keeps working until every server is redeployed. */
const fetchOnlineStats = async (roomsCount: number): Promise<{ rooms: number; players: number; registered: number | null }> => {
  const res = await fetch(`${ONLINE_URL}/api/status`)
  if (!res.ok) throw new Error(String(res.status))
  const j = (await res.json()) as { rooms?: number; players?: number; registered?: number | null }
  return {
    rooms: typeof j.rooms === 'number' ? j.rooms : roomsCount,
    players: typeof j.players === 'number' ? j.players : NaN,
    registered: typeof j.registered === 'number' ? j.registered : null,
  }
}

const refreshOnlineList = async (silent = false): Promise<void> => {
  void refreshFeatureFlags()
  try {
    const headers: Record<string, string> = {}
    if (onlineRoomsEtag) headers['If-None-Match'] = onlineRoomsEtag
    const res = await fetch(`${ONLINE_URL}/api/rooms`, { headers })
    if (res.status === 304) {
      onlinePollDelay = ONLINE_LOBBY_POLL_MS
      if (!silent) setOnlineStatus(t('online.refreshed'))
      return
    }
    if (!res.ok) throw new Error(String(res.status))
    const data = (await res.json()) as { rooms?: OnlineRoom[]; players?: number; registered?: number | null }
    onlineRoomsEtag = res.headers.get('etag') ?? null
    onlineRooms = data.rooms ?? []
    selectedOnlineRoom = onlineRooms.some((r) => selectedOnlineRoom && r.id === selectedOnlineRoom.id) ? selectedOnlineRoom : null
    renderOnlineMatches()
    if (typeof data.players === 'number' && typeof data.registered === 'number') {
      applyOnlineStats({ rooms: (data.rooms ?? []).length, players: data.players, registered: data.registered })
    } else {
      // Old server build: stats live on /api/status instead. A missing/corrupt
      // status payload keeps the current dash values rather than zeroing them.
      try {
        applyOnlineStats(await fetchOnlineStats((data.rooms ?? []).length))
      } catch {
        applyOnlineStats({
          rooms: (data.rooms ?? []).length,
          players: data.players,
          registered: data.registered,
        })
      }
    }
    onlinePollDelay = ONLINE_LOBBY_POLL_MS
    if (!silent) setOnlineStatus(t('online.refreshed'))
  } catch {
    applyOnlineStats({})
    onlinePollDelay = Math.min(onlinePollDelay * 2, ONLINE_LOBBY_POLL_MAX_MS)
    if (!silent) setOnlineStatus(t('online.serverDown'), true)
  }
}

onlineSearchEl.addEventListener('input', renderOnlineMatches)

const onlineJoinSelected = (): void => {
  if (!selectedOnlineRoom) {
    setOnlineStatus(t('network.status.needCode'), true)
    return
  }
  // Re-entering a running match and a fresh join are the same thing to the server: both
  // claim a seat, so both need an account.
  if (!requireLogin('join')) return
  const room = selectedOnlineRoom
  if (room.status === 'started') {
    // Re-enter a running match: reclaims our slot (same clientId) while it's in the
    // reconnect-grace window, otherwise the server replies "already started" and the
    // room-full popup offers to spectate.
    void connectJoin(ONLINE_WS_BASE, room.id, '', onlineName())
    return
  }
  if (room.status === 'full') {
    setOnlineStatus(t('network.status.full'), true)
    return
  }
  if (!room.passwordRequired) {
    void connectJoin(ONLINE_WS_BASE, room.id, '', onlineName())
    return
  }
  if (joinpassOverlay.classList.contains('visible')) {
    joinpassOverlay.classList.remove('visible')
    void connectJoin(ONLINE_WS_BASE, room.id, joinpassInputEl.value, onlineName())
  } else {
    joinpassInputEl.value = ''
    joinpassOverlay.classList.add('visible')
    joinpassInputEl.focus()
  }
}

/** Opens the existing My Account popup. Online actions funnel through here instead of
 *  building a second login dialog, so there is exactly one sign-in surface in the game. */
const openAccountPopup = (): void => {
  if (usernameSetupRequired && accountUsernameEl.value.trim() === '') {
    accountUsernameEl.value = authSession?.username || onlineNameEl.value
  }
  accountOverlay.classList.add('visible')
  renderAnonAction()
  // Re-sync games/wins/best from the server every time the popup opens (matches update them).
  if (authSession) void adoptToken(authSession.token)
}

document.getElementById('online-account')!.addEventListener('click', openAccountPopup)
document.getElementById('online-server-setup')!.addEventListener('click', () => {
  serverAddressEl.value = ONLINE_URL
  serverOverlay.classList.add('visible')
  void (async () => {
    ind(serverIndEl, 'wait', t('network.status.connecting'))
    try {
      const res = await fetch(`${ONLINE_URL}/api/status`)
      if (!res.ok) throw new Error(String(res.status))
      const j = (await res.json()) as { ok: boolean; mode?: string; db?: boolean }
      ind(serverIndEl, j.ok ? 'ok' : 'bad', j.ok ? t('online.serverOnline') : t('online.serverDown'))
      if (j.db === true) ind(dbIndEl, 'ok', t('online.dbOnline'))
      else if (j.db === false) ind(dbIndEl, 'bad', t('online.dbOffline'))
      else ind(dbIndEl, 'wait', t('online.dbPending'))
    } catch {
      ind(serverIndEl, 'bad', t('online.serverDown'))
      ind(dbIndEl, 'wait', t('online.dbPending'))
    }
  })()
})

for (const [id, close] of [['account-close', accountOverlay], ['server-close', serverOverlay], ['joinpass-cancel', joinpassOverlay]] as const) {
  document.getElementById(id)!.addEventListener('click', () => close.classList.remove('visible'))
}
joinpassOkBtn.addEventListener('click', () => onlineJoinSelected())

document.getElementById('online-create')!.addEventListener('click', () => {
  if (!requireLogin('create')) return
  creatingOnline = true
  createAddrEl.value = ONLINE_URL
  createPassEl.value = ''
  createOverlay.classList.add('visible')
})
document.getElementById('online-join')!.addEventListener('click', onlineJoinSelected)
document.getElementById('online-refresh')!.addEventListener('click', () => {
  void refreshOnlineList(false)
  void loadLeaderboard(true)
  if (!onlineModsSection.classList.contains('hidden-el')) void loadRepoMods(true)
})

// ---------- account (Phase 2: Supabase auth + profiles) ----------

interface AuthSession {
  token: string
  userId: string
  email: string
  username: string
  games: number
  wins: number
  highScore: number
}

const AUTH_KEY = 'space-arenas:auth'
let authSession: AuthSession | null = null
/** True while the signed-in account still needs a unique username — a fresh Google account
 *  with no profile name, or a name that collided with an older account. Online actions are
 *  held until the player picks one; the server is the source of truth for both flags. */
let usernameSetupRequired = false
/** Why a rename is being asked for: 'required' = first-time setup, 'conflict' = the name is
 *  already held by an older account (the newer account is the one asked to change),
 *  'forbidden' = the name is on the server's reserved list (staff/impersonation guard). */
let usernameSetupReason: 'required' | 'conflict' | 'forbidden' = 'required'

/** The name typed on the sign-in form once "Check user name" has confirmed it is free. It is
 *  stashed in sessionStorage for the Google round-trip (the tab navigates away and back) and
 *  claimed automatically the moment a fresh account lands. */
const PENDING_USERNAME_KEY = 'space-arenas:pending-username'
let anonNameChecked: string | null = null
let anonNameChecking = false

const authToken = (): string | undefined => authSession?.token

const setAccountStatus = (text: string, isError = false): void => {
  accountStatusEl.textContent = text
  accountStatusEl.classList.toggle('error', isError)
}

const saveAuth = (s: AuthSession | null): void => {
  authSession = s
  try {
    if (s) sessionStorage.setItem(AUTH_KEY, JSON.stringify(s))
    else sessionStorage.removeItem(AUTH_KEY)
  } catch {
    /* storage unavailable */
  }
  updateAccountUI()
}

/** Online play needs an account: the server refuses anonymous create/join/spectate, so the
 *  client asks for one up front instead of letting the request fail. Returns true when a
 *  session is present; otherwise shows the prompt, opens My Account and returns false. */
const requireLogin = (action: 'create' | 'join' | 'spectate' | 'publish'): boolean => {
  if (authSession !== null) {
    // A signed-in account without a unique username is not usable yet — finish setup first.
    if (usernameSetupRequired) {
      lobbyToast(t('online.usernameRequired'))
      openAccountPopup()
      return false
    }
    return true
  }
  lobbyToast(t(`online.signInTo.${action}`))
  openAccountPopup()
  return false
}

/** Turns a server auth failure into a message worth reading. 503 means the auth/DB service
 *  is down — asking the player to sign in again would be pointless. */
const authErrorText = (status: number, error: string | undefined): string => {
  if (status === 503 || error === 'auth-unavailable') return t('online.authUnavailable')
  if (status === 401) return t('online.sessionExpired')
  return error ?? t('network.status.createFailed')
}

const updateAccountUI = (): void => {
  const signedIn = authSession !== null
  accountAnonEl.classList.toggle('hidden-el', signedIn)
  accountAuthedEl.classList.toggle('hidden-el', !signedIn)
  accountUsernameSetupEl.classList.toggle('hidden-el', !(signedIn && usernameSetupRequired))
  if (signedIn) {
    const s = authSession!
    accountProfileSummaryEl.textContent = t('online.accountSummary', { name: s.username || '—', games: s.games, wins: s.wins, score: s.highScore })
    if (usernameSetupRequired) {
      accountUsernameHintEl.textContent = t(
        usernameSetupReason === 'forbidden'
          ? 'online.usernameForbiddenHint'
          : usernameSetupReason === 'conflict'
            ? 'online.usernameConflictHint'
            : 'online.usernameSetupHint',
      )
      if (accountUsernameEl.value.trim() === '') accountUsernameEl.value = s.username || onlineNameEl.value
    }
  } else {
    renderAnonAction()
  }
}

const applyAuthUsername = (name: string): void => {
  const trimmed = name.trim() || 'Commander'
  onlineNameEl.value = trimmed
  accountUsernameEl.value = trimmed
  netNameEl.value = trimmed
  try {
    localStorage.setItem('space-arenas:name', trimmed)
  } catch {
    /* storage unavailable */
  }
}

const adoptToken = async (token: string): Promise<boolean> => {
  try {
    const res = await fetch(`${ONLINE_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) return false
    const j = (await res.json()) as {
      ok: boolean
      data?: {
        userId: string
        email: string
        username: string
        games: number
        wins: number
        highScore: number
        needsUsername?: boolean
        needsUsernameChange?: boolean
        usernameForbidden?: boolean
      }
    }
    if (!j.ok || !j.data) return false
    const d = j.data
    // The server decides whether a username is still needed; the newer account is the one
    // asked to change when two accounts somehow share a name, and a reserved name is a forced
    // rename as well.
    usernameSetupRequired = d.needsUsername === true || d.needsUsernameChange === true
    usernameSetupReason = d.usernameForbidden === true ? 'forbidden' : d.needsUsernameChange === true ? 'conflict' : 'required'
    if (d.username) applyAuthUsername(d.username)
    saveAuth({ token, userId: d.userId, email: d.email, username: d.username, games: d.games, wins: d.wins, highScore: d.highScore })
    return true
  } catch {
    return false
  }
}

const readPendingUsername = (): string | null => {
  try {
    return sessionStorage.getItem(PENDING_USERNAME_KEY)
  } catch {
    return null
  }
}

const clearPendingUsername = (): void => {
  try {
    sessionStorage.removeItem(PENDING_USERNAME_KEY)
  } catch {
    /* storage unavailable */
  }
}

const setAnonHint = (text: string, isError = false): void => {
  accountAnonHintEl.textContent = text
  accountAnonHintEl.classList.toggle('error', isError)
}

/** One button drives the whole signed-out flow: with an unchecked name typed it reads
 *  "Check user name"; once the name is verified free (or the field is left empty) it reads
 *  "Sign in with Google" — so returning players just click straight through. */
const renderAnonAction = (): void => {
  if (anonNameChecking) {
    accountGoogleBtn.disabled = true
    accountGoogleBtn.dataset.mode = 'check'
    accountGoogleBtn.textContent = t('online.checkingUsername')
    return
  }
  const name = accountAnonUsernameEl.value.trim()
  const needsCheck = name !== '' && name !== anonNameChecked
  accountGoogleBtn.disabled = false
  accountGoogleBtn.dataset.mode = needsCheck ? 'check' : 'signin'
  accountGoogleBtn.textContent = needsCheck ? t('online.checkUsername') : t('online.signInGoogle')
}

/** Asks the public pre-check endpoint whether the typed name is still free. The name can be
 *  lost in the gap before Google returns, which the claim step reports normally. */
const checkAnonUsername = async (): Promise<void> => {
  const name = accountAnonUsernameEl.value.trim()
  if (name === '') {
    renderAnonAction()
    return
  }
  anonNameChecking = true
  renderAnonAction()
  setAnonHint(t('online.checkingUsername'))
  try {
    const res = await fetch(`${ONLINE_URL}/api/auth/username-available?username=${encodeURIComponent(name)}`)
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean; data?: { available?: boolean; reason?: string } }
    if (!res.ok || j.ok !== true) {
      anonNameChecked = null
      setAnonHint(t('online.usernameCheckFailed'), true)
      return
    }
    if (j.data?.available === true) {
      anonNameChecked = name
      setAnonHint(t('online.usernameAvailable'))
      return
    }
    anonNameChecked = null
    setAnonHint(
      j.data?.reason === 'taken'
        ? t('online.usernameTaken')
        : j.data?.reason === 'not allowed'
          ? t('online.usernameForbidden')
          : t('online.usernameInvalid'),
      true,
    )
  } catch {
    anonNameChecked = null
    setAnonHint(t('online.usernameCheckFailed'), true)
  } finally {
    anonNameChecking = false
    renderAnonAction()
  }
}

/** Sends the browser to the server's Google OAuth entry point. The server 302s to Supabase,
 *  which returns the player here with the token in the URL fragment. A name already checked
 *  free travels along in sessionStorage so the fresh account can be renamed to it. */
const signInWithGoogle = (): void => {
  try {
    if (anonNameChecked) sessionStorage.setItem(PENDING_USERNAME_KEY, anonNameChecked)
    else sessionStorage.removeItem(PENDING_USERNAME_KEY)
  } catch {
    /* storage unavailable */
  }
  const here = window.location.href.split('#')[0]
  window.location.href = `${ONLINE_URL}/api/auth/google?redirect_to=${encodeURIComponent(here)}`
}

/** Claims `name` for the signed-in account — used for first-time setup and for the auto-claim
 *  right after a Google round-trip. Returns whether the server accepted it. */
const claimUsername = async (name: string): Promise<boolean> => {
  setAccountStatus(t('online.working'))
  try {
    const res = await fetch(`${ONLINE_URL}/api/auth/username`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken() ?? ''}` },
      body: JSON.stringify({ username: name }),
    })
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
    if (!res.ok || j.ok !== true) {
      setAccountStatus(
        j.error === 'username already taken'
          ? t('online.usernameTaken')
          : j.error === 'username not allowed'
            ? t('online.usernameForbidden')
            : (j.error ?? t('online.unknownError')),
        true,
      )
      return false
    }
    usernameSetupRequired = false
    applyAuthUsername(name)
    if (authSession) saveAuth({ ...authSession, username: name })
    updateAccountUI()
    setAccountStatus(t('online.usernameSaved'))
    return true
  } catch {
    setAccountStatus(t('online.serverDown'), true)
    return false
  }
}

const showAccountAuthError = (message: string): void => {
  openAccountPopup()
  setAccountStatus(message, true)
}

/** Consumes the `#access_token=…` (or `#error=…`) Supabase appends to the redirect target.
 *  Returns true when a sign-in attempt was found, so the caller can skip restoring an old
 *  session from storage. */
const handleOAuthRedirect = (): boolean => {
  const hash = window.location.hash
  if (hash === '' || (!hash.includes('access_token=') && !hash.includes('error='))) return false
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
  const token = params.get('access_token')
  const errorText = params.get('error_description') ?? params.get('error')
  try {
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
  } catch {
    /* history unavailable */
  }
  if (token === null || token === '') {
    if (errorText) showAccountAuthError(errorText)
    return true
  }
  void adoptToken(token).then((ok) => {
    if (!ok) {
      showAccountAuthError(t('online.loginFailed'))
      return
    }
    // A fresh account can be renamed straight away when the player checked a name before
    // starting the Google round-trip; otherwise fall back to the rename prompt.
    if (usernameSetupRequired) {
      const wanted = readPendingUsername()
      clearPendingUsername()
      if (wanted) {
        void claimUsername(wanted).then((claimed) => {
          if (!claimed) {
            openAccountPopup()
            setAccountStatus(t('online.usernameRequired'))
          }
        })
        return
      }
      openAccountPopup()
      setAccountStatus(t('online.usernameRequired'))
      return
    }
    clearPendingUsername()
    setAccountStatus(t('online.loginOk', { name: authSession?.username ?? '' }))
  })
  return true
}

accountGoogleBtn.addEventListener('click', () => {
  if (accountGoogleBtn.dataset.mode === 'check') void checkAnonUsername()
  else signInWithGoogle()
})

accountAnonUsernameEl.addEventListener('input', () => {
  anonNameChecked = null
  setAnonHint(t('online.anonNameHint'))
  renderAnonAction()
})

accountSetUsernameBtn.addEventListener('click', () => {
  const name = accountUsernameEl.value.trim()
  if (name === '') {
    setAccountStatus(t('online.fillAll'), true)
    return
  }
  void claimUsername(name)
})

accountLogoutBtn.addEventListener('click', () => {
  usernameSetupRequired = false
  saveAuth(null)
  setAccountStatus(t('online.loggedOut'))
})

// A returning Google sign-in lands with the token in the URL fragment; prefer it over any
// stored session so a fresh login always wins.
if (!handleOAuthRedirect()) {
  try {
    const raw = sessionStorage.getItem(AUTH_KEY)
    if (raw) {
      const s = JSON.parse(raw) as AuthSession
      if (s.token) {
        authSession = s
        updateAccountUI()
        void adoptToken(s.token).then((ok) => {
          if (!ok) saveAuth(null)
        })
      }
    }
  } catch {
    /* ignore malformed session */
  }
}

// ---------- leaderboard (Phase 2) ----------

/** Server feature flags. Publishing starts enabled client-side so a server that predates the
 *  flag (which omits it from /api/status) keeps its Mods/Maps tabs working. */
let publishingEnabled = true
let flagsFetchedAt = 0

/** Re-reads /api/status at most once a minute so a dashboard flip is picked up without a
 *  reload. Failures keep the current state — never gate the UI on a flaky status call. */
const refreshFeatureFlags = async (): Promise<void> => {
  if (Date.now() - flagsFetchedAt < 60_000) return
  flagsFetchedAt = Date.now()
  try {
    const res = await fetch(`${ONLINE_URL}/api/status`)
    if (!res.ok) return
    const j = (await res.json()) as { publishingEnabled?: boolean }
    if (typeof j.publishingEnabled === 'boolean') applyPublishingGate(j.publishingEnabled)
  } catch {
    /* keep the current state */
  }
}

const setOnlineTab = (tab: 'matches' | 'leaderboard' | 'data' | 'mods' | 'maps'): void => {
  // Mods/Maps stay readable when publishing is on, but while it is disabled the tabs are
  // disabled too — refuse to switch into them even if a click slips through.
  if ((tab === 'mods' || tab === 'maps') && !publishingEnabled) return
  onlineMatchesSection.classList.toggle('hidden-el', tab !== 'matches')
  onlineLeaderboardSection.classList.toggle('hidden-el', tab !== 'leaderboard')
  onlineDataSection.classList.toggle('hidden-el', tab !== 'data')
  onlineModsSection.classList.toggle('hidden-el', tab !== 'mods')
  onlineMapsSection.classList.toggle('hidden-el', tab !== 'maps')
  onlineTabMatchesBtn.classList.toggle('selected', tab === 'matches')
  onlineTabLeaderboardBtn.classList.toggle('selected', tab === 'leaderboard')
  onlineTabDataBtn.classList.toggle('selected', tab === 'data')
  onlineTabModsBtn.classList.toggle('selected', tab === 'mods')
  onlineTabMapsBtn.classList.toggle('selected', tab === 'maps')
}

const renderLeaderboard = (rows: Array<{ rank: number; username: string; score: number }>): void => {
  if (!leaderboardBody) return
  leaderboardBody.innerHTML = ''
  if (rows.length === 0) {
    const tr = document.createElement('tr')
    const td = document.createElement('td')
    td.colSpan = 3
    td.className = 'net-empty'
    td.textContent = t('online.lbEmpty')
    tr.appendChild(td)
    leaderboardBody.appendChild(tr)
    return
  }
  for (const r of rows) {
    const tr = document.createElement('tr')
    if (authSession && authSession.username === r.username) tr.classList.add('selected')
    const rankTd = document.createElement('td')
    rankTd.textContent = String(r.rank)
    const playerTd = document.createElement('td')
    playerTd.textContent = r.username
    if (authSession && authSession.username === r.username) playerTd.textContent += ` ${t('online.lbYou')}`
    const scoreTd = document.createElement('td')
    scoreTd.textContent = String(r.score)
    tr.appendChild(rankTd)
    tr.appendChild(playerTd)
    tr.appendChild(scoreTd)
    leaderboardBody.appendChild(tr)
  }
}

const loadLeaderboard = async (silent = false): Promise<void> => {
  try {
    const res = await fetch(`${ONLINE_URL}/api/leaderboard`)
    if (!res.ok) throw new Error(String(res.status))
    const j = (await res.json()) as {
      ok: boolean
      data?: Array<{ rank: number; username: string; score: number }>
      error?: string
    }
    if (!j.ok || !j.data) throw new Error(j.error ?? 'error')
    renderLeaderboard(j.data)
    if (!silent) leaderboardStatusEl.textContent = ''
  } catch {
    if (!silent) leaderboardStatusEl.textContent = t('online.lbUnavailable')
  }
}

onlineTabMatchesBtn.addEventListener('click', () => setOnlineTab('matches'))
onlineTabLeaderboardBtn.addEventListener('click', () => {
  setOnlineTab('leaderboard')
  void loadLeaderboard(false)
})
onlineTabDataBtn.addEventListener('click', () => {
  setOnlineTab('data')
  void loadBackups(false)
})
onlineTabModsBtn.addEventListener('click', () => {
  setOnlineTab('mods')
  void loadRepoMods(false)
  void refreshMods()
})
onlineTabMapsBtn.addEventListener('click', () => {
  setOnlineTab('maps')
  void loadRepoMaps(false)
})

let onlinePollTimer: number | null = null
let onlinePollDelay = ONLINE_LOBBY_POLL_MS
const pollOnlineLobby = (): void => {
  if (onlinePollTimer !== null) window.clearTimeout(onlinePollTimer)
  onlinePollTimer = window.setTimeout(async () => {
    if (document.visibilityState === 'visible' && !onlinePanel.classList.contains('hidden-panel')) {
      await refreshOnlineList(true)
    }
    pollOnlineLobby()
  }, onlinePollDelay)
}
pollOnlineLobby()
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    onlinePollDelay = ONLINE_LOBBY_POLL_MS
    if (!onlinePanel.classList.contains('hidden-panel')) void refreshOnlineList(true)
  }
})

onlineNameEl.addEventListener('input', () => {
  const name = onlineNameEl.value.trim() || 'Commander'
  netNameEl.value = name
  try {
    localStorage.setItem('space-arenas:name', name)
  } catch {
    /* storage unavailable */
  }
})

// ---------- cloud backups (Phase 3) ----------

interface BackupInfo {
  id: string
  kind: 'devsettings' | 'profile'
  createdAt: string
  expiresAt: string
}

let backups: BackupInfo[] = []

const DAY_MS = 24 * 60 * 60 * 1000

const setDataStatus = (text: string, isError = false): void => {
  dataStatusEl.textContent = text
  dataStatusEl.classList.toggle('error', isError)
}

/** REST call against the online server that always attaches the account bearer token. */
const authApi = async (method: string, path: string, body?: unknown): Promise<{ ok: boolean; status: number; error?: string; data?: Record<string, unknown> }> => {
  try {
    const headers: Record<string, string> = {}
    const token = authToken()
    if (token) headers.Authorization = `Bearer ${token}`
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json'
      return await fetch(`${ONLINE_URL}${path}`, {
        method,
        headers,
        body: JSON.stringify(body),
      }).then(parseAuth)
    }
    return await fetch(`${ONLINE_URL}${path}`, { method, headers }).then(parseAuth)
    async function parseAuth(res: Response): Promise<{ ok: boolean; status: number; error?: string; data?: Record<string, unknown> }> {
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; data?: unknown }
      if (res.ok) {
        const payload = j && typeof j === 'object' && j.ok === true ? j.data : j
        return { ok: true, status: res.status, data: (payload ?? {}) as Record<string, unknown> }
      }
      return { ok: false, status: res.status, error: String(j.error ?? `HTTP ${res.status}`) }
    }
  } catch {
    return { ok: false, status: 0, error: t('online.serverDown') }
  }
}

const loadBackups = async (silent = false): Promise<void> => {
  if (!authSession || !authToken()) {
    backups = []
    renderBackups()
    if (!silent) setDataStatus(t('online.dataNeedLogin'))
    return
  }
  const r = await authApi('GET', '/api/backups')
  if (!r.ok) {
    if (!silent) setDataStatus(t('online.dataUnavailable'), true)
    return
  }
  backups = (r.data as unknown as BackupInfo[] | undefined) ?? []
  renderBackups()
  if (!silent) setDataStatus('')
}

const renderBackups = (): void => {
  dataListEl.innerHTML = ''
  if (backups.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'net-empty'
    empty.textContent = t('online.dataEmpty')
    dataListEl.appendChild(empty)
    return
  }
  for (const b of backups) {
    const row = document.createElement('div')
    row.className = 'backup-row'
    const badge = document.createElement('span')
    badge.className = 'badge'
    badge.textContent = t(b.kind === 'profile' ? 'online.dataKindProfile' : 'online.dataKindDev')
    const meta = document.createElement('span')
    meta.className = 'meta'
    const daysLeft = Math.ceil((new Date(b.expiresAt).getTime() - Date.now()) / DAY_MS)
    if (daysLeft <= 0) {
      const expired = document.createElement('span')
      expired.className = 'expired'
      expired.textContent = t('online.dataExpired')
      meta.appendChild(expired)
    } else {
      meta.textContent = t('online.dataExpiresIn', {
        n: String(daysLeft),
        date: new Date(b.expiresAt).toLocaleDateString(),
      })
    }
    const restoreBtn = document.createElement('button')
    restoreBtn.className = 'ghost'
    restoreBtn.textContent = t('online.dataRestore')
    restoreBtn.addEventListener('click', () => void restoreBackup(b))
    const delBtn = document.createElement('button')
    delBtn.className = 'ghost'
    delBtn.textContent = t('online.dataDelete')
    delBtn.addEventListener('click', () => void deleteBackup(b))
    row.appendChild(badge)
    row.appendChild(meta)
    row.appendChild(restoreBtn)
    row.appendChild(delBtn)
    dataListEl.appendChild(row)
  }
}

/** Serializes one device's local data into a JSON payload (keys → raw storage values). */
const collectPayload = (kind: 'devsettings' | 'profile'): string | null => {
  if (kind === 'devsettings') {
    // Everything the dev panel can touch: the synced overrides + defaults, the
    // client-only graphics/audio/profile stores, plus the other local dev stores
    // (control bindings, HUD layout, custom maps) so a cloud restore is complete.
    const keys: Record<string, string> = {
      'space-arenas:dev-settings': JSON.stringify(devOverrides),
      'space-arenas:dev-defaults': JSON.stringify(savedDefaults),
      'space-arenas:graphics': JSON.stringify(getGraphics()),
      'space-arenas:audio': JSON.stringify(getAudio()),
    }
    for (const k of ['space-arenas:profile:config', 'space-arenas:controls', 'space-arenas:hud-parts', 'space-arenas:custom-maps', 'space-arenas:mods-active', 'space-arenas:offline-mod', 'space-arenas:dev-client-defaults']) {
      try {
        const raw = localStorage.getItem(k)
        if (raw !== null) keys[k] = raw
      } catch {
        /* storage unavailable */
      }
    }
    return JSON.stringify({ v: 1, kind, keys })
  }
  const keys = ['space-arenas:profile', 'space-arenas:profile:config', 'space-arenas:mode-records']
  const entries: Record<string, string> = {}
  for (const k of keys) {
    const raw = localStorage.getItem(k)
    if (raw !== null) entries[k] = raw
  }
  if (Object.keys(entries).length === 0) return null
  return JSON.stringify({ v: 1, kind, keys: entries })
}

/** Passphrase from the most recent successful cloud upload/restore this session,
 *  so "Save changes" can refresh the cloud snapshot without re-prompting. */
let lastBackupPass = ''

const uploadBackup = async (kind: 'devsettings' | 'profile', opts?: { pass?: string; silent?: boolean }): Promise<void> => {
  if (!authSession || !authToken()) {
    if (!opts?.silent) setDataStatus(t('online.dataNeedLogin'), true)
    return
  }
  const pass = opts?.pass ?? dataPassEl.value
  if (pass.length < 4) {
    if (!opts?.silent) setDataStatus(t('online.dataNeedPass'), true)
    return
  }
  const payload = collectPayload(kind)
  if (payload === null) {
    if (!opts?.silent) setDataStatus(kind === 'devsettings' ? t('online.dataNoDev') : t('online.dataNoProfile'), true)
    return
  }
  if (!opts?.silent) setDataStatus(t('online.working'))
  try {
    const bundle = await encryptPayload(payload, pass)
    const passphraseHash = await sha256Hex(pass)
    const r = await authApi('POST', '/api/backups', { kind, payload: bundle, passphraseHash })
    if (!r.ok) throw new Error(r.error ?? t('online.unknownError'))
    lastBackupPass = pass
    await loadBackups(true)
    if (!opts?.silent) {
      setDataStatus(t('online.dataUploaded'))
      dataPassEl.value = ''
    }
  } catch (err) {
    if (!opts?.silent) setDataStatus(err instanceof Error && err.message ? err.message : t('online.unknownError'), true)
  }
}

const restoreBackup = async (b: BackupInfo): Promise<void> => {
  if (!authSession || !authToken()) {
    setDataStatus(t('online.dataNeedLogin'), true)
    return
  }
  const pass = dataPassEl.value
  if (pass.length < 4) {
    setDataStatus(t('online.dataNeedPass'), true)
    return
  }
  setDataStatus(t('online.working'))
  try {
    const passphraseHash = await sha256Hex(pass)
    const r = await authApi('POST', `/api/backups/${b.id}/restore`, { passphraseHash })
    if (!r.ok) throw new Error(r.error ?? t('online.unknownError'))
    const plain = await decryptPayload(String(r.data?.payload ?? ''), pass)
    const parsed = JSON.parse(plain) as { kind?: string; keys?: Record<string, string> }
    if (!parsed.keys || typeof parsed.keys !== 'object') throw new Error(t('online.dataBadBlob'))
    for (const [k, vRaw] of Object.entries(parsed.keys)) {
      try {
        if (vRaw === '') localStorage.removeItem(k)
        else localStorage.setItem(k, vRaw)
      } catch {
        /* this device's storage is full — skip that one key */
      }
    }
    const decodedKeys = parsed.keys as Record<string, string> | undefined
    if (parsed.kind === 'devsettings' || decodedKeys?.['space-arenas:dev-settings'] !== undefined) {
      try {
        const raw = localStorage.getItem(DEV_STORAGE_KEY)
        devOverrides = raw ? (JSON.parse(raw) as Partial<MatchSettings>) : {}
      } catch {
        /* storage unavailable */
      }
      try {
        const rawDefaults = localStorage.getItem(DEV_DEFAULTS_KEY)
        savedDefaults = rawDefaults ? (JSON.parse(rawDefaults) as Partial<MatchSettings>) : {}
      } catch {
        /* storage unavailable */
      }
            try {
        const rawClient = localStorage.getItem(DEV_CLIENT_KEY)
        settingsFile.client = rawClient ? sanitizeClientDevSettings(JSON.parse(rawClient) as ClientDevSettings, window.location.origin) : undefined
      } catch {
        /* storage unavailable */
      }
      reloadGraphics()
      reloadAudio()
      // Import sanitize: drop any foreign-origin absolute asset/audio paths that
      // rode in on the backup (keeps relative + same-origin values).
      applyClientDevSettings(sanitizeClientDevSettings(clientDevSettings(), window.location.origin), true)
      renderProfilePanel()
      buildDevForm()
    }
    if (parsed.kind === 'profile' || decodedKeys?.['space-arenas:profile'] !== undefined) {
      renderProfilePanel()
    }
    lastBackupPass = pass
    setDataStatus(t('online.dataRestored'))
    dataPassEl.value = ''
  } catch (err) {
    setDataStatus(err instanceof Error && err.message ? err.message : t('online.unknownError'), true)
  }
}

const deleteBackup = async (b: BackupInfo): Promise<void> => {
  if (!authToken()) return
  const r = await authApi('DELETE', `/api/backups/${b.id}`)
  if (!r.ok) {
    setDataStatus(r.error ?? t('online.unknownError'), true)
    return
  }
  backups = backups.filter((x) => x.id !== b.id)
  renderBackups()
  setDataStatus(t('online.dataDeleted'))
}

dataUploadDevBtn.addEventListener('click', () => void uploadBackup('devsettings'))
dataUploadProfileBtn.addEventListener('click', () => void uploadBackup('profile'))

// ---------- mod repository (Phase 4) ----------

interface RepoMod {
  id: string
  ownerId: string
  ownerName?: string
  name: string
  author: string
  description: string
  version: string
  sizeBytes: number
  downloads: number
  ratingAvg: number | null
  ratingCount: number
  requireProtocol: number
  createdAt: string
}

interface RepoComment {
  id: string
  username: string
  body: string
  createdAt: string
}

const modsRepoStatusEl = document.getElementById('mods-repo-status') as HTMLDivElement
const modsRepoSearchEl = document.getElementById('mods-repo-search') as HTMLInputElement
const modsRepoSortEl = document.getElementById('mods-repo-sort') as HTMLSelectElement
const modsRepoListEl = document.getElementById('mods-repo-list') as HTMLDivElement
const modsRepoPublishSelectEl = document.getElementById('mods-repo-publish-select') as HTMLSelectElement
const modsRepoPublishBtn = document.getElementById('mods-repo-publish') as HTMLButtonElement
const modsRepoPublishDescEl = document.getElementById('mods-repo-publish-desc') as HTMLInputElement

let repoMods: RepoMod[] = []
let repoSort = 'newest'

const REPO_SORTS: Array<[string, string]> = [
  ['newest', 'mods.repo.repoSortNewest'],
  ['downloads', 'mods.repo.repoSortDownloads'],
  ['rating', 'mods.repo.repoSortRating'],
]

for (const [value, i18nKey] of REPO_SORTS) {
  const opt = document.createElement('option')
  opt.value = value
  opt.textContent = t(i18nKey)
  modsRepoSortEl.appendChild(opt)
}

const setRepoStatus = (text: string, isError = false): void => {
  modsRepoStatusEl.textContent = text
  modsRepoStatusEl.classList.toggle('error', isError)
}

const loadRepoMods = async (silent = false): Promise<void> => {
  try {
    const q = modsRepoSearchEl.value.trim()
    const url = `${ONLINE_URL}/api/mods/repo?sort=${encodeURIComponent(repoSort)}${q ? `&q=${encodeURIComponent(q)}` : ''}`
    const res = await fetch(url)
    const j = (await res.json()) as { ok?: boolean; error?: string; mods?: RepoMod[] }
    if (!res.ok) throw new Error(j.error ?? String(res.status))
    repoMods = j.mods ?? []
    renderRepoMods()
    if (!silent) setRepoStatus('')
  } catch {
    repoMods = []
    renderRepoMods()
    if (!silent) setRepoStatus(t('mods.repo.repoError'), true)
  }
}

const repoStars = (avg: number | null): string => {
  if (avg === null || avg === undefined) return '\u2606'.repeat(5)
  return '\u2605'.repeat(Math.max(0, Math.min(5, Math.round(avg)))) + '\u2606'.repeat(Math.max(0, 5 - Math.round(avg)))
}

const installRepoMod = async (m: RepoMod): Promise<void> => {
  setRepoStatus(t('online.working'))
  try {
    const res = await fetch(`${ONLINE_URL}/api/mods/${encodeURIComponent(m.id)}`)
    if (!res.ok) throw new Error(String(res.status))
    const body = await res.text()
    JSON.parse(body)
    const up = await fetch('/api/mods/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
    if (!up.ok) throw new Error(String(up.status))
    await refreshMods()
    setRepoStatus(t('mods.repo.repoInstalled'))
  } catch {
    setRepoStatus(t('mods.repo.repoInstallFail'), true)
  }
}

const rateRepoMod = async (m: RepoMod): Promise<void> => {
  if (!authSession) {
    setRepoStatus(t('mods.repo.repoNeedLogin'), true)
    return
  }
  const raw = window.prompt(t('mods.repo.repoRatePrompt'))
  if (raw === null) return
  const rating = Math.round(Number(raw))
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    setRepoStatus(t('mods.repo.repoRateInvalid'), true)
    return
  }
  const r = await authApi('POST', `/api/mods/${encodeURIComponent(m.id)}/rate`, { rating })
  if (!r.ok) {
    setRepoStatus(r.error ?? t('mods.repo.repoRateFail'), true)
    return
  }
  setRepoStatus(t('mods.repo.repoRateOk', { n: String(rating) }))
  void loadRepoMods(true)
}

const deleteRepoMod = async (m: RepoMod): Promise<void> => {
  if (!window.confirm(t('mods.repo.repoDeleteConfirm', { name: m.name }))) return
  const r = await authApi('DELETE', `/api/mods/${encodeURIComponent(m.id)}`)
  if (!r.ok) {
    setRepoStatus(r.error ?? t('mods.repo.repoDeleteFail'), true)
    return
  }
  repoMods = repoMods.filter((x) => x.id !== m.id)
  renderRepoMods()
  setRepoStatus(t('mods.repo.repoDeleted'))
}

const renderRepoComments = async (m: RepoMod, box: HTMLDivElement): Promise<void> => {
  box.innerHTML = ''
  try {
    const res = await fetch(`${ONLINE_URL}/api/mods/${encodeURIComponent(m.id)}/comments`)
    const j = (await res.json()) as { ok?: boolean; comments?: RepoComment[] }
    if (!res.ok || !j.ok) throw new Error()
    const comments = j.comments ?? []
    if (comments.length === 0) {
      const none = document.createElement('div')
      none.className = 'net-empty'
      none.textContent = t('mods.repo.repoCommentsEmpty')
      box.appendChild(none)
    }
    for (const c of comments) {
      const line = document.createElement('div')
      line.className = 'repo-comment'
      const head = document.createElement('span')
      head.className = 'mod-meta'
      head.textContent = `${c.username || '?'} · ${new Date(c.createdAt).toLocaleDateString()}`
      const body = document.createElement('span')
      body.textContent = c.body
      line.appendChild(head)
      line.appendChild(body)
      box.appendChild(line)
    }
    if (authSession) {
      const inputRow = document.createElement('div')
      inputRow.className = 'maps-toolbar'
      const textarea = document.createElement('textarea')
      textarea.maxLength = 500
      textarea.rows = 2
      textarea.placeholder = t('mods.repo.repoCommentPlaceholder')
      const send = document.createElement('button')
      send.className = 'ghost'
      send.textContent = t('mods.repo.repoCommentSend')
      send.addEventListener('click', () => {
        void (async () => {
          const text = textarea.value.trim()
          if (!text) return
          const r = await authApi('POST', `/api/mods/${encodeURIComponent(m.id)}/comments`, { body: text })
          if (!r.ok) {
            setRepoStatus(r.error ?? t('mods.repo.repoCommentFail'), true)
            return
          }
          textarea.value = ''
          await renderRepoComments(m, box)
        })()
      })
      inputRow.appendChild(textarea)
      inputRow.appendChild(send)
      box.appendChild(inputRow)
    }
  } catch {
    const fail = document.createElement('div')
    fail.className = 'hint error'
    fail.textContent = t('mods.repo.repoCommentsFail')
    box.appendChild(fail)
  }
}

const repoModRow = (m: RepoMod): HTMLDivElement => {
  const row = document.createElement('div')
  row.className = 'backup-row mod-row'
  const title = document.createElement('span')
  title.className = 'mod-title'
  title.textContent = m.name
  title.title = t('mods.repo.repoRating', { avg: String(m.ratingAvg ?? '—'), c: String(m.ratingCount) })
  const meta = document.createElement('span')
  meta.className = 'mod-meta'
  meta.textContent = m.description || t('mods.repo.repoBy', { author: m.ownerName || m.author || '?' })
  const stats = document.createElement('span')
  stats.className = 'mod-meta repo-stars'
  stats.textContent = m.ratingCount > 0 ? `${repoStars(m.ratingAvg)} ${m.ratingAvg}/5 · ${t('mods.repo.repoDownloads', { n: String(m.downloads) })}` : `${repoStars(null)} ${t('mods.repo.repoNoRatings')} · ${t('mods.repo.repoDownloads', { n: String(m.downloads) })}`
  const actions = document.createElement('span')
  actions.className = 'archive-actions'
  const commentsBtn = document.createElement('button')
  commentsBtn.className = 'ghost'
  commentsBtn.textContent = t('mods.repo.repoComments')
  let commentsBox: HTMLDivElement | null = null
  commentsBtn.addEventListener('click', () => {
    if (!commentsBox) {
      commentsBox = document.createElement('div')
      commentsBox.className = 'repo-comments'
      row.appendChild(commentsBox)
      void renderRepoComments(m, commentsBox)
    } else {
      commentsBox.remove()
      commentsBox = null
    }
  })
  actions.appendChild(commentsBtn)
  const install = document.createElement('button')
  install.className = 'ghost'
  install.textContent = t('mods.repo.repoInstall')
  install.addEventListener('click', () => void installRepoMod(m))
  actions.appendChild(install)
  if (authSession) {
    const rate = document.createElement('button')
    rate.className = 'ghost'
    rate.textContent = t('mods.repo.repoRate')
    rate.addEventListener('click', () => void rateRepoMod(m))
    actions.appendChild(rate)
  }
  if (authSession && authSession.userId === m.ownerId) {
    const del = document.createElement('button')
    del.className = 'ghost danger'
    del.textContent = t('mods.repo.repoDelete')
    del.addEventListener('click', () => void deleteRepoMod(m))
    actions.appendChild(del)
  }
  row.append(title, meta, stats, actions)
  return row
}

const renderRepoPublishSelect = (): void => {
  const prev = modsRepoPublishSelectEl.value
  modsRepoPublishSelectEl.innerHTML = ''
  const publishable = modsCache.filter((m) => m.valid && m.protocolOk !== false)
  // The picker stays usable while signed out: a player can line up what they want to
  // publish and the Publish button then opens My Account. Disabling it outright would
  // leave no way to ask for a login from here.
  const empty = publishable.length === 0
  modsRepoPublishSelectEl.disabled = empty
  modsRepoPublishDescEl.disabled = empty
  modsRepoPublishBtn.disabled = empty
  for (const m of publishable) {
    const opt = document.createElement('option')
    opt.value = m.name
    opt.textContent = m.label
    modsRepoPublishSelectEl.appendChild(opt)
  }
  if (publishable.some((m) => m.name === prev)) modsRepoPublishSelectEl.value = prev
}

modsRepoPublishDescEl.addEventListener('input', () => {
  modsRepoPublishBtn.disabled = modsRepoPublishSelectEl.value === '' || modsRepoPublishSelectEl.disabled
})

const renderRepoMods = (): void => {
  modsRepoListEl.innerHTML = ''
  if (repoMods.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'net-empty'
    empty.textContent = t('mods.repo.repoEmpty')
    modsRepoListEl.appendChild(empty)
  }
  for (const m of repoMods) modsRepoListEl.appendChild(repoModRow(m))
  renderRepoPublishSelect()
}

const publishRepoMod = async (): Promise<void> => {
  if (!requireLogin('publish')) return
  const name = modsRepoPublishSelectEl.value
  if (!name) {
    setRepoStatus(t('mods.repo.repoPublishNoMods'), true)
    return
  }
  const description = modsRepoPublishDescEl.value.trim()
  if (description === '') {
    setRepoStatus(t('mods.repo.repoPublishNeedDesc'), true)
    return
  }
  setRepoStatus(t('online.working'))
  try {
    const read = await fetch(`/api/mods?name=${encodeURIComponent(name)}`)
    if (!read.ok) throw new Error(String(read.status))
    const payload = (await read.json()) as { meta?: Record<string, unknown> }
    const meta = typeof payload.meta === 'object' && payload.meta ? payload.meta : {}
    payload.meta = { ...meta, description: description.slice(0, 160) }
    const r = await authApi('POST', '/api/mods', payload)
    if (!r.ok) {
      setRepoStatus(r.error ?? t('mods.repo.repoPublishFail'), true)
      return
    }
    modsRepoPublishDescEl.value = ''
    await loadRepoMods(true)
    setRepoStatus(t('mods.repo.repoPublishOk', { name }))
  } catch {
    setRepoStatus(t('mods.repo.repoInstallFail'), true)
  }
}

let repoSearchTimer: number | undefined
modsRepoSearchEl.addEventListener('input', () => {
  window.clearTimeout(repoSearchTimer)
  repoSearchTimer = window.setTimeout(() => void loadRepoMods(true), 350)
})
modsRepoSortEl.addEventListener('change', () => {
  repoSort = modsRepoSortEl.value
  void loadRepoMods(true)
})
modsRepoPublishSelectEl.addEventListener('change', () => {
  const locked = modsRepoPublishSelectEl.disabled
  modsRepoPublishBtn.disabled = locked || modsRepoPublishSelectEl.value === '' || modsRepoPublishDescEl.value.trim() === ''
})
modsRepoPublishBtn.addEventListener('click', () => void publishRepoMod())

// ---------- community maps (Phase 5: mirrors the mod repository) ----------

interface RepoMap {
  id: string
  ownerId: string
  ownerName: string
  name: string
  author: string
  description: string
  version: string
  sizeBytes: number
  width: number
  height: number
  players: number
  requireProtocol: number
  downloads: number
  ratingAvg: number | null
  ratingCount: number
  createdAt: string
}

const MAP_REPO_SORTS: Array<[string, string]> = [
  ['newest', 'maps.repo.repoSortNewest'],
  ['rating', 'maps.repo.repoSortRating'],
  ['downloads', 'maps.repo.repoSortDownloads'],
  ['players', 'maps.repo.repoSortPlayers'],
]

const mapsRepoStatusEl = document.getElementById('maps-repo-status') as HTMLDivElement
const mapsRepoListEl = document.getElementById('maps-repo-list') as HTMLDivElement
const mapsRepoSearchEl = document.getElementById('maps-repo-search') as HTMLInputElement
const mapsRepoSortEl = document.getElementById('maps-repo-sort') as HTMLSelectElement
const mapsRepoPublishSelectEl = document.getElementById('maps-repo-publish-select') as HTMLSelectElement
const mapsRepoPublishDescEl = document.getElementById('maps-repo-publish-desc') as HTMLInputElement
const mapsRepoPublishBtn = document.getElementById('maps-repo-publish') as HTMLButtonElement

/** Shades the Online panel for the publishing feature flag: Mods/Maps stay on screen but are
 *  disabled (not hidden), publish controls are locked, and a short notice explains why. */
const applyPublishingGate = (enabled: boolean): void => {
  publishingEnabled = enabled
  for (const tab of [onlineTabModsBtn, onlineTabMapsBtn]) {
    tab.disabled = !enabled
    tab.setAttribute('aria-disabled', String(!enabled))
    tab.classList.toggle('disabled', !enabled)
  }
  onlinePublishingNoticeEl.hidden = enabled
  if (enabled) return
  for (const el of [modsRepoPublishSelectEl, modsRepoPublishDescEl, modsRepoPublishBtn, mapsRepoPublishSelectEl, mapsRepoPublishDescEl, mapsRepoPublishBtn]) {
    el.disabled = true
  }
  if (onlineModsSection.classList.contains('hidden-el') === false || onlineMapsSection.classList.contains('hidden-el') === false) {
    setOnlineTab('matches')
  }
}

let repoMaps: RepoMap[] = []
let mapRepoSort = 'newest'

const setMapRepoStatus = (text: string, isError = false): void => {
  mapsRepoStatusEl.textContent = text
  mapsRepoStatusEl.classList.toggle('error', isError)
}

for (const [value, i18nKey] of MAP_REPO_SORTS) {
  const opt = document.createElement('option')
  opt.value = value
  opt.textContent = t(i18nKey)
  mapsRepoSortEl.appendChild(opt)
}

const loadRepoMaps = async (silent = false): Promise<void> => {
  try {
    const q = mapsRepoSearchEl.value.trim()
    const url = `${ONLINE_URL}/api/maps/repo?sort=${encodeURIComponent(mapRepoSort)}${q ? `&q=${encodeURIComponent(q)}` : ''}`
    const res = await fetch(url)
    const j = (await res.json()) as { ok?: boolean; error?: string; maps?: RepoMap[] }
    if (!res.ok) throw new Error(j.error ?? String(res.status))
    repoMaps = j.maps ?? []
    renderRepoMaps()
    if (!silent) setMapRepoStatus('')
  } catch {
    repoMaps = []
    renderRepoMaps()
    if (!silent) setMapRepoStatus(t('maps.repo.repoError'), true)
  }
}

const repoMapStars = (avg: number | null): string => {
  if (avg === null || avg === undefined) return '\u2606'.repeat(5)
  return '\u2605'.repeat(Math.max(0, Math.min(5, Math.round(avg)))) + '\u2606'.repeat(Math.max(0, 5 - Math.round(avg)))
}

const installRepoMap = async (m: RepoMap): Promise<void> => {
  setMapRepoStatus(t('online.working'))
  try {
    const res = await fetch(`${ONLINE_URL}/api/maps/${encodeURIComponent(m.id)}`)
    if (!res.ok) throw new Error(String(res.status))
    const parsed = (await res.json()) as MapData
    const saved = saveCustomMap(parsed)
    if (!saved.ok) {
      setMapRepoStatus(t('maps.repo.repoInstallFail') + (saved.errors[0] ? ` — ${saved.errors[0]}` : ''), true)
      return
    }
    renderMapBuilderTable()
    renderMapSelect()
    await loadRepoMaps(true)
    setMapRepoStatus(t('maps.repo.repoInstalled'))
  } catch {
    setMapRepoStatus(t('maps.repo.repoInstallFail'), true)
  }
}

const rateRepoMap = async (m: RepoMap): Promise<void> => {
  if (!authSession) {
    setMapRepoStatus(t('maps.repo.repoNeedLogin'), true)
    return
  }
  const raw = window.prompt(t('maps.repo.repoRatePrompt'))
  if (raw === null) return
  const rating = Math.round(Number(raw))
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    setMapRepoStatus(t('maps.repo.repoRateInvalid'), true)
    return
  }
  const r = await authApi('POST', `/api/maps/${encodeURIComponent(m.id)}/rate`, { rating })
  if (!r.ok) {
    setMapRepoStatus(r.error ?? t('maps.repo.repoRateFail'), true)
    return
  }
  setMapRepoStatus(t('maps.repo.repoRateOk', { n: String(rating) }))
  void loadRepoMaps(true)
}

const deleteRepoMap = async (m: RepoMap): Promise<void> => {
  if (!window.confirm(t('maps.repo.repoDeleteConfirm', { name: m.name }))) return
  const r = await authApi('DELETE', `/api/maps/${encodeURIComponent(m.id)}`)
  if (!r.ok) {
    setMapRepoStatus(r.error ?? t('maps.repo.repoDeleteFail'), true)
    return
  }
  repoMaps = repoMaps.filter((x) => x.id !== m.id)
  renderRepoMaps()
  setMapRepoStatus(t('maps.repo.repoDeleted'))
}

const renderRepoMapComments = async (m: RepoMap, box: HTMLDivElement): Promise<void> => {
  box.innerHTML = ''
  try {
    const res = await fetch(`${ONLINE_URL}/api/maps/${encodeURIComponent(m.id)}/comments`)
    const j = (await res.json()) as { ok?: boolean; comments?: RepoComment[] }
    if (!res.ok || !j.ok) throw new Error()
    const comments = j.comments ?? []
    if (comments.length === 0) {
      const none = document.createElement('div')
      none.className = 'net-empty'
      none.textContent = t('maps.repo.repoCommentsEmpty')
      box.appendChild(none)
    }
    for (const c of comments) {
      const line = document.createElement('div')
      line.className = 'repo-comment'
      const head = document.createElement('span')
      head.className = 'mod-meta'
      head.textContent = `${c.username || '?'} · ${new Date(c.createdAt).toLocaleDateString()}`
      const body = document.createElement('span')
      body.textContent = c.body
      line.appendChild(head)
      line.appendChild(body)
      box.appendChild(line)
    }
    if (authSession) {
      const inputRow = document.createElement('div')
      inputRow.className = 'maps-toolbar'
      const textarea = document.createElement('textarea')
      textarea.maxLength = 500
      textarea.rows = 2
      textarea.placeholder = t('maps.repo.repoCommentPlaceholder')
      const send = document.createElement('button')
      send.className = 'ghost'
      send.textContent = t('maps.repo.repoCommentSend')
      send.addEventListener('click', () => {
        void (async () => {
          const text = textarea.value.trim()
          if (!text) return
          const r = await authApi('POST', `/api/maps/${encodeURIComponent(m.id)}/comments`, { body: text })
          if (!r.ok) {
            setMapRepoStatus(r.error ?? t('maps.repo.repoCommentFail'), true)
            return
          }
          textarea.value = ''
          await renderRepoMapComments(m, box)
        })()
      })
      inputRow.appendChild(textarea)
      inputRow.appendChild(send)
      box.appendChild(inputRow)
    }
  } catch {
    const fail = document.createElement('div')
    fail.className = 'hint error'
    fail.textContent = t('maps.repo.repoCommentsFail')
    box.appendChild(fail)
  }
}

const repoMapRow = (m: RepoMap): HTMLDivElement => {
  const row = document.createElement('div')
  row.className = 'backup-row mod-row'
  const title = document.createElement('span')
  title.className = 'mod-title'
  title.textContent = `${m.name} (${m.players}P)`
  title.title = t('maps.repo.repoRating', { avg: String(m.ratingAvg ?? '—'), c: String(m.ratingCount) })
  const meta = document.createElement('span')
  meta.className = 'mod-meta'
  meta.textContent = m.description || t('maps.repo.repoBy', { author: m.ownerName || m.author || '?' })
  const stats = document.createElement('span')
  stats.className = 'mod-meta repo-stars'
  stats.textContent = `${m.width}×${m.height} · ${m.ratingCount > 0 ? `${repoMapStars(m.ratingAvg)} ${m.ratingAvg}/5 · ` : `${repoMapStars(null)} ${t('maps.repo.repoNoRatings')} · `}${t('maps.repo.repoDownloads', { n: String(m.downloads) })}`
  const actions = document.createElement('span')
  actions.className = 'archive-actions'
  const commentsBtn = document.createElement('button')
  commentsBtn.className = 'ghost'
  commentsBtn.textContent = t('maps.repo.repoComments')
  let commentsBox: HTMLDivElement | null = null
  commentsBtn.addEventListener('click', () => {
    if (!commentsBox) {
      commentsBox = document.createElement('div')
      commentsBox.className = 'repo-comments'
      row.appendChild(commentsBox)
      void renderRepoMapComments(m, commentsBox)
    } else {
      commentsBox.remove()
      commentsBox = null
    }
  })
  actions.appendChild(commentsBtn)
  const install = document.createElement('button')
  install.className = 'ghost'
  install.textContent = t('maps.repo.repoInstall')
  install.addEventListener('click', () => void installRepoMap(m))
  actions.appendChild(install)
  if (authSession) {
    const rate = document.createElement('button')
    rate.className = 'ghost'
    rate.textContent = t('maps.repo.repoRate')
    rate.addEventListener('click', () => void rateRepoMap(m))
    actions.appendChild(rate)
  }
  if (authSession && authSession.userId === m.ownerId) {
    const del = document.createElement('button')
    del.className = 'ghost danger'
    del.textContent = t('maps.repo.repoDelete')
    del.addEventListener('click', () => void deleteRepoMap(m))
    actions.appendChild(del)
  }
  row.append(title, meta, stats, actions)
  return row
}

const renderRepoMaps = (): void => {
  mapsRepoListEl.innerHTML = ''
  if (repoMaps.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'net-empty'
    empty.textContent = t('maps.repo.repoEmpty')
    mapsRepoListEl.appendChild(empty)
  }
  for (const m of repoMaps) mapsRepoListEl.appendChild(repoMapRow(m))
  renderRepoMapPublishSelect()
}

const renderRepoMapPublishSelect = (): void => {
  const prev = mapsRepoPublishSelectEl.value
  mapsRepoPublishSelectEl.innerHTML = ''
  const publishable = allMapEntries()
    .filter((e) => e.kind === 'custom')
    .filter((e) => {
      const m = entryToMap(e)
      return validateMap(m).ok
    })
  // Usable while signed out so the Publish button can ask for a login (see renderRepoPublishSelect).
  const empty = publishable.length === 0
  mapsRepoPublishSelectEl.disabled = empty
  mapsRepoPublishDescEl.disabled = empty
  mapsRepoPublishBtn.disabled = empty
  for (const e of publishable) {
    const opt = document.createElement('option')
    opt.value = e.name
    opt.textContent = `${e.name} (${e.players}P)`
    mapsRepoPublishSelectEl.appendChild(opt)
  }
  if (publishable.some((e) => e.name === prev)) mapsRepoPublishSelectEl.value = prev
}

mapsRepoPublishDescEl.addEventListener('input', () => {
  mapsRepoPublishBtn.disabled = mapsRepoPublishSelectEl.value === '' || mapsRepoPublishSelectEl.disabled
})

const publishRepoMap = async (): Promise<void> => {
  if (!requireLogin('publish')) return
  const name = mapsRepoPublishSelectEl.value
  if (!name) {
    setMapRepoStatus(t('maps.repo.repoPublishNoMaps'), true)
    return
  }
  const description = mapsRepoPublishDescEl.value.trim()
  if (description === '') {
    setMapRepoStatus(t('maps.repo.repoPublishNeedDesc'), true)
    return
  }
  setMapRepoStatus(t('online.working'))
  try {
    const entry = findMapEntry(`custom:${name}`)
    if (!entry) throw new Error(String('missing map'))
    const map = entryToMap(entry)
    map.description = description.slice(0, 160)
    const r = await authApi('POST', '/api/maps', map)
    if (!r.ok) {
      setMapRepoStatus(r.error ?? t('maps.repo.repoPublishFail'), true)
      return
    }
    mapsRepoPublishDescEl.value = ''
    await loadRepoMaps(true)
    setMapRepoStatus(t('maps.repo.repoPublishOk', { name }))
  } catch {
    setMapRepoStatus(t('maps.repo.repoPublishFail'), true)
  }
}

let mapRepoSearchTimer: number | undefined
mapsRepoSearchEl.addEventListener('input', () => {
  window.clearTimeout(mapRepoSearchTimer)
  mapRepoSearchTimer = window.setTimeout(() => void loadRepoMaps(true), 350)
})
mapsRepoSortEl.addEventListener('change', () => {
  mapRepoSort = mapsRepoSortEl.value
  void loadRepoMaps(true)
})
mapsRepoPublishSelectEl.addEventListener('change', () => {
  mapsRepoPublishBtn.disabled = mapsRepoPublishSelectEl.disabled || mapsRepoPublishSelectEl.value === ''
})
mapsRepoPublishBtn.addEventListener('click', () => void publishRepoMap())

// ---------- map builder ----------

let renderMapBuilderTable: () => void = () => {}

const mapBuilderReady = import('./mapbuilder/builder.ts').then((mod) => {
  const refs = mod.initMapBuilder({
    getLobbyState: () => lobbyState,
    renderMatchOptions: (msg, isHost) => renderMatchOptions(msg, isHost),
    renderMapSelect: () => renderMapSelect(),
  })
  renderMapBuilderTable = refs.renderMapBuilderTable
  renderMapBuilderTable()
  void migrateLegacyLibrary().then(() => {
    seedLibraryFromBundledMaps()
    renderMapBuilderTable()
  })
})

// ---------- controls (settings) ----------

const { renderControlsList, controlsOverlay, controlsInfoOverlay, controlsInfoContent } = initControlsSettings(() => controlsInfoHtml())

// ---------- graphics settings ----------

let renderGraphicsList: () => void = () => {}
let renderWeatherOptions: (el: HTMLSelectElement) => void = () => {}
let startWeatherEl: HTMLSelectElement = null as unknown as HTMLSelectElement
let matchWeatherEl: HTMLSelectElement = null as unknown as HTMLSelectElement

const graphicsReady = import('./ui/graphics-settings.ts').then((mod) => {
  const refs = mod.initGraphicsSettings()
  renderGraphicsList = refs.renderGraphicsList
  renderWeatherOptions = refs.renderWeatherOptions
  startWeatherEl = refs.startWeatherEl
  matchWeatherEl = refs.matchWeatherEl
})

// ---------- audio settings ----------

let renderAudioList: () => void = () => {}

const audioReady = import('./ui/audio-settings.ts').then((mod) => {
  renderAudioList = mod.initAudioSettings().renderAudioList
})

// ---------- dev settings ----------

const DEV_STORAGE_KEY = 'space-arenas:dev-settings'
const DEV_DEFAULTS_KEY = 'space-arenas:dev-defaults'
/** Local mirror of the `settings.json` `client` block (the client-only baseline for
 *  the panel's "modified" badge) so "Save as default" survives an offline reload. */
const DEV_CLIENT_KEY = 'space-arenas:dev-client-defaults'
const devFormEl = document.getElementById('dev-settings-form') as HTMLDivElement
const devStatusEl = document.getElementById('dev-status') as HTMLDivElement
const devSaveBtn = document.getElementById('dev-save') as HTMLButtonElement
const devResetBtn = document.getElementById('dev-reset') as HTMLButtonElement
const devSaveDefaultBtn = document.getElementById('dev-save-default') as HTMLButtonElement
const devCollapseBtn = document.getElementById('dev-collapse') as HTMLButtonElement


type OverrideMapKey = 'buildingOverrides' | 'unitOverrides' | 'weaponOverrides' | 'upgradeOverrides'


const DEV_UNIT_KEYS: Record<string, string> = {
  credits: 'credits',
  sec: 'sec',
  'hp/tick': 'hpPerTick',
  hp: 'hp',
  '0–1': 'fraction',
  orders: 'orders',
  units: 'units',
  cells: 'cells',
  'cells/s': 'cellsPerSec',
  power: 'power',
  dmg: 'dmg',
  levels: 'levels',
  rounds: 'rounds',
  x: 'x',
  nodes: 'nodes',
  score: 'score',
  kills: 'kills',
  '%': 'percent',
  'dmg/tick': 'dmgPerTick',
  ticks: 'ticks',
}

const devUnit = (u: string): string => t(`dev.units.${DEV_UNIT_KEYS[u] ?? u}`)


const PROFILE_TARGET_FIELDS: Array<{ key: string; target: number; min: number; max: number; step: number }> = [
  { key: 'achievementKillsInfantry', target: 20, min: 1, max: 100000, step: 1 },
  { key: 'achievementKillsVehicle', target: 10, min: 1, max: 100000, step: 1 },
  { key: 'achievementKillsAir', target: 5, min: 1, max: 100000, step: 1 },
  { key: 'achievementKillsBuilding', target: 5, min: 1, max: 100000, step: 1 },
  { key: 'achievementSupplies', target: 1000, min: 1, max: 10000000, step: 100 },
  { key: 'achievementVeteranPromotions', target: 10, min: 1, max: 10000, step: 1 },
  { key: 'achievementTroopsTransported', target: 25, min: 1, max: 100000, step: 5 },
  { key: 'achievementMatches', target: 5, min: 1, max: 100000, step: 1 },
  { key: 'achievementWins', target: 10, min: 1, max: 100000, step: 1 },
]


let devOverrides: Partial<MatchSettings> = {}
let savedDefaults: Partial<MatchSettings> = {}
let devPushedToRoom = false

const setDevStatus = (text: string, isError = false): void => {
  devStatusEl.textContent = text
  devStatusEl.classList.toggle('error', isError)
}

const saveDevOverrides = (): void => {
  try {
    localStorage.setItem(DEV_STORAGE_KEY, JSON.stringify(devOverrides))
  } catch {
    /* storage unavailable */
  }
}

/** Layers `patch` (this session's `devOverrides`) over `base` (`savedDefaults`),
 *  deep-merging the four entity override maps per-id/per-field. A plain spread
 *  would drop every saved entry as soon as the session touched the same map. */
const layerDevSettings = (base: Partial<MatchSettings>, patch: Partial<MatchSettings>): Partial<MatchSettings> => {
  const out: Partial<MatchSettings> = { ...base, ...patch }
  for (const key of ['buildingOverrides', 'unitOverrides', 'weaponOverrides', 'upgradeOverrides'] as const) {
    const b = base[key] as Record<string, Record<string, number>> | undefined
    const p = patch[key] as Record<string, Record<string, number>> | undefined
    if (b === undefined && p === undefined) continue
    const merged: Record<string, Record<string, number>> = {}
    for (const [id, fields] of Object.entries(b ?? {})) merged[id] = { ...fields }
    for (const [id, fields] of Object.entries(p ?? {})) merged[id] = { ...(merged[id] ?? {}), ...fields }
    ;(out as Record<string, unknown>)[key] = merged
  }
  return out
}

const resolvedDevSettings = (): MatchSettings => mergeMatchSettings(layerDevSettings(savedDefaults, devOverrides))

const stableStringify = (v: unknown): string => {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null'
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`
  const entries = Object.entries(v as Record<string, unknown>)
    .filter(([, val]) => val !== undefined)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  return `{${entries.map(([k, val]) => `${JSON.stringify(k)}:${stableStringify(val)}`).join(',')}}`
}

const settingsFingerprint = (s: Partial<MatchSettings>): string =>
  crc32(new TextEncoder().encode(stableStringify(s)))
    .toString(16)
    .padStart(8, '0')

/** Panel "Same / Different" fingerprint: synced match values *plus* the client-only
 *  values, so two players who agree on match settings but differ on graphics/audio
 *  are still flagged as different. `client` is normalised to `{}` when absent so
 *  the comparison is stable. */
const syncFingerprint = (settings: Partial<MatchSettings>, client?: ClientDevSettings): string =>
  settingsFingerprint({ ...settings, client: client ?? {} } as Partial<MatchSettings>)

/** The effective *defaults* fingerprint (the `builtin`+`user` base, without this
 *  session's `devOverrides`). Broadcast with our dev settings so the host can tell
 *  whether our base matches theirs before starting a match. Uses the shared
 *  canonical-JSON fingerprint so it is byte-identical to the host's. */
const settingsDefaultsHash = (): string => fingerprintSettings(mergeMatchSettings(savedDefaults))

/** Cached `/api/settings` payload (the `builtin`/`user`/`client` file layers). */
let settingsFile: MatchSettingsFile = {}

/** Persists the raw settings file via the host (`/api/settings`); false when
 *  offline / static hosting (where localStorage is the only home). */
const saveSettingsFile = async (file: MatchSettingsFile): Promise<boolean> => {
  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(file),
    })
    return res.ok
  } catch {
    return false
  }
}

/** Loads `profile/settings.json` at boot and layers it under the local defaults.
 *  Existing device data (localStorage) always wins; with no host we simply keep
 *  the compiled defaults + localStorage (offline fallback). */
const loadSettingsFile = async (): Promise<void> => {
  let file: MatchSettingsFile | null = null
  try {
    const res = await fetch('/api/settings')
    if (res.ok) {
      const json = (await res.json()) as { ok?: boolean; settings?: MatchSettingsFile | null }
      if (json && json.ok && json.settings) file = json.settings
    }
  } catch {
    /* offline / static hosting: localStorage is the fallback */
  }
  const localClient = settingsFile.client
  settingsFile = file ?? {}
  // Keep the locally-mirrored client block when the host file has none (offline /
  // fresh profile), so the dev panel's client-only baseline is not lost.
  if (settingsFile.client === undefined && localClient !== undefined) settingsFile.client = localClient
  savedDefaults = { ...resolveSettingsFileLayers(settingsFile), ...savedDefaults }
  applyClientDevSettings(settingsFile.client, false)
  buildDevForm()
}

/** The effective synced defaults: the saved `user` layer over the compiled ones.
 *  The dev panel treats these as "default" — what a row's reset button restores and
 *  what the "modified" badge compares against. "Save as default" replaces them. */
const effectiveDefaultSettings = (): MatchSettings => mergeMatchSettings(savedDefaults)

/** The saved client-only baseline (`settings.json`'s `client` block). Empty when the
 *  file has none, so every client-only override shows as modified until it is saved. */
const baseGraphics = (): Partial<GraphicsSettings> =>
  (settingsFile.client?.graphics ?? {}) as unknown as Partial<GraphicsSettings>
const baseAudioOverrides = (): Record<string, string> =>
  (settingsFile.client?.audio as { overrides?: Record<string, string> } | undefined)?.overrides ?? {}
const baseProfileTargets = (): Record<string, number> =>
  (settingsFile.client?.profile as { achievementTargets?: Record<string, number> } | undefined)?.achievementTargets ?? {}

/** The current client-only ("non-synced") dev values, shaped for `settings.json`'s
 *  `client` block. They never reach the host's match settings; they ride in the
 *  file so a fresh origin can restore them (and Stage E's mod snapshot carries them). */
const clientDevSettings = (): ClientDevSettings => ({
  graphics: getGraphics() as unknown as Record<string, unknown>,
  audio: getAudio() as unknown as Record<string, unknown>,
  profile: loadProfileConfig(window.localStorage) as unknown as Record<string, unknown>,
})

/** Applies `settings.json`'s `client` block to the graphics/audio/profile stores.
 *  Without `force` an existing localStorage key always wins (boot layering); with
 *  `force` the file wins (clone / adopt-host flows). */
const applyClientDevSettings = (client: ClientDevSettings | undefined, force: boolean): void => {
  if (!client) return
  const entries: Array<[string, unknown, () => void]> = [
    ['space-arenas:graphics', client.graphics, reloadGraphics],
    ['space-arenas:audio', client.audio, reloadAudio],
    ['space-arenas:profile:config', client.profile, renderProfilePanel],
  ]
  for (const [key, value, reload] of entries) {
    if (value === undefined) continue
    if (!force) {
      try {
        if (localStorage.getItem(key) !== null) continue
      } catch {
        /* storage unavailable: fall through and try to write anyway */
      }
    }
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      continue
    }
    reload()
  }
}

/** The subset of `clientDevSettings()` safe to send to another machine: foreign
 *  absolute asset/audio URLs are stripped (relative + same-origin kept). */
const wireClientDevSettings = (): ClientDevSettings =>
  sanitizeClientDevSettings(clientDevSettings(), window.location.origin) as ClientDevSettings

/** Applies a balance mod's client-only snapshot (sanitized against our origin),
 *  so "export full snapshot" mods reproduce graphics/audio/profile elsewhere. */
const applyModClientBlock = (mod: ModFile | undefined): void => {
  if (!mod?.client) return
  applyClientDevSettings(sanitizeClientDevSettings(mod.client, window.location.origin), true)
}

const pushDevSettingsToHost = (): void => {
  if (!net?.connected || !lobbyState) return
  net.publishDevSettings(resolvedDevSettings(), settingsDefaultsHash(), wireClientDevSettings())
  if (lobbyState.yourId !== lobbyState.hostId) return
  devPushedToRoom = true
  net.updateRoom({ settings: resolvedDevSettings() })
  setDevStatus(t('dev.status.sent'))
}

const clampNum = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v))

const setDevOverride = (mapKey: OverrideMapKey, id: string, field: string, value: number): void => {
  const maps = devOverrides as Record<string, Record<string, Record<string, number>> | undefined>
  const map = maps[mapKey] ?? {}
  devOverrides = { ...devOverrides, [mapKey]: { ...map, [id]: { ...(map[id] ?? {}), [field]: value } } }
}

const clearDevOverride = (mapKey: OverrideMapKey, id: string, field: string): void => {
  const maps = devOverrides as Record<string, Record<string, Record<string, number>> | undefined>
  const map = maps[mapKey]
  const entry = map?.[id]
  if (!entry) return
  const nextEntry = { ...entry }
  delete nextEntry[field]
  const nextMap = { ...(map ?? {}) }
  if (Object.keys(nextEntry).length > 0) nextMap[id] = nextEntry
  else delete nextMap[id]
  devOverrides = { ...devOverrides, [mapKey]: nextMap }
}

const clearDevScalar = (key: keyof MatchSettings): void => {
  const next = { ...devOverrides }
  delete next[key]
  devOverrides = next
}

const OVERRIDE_SOURCES: Record<OverrideMapKey, Record<string, Record<string, number>>> = {
  buildingOverrides: BUILDINGS as unknown as Record<string, Record<string, number>>,
  unitOverrides: UNITS as unknown as Record<string, Record<string, number>>,
  weaponOverrides: WEAPONS as unknown as Record<string, Record<string, number>>,
  upgradeOverrides: UPGRADES as unknown as Record<string, Record<string, number>>,
}

// ---------- dev settings form (registry-driven table UI) ----------

type DevGroup = 'synced' | 'client'

interface DevRowHandle {
  row: HTMLTableRowElement
  group: DevGroup
  search: string
  isOverridden: () => boolean
}

let devRows: DevRowHandle[] = []
let devFilterGroup: DevGroup | 'all' = 'all'
let devFilterText = ''
let devFilterModified = false

const devSearchEl = document.getElementById('dev-search') as HTMLInputElement | null
const devModifiedEl = document.getElementById('dev-modified') as HTMLInputElement | null
const devTabEls = Array.from(document.querySelectorAll<HTMLButtonElement>('.dev-tab'))

const registerDevRow = (row: HTMLTableRowElement, group: DevGroup, search: string, isOverridden: () => boolean): void => {
  devRows.push({ row, group, search: search.toLowerCase(), isOverridden })
}

const syncRowMark = (row: HTMLTableRowElement, overridden: boolean): void => {
  row.classList.toggle('dev-overridden', overridden)
}

/** Hide rows that fail the active group/text/modified filters, then hide any
 *  section that has no visible rows left. */
const applyDevFilters = (): void => {
  for (const entry of devRows) {
    const groupOk = devFilterGroup === 'all' || entry.group === devFilterGroup
    const textOk = devFilterText === '' || entry.search.includes(devFilterText)
    const modifiedOk = !devFilterModified || entry.isOverridden()
    entry.row.classList.toggle('dev-row-hidden', !(groupOk && textOk && modifiedOk))
  }
  for (const section of Array.from(devFormEl.querySelectorAll<HTMLDetailsElement>('details.dev-group'))) {
    const rows = section.querySelectorAll<HTMLTableRowElement>('tr.dev-row')
    if (rows.length === 0) continue
    section.hidden = !Array.from(rows).some((r) => !r.classList.contains('dev-row-hidden'))
  }
}

const setDevFilterGroup = (group: DevGroup | 'all'): void => {
  devFilterGroup = group
  for (const b of devTabEls) b.classList.toggle('active', b.dataset.devGroup === group)
  applyDevFilters()
}

devSearchEl?.addEventListener('input', () => {
  devFilterText = devSearchEl.value.trim().toLowerCase()
  applyDevFilters()
})

devModifiedEl?.addEventListener('change', () => {
  devFilterModified = devModifiedEl.checked
  applyDevFilters()
})

for (const b of devTabEls) {
  b.addEventListener('click', () => setDevFilterGroup((b.dataset.devGroup ?? 'all') as DevGroup | 'all'))
}

const appendDevSection = (title: string, group: DevGroup): HTMLDivElement => {
  const details = document.createElement('details')
  details.className = 'dev-group'
  details.dataset.group = group
  details.open = true
  const summary = document.createElement('summary')
  summary.textContent = title
  const body = document.createElement('div')
  body.className = 'dev-group-body'
  details.appendChild(summary)
  details.appendChild(body)
  devFormEl.appendChild(details)
  return body
}

const appendDevItemHeader = (parent: HTMLElement, title: string): HTMLDivElement => {
  const details = document.createElement('details')
  details.className = 'dev-group dev-object'
  details.open = true
  const summary = document.createElement('summary')
  summary.textContent = title
  const body = document.createElement('div')
  body.className = 'dev-group-body'
  details.appendChild(summary)
  details.appendChild(body)
  parent.appendChild(details)
  return body
}

const makeTable = (parent: HTMLElement): HTMLTableSectionElement => {
  const table = document.createElement('table')
  table.className = 'dev-table'
  const thead = document.createElement('thead')
  const headRow = document.createElement('tr')
  const cols: Array<[string, string]> = [
    ['dev.colSetting', 'dev-name'],
    ['dev.colValue', 'dev-value'],
    ['dev.colUnit', 'dev-unit'],
    ['dev.colDefault', 'dev-default'],
    ['dev.colActions', 'dev-reset'],
  ]
  for (const [key, cls] of cols) {
    const th = document.createElement('th')
    th.className = cls
    th.textContent = t(key)
    headRow.appendChild(th)
  }
  thead.appendChild(headRow)
  const tbody = document.createElement('tbody')
  table.appendChild(thead)
  table.appendChild(tbody)
  parent.appendChild(table)
  return tbody
}

const appendSubhead = (tbody: HTMLTableSectionElement, text: string): void => {
  const tr = document.createElement('tr')
  tr.className = 'dev-subhead'
  const td = document.createElement('td')
  td.colSpan = 5
  td.textContent = text
  tr.appendChild(td)
  tbody.appendChild(tr)
}

interface DevRowOpts {
  label: string
  desc: string
  unit?: string
  group: DevGroup
  defaultText: string
  isOverridden: () => boolean
  buildValue: (cell: HTMLTableCellElement) => void
  onReset?: () => void
}

const appendDevRow = (tbody: HTMLTableSectionElement, o: DevRowOpts): HTMLTableRowElement => {
  const tr = document.createElement('tr')
  tr.className = 'dev-row'
  const nameCell = document.createElement('td')
  nameCell.className = 'dev-name'
  const lab = document.createElement('label')
  lab.textContent = o.label
  const desc = document.createElement('div')
  desc.className = 'dev-desc'
  desc.textContent = o.desc
  nameCell.appendChild(lab)
  nameCell.appendChild(desc)
  const valueCell = document.createElement('td')
  valueCell.className = 'dev-value'
  o.buildValue(valueCell)
  const unitCell = document.createElement('td')
  unitCell.className = 'dev-unit'
  unitCell.textContent = o.unit ?? ''
  const defCell = document.createElement('td')
  defCell.className = 'dev-default'
  defCell.textContent = o.defaultText
  const resetCell = document.createElement('td')
  resetCell.className = 'dev-reset'
  if (o.onReset) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'dev-reset-btn'
    btn.textContent = '\u21ba'
    btn.title = t('dev.resetField')
    btn.addEventListener('click', () => o.onReset?.())
    resetCell.appendChild(btn)
  }
  tr.appendChild(nameCell)
  tr.appendChild(valueCell)
  tr.appendChild(unitCell)
  tr.appendChild(defCell)
  tr.appendChild(resetCell)
  tbody.appendChild(tr)
  syncRowMark(tr, o.isOverridden())
  registerDevRow(tr, o.group, `${o.label} ${o.desc}`, o.isOverridden)
  return tr
}

const makeNumberRow = (
  tbody: HTMLTableSectionElement,
  o: {
    label: string
    desc: string
    unit?: string
    group?: DevGroup
    value: number
    default: number
    min: number
    max: number
    step: number
    onCommit: (v: number) => void
    onReset?: () => void
  },
): void => {
  const input = document.createElement('input')
  input.type = 'number'
  input.min = String(o.min)
  input.max = String(o.max)
  input.step = String(o.step)
  input.value = String(o.value)
  input.title = t('dev.units.default', { v: `${o.default}${o.unit ? ` ${o.unit}` : ''}` })
  const isOverridden = (): boolean => {
    const v = Number(input.value)
    return Number.isFinite(v) && Math.abs(v - o.default) >= 1e-9
  }
  const row = appendDevRow(tbody, {
    label: o.label,
    desc: o.desc,
    unit: o.unit,
    group: o.group ?? 'synced',
    defaultText: `${o.default}${o.unit ? ` ${o.unit}` : ''}`,
    isOverridden,
    buildValue: (cell) => cell.appendChild(input),
    onReset: o.onReset,
  })
  input.addEventListener('change', () => {
    const raw = Number(input.value)
    if (!Number.isFinite(raw)) return
    const v = clampNum(raw, o.min, o.max)
    input.value = String(v)
    syncRowMark(row, isOverridden())
    o.onCommit(v)
    renderActiveInfoTab()
    applyDevFilters()
  })
}

const makeTextRow = (
  tbody: HTMLTableSectionElement,
  o: { label: string; desc: string; value: string; placeholder?: string; defaultValue?: string; onCommit: (v: string) => void },
): void => {
  const input = document.createElement('input')
  input.type = 'text'
  input.value = o.value
  input.placeholder = o.placeholder ?? 'folder/{color}/folder_{frame}.png'
  const base = (o.defaultValue ?? '').trim()
  const isOverridden = (): boolean => input.value.trim() !== base
  const row = appendDevRow(tbody, {
    label: o.label,
    desc: o.desc,
    group: 'client',
    defaultText: o.defaultValue ?? '',
    isOverridden,
    buildValue: (cell) => cell.appendChild(input),
  })
  input.addEventListener('change', () => {
    o.onCommit(input.value.trim())
    syncRowMark(row, isOverridden())
    applyDevFilters()
  })
}

const makeSelectRow = (
  tbody: HTMLTableSectionElement,
  o: {
    label: string
    desc: string
    value: string
    options: Array<{ value: string; label: string }>
    default: string
    onCommit: (v: string) => void
    onReset?: () => void
  },
): void => {
  const select = document.createElement('select')
  for (const opt of o.options) {
    const el = document.createElement('option')
    el.value = opt.value
    el.textContent = opt.label
    select.appendChild(el)
  }
  select.value = o.value
  const isOverridden = (): boolean => select.value !== o.default
  const row = appendDevRow(tbody, {
    label: o.label,
    desc: o.desc,
    group: 'synced',
    defaultText: o.options.find((x) => x.value === o.default)?.label ?? o.default,
    isOverridden,
    buildValue: (cell) => cell.appendChild(select),
    onReset: o.onReset,
  })
  select.addEventListener('change', () => {
    syncRowMark(row, isOverridden())
    o.onCommit(select.value)
    renderActiveInfoTab()
    applyDevFilters()
  })
}

/** Audio row: path override with quick apply/clear, plus per-sound volume & pitch. */
const makeAudioRow = (tbody: HTMLTableSectionElement, id: SoundId): void => {
  const tun = getAudio().tuning[id] ?? { vol: 1, pitch: 1 }
  const pathLine = document.createElement('div')
  pathLine.className = 'dev-audio-line'
  const input = document.createElement('input')
  input.type = 'text'
  input.value = getAudio().overrides[id] ?? ''
  input.placeholder = 'sound/{id}/'
  const isOverridden = (): boolean => (getAudio().overrides[id] ?? '') !== (baseAudioOverrides()[id] ?? '')
  let audioRowEl: HTMLTableRowElement | null = null
  const commitPath = (): void => {
    setOverride(id, input.value.trim())
    if (audioRowEl) syncRowMark(audioRowEl, isOverridden())
    setDevStatus(t('dev.status.audioSaved'))
    renderActiveInfoTab()
    applyDevFilters()
  }
  const playBtn = document.createElement('button')
  playBtn.type = 'button'
  playBtn.className = 'dev-audio-btn'
  playBtn.textContent = t('dev.fields.audioPlay.label')
  playBtn.title = t('dev.fields.audioPlay.desc')
  playBtn.addEventListener('click', () => {
    lobbyAudio.unlock()
    const spec = AMBIENT_SYNTH[id]
    if (spec) {
      lobbyAudio.startAmbient(id, spec)
      window.setTimeout(() => {
        lobbyAudio.stopAmbient()
        if (lobbyAmbientUnlocked) lobbyAudio.startLobbyAmbient()
      }, 4000)
    } else {
      lobbyAudio.playSfx(id, { gain: 1 })
      void lobbyAudio.diagnose(id).then((msg) => {
        setDevStatus(msg)
        console.warn('[audio diagnose] ' + msg)
      })
    }
  })
  const applyBtn = document.createElement('button')
  applyBtn.type = 'button'
  applyBtn.className = 'dev-audio-btn'
  applyBtn.textContent = t('dev.fields.audioPathApply.label')
  applyBtn.title = t('dev.fields.audioPathApply.desc', { id })
  applyBtn.addEventListener('click', () => {
    input.value = `sound/${id}/`
    commitPath()
  })
  const clearBtn = document.createElement('button')
  clearBtn.type = 'button'
  clearBtn.className = 'dev-audio-btn'
  clearBtn.textContent = t('dev.fields.audioPathClear.label')
  clearBtn.title = t('dev.fields.audioPathClear.desc')
  clearBtn.addEventListener('click', () => {
    input.value = ''
    commitPath()
  })
  input.addEventListener('change', commitPath)
  pathLine.appendChild(playBtn)
  pathLine.appendChild(input)
  pathLine.appendChild(applyBtn)
  pathLine.appendChild(clearBtn)

  const tuneLine = document.createElement('div')
  tuneLine.className = 'dev-audio-line'
  const mkTune = (field: 'vol' | 'pitch'): HTMLInputElement => {
    const lab = document.createElement('label')
    lab.className = 'dev-audio-tune-label'
    lab.textContent = t(`dev.fields.audioTune.${field}.label`)
    lab.title = t(`dev.fields.audioTune.${field}.desc`)
    const num = document.createElement('input')
    num.type = 'number'
    num.className = 'dev-audio-tune'
    num.min = field === 'vol' ? '0' : String(TUNING_PITCH_MIN)
    num.max = String(field === 'vol' ? TUNING_VOL_MAX : TUNING_PITCH_MAX)
    num.step = '0.05'
    num.value = String(tun[field])
    lab.appendChild(num)
    tuneLine.appendChild(lab)
    return num
  }
  const volInput = mkTune('vol')
  const pitchInput = mkTune('pitch')
  const commitTune = (): void => {
    const v = Number(volInput.value)
    const p = Number(pitchInput.value)
    if (!Number.isFinite(v) || !Number.isFinite(p)) return
    const vol = clampNum(v, 0, TUNING_VOL_MAX)
    const pitch = clampNum(p, TUNING_PITCH_MIN, TUNING_PITCH_MAX)
    volInput.value = String(vol)
    pitchInput.value = String(pitch)
    setTuning(id, vol, pitch)
    setDevStatus(t('dev.status.audioTuned'))
    renderActiveInfoTab()
  }
  volInput.addEventListener('change', commitTune)
  pitchInput.addEventListener('change', commitTune)

  audioRowEl = appendDevRow(tbody, {
    label: t(`dev.audio.${id}`),
    desc: t('dev.fields.audioPath.desc'),
    group: 'client',
    defaultText: '',
    isOverridden,
    buildValue: (cell) => {
      cell.appendChild(pathLine)
      cell.appendChild(tuneLine)
    },
  })
}

const buildOverrideInputs = (tbody: HTMLTableSectionElement, mapKey: OverrideMapKey, id: string, defs: DevOverrideFieldDef[]): void => {
  const defaults = OVERRIDE_SOURCES[mapKey][id] ?? {}
  const savedMaps = savedDefaults as Record<string, Record<string, Record<string, number>> | undefined>
  const devMaps = devOverrides as Record<string, Record<string, Record<string, number>> | undefined>
  for (const f of defs) {
    if (f.only && !f.only.includes(id)) continue
    const baseRaw = savedMaps[mapKey]?.[id]?.[f.field] ?? defaults[f.field] ?? 0
    const overrideRaw = devMaps[mapKey]?.[id]?.[f.field]
    const current = overrideRaw ?? baseRaw
    const inSeconds = f.seconds === true
    const displayDefault = inSeconds ? baseRaw / SIM_TICK_HZ : baseRaw
    makeNumberRow(tbody, {
      label: t(`dev.overrides.${f.field}.label`),
      desc: t(`dev.overrides.${f.field}.desc`),
      unit: f.unit ? devUnit(f.unit) : undefined,
      group: 'synced',
      value: inSeconds ? current / SIM_TICK_HZ : current,
      default: displayDefault,
      min: f.min,
      max: f.max,
      step: f.step,
      onCommit: (v) => {
        if (Math.abs(v - displayDefault) < 1e-9) {
          clearDevOverride(mapKey, id, f.field)
          setDevStatus(t('dev.status.overrideDefault', { id, field: f.field, v: inSeconds ? `${displayDefault}s` : displayDefault }))
        } else {
          const raw = inSeconds ? SECONDS_TO_TICKS(v) : v
          setDevOverride(mapKey, id, f.field, raw)
          setDevStatus(t('dev.status.overrideSet', { id, field: f.field, v: inSeconds ? `${v}s (${raw} ticks)` : v }))
        }
      },
      onReset: () => {
        clearDevOverride(mapKey, id, f.field)
        refreshDevForm()
      },
    })
  }
}

const buildDevForm = (): void => {
  devRows = []
  devFormEl.innerHTML = ''
  const resolved = resolvedDevSettings()
  const defaults = effectiveDefaultSettings()
  const g = getGraphics()

  // ---- Synced: match variables ----
  for (const section of DEV_SCALAR_SECTIONS) {
    const tbody = makeTable(appendDevSection(t(`dev.sections.${section.title}`), 'synced'))
    for (const def of section.fields) {
      const currentRaw = resolved[def.key] as number
      const defaultRaw = defaults[def.key] as number
      const inSeconds = def.seconds === true
      const displayCurrent = inSeconds ? currentRaw / SIM_TICK_HZ : currentRaw
      const displayDefault = inSeconds ? defaultRaw / SIM_TICK_HZ : defaultRaw
      const fieldLabel = t(`dev.fields.${def.key}.label`)
      makeNumberRow(tbody, {
        label: fieldLabel,
        desc: t(`dev.fields.${def.key}.desc`),
        unit: def.unit ? devUnit(def.unit) : undefined,
        group: 'synced',
        value: displayCurrent,
        default: displayDefault,
        min: def.min,
        max: def.max,
        step: def.step,
        onCommit: (v) => {
          const isDefault = Math.abs(v - displayDefault) < 1e-9
          if (isDefault) clearDevScalar(def.key)
          else devOverrides = { ...devOverrides, [def.key]: inSeconds ? SECONDS_TO_TICKS(v) : v }
          setDevStatus(
            isDefault
              ? t('dev.status.scalarDefault', { label: fieldLabel, v: displayDefault })
              : t('dev.status.scalarSet', { label: fieldLabel, v: inSeconds ? `${v}s (${SECONDS_TO_TICKS(v)} ticks)` : v }),
          )
        },
        onReset: () => {
          clearDevScalar(def.key)
          refreshDevForm()
        },
      })
    }
    if (section.title === 'fog') {
      makeSelectRow(tbody, {
        label: t('dev.fields.fogMode.label'),
        desc: t('dev.fields.fogMode.desc'),
        value: resolved.fogMode,
        options: FOG_MODES.map((m) => ({ value: m, label: t(`offline.fog.${m}`) })),
        default: defaults.fogMode,
        onCommit: (v) => {
          if (v === defaults.fogMode) clearDevScalar('fogMode')
          else devOverrides = { ...devOverrides, fogMode: v as FogMode }
          setDevStatus(
            v === defaults.fogMode
              ? t('dev.status.scalarDefault', { label: t('dev.fields.fogMode.label'), v: t(`offline.fog.${defaults.fogMode}`) })
              : t('dev.status.scalarSet', { label: t('dev.fields.fogMode.label'), v: t(`offline.fog.${v}`) }),
          )
        },
        onReset: () => {
          clearDevScalar('fogMode')
          refreshDevForm()
        },
      })
    }
  }

  {
    const body = appendDevSection(t('dev.sections.buildings'), 'synced')
    for (const id of Object.keys(BUILDINGS)) {
      buildOverrideInputs(makeTable(appendDevItemHeader(body, tn(id, BUILDINGS[id].name))), 'buildingOverrides', id, DEV_OVERRIDE_BUILDING_FIELDS)
    }
  }
  {
    const body = appendDevSection(t('dev.sections.units'), 'synced')
    for (const id of Object.keys(UNITS)) {
      buildOverrideInputs(makeTable(appendDevItemHeader(body, tn(id, UNITS[id].name))), 'unitOverrides', id, DEV_OVERRIDE_UNIT_FIELDS)
    }
  }
  {
    const body = appendDevSection(t('dev.sections.weapons'), 'synced')
    for (const id of Object.keys(WEAPONS)) {
      buildOverrideInputs(makeTable(appendDevItemHeader(body, WEAPONS[id].id)), 'weaponOverrides', id, DEV_OVERRIDE_WEAPON_FIELDS)
    }
  }
  {
    const body = appendDevSection(t('dev.sections.upgrades'), 'synced')
    for (const id of Object.keys(UPGRADES)) {
      buildOverrideInputs(makeTable(appendDevItemHeader(body, tn(id, UPGRADES[id].name))), 'upgradeOverrides', id, DEV_OVERRIDE_UPGRADE_FIELDS)
    }
  }

  // ---- Client-only: presentation ----
  {
    const tbody = makeTable(appendDevSection(t('dev.sections.buildingFill'), 'client'))
    makeNumberRow(tbody, {
      label: t('dev.fields.buildingFillMedium.label'),
      desc: t('dev.fields.buildingFillMedium.desc'),
      unit: devUnit('0–1'),
      group: 'client',
      value: g.buildingFill.medium,
      default: baseGraphics().buildingFill?.medium ?? DEFAULT_BUILDING_FILL.medium,
      min: 0,
      max: 1,
      step: 0.05,
      onCommit: (v) => {
        setBuildingFill('medium', v)
        setDevStatus(t('dev.status.fillSet', { quality: t('settings.graphics.quality.medium'), v }))
      },
      onReset: () => {
        setBuildingFill('medium', baseGraphics().buildingFill?.medium ?? DEFAULT_BUILDING_FILL.medium)
        refreshDevForm()
      },
    })
    makeNumberRow(tbody, {
      label: t('dev.fields.buildingFillHigh.label'),
      desc: t('dev.fields.buildingFillHigh.desc'),
      unit: devUnit('0–1'),
      group: 'client',
      value: g.buildingFill.high,
      default: baseGraphics().buildingFill?.high ?? DEFAULT_BUILDING_FILL.high,
      min: 0,
      max: 1,
      step: 0.05,
      onCommit: (v) => {
        setBuildingFill('high', v)
        setDevStatus(t('dev.status.fillSet', { quality: t('settings.graphics.quality.high'), v }))
      },
      onReset: () => {
        setBuildingFill('high', baseGraphics().buildingFill?.high ?? DEFAULT_BUILDING_FILL.high)
        refreshDevForm()
      },
    })
    makeNumberRow(tbody, {
      label: t('dev.fields.buildingOffsetMedium.label'),
      desc: t('dev.fields.buildingOffsetMedium.desc'),
      unit: devUnit('0–1'),
      group: 'client',
      value: g.buildingOffset.medium,
      default: baseGraphics().buildingOffset?.medium ?? DEFAULT_BUILDING_OFFSET.medium,
      min: -2,
      max: 2,
      step: 0.05,
      onCommit: (v) => {
        setBuildingOffset('medium', v)
        setDevStatus(t('dev.status.offsetSet', { quality: t('settings.graphics.quality.medium'), v }))
      },
      onReset: () => {
        setBuildingOffset('medium', baseGraphics().buildingOffset?.medium ?? DEFAULT_BUILDING_OFFSET.medium)
        refreshDevForm()
      },
    })
    makeNumberRow(tbody, {
      label: t('dev.fields.buildingOffsetHigh.label'),
      desc: t('dev.fields.buildingOffsetHigh.desc'),
      unit: devUnit('0–1'),
      group: 'client',
      value: g.buildingOffset.high,
      default: baseGraphics().buildingOffset?.high ?? DEFAULT_BUILDING_OFFSET.high,
      min: -2,
      max: 2,
      step: 0.05,
      onCommit: (v) => {
        setBuildingOffset('high', v)
        setDevStatus(t('dev.status.offsetSet', { quality: t('settings.graphics.quality.high'), v }))
      },
      onReset: () => {
        setBuildingOffset('high', baseGraphics().buildingOffset?.high ?? DEFAULT_BUILDING_OFFSET.high)
        refreshDevForm()
      },
    })
  }

  {
    const tbody = makeTable(appendDevSection(t('dev.sections.assets'), 'client'))
    appendSubhead(tbody, t('dev.assets.buildings'))
    for (const id of Object.keys(BUILDINGS)) {
      makeTextRow(tbody, {
        label: tn(id, BUILDINGS[id].name),
        desc: t('dev.fields.assetBuilding.desc'),
        value: g.assetPaths[`building:${id}`] ?? '',
        defaultValue: baseGraphics().assetPaths?.[`building:${id}`] ?? DEFAULT_ASSET_PATHS[`building:${id}`] ?? '',
        onCommit: (v) => {
          setAssetPath(`building:${id}`, v)
          setDevStatus(t('dev.status.assetSaved'))
        },
      })
    }
    appendSubhead(tbody, t('dev.assets.units'))
    for (const id of UNIT_ASSET_IDS) {
      makeTextRow(tbody, {
        label: tn(id, UNITS[id]?.name ?? id),
        desc: t('dev.fields.assetUnit.desc'),
        value: g.assetPaths[`unit:${id}`] ?? '',
        defaultValue: baseGraphics().assetPaths?.[`unit:${id}`] ?? DEFAULT_ASSET_PATHS[`unit:${id}`] ?? '',
        onCommit: (v) => {
          setAssetPath(`unit:${id}`, v)
          setDevStatus(t('dev.status.assetSaved'))
        },
      })
    }
    appendSubhead(tbody, t('dev.assets.hud'))
    for (const id of HUD_ASSET_IDS) {
      makeTextRow(tbody, {
        label: tn(id, UNITS[id]?.name ?? BUILDINGS[id]?.name ?? id),
        desc: t('dev.fields.assetHud.desc'),
        value: g.assetPaths[`hud:${id}`] ?? '',
        defaultValue: baseGraphics().assetPaths?.[`hud:${id}`] ?? DEFAULT_ASSET_PATHS[`hud:${id}`] ?? '',
        placeholder: 'hud/hud_cc.png',
        onCommit: (v) => {
          setAssetPath(`hud:${id}`, v)
          setDevStatus(t('dev.status.assetSaved'))
        },
      })
    }
    appendSubhead(tbody, t('dev.fields.unitScale.desc'))
    for (const cls of ['vehicle', 'infantry', 'air', 'naval'] as const) {
      makeNumberRow(tbody, {
        label: t(`dev.fields.unitScale.${cls}.label`),
        desc: t('dev.fields.unitScale.desc'),
        unit: devUnit('x'),
        group: 'client',
        value: g.unitScale[cls],
        default: baseGraphics().unitScale?.[cls] ?? DEFAULT_UNIT_SCALE[cls],
        min: 0.1,
        max: 5,
        step: 0.05,
        onCommit: (v) => {
          setUnitScale(cls, v)
          setDevStatus(t('dev.status.saved'))
        },
        onReset: () => {
          setUnitScale(cls, baseGraphics().unitScale?.[cls] ?? DEFAULT_UNIT_SCALE[cls])
          refreshDevForm()
        },
      })
    }
    for (const cls of ['vehicle', 'infantry', 'air', 'naval'] as const) {
      makeNumberRow(tbody, {
        label: t(`dev.fields.unitOffset.${cls}.label`),
        desc: t('dev.fields.unitOffset.desc'),
        unit: devUnit('0–1'),
        group: 'client',
        value: g.unitOffset[cls],
        default: baseGraphics().unitOffset?.[cls] ?? DEFAULT_UNIT_OFFSET[cls],
        min: -2,
        max: 2,
        step: 0.05,
        onCommit: (v) => {
          setUnitOffset(cls, v)
          setDevStatus(t('dev.status.saved'))
        },
        onReset: () => {
          setUnitOffset(cls, baseGraphics().unitOffset?.[cls] ?? DEFAULT_UNIT_OFFSET[cls])
          refreshDevForm()
        },
      })
    }
    appendSubhead(tbody, t('dev.assets.fields'))
    makeTextRow(tbody, {
      label: t('dev.assets.supplyField'),
      desc: t('dev.fields.fieldSupply.desc'),
      value: g.assetPaths['field:supply'] ?? '',
      defaultValue: baseGraphics().assetPaths?.['field:supply'] ?? DEFAULT_ASSET_PATHS['field:supply'] ?? '',
      onCommit: (v) => {
        setAssetPath('field:supply', v)
        setDevStatus(t('dev.status.assetSaved'))
      },
    })
    makeTextRow(tbody, {
      label: t('dev.assets.oilField'),
      desc: t('dev.fields.fieldOil.desc'),
      value: g.assetPaths['field:oil'] ?? '',
      defaultValue: baseGraphics().assetPaths?.['field:oil'] ?? DEFAULT_ASSET_PATHS['field:oil'] ?? '',
      onCommit: (v) => {
        setAssetPath('field:oil', v)
        setDevStatus(t('dev.status.assetSaved'))
      },
    })
    makeNumberRow(tbody, {
      label: t('dev.fields.fieldOffset.label'),
      desc: t('dev.fields.fieldOffset.desc'),
      unit: devUnit('0–1'),
      group: 'client',
      value: g.fieldOffset,
      default: baseGraphics().fieldOffset ?? DEFAULT_FIELD_OFFSET,
      min: -2,
      max: 2,
      step: 0.05,
      onCommit: (v) => {
        setFieldOffset(v)
        setDevStatus(t('dev.status.saved'))
      },
      onReset: () => {
        setFieldOffset(baseGraphics().fieldOffset ?? DEFAULT_FIELD_OFFSET)
        refreshDevForm()
      },
    })
    makeNumberRow(tbody, {
      label: t('dev.fields.fieldScale.label'),
      desc: t('dev.fields.fieldScale.desc'),
      unit: devUnit('x'),
      group: 'client',
      value: g.fieldScale,
      default: baseGraphics().fieldScale ?? DEFAULT_FIELD_SCALE,
      min: 0.1,
      max: 5,
      step: 0.05,
      onCommit: (v) => {
        setFieldScale(v)
        setDevStatus(t('dev.status.saved'))
      },
      onReset: () => {
        setFieldScale(baseGraphics().fieldScale ?? DEFAULT_FIELD_SCALE)
        refreshDevForm()
      },
    })
    appendSubhead(tbody, t('dev.assets.obstacles'))
    for (const k of OBSTACLE_ASSET_TYPES) {
      makeTextRow(tbody, {
        label: k,
        desc: t('dev.fields.assetObstacle.desc'),
        value: g.assetPaths[`obstacle:${k}`] ?? '',
        defaultValue: baseGraphics().assetPaths?.[`obstacle:${k}`] ?? DEFAULT_ASSET_PATHS[`obstacle:${k}`] ?? '',
        onCommit: (v) => {
          setAssetPath(`obstacle:${k}`, v)
          setDevStatus(t('dev.status.assetSaved'))
        },
      })
    }
    makeNumberRow(tbody, {
      label: t('dev.fields.obstacleScale.label'),
      desc: t('dev.fields.obstacleScale.desc'),
      unit: devUnit('x'),
      group: 'client',
      value: g.obstacleScale,
      default: baseGraphics().obstacleScale ?? DEFAULT_OBSTACLE_SCALE,
      min: 0.1,
      max: 5,
      step: 0.05,
      onCommit: (v) => {
        setObstacleScale(v)
        setDevStatus(t('dev.status.saved'))
      },
      onReset: () => {
        setObstacleScale(baseGraphics().obstacleScale ?? DEFAULT_OBSTACLE_SCALE)
        refreshDevForm()
      },
    })
    makeNumberRow(tbody, {
      label: t('dev.fields.obstacleOffset.label'),
      desc: t('dev.fields.obstacleOffset.desc'),
      unit: devUnit('0–1'),
      group: 'client',
      value: g.obstacleOffset,
      default: baseGraphics().obstacleOffset ?? DEFAULT_OBSTACLE_OFFSET,
      min: -2,
      max: 2,
      step: 0.05,
      onCommit: (v) => {
        setObstacleOffset(v)
        setDevStatus(t('dev.status.saved'))
      },
      onReset: () => {
        setObstacleOffset(baseGraphics().obstacleOffset ?? DEFAULT_OBSTACLE_OFFSET)
        refreshDevForm()
      },
    })
    appendSubhead(tbody, t('dev.assets.fx'))
    makeTextRow(tbody, {
      label: t('dev.assets.burn'),
      desc: t('dev.fields.assetBurn.desc'),
      value: g.assetPaths['fx:burn'] ?? '',
      defaultValue: baseGraphics().assetPaths?.['fx:burn'] ?? DEFAULT_ASSET_PATHS['fx:burn'] ?? '',
      onCommit: (v) => {
        setAssetPath('fx:burn', v)
        setDevStatus(t('dev.status.assetSaved'))
        preloadFxFrames('burn')
      },
    })
    makeNumberRow(tbody, {
      label: t('dev.fields.fxScale.label'),
      desc: t('dev.fields.fxScale.desc'),
      unit: devUnit('x'),
      group: 'client',
      value: g.fxScale,
      default: baseGraphics().fxScale ?? DEFAULT_FX_SCALE,
      min: 0.05,
      max: 3,
      step: 0.05,
      onCommit: (v) => {
        setFxScale(v)
        setDevStatus(t('dev.status.saved'))
      },
      onReset: () => {
        setFxScale(baseGraphics().fxScale ?? DEFAULT_FX_SCALE)
        refreshDevForm()
      },
    })
    makeNumberRow(tbody, {
      label: t('dev.fields.fxOffset.label'),
      desc: t('dev.fields.fxOffset.desc'),
      unit: devUnit('0–1'),
      group: 'client',
      value: g.fxOffset,
      default: baseGraphics().fxOffset ?? DEFAULT_FX_OFFSET,
      min: -2,
      max: 2,
      step: 0.05,
      onCommit: (v) => {
        setFxOffset(v)
        setDevStatus(t('dev.status.saved'))
      },
      onReset: () => {
        setFxOffset(baseGraphics().fxOffset ?? DEFAULT_FX_OFFSET)
        refreshDevForm()
      },
    })
    appendSubhead(tbody, t('dev.assets.minimap'))
    makeNumberRow(tbody, {
      label: t('dev.fields.minimapScale.label'),
      desc: t('dev.fields.minimapScale.desc'),
      unit: devUnit('x'),
      group: 'client',
      value: g.minimapScale,
      default: baseGraphics().minimapScale ?? DEFAULT_MINIMAP_SCALE,
      min: 1.2,
      max: 4,
      step: 0.1,
      onCommit: (v) => {
        setMinimapScale(v)
        setDevStatus(t('dev.status.saved'))
      },
      onReset: () => {
        setMinimapScale(baseGraphics().minimapScale ?? DEFAULT_MINIMAP_SCALE)
        refreshDevForm()
      },
    })
  }

  {
    const tbody = makeTable(appendDevSection(t('dev.sections.layerOrder'), 'client'))
    for (const kind of SPRITE_LAYER_KINDS) {
      makeNumberRow(tbody, {
        label: t(`dev.fields.spriteLayer.${kind}.label`),
        desc: t('dev.fields.spriteLayer.desc'),
        group: 'client',
        value: g.spriteLayerOrder[kind],
        default: baseGraphics().spriteLayerOrder?.[kind] ?? DEFAULT_SPRITE_LAYER_ORDER[kind],
        min: -50,
        max: 50,
        step: 1,
        onCommit: (v) => {
          setSpriteLayerOrder(kind, v)
          setDevStatus(t('dev.status.saved'))
        },
        onReset: () => {
          setSpriteLayerOrder(kind, baseGraphics().spriteLayerOrder?.[kind] ?? DEFAULT_SPRITE_LAYER_ORDER[kind])
          refreshDevForm()
        },
      })
    }
  }

  {
    const tbody = makeTable(appendDevSection(t('dev.sections.projectileFx'), 'client'))
    makeNumberRow(tbody, {
      label: t('dev.fields.projectileBulletSize.label'),
      desc: t('dev.fields.projectileBulletSize.desc'),
      unit: devUnit('x'),
      group: 'client',
      value: g.projectileBulletSize,
      default: baseGraphics().projectileBulletSize ?? DEFAULT_PROJECTILE_BULLET_SIZE,
      min: 0.2,
      max: 4,
      step: 0.1,
      onCommit: (v) => {
        setProjectileBulletSize(v)
        setDevStatus(t('dev.status.saved'))
      },
      onReset: () => {
        setProjectileBulletSize(baseGraphics().projectileBulletSize ?? DEFAULT_PROJECTILE_BULLET_SIZE)
        refreshDevForm()
      },
    })
    makeNumberRow(tbody, {
      label: t('dev.fields.projectileRocketSize.label'),
      desc: t('dev.fields.projectileRocketSize.desc'),
      unit: devUnit('x'),
      group: 'client',
      value: g.projectileRocketSize,
      default: baseGraphics().projectileRocketSize ?? DEFAULT_PROJECTILE_ROCKET_SIZE,
      min: 0.2,
      max: 4,
      step: 0.1,
      onCommit: (v) => {
        setProjectileRocketSize(v)
        setDevStatus(t('dev.status.saved'))
      },
      onReset: () => {
        setProjectileRocketSize(baseGraphics().projectileRocketSize ?? DEFAULT_PROJECTILE_ROCKET_SIZE)
        refreshDevForm()
      },
    })
    makeNumberRow(tbody, {
      label: t('dev.fields.projectileShellSize.label'),
      desc: t('dev.fields.projectileShellSize.desc'),
      unit: devUnit('x'),
      group: 'client',
      value: g.projectileShellSize,
      default: baseGraphics().projectileShellSize ?? DEFAULT_PROJECTILE_SHELL_SIZE,
      min: 0.2,
      max: 4,
      step: 0.1,
      onCommit: (v) => {
        setProjectileShellSize(v)
        setDevStatus(t('dev.status.saved'))
      },
      onReset: () => {
        setProjectileShellSize(baseGraphics().projectileShellSize ?? DEFAULT_PROJECTILE_SHELL_SIZE)
        refreshDevForm()
      },
    })
    makeNumberRow(tbody, {
      label: t('dev.fields.projectileShellHeight.label'),
      desc: t('dev.fields.projectileShellHeight.desc'),
      unit: devUnit('px'),
      group: 'client',
      value: g.projectileShellHeight,
      default: baseGraphics().projectileShellHeight ?? DEFAULT_PROJECTILE_SHELL_HEIGHT,
      min: 0.2,
      max: 4,
      step: 0.1,
      onCommit: (v) => {
        setProjectileShellHeight(v)
        setDevStatus(t('dev.status.saved'))
      },
      onReset: () => {
        setProjectileShellHeight(baseGraphics().projectileShellHeight ?? DEFAULT_PROJECTILE_SHELL_HEIGHT)
        refreshDevForm()
      },
    })
  }

  {
    const tbody = makeTable(appendDevSection(t('dev.sections.zoom'), 'client'))
    makeNumberRow(tbody, {
      label: t('dev.fields.zoomMin.label'),
      desc: t('dev.fields.zoomMin.desc'),
      unit: devUnit('x'),
      group: 'client',
      value: g.zoomMin,
      default: baseGraphics().zoomMin ?? DEFAULT_ZOOM_MIN,
      min: 0.05,
      max: 1,
      step: 0.05,
      onCommit: (v) => {
        setZoomMin(v)
        setDevStatus(t('dev.status.saved'))
      },
      onReset: () => {
        setZoomMin(baseGraphics().zoomMin ?? DEFAULT_ZOOM_MIN)
        refreshDevForm()
      },
    })
    makeNumberRow(tbody, {
      label: t('dev.fields.zoomMax.label'),
      desc: t('dev.fields.zoomMax.desc'),
      unit: devUnit('x'),
      group: 'client',
      value: g.zoomMax,
      default: baseGraphics().zoomMax ?? DEFAULT_ZOOM_MAX,
      min: 1,
      max: 20,
      step: 0.05,
      onCommit: (v) => {
        setZoomMax(v)
        setDevStatus(t('dev.status.saved'))
      },
      onReset: () => {
        setZoomMax(baseGraphics().zoomMax ?? DEFAULT_ZOOM_MAX)
        refreshDevForm()
      },
    })
    makeNumberRow(tbody, {
      label: t('dev.fields.replayZoomMin.label'),
      desc: t('dev.fields.replayZoomMin.desc'),
      unit: devUnit('x'),
      group: 'client',
      value: g.replayZoomMin,
      default: baseGraphics().replayZoomMin ?? DEFAULT_REPLAY_ZOOM_MIN,
      min: 0.05,
      max: 1,
      step: 0.05,
      onCommit: (v) => {
        setReplayZoomMin(v)
        setDevStatus(t('dev.status.saved'))
      },
      onReset: () => {
        setReplayZoomMin(baseGraphics().replayZoomMin ?? DEFAULT_REPLAY_ZOOM_MIN)
        refreshDevForm()
      },
    })
    makeNumberRow(tbody, {
      label: t('dev.fields.replayZoomMax.label'),
      desc: t('dev.fields.replayZoomMax.desc'),
      unit: devUnit('x'),
      group: 'client',
      value: g.replayZoomMax,
      default: baseGraphics().replayZoomMax ?? DEFAULT_REPLAY_ZOOM_MAX,
      min: 1,
      max: 50,
      step: 0.1,
      onCommit: (v) => {
        setReplayZoomMax(v)
        setDevStatus(t('dev.status.saved'))
      },
      onReset: () => {
        setReplayZoomMax(baseGraphics().replayZoomMax ?? DEFAULT_REPLAY_ZOOM_MAX)
        refreshDevForm()
      },
    })
  }

  {
    const tbody = makeTable(appendDevSection(t('dev.sections.match'), 'client'))
    makeNumberRow(tbody, {
      label: t('dev.fields.victoryCinematic.label'),
      desc: t('dev.fields.victoryCinematic.desc'),
      unit: devUnit('sec'),
      group: 'client',
      value: g.victoryCinematicSec,
      default: baseGraphics().victoryCinematicSec ?? DEFAULT_VICTORY_CINEMATIC,
      min: 0,
      max: 30,
      step: 1,
      onCommit: (v) => {
        setVictoryCinematicSec(v)
        setDevStatus(t('dev.status.saved'))
      },
      onReset: () => {
        setVictoryCinematicSec(baseGraphics().victoryCinematicSec ?? DEFAULT_VICTORY_CINEMATIC)
        refreshDevForm()
      },
    })
  }

  {
    const tbody = makeTable(appendDevSection(t('dev.sections.audio'), 'client'))
    const pingBtn = document.createElement('button')
    pingBtn.type = 'button'
    pingBtn.className = 'dev-audio-btn'
    pingBtn.textContent = t('dev.fields.audioPing.label')
    pingBtn.title = t('dev.fields.audioPing.desc')
    pingBtn.addEventListener('click', () => {
      lobbyAudio.unlock()
      lobbyAudio.ping()
      setDevStatus(t('dev.status.audioPing'))
    })
    appendDevRow(tbody, {
      label: t('dev.fields.audioPing.label'),
      desc: t('dev.fields.audioPing.desc'),
      group: 'client',
      defaultText: '',
      isOverridden: () => false,
      buildValue: (cell) => cell.appendChild(pingBtn),
    })
    appendSubhead(tbody, t('dev.audio.ui'))
    for (const id of ['select', 'move-bleep', 'alert'] as SoundId[]) makeAudioRow(tbody, id)
    appendSubhead(tbody, t('dev.audio.weapons'))
    for (const id of ['weapon-rifle', 'weapon-rocket', 'weapon-cannon', 'weapon-artillery', 'weapon-air-cannon'] as SoundId[]) {
      makeAudioRow(tbody, id)
    }
    appendSubhead(tbody, t('dev.audio.events'))
    for (const id of ['unit-trained', 'building-completed', 'upgrade-completed', 'supply-harvested', 'combat-hit', 'laser-strike', 'airstrike-called', 'bomb-strike', 'emp-strike', 'grenade-exploded', 'smoke-landed', 'power-down', 'game-over', 'victory', 'achievement'] as SoundId[]) {
      makeAudioRow(tbody, id)
    }
    appendSubhead(tbody, t('dev.audio.ambient'))
    for (const id of ['ambient-lobby', 'ambient-game'] as SoundId[]) makeAudioRow(tbody, id)
    appendSubhead(tbody, t('dev.audio.weather'))
    for (const id of ['rain-ambient', 'snow-ambient', 'storm-ambient'] as SoundId[]) makeAudioRow(tbody, id)
  }

  if (PROFILE_TARGET_FIELDS.length > 0) {
    const tbody = makeTable(appendDevSection(t('dev.sections.profile'), 'client'))
    for (const field of PROFILE_TARGET_FIELDS) {
      const cfg = loadProfileConfig(window.localStorage)
      const current = cfg.achievementTargets[field.key] ?? field.target
      makeNumberRow(tbody, {
        label: t(`dev.fields.${field.key}.label`),
        desc: t(`dev.fields.${field.key}.desc`),
        group: 'client',
        value: current,
        default: baseProfileTargets()[field.key] ?? field.target,
        min: field.min,
        max: field.max,
        step: field.step,
        onCommit: (v) => {
          const next = loadProfileConfig(window.localStorage)
          next.achievementTargets[field.key] = Math.round(v)
          saveProfileConfig(window.localStorage, next)
          setDevStatus(t('dev.status.saved'))
          renderProfilePanel()
        },
        onReset: () => {
          const next = loadProfileConfig(window.localStorage)
          delete next.achievementTargets[field.key]
          saveProfileConfig(window.localStorage, next)
          setDevStatus(t('dev.status.saved'))
          renderProfilePanel()
          refreshDevForm()
        },
      })
    }
  }

  applyDevFilters()
}

const refreshDevForm = (): void => {
  buildDevForm()
  renderActiveInfoTab()
}

setDevFilterGroup('all')

devSaveBtn.addEventListener('click', () => {
  saveDevOverrides()
  // Flush the on-disk snapshot too, so the new dev values (synced + client-only)
  // survive a fresh origin even if the tab closes before the idle heartbeat.
  void saveLocalProfile()
  // …and refresh the cloud dev-backup snapshot when this session already holds the
  // backup passphrase (silent: no re-prompt, no error when logged out).
  if (lastBackupPass) void uploadBackup('devsettings', { pass: lastBackupPass, silent: true })
  pushDevSettingsToHost()
  setDevStatus(t('dev.status.saved'))
  renderActiveInfoTab()
})

devResetBtn.addEventListener('click', () => {
  devOverrides = {}
  saveDevOverrides()
  buildDevForm()
  pushDevSettingsToHost()
  setDevStatus(t('dev.status.reset'))
  renderActiveInfoTab()
})

devSaveDefaultBtn.addEventListener('click', () => {
  if (!window.confirm(t('dev.confirmSaveDefault'))) return
  // Snapshot the effective values (saved defaults + session edits) as the new
  // defaults, then drop the session overrides so nothing reads as "modified".
  const snapshot = JSON.parse(JSON.stringify(resolvedDevSettings())) as Partial<MatchSettings>
  savedDefaults = snapshot
  devOverrides = {}
  saveDevOverrides()
  const client = clientDevSettings()
  try {
    localStorage.setItem(DEV_DEFAULTS_KEY, JSON.stringify(savedDefaults))
    localStorage.setItem(DEV_CLIENT_KEY, JSON.stringify(client))
  } catch {
    /* storage unavailable */
  }
  // Mirror into `profile/settings.json` (`user` layer + the client-only snapshot,
  // preserving the shipped `builtin` block) so the defaults survive a fresh origin.
  const file: MatchSettingsFile = { v: 1 }
  if (settingsFile.builtin) file.builtin = settingsFile.builtin
  file.client = client
  file.user = savedDefaults
  settingsFile = file
  void saveSettingsFile(file)
  buildDevForm()
  pushDevSettingsToHost()
  setDevStatus(t('dev.status.defaultsSaved'))
  renderActiveInfoTab()
})

devCollapseBtn.addEventListener('click', () => {
  for (const d of devFormEl.querySelectorAll<HTMLDetailsElement>('details')) d.open = false
})

const devExportBtn = document.getElementById('dev-export') as HTMLButtonElement
devExportBtn.addEventListener('click', () => {
  const mapKeys = ['buildingOverrides', 'unitOverrides', 'weaponOverrides', 'upgradeOverrides'] as const
  const anyMap = mapKeys.some((k) => {
    const v = (devOverrides as Record<string, unknown>)[k]
    return typeof v === 'object' && v !== null && Object.keys(v as object).length > 0
  })
  if (Object.keys(devOverrides).length === 0 && !anyMap) {
    setDevStatus(t('mods.exportNothing'), true)
    return
  }
  const raw = window.prompt(t('mods.exportNamePrompt'), 'My Balance Mod')
  if (raw === null) return
  const name = (raw.trim() || 'My Balance Mod').slice(0, 60)
  // Full snapshot: every effective scalar + the merged override maps + the
  // client-only block, so importing the mod reproduces this machine exactly.
  const mod = modFromSettings(resolvedDevSettings(), { name, requireProtocol: PROTOCOL_VERSION }, wireClientDevSettings())
  const blob = new Blob([JSON.stringify(mod, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  // eslint-disable-next-line no-control-regex -- scrub filesystem-hostile control chars from the download name
  a.download = `${name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '').slice(0, 60) || 'mod'}.json`
  a.click()
  URL.revokeObjectURL(a.href)
  void (async () => {
    try {
      const res = await fetch('/api/mods/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mod),
      })
      if (res.ok) {
        setDevStatus(t('mods.exported'))
        await refreshMods()
      } else {
        setDevStatus(t('mods.exportNoHost'))
      }
    } catch {
      setDevStatus(t('mods.exportNoHost'))
    }
  })()
})

try {
  const rawDefaults = localStorage.getItem(DEV_DEFAULTS_KEY)
  if (rawDefaults) savedDefaults = JSON.parse(rawDefaults) as Partial<MatchSettings>
} catch {
  /* storage unavailable */
}

try {
  const raw = localStorage.getItem(DEV_STORAGE_KEY)
  if (raw) devOverrides = JSON.parse(raw) as Partial<MatchSettings>
} catch {
  /* storage unavailable */
}
try {
  const rawClient = localStorage.getItem(DEV_CLIENT_KEY)
  if (rawClient) settingsFile.client = sanitizeClientDevSettings(JSON.parse(rawClient) as ClientDevSettings, window.location.origin)
} catch {
  /* storage unavailable */
}
buildDevForm()
// Fold `profile/settings.json` (host side) under the localStorage layers. Local
// data always wins; when the endpoint is unavailable we keep compiled + local.
void loadSettingsFile()

// ---------- offline menu state ----------

interface UiRow {
  slot: number
  name: string
  difficulty: BotDifficulty | undefined
  team: number
  spawn: number
  color: number
}

const mapSelect = document.getElementById('map-select') as HTMLSelectElement
const mapDesc = document.getElementById('map-desc') as HTMLDivElement
const previewCanvas = document.getElementById('map-preview') as HTMLCanvasElement
const playersList = document.getElementById('players-list') as HTMLDivElement
const startBtn = document.getElementById('start-btn') as HTMLButtonElement
const cancelBtn = document.getElementById('cancel-btn') as HTMLButtonElement
const addBotBtn = document.getElementById('add-bot-btn') as HTMLButtonElement
const creditsInput = document.getElementById('start-credits') as HTMLInputElement
const winRuleSelect = document.getElementById('win-rule') as HTMLSelectElement
const winRuleDesc = document.getElementById('win-rule-desc') as HTMLDivElement
const startFogEl = document.getElementById('start-fog') as HTMLSelectElement
const matchFogEl = document.getElementById('match-fog') as HTMLSelectElement
const startDayNightEl = document.getElementById('start-daynight') as HTMLInputElement
const matchDayNightEl = document.getElementById('match-daynight') as HTMLInputElement
const matchCoopEconomyEl = document.getElementById('match-coop-economy') as HTMLSelectElement
const matchCoopRankEl = document.getElementById('match-coop-rank') as HTMLSelectElement
const matchCoopControlEl = document.getElementById('match-coop-control') as HTMLSelectElement
const offlineStatus = document.getElementById('offline-status') as HTMLDivElement
const countdownOverlay = document.getElementById('countdown-overlay') as HTMLDivElement
const countdownNum = document.getElementById('countdown-num') as HTMLDivElement
const countdownCancel = document.getElementById('countdown-cancel') as HTMLButtonElement

const preview = new MapPreview(previewCanvas.width, previewCanvas.height)
preview.canvas.id = 'map-preview'
previewCanvas.replaceWith(preview.canvas)

let selectedPreset: MapEntry = findMapEntry(MAP_PRESETS[0].id)!
let previewMap: MapData = entryToMap(selectedPreset)
let rows: UiRow[] = [
  { slot: 0, name: 'Commander', difficulty: undefined, team: 0, spawn: 0, color: 0 },
  { slot: 1, name: 'Bot 1', difficulty: 'easy', team: 1, spawn: 1, color: 1 },
]
let countdownTimer: number | null = null

const previewColorFor = (team: number): number => {
  const row = rows.find((r) => r.slot === team)
  return row ? row.color : team
}

const setOfflineStatus = (text: string, isError = false): void => {
  offlineStatus.textContent = text
  offlineStatus.classList.toggle('error', isError)
}

const renderMapSelect = (): void => {
  mapSelect.innerHTML = ''
  for (const entry of allMapEntries()) {
    const opt = document.createElement('option')
    opt.value = entry.id
    opt.textContent = `${entry.kind === 'preset' ? tn(entry.id, entry.name) : entry.name} (${entry.players}P)`
    if (entry.id === selectedPreset.id) opt.selected = true
    mapSelect.appendChild(opt)
  }
  mapDesc.textContent = selectedPreset.kind === 'preset' ? t(`maps.${selectedPreset.id}.desc`) : (selectedPreset.data?.description ?? selectedPreset.name)
}

const applySpawnAssignments = (): void => {
  const assign: Record<number, number> = {}
  for (const r of rows) assign[r.spawn] = r.slot
  previewMap.spawnPoints.forEach((s, i) => {
    s.team = assign[i] ?? i
  })
}

const selectPreset = (preset: MapEntry): void => {
  selectedPreset = preset
  previewMap = entryToMap(preset)
  if (rows.length > preset.players) rows = rows.slice(0, preset.players)
  rows.forEach((r, i) => {
    r.slot = i
    r.team = i
    r.spawn = i
    r.color = i
  })
  applySpawnAssignments()
  renderMapSelect()
  renderPlayers()
  preview.render(previewMap, previewColorFor)
}

mapSelect.addEventListener('change', () => {
  const entry = findMapEntry(mapSelect.value)
  if (entry) selectPreset(entry)
})

const nextFreeSlot = (): number => {
  const used = new Set(rows.map((r) => r.slot))
  for (let i = 0; i < selectedPreset.players; i++) {
    if (!used.has(i)) return i
  }
  return rows.length
}

const renderPlayers = (): void => {
  playersList.innerHTML = ''
  rows.forEach((row, index) => {
    const div = createPlayerRow({
      maxPlayers: selectedPreset.players,
      team: row.team,
      spawn: row.spawn,
      color: row.color,
      palette: COLOR_HEXES,
      name: row.name,
      nameTitle: undefined,
      isBot: !!row.difficulty,
      difficulty: row.difficulty,
      editable: true,
      showYouBadge: !row.difficulty,
      teamLabel: (n) => t('offline.playerRow.team', { n }),
      spawnLabel: (n) => t('offline.playerRow.spawn', { n }),
      colorLabel: (n) => t('offline.playerRow.color', { n }),
      teamTitle: t('offline.playerRow.teamTitle'),
      spawnTitle: t('offline.playerRow.spawnTitle'),
      colorTitle: t('offline.playerRow.colorTitle'),
      onTeamChange: (v) => { row.team = v },
      onSpawnChange: (v) => {
        row.spawn = v
        applySpawnAssignments()
        preview.render(previewMap, previewColorFor)
      },
      onColorChange: (v) => {
        row.color = v
        preview.render(previewMap, previewColorFor)
      },
      onNameChange: (name) => { row.name = name || row.name },
      onDifficultyChange: row.difficulty ? (d) => { row.difficulty = d } : undefined,
      onRemove: row.difficulty ? () => {
        rows.splice(index, 1)
        renderPlayers()
        applySpawnAssignments()
        preview.render(previewMap, previewColorFor)
      } : undefined,
    })
    playersList.appendChild(div)
  })
}

addBotBtn.addEventListener('click', () => {
  if (rows.length >= selectedPreset.players) {
    setOfflineStatus(t('offline.status.tooMany', { n: selectedPreset.players }), true)
    return
  }
  const slot = nextFreeSlot()
  rows.push({ slot, name: t('offline.bot', { n: rows.length }), difficulty: 'medium', team: slot, spawn: slot, color: slot })
  renderPlayers()
  applySpawnAssignments()
  preview.render(previewMap, previewColorFor)
})

// ---------- offline mode list (Day 19) ----------

const offlineModeListEl = document.getElementById('offline-mode-list') as HTMLElement
const offlineOptionsEl = document.getElementById('offline-options') as HTMLElement
const offlineDailyExtrasEl = document.getElementById('offline-daily-extras') as HTMLElement
const offlineCampaignExtrasEl = document.getElementById('offline-campaign-extras') as HTMLElement
const dailyAcceptToggle = document.getElementById('daily-accept-toggle') as HTMLInputElement
const dailyAcceptHint = document.getElementById('daily-accept-hint') as HTMLDivElement
const matchProfileToggle = document.getElementById('match-profile-toggle') as HTMLInputElement
const matchProfileHint = document.getElementById('match-profile-hint') as HTMLDivElement
// The same two tracking toggles live in the shared match-options panel (LAN + online).
const netDailyToggle = document.getElementById('match-daily-toggle') as HTMLInputElement
const netDailyHint = document.getElementById('match-daily-hint') as HTMLDivElement
const netProfileToggle = document.getElementById('match-achieve-toggle') as HTMLInputElement
const netProfileHint = document.getElementById('match-achieve-hint') as HTMLDivElement
let offlineMode: OfflineMode = 'bots'

/** Keep the match-option toggle hints in sync with their current state and language. */
const updateTrackingHints = (): void => {
  dailyAcceptHint.textContent = t(dailyAcceptToggle.checked ? 'daily.acceptOn' : 'daily.acceptOff')
  matchProfileHint.textContent = t(matchProfileToggle.checked ? 'daily.profileOn' : 'daily.profileOff')
  netDailyHint.textContent = t(netDailyToggle.checked ? 'daily.acceptOn' : 'daily.acceptOff')
  netProfileHint.textContent = t(netProfileToggle.checked ? 'daily.profileOn' : 'daily.profileOff')
}
dailyAcceptToggle.addEventListener('change', updateTrackingHints)
matchProfileToggle.addEventListener('change', updateTrackingHints)
netDailyToggle.addEventListener('change', updateTrackingHints)
netProfileToggle.addEventListener('change', updateTrackingHints)

interface DailyListIds { day: string; level: string; list: string }

/** Render the active mission list into whichever panel shows it (offline or match). */
const renderDailyList = ({ day, level, list }: DailyListIds): void => {
  const storage = window.localStorage
  const { missions, doneIds, allDone } = resolveDailyChallenge(storage)
  const label = document.getElementById(day)
  const levelLabel = document.getElementById(level)
  const listEl = document.getElementById(list) as HTMLDivElement
  const rec = loadModeRecords(storage).daily
  const levelNo = dailyLevel(rec)
  const xp = dailyLevelXp(rec)
  if (label && rec?.challenge) label.textContent = t('daily.challenge', { n: rec.challenge.generation })
  if (levelLabel) levelLabel.textContent = t('daily.level', { level: levelNo, xp, required: DAILY_XP_PER_LEVEL })
  listEl.innerHTML = ''
  for (const m of missions) {
    const row = document.createElement('div')
    row.className = 'mission-row'
    const desc = document.createElement('span')
    desc.textContent = doneIds.includes(m.id) ? `✔ ${t(m.descKey, { n: m.target })}` : t(m.descKey, { n: m.target })
    const badge = document.createElement('span')
    badge.className = 'xp-badge'
    badge.textContent = `+${m.xp} XP`
    row.appendChild(desc)
    row.appendChild(badge)
    listEl.appendChild(row)
  }
  const note = document.createElement('div')
  note.className = 'hint'
  note.textContent = allDone ? t('daily.allDone') : t('daily.keep', { n: missions.length - doneIds.length })
  listEl.appendChild(note)
}

const renderDaily = (): void =>
  renderDailyList({ day: 'daily-day-label', level: 'daily-level-label', list: 'daily-missions-list' })

/** Mirror the offline daily block into the shared match-options panel (LAN + online). */
const renderMatchDaily = (): void => {
  renderDailyList({ day: 'match-daily-day-label', level: 'match-daily-level-label', list: 'match-daily-list' })
  updateTrackingHints()
}

/** Tracking choices for the next net/online match, read from the match-options panel. */
const netTrackingOpts = (): { trackDaily: boolean; trackProfile: boolean } => ({
  trackDaily: netDailyToggle.checked,
  trackProfile: netProfileToggle.checked,
})

const setOfflineMode = (mode: OfflineMode): void => {
  offlineMode = mode
  for (const btn of offlineModeListEl.querySelectorAll<HTMLButtonElement>('.mode-btn')) {
    btn.classList.toggle('active', (btn.dataset.mode as OfflineMode | undefined) === mode)
  }
  // The bots tab is the classic match plus the daily mission list; campaign is a placeholder.
  offlineOptionsEl.classList.toggle('hidden-extras', mode !== 'bots')
  offlineDailyExtrasEl.classList.toggle('hidden-extras', mode !== 'bots')
  offlineCampaignExtrasEl.classList.toggle('hidden-extras', mode !== 'campaign')
  if (mode === 'bots') renderDaily()
  setOfflineStatus('')
}

offlineModeListEl.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.mode-btn')
  if (btn?.dataset.mode) setOfflineMode(btn.dataset.mode as OfflineMode)
})

// ---------- collapsible option sections (parity with the dev-settings groups) ----------

const collapseSections = (panelId: string): void => {
  const panel = document.getElementById(panelId)
  if (!panel) return
  for (const s of panel.querySelectorAll<HTMLDetailsElement>('details')) s.open = false
}

const offlineCollapseBtn = document.getElementById('offline-collapse') as HTMLButtonElement | null
offlineCollapseBtn?.addEventListener('click', () => collapseSections('offline-panel'))

const matchCollapseBtn = document.getElementById('match-collapse') as HTMLButtonElement | null
matchCollapseBtn?.addEventListener('click', () => collapseSections('match-panel'))

// ---------- countdown ----------

const stopCountdown = (): void => {
  if (countdownTimer !== null) {
    clearInterval(countdownTimer)
    countdownTimer = null
  }
  countdownOverlay.classList.remove('visible')
  startBtn.disabled = false
  cancelBtn.style.display = 'none'
}

countdownCancel.addEventListener('click', stopCountdown)

const startCountdown = (cfg: MatchConfig): void => {
  let remaining = COUNTDOWN_SECONDS
  countdownNum.textContent = String(remaining)
  countdownOverlay.classList.add('visible')
  startBtn.disabled = true
  cancelBtn.style.display = 'block'
  countdownTimer = window.setInterval(() => {
    remaining--
    if (remaining <= 0) {
      stopCountdown()
      beginGame(cfg)
      return
    }
    countdownNum.textContent = String(remaining)
  }, 1000)
}

const beginGame = (cfg: MatchConfig): void => {
  lobbyAudio.stopAmbient()
  if (game) {
    game.destroy()
    game = null
  }
  game = makeGame()
  hideLobby()
  void game.startOffline(cfg)
}

startBtn.addEventListener('click', () => {
  if (offlineMode === 'campaign') {
    setOfflineStatus(t('campaign.comingSoon'), true)
    return
  }
  const humans = rows.filter((r) => !r.difficulty)
  if (humans.length === 0) {
    setOfflineStatus(t('offline.status.needHuman'), true)
    return
  }
  const credits = Number(creditsInput.value) || DEFAULT_CREDITS
  if (WEATHERS.includes(startWeatherEl.value as WeatherId)) setWeather(startWeatherEl.value as WeatherId)
  if (rows.length < 2) {
    setOfflineStatus(t('offline.status.needOpponent'), true)
    return
  }
  // The daily mission list is attached to every bots match, but only counts (live
  // Mission popup + XP on finish) when the Accept toggle is on. The profile toggle
  // decides whether the match feeds counters, history and achievements at all.
  const challenge = resolveDailyChallenge(window.localStorage)
  const baseSettings: MatchSettings = { ...resolvedDevSettings(), fogMode: startFogEl.value as FogMode, dayNight: startDayNightEl.checked }
  const makeCfg = (settings: MatchSettings): MatchConfig => ({
    map: previewMap,
    seed: (Math.floor(Math.random() * 0xffffffff) >>> 0) || 0x5eed,
    credits,
    localTeam: humans[0].slot,
    slots: rows.map((r) => ({ team: r.slot, name: r.name, difficulty: r.difficulty, alliance: r.team, color: r.color })),
    winRule: winRuleSelect.value as WinRule,
    settings,
    mode: 'bots',
    daily: { generation: challenge.generation },
    trackDaily: dailyAcceptToggle.checked,
    trackProfile: matchProfileToggle.checked,
  })
  const start = (cfg: MatchConfig): void => {
    setOfflineStatus('')
    startCountdown(cfg)
  }
  if (!offlineModToggleEl.checked || !offlineModName) {
    start(makeCfg(baseSettings))
    return
  }
  void (async () => {
    const mod = await fetchModByName(offlineModName)
    if (mod) {
      applyModClientBlock(mod)
      start(makeCfg(mergeMatchSettings({ ...baseSettings, ...modSettingsDelta(baseSettings, mod) })))
    } else {
      start(makeCfg(baseSettings))
    }
  })()
})

renderMapSelect()
renderPlayers()
preview.render(previewMap, previewColorFor)
renderDaily()
updateTrackingHints()

const WIN_RULE_KEYS: Record<WinRule, string> = {
  standard: 'standard',
  annihilation: 'annihilation',
  'command-center': 'commandCenter',
}
winRuleSelect.addEventListener('change', () => {
  winRuleDesc.textContent = t(`offline.winDesc.${WIN_RULE_KEYS[winRuleSelect.value as WinRule]}`)
})
winRuleDesc.textContent = t(`offline.winDesc.${WIN_RULE_KEYS[winRuleSelect.value as WinRule]}`)

// ---------- network lobby ----------

interface NetPlayer {
  name: string
  ip: string
  port: number
  roomCode: string | null
  started: boolean
  playerCount: number
  maxPlayers: number
  passwordRequired: boolean
  hostDevice: boolean
  lastSeenMs?: number
}

const netNameEl = document.getElementById('net-name') as HTMLInputElement
const netAddrEl = document.getElementById('net-addr') as HTMLInputElement
const netPassEl = document.getElementById('net-pass') as HTMLInputElement
const netCreateBtn = document.getElementById('net-create-btn') as HTMLButtonElement
const netStatusEl = document.getElementById('net-status') as HTMLDivElement
const netAddrManualEl = document.getElementById('net-addr-manual') as HTMLInputElement
const netCodeEl = document.getElementById('net-code') as HTMLInputElement
const netJoinBtn = document.getElementById('net-join-btn') as HTMLButtonElement
const netPlayersEl = document.getElementById('net-players') as HTMLDivElement
const netPlayersTitleEl = document.getElementById('net-players-title') as HTMLHeadingElement
const netMatchesEl = document.getElementById('net-matches') as HTMLDivElement
const netChatHistoryEl = document.getElementById('net-chat-history') as HTMLDivElement
const netChatInputEl = document.getElementById('net-chat-input') as HTMLInputElement
const netChatSendBtn = document.getElementById('net-chat-send') as HTMLButtonElement
const createOverlay = document.getElementById('create-overlay') as HTMLDivElement
const createAddrEl = document.getElementById('create-addr') as HTMLInputElement
const createPassEl = document.getElementById('create-pass') as HTMLInputElement
const createOkBtn = document.getElementById('create-ok') as HTMLButtonElement
const createCancelBtn = document.getElementById('create-cancel') as HTMLButtonElement

const matchInviteBtn = document.getElementById('match-invite-btn') as HTMLButtonElement
const inviteOverlay = document.getElementById('invite-overlay') as HTMLDivElement
const inviteQrImgEl = document.getElementById('invite-qr-img') as HTMLImageElement
const inviteUrlEl = document.getElementById('invite-url') as HTMLDivElement
const inviteStatusEl = document.getElementById('invite-status') as HTMLDivElement
const inviteCloseBtn = document.getElementById('invite-close') as HTMLButtonElement
const inviteCopyBtn = document.getElementById('invite-copy') as HTMLButtonElement

const matchCodeEl = document.getElementById('match-code') as HTMLSpanElement
const matchMapSelectEl = document.getElementById('match-map-select') as HTMLSelectElement
const matchMapDescEl = document.getElementById('match-map-desc') as HTMLDivElement
const matchMapPreviewCanvas = document.getElementById('match-map-preview') as HTMLCanvasElement
const matchCreditsEl = document.getElementById('match-credits') as HTMLInputElement
const matchWinRuleEl = document.getElementById('match-win-rule') as HTMLSelectElement
const matchWinRuleDescEl = document.getElementById('match-win-rule-desc') as HTMLDivElement
const matchPlayersListEl = document.getElementById('match-players-list') as HTMLDivElement
const matchBotDiffEl = document.getElementById('match-bot-diff') as HTMLSelectElement
const matchAddBotEl = document.getElementById('match-add-bot') as HTMLButtonElement
const matchPassInputEl = document.getElementById('match-pass-input') as HTMLInputElement
const matchPassBtnEl = document.getElementById('match-pass-btn') as HTMLButtonElement
const matchActionsEl = document.getElementById('match-actions') as HTMLDivElement
const matchStatusEl = document.getElementById('match-status') as HTMLDivElement
const matchNotesEl = document.getElementById('match-notes') as HTMLDivElement
const matchInviteRowEl = document.getElementById('match-invite-row') as HTMLDivElement

const matchPreview = new MapPreview(matchMapPreviewCanvas.width, matchMapPreviewCanvas.height)
matchPreview.canvas.id = 'match-map-preview'
matchPreview.canvas.className = 'match-map-preview'
matchMapPreviewCanvas.replaceWith(matchPreview.canvas)

let lobbyState: LobbyMessage | null = null

const setMatchStatus = (text: string, isError = false): void => {
  matchStatusEl.textContent = text
  matchStatusEl.classList.toggle('error', isError)
}

const leaveMatch = (): void => {
  const wasOnline = isOnlineAddr(lastJoin?.addr)
  net?.close()
  net = null
  lobbyState = null
  devPushedToRoom = false
  if (wasOnline) {
    setTab('online')
    setOnlineStatus(t('network.status.left'))
    void refreshOnlineList(true)
  } else {
    setTab('network')
    setNetStatus(t('network.status.left'))
  }
}

const renderMatchOptions = (msg: LobbyMessage, isHost: boolean): void => {
  const startingCredits = msg.settings?.startingCredits ?? DEFAULT_MATCH_SETTINGS.startingCredits
  matchCreditsEl.value = String(startingCredits)
  matchCreditsEl.disabled = !isHost

  const winRule = msg.winRule ?? 'standard'
  matchWinRuleEl.value = winRule
  matchWinRuleEl.disabled = !isHost
  matchWinRuleDescEl.textContent = t(`offline.winDesc.${WIN_RULE_KEYS[winRule]}`)

  const fogMode = msg.settings?.fogMode ?? DEFAULT_MATCH_SETTINGS.fogMode
  if ((FOG_MODES as readonly string[]).includes(fogMode)) matchFogEl.value = fogMode
  matchFogEl.disabled = !isHost
  matchDayNightEl.checked = msg.settings?.dayNight ?? DEFAULT_MATCH_SETTINGS.dayNight
  matchDayNightEl.disabled = !isHost

  const coopEconomy = msg.settings?.coopEconomy ?? DEFAULT_MATCH_SETTINGS.coopEconomy
  if ((COOP_ECONOMY_OPTIONS as readonly string[]).includes(coopEconomy)) matchCoopEconomyEl.value = coopEconomy
  matchCoopEconomyEl.disabled = !isHost
  const coopRank = msg.settings?.coopRank ?? DEFAULT_MATCH_SETTINGS.coopRank
  if ((COOP_RANK_OPTIONS as readonly string[]).includes(coopRank)) matchCoopRankEl.value = coopRank
  matchCoopRankEl.disabled = !isHost
  const coopControl = msg.settings?.coopControl ?? DEFAULT_MATCH_SETTINGS.coopControl
  if ((COOP_CONTROL_OPTIONS as readonly string[]).includes(coopControl)) matchCoopControlEl.value = coopControl
  matchCoopControlEl.disabled = !isHost

  matchMapSelectEl.innerHTML = ''
  if (isHost) {
    for (const entry of allMapEntries()) {
      const opt = document.createElement('option')
      opt.value = entry.id
      opt.textContent = `${entry.kind === 'preset' ? tn(entry.id, entry.name) : entry.name} (${entry.players}P)`
      if (entry.id === msg.mapId) opt.selected = true
      matchMapSelectEl.appendChild(opt)
    }
  } else {
    const cur = findMapEntry(msg.mapId)
    const opt = document.createElement('option')
    opt.value = cur?.id ?? msg.mapId
    opt.textContent = cur ? `${cur.name} (${cur.players}P)` : msg.mapName
    opt.selected = true
    matchMapSelectEl.appendChild(opt)
  }
  matchMapSelectEl.disabled = !isHost
  const matchMapEntry = findMapEntry(msg.mapId)
  const shownMap = msg.map ?? (matchMapEntry ? entryToMap(matchMapEntry) : mapForPreset(MAP_PRESETS[0]))
  matchMapDescEl.textContent = shownMap.description || shownMap.name
  const matchColorFor = (team: number): number => msg.players.find((p) => p.id === team)?.color ?? team
  matchPreview.render(shownMap, matchColorFor)

  const prevDiff = matchBotDiffEl.value
  matchBotDiffEl.innerHTML = ''
  for (const d of BOT_DIFFICULTIES) {
    const opt = document.createElement('option')
    opt.value = d
    opt.textContent = t('match.bot', { d: t(`difficulty.${d}`) })
    matchBotDiffEl.appendChild(opt)
  }
  if (BOT_DIFFICULTIES.includes(prevDiff as BotDifficulty)) matchBotDiffEl.value = prevDiff

  matchAddBotEl.disabled = !isHost || msg.players.length >= msg.maxPlayers
  matchPassInputEl.placeholder = msg.passwordRequired ? t('match.passNewPlaceholder') : t('network.noPassPlaceholder')
  matchPassBtnEl.textContent = msg.passwordRequired ? t('match.passChange') : t('match.passSet')
  syncMatchModUi(msg, isHost)
}

const renderMatchPanel = (msg: LobbyMessage): void => {
  lobbyState = msg
  matchCodeEl.textContent = msg.roomCode
  const me = msg.players.find((p) => p.id === msg.yourId)
  const isHost = msg.yourId === msg.hostId
  if (isHost && !devPushedToRoom) {
    devPushedToRoom = true
    net?.updateRoom({ settings: resolvedDevSettings() })
  }
  const nonSpectators = msg.players.filter((p) => !p.spectator)
  const allReady = nonSpectators.every((p) => p.connected !== false && p.ready)

  matchPlayersListEl.innerHTML = ''
  for (const p of msg.players) {
    const isMe = p.id === msg.yourId
    const editable = (isHost && p.bot) || (isMe && !p.spectator)
    const updateName = (trimmed: string) => {
      if (p.bot) net?.updateBot(p.id, { name: trimmed })
      else net?.updateSlot({ name: trimmed })
    }

    const div = createPlayerRow({
      maxPlayers: msg.maxPlayers,
      team: p.team ?? 0,
      spawn: p.spawn ?? 0,
      color: p.color ?? 0,
      palette: COLOR_HEXES,
      name: p.name,
      nameTitle: p.bot ? (isHost ? t('match.botTitleEdit') : t('match.bot')) : t('match.displayName'),
      isBot: !!p.bot,
      difficulty: p.difficulty ?? 'medium',
      editable,
      showYouBadge: isMe && !p.spectator && !p.bot,
      teamLabel: (n) => t('match.team', { n }),
      spawnLabel: (n) => t('match.spawn', { n }),
      colorLabel: (n) => t('match.color', { n }),
      teamTitle: t('match.teamTitle'),
      spawnTitle: t('match.spawnTitle'),
      colorTitle: t('match.colorTitle'),
      onTeamChange: (v) => {
        if (p.bot) net?.updateBot(p.id, { team: v })
        else net?.updateSlot({ team: v })
      },
      onSpawnChange: (v) => {
        if (p.bot) net?.updateBot(p.id, { spawn: v })
        else net?.updateSlot({ spawn: v })
      },
      onColorChange: (v) => {
        if (p.bot) net?.updateBot(p.id, { color: v })
        else net?.updateSlot({ color: v })
      },
      onNameChange: updateName,
      nameDebounceMs: NAME_DEBOUNCE_MS,
      onNameImmediate: updateName,
      nameMaxLength: MAX_NAME_LENGTH,
      diffDisabled: p.bot && !isHost,
      onDifficultyChange: p.bot ? (d) => {
        net?.updateBot(p.id, { difficulty: d })
        setMatchStatus(t('match.addingBot', { d: t(`difficulty.${d}`) }))
      } : undefined,
      onRemove: (p.bot && isHost) ? () => {
        net?.removeBot(p.id)
        setMatchStatus(t('match.removingBot'))
      } : undefined,
    })

    if (p.host) {
      const badge = document.createElement('span')
      badge.className = 'p-badge host'
      badge.textContent = t('match.host')
      div.appendChild(badge)
    }
    if (p.spectator) {
      const badge = document.createElement('span')
      badge.className = 'p-badge spectator'
      badge.textContent = t('match.spectator')
      div.appendChild(badge)
    }
    if (p.connected === false) {
      div.classList.add('p-offline')
      const badge = document.createElement('span')
      badge.className = 'p-badge disconnected'
      badge.textContent = t('match.disconnected')
      div.appendChild(badge)
    }
    if (!p.spectator) {
      const ready = document.createElement('span')
      ready.className = `p-ready${p.ready ? ' yes' : ''}`
      ready.textContent = p.ready ? t('match.ready') : t('match.waiting')
      div.appendChild(ready)
    }

    matchPlayersListEl.appendChild(div)
  }

  matchActionsEl.innerHTML = ''
  const leaveBtn = document.createElement('button')
  leaveBtn.className = 'ghost danger'
  leaveBtn.textContent = t('match.leave')
  leaveBtn.addEventListener('click', leaveMatch)

  // Base-defaults gate: guests whose dev-settings defaults differ from the host's
  // would build their match settings on a different base, so the host blocks start
  // (the server enforces this too) until they adopt the host's defaults.
  const baseOffenders = nonSpectators.filter((p) => !p.bot && !p.host && p.defaultsOk === false)

  if (isHost) {
    const startMatchBtn = document.createElement('button')
    startMatchBtn.className = 'primary'
    startMatchBtn.textContent = allReady
      ? t('match.start')
      : t('match.waitingReady', { r: nonSpectators.filter((p) => p.ready).length, t: nonSpectators.length })
    startMatchBtn.disabled = !allReady || baseOffenders.length > 0
    startMatchBtn.addEventListener('click', () => net?.start())
    matchActionsEl.appendChild(startMatchBtn)
    if (baseOffenders.length > 0) {
      const note = document.createElement('div')
      note.className = 'match-note'
      note.textContent = t('match.defaultsMismatch', { names: baseOffenders.map((p) => p.name).join(', ') })
      matchActionsEl.appendChild(note)
    }
  } else if (me && !me.spectator) {
    const readyBtn = document.createElement('button')
    readyBtn.className = 'primary'
    readyBtn.textContent = me.ready ? t('match.notReady') : t('match.readyBtn')
    readyBtn.addEventListener('click', () => net?.ready(!me.ready))
    matchActionsEl.appendChild(readyBtn)
    if (me.defaultsOk === false) {
      const adoptBtn = document.createElement('button')
      adoptBtn.textContent = t('dev.useHostDefaults')
      adoptBtn.addEventListener('click', adoptHostDefaults)
      matchActionsEl.appendChild(adoptBtn)
      const note = document.createElement('div')
      note.className = 'match-note'
      note.textContent = t('dev.defaultsMismatch')
      matchActionsEl.appendChild(note)
    }
  }
  matchActionsEl.appendChild(leaveBtn)
  renderSyncList()

  const matchAddActionsEl = document.getElementById('match-add-actions')
  if (matchAddActionsEl) matchAddActionsEl.style.display = isHost ? '' : 'none'
  matchInviteRowEl.style.display = isHost ? '' : 'none'
  matchNotesEl.innerHTML = ''
  if (!isHost) {
    const note = document.createElement('div')
    note.className = 'match-note'
    note.textContent = msg.passwordRequired ? t('match.protected') : t('match.noPassword')
    matchNotesEl.appendChild(note)
    const note2 = document.createElement('div')
    note2.className = 'match-note'
    note2.textContent = t('match.hostOnly')
    matchNotesEl.appendChild(note2)
  }

  setMatchStatus('')
  renderMatchOptions(msg, isHost)
}

matchMapSelectEl.addEventListener('change', () => {
  if (!lobbyState || lobbyState.yourId !== lobbyState.hostId) return
  const entry = findMapEntry(matchMapSelectEl.value)
  if (!entry) return
  if (entry.kind === 'preset') {
    net?.updateRoom({ mapId: entry.id })
  } else {
    net?.updateRoom({ map: entryToMap(entry) })
  }
  setMatchStatus(t('match.mapChanging'))
})

matchCreditsEl.addEventListener('change', () => {
  if (!lobbyState || lobbyState.yourId !== lobbyState.hostId) return
  const value = Math.round(Number(matchCreditsEl.value))
  if (!Number.isFinite(value) || value < 100 || value > 100000) return
  net?.updateRoom({ settings: { startingCredits: value } })
  setMatchStatus(t('match.creditsUpdating'))
})

matchWinRuleEl.addEventListener('change', () => {
  if (!lobbyState || lobbyState.yourId !== lobbyState.hostId) return
  const rule = matchWinRuleEl.value as WinRule
  net?.updateRoom({ winRule: rule })
  setMatchStatus(t('match.winChanging', { n: t(`offline.win.${WIN_RULE_KEYS[rule]}`) }))
})

matchFogEl.addEventListener('change', () => {
  if (!lobbyState || lobbyState.yourId !== lobbyState.hostId) return
  const v = matchFogEl.value as FogMode
  if (!(FOG_MODES as readonly string[]).includes(v)) return
  net?.updateRoom({ settings: { fogMode: v } })
  setMatchStatus(t('match.fogChanging', { n: t(`offline.fog.${v}`) }))
})

matchDayNightEl.addEventListener('change', () => {
  if (!lobbyState || lobbyState.yourId !== lobbyState.hostId) return
  net?.updateRoom({ settings: { dayNight: matchDayNightEl.checked } })
  setMatchStatus(matchDayNightEl.checked ? t('match.dayNightOn') : t('match.dayNightOff'))
})

const coopSelect = (el: HTMLSelectElement, key: string, kind: string): void => {
  el.addEventListener('change', () => {
    if (!lobbyState || lobbyState.yourId !== lobbyState.hostId) return
    const v = el.value
    const options = kind === 'economy' ? COOP_ECONOMY_OPTIONS : kind === 'rank' ? COOP_RANK_OPTIONS : COOP_CONTROL_OPTIONS
    if (!(options as readonly string[]).includes(v)) return
    net?.updateRoom({ settings: { [key]: v } })
  })
}
coopSelect(matchCoopEconomyEl, 'coopEconomy', 'economy')
coopSelect(matchCoopRankEl, 'coopRank', 'rank')
coopSelect(matchCoopControlEl, 'coopControl', 'control')

matchAddBotEl.addEventListener('click', () => {
  if (!lobbyState || lobbyState.yourId !== lobbyState.hostId) return
  const d = matchBotDiffEl.value as BotDifficulty
  net?.addBot(d)
  setMatchStatus(t('match.addingBot', { d: t(`difficulty.${d}`) }))
})

matchPassBtnEl.addEventListener('click', () => {
  if (!lobbyState || lobbyState.yourId !== lobbyState.hostId) return
  net?.updateRoom({ password: matchPassInputEl.value })
  matchPassInputEl.value = ''
  setMatchStatus(lobbyState.passwordRequired ? t('match.passChanging') : t('match.passSetting'))
})

const setNetStatus = (text: string, isError = false): void => {
  netStatusEl.textContent = text
  netStatusEl.classList.toggle('error', isError)
}

const SAVED_NAME = localStorage.getItem('space-arenas:name') ?? 'Commander'
netNameEl.value = SAVED_NAME
void fetch('/api/self', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name: SAVED_NAME }),
}).catch(() => undefined)

let nameTimer: number | null = null
netNameEl.addEventListener('input', () => {
  if (nameTimer !== null) clearTimeout(nameTimer)
  nameTimer = window.setTimeout(() => {
    const name = netNameEl.value.trim() || 'Commander'
    onlineNameEl.value = name
    localStorage.setItem('space-arenas:name', name)
    void fetch('/api/self', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    }).catch(() => undefined)
  }, 400)
})

/** Called when the profile username is saved: mirrors it into the online name field + storage. */
function applyProfileName(name: string): void {
  netNameEl.value = name
  onlineNameEl.value = name
  localStorage.setItem('space-arenas:name', name)
  void fetch('/api/self', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  }).catch(() => undefined)
}

let selectedMatch: NetPlayer | null = null
const knownChat = new Set<string>()

let joinBusy = false

const setJoinBusy = (busy: boolean): void => {
  joinBusy = busy
  netJoinBtn.disabled = busy
  netJoinBtn.textContent = busy ? t('network.status.joining') : t('network.join')
  for (const b of netMatchesEl.querySelectorAll<HTMLButtonElement>('button')) {
    if (busy) {
      if (b.dataset.restoreLabel === undefined) b.dataset.restoreLabel = b.textContent ?? ''
      b.textContent = t('network.status.joining')
    } else {
      if (b.dataset.restoreLabel !== undefined) {
        b.textContent = b.dataset.restoreLabel
        delete b.dataset.restoreLabel
      }
    }
    b.disabled = busy
  }
}

// ---------- dev settings sync (embedded in the lan match panel) ----------

const syncPanelEl = document.getElementById('sync-panel') as HTMLElement
const syncPlayersEl = document.getElementById('sync-players') as HTMLDivElement
const syncOnceBtn = document.getElementById('sync-once') as HTMLButtonElement
const syncCopyBtn = document.getElementById('sync-copy') as HTMLButtonElement

let devPublishedConn = false
let syncSelectedId: number | null = null

const cloneDevSettingsFrom = (their: Partial<MatchSettings>, client: ClientDevSettings | undefined, save: boolean): void => {
  devOverrides = JSON.parse(JSON.stringify(their)) as Partial<MatchSettings>
  // Clone the peer's non-synced values too, sanitizing path overrides against OUR
  // origin so a foreign-absolute URL from their machine can never load here.
  if (client !== undefined) {
    applyClientDevSettings(sanitizeClientDevSettings(client, window.location.origin), true)
  }
  buildDevForm()
  if (save) saveDevOverrides()
  if (net?.connected && lobbyState) {
    net.publishDevSettings(resolvedDevSettings(), settingsDefaultsHash(), wireClientDevSettings())
    if (lobbyState.yourId === lobbyState.hostId) net.updateRoom({ settings: resolvedDevSettings() })
  }
  setDevStatus(t(save ? 'dev.status.saved' : 'dev.status.syncedOnce'))
  renderSyncList()
}

/** Adopt the host's broadcast defaults (`LobbyMessage.defaults`) as ours, so our
 *  `settingsDefaultsHash()` matches and the base-defaults start gate clears. The
 *  host's client-only block (`defaultsClient`) is adopted too. */
const adoptHostDefaults = (): void => {
  const layers = (lobbyState?.defaults ?? {}) as Partial<MatchSettings>
  savedDefaults = JSON.parse(JSON.stringify(layers)) as Partial<MatchSettings>
  try {
    localStorage.setItem(DEV_DEFAULTS_KEY, JSON.stringify(savedDefaults))
  } catch {
    /* storage unavailable */
  }
  const incoming = lobbyState?.defaultsClient
  const client = incoming ? (sanitizeClientDevSettings(incoming, window.location.origin) as ClientDevSettings) : undefined
  if (client) applyClientDevSettings(client, true)
  const file: MatchSettingsFile = { v: 1 }
  if (settingsFile.builtin) file.builtin = settingsFile.builtin
  if (client) {
    file.client = client
    try {
      localStorage.setItem(DEV_CLIENT_KEY, JSON.stringify(client))
    } catch {
      /* storage unavailable */
    }
  }
  file.user = savedDefaults
  settingsFile = file
  void saveSettingsFile(file)
  buildDevForm()
  pushDevSettingsToHost()
  setDevStatus(t('dev.status.defaultsSynced'))
  if (lobbyState) renderMatchPanel(lobbyState)
}

const renderSyncList = (): void => {
  if (!lobbyState || !syncPanelEl) return
  const myFp = syncFingerprint(resolvedDevSettings(), wireClientDevSettings())
  const matchFp = settingsFingerprint(mergeMatchSettings(lobbyState.settings ?? {}))
  syncPlayersEl.innerHTML = ''
  let selectable = 0
  for (const p of lobbyState.players) {
    if (p.bot) continue
    const isMe = p.id === lobbyState.yourId
    const their = p.devSettings !== undefined ? mergeMatchSettings(p.devSettings) : null
    const same = isMe || (their !== null && syncFingerprint(their, p.clientSettings) === myFp)
    const matchSame = their !== null && settingsFingerprint(their) === matchFp

    const row = document.createElement('div')
    row.className = `sync-row ${same ? 'same' : 'diff'}`

    if (!isMe && their !== null) {
      selectable++
      const cbWrap = document.createElement('label')
      const cb = document.createElement('input')
      cb.type = 'checkbox'
      cb.checked = syncSelectedId === p.id
      cb.addEventListener('change', () => {
        syncSelectedId = cb.checked ? p.id : null
        renderSyncList()
      })
      cbWrap.appendChild(cb)
      const nameSpan = document.createElement('span')
      nameSpan.textContent = p.host ? `${p.name} (${t('sync.hostTag')})` : p.name
      cbWrap.appendChild(nameSpan)
      row.appendChild(cbWrap)

      const status = document.createElement('span')
      status.className = `sync-status ${same ? 'ok' : 'bad'}`
      status.textContent = same ? t('sync.sameAsYou') : t('sync.diffFromYou')
      row.appendChild(status)

      const mChip = document.createElement('span')
      mChip.className = 'sync-status'
      mChip.style.background = matchSame ? '#14301c' : '#1a2030'
      mChip.style.color = matchSame ? '#7cf27c' : '#8fa3c8'
      mChip.textContent = matchSame ? t('sync.matchSame') : t('sync.matchDiff')
      row.appendChild(mChip)
    } else {
      const who = document.createElement('span')
      who.style.fontSize = '12px'
      who.style.color = '#dfe6f2'
      who.textContent = isMe ? `${p.name} (${t('sync.youTag')}${p.host ? `, ${t('sync.hostTag')}` : ''})` : `${p.name} (${t('sync.noSettingsTag')})`
      row.appendChild(who)

      if (!isMe) {
        const status = document.createElement('span')
        status.className = 'sync-status'
        status.style.background = '#1a2030'
        status.style.color = '#8fa3c8'
        status.textContent = t('sync.diffFromYou')
        row.appendChild(status)
      }
    }
    syncPlayersEl.appendChild(row)
  }
  const sel = syncSelectedId !== null ? lobbyState.players.find((p) => p.id === syncSelectedId && p.devSettings !== undefined) : undefined
  syncOnceBtn.disabled = !sel
  syncCopyBtn.disabled = !sel
  syncOnceBtn.onclick = () => {
    if (sel?.devSettings) cloneDevSettingsFrom(sel.devSettings, sel.clientSettings, false)
  }
  syncCopyBtn.onclick = () => {
    if (sel?.devSettings) cloneDevSettingsFrom(sel.devSettings, sel.clientSettings, true)
  }
  void selectable
}

// ---------- replay auto-save toggle (LAN + online match panel; default off) ----------

const AUTO_REPLAY_KEY = 'space-arenas:auto-replay'
const replayAutoSaveEl = document.getElementById('replay-auto-save') as HTMLInputElement
try {
  replayAutoSaveEl.checked = localStorage.getItem(AUTO_REPLAY_KEY) === '1'
} catch {
  replayAutoSaveEl.checked = false
}
replayAutoSaveEl.addEventListener('change', () => {
  try {
    localStorage.setItem(AUTO_REPLAY_KEY, replayAutoSaveEl.checked ? '1' : '0')
  } catch {
    /* storage unavailable */
  }
})

const connectJoin = async (addr: string, code: string, pass: string, name: string, fromInviteLink = false, opts?: { spectator?: boolean }): Promise<void> => {
  if (!code) {
    setNetStatus(t('network.status.needCode'), true)
    return
  }
  lastJoin = { addr, code, pass, name }
  setJoinBusy(true)
  setNetStatus(t('network.status.connecting'))
  net = new NetClient({
    onLobby: (msg) => {
      setJoinBusy(false)
      localTeam = msg.yourId
      logNetEvent(t('network.diagEventJoined', { code: msg.roomCode }))
      if (!devPublishedConn) {
        devPublishedConn = true
        net?.publishDevSettings(resolvedDevSettings(), settingsDefaultsHash(), wireClientDevSettings())
      }
      renderMatchPanel(msg)
      setTab('match')
    },
    onMatchStart: (msg: MatchStartMessage) => {
      lobbyAudio.stopAmbient()
      logNetEvent(t('network.diagEventMatchStart'))
      if (!game) game = makeGame()
      hideLobby()
      netJoinedResumed = (msg as { resumed?: boolean }).resumed === true
      void game.startNet(net!, msg, netTrackingOpts())
      saveActiveMatch()
      startPing()
    },
    onSpectateSync: (msg) => {
      if (netJoinedResumed) game?.catchUpSync(msg)
      else game?.applySpectateSync(msg)
    },
    onSettingsAlert: (msg) => handleSettingsAlert(msg),
    onPong: () => {
      const start = netPingStart
      if (start > 0) {
        netPingStart = 0
        lastPingMs = Math.max(1, Math.round(performance.now() - start))
        game?.setPingMs(lastPingMs)
      }
    },
    onFrame: (tick, commands) => game?.applyFrame(tick, commands),
    onRelayChecksum: (player, tick, crc) => game?.onNetChecksum(player, tick, crc),
    onChecksum: () => undefined,
    onChat: (msg) => game?.onNetChat(msg),
    onGameOver: (winner) => {
      game?.onNetGameOver(winner)
      clearActiveMatch()
      if (!game) netStatusEl.textContent = winner !== null && winner === localTeam ? t('menu.victory') : t('menu.defeat')
    },
    onError: (message) => {
      if (fromInviteLink && /room not found/i.test(message)) {
        // The room behind this invite link is gone. Say so before dropping the code —
        // redirecting straight away dropped the player on the default panel with no
        // hint that the join had been refused.
        lobbyToast(t('lobby.inviteGone'), true)
        window.setTimeout(() => {
          window.location.href = window.location.origin + window.location.pathname
        }, INVITE_GONE_REDIRECT_MS)
        return
      }
      if (lobbyState === null && /already started/i.test(message)) {
        // A running match has no free player seat — offer to watch it as a spectator.
        setJoinBusy(false)
        roomFullJoin = { addr, code, pass, name }
        roomfullOverlayEl.classList.add('visible')
        return
      }
      if (lobbyState === null && /client id in use by another active connection/i.test(message)) {
        // The server refused this clientId because another device is using it actively.
        // Regenerate a new clientId for this device and retry the join once.
        try {
          localStorage.removeItem('space-arenas:clientId')
        } catch {}
        setJoinBusy(false)
        const retry = (window as unknown as { __saJoinRetry?: number }).__saJoinRetry ?? 0
        if (retry < 1) {
          ;(window as unknown as { __saJoinRetry?: number }).__saJoinRetry = retry + 1
          void connectJoin(addr, code, pass, name, fromInviteLink, opts)
          return
        }
        ;(window as unknown as { __saJoinRetry?: number }).__saJoinRetry = 0
        lobbyToast(t('game.error', { msg: message }), true)
        return
      }
      if (isOnlineAddr(addr) && /^(unauthorized|invalid session|auth-unavailable)$/i.test(message.trim())) {
        // The server refused our C_JOIN for an auth reason. Drop the dead session so the
        // next attempt starts clean, then point the player at the right place.
        setJoinBusy(false)
        const unavailable = /auth-unavailable/i.test(message)
        lobbyToast(authErrorText(unavailable ? 503 : 401, message.trim()), true)
        if (!unavailable) saveAuth(null)
        if (!unavailable) openAccountPopup()
        return
      }
      setJoinBusy(false)
      if (lobbyState) setMatchStatus(t('game.error', { msg: message }), true)
      else if (isOnlineAddr(lastJoin?.addr)) setOnlineStatus(t('game.error', { msg: message }), true)
      else setNetStatus(t('game.error', { msg: message }), true)
      // An invite auto-join never switches to the network tab, so the status line it
      // just wrote to is off-screen. Repeat it where the player is actually looking.
      if (fromInviteLink) lobbyToast(t('game.error', { msg: message }), true)
    },
    onClose: () => {
      if (game) {
        if (reconnectPhase === 'off') beginReconnect()
        return
      }
      clearActiveMatch()
      setJoinBusy(false)
      logNetEvent(t('network.diagEventDisconnected'))
      if (lobbyState) {
        const wasOnline = isOnlineAddr(lastJoin?.addr)
        lobbyState = null
        devPushedToRoom = false
        devPublishedConn = false
        syncSelectedId = null
        if (wasOnline) {
          setTab('online')
          setOnlineStatus(t('network.status.disconnectedMatch'))
          void refreshOnlineList(true)
        } else {
          setTab('network')
          setNetStatus(t('network.status.disconnectedMatch'))
        }
        return
      }
      if (!networkPanel.classList.contains('hidden-panel')) setNetStatus(t('network.status.disconnected'))
    },
    onOpen: () => undefined,
  })

  try {
    const base = addr.replace(/\/+$/, '')
    const connectUrl = /^wss?:\/\//i.test(base) ? `${base}/ws` : `ws://${base}/ws`
    await net.connect(connectUrl)
  } catch {
    setJoinBusy(false)
    if (isOnlineAddr(lastJoin?.addr)) {
      setOnlineStatus(t('network.status.serverUnreachable'), true)
    } else {
      setNetStatus(t('network.status.serverUnreachable'), true)
      openRelayFallback({ addr, code, pass, name })
    }
    return
  }
  setNetStatus(t('network.status.joining'))
  if (isOnlineAddr(lastJoin?.addr)) await net.join(code, pass, name, opts?.spectator === true, authToken())
  else await net.join(code, pass, name, opts?.spectator === true)
}

// ---------- room-full popup (join a running match with no free seat) ----------

// ---------- online match ping (C_PING/H_PONG round-trip, shown next to FPS) ----------

let netPingTimer: number | null = null
let netPingStart = 0
let lastPingMs: number | null = null

const startPing = (): void => {
  if (netPingTimer !== null) return
  lastPingMs = 0
  game?.setPingMs(0)
  netPingTimer = window.setInterval(() => {
    netPingStart = performance.now()
    net?.send({ kind: 'C_PING' })
  }, 2000)
}

const stopPing = (): void => {
  if (netPingTimer !== null) {
    window.clearInterval(netPingTimer)
    netPingTimer = null
  }
  netPingStart = 0
  lastPingMs = null
  game?.setPingMs(null)
}

const roomfullOverlayEl = document.getElementById('roomfull-overlay') as HTMLDivElement
const roomfullBackBtn = document.getElementById('roomfull-back') as HTMLButtonElement
const roomfullSpectateBtn = document.getElementById('roomfull-spectate') as HTMLButtonElement
let roomFullJoin: { addr: string; code: string; pass: string; name: string } | null = null

roomfullBackBtn.addEventListener('click', () => {
  roomfullOverlayEl.classList.remove('visible')
  if (roomFullJoin && isOnlineAddr(roomFullJoin.addr)) setOnlineStatus(t('network.status.needCode'), true)
  else setNetStatus(t('network.status.needCode'), true)
  roomFullJoin = null
})
roomfullSpectateBtn.addEventListener('click', () => {
  const join = roomFullJoin
  // Watching takes a slot server-side, so it needs an account. Only online rooms are gated;
  // a LAN host that is already running a match may still be watched by anyone on the LAN.
  if (join && isOnlineAddr(join.addr) && !requireLogin('spectate')) return
  roomfullOverlayEl.classList.remove('visible')
  roomFullJoin = null
  if (join) void connectJoin(join.addr, join.code, join.pass, join.name, false, { spectator: true })
})

// ---------- mid-match settings-tamper alerts (online anti-cheat) ----------

const tamperOverlayEl = document.getElementById('tamper-overlay') as HTMLDivElement
const tamperTitleEl = document.getElementById('tamper-title') as HTMLHeadingElement
const tamperBodyEl = document.getElementById('tamper-body') as HTMLParagraphElement
const tamperActionsEl = document.getElementById('tamper-actions') as HTMLDivElement

const handleSettingsAlert = (msg: SettingsAlertMessage): void => {
  const isHost = lobbyState !== null && lobbyState.yourId === lobbyState.hostId
  tamperTitleEl.textContent = t('network.tamperTitle')
  tamperBodyEl.textContent = isHost
    ? t('network.tamperHostBody', { player: msg.offender })
    : t('network.tamperOffenderBody')
  tamperActionsEl.replaceChildren()
  if (isHost && msg.offenderId !== localTeam) {
    for (const [action, key] of [
      ['kick', 'network.tamperKick'],
      ['skip', 'network.tamperSkip'],
    ] as const) {
      const btn = document.createElement('button')
      btn.textContent = t(key)
      if (action === 'kick') btn.className = 'danger'
      btn.addEventListener('click', () => {
        net?.settingsVerdict(msg.offenderId, action)
        tamperOverlayEl.classList.remove('visible')
      })
      tamperActionsEl.appendChild(btn)
    }
  } else {
    const ok = document.createElement('button')
    ok.textContent = t('network.tamperOk')
    ok.classList.add('primary')
    ok.addEventListener('click', () => tamperOverlayEl.classList.remove('visible'))
    tamperActionsEl.appendChild(ok)
  }
  tamperOverlayEl.classList.add('visible')
}

// ---------- resume prompt (offer to rejoin a running match after a tab reload) ----------

const ACTIVE_MATCH_KEY = 'space-arenas:active-match'
interface ActiveMatch {
  addr: string
  code: string
  pass: string
  name: string
  ts: number
}

const saveActiveMatch = (): void => {
  if (!lastJoin) return
  try {
    localStorage.setItem(ACTIVE_MATCH_KEY, JSON.stringify({ ...lastJoin, ts: Date.now() } as ActiveMatch))
  } catch {
    /* storage unavailable */
  }
}

const readActiveMatch = (): ActiveMatch | null => {
  try {
    const raw = localStorage.getItem(ACTIVE_MATCH_KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as Partial<ActiveMatch>
    if (typeof data.addr !== 'string' || typeof data.code !== 'string' || typeof data.name !== 'string') return null
    return { addr: data.addr, code: data.code, pass: typeof data.pass === 'string' ? data.pass : '', name: data.name, ts: data.ts ?? 0 }
  } catch {
    return null
  }
}

const clearActiveMatch = (): void => {
  try {
    localStorage.removeItem(ACTIVE_MATCH_KEY)
  } catch {
    /* storage unavailable */
  }
}

const resumeOverlayEl = document.getElementById('resume-overlay') as HTMLDivElement
const resumeYesBtn = document.getElementById('resume-yes') as HTMLButtonElement
const resumeNoBtn = document.getElementById('resume-no') as HTMLButtonElement
let pendingResume: ActiveMatch | null = null

resumeYesBtn.addEventListener('click', () => {
  const join = pendingResume
  resumeOverlayEl.classList.remove('visible')
  pendingResume = null
  if (join) void connectJoin(join.addr, join.code, join.pass, join.name)
})
resumeNoBtn.addEventListener('click', () => {
  resumeOverlayEl.classList.remove('visible')
  pendingResume = null
  clearActiveMatch()
})

// ---------- online-relay fallback (non-automatic; the player chooses) ----------

const relayFallbackOverlayEl = document.getElementById('relay-fallback-overlay') as HTMLDivElement
const relayFallbackStatusEl = document.getElementById('relay-fallback-status') as HTMLDivElement
const fallbackOnlineBtn = document.getElementById('fallback-online') as HTMLButtonElement
const fallbackLanBtn = document.getElementById('fallback-lan') as HTMLButtonElement

let selfHostDevice = false
let pendingFallbackJoin: { addr: string; code: string; pass: string; name: string } | null = null

/** Non-automatic fallback offer: shown only when a LAN join genuinely cannot reach the host.
 *  The player decides — nothing ever switches networks on its own. */
const openRelayFallback = (join: { addr: string; code: string; pass: string; name: string }): void => {
  pendingFallbackJoin = join
  relayFallbackStatusEl.textContent = ''
  logNetEvent(t('network.diagEventFallback'))
  relayFallbackOverlayEl.classList.add('visible')
}

const closeRelayFallback = (): void => {
  relayFallbackOverlayEl.classList.remove('visible')
  pendingFallbackJoin = null
}

/** Host: creates an online mirror of the LAN room and joins it. Guest: routes to the online
 *  tab, where the host's new room will be listed. Either way this needs internet. */
const switchToOnlineRelay = async (): Promise<void> => {
  const join = pendingFallbackJoin
  closeRelayFallback()
  if (!join) return
  net?.close()
  net = null
  logNetEvent(t('network.diagEventSwitchedOnline'))
  setTab('online')
  if (!selfHostDevice) {
    // A guest cannot reach the LAN host, so it cannot receive a code from it. The online
    // server lists rooms, so the host's replacement room appears there.
    lobbyToast(t('network.fallbackGuestHint'), false)
    return
  }
  const token = authToken()
  if (token === undefined) {
    setOnlineStatus(t('online.signInTo.create'), true)
    openAccountPopup()
    return
  }
  try {
    const res = await fetch(`${ONLINE_URL}/api/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ hostName: join.name, passphrase: join.pass }),
    })
    const data = (await res.json()) as { ok: boolean; roomCode?: string; error?: string }
    if (!res.ok || !data.ok || !data.roomCode) {
      const msg = res.status === 401 || res.status === 503 ? authErrorText(res.status, data.error) : data.error ?? t('network.status.createFailed')
      setOnlineStatus(t('game.error', { msg }), true)
      if (res.status === 401) {
        saveAuth(null)
        openAccountPopup()
      }
      return
    }
    setOnlineStatus(t('network.status.created', { code: data.roomCode }))
    void connectJoin(ONLINE_WS_BASE, data.roomCode, join.pass, join.name)
  } catch {
    setOnlineStatus(t('network.fallbackNoInternet'), true)
  }
}

fallbackOnlineBtn.addEventListener('click', () => void switchToOnlineRelay())
fallbackLanBtn.addEventListener('click', () => closeRelayFallback())

// ---------- in-game auto-reconnect (Day 18) ----------

const reconnectOverlayEl = document.getElementById('reconnect-overlay') as HTMLDivElement
const reconnectLabelEl = document.getElementById('reconnect-label') as HTMLDivElement
let lastJoin: { addr: string; code: string; pass: string; name: string } | null = null
let netJoinedResumed = false
let reconnectPhase: 'off' | 'player' | 'spectator' = 'off'
let reconnectTimer: number | null = null
let reconnectAttempts = 0
let reconnectBusy = false
let attemptToken = 0
const RECONNECT_RETRY_MS = 1500
const RECONNECT_MAX_ATTEMPTS = 7

const setReconnecting = (on: boolean, spectator = false): void => {
  if (!reconnectOverlayEl || !reconnectLabelEl) return
  reconnectOverlayEl.classList.toggle('visible', on)
  if (on) reconnectLabelEl.textContent = t(spectator ? 'network.status.spectating' : 'network.status.reconnecting')
}

/** Kicks off the reconnect attempt when a live match's socket drops unexpectedly. */
const beginReconnect = (): void => {
  if (reconnectPhase !== 'off' || !lastJoin || !game) {
    game?.destroy()
    game = null
    showLobby()
    if (isOnlineAddr(lastJoin?.addr)) {
      setTab('online')
      setOnlineStatus(t('network.status.lost'), true)
    } else {
      setTab('network')
      setNetStatus(t('network.status.lost'), true)
    }
    return
  }
  net?.close()
  net = null
  reconnectPhase = 'player'
  reconnectAttempts = 0
  logNetEvent(t('network.diagEventReconnecting'))
  setReconnecting(true)
  void attemptReconnect()
}

const attemptReconnect = async (): Promise<void> => {
  if (reconnectPhase === 'off' || !lastJoin || !game) return
  if (reconnectBusy) return
  reconnectBusy = true
  const join = lastJoin
  const spectator = reconnectPhase === 'spectator'
  attemptToken++
  const tok = attemptToken
  try {
    const n = new NetClient({
      onLobby: () => {
        if (tok !== attemptToken || reconnectPhase !== 'player' || !game) return
        // Host re-claimed our slot; the S_SPECTATE_SYNC that follows catches us up.
        finishReconnect()
      },
      onMatchStart: (msg) => {
        if (tok !== attemptToken || reconnectPhase !== 'spectator') return
        // Spectator fallback accepted — reboot into a fresh spectator game.
        game?.destroy()
        game = makeGame()
        hideLobby()
        void game.startNet(n, msg, netTrackingOpts())
        if (isOnlineAddr(join.addr)) startPing()
        finishReconnect()
      },
      onSpectateSync: (msg) => {
        if (tok !== attemptToken || !game) return
        if (reconnectPhase !== 'off') {
          game.catchUpSync(msg)
          if (reconnectPhase === 'player') finishReconnect()
        } else {
          game.applySpectateSync(msg)
        }
      },
      onSettingsAlert: (msg) => handleSettingsAlert(msg),
      onFrame: (tick, commands) => game?.applyFrame(tick, commands),
      onRelayChecksum: (player, tick, crc) => game?.onNetChecksum(player, tick, crc),
      onChecksum: () => undefined,
      onChat: (msg) => game?.onNetChat(msg),
      onGameOver: (winner) => {
        if (tok !== attemptToken) return
        game?.onNetGameOver(winner)
        clearActiveMatch()
        if (!game) netStatusEl.textContent = winner !== null && winner === localTeam ? t('menu.victory') : t('menu.defeat')
      },
      onError: (message) => {
        if (tok !== attemptToken) return
        if (/client id in use by another active connection/i.test(message)) {
          try {
            localStorage.removeItem('space-arenas:clientId')
          } catch {}
          n.close()
          reconnectBusy = false
          retryReconnect()
          return
        }
        if (isOnlineAddr(join.addr) && /^(unauthorized|invalid session|auth-unavailable)$/i.test(message.trim())) {
          // Retrying an auth refusal just burns attempts: tell the player why instead.
          if (!/auth-unavailable/i.test(message)) {
            saveAuth(null)
            lobbyToast(t('online.sessionExpired'), true)
            openAccountPopup()
          } else {
            lobbyToast(t('online.authUnavailable'), true)
          }
          reconnectGiveUp(message)
          return
        }
        if (reconnectPhase === 'player') {
          // Player slot lost — fall back to watching the running match as a spectator.
          n.close()
          reconnectPhase = 'spectator'
          reconnectAttempts = 0
          reconnectBusy = false
          setReconnecting(true, true)
          void attemptReconnect()
        } else {
          reconnectGiveUp(message)
        }
      },
      onClose: () => {
        if (tok !== attemptToken) return
        retryReconnect()
      },
      onOpen: () => undefined,
    })
    net = n
    game.attachNet(n)
    await n.connect(`ws://${join.addr}/ws`)
    // Online reconnects carry the token too: the server now verifies C_JOIN before it will
    // hand a slot back, so a reconnect without it would be refused as unauthenticated.
    if (isOnlineAddr(join.addr)) await n.join(join.code, join.pass, join.name, spectator, authToken())
    else await n.join(join.code, join.pass, join.name, spectator)
  } catch {
    retryReconnect()
  } finally {
    reconnectBusy = false
  }
}

const retryReconnect = (): void => {
  if (reconnectPhase === 'off') return
  if (reconnectTimer !== null) return
  if (reconnectPhase === 'player' && reconnectAttempts < RECONNECT_MAX_ATTEMPTS) {
    reconnectAttempts++
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null
      void attemptReconnect()
    }, RECONNECT_RETRY_MS)
    return
  }
  if (reconnectPhase === 'player') {
    // Player slot unreachable within the window — auto-spectate the running match.
    reconnectPhase = 'spectator'
    reconnectAttempts = 0
    setReconnecting(true, true)
    void attemptReconnect()
    return
  }
  reconnectGiveUp()
}

const finishReconnect = (): void => {
  if (reconnectPhase === 'off') return
  reconnectPhase = 'off'
  if (reconnectTimer !== null) {
    window.clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  reconnectAttempts = 0
  reconnectBusy = false
  setReconnecting(false)
}

const reconnectGiveUp = (message = ''): void => {
  if (reconnectPhase === 'off') return
  reconnectPhase = 'off'
  logNetEvent(t('network.diagEventGaveUp'))
  if (reconnectTimer !== null) {
    window.clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  reconnectBusy = false
  setReconnecting(false)
  net?.close()
  net = null
  game?.destroy()
  game = null
  stopPing()
  clearActiveMatch()
  showLobby()
  if (isOnlineAddr(lastJoin?.addr)) {
    setTab('online')
    setOnlineStatus(message ? t('game.error', { msg: message }) : t('network.status.lost'), true)
  } else {
    setTab('network')
    setNetStatus(message ? t('game.error', { msg: message }) : t('network.status.lost'))
  }
}

// ---------- network diagnostics panel (C1) ----------

const diagOverlayEl = document.getElementById('diag-overlay') as HTMLDivElement
const diagContentEl = document.getElementById('diag-content') as HTMLPreElement
const netDiagBtn = document.getElementById('net-diag-btn') as HTMLButtonElement
const diagCloseBtn = document.getElementById('diag-close') as HTMLButtonElement

interface NetworkSnapshot {
  self: NetPlayer
  players: NetPlayer[]
  chat: Array<{ from: string; text: string; ts: number }>
}
let lastNetworkData: NetworkSnapshot | null = null
let knownPeerKeys = ''

const netEvents: string[] = []
const logNetEvent = (text: string): void => {
  const d = new Date()
  const stamp = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
  netEvents.push(`[${stamp}] ${text}`)
  if (netEvents.length > 20) netEvents.shift()
  if (diagOverlayEl.classList.contains('visible')) renderDiagnostics()
}

const wsStateText = (): string => {
  if (!net) return t('network.diagIdle')
  if (game) return t('network.diagInMatch')
  if (lobbyState) return t('network.diagInLobby')
  return t('network.diagConnected')
}

const renderDiagnostics = (): void => {
  const lines: string[] = []
  const self = lastNetworkData?.self
  lines.push(t('network.diagSelf'))
  lines.push(`  name: ${netNameEl.value || 'Commander'}`)
  lines.push(`  address: ${self ? `${self.ip}:${self.port}` : netAddrEl.value || '(detecting)'}`)
  lines.push(`  mode: ${selfHostDevice ? t('network.diagHostDevice') : t('network.diagGuest')}`)
  if (lobbyState) lines.push(`  room: ${lobbyState.roomCode}  players: ${lobbyState.players.length}/${lobbyState.maxPlayers}`)
  lines.push(t('network.diagConnection'))
  lines.push(`  websocket: ${wsStateText()}`)
  lines.push(`  rtt: ${lastPingMs !== null ? `${lastPingMs} ms` : 'n/a'}`)
  lines.push(`  status: ${netStatusEl.textContent || '-'}`)
  const peers = (lastNetworkData?.players ?? []).filter((p) => !(p.ip === self?.ip && p.port === self?.port))
  lines.push(t('network.diagDiscovery'))
  lines.push(`  peers: ${peers.length}`)
  for (const p of peers) {
    const seen = typeof p.lastSeenMs === 'number' ? ` last-seen=${Math.round(p.lastSeenMs / 1000)}s` : ''
    const state = p.started ? t('network.inMatch') : t('network.inLobby')
    lines.push(`  - ${p.name} @ ${p.ip}:${p.port} room=${p.roomCode ?? '-'} ${state}${seen}`)
  }
  lines.push(t('network.diagEvents'))
  if (netEvents.length === 0) lines.push(`  ${t('network.diagNone')}`)
  else for (const e of netEvents) lines.push(`  ${e}`)
  lines.push('')
  lines.push(t('network.diagShortcut'))
  diagContentEl.textContent = lines.join('\n')
}

const openDiag = (): void => {
  renderDiagnostics()
  diagOverlayEl.classList.add('visible')
}
const closeDiag = (): void => {
  diagOverlayEl.classList.remove('visible')
}
netDiagBtn.addEventListener('click', openDiag)
diagCloseBtn.addEventListener('click', closeDiag)
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
    e.preventDefault()
    if (diagOverlayEl.classList.contains('visible')) closeDiag()
    else openDiag()
  }
})

const joinSelectedOrManual = (): void => {
  const name = netNameEl.value.trim() || 'Commander'
  if (selectedMatch) {
    const pass = netPassEl.value
    if (selectedMatch.passwordRequired && !pass) {
      setNetStatus(t('network.status.needsPassword'), true)
      return
    }
    void connectJoin(`${selectedMatch.ip}:${selectedMatch.port}`, selectedMatch.roomCode ?? '', pass, name)
    return
  }
  const addr = (netAddrManualEl.value || netAddrEl.value || 'localhost:17321').trim()
  const code = netCodeEl.value.trim().toUpperCase()
  void connectJoin(addr, code, netPassEl.value, name)
}

netJoinBtn.addEventListener('click', joinSelectedOrManual)

const renderNetPlayers = (players: NetPlayer[], self: NetPlayer): void => {
  netPlayersEl.innerHTML = ''
  if (players.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'net-empty'
    empty.textContent = t('network.noPlayers')
    netPlayersEl.appendChild(empty)
    return
  }
  for (const p of players) {
    const row = document.createElement('div')
    row.className = 'net-item'
    const who = document.createElement('span')
    who.className = 'who'
    who.textContent = p.name === self.name ? `${p.name}${t('network.youSuffix')}` : p.name
    const ip = document.createElement('span')
    ip.className = 'ip'
    ip.textContent = `${p.ip}:${p.port}`
    const status = document.createElement('span')
    status.className = `status${p.started ? ' in-match' : ''}`
    status.textContent = p.roomCode
      ? p.started
        ? t('network.inMatch')
        : t('network.waiting', { n: p.playerCount, m: p.maxPlayers })
      : t('network.inLobby')
    row.appendChild(who)
    row.appendChild(ip)
    row.appendChild(status)
    netPlayersEl.appendChild(row)
  }
}

const renderNetMatches = (all: NetPlayer[]): void => {
  netMatchesEl.innerHTML = ''
  const matches = all.filter((p) => p.roomCode)
  if (matches.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'net-empty'
    empty.textContent = t('network.noMatches')
    netMatchesEl.appendChild(empty)
    return
  }
  for (const m of matches) {
    const row = document.createElement('div')
    row.className = 'net-item'
    const who = document.createElement('span')
    who.className = 'who'
    who.textContent = m.name
    const ip = document.createElement('span')
    ip.className = 'ip'
    ip.textContent = `${m.ip}:${m.port}`
    const status = document.createElement('span')
    status.className = `status${m.started ? ' in-match' : ''}`
    status.textContent = m.started
      ? `${t('network.inMatch')} · ${m.playerCount}/${m.maxPlayers}${m.passwordRequired ? ' · 🔒' : ''}`
      : `${t('network.waiting', { n: m.playerCount, m: m.maxPlayers })}${m.passwordRequired ? ' · 🔒' : ''}`
    const actions = document.createElement('div')
    actions.className = 'net-actions'
    const makeJoinBtn = (): HTMLButtonElement => {
      const b = document.createElement('button')
      if (joinBusy) {
        b.disabled = true
        b.textContent = t('network.status.joining')
      }
      return b
    }
    if (m.started) {
      const rejoin = makeJoinBtn()
      rejoin.textContent = joinBusy ? t('network.status.joining') : t('network.rejoin')
      rejoin.classList.add('rejoin')
      rejoin.addEventListener('click', (e) => {
        e.stopPropagation()
        select()
        joinSelectedOrManual()
      })
      actions.appendChild(rejoin)
      const spec = makeJoinBtn()
      spec.textContent = joinBusy ? t('network.status.joining') : t('network.spectate')
      spec.classList.add('spec')
      spec.addEventListener('click', (e) => {
        e.stopPropagation()
        const pass = m.passwordRequired ? netPassEl.value : ''
        if (m.passwordRequired && !pass) {
          setNetStatus(t('network.status.needsPassword'), true)
          return
        }
        void connectJoin(`${m.ip}:${m.port}`, m.roomCode ?? '', pass, netNameEl.value.trim() || 'Commander', false, { spectator: true })
      })
      actions.appendChild(spec)
    } else {
      const join = makeJoinBtn()
      join.textContent = joinBusy ? t('network.status.joining') : t('network.join')
      join.addEventListener('click', (e) => {
        e.stopPropagation()
        select()
        joinSelectedOrManual()
      })
      actions.appendChild(join)
    }
    const select = (): void => {
      selectedMatch = m
      for (const s of netMatchesEl.querySelectorAll('.net-item')) s.classList.remove('selected')
      row.classList.add('selected')
      netAddrManualEl.value = `${m.ip}:${m.port}`
      netCodeEl.value = m.roomCode ?? ''
    }
    row.addEventListener('click', select)
    row.appendChild(who)
    row.appendChild(ip)
    row.appendChild(status)
    row.appendChild(actions)
    netMatchesEl.appendChild(row)
  }
}

const renderLobbyChat = (chat: Array<{ from: string; text: string; ts: number }>): void => {
  let changed = false
  for (const c of chat) {
    const key = `${c.from}\n${c.text}\n${c.ts}`
    if (knownChat.has(key)) continue
    knownChat.add(key)
    changed = true
    const line = document.createElement('div')
    line.className = 'chat-line'
    const who = document.createElement('span')
    who.className = 'who'
    who.textContent = c.from
    line.appendChild(who)
    line.appendChild(document.createTextNode(c.text))
    netChatHistoryEl.appendChild(line)
  }
  if (changed) {
    while (netChatHistoryEl.children.length > MAX_CHAT_LINES) {
      netChatHistoryEl.removeChild(netChatHistoryEl.firstChild!)
    }
    netChatHistoryEl.scrollTop = netChatHistoryEl.scrollHeight
  }
}

const sendLobbyChat = (): void => {
  const text = netChatInputEl.value.trim()
  if (!text) return
  netChatInputEl.value = ''
  const name = netNameEl.value.trim() || 'Commander'
  void fetch('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, from: name }),
  }).catch(() => undefined)
}

netChatSendBtn.addEventListener('click', sendLobbyChat)
netChatInputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendLobbyChat()
})

createCancelBtn.addEventListener('click', () => {
  createOverlay.classList.remove('visible')
  creatingOnline = false
})
netCreateBtn.addEventListener('click', () => {
  creatingOnline = false
  createAddrEl.value = netAddrEl.value || t('network.addrPlaceholder')
  createPassEl.value = ''
  createOverlay.classList.add('visible')
})
createOkBtn.addEventListener('click', async () => {
  if (creatingOnline) {
    const pass = createPassEl.value
    const name = onlineName()
    createOkBtn.disabled = true
    try {
      // The server enforces this too; sending the token keeps the two in step so a
      // signed-out player gets the friendly prompt instead of a raw 401.
      const token = authToken()
      if (token === undefined) {
        setOnlineStatus(t('online.signInTo.create'), true)
        createOkBtn.disabled = false
        openAccountPopup()
        return
      }
      const res = await fetch(`${ONLINE_URL}/api/rooms`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ hostName: name, passphrase: pass }),
      })
      const data = (await res.json()) as { ok: boolean; roomCode?: string; error?: string }
      if (!res.ok || !data.ok || !data.roomCode) {
        const msg = res.status === 401 || res.status === 503 ? authErrorText(res.status, data.error) : data.error ?? t('network.status.createFailed')
        setOnlineStatus(t('game.error', { msg }), true)
        lobbyToast(msg, true)
        if (res.status === 401) {
          saveAuth(null)
          openAccountPopup()
        }
        createOkBtn.disabled = false
        return
      }
      createOverlay.classList.remove('visible')
      createOkBtn.disabled = false
      creatingOnline = false
      setOnlineStatus(t('network.status.created', { code: data.roomCode }))
      void connectJoin(ONLINE_WS_BASE, data.roomCode, pass, name)
    } catch {
      setOnlineStatus(t('online.serverDown'), true)
      createOkBtn.disabled = false
    }
    return
  }
  const pass = createPassEl.value
  const name = netNameEl.value.trim() || 'Commander'
  createOkBtn.disabled = true
  setNetStatus(t('network.status.creating'))
  try {
    const res = await fetch('/api/create-room', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ passphrase: pass, name }),
    })
    const data = (await res.json()) as { ok: boolean; roomCode?: string; ip?: string; port?: number }
    if (!data.ok || !data.roomCode) {
      setNetStatus(t('network.status.createFailed'), true)
      createOkBtn.disabled = false
      return
    }
    createOverlay.classList.remove('visible')
    createOkBtn.disabled = false
    netCodeEl.value = data.roomCode
    netAddrManualEl.value = `${data.ip}:${data.port}`
    selectedMatch = null
    setNetStatus(t('network.status.created', { code: data.roomCode }))
    void connectJoin(`${data.ip}:${data.port}`, data.roomCode, pass, name)
  } catch {
    setNetStatus(t('network.status.hostUnreachable'), true)
    createOkBtn.disabled = false
  }
})

let currentInviteUrl = ''

const openInvite = async (): Promise<void> => {
  inviteOverlay.classList.add('visible')
  inviteQrImgEl.style.display = 'inline-block'
  inviteUrlEl.textContent = ''
  inviteStatusEl.textContent = ''
  currentInviteUrl = ''
  try {
    const res = await fetch('/api/invite-info')
    if (!res.ok) {
      inviteQrImgEl.style.display = 'none'
      inviteStatusEl.textContent = t('lobby.inviteNone')
      return
    }
    const data = (await res.json()) as { ok: boolean; url: string; code: string }
    currentInviteUrl = data.url
    inviteQrImgEl.src = `/api/invite-qr?t=${Date.now()}`
    inviteUrlEl.textContent = data.url
  } catch {
    inviteQrImgEl.style.display = 'none'
    inviteStatusEl.textContent = t('lobby.inviteNone')
  }
}

inviteQrImgEl.addEventListener('error', () => {
  inviteQrImgEl.style.display = 'none'
  inviteStatusEl.textContent = t('lobby.inviteNone')
})

const copyInviteLink = async (): Promise<void> => {
  if (!currentInviteUrl) {
    inviteStatusEl.textContent = t('lobby.inviteNone')
    return
  }
  try {
    await navigator.clipboard.writeText(currentInviteUrl)
    inviteStatusEl.textContent = t('lobby.inviteCopied')
  } catch {
    inviteStatusEl.textContent = t('lobby.inviteCopyFail')
  }
}

matchInviteBtn.addEventListener('click', () => void openInvite())
inviteCopyBtn.addEventListener('click', () => void copyInviteLink())
inviteCloseBtn.addEventListener('click', () => {
  inviteOverlay.classList.remove('visible')
})

const pollNetwork = async (): Promise<void> => {
  try {
    const res = await fetch('/api/network')
    if (!res.ok) return
    const data = (await res.json()) as { self: NetPlayer; players: NetPlayer[]; chat: Array<{ from: string; text: string; ts: number }> }
    lastNetworkData = data
    if (!netAddrEl.value) netAddrEl.value = `${data.self.ip}:${data.self.port}`
    if (!netAddrManualEl.value) netAddrManualEl.value = `${data.self.ip}:${data.self.port}`
    const hostDevice = data.self.hostDevice
    selfHostDevice = hostDevice === true
    netCreateBtn.style.display = hostDevice ? '' : 'none'
    netPlayersTitleEl.style.display = hostDevice ? '' : 'none'
    netPlayersEl.style.display = hostDevice ? '' : 'none'
    const others = data.players.filter((p) => !(p.ip === data.self.ip && p.port === data.self.port))
    const peerKeys = others
      .map((p) => `${p.ip}:${p.port}`)
      .sort()
      .join(',')
    if (peerKeys !== knownPeerKeys) {
      knownPeerKeys = peerKeys
      logNetEvent(others.length === 0 ? t('network.diagNoPeersEvent') : t('network.diagPeersEvent', { n: others.length }))
    }
    renderNetPlayers(others, data.self)
    renderNetMatches(data.players)
    renderLobbyChat(data.chat)
    if (diagOverlayEl.classList.contains('visible')) renderDiagnostics()
  } catch {
    /* local host server not reachable (e.g. vite dev without host) */
  }
}

const lobbyVisible = (): boolean => {
  if (!lobbyEl) lobbyEl = document.getElementById('lobby') as HTMLElement
  return getComputedStyle(lobbyEl).display !== 'none'
}

window.setInterval(() => {
  if (document.visibilityState === 'visible' && lobbyVisible()) void pollNetwork()
}, POLL_INTERVAL_MS)
void pollNetwork()

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return
  if (!lobbyVisible()) return
  const tag = (document.activeElement as HTMLElement)?.tagName
  if (tag === 'TEXTAREA') return
  if (tag === 'INPUT') {
    if (createOverlay.classList.contains('visible')) {
      createOkBtn.click()
      return
    }
    if (document.activeElement === netChatInputEl) return
    if (networkPanel.classList.contains('hidden-panel')) return
    joinSelectedOrManual()
    return
  }
  if (networkPanel.classList.contains('hidden-panel')) {
    if (matchPanel.classList.contains('hidden-panel')) startBtn.click()
    return
  }
  joinSelectedOrManual()
})

// ---------- game info catalog ----------

let renderActiveInfoTab = (): void => {}
let controlsInfoHtml = (): string => ''

const infoCatalogReady = import('./ui/game-info-catalog.ts').then((mod) => {
  const refs = mod.initGameInfoCatalog(resolvedDevSettings)
  renderActiveInfoTab = refs.renderActiveInfoTab
  controlsInfoHtml = refs.controlsInfoHtml
})

const refreshLobbyTexts = (): void => {
  translateStatic()
  renderMatchDaily()
  if (joinBusy) setJoinBusy(true)
  renderMapSelect()
  renderPlayers()
  winRuleDesc.textContent = t(`offline.winDesc.${WIN_RULE_KEYS[winRuleSelect.value as WinRule]}`)
  buildDevForm()
  renderOnlineMatches()
  renderMapBuilderTable()
  renderGraphicsList()
  renderAudioList()
  renderWeatherOptions(startWeatherEl)
  renderWeatherOptions(matchWeatherEl)
  if (controlsOverlay.classList.contains('visible')) renderControlsList()
  if (controlsInfoOverlay.classList.contains('visible')) controlsInfoContent.innerHTML = controlsInfoHtml()
  renderActiveInfoTab()
  if (lobbyState) renderSyncList()
  if (lobbyState) renderMatchPanel(lobbyState)
  renderProfilePanel()
}

// ---------- invite link auto-join (QR) ----------

const inviteParams = new URLSearchParams(window.location.search)
const inviteCode = (inviteParams.get('code') ?? '').trim().toUpperCase()
if (inviteCode) {
  const invitePass = inviteParams.get('pass') ?? ''
  window.setTimeout(() => {
    // Invite links carry no scheme, so `isOnlineAddr` cannot spot an online invite. Ask for
    // an account when the link points at the online server's host; a genuine LAN invite
    // still works for anyone.
    if (window.location.host === new URL(ONLINE_URL).host && !requireLogin('join')) return
    void connectJoin(window.location.host, inviteCode, invitePass, netNameEl.value.trim() || 'Commander', true)
  }, AUTO_JOIN_DELAY_MS)
}

// ---------- hide loading screen ----------

/** Cap on how long the lobby waits on the asset preload. Loads continue in the
 *  background and feed the renderer's caches; the screen always gives way within
 *  budget so an unreachable remote asset origin can never wedge boot. */
const PRELOAD_BUDGET_MS = 30_000

const bootReady = (async () => {
  await Promise.allSettled([graphicsReady, audioReady, mapBuilderReady, infoCatalogReady])
  const fillEl = document.getElementById('loader-fill')
  const statusEl = document.getElementById('loader-status')
  await Promise.race([
    preloadAllMatchAssets((done, total) => {
      if (fillEl) fillEl.style.width = `${Math.min(100, Math.floor((done / Math.max(1, total)) * 100))}%`
      if (statusEl) statusEl.textContent = `Loading assets ${Math.min(done, total)}/${total}`
    }),
    new Promise<void>((resolve) => window.setTimeout(resolve, PRELOAD_BUDGET_MS)),
  ])
  const el = document.getElementById('loading-screen')
  if (el) {
    el.classList.add('hidden')
    window.setTimeout(() => el.remove(), 500)
  }
})()

// ---------- offer to resume a running match after a page reload ----------

const stashedMatch = readActiveMatch()
if (stashedMatch) {
  pendingResume = stashedMatch
  void bootReady.then(() => {
    if (stashedMatch === pendingResume && !inviteCode) resumeOverlayEl.classList.add('visible')
  })
}

// ---------- local folder backup (profile/backup.json on the LAN host) ----------
// localStorage is scoped to origin (scheme://host:port), so a port/URL change
// would otherwise wipe the player's data. The host keeps one JSON snapshot in
// the game folder's `profile/`. On load we restore any missing keys (only when
// storage looks broken; existing data is never overwritten), then save. A save
// also runs before close (pagehide) and on a quiet 30s heartbeat, but the module
// fingerprints the storage and skips the upload entirely when nothing changed.

const CORE_STORAGE_KEYS = ['space-arenas:graphics', 'space-arenas:audio', 'space-arenas:profile', 'space-arenas:name', 'space-arenas:clientId']

const storageCoreIntact = (): boolean =>
  CORE_STORAGE_KEYS.every((k) => {
    try {
      return localStorage.getItem(k) !== null
    } catch {
      return false
    }
  })

void (async () => {
  let restored = 0
  if (!storageCoreIntact()) restored = await restoreLocalProfile()
  if (restored > 0) {
    reloadGraphics()
    reloadAudio()
    renderProfilePanel()
    console.info(`[local-backup] restored ${restored} missing localStorage keys from folder snapshot`)
  }
  void saveLocalProfile()
})()

window.setInterval(() => {
  void saveLocalProfile()
}, 30_000)
window.addEventListener('pagehide', () => void saveLocalProfile(true))
