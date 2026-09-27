import './styles.css'
import { BUILDINGS, UNITS, UPGRADES, WEAPONS, SIM_TICK_HZ, SECONDS_TO_TICKS, crc32, mergeMatchSettings, DEFAULT_MATCH_SETTINGS, DEFAULT_CREDITS, PLAYER_COLORS, FOG_MODES, COOP_ECONOMY_OPTIONS, COOP_RANK_OPTIONS, COOP_CONTROL_OPTIONS, validReplay, replayDateLabel, modFromSettings, modSettingsDelta, PROTOCOL_VERSION, type ModFile, type ModMeta, type MatchSettings, type WinRule, type FogMode, type ReplayData, type ReplayMeta } from '@space-arenas/shared'
import { MAP_PRESETS, mapForPreset, type MapData } from '@space-arenas/shared'
import { Game } from './game/Game.ts'
import { AudioHooks, AMBIENT_SYNTH } from './audio/hooks.ts'
import { NetClient } from './net/net.ts'
import type { LobbyMessage, MatchStartMessage } from '@space-arenas/shared'
import type { MatchConfig, OfflineMode } from './game/match.ts'
import { resolveDailyChallenge } from './modes/daily.ts'
import { loadModeRecords, dailyLevel, dailyLevelXp, DAILY_XP_PER_LEVEL } from './profile/modeRecords.ts'
import { MapPreview } from './ui/map-preview.ts'
import { createPlayerRow } from './ui/player-row.ts'
import { BOT_DIFFICULTIES, type BotDifficulty } from './ai/bot.ts'
import { initControlsSettings } from './ui/controls-settings.ts'
import { preloadFxFrames } from './render/building-sprites.ts'
import { WEATHERS, type WeatherId, getGraphics, setWeather, setBuildingFill, setBuildingOffset, setFieldOffset, setFieldScale, setObstacleScale, setObstacleOffset, setUnitScale, setUnitOffset, setAssetPath, setFxScale, setFxOffset, setMinimapScale, setVictoryCinematicSec, setZoomMin, setZoomMax, setReplayZoomMin, setReplayZoomMax, setSpriteLayerOrder, DEFAULT_BUILDING_FILL, DEFAULT_BUILDING_OFFSET, DEFAULT_FIELD_OFFSET, DEFAULT_FIELD_SCALE, DEFAULT_OBSTACLE_SCALE, DEFAULT_OBSTACLE_OFFSET, DEFAULT_UNIT_SCALE, DEFAULT_UNIT_OFFSET, DEFAULT_FX_SCALE, DEFAULT_FX_OFFSET, DEFAULT_MINIMAP_SCALE, DEFAULT_VICTORY_CINEMATIC, DEFAULT_ZOOM_MIN, DEFAULT_ZOOM_MAX, DEFAULT_REPLAY_ZOOM_MIN, DEFAULT_REPLAY_ZOOM_MAX, DEFAULT_SPRITE_LAYER_ORDER, SPRITE_LAYER_KINDS, UNIT_ASSET_IDS, OBSTACLE_ASSET_TYPES, reloadGraphics } from './ui/graphics.ts'
import { getAudio, setOverride, setTuning, reloadAudio, TUNING_VOL_MAX, TUNING_PITCH_MIN, TUNING_PITCH_MAX, type SoundId } from './audio/settings.ts'
import { initLang, setLang, getLang, t, tn, translateStatic, onLangChange, type Lang } from './i18n/index.ts'
import { allMapEntries, entryToMap, findMapEntry, migrateLegacyLibrary, type MapEntry } from './mapbuilder/library.ts'
import { initProfilePanel, renderProfilePanel, onProfileTabShown } from './profile/ui.ts'
import { loadProfileConfig, saveProfileConfig } from './profile/profile.ts'
import { decryptPayload, encryptPayload, sha256Hex } from './net/crypto.ts'

const ERROR_HIDE_TIMEOUT_MS = 8000
const COUNTDOWN_SECONDS = 5
const MAX_NAME_LENGTH = 16
const NAME_DEBOUNCE_MS = 500
const MAX_CHAT_LINES = 100
const POLL_INTERVAL_MS = 2500
const AUTO_JOIN_DELAY_MS = 600

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
  lobbyAmbientUnlocked = true
  window.removeEventListener('pointerdown', unlockLobbyAudio, true)
  window.removeEventListener('keydown', unlockLobbyAudio, true)
}
window.addEventListener('pointerdown', unlockLobbyAudio, true)
window.addEventListener('keydown', unlockLobbyAudio, true)

