import './styles.css'
import { BUILDINGS, UNITS, UPGRADES, WEAPONS, SIM_TICK_HZ, SECONDS_TO_TICKS, crc32, mergeMatchSettings, DEFAULT_MATCH_SETTINGS, DEFAULT_CREDITS, PLAYER_COLORS, type MatchSettings, type WinRule } from '@space-arenas/shared'
import { MAP_PRESETS, mapForPreset, type MapData } from '@space-arenas/shared'
import { Game } from './game/Game.ts'
import { NetClient } from './net/net.ts'
import type { LobbyMessage, MatchStartMessage } from '@space-arenas/shared'
import type { MatchConfig } from './game/match.ts'
import { MapPreview } from './ui/map-preview.ts'
import { createPlayerRow } from './ui/player-row.ts'
import { BOT_DIFFICULTIES, type BotDifficulty } from './ai/bot.ts'
import { initControlsSettings } from './ui/controls-settings.ts'
import { WEATHERS, type WeatherId, getGraphics, setWeather, setBuildingFill, setBuildingOffset, setFieldOffset, setUnitScale, setAssetPath, DEFAULT_BUILDING_FILL, DEFAULT_BUILDING_OFFSET, DEFAULT_FIELD_OFFSET, DEFAULT_UNIT_SCALE, UNIT_ASSET_IDS, OBSTACLE_ASSET_TYPES } from './ui/graphics.ts'
import { initLang, setLang, getLang, t, tn, translateStatic, onLangChange, type Lang } from './i18n/index.ts'
import { allMapEntries, entryToMap, findMapEntry, migrateLegacyLibrary, type MapEntry } from './mapbuilder/library.ts'

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

const hideLobby = (): void => {
  ;(document.getElementById('lobby') as HTMLDivElement).style.display = 'none'
}

const showLobby = (): void => {
  game = null
  const wasNet = net !== null
  if (wasNet) {
    net = null
    lobbyState = null
  }
  ;(document.getElementById('lobby') as HTMLDivElement).style.display = 'flex'
  if (wasNet) setTab('network')
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
const tabOffline = document.getElementById('tab-offline') as HTMLButtonElement
const tabNetwork = document.getElementById('tab-network') as HTMLButtonElement
const tabOnline = document.getElementById('tab-online') as HTMLButtonElement
const tabMapBuilder = document.getElementById('tab-mapbuilder') as HTMLButtonElement
const tabInfo = document.getElementById('tab-info') as HTMLButtonElement
const tabSettings = document.getElementById('tab-settings') as HTMLButtonElement
const tabDev = document.getElementById('tab-dev') as HTMLButtonElement

const setTab = (which: 'offline' | 'network' | 'match' | 'online' | 'mapbuilder' | 'info' | 'settings' | 'dev'): void => {
  offlinePanel.classList.toggle('hidden-panel', which !== 'offline')
  networkPanel.classList.toggle('hidden-panel', which !== 'network')
  matchPanel.classList.toggle('hidden-panel', which !== 'match')
  onlinePanel.classList.toggle('hidden-panel', which !== 'online')
  mapbuilderPanel.classList.toggle('hidden-panel', which !== 'mapbuilder')
  infoPanel.classList.toggle('hidden-panel', which !== 'info')
  settingsPanel.classList.toggle('hidden-panel', which !== 'settings')
  devPanel.classList.toggle('hidden-panel', which !== 'dev')
  tabOffline.classList.toggle('active', which === 'offline')
  tabNetwork.classList.toggle('active', which === 'network')
  tabOnline.classList.toggle('active', which === 'online')
  tabMapBuilder.classList.toggle('active', which === 'mapbuilder')
  tabInfo.classList.toggle('active', which === 'info')
  tabSettings.classList.toggle('active', which === 'settings')
  tabDev.classList.toggle('active', which === 'dev')
}

tabOffline.addEventListener('click', () => setTab('offline'))
tabNetwork.addEventListener('click', () => setTab('network'))
tabOnline.addEventListener('click', () => setTab('online'))
tabMapBuilder.addEventListener('click', () => setTab('mapbuilder'))
tabInfo.addEventListener('click', () => setTab('info'))
tabSettings.addEventListener('click', () => setTab('settings'))
tabDev.addEventListener('click', () => setTab('dev'))

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
onLangChange(() => refreshLobbyTexts())
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

// ---------- online server (preview) ----------

const onlineStatusEl = document.getElementById('online-status') as HTMLDivElement
const onlineMatchesBody = document.getElementById('online-matches-table')!.querySelector('tbody')!

const setOnlineStatus = (text: string, isError = false): void => {
  onlineStatusEl.textContent = text
  onlineStatusEl.classList.toggle('error', isError)
}

const renderOnlineMatches = (): void => {
  onlineMatchesBody.innerHTML = ''
  const tr = document.createElement('tr')
  const td = document.createElement('td')
  td.colSpan = 4
  td.className = 'net-empty'
  td.textContent = t('online.noMatches')
  tr.appendChild(td)
  onlineMatchesBody.appendChild(tr)
}

const ONLINE_PLACEHOLDER_BUTTONS: Record<string, string> = {
  'online-login': 'online.planned',
  'online-register': 'online.planned',
  'online-change-pass': 'online.planned',
  'online-connect': 'online.planned',
  'online-create': 'online.planned',
  'online-join': 'online.planned',
}
for (const [id, msgKey] of Object.entries(ONLINE_PLACEHOLDER_BUTTONS)) {
  document.getElementById(id)!.addEventListener('click', () => setOnlineStatus(t(msgKey)))
}
document.getElementById('online-refresh')!.addEventListener('click', () => {
  renderOnlineMatches()
  setOnlineStatus(t('online.refreshed'))
})
document.getElementById('online-clear-table')!.addEventListener('click', () => {
  renderOnlineMatches()
  setOnlineStatus('')
})
renderOnlineMatches()

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
      { key: 'harvesterLoadTicks', unit: 'sec', min: 0.1, max: 120, step: 0.1, seconds: true },
      { key: 'builderRepairPerTick', unit: 'hp/tick', min: 0, max: 100000, step: 5 },
      { key: 'sellRefundFraction', unit: '0–1', min: 0, max: 1, step: 0.05 },
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
    title: 'fog',
    fields: [{ key: 'fogFadeDistance', unit: 'cells', min: 0, max: 30, step: 1 }],
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
  input.placeholder = 'path/to/image_{frame}_{color}.png'
  input.addEventListener('change', () => onCommit(input.value.trim()))
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
  for (const cls of ['vehicle', 'infantry', 'air'] as const) {
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
  appendAssetGroupLabel(t('dev.assets.scenery'))
  for (const k of OBSTACLE_ASSET_TYPES) {
    makeTextInput(k, t('dev.fields.assetObstacle.desc'), g.assetPaths[`obstacle:${k}`] ?? '', (v) => {
      setAssetPath(`obstacle:${k}`, v)
      setDevStatus(t('dev.status.assetSaved'))
    })
  }
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
  if (game) {
    game.destroy()
    game = null
  }
  game = makeGame()
  hideLobby()
  void game.startOffline(cfg)
}

startBtn.addEventListener('click', () => {
  const humans = rows.filter((r) => !r.difficulty)
  if (humans.length === 0) {
    setOfflineStatus(t('offline.status.needHuman'), true)
    return
  }
  if (rows.length < 2) {
    setOfflineStatus(t('offline.status.needOpponent'), true)
    return
  }
  const credits = Number(creditsInput.value) || DEFAULT_CREDITS
  if (WEATHERS.includes(startWeatherEl.value as WeatherId)) setWeather(startWeatherEl.value as WeatherId)
  const cfg: MatchConfig = {
    map: previewMap,
    seed: (Math.floor(Math.random() * 0xffffffff) >>> 0) || 0x5eed,
    credits,
    localTeam: humans[0].slot,
    slots: rows.map((r) => ({ team: r.slot, name: r.name, difficulty: r.difficulty, alliance: r.team, color: r.color })),
    winRule: winRuleSelect.value as WinRule,
    settings: resolvedDevSettings(),
  }
  setOfflineStatus('')
  startCountdown(cfg)
})

renderMapSelect()
renderPlayers()
preview.render(previewMap, previewColorFor)

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
  net?.close()
  net = null
  lobbyState = null
  devPushedToRoom = false
  setTab('network')
  setNetStatus(t('network.status.left'))
}

const renderMatchOptions = (msg: LobbyMessage, isHost: boolean): void => {
  const startingCredits = msg.settings?.startingCredits ?? DEFAULT_MATCH_SETTINGS.startingCredits
  matchCreditsEl.value = String(startingCredits)
  matchCreditsEl.disabled = !isHost

  const winRule = msg.winRule ?? 'standard'
  matchWinRuleEl.value = winRule
  matchWinRuleEl.disabled = !isHost
  matchWinRuleDescEl.textContent = t(`offline.winDesc.${WIN_RULE_KEYS[winRule]}`)

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
  const allReady = nonSpectators.every((p) => p.ready)

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
    localStorage.setItem('space-arenas:name', name)
    void fetch('/api/self', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    }).catch(() => undefined)
  }, 400)
})

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