const hideLobby = (): void => {
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

const setTab = (which: 'offline' | 'network' | 'match' | 'online' | 'mapbuilder' | 'info' | 'settings' | 'dev' | 'profile' | 'archive' | 'mods'): void => {
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

matchModToggleEl.addEventListener('change', () => {
  if (!lobbyState || lobbyState.yourId !== lobbyState.hostId) return
  if (matchModToggleEl.checked) {
    const name = matchModSelectEl.value
    const m = activeMods().find((x) => x.name === name)
    if (!m) {
      matchModToggleEl.checked = false
      return
    }
    net?.updateRoom({ modId: name })
    setMatchStatus(t('mods.applied', { n: m.label }))
  } else {
    net?.updateRoom({ modId: '' })
    setMatchStatus(t('mods.cleared'))
  }
})

matchModSelectEl.addEventListener('change', () => {
  if (!matchModToggleEl.checked || !lobbyState || lobbyState.yourId !== lobbyState.hostId) return
  const name = matchModSelectEl.value
  net?.updateRoom({ modId: name })
  const m = activeMods().find((x) => x.name === name)
  setMatchStatus(m ? t('mods.applied', { n: m.label }) : t('mods.cleared'))
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
    if (msg.modId) {
      const known = modsCache.find((m) => m.name === msg.modId) ?? activeMods().find((m) => m.name === msg.modId)
      const line = document.createElement('div')
      line.className = 'match-note'
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
    } else {
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
const onlineMatchesBody = document.getElementById('online-matches-table')!.querySelector('tbody')!
const onlineNameEl = document.getElementById('online-name') as HTMLInputElement
const onlineSearchEl = document.getElementById('online-search') as HTMLInputElement
const accountOverlay = document.getElementById('account-overlay') as HTMLDivElement
const accountUsernameEl = document.getElementById('account-username') as HTMLInputElement
const accountRegisterBtn = document.getElementById('account-register') as HTMLButtonElement
const accountLoginBtn = document.getElementById('account-login') as HTMLButtonElement
const serverOverlay = document.getElementById('server-overlay') as HTMLDivElement
const serverAddressEl = document.getElementById('server-address') as HTMLInputElement
const serverIndEl = document.getElementById('server-ind') as HTMLDivElement
const dbIndEl = document.getElementById('db-ind') as HTMLDivElement
const accountStatusEl = document.getElementById('account-status') as HTMLDivElement
const accountEmailEl = document.getElementById('account-email') as HTMLInputElement
const accountPassEl = document.getElementById('account-pass') as HTMLInputElement
const accountNewPassEl = document.getElementById('account-newpass') as HTMLInputElement
const accountAnonEl = document.getElementById('account-anon') as HTMLDivElement
const accountAuthedEl = document.getElementById('account-authed') as HTMLDivElement
const accountProfileSummaryEl = document.getElementById('account-profilesummary') as HTMLDivElement
const accountChangeBtn = document.getElementById('account-change') as HTMLButtonElement
const accountLogoutBtn = document.getElementById('account-logout') as HTMLButtonElement
const leaderboardStatusEl = document.getElementById('leaderboard-status') as HTMLDivElement
const leaderboardBody = document.getElementById('leaderboard-table')!.querySelector('tbody')
const onlineMatchesSection = document.getElementById('online-matches-section') as HTMLDivElement
const onlineLeaderboardSection = document.getElementById('online-leaderboard-section') as HTMLDivElement
const onlineTabMatchesBtn = document.getElementById('online-tab-matches') as HTMLButtonElement
const onlineTabLeaderboardBtn = document.getElementById('online-tab-leaderboard') as HTMLButtonElement
const onlineTabDataBtn = document.getElementById('online-tab-data') as HTMLButtonElement
const onlineTabModsBtn = document.getElementById('online-tab-mods') as HTMLButtonElement
const onlineDataSection = document.getElementById('online-data-section') as HTMLDivElement
const onlineModsSection = document.getElementById('online-mods-section') as HTMLDivElement
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

const refreshOnlineList = async (silent = false): Promise<void> => {
  try {
    const res = await fetch(`${ONLINE_URL}/api/rooms`)
    if (!res.ok) throw new Error(String(res.status))
    const data = (await res.json()) as { rooms?: OnlineRoom[] }
    onlineRooms = data.rooms ?? []
    selectedOnlineRoom = onlineRooms.some((r) => selectedOnlineRoom && r.id === selectedOnlineRoom.id) ? selectedOnlineRoom : null
    renderOnlineMatches()
    if (!silent) setOnlineStatus(t('online.refreshed'))
  } catch {
    if (!silent) setOnlineStatus(t('online.serverDown'), true)
  }
}

onlineSearchEl.addEventListener('input', renderOnlineMatches)

const onlineJoinSelected = (): void => {
  if (!selectedOnlineRoom) {
    setOnlineStatus(t('network.status.needCode'), true)
    return
  }
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

document.getElementById('online-account')!.addEventListener('click', () => {
  accountUsernameEl.value = onlineNameEl.value
  accountOverlay.classList.add('visible')
  // Re-sync games/wins/best from the server every time the popup opens (matches update them).
  if (authSession) void adoptToken(authSession.token)
})
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
accountUsernameEl.addEventListener('input', () => {
  onlineNameEl.value = accountUsernameEl.value
  netNameEl.value = accountUsernameEl.value
  try {
    localStorage.setItem('space-arenas:name', accountUsernameEl.value.trim() || 'Commander')
  } catch {
    /* storage unavailable */
  }
})

document.getElementById('online-create')!.addEventListener('click', () => {
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

const updateAccountUI = (): void => {
  const signedIn = authSession !== null
  accountAnonEl.classList.toggle('hidden-el', signedIn)
  accountAuthedEl.classList.toggle('hidden-el', !signedIn)
  if (signedIn) {
    const s = authSession!
    accountProfileSummaryEl.textContent = t('online.accountSummary', { name: s.username, games: s.games, wins: s.wins, score: s.highScore })
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

const authPost = async (path: string, body: unknown): Promise<{ ok: boolean; error?: string; data?: Record<string, unknown> }> => {
  try {
    const res = await fetch(`${ONLINE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; data?: unknown }
    if (res.ok) {
      // The server answers auth routes with { ok, data: { ... } } — unwrap so callers can
      // read `data.token` directly.
      const payload = j && typeof j === 'object' && j.ok === true ? j.data : j
      return { ok: true, data: (payload ?? {}) as Record<string, unknown> }
    }
    return { ok: false, error: String(j.error ?? `HTTP ${res.status}`) }
  } catch {
    return { ok: false, error: t('online.serverDown') }
  }
}

const adoptToken = async (token: string): Promise<boolean> => {
  try {
    const res = await fetch(`${ONLINE_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) return false
    const j = (await res.json()) as {
      ok: boolean
      data?: { userId: string; email: string; username: string; games: number; wins: number; highScore: number }
    }
    if (!j.ok || !j.data) return false
    const d = j.data
    saveAuth({ token, userId: d.userId, email: d.email, username: d.username, games: d.games, wins: d.wins, highScore: d.highScore })
    applyAuthUsername(d.username)
    return true
  } catch {
    return false
  }
}

accountRegisterBtn.addEventListener('click', async () => {
  const username = accountUsernameEl.value.trim()
  const email = accountEmailEl.value.trim()
  const password = accountPassEl.value
  if (!username || !email || !password) {
    setAccountStatus(t('online.fillAll'), true)
    return
  }
  if (password.length < 6) {
    setAccountStatus(t('online.pwShort'), true)
    return
  }
  setAccountStatus(t('online.working'))
  const r = await authPost('/api/auth/register', { username, email, password })
  if (!r.ok) {
    setAccountStatus(r.error ?? t('online.unknownError'), true)
    return
  }
  const l = await authPost('/api/auth/login', { email, password })
  if (l.ok && typeof l.data?.token === 'string') {
    await adoptToken(l.data.token)
    setAccountStatus(t('online.registerOk', { name: authSession?.username ?? username }))
  } else {
    setAccountStatus(t('online.registeredLoginFellBack'))
  }
})

accountLoginBtn.addEventListener('click', async () => {
  const email = accountEmailEl.value.trim()
  const password = accountPassEl.value
  if (!email || !password) {
    setAccountStatus(t('online.fillAll'), true)
    return
  }
  setAccountStatus(t('online.working'))
  const l = await authPost('/api/auth/login', { email, password })
  if (!l.ok) {
    setAccountStatus(l.error ?? t('online.unknownError'), true)
    return
  }
  if (typeof l.data?.token === 'string') {
    await adoptToken(l.data.token)
    setAccountStatus(t('online.loginOk', { name: authSession?.username ?? '' }))
  }
})

accountChangeBtn.addEventListener('click', async () => {
  if (!authSession) return
  const newPassword = accountNewPassEl.value
  if (newPassword.length < 6) {
    setAccountStatus(t('online.pwShort'), true)
    return
  }
  setAccountStatus(t('online.working'))
  const r = await authPost('/api/auth/change-password', { token: authSession.token, newPassword })
  if (!r.ok) {
    setAccountStatus(r.error ?? t('online.unknownError'), true)
    return
  }
  const l = await authPost('/api/auth/login', { email: authSession.email, password: newPassword })
  if (l.ok && typeof l.data?.token === 'string') await adoptToken(l.data.token)
  accountNewPassEl.value = ''
  setAccountStatus(t('online.passwordChanged'))
})

accountLogoutBtn.addEventListener('click', () => {
  saveAuth(null)
  setAccountStatus(t('online.loggedOut'))
})

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

// ---------- leaderboard (Phase 2) ----------

const setOnlineTab = (tab: 'matches' | 'leaderboard' | 'data' | 'mods'): void => {
  onlineMatchesSection.classList.toggle('hidden-el', tab !== 'matches')
  onlineLeaderboardSection.classList.toggle('hidden-el', tab !== 'leaderboard')
  onlineDataSection.classList.toggle('hidden-el', tab !== 'data')
  onlineModsSection.classList.toggle('hidden-el', tab !== 'mods')
  onlineTabMatchesBtn.classList.toggle('selected', tab === 'matches')
  onlineTabLeaderboardBtn.classList.toggle('selected', tab === 'leaderboard')
  onlineTabDataBtn.classList.toggle('selected', tab === 'data')
  onlineTabModsBtn.classList.toggle('selected', tab === 'mods')
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

setInterval(() => {
  if (!onlinePanel.classList.contains('hidden-panel')) void refreshOnlineList(true)
}, 5_000)

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
    return JSON.stringify({
      v: 1,
      kind,
      keys: {
        'space-arenas:dev-settings': JSON.stringify(devOverrides),
        'space-arenas:dev-defaults': JSON.stringify(savedDefaults),
        'space-arenas:graphics': JSON.stringify(getGraphics()),
        'space-arenas:audio': JSON.stringify(getAudio()),
      },
    })
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

const uploadBackup = async (kind: 'devsettings' | 'profile'): Promise<void> => {
  if (!authSession || !authToken()) {
    setDataStatus(t('online.dataNeedLogin'), true)
    return
  }
  const pass = dataPassEl.value
  if (pass.length < 4) {
    setDataStatus(t('online.dataNeedPass'), true)
    return
  }
  const payload = collectPayload(kind)
  if (payload === null) {
    setDataStatus(kind === 'devsettings' ? t('online.dataNoDev') : t('online.dataNoProfile'), true)
    return
  }
  setDataStatus(t('online.working'))
  try {
    const bundle = await encryptPayload(payload, pass)
    const passphraseHash = await sha256Hex(pass)
    const r = await authApi('POST', '/api/backups', { kind, payload: bundle, passphraseHash })
    if (!r.ok) throw new Error(r.error ?? t('online.unknownError'))
    await loadBackups(true)
    setDataStatus(t('online.dataUploaded'))
    dataPassEl.value = ''
  } catch (err) {
    setDataStatus(err instanceof Error && err.message ? err.message : t('online.unknownError'), true)
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
      reloadGraphics()
      reloadAudio()
      buildDevForm()
    }
    if (parsed.kind === 'profile' || decodedKeys?.['space-arenas:profile'] !== undefined) {
      renderProfilePanel()
    }
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
  meta.textContent = m.description || t('mods.repo.repoBy', { author: m.author || '?' })
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
  const locked = !authSession || publishable.length === 0
  modsRepoPublishSelectEl.disabled = locked
  modsRepoPublishDescEl.disabled = locked
  modsRepoPublishBtn.disabled = locked || modsRepoPublishDescEl.value.trim() === ''
  if (!authSession) return
  for (const m of publishable) {
    const opt = document.createElement('option')
    opt.value = m.name
    opt.textContent = m.label
    modsRepoPublishSelectEl.appendChild(opt)
  }
  if (publishable.some((m) => m.name === prev)) modsRepoPublishSelectEl.value = prev
}

modsRepoPublishDescEl.addEventListener('input', () => {
  modsRepoPublishBtn.disabled = modsRepoPublishSelectEl.value === '' || modsRepoPublishDescEl.value.trim() === '' || modsRepoPublishSelectEl.disabled
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
  if (!authSession) {
    setRepoStatus(t('mods.repo.repoNeedLogin'), true)
    return
  }
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
  void migrateLegacyLibrary().then(() => renderMapBuilderTable())
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
const devFormEl = document.getElementById('dev-settings-form') as HTMLDivElement
const devStatusEl = document.getElementById('dev-status') as HTMLDivElement
const devSaveBtn = document.getElementById('dev-save') as HTMLButtonElement
const devResetBtn = document.getElementById('dev-reset') as HTMLButtonElement
const devSaveDefaultBtn = document.getElementById('dev-save-default') as HTMLButtonElement
const devCollapseBtn = document.getElementById('dev-collapse') as HTMLButtonElement

interface DevFieldDef {
  key: keyof MatchSettings
  unit?: string
  min: number
  max: number
  step: number
  seconds?: boolean
}

type OverrideMapKey = 'buildingOverrides' | 'unitOverrides' | 'weaponOverrides' | 'upgradeOverrides'

interface OverrideFieldDef {
  field: string
  unit?: string
  min: number
  max: number
  step: number
  seconds?: boolean
  only?: string[]
}

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
}

const devUnit = (u: string): string => t(`dev.units.${DEV_UNIT_KEYS[u] ?? u}`)

const DEV_SCALAR_SECTIONS: Array<{ title: string; fields: DevFieldDef[] }> = [
  {
    title: 'economy',
    fields: [
      { key: 'startingCredits', unit: 'credits', min: 100, max: 100000, step: 100 },
      { key: 'oilIncome', unit: 'credits', min: 0, max: 100000, step: 10 },
      { key: 'oilIncomeIntervalTicks', unit: 'sec', min: 0.1, max: 600, step: 0.5, seconds: true },
      { key: 'oilClaimTicks', unit: 'sec', min: 0.1, max: 600, step: 0.5, seconds: true },
      { key: 'supplyPerTrip', unit: 'units', min: 0, max: 100000, step: 10 },
      { key: 'supplyFieldCapacity', unit: 'units', min: 0, max: 100000, step: 10 },
      { key: 'supplyFieldBonus', unit: '%', min: 0, max: 1000, step: 5 },
      { key: 'supplyFieldClaimTicks', unit: 'sec', min: 0.1, max: 600, step: 0.5, seconds: true },
      { key: 'supplyFieldHoldTicks', unit: 'sec', min: 0, max: 600, step: 0.5, seconds: true },
      { key: 'harvesterLoadTicks', unit: 'sec', min: 0.1, max: 120, step: 0.1, seconds: true },
      { key: 'builderRepairPerTick', unit: 'hp/tick', min: 0, max: 100000, step: 5 },
      { key: 'sellRefundFraction', unit: '0–1', min: 0, max: 1, step: 0.05 },
      { key: 'sellTicks', unit: 'sec', min: 0, max: 300, step: 0.5, seconds: true },
      { key: 'wreckValueFraction', unit: '0–1', min: 0, max: 1, step: 0.05 },
      { key: 'wreckCollectTicks', unit: 'sec', min: 0.1, max: 300, step: 0.5, seconds: true },
      { key: 'queueLimit', unit: 'orders', min: 1, max: 50, step: 1 },
    ],
  },
  {
    title: 'satellite',
    fields: [
      { key: 'satelliteRevealTicks', unit: 'sec', min: 0.1, max: 600, step: 0.5, seconds: true },
      { key: 'satelliteCooldownTicks', unit: 'sec', min: 0, max: 600, step: 0.5, seconds: true },
    ],
  },
  {
    title: 'power',
    fields: [{ key: 'maxPowerTicks', unit: 'sec', min: 1, max: 300, step: 1, seconds: true }],
  },
  {
    title: 'laser',
    fields: [
      { key: 'laserMaxLevel', unit: 'levels', min: 1, max: 10, step: 1 },
      { key: 'laserCooldownTicks', unit: 'sec', min: 0.1, max: 600, step: 0.5, seconds: true },
      { key: 'laserRadius', unit: 'cells', min: 0.5, max: 30, step: 0.5 },
      { key: 'laserDurationTicks', unit: 'sec', min: 0.1, max: 30, step: 0.1, seconds: true },
      { key: 'laserDamagePerTick', unit: 'dmg/tick', min: 0, max: 100000, step: 10 },
      { key: 'laserDelayTicksLv1', unit: 'sec', min: 0, max: 30, step: 0.1, seconds: true },
      { key: 'laserDelayTicksLv2', unit: 'sec', min: 0, max: 30, step: 0.1, seconds: true },
    ],
  },
  {
    title: 'superWeapon',
    fields: [
      { key: 'airstrikeCooldownTicks', unit: 'sec', min: 1, max: 600, step: 1, seconds: true },
      { key: 'empCooldownTicks', unit: 'sec', min: 1, max: 600, step: 1, seconds: true },
      { key: 'airstrikeBombDamage', unit: 'dmg', min: 0, max: 100000, step: 10 },
      { key: 'airstrikeBombRadius', unit: 'cells', min: 0.5, max: 30, step: 0.5 },
      { key: 'empRadiusTiles', unit: 'cells', min: 0.5, max: 30, step: 0.5 },
      { key: 'empDurationTicks', unit: 'sec', min: 0.1, max: 60, step: 0.5, seconds: true },
    ],
  },
  {
    title: 'fog',
    fields: [{ key: 'fogFadeDistance', unit: 'cells', min: 0, max: 30, step: 1 }],
  },
  {
    title: 'abilities',
    fields: [
      { key: 'grenadeRange', unit: 'cells', min: 1, max: 30, step: 1 },
      { key: 'grenadeBlastRadius', unit: 'cells', min: 0.5, max: 10, step: 0.5 },
      { key: 'grenadeDamage', unit: 'dmg', min: 0, max: 100000, step: 10 },
      { key: 'grenadeFuseTicks', unit: 'sec', min: 0.2, max: 30, step: 0.2, seconds: true },
      { key: 'grenadeCooldownTicks', unit: 'sec', min: 0.1, max: 120, step: 0.5, seconds: true },
      { key: 'smokeRange', unit: 'cells', min: 1, max: 30, step: 1 },
      { key: 'smokeRadius', unit: 'cells', min: 0.5, max: 10, step: 0.5 },
      { key: 'smokeDurationTicks', unit: 'sec', min: 1, max: 120, step: 1, seconds: true },
      { key: 'smokeMissChance', unit: '0–1', min: 0, max: 1, step: 0.05 },
      { key: 'smokeCooldownTicks', unit: 'sec', min: 0.1, max: 120, step: 0.5, seconds: true },
    ],
  },
  {
    title: 'stealth',
    fields: [
      { key: 'detectorCost', unit: 'credits', min: 0, max: 100000, step: 50 },
      { key: 'detectorRange', unit: 'cells', min: 1, max: 100, step: 1 },
      { key: 'stealthCost', unit: 'credits', min: 0, max: 100000, step: 50 },
      { key: 'stealthRevealTicks', unit: 'sec', min: 0.1, max: 120, step: 0.5, seconds: true },
    ],
  },
  {
    title: 'dayNight',
    fields: [
      { key: 'dayNightCycleTicks', unit: 'sec', min: 30, max: 3600, step: 5, seconds: true },
      { key: 'dayNightTransitionTicks', unit: 'sec', min: 1, max: 600, step: 1, seconds: true },
    ],
  },
  {
    title: 'mines',
    fields: [
      { key: 'mineCost', unit: 'credits', min: 0, max: 100000, step: 10 },
      { key: 'minePlaceRange', unit: 'cells', min: 0.5, max: 30, step: 0.5 },
      { key: 'mineTriggerRadius', unit: 'cells', min: 0.1, max: 5, step: 0.1 },
      { key: 'mineBlastRadius', unit: 'cells', min: 0.5, max: 10, step: 0.5 },
      { key: 'mineDamage', unit: 'dmg', min: 0, max: 100000, step: 10 },
      { key: 'mineArmTicks', unit: 'sec', min: 0, max: 60, step: 0.5, seconds: true },
      { key: 'mineLimit', unit: 'units', min: 1, max: 1000, step: 1 },
      { key: 'friendlyMineDamage', unit: '0–1', min: 0, max: 1, step: 1 },
    ],
  },
  {
    title: 'heal',
    fields: [
      { key: 'engineerHealPerTick', unit: 'hp/tick', min: 0, max: 1000, step: 1 },
      { key: 'engineerHealRange', unit: 'cells', min: 0.5, max: 10, step: 0.5 },
      { key: 'engineerHealAuraRadius', unit: 'cells', min: 0.5, max: 10, step: 0.5 },
      { key: 'engineerHealRank', unit: 'levels', min: 1, max: 5, step: 1 },
    ],
  },
  {
    title: 'worldFields',
    fields: [
      { key: 'supplyFieldRadius', unit: 'cells', min: 0, max: 30, step: 1 },
      { key: 'oilFieldRadius', unit: 'cells', min: 0, max: 30, step: 1 },
      { key: 'spawnRange', unit: 'cells', min: 1, max: 20, step: 1 },
      { key: 'oilFieldHp', unit: 'hp', min: 1, max: 1000000, step: 50 },
      { key: 'treeHp', unit: 'hp', min: 1, max: 100000, step: 5 },
      { key: 'rockHp', unit: 'hp', min: 1, max: 100000, step: 5 },
      { key: 'crushDamage', unit: 'dmg', min: 0, max: 10000, step: 1 },
      { key: 'workPadDistance', unit: 'cells', min: 0.5, max: 10, step: 0.5 },
      { key: 'workStuckTicks', unit: 'ticks', min: 5, max: 300, step: 5 },
      { key: 'maxBuildOrders', unit: 'orders', min: 1, max: 12, step: 1 },
    ],
  },
  {
    title: 'movement',
    fields: [
      { key: 'sepVehicle', unit: 'cells', min: 0.2, max: 5, step: 0.05 },
      { key: 'sepInfantry', unit: 'cells', min: 0.2, max: 5, step: 0.05 },
      { key: 'sepMaxPush', unit: 'cells', min: 0, max: 2, step: 0.02 },
      { key: 'buildingMarginVehicle', unit: 'cells', min: 0, max: 3, step: 0.05 },
      { key: 'buildingMarginInfantry', unit: 'cells', min: 0, max: 3, step: 0.05 },
      { key: 'fieldMargin', unit: 'cells', min: 0, max: 3, step: 0.05 },
      { key: 'samePosJitter', unit: 'cells', min: 0, max: 2, step: 0.01 },
      { key: 'lateralSepDist', unit: 'cells', min: 0, max: 2, step: 0.01 },
      { key: 'stuckRelocateRadius', unit: 'cells', min: 1, max: 30, step: 1 },
      { key: 'repathCooldownBlockedTicks', unit: 'sec', min: 0.04, max: 4, step: 0.04, seconds: true },
      { key: 'repathCooldownFailTicks', unit: 'sec', min: 0.04, max: 4, step: 0.04, seconds: true },
    ],
  },
  {
    title: 'combat',
    fields: [
      { key: 'chaseLeash', unit: 'x', min: 1, max: 10, step: 0.25 },
      { key: 'guardArriveCells', unit: 'cells', min: 0, max: 10, step: 0.1 },
      { key: 'targetBiasLastHit', unit: 'score', min: 0, max: 100000000, step: 1000000 },
      { key: 'targetBiasFocusFire', unit: 'score', min: 0, max: 10000000, step: 100000 },
      { key: 'targetBiasLowHp', unit: 'score', min: 0, max: 1000000, step: 1000 },
      { key: 'defaultSplash', unit: 'cells', min: 0, max: 10, step: 0.1 },
    ],
  },
  {
    title: 'veterancy',
    fields: [
      { key: 'veteranRank1Kills', unit: 'kills', min: 0, max: 100, step: 1 },
      { key: 'veteranRank2Kills', unit: 'kills', min: 0, max: 200, step: 1 },
      { key: 'veteranRank3Kills', unit: 'kills', min: 0, max: 300, step: 1 },
      { key: 'veteranRank4Kills', unit: 'kills', min: 0, max: 400, step: 1 },
      { key: 'veteranRank5Kills', unit: 'kills', min: 0, max: 500, step: 1 },
      { key: 'veteranDamagePerRank', unit: 'x', min: 0, max: 2, step: 0.05 },
      { key: 'veteranRangePerRank', unit: 'x', min: 0, max: 2, step: 0.05 },
      { key: 'veteranArmorPerRank', unit: '0–1', min: 0, max: 1, step: 0.05 },
    ],
  },
  {
    title: 'planes',
    fields: [
      { key: 'planeOrbitRadius', unit: 'cells', min: 0.2, max: 10, step: 0.1 },
      { key: 'planeReloadRadius', unit: 'cells', min: 1, max: 40, step: 1 },
      { key: 'planeSortieMult', unit: 'x', min: 0, max: 20, step: 0.5 },
    ],
  },
  {
    title: 'pathfinding',
    fields: [
      { key: 'pathBudgetPerTick', unit: 'orders', min: 1, max: 100, step: 1 },
      { key: 'pathMaxNodes', unit: 'nodes', min: 100, max: 200000, step: 100 },
      { key: 'astarCostStraight', unit: 'score', min: 1, max: 100, step: 1 },
      { key: 'astarCostDiagonal', unit: 'score', min: 1, max: 200, step: 1 },
    ],
  },
]

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

const OVERRIDE_BUILDING_FIELDS: OverrideFieldDef[] = [
  { field: 'cost', unit: 'credits', min: 0, max: 1000000, step: 100 },
  { field: 'buildTimeTicks', unit: 'sec', min: 0.1, max: 900, step: 0.5, seconds: true },
  { field: 'hp', unit: 'hp', min: 1, max: 1000000, step: 100 },
  { field: 'powerGen', unit: 'power', min: 0, max: 100000, step: 10, only: ['power-plant'] },
  { field: 'powerUse', unit: 'power', min: 0, max: 100000, step: 10 },
]

const OVERRIDE_UNIT_FIELDS: OverrideFieldDef[] = [
  { field: 'cost', unit: 'credits', min: 0, max: 1000000, step: 50 },
  { field: 'buildTimeTicks', unit: 'sec', min: 0.1, max: 300, step: 0.5, seconds: true },
  { field: 'hp', unit: 'hp', min: 1, max: 1000000, step: 50 },
  { field: 'speed', unit: 'cells/s', min: 1, max: 1000, step: 5 },
  { field: 'vision', unit: 'cells', min: 1, max: 100, step: 1 },
  { field: 'capacity', unit: 'units', min: 1, max: 100, step: 1, only: ['fighter'] },
  { field: 'maxAmmo', unit: 'rounds', min: 1, max: 100, step: 1, only: ['fighter'] },
  { field: 'reloadTicks', unit: 'sec', min: 0.1, max: 300, step: 0.5, seconds: true, only: ['fighter'] },
]

const OVERRIDE_WEAPON_FIELDS: OverrideFieldDef[] = [
  { field: 'damage', unit: 'dmg', min: 0, max: 1000000, step: 5 },
  { field: 'cooldownTicks', unit: 'sec', min: 0.04, max: 120, step: 0.05, seconds: true },
  { field: 'range', unit: 'cells', min: 1, max: 100, step: 1 },
  { field: 'splash', unit: 'cells', min: 0, max: 100, step: 0.5, only: ['artillery'] },
]

const OVERRIDE_UPGRADE_FIELDS: OverrideFieldDef[] = [
  { field: 'cost', unit: 'credits', min: 0, max: 1000000, step: 50 },
  { field: 'researchTimeTicks', unit: 'sec', min: 0.1, max: 600, step: 0.5, seconds: true },
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

const resolvedDevSettings = (): MatchSettings => mergeMatchSettings({ ...savedDefaults, ...devOverrides })

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

const pushDevSettingsToHost = (): void => {
  if (!net?.connected || !lobbyState) return
  net.publishDevSettings(resolvedDevSettings())
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

let devGroupEl: HTMLElement = devFormEl

const appendDevSection = (title: string): void => {
  const details = document.createElement('details')
  details.className = 'dev-group'
  details.open = true
  const summary = document.createElement('summary')
  summary.textContent = title
  const body = document.createElement('div')
  body.className = 'dev-group-body'
  details.appendChild(summary)
  details.appendChild(body)
  devFormEl.appendChild(details)
  devGroupEl = body
}

const appendDevItemHeader = (name: string): void => {
  const details = document.createElement('details')
  details.className = 'dev-group dev-object'
  details.open = true
  const summary = document.createElement('summary')
  summary.textContent = name
  const body = document.createElement('div')
  body.className = 'dev-group-body'
  details.appendChild(summary)
  details.appendChild(body)
  devFormEl.appendChild(details)
  devGroupEl = body
}

const makeNumberInput = (
  label: string,
  desc: string,
  unit: string | undefined,
  value: number,
  defaultValue: number,
  min: number,
  max: number,
  step: number,
  overridden: boolean,
  onCommit: (v: number) => void,
): void => {
  const wrap = document.createElement('div')
  wrap.className = 'dev-field'
  const l = document.createElement('label')
  l.textContent = unit ? `${label} (${unit})` : label
  const d = document.createElement('div')
  d.className = 'dev-desc'
  d.textContent = desc
  const input = document.createElement('input')
  input.type = 'number'
  input.min = String(min)
  input.max = String(max)
  input.step = String(step)
  input.value = String(value)
  input.title = t('dev.units.default', { v: `${defaultValue}${unit ? ` ${unit}` : ''}` })
  const setMark = (ov: boolean): void => {
    wrap.classList.toggle('dev-overridden', ov)
  }
  setMark(overridden)
  input.addEventListener('change', () => {
    const raw = Number(input.value)
    if (!Number.isFinite(raw)) return
    const v = clampNum(raw, min, max)
    input.value = String(v)
    setMark(Math.abs(v - defaultValue) >= 1e-9)
    onCommit(v)
    // info tables reflect effective values — keep them in sync
    renderActiveInfoTab()
  })
  wrap.appendChild(l)
  wrap.appendChild(d)
  wrap.appendChild(input)
  devGroupEl.appendChild(wrap)
}

const makeTextInput = (
  label: string,
  desc: string,
  value: string,
  onCommit: (v: string) => void,
  placeholder = 'folder/{color}/folder_{frame}.png',
): void => {
  const wrap = document.createElement('div')
  wrap.className = 'dev-field'
  const l = document.createElement('label')
  l.textContent = label
  const d = document.createElement('div')
  d.className = 'dev-desc'
  d.textContent = desc
  const input = document.createElement('input')
  input.type = 'text'
  input.value = value
  input.placeholder = placeholder
  input.addEventListener('change', () => onCommit(input.value.trim()))
  wrap.appendChild(l)
  wrap.appendChild(d)
  wrap.appendChild(input)
  devGroupEl.appendChild(wrap)
}

const makeSelectInput = (
  label: string,
  desc: string,
  value: string,
  options: Array<{ value: string; label: string }>,
  defaultValue: string,
  onCommit: (v: string) => void,
): void => {
  const wrap = document.createElement('div')
  wrap.className = 'dev-field'
  const l = document.createElement('label')
  l.textContent = label
  const d = document.createElement('div')
  d.className = 'dev-desc'
  d.textContent = desc
  const input = document.createElement('select')
  for (const o of options) {
    const opt = document.createElement('option')
    opt.value = o.value
    opt.textContent = o.label
    input.appendChild(opt)
  }
  input.value = value
  wrap.classList.toggle('dev-overridden', value !== defaultValue)
  input.addEventListener('change', () => {
    wrap.classList.toggle('dev-overridden', input.value !== defaultValue)
    onCommit(input.value)
    renderActiveInfoTab()
  })
  wrap.appendChild(l)
  wrap.appendChild(d)
  wrap.appendChild(input)
  devGroupEl.appendChild(wrap)
}

const appendAssetGroupLabel = (text: string): void => {
  const h = document.createElement('div')
  h.className = 'tools-label'
  h.style.textAlign = 'left'
  h.style.marginTop = '6px'
  h.textContent = text
  devGroupEl.appendChild(h)
}

/** Dev-settings audio row for one sound kind: override path (with quick apply/clear)
 * plus per-sound volume & pitch tune inputs. */
const audioRow = (id: SoundId): void => {
  const tun = getAudio().tuning[id] ?? { vol: 1, pitch: 1 }
  const wrap = document.createElement('div')
  wrap.className = 'dev-field'
  const l = document.createElement('label')
  l.textContent = t(`dev.audio.${id}`)
  const d = document.createElement('div')
  d.className = 'dev-desc'
  d.textContent = t('dev.fields.audioPath.desc')
  const pathLine = document.createElement('div')
  pathLine.className = 'dev-audio-line'
  const input = document.createElement('input')
  input.type = 'text'
  input.value = getAudio().overrides[id] ?? ''
  input.placeholder = 'sound/{id}/'
  const mark = (ov: boolean): void => {
    wrap.classList.toggle('dev-overridden', ov)
  }
  const commitPath = (): void => {
    const value = input.value.trim()
    setOverride(id, value)
    mark(value.length > 0)
    setDevStatus(t('dev.status.audioSaved'))
    renderActiveInfoTab()
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
  mark((getAudio().overrides[id] ?? '').length > 0)
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
  wrap.appendChild(l)
  wrap.appendChild(d)
  wrap.appendChild(pathLine)
  wrap.appendChild(tuneLine)
  devGroupEl.appendChild(wrap)
}

const buildOverrideInputs = (mapKey: OverrideMapKey, id: string, defs: OverrideFieldDef[]): void => {
  const defaults = OVERRIDE_SOURCES[mapKey][id] ?? {}
  const devMaps = devOverrides as Record<string, Record<string, Record<string, number>> | undefined>
  for (const f of defs) {
    if (f.only && !f.only.includes(id)) continue
    const defaultRaw = defaults[f.field] ?? 0
    const overrideRaw = devMaps[mapKey]?.[id]?.[f.field]
    const current = overrideRaw ?? defaultRaw
    const inSeconds = f.seconds === true
    const displayDefault = inSeconds ? defaultRaw / SIM_TICK_HZ : defaultRaw
    makeNumberInput(
      t(`dev.overrides.${f.field}.label`),
      t(`dev.overrides.${f.field}.desc`),
      f.unit ? devUnit(f.unit) : undefined,
      inSeconds ? current / SIM_TICK_HZ : current,
      displayDefault,
      f.min,
      f.max,
      f.step,
      overrideRaw !== undefined,
      (v) => {
        if (Math.abs(v - displayDefault) < 1e-9) {
          clearDevOverride(mapKey, id, f.field)
          setDevStatus(t('dev.status.overrideDefault', { id, field: f.field, v: inSeconds ? `${displayDefault}s` : displayDefault }))
        } else {
          const raw = inSeconds ? SECONDS_TO_TICKS(v) : v
          setDevOverride(mapKey, id, f.field, raw)
          setDevStatus(t('dev.status.overrideSet', { id, field: f.field, v: inSeconds ? `${v}s (${raw} ticks)` : v }))
        }
      },
    )
  }
}

const buildDevForm = (): void => {
  devFormEl.innerHTML = ''
  const resolved = resolvedDevSettings()
  const g = getGraphics()
  appendDevSection(t('dev.sections.buildingFill'))
  makeNumberInput(
    t('dev.fields.buildingFillMedium.label'),
    t('dev.fields.buildingFillMedium.desc'),
    devUnit('0–1'),
    g.buildingFill.medium,
    DEFAULT_BUILDING_FILL.medium,
    0,
    1,
    0.05,
    Math.abs(g.buildingFill.medium - DEFAULT_BUILDING_FILL.medium) >= 1e-9,
    (v) => {
      setBuildingFill('medium', v)
      setDevStatus(t('dev.status.fillSet', { quality: t('settings.graphics.quality.medium'), v }))
    },
  )
  makeNumberInput(
    t('dev.fields.buildingFillHigh.label'),
    t('dev.fields.buildingFillHigh.desc'),
    devUnit('0–1'),
    g.buildingFill.high,
    DEFAULT_BUILDING_FILL.high,
    0,
    1,
    0.05,
    Math.abs(g.buildingFill.high - DEFAULT_BUILDING_FILL.high) >= 1e-9,
    (v) => {
      setBuildingFill('high', v)
      setDevStatus(t('dev.status.fillSet', { quality: t('settings.graphics.quality.high'), v }))
    },
  )
  makeNumberInput(
    t('dev.fields.buildingOffsetMedium.label'),
    t('dev.fields.buildingOffsetMedium.desc'),
    devUnit('0–1'),
    g.buildingOffset.medium,
    DEFAULT_BUILDING_OFFSET.medium,
    -2,
    2,
    0.05,
    Math.abs(g.buildingOffset.medium - DEFAULT_BUILDING_OFFSET.medium) >= 1e-9,
    (v) => {
      setBuildingOffset('medium', v)
      setDevStatus(t('dev.status.offsetSet', { quality: t('settings.graphics.quality.medium'), v }))
    },
  )
  makeNumberInput(
    t('dev.fields.buildingOffsetHigh.label'),
    t('dev.fields.buildingOffsetHigh.desc'),
    devUnit('0–1'),
    g.buildingOffset.high,
    DEFAULT_BUILDING_OFFSET.high,
    -2,
    2,
    0.05,
    Math.abs(g.buildingOffset.high - DEFAULT_BUILDING_OFFSET.high) >= 1e-9,
    (v) => {
      setBuildingOffset('high', v)
      setDevStatus(t('dev.status.offsetSet', { quality: t('settings.graphics.quality.high'), v }))
    },
  )
  appendDevSection(t('dev.sections.assets'))
  appendAssetGroupLabel(t('dev.assets.buildings'))
  for (const id of Object.keys(BUILDINGS)) {
    makeTextInput(
      tn(id, BUILDINGS[id].name),
      t('dev.fields.assetBuilding.desc'),
      g.assetPaths[`building:${id}`] ?? '',
      (v) => {
        setAssetPath(`building:${id}`, v)
        setDevStatus(t('dev.status.assetSaved'))
      },
    )
  }
  appendAssetGroupLabel(t('dev.assets.units'))
  for (const id of UNIT_ASSET_IDS) {
    makeTextInput(tn(id, UNITS[id]?.name ?? id), t('dev.fields.assetUnit.desc'), g.assetPaths[`unit:${id}`] ?? '', (v) => {
      setAssetPath(`unit:${id}`, v)
      setDevStatus(t('dev.status.assetSaved'))
    })
  }
  for (const cls of ['vehicle', 'infantry', 'air', 'naval'] as const) {
    makeNumberInput(
      t(`dev.fields.unitScale.${cls}.label`),
      t('dev.fields.unitScale.desc'),
      devUnit('x'),
      g.unitScale[cls],
      DEFAULT_UNIT_SCALE[cls],
      0.1,
      5,
      0.05,
      Math.abs(g.unitScale[cls] - DEFAULT_UNIT_SCALE[cls]) >= 1e-9,
      (v) => {
        setUnitScale(cls, v)
        setDevStatus(t('dev.status.saved'))
      },
    )
  }
  for (const cls of ['vehicle', 'infantry', 'air', 'naval'] as const) {
    makeNumberInput(
      t(`dev.fields.unitOffset.${cls}.label`),
      t('dev.fields.unitOffset.desc'),
      devUnit('0–1'),
      g.unitOffset[cls],
      DEFAULT_UNIT_OFFSET[cls],
      -2,
      2,
      0.05,
      Math.abs(g.unitOffset[cls] - DEFAULT_UNIT_OFFSET[cls]) >= 1e-9,
      (v) => {
        setUnitOffset(cls, v)
        setDevStatus(t('dev.status.saved'))
      },
    )
  }
  appendDevSection(t('dev.sections.layerOrder'))
  for (const kind of SPRITE_LAYER_KINDS) {
    makeNumberInput(
      t(`dev.fields.spriteLayer.${kind}.label`),
      t('dev.fields.spriteLayer.desc'),
      devUnit('1'),
      g.spriteLayerOrder[kind],
      DEFAULT_SPRITE_LAYER_ORDER[kind],
      -50,
      50,
      1,
      g.spriteLayerOrder[kind] !== DEFAULT_SPRITE_LAYER_ORDER[kind],
      (v) => {
        setSpriteLayerOrder(kind, v)
        setDevStatus(t('dev.status.saved'))
      },
    )
  }
  appendAssetGroupLabel(t('dev.assets.fields'))
  makeTextInput(
    t('dev.assets.supplyField'),
    t('dev.fields.fieldSupply.desc'),
    g.assetPaths['field:supply'] ?? '',
    (v) => {
      setAssetPath('field:supply', v)
      setDevStatus(t('dev.status.assetSaved'))
    },
  )
  makeTextInput(
    t('dev.assets.oilField'),
    t('dev.fields.fieldOil.desc'),
    g.assetPaths['field:oil'] ?? '',
    (v) => {
      setAssetPath('field:oil', v)
      setDevStatus(t('dev.status.assetSaved'))
    },
  )
  makeNumberInput(
    t('dev.fields.fieldOffset.label'),
    t('dev.fields.fieldOffset.desc'),
    devUnit('0–1'),
    g.fieldOffset,
    DEFAULT_FIELD_OFFSET,
    -2,
    2,
    0.05,
    Math.abs(g.fieldOffset - DEFAULT_FIELD_OFFSET) >= 1e-9,
    (v) => {
      setFieldOffset(v)
      setDevStatus(t('dev.status.saved'))
    },
  )
  makeNumberInput(
    t('dev.fields.fieldScale.label'),
    t('dev.fields.fieldScale.desc'),
    devUnit('x'),
    g.fieldScale,
    DEFAULT_FIELD_SCALE,
    0.1,
    5,
    0.05,
    Math.abs(g.fieldScale - DEFAULT_FIELD_SCALE) >= 1e-9,
    (v) => {
      setFieldScale(v)
      setDevStatus(t('dev.status.saved'))
    },
  )
  appendAssetGroupLabel(t('dev.assets.obstacles'))
  for (const k of OBSTACLE_ASSET_TYPES) {
    makeTextInput(k, t('dev.fields.assetObstacle.desc'), g.assetPaths[`obstacle:${k}`] ?? '', (v) => {
      setAssetPath(`obstacle:${k}`, v)
      setDevStatus(t('dev.status.assetSaved'))
    })
  }
  makeNumberInput(
    t('dev.fields.obstacleScale.label'),
    t('dev.fields.obstacleScale.desc'),
    devUnit('x'),
    g.obstacleScale,
    DEFAULT_OBSTACLE_SCALE,
    0.1,
    5,
    0.05,
    Math.abs(g.obstacleScale - DEFAULT_OBSTACLE_SCALE) >= 1e-9,
    (v) => {
      setObstacleScale(v)
      setDevStatus(t('dev.status.saved'))
    },
  )
  makeNumberInput(
    t('dev.fields.obstacleOffset.label'),
    t('dev.fields.obstacleOffset.desc'),
    devUnit('0–1'),
    g.obstacleOffset,
    DEFAULT_OBSTACLE_OFFSET,
    -2,
    2,
    0.05,
    Math.abs(g.obstacleOffset - DEFAULT_OBSTACLE_OFFSET) >= 1e-9,
    (v) => {
      setObstacleOffset(v)
      setDevStatus(t('dev.status.saved'))
    },
  )
  appendAssetGroupLabel(t('dev.assets.fx'))
  makeTextInput(t('dev.assets.burn'), t('dev.fields.assetBurn.desc'), g.assetPaths['fx:burn'] ?? '', (v) => {
    setAssetPath('fx:burn', v)
    setDevStatus(t('dev.status.assetSaved'))
    preloadFxFrames('burn')
  })
  makeNumberInput(
    t('dev.fields.fxScale.label'),
    t('dev.fields.fxScale.desc'),
    devUnit('x'),
    g.fxScale,
    DEFAULT_FX_SCALE,
    0.05,
    3,
    0.05,
    Math.abs(g.fxScale - DEFAULT_FX_SCALE) >= 1e-9,
    (v) => {
      setFxScale(v)
      setDevStatus(t('dev.status.saved'))
    },
  )
  makeNumberInput(
    t('dev.fields.fxOffset.label'),
    t('dev.fields.fxOffset.desc'),
    devUnit('0–1'),
    g.fxOffset,
    DEFAULT_FX_OFFSET,
    -2,
    2,
    0.05,
    Math.abs(g.fxOffset - DEFAULT_FX_OFFSET) >= 1e-9,
    (v) => {
      setFxOffset(v)
      setDevStatus(t('dev.status.saved'))
    },
  )
  appendAssetGroupLabel(t('dev.assets.minimap'))
  makeNumberInput(
    t('dev.fields.minimapScale.label'),
    t('dev.fields.minimapScale.desc'),
    devUnit('x'),
    g.minimapScale,
    DEFAULT_MINIMAP_SCALE,
    1.2,
    4,
    0.1,
    Math.abs(g.minimapScale - DEFAULT_MINIMAP_SCALE) >= 1e-9,
    (v) => {
      setMinimapScale(v)
      setDevStatus(t('dev.status.saved'))
    },
  )
  appendDevSection(t('dev.sections.match'))
  makeNumberInput(
    t('dev.fields.victoryCinematic.label'),
    t('dev.fields.victoryCinematic.desc'),
    devUnit('sec'),
    g.victoryCinematicSec,
    DEFAULT_VICTORY_CINEMATIC,
    0,
    30,
    1,
    g.victoryCinematicSec !== DEFAULT_VICTORY_CINEMATIC,
    (v) => {
      setVictoryCinematicSec(v)
      setDevStatus(t('dev.status.saved'))
    },
  )
  appendDevSection(t('dev.sections.zoom'))
  makeNumberInput(
    t('dev.fields.zoomMin.label'),
    t('dev.fields.zoomMin.desc'),
    devUnit('x'),
    g.zoomMin,
    DEFAULT_ZOOM_MIN,
    0.05,
    1,
    0.05,
    Math.abs(g.zoomMin - DEFAULT_ZOOM_MIN) >= 1e-9,
    (v) => {
      setZoomMin(v)
      setDevStatus(t('dev.status.saved'))
    },
  )
  makeNumberInput(
    t('dev.fields.zoomMax.label'),
    t('dev.fields.zoomMax.desc'),
    devUnit('x'),
    g.zoomMax,
    DEFAULT_ZOOM_MAX,
    1,
    20,
    0.05,
    Math.abs(g.zoomMax - DEFAULT_ZOOM_MAX) >= 1e-9,
    (v) => {
      setZoomMax(v)
      setDevStatus(t('dev.status.saved'))
    },
  )
  makeNumberInput(
    t('dev.fields.replayZoomMin.label'),
    t('dev.fields.replayZoomMin.desc'),
    devUnit('x'),
    g.replayZoomMin,
    DEFAULT_REPLAY_ZOOM_MIN,
    0.05,
    1,
    0.05,
    Math.abs(g.replayZoomMin - DEFAULT_REPLAY_ZOOM_MIN) >= 1e-9,
    (v) => {
      setReplayZoomMin(v)
      setDevStatus(t('dev.status.saved'))
    },
  )
  makeNumberInput(
    t('dev.fields.replayZoomMax.label'),
    t('dev.fields.replayZoomMax.desc'),
    devUnit('x'),
    g.replayZoomMax,
    DEFAULT_REPLAY_ZOOM_MAX,
    1,
    50,
    0.1,
    Math.abs(g.replayZoomMax - DEFAULT_REPLAY_ZOOM_MAX) >= 1e-9,
    (v) => {
      setReplayZoomMax(v)
      setDevStatus(t('dev.status.saved'))
    },
  )
  appendDevSection(t('dev.sections.audio'))
  {
    const wrap = document.createElement('div')
    wrap.className = 'dev-field'
    const l = document.createElement('label')
    l.textContent = t('dev.fields.audioPing.label')
    const d = document.createElement('div')
    d.className = 'dev-desc'
    d.textContent = t('dev.fields.audioPing.desc')
    const line = document.createElement('div')
    line.className = 'dev-audio-line'
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
    line.appendChild(pingBtn)
    wrap.appendChild(l)
    wrap.appendChild(d)
    wrap.appendChild(line)
    devGroupEl.appendChild(wrap)
  }
  appendAssetGroupLabel(t('dev.audio.ui'))
  for (const id of ['select', 'move-bleep', 'alert'] as SoundId[]) audioRow(id)
  appendAssetGroupLabel(t('dev.audio.weapons'))
  for (const id of ['weapon-rifle', 'weapon-rocket', 'weapon-cannon', 'weapon-artillery', 'weapon-air-cannon'] as SoundId[]) {
    audioRow(id)
  }
  appendAssetGroupLabel(t('dev.audio.events'))
  for (const id of ['unit-trained', 'building-completed', 'upgrade-completed', 'supply-harvested', 'combat-hit', 'laser-strike', 'airstrike-called', 'bomb-strike', 'emp-strike', 'grenade-exploded', 'smoke-landed', 'power-down', 'game-over', 'victory', 'achievement'] as SoundId[]) {
    audioRow(id)
  }
  appendAssetGroupLabel(t('dev.audio.ambient'))
  for (const id of ['ambient-lobby', 'ambient-game'] as SoundId[]) audioRow(id)
  appendAssetGroupLabel(t('dev.audio.weather'))
  for (const id of ['rain-ambient', 'snow-ambient', 'storm-ambient'] as SoundId[]) audioRow(id)
  for (const section of DEV_SCALAR_SECTIONS) {
    appendDevSection(t(`dev.sections.${section.title}`))
    for (const def of section.fields) {
      const currentRaw = resolved[def.key] as number
      const defaultRaw = DEFAULT_MATCH_SETTINGS[def.key] as number
      const inSeconds = def.seconds === true
      const displayCurrent = inSeconds ? currentRaw / SIM_TICK_HZ : currentRaw
      const displayDefault = inSeconds ? defaultRaw / SIM_TICK_HZ : defaultRaw
      const label = t(`dev.fields.${def.key}.label`)
      makeNumberInput(
        label,
        t(`dev.fields.${def.key}.desc`),
        def.unit ? devUnit(def.unit) : undefined,
        displayCurrent,
        displayDefault,
        def.min,
        def.max,
        def.step,
        currentRaw !== defaultRaw,
        (v) => {
          const isDefault = Math.abs(v - displayDefault) < 1e-9
          if (isDefault) clearDevScalar(def.key)
          else devOverrides = { ...devOverrides, [def.key]: inSeconds ? SECONDS_TO_TICKS(v) : Math.round(v) }
          setDevStatus(
            isDefault
              ? t('dev.status.scalarDefault', { label, v: inSeconds ? `${displayDefault}s` : displayDefault })
              : t('dev.status.scalarSet', {
                  label,
                  v: inSeconds ? `${v}s (${devOverrides[def.key]} ticks)` : (devOverrides[def.key] as number),
                }),
          )
        },
      )
    }
    if (section.title === 'fog') {
      const fogCurrent = resolved.fogMode
      const fogDefault = DEFAULT_MATCH_SETTINGS.fogMode
      makeSelectInput(
        t('dev.fields.fogMode.label'),
        t('dev.fields.fogMode.desc'),
        fogCurrent,
        FOG_MODES.map((m) => ({ value: m, label: t(`offline.fog.${m}`) })),
        fogDefault,
        (v) => {
          const next = v as FogMode
          if (next === fogDefault) clearDevScalar('fogMode')
          else devOverrides = { ...devOverrides, fogMode: next }
          setDevStatus(
            next === fogDefault
              ? t('dev.status.scalarDefault', { label: t('dev.fields.fogMode.label'), v: t(`offline.fog.${fogDefault}`) })
              : t('dev.status.scalarSet', { label: t('dev.fields.fogMode.label'), v: t(`offline.fog.${next}`) }),
          )
        },
      )
    }
  }
  appendDevSection(t('dev.sections.buildings'))
  for (const id of Object.keys(BUILDINGS)) {
    appendDevItemHeader(tn(id, BUILDINGS[id].name))
    buildOverrideInputs('buildingOverrides', id, OVERRIDE_BUILDING_FIELDS)
  }
  appendDevSection(t('dev.sections.units'))
  for (const id of Object.keys(UNITS)) {
    appendDevItemHeader(tn(id, UNITS[id].name))
    buildOverrideInputs('unitOverrides', id, OVERRIDE_UNIT_FIELDS)
  }
  appendDevSection(t('dev.sections.weapons'))
  for (const id of Object.keys(WEAPONS)) {
    appendDevItemHeader(WEAPONS[id].id)
    buildOverrideInputs('weaponOverrides', id, OVERRIDE_WEAPON_FIELDS)
  }
  appendDevSection(t('dev.sections.upgrades'))
  for (const id of Object.keys(UPGRADES)) {
    appendDevItemHeader(tn(id, UPGRADES[id].name))
    buildOverrideInputs('upgradeOverrides', id, OVERRIDE_UPGRADE_FIELDS)
  }
  if (PROFILE_TARGET_FIELDS.length > 0) appendDevSection(t('dev.sections.profile'))
  for (const field of PROFILE_TARGET_FIELDS) {
    const cfg = loadProfileConfig(window.localStorage)
    const current = cfg.achievementTargets[field.key] ?? field.target
    const changed = cfg.achievementTargets[field.key] !== undefined && current !== field.target
    makeNumberInput(
      t(`dev.fields.${field.key}.label`),
      t(`dev.fields.${field.key}.desc`),
      undefined,
      current,
      field.target,
      field.min,
      field.max,
      field.step,
      changed,
      (v) => {
        const next = loadProfileConfig(window.localStorage)
        next.achievementTargets[field.key] = Math.round(v)
        saveProfileConfig(window.localStorage, next)
        setDevStatus(t('dev.status.saved'))
        renderProfilePanel()
      },
    )
  }
}

devSaveBtn.addEventListener('click', () => {
  saveDevOverrides()
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
  savedDefaults = JSON.parse(JSON.stringify(devOverrides)) as Partial<MatchSettings>
  try {
    localStorage.setItem(DEV_DEFAULTS_KEY, JSON.stringify(savedDefaults))
  } catch {
    /* storage unavailable */
  }
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
  const mod = modFromSettings(devOverrides, { name, requireProtocol: PROTOCOL_VERSION })
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
buildDevForm()

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
let offlineMode: OfflineMode = 'bots'

/** Keep the match-option toggle hints in sync with their current state and language. */
const updateTrackingHints = (): void => {
  dailyAcceptHint.textContent = t(dailyAcceptToggle.checked ? 'daily.acceptOn' : 'daily.acceptOff')
  matchProfileHint.textContent = t(matchProfileToggle.checked ? 'daily.profileOn' : 'daily.profileOff')
}
dailyAcceptToggle.addEventListener('change', updateTrackingHints)
matchProfileToggle.addEventListener('change', updateTrackingHints)

const renderDaily = (): void => {
  const storage = window.localStorage
  const { missions, doneIds, allDone } = resolveDailyChallenge(storage)
  const label = document.getElementById('daily-day-label')
  const levelLabel = document.getElementById('daily-level-label')
  const list = document.getElementById('daily-missions-list') as HTMLDivElement
  const rec = loadModeRecords(storage).daily
  const level = dailyLevel(rec)
  const xp = dailyLevelXp(rec)
  if (label && rec?.challenge) label.textContent = t('daily.challenge', { n: rec.challenge.generation })
  if (levelLabel) levelLabel.textContent = t('daily.level', { level, xp, required: DAILY_XP_PER_LEVEL })
  list.innerHTML = ''
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
    list.appendChild(row)
  }
  const note = document.createElement('div')
  note.className = 'hint'
  note.textContent = allDone ? t('daily.allDone') : t('daily.keep', { n: missions.length - doneIds.length })
  list.appendChild(note)
}

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
    if (mod) start(makeCfg(mergeMatchSettings({ ...baseSettings, ...modSettingsDelta(baseSettings, mod) })))
    else start(makeCfg(baseSettings))
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

  if (isHost) {
    const startMatchBtn = document.createElement('button')
    startMatchBtn.className = 'primary'
    startMatchBtn.textContent = allReady
      ? t('match.start')
      : t('match.waitingReady', { r: nonSpectators.filter((p) => p.ready).length, t: nonSpectators.length })
    startMatchBtn.disabled = !allReady
    startMatchBtn.addEventListener('click', () => net?.start())
    matchActionsEl.appendChild(startMatchBtn)
  } else if (me && !me.spectator) {
    const readyBtn = document.createElement('button')
    readyBtn.className = 'primary'
    readyBtn.textContent = me.ready ? t('match.notReady') : t('match.readyBtn')
    readyBtn.addEventListener('click', () => net?.ready(!me.ready))
    matchActionsEl.appendChild(readyBtn)
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

const syncPanelEl = document.getElementById('sync-panel') as HTMLDivElement
const syncPlayersEl = document.getElementById('sync-players') as HTMLDivElement
const syncOnceBtn = document.getElementById('sync-once') as HTMLButtonElement
const syncCopyBtn = document.getElementById('sync-copy') as HTMLButtonElement

let devPublishedConn = false
let syncSelectedId: number | null = null

const cloneDevSettingsFrom = (their: Partial<MatchSettings>, save: boolean): void => {
  devOverrides = JSON.parse(JSON.stringify(their)) as Partial<MatchSettings>
  buildDevForm()
  if (save) saveDevOverrides()
  if (net?.connected && lobbyState) {
    net.publishDevSettings(resolvedDevSettings())
    if (lobbyState.yourId === lobbyState.hostId) net.updateRoom({ settings: resolvedDevSettings() })
  }
  setDevStatus(t(save ? 'dev.status.saved' : 'dev.status.syncedOnce'))
  renderSyncList()
}

const renderSyncList = (): void => {
  if (!lobbyState || !syncPanelEl) return
  const myFp = settingsFingerprint(resolvedDevSettings())
  const matchFp = settingsFingerprint(mergeMatchSettings(lobbyState.settings ?? {}))
  syncPlayersEl.innerHTML = ''
  let selectable = 0
  for (const p of lobbyState.players) {
    if (p.bot) continue
    const isMe = p.id === lobbyState.yourId
    const their = p.devSettings !== undefined ? mergeMatchSettings(p.devSettings) : null
    const same = isMe || (their !== null && settingsFingerprint(their) === myFp)
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
    if (sel?.devSettings) cloneDevSettingsFrom(sel.devSettings, false)
  }
  syncCopyBtn.onclick = () => {
    if (sel?.devSettings) cloneDevSettingsFrom(sel.devSettings, true)
  }
  void selectable
}

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
      if (!devPublishedConn) {
        devPublishedConn = true
        net?.publishDevSettings(resolvedDevSettings())
      }
      renderMatchPanel(msg)
      setTab('match')
    },
    onMatchStart: (msg: MatchStartMessage) => {
      lobbyAudio.stopAmbient()
      if (!game) game = makeGame()
      hideLobby()
      netJoinedResumed = (msg as { resumed?: boolean }).resumed === true
      void game.startNet(net!, msg)
      saveActiveMatch()
      if (isOnlineAddr(lastJoin?.addr)) startPing()
    },
    onSpectateSync: (msg) => {
      if (netJoinedResumed) game?.catchUpSync(msg)
      else game?.applySpectateSync(msg)
    },
    onPong: () => {
      const start = netPingStart
      if (start > 0) {
        netPingStart = 0
        game?.setPingMs(Math.max(1, Math.round(performance.now() - start)))
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
        // The room behind this invite link is gone — drop the code and land on the normal lobby.
        window.location.href = window.location.origin + window.location.pathname
        return
      }
      if (lobbyState === null && /already started/i.test(message)) {
        // A running match has no free player seat — offer to watch it as a spectator.
        setJoinBusy(false)
        roomFullJoin = { addr, code, pass, name }
        roomfullOverlayEl.classList.add('visible')
        return
      }
      setJoinBusy(false)
      if (lobbyState) setMatchStatus(t('game.error', { msg: message }), true)
      else if (isOnlineAddr(lastJoin?.addr)) setOnlineStatus(t('game.error', { msg: message }), true)
      else setNetStatus(t('game.error', { msg: message }), true)
    },
    onClose: () => {
      if (game) {
        if (reconnectPhase === 'off') beginReconnect()
        return
      }
      clearActiveMatch()
      setJoinBusy(false)
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
    if (isOnlineAddr(lastJoin?.addr)) setOnlineStatus(t('network.status.serverUnreachable'), true)
    else setNetStatus(t('network.status.serverUnreachable'), true)
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

const startPing = (): void => {
  if (netPingTimer !== null) return
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
  roomfullOverlayEl.classList.remove('visible')
  const join = roomFullJoin
  roomFullJoin = null
  if (join) void connectJoin(join.addr, join.code, join.pass, join.name, false, { spectator: true })
})

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
        void game.startNet(n, msg)
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
    await n.join(join.code, join.pass, join.name, spectator)
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
      const res = await fetch(`${ONLINE_URL}/api/rooms`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hostName: name, passphrase: pass }),
      })
      const data = (await res.json()) as { ok: boolean; roomCode?: string; error?: string }
      if (!res.ok || !data.ok || !data.roomCode) {
        setOnlineStatus(t('game.error', { msg: data.error ?? t('network.status.createFailed') }), true)
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
    if (!netAddrEl.value) netAddrEl.value = `${data.self.ip}:${data.self.port}`
    if (!netAddrManualEl.value) netAddrManualEl.value = `${data.self.ip}:${data.self.port}`
    const hostDevice = data.self.hostDevice
    netCreateBtn.style.display = hostDevice ? '' : 'none'
    netPlayersTitleEl.style.display = hostDevice ? '' : 'none'
    netPlayersEl.style.display = hostDevice ? '' : 'none'
    const others = data.players.filter((p) => !(p.ip === data.self.ip && p.port === data.self.port))
    renderNetPlayers(others, data.self)
    renderNetMatches(data.players)
    renderLobbyChat(data.chat)
  } catch {
    /* local host server not reachable (e.g. vite dev without host) */
  }
}

const lobbyVisible = (): boolean => {
  if (!lobbyEl) lobbyEl = document.getElementById('lobby') as HTMLElement
  return getComputedStyle(lobbyEl).display !== 'none'
}

window.setInterval(() => {
  if (lobbyVisible()) void pollNetwork()
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
  updateTrackingHints()
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
    void connectJoin(window.location.host, inviteCode, invitePass, netNameEl.value.trim() || 'Commander', true)
  }, AUTO_JOIN_DELAY_MS)
}

// ---------- hide loading screen ----------

void Promise.allSettled([graphicsReady, audioReady, mapBuilderReady, infoCatalogReady]).then(() => {
  const el = document.getElementById('loading-screen')
  if (el) {
    el.classList.add('hidden')
    window.setTimeout(() => el.remove(), 500)
  }
})

// ---------- offer to resume a running match after a page reload ----------

const stashedMatch = readActiveMatch()
if (stashedMatch) {
  pendingResume = stashedMatch
  void Promise.allSettled([graphicsReady, audioReady, mapBuilderReady, infoCatalogReady]).then(() => {
    if (stashedMatch === pendingResume && !inviteCode) resumeOverlayEl.classList.add('visible')
  })
}