const connectJoin = async (addr: string, code: string, pass: string, name: string, fromInviteLink = false): Promise<void> => {
  if (!code) {
    setNetStatus(t('network.status.needCode'), true)
    return
  }
  setJoinBusy(true)
  setNetStatus(t('network.status.connecting'))
  net = new NetClient({
    onLobby: (msg) => {
      localTeam = msg.yourId
      if (!devPublishedConn) {
        devPublishedConn = true
        net?.publishDevSettings(resolvedDevSettings())
      }
      renderMatchPanel(msg)
      setTab('match')
    },
    onMatchStart: (msg: MatchStartMessage) => {
      if (!game) game = makeGame()
      hideLobby()
      void game.startNet(net!, msg)
    },
    onSpectateSync: (msg) => {
      game?.applySpectateSync(msg)
    },
    onFrame: (tick, commands) => game?.applyFrame(tick, commands),
    onRelayChecksum: (player, tick, crc) => game?.onNetChecksum(player, tick, crc),
    onChecksum: () => undefined,
    onChat: (msg) => game?.onNetChat(msg),
    onGameOver: (winner) => {
      game?.onNetGameOver(winner)
      if (!game) netStatusEl.textContent = winner !== null && winner === localTeam ? t('menu.victory') : t('menu.defeat')
    },
    onError: (message) => {
      if (fromInviteLink && /room not found/i.test(message)) {
        // The room behind this invite link is gone — drop the code and land on the normal lobby.
        window.location.href = window.location.origin + window.location.pathname
        return
      }
      setJoinBusy(false)
      if (lobbyState) setMatchStatus(t('game.error', { msg: message }), true)
      else setNetStatus(t('game.error', { msg: message }), true)
    },
    onClose: () => {
      setJoinBusy(false)
      if (game) {
        game.destroy()
        game = null
        showLobby()
        setTab('network')
        setNetStatus(t('network.status.lost'))
        return
      }
      if (lobbyState) {
        lobbyState = null
        devPushedToRoom = false
        devPublishedConn = false
        syncSelectedId = null
        setTab('network')
        setNetStatus(t('network.status.disconnectedMatch'))
        return
      }
      if (!networkPanel.classList.contains('hidden-panel')) setNetStatus(t('network.status.disconnected'))
    },
    onOpen: () => undefined,
  })

  try {
    await net.connect(`ws://${addr}/ws`)
  } catch {
    setJoinBusy(false)
    setNetStatus(t('network.status.serverUnreachable'), true)
    return
  }
  setNetStatus(t('network.status.joining'))
  await net.join(code, pass, name)
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
    const btn = document.createElement('button')
    btn.textContent = m.started ? t('network.spectate') : t('network.join')
    if (m.started) btn.classList.add('spec')
    if (joinBusy) {
      btn.disabled = true
      btn.textContent = t('network.status.joining')
    }
    const select = (): void => {
      selectedMatch = m
      for (const s of netMatchesEl.querySelectorAll('.net-item')) s.classList.remove('selected')
      row.classList.add('selected')
      netAddrManualEl.value = `${m.ip}:${m.port}`
      netCodeEl.value = m.roomCode ?? ''
    }
    row.addEventListener('click', select)
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      select()
      joinSelectedOrManual()
    })
    row.appendChild(who)
    row.appendChild(ip)
    row.appendChild(status)
    row.appendChild(btn)
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
})
netCreateBtn.addEventListener('click', () => {
  createAddrEl.value = netAddrEl.value || t('network.addrPlaceholder')
  createPassEl.value = ''
  createOverlay.classList.add('visible')
})
createOkBtn.addEventListener('click', async () => {
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
  if (joinBusy) setJoinBusy(true)
  renderMapSelect()
  renderPlayers()
  winRuleDesc.textContent = t(`offline.winDesc.${WIN_RULE_KEYS[winRuleSelect.value as WinRule]}`)
  buildDevForm()
  renderOnlineMatches()
  renderMapBuilderTable()
  renderGraphicsList()
  renderWeatherOptions(startWeatherEl)
  renderWeatherOptions(matchWeatherEl)
  if (controlsOverlay.classList.contains('visible')) renderControlsList()
  if (controlsInfoOverlay.classList.contains('visible')) controlsInfoContent.innerHTML = controlsInfoHtml()
  renderActiveInfoTab()
  if (lobbyState) renderSyncList()
  if (lobbyState) renderMatchPanel(lobbyState)
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

void Promise.allSettled([graphicsReady, mapBuilderReady, infoCatalogReady]).then(() => {
  const el = document.getElementById('loading-screen')
  if (el) {
    el.classList.add('hidden')
    window.setTimeout(() => el.remove(), 500)
  }
})
