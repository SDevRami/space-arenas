import { BUILDINGS, UNITS, UPGRADES, canThrowBandolier, getBuilding, getUnit, generateDefaultMap, tileToFx, SIM_TICK_HZ, SECONDS_TO_TICKS, PROTOCOL_VERSION, replayDateLabel, defaultReplayName, type ChatRelayMessage, type EnvelopeCommand, type MatchStartMessage, type PlayerSlot, type ReplayData, type SimCommand, type SpectateSyncMessage, type PingType } from '@space-arenas/shared'
import { World, placementExplored, type WorldGrid } from '../core/world.ts'
import { Simulator } from '../core/Simulator.ts'
import { GameLoop } from '../core/loop.ts'
import { Renderer, type GhostState } from '../render/renderer.ts'
import { InputManager, type BoxInfo, type ClickInfo, type CommandKind } from '../input/input.ts'
import { NetClient } from '../net/net.ts'
import { AudioHooks } from '../audio/hooks.ts'
import { hapticSelect, hapticAction, hapticDamaged } from '../audio/haptics.ts'
import { Hud } from '../ui/hud.ts'
import { ChatBox } from '../ui/chat.ts'
import { Minimap } from '../render/minimap.ts'
import { rectFromCenter } from '../core/geometry.ts'
import { stepWorld } from '../systems/registry.ts'
import type { SimEvent } from '../core/events.ts'
import { BotPlayer } from '../ai/bot.ts'
import type { MatchConfig } from './match.ts'
import { generateDailyMissions, evaluateDailyMissions, type DailyMissionDef } from '../modes/daily.ts'
import { recordDailyResult, dailyLevel, dailyLevelXp, DAILY_XP_PER_LEVEL, remainingDailyMissions, loadModeRecords } from '../profile/modeRecords.ts'
import { StatsBoard, StatsTracker, buildStatsRows, type StatsRow } from '../stats/stats.ts'
import { SessionRecorder } from '../profile/recorder.ts'
import { loadProfile, loadProfileConfig, recordMatch, recordSpectate, freshCounters, achievementTarget, type ProfileCounters, type ProfileTypeCounts } from '../profile/profile.ts'
import { ACHIEVEMENTS, achievementProgress } from '../profile/achievements.ts'
import { t, tn } from '../i18n/index.ts'
import { getControls, modifierLabel } from '../ui/controls.ts'
import { getGraphics } from '../ui/graphics.ts'
import { WeatherOverlay } from '../render/weather.ts'

const PRODUCERS = new Set(['command-center', 'supply-dock', 'barracks', 'war-factory', 'air-force', 'dock'])

const isTypingTarget = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
}

/** Skip-ahead/back jump for the replay transport bar, in sim seconds. */
const REPLAY_JUMP_SECONDS = 10
/** Playback speed multipliers offered on the replay transport bar. */
const REPLAY_SPEEDS = [0.25, 0.5, 1, 2, 4] as const

export type GameMode = 'offline' | 'net' | 'replay'

export class Game {
  private world: World | null = null
  private sim: Simulator | null = null
  private loop: GameLoop | null = null
  private renderer: Renderer | null = null
  private weather: WeatherOverlay | null = null
  private input: InputManager | null = null
  private hud: Hud
  private audio = new AudioHooks()
  private net: NetClient | null = null
  private mode: GameMode = 'offline'
  private localTeam = 0
  private selection = new Set<number>()
  private controlGroups = new Map<number, number[]>()
  private moveMarker: { x: number; y: number; until: number; color: number } | null = null
  private baseAlertCooldowns = new Map<number, number>()
  private pendingPlace: { buildingType: string; dozerId: number } | null = null
  private seq = 0
  private pendingCmds: EnvelopeCommand[] = []
  private localHash = 0
  private syncOk = true
  private pendingChecks = new Map<number, number>()
  private paused = false
  private finished = false
  private resultsShown = false
  private bots: BotPlayer[] = []
  private stats = new StatsTracker()
  private session: SessionRecorder | null = null
  private matchStartedAt = 0
  private profileRecorded = false
  private matchMapLabel = ''
  private achNotified = new Set<string>()
  private lastAchCheckTick = -1
  private modeCfg: MatchConfig | null = null
  /** Match-option toggles (offline): daily missions accepted and profile counted. */
  private trackDaily = true
  private trackProfile = true
  private netPlayers: PlayerSlot[] = []
  private spectator = false
  private team = 0
  private chat: ChatBox | null = null
  private pendingSpectate: SpectateSyncMessage | null = null
  private replayHistory: EnvelopeCommand[] = []
  private replayIndex = 0
  private replayTicks = 0
  private replayWinner: number | null = null
  private recordHistory: EnvelopeCommand[] = []
  private recordTicks = 0
  private replayRecorded = false
  private dailyMissionDefs: DailyMissionDef[] | null = null
  private lastModeNote: string | null = null
  private currentStartMsg: MatchStartMessage | null = null
  private replayPlaying = false
  private replaySpeed: (typeof REPLAY_SPEEDS)[number] = 1
  private pendingSeek: number | null = null
  private seekActive = false
  private seekTarget = 0
  private sliderDragging = false
  private replayBar = document.getElementById('replay-bar') as HTMLDivElement
  private replayTimeEl = document.getElementById('replay-time') as HTMLDivElement
  private replaySlider = document.getElementById('replay-slider') as HTMLInputElement
  private replayPlayBtn = document.getElementById('replay-play') as HTMLButtonElement
  private replayRestartBtn = document.getElementById('replay-restart') as HTMLButtonElement
  private replayBackBtn = document.getElementById('replay-back') as HTMLButtonElement
  private replayFwdBtn = document.getElementById('replay-fwd') as HTMLButtonElement
  private replaySpeedBtn = document.getElementById('replay-speed') as HTMLButtonElement
  private replayHudToggle = document.getElementById('replay-hud-toggle') as HTMLButtonElement
  private menuBtn: HTMLButtonElement
  private menuOverlay: HTMLDivElement
  private menuSaveReplayBtn: HTMLButtonElement
  private menuResumeBtn: HTMLButtonElement
  private menuQuitBtn: HTMLButtonElement
  private resultsOverlay: HTMLDivElement
  private resultsSaveReplayBtn: HTMLButtonElement
  private resultsQuitBtn: HTMLButtonElement
  private resultsWinner: number | null = null
  private cinematicOverlay: HTMLDivElement
  private cinematicText: HTMLDivElement
  private cinematicActive = false
  private cinematicUntil = 0
  private cinematicWinner: number | null = null
  private menuStatsBoard: StatsBoard
  private resultsBoard: StatsBoard
  private mm: Minimap | null = null
  private mmWrap: HTMLElement | null = null
  private mmResizeObserver: ResizeObserver | null = null
  private pingBtns: HTMLButtonElement[] = []
  private devBtns: HTMLButtonElement[] = []
  private pingMode: PingType | null = null
  private devBtn: HTMLButtonElement | null = null
  private devOverlay: HTMLDivElement | null = null
  private devCloseBtn: HTMLButtonElement | null = null
  private devPerfEl: HTMLElement | null = null
  private devShortcutsEl: HTMLElement | null = null
  private devOverlayVisible = false
  private hudPartToggles: Array<{ el: HTMLElement; key: string; on: boolean }> = []
  private toolsBar: HTMLElement | null = null
  private satelliteBtn: HTMLButtonElement | null = null
  private laserBtn: HTMLButtonElement | null = null
  private strikeBtn: HTMLButtonElement | null = null
  private idleWorkerBtn: HTMLButtonElement | null = null
  private idleDozerBtn: HTMLButtonElement | null = null
  private logToggle: HTMLButtonElement | null = null
  private keysToggle: HTMLButtonElement | null = null
  private groupsDoneBtn: HTMLButtonElement | null = null
  private groupsOverlay: HTMLDivElement
  private groupsSig = ''
  private groupModDown = false
  private pendingLaser = false
  private pendingAirstrike = false
  private pendingEmp = false
  /** Per-unit armed toggles: unit id → grenade or smoke throw. Selection only
   * drives the HUD buttons/rings; each unit keeps its own armed state. */
  private abilityModes = new Map<number, 'grenade' | 'smoke'>()
  /** Smoke canisters whose landing puff audio already played (client-only). */
  private announcedSmokes = new Set<number>()
  /** Per-unit mine toggles: unit id → place or remove. Same per-unit rule. */
  private mineModes = new Map<number, 'place' | 'remove'>()
  private pendingSpawnPoint = false
  private pendingFlag = false
  /** Unload Here mode: next click unloads every selected loaded transport at the point. */
  private pendingUnload = false

  /** Click-to-eject a single rider out of its transport, right beside it. */
  private unloadOne(transportId: number, index: number): void {
    this.issue({ type: 'transport-unload', entities: [], x: 0, y: 0, transportId, index })
    this.hud.toast(t('game.unloadOrdered'))
  }
  private holdPlaced = false
  private multiPosMode = false
  private multiRoute: { ids: number[]; pts: Array<{ x: number; y: number }>; idx: number } | null = null
  private mobileControls: HTMLElement | null = null
  private selectionToggle: HTMLButtonElement | null = null
  private logVisible = false
  private confirmOverlay: HTMLDivElement
  private confirmMessage: HTMLParagraphElement
  private confirmYesBtn: HTMLButtonElement
  private confirmNoBtn: HTMLButtonElement
  private readonly onQuit?: () => void

  constructor(container: HTMLElement, options?: { onQuit?: () => void }) {
    void container
    this.onQuit = options?.onQuit
    this.menuBtn = document.getElementById('menu-btn') as HTMLButtonElement
    this.menuOverlay = document.getElementById('menu-overlay') as HTMLDivElement
    this.groupsOverlay = document.getElementById('groups-overlay') as HTMLDivElement
    this.menuSaveReplayBtn = document.getElementById('menu-save-replay') as HTMLButtonElement
    this.menuResumeBtn = document.getElementById('menu-resume') as HTMLButtonElement
    this.menuQuitBtn = document.getElementById('menu-quit') as HTMLButtonElement
    this.resultsOverlay = document.getElementById('results-overlay') as HTMLDivElement
    this.resultsSaveReplayBtn = document.getElementById('results-save-replay') as HTMLButtonElement
    this.resultsQuitBtn = document.getElementById('results-quit') as HTMLButtonElement
    this.cinematicOverlay = document.getElementById('cinematic-overlay') as HTMLDivElement
    this.cinematicText = document.getElementById('cinematic-text') as HTMLDivElement
    this.confirmOverlay = document.getElementById('confirm-overlay') as HTMLDivElement
    this.confirmMessage = document.getElementById('confirm-message') as HTMLParagraphElement
    this.confirmYesBtn = document.getElementById('confirm-yes') as HTMLButtonElement
    this.confirmNoBtn = document.getElementById('confirm-cancel') as HTMLButtonElement
    this.menuStatsBoard = new StatsBoard(document.getElementById('menu-stats') as HTMLElement)
    this.resultsBoard = new StatsBoard(document.getElementById('results-board') as HTMLElement)
    this.menuBtn.addEventListener('click', this.onMenuBtnClick)
    this.menuSaveReplayBtn.addEventListener('click', this.onMenuSaveReplayClick)
    this.menuResumeBtn.addEventListener('click', this.onMenuResumeClick)
    this.menuQuitBtn.addEventListener('click', this.onMenuQuitClick)
    this.resultsSaveReplayBtn.addEventListener('click', this.onResultsSaveReplayClick)
    this.resultsQuitBtn.addEventListener('click', this.onResultsQuitClick)
    this.replayPlayBtn.addEventListener('click', this.onReplayPlayClick)
    this.replayRestartBtn.addEventListener('click', this.onReplayRestartClick)
    this.replayBackBtn.addEventListener('click', this.onReplayBackClick)
    this.replayFwdBtn.addEventListener('click', this.onReplayFwdClick)
    this.replaySpeedBtn.addEventListener('click', this.onReplaySpeedClick)
    this.replayHudToggle.addEventListener('click', this.onReplayHudToggleClick)
    this.replaySlider.addEventListener('input', () => {
      this.sliderDragging = true
      this.scheduleSeek(Number(this.replaySlider.value))
    })
    this.replaySlider.addEventListener('change', () => {
      this.sliderDragging = false
      this.scheduleSeek(Number(this.replaySlider.value))
    })
    this.confirmYesBtn.addEventListener('click', this.onConfirmYesClick)
    this.confirmNoBtn.addEventListener('click', this.onConfirmNoClick)
    this.toolsBar = document.getElementById('tools-bar')
    this.satelliteBtn = document.getElementById('tool-satellite') as HTMLButtonElement | null
    this.satelliteBtn?.addEventListener('click', this.onSatelliteClick)
    this.laserBtn = document.getElementById('tool-laser') as HTMLButtonElement | null
    this.laserBtn?.addEventListener('click', this.onLaserClick)
    this.strikeBtn = document.getElementById('tool-strike') as HTMLButtonElement | null
    this.strikeBtn?.addEventListener('click', this.onStrikeClick)
    this.idleWorkerBtn = document.getElementById('tool-idle') as HTMLButtonElement | null
    this.idleWorkerBtn?.addEventListener('click', this.onIdleWorkerClick)
    this.idleDozerBtn = document.getElementById('tool-dozer') as HTMLButtonElement | null
    this.idleDozerBtn?.addEventListener('click', this.onIdleDozerClick)
    this.logToggle = document.getElementById('log-toggle') as HTMLButtonElement | null
    this.logToggle?.addEventListener('click', this.onLogToggleClick)
    this.keysToggle = document.getElementById('keys-toggle') as HTMLButtonElement | null
    this.keysToggle?.addEventListener('click', this.onKeysToggleClick)
    this.devBtn = document.getElementById('dev-btn') as HTMLButtonElement | null
    this.devBtn?.addEventListener('click', this.onDevClick)
    this.devOverlay = document.getElementById('dev-overlay') as HTMLDivElement | null
    this.devPerfEl = document.getElementById('dev-perf') as HTMLElement | null
    this.devShortcutsEl = document.getElementById('dev-shortcuts') as HTMLElement | null
    this.devCloseBtn = document.getElementById('dev-close') as HTMLButtonElement | null
    this.devCloseBtn?.addEventListener('click', this.closeDevOverlay)
    this.buildDevRenderButtons()
    this.devOverlay?.addEventListener('click', (e) => {
      if (e.target === this.devOverlay) this.closeDevOverlay()
    })
    this.buildHudPartToggles()
    this.groupsDoneBtn = document.getElementById('groups-done') as HTMLButtonElement | null
    this.groupsDoneBtn?.addEventListener('click', this.onGroupsDoneClick)

    this.mobileControls = document.getElementById('mobile-controls')
    this.mobileControls?.addEventListener('click', this.onMobileControlsClick)
    this.selectionToggle = document.getElementById('selection-toggle') as HTMLButtonElement | null
    this.selectionToggle?.addEventListener('click', this.onSelectionToggleClick)
    document.getElementById('hud')?.classList.remove('sel-expanded')
    if (this.selectionToggle) {
      this.selectionToggle.textContent = '▲'
      this.selectionToggle.title = t('game.expandSelection')
    }
    this.hud = new Hud({
      onBuildClick: (type) => this.startPlacement(type),
      onQueueClick: (unitType) => this.queueUnit(unitType),
      onDequeueClick: (buildingId, index) => this.dequeueUnit(buildingId, index),
      onReorderClick: (buildingId, from, to) => this.reorderQueue(buildingId, from, to),
      onResearchClick: (upgrade) => this.researchUpgrade(upgrade),
      onDequeueResearch: (buildingId, index) => this.dequeueResearch(buildingId, index),
      onStopClick: () => this.onStopCommand(),
      onDestroyClick: () => this.destroySelection(),
      onAttackToggle: () => this.toggleAttackMove(),
      isAttackActive: () => this.input?.aKey ?? false,
      onKeepAttackToggle: () => this.toggleKeepAttack(),
      isKeepAttackActive: () => this.input?.keepAttackKey ?? false,
      onGuardToggle: () => this.toggleGuard(),
      isGuardActive: () => this.input?.guardKey ?? false,
      onAutoFireToggle: () => this.onAutoFireToggle(),
      isAutoFireActive: () => this.allAutoFire(),
      onFormationClick: (mode) => this.onFormationClick(mode),
      isFormationActive: (mode) => this.isFormationActive(mode),
      onSpawnToggle: () => this.togglePendingMarker('spawn'),
      isSpawnActive: () => this.pendingSpawnPoint,
      onFlagToggle: () => this.togglePendingMarker('flag'),
      isFlagActive: () => this.pendingFlag,
      onMoveModeToggle: () => this.toggleMoveMode(),
      isMoveModeActive: () => this.multiPosMode,
      onMaxPowerClick: (ids) => this.maxPower(ids),
      onDeselectClick: () => this.onDeselectClick(),
      onGrenadeToggle: () => this.toggleAbility('grenade'),
      isGrenadeActive: () => this.anySelectionArmed('grenade'),
      onSmokeToggle: () => this.toggleAbility('smoke'),
      isSmokeActive: () => this.anySelectionArmed('smoke'),
      onPlaceMineToggle: () => this.toggleMineMode('place'),
      isPlaceMineActive: () => this.anyMineArmed('place'),
      onRemoveMineToggle: () => this.toggleMineMode('remove'),
      isRemoveMineActive: () => this.anyMineArmed('remove'),
      onDetectorClick: (ids) => this.buyDetector(ids),
      onStealthClick: (ids) => this.buyStealth(ids),
      onUnloadToggle: () => this.toggleUnload(),
      isUnloadActive: () => this.pendingUnload,
      onUnloadOne: (transportId, index) => this.unloadOne(transportId, index),
      onSwChoose: (choice) => {
        if (!this.world) return
        this.issue({ type: 'sw-choose', entities: [], x: 0, y: 0, choice })
      },
      onMissionOpen: () => this.refreshDailyMissions(),
      slotName: (slot) => this.netPlayers.find((p) => p.id === slot)?.name ?? null,
    })
  }

  private toggleMoveMode(): void {
    this.multiPosMode = !this.multiPosMode
    this.multiRoute = null
    this.hud.toast(this.multiPosMode ? t('game.multiPosOn') : t('game.multiPosOff'))
  }

  private anySelectionArmed(kind: 'grenade' | 'smoke'): boolean {
    for (const id of this.selection) {
      if (this.abilityModes.get(id) === kind) return true
    }
    return false
  }

  private anyMineArmed(kind: 'place' | 'remove'): boolean {
    for (const id of this.selection) {
      if (this.mineModes.get(id) === kind) return true
    }
    return false
  }

  private toggleAbility(kind: 'grenade' | 'smoke'): void {
    const unitIds = this.abilityEligible()
    if (unitIds.length === 0) {
      this.hud.toast(t('game.noThrower'))
      return
    }
    const ts = this.world?.teamState(this.localTeam)
    if (!ts?.abilitiesUnlocked) {
      this.hud.toast(t('game.abilitiesLocked'))
      return
    }
    // All eligible selected units armed with this throw → disarm; else arm them.
    const allArmed = unitIds.every((id) => this.abilityModes.get(id) === kind)
    let on: boolean
    if (allArmed) {
      for (const id of unitIds) this.abilityModes.delete(id)
      on = false
    } else {
      for (const id of unitIds) {
        this.abilityModes.set(id, kind)
        this.mineModes.delete(id)
      }
      this.exitUnitRings()
      on = true
    }
    this.hud.toast(
      kind === 'grenade' ? (on ? t('game.grenadeOn') : t('game.grenadeOff')) : on ? t('game.smokeOn') : t('game.smokeOff'),
    )
  }

  private toggleMineMode(kind: 'place' | 'remove'): void {
    const unitIds = this.mineEligible(kind)
    if (unitIds.length === 0) {
      this.hud.toast(t('game.noMineUnit'))
      return
    }
    const allArmed = unitIds.every((id) => this.mineModes.get(id) === kind)
    let on: boolean
    if (allArmed) {
      for (const id of unitIds) this.mineModes.delete(id)
      on = false
    } else {
      for (const id of unitIds) {
        this.mineModes.set(id, kind)
        this.abilityModes.delete(id)
      }
      this.exitUnitRings()
      on = true
    }
    this.hud.toast(
      kind === 'place' ? (on ? t('game.minePlaceOn') : t('game.minePlaceOff')) : on ? t('game.mineRemoveOn') : t('game.mineRemoveOff'),
    )
  }

  /** Ends the other armed toggle: arming a throw disarms mine modes on those units and vice versa. */
  private exitUnitRings(): void {
    this.pendingPlace = null
    this.cancelStrikeTargeting(true)
    this.multiPosMode = false
    this.multiRoute = null
  }

  /** Selected bandolier-capable units of the local team. */
  private abilityEligible(): number[] {
    const world = this.world
    const out: number[] = []
    for (const id of this.selection) {
      const u = world?.units.get(id)
      if (u && u.team === this.localTeam && canThrowBandolier({ id: u.unitType, class: u.class })) out.push(id)
    }
    return out
  }

  /** Selected units that can carry the given mine mode. */
  private mineEligible(kind: 'place' | 'remove'): number[] {
    const world = this.world
    const out: number[] = []
    for (const id of this.selection) {
      const u = world?.units.get(id)
      if (!u || u.team !== this.localTeam) continue
      if (kind === 'place' ? u.unitType === 'engineer' : u.unitType === 'engineer' || u.unitType === 'bulldozer') out.push(id)
    }
    return out
  }

  /** Pick an owned mine under the clicked point (returns its entity id, or null). */
  private pickMine(worldX: number, worldY: number): number | null {
    const world = this.world
    if (!world) return null
    let best: number | null = null
    let bestDist = Infinity
    const tileX = worldX / 1000
    const tileY = worldY / 1000
    world.mines.forEach((id, m) => {
      if (m.team !== this.localTeam) return
      const t = world.transforms.get(id)
      if (!t) return
      const dx = tileX - t.x / 1000
      const dy = tileY - t.y / 1000
      const d = dx * dx + dy * dy
      if (d <= 0.64 && d < bestDist) {
        bestDist = d
        best = id
      }
    })
    return best
  }

  private buyDetector(buildingIds: number[]): void {
    if (buildingIds.length === 0) return
    this.issue({ type: 'set-detector', entities: buildingIds, x: 0, y: 0 })
    this.audio.uiClick()
  }

  private buyStealth(unitIds: number[]): void {
    if (unitIds.length === 0) return
    this.issue({ type: 'set-stealth', entities: unitIds, x: 0, y: 0 })
    this.audio.uiClick()
  }

  private isMobileView(): boolean {
    return document.body.classList.contains('mobile-mode') || window.innerWidth <= 860
  }

  private onSelectionToggleClick = (): void => {
    const hud = document.getElementById('hud')
    const expanded = hud?.classList.toggle('sel-expanded') ?? false
    this.layoutSelectionBarHeight()
    if (this.selectionToggle) {
      this.selectionToggle.textContent = expanded ? '▼' : '▲'
      this.selectionToggle.title = expanded ? t('game.collapseSelection') : t('game.expandSelection')
    }
  }

  private onMenuBtnClick = (): void => {
    if (this.mode === 'offline' || this.mode === 'replay') this.paused = true
    const rows = this.currentStatsRows()
    if (rows) {
      this.menuStatsBoard.show(t('menu.stats'), rows)
    } else {
      this.menuStatsBoard.hide()
    }
    this.menuOverlay.classList.add('visible')
    this.menuSaveReplayBtn.style.display = this.canSaveReplay() ? '' : 'none'
  }

  private canSaveReplay(): boolean {
    return this.mode === 'offline' && !this.replayRecorded && this.recordTicks > 0
  }

  private currentStatsRows(): StatsRow[] | null {
    if (this.modeCfg) {
      const teams = this.modeCfg.slots.map((s) => s.team)
      return buildStatsRows(this.modeCfg.slots, this.stats.snapshot(teams))
    }
    if (this.netPlayers.length > 0) {
      const slots = this.netPlayers.map((p) => ({
        team: p.id,
        name: p.name,
        alliance: p.team ?? p.id,
        difficulty: p.bot ? (p.difficulty ?? 'medium') : undefined,
      }))
      const teams = this.netPlayers.map((p) => p.id)
      return buildStatsRows(slots, this.stats.snapshot(teams))
    }
    return null
  }

  private onMenuResumeClick = (): void => {
    this.menuOverlay.classList.remove('visible')
    this.menuStatsBoard.hide()
    this.paused = false
  }

  private onMenuSaveReplayClick = (): void => {
    if (!this.canSaveReplay()) return
    this.saveOfflineReplay(null)
  }

  private onResultsSaveReplayClick = (): void => {
    if (!this.canSaveReplay()) return
    this.saveOfflineReplay(this.resultsWinner)
    this.resultsSaveReplayBtn.style.display = 'none'
  }

  private onMenuQuitClick = (): void => {
    this.menuOverlay.classList.remove('visible')
    this.menuStatsBoard.hide()
    this.paused = false
    this.hud.hide()
    this.destroy()
    this.onQuit?.()
  }

  private onResultsQuitClick = (): void => {
    this.resultsOverlay.classList.remove('visible')
    this.resultsBoard.hide()
    this.finished = false
    this.resultsShown = false
    this.hud.hide()
    this.destroy()
    this.onQuit?.()
  }

  private scheduleSeek(t: number): void {
    this.pendingSeek = Math.max(0, Math.min(Math.round(t), this.replayTicks))
  }

  private onReplayPlayClick = (): void => {
    if (this.mode !== 'replay') return
    if (this.finished) {
      this.scheduleSeek(0)
      this.replayPlaying = true
    } else {
      this.replayPlaying = !this.replayPlaying
    }
  }

  private onReplayRestartClick = (): void => {
    if (this.mode !== 'replay') return
    this.scheduleSeek(0)
    this.replayPlaying = true
  }

  private onReplayBackClick = (): void => {
    if (this.mode !== 'replay' || !this.world) return
    this.scheduleSeek(
      (this.seekActive ? this.seekTarget : this.world.tick) - SIM_TICK_HZ * REPLAY_JUMP_SECONDS,
    )
  }

  private onReplayFwdClick = (): void => {
    if (this.mode !== 'replay' || !this.world) return
    this.scheduleSeek(
      (this.seekActive ? this.seekTarget : this.world.tick) + SIM_TICK_HZ * REPLAY_JUMP_SECONDS,
    )
  }

  private onReplaySpeedClick = (): void => {
    if (this.mode !== 'replay') return
    const i = REPLAY_SPEEDS.indexOf(this.replaySpeed)
    this.replaySpeed = REPLAY_SPEEDS[(i + 1) % REPLAY_SPEEDS.length]
    this.loop?.setSpeed(this.replaySpeed)
  }

  /** Toggle the minimap + selection-bar in the replay (hide/unhide via `#hud.sel-hidden`). */
  private onReplayHudToggleClick = (): void => {
    if (this.mode !== 'replay') return
    const hud = document.getElementById('hud')
    if (!hud) return
    const selHidden = hud.classList.toggle('sel-hidden')
    this.replayHudToggle.classList.toggle('active', !selHidden)
    this.hud.toast(selHidden ? t('replay.hudHidden') : t('replay.hudShown'))
  }

  /** Rebuild a deterministic replay world from the saved start message (seek/rewind). */
  private buildReplayWorld(startMsg: MatchStartMessage): World {
    const world = new World(startMsg.map, startMsg.seed, startMsg.players.map((p) => p.id), startMsg.settings)
    if (startMsg.winRule) world.winRule = startMsg.winRule
    for (const p of startMsg.players) {
      const ts = world.teams.get(p.id)
      if (ts && p.team !== undefined) ts.alliance = p.team
      if (ts && p.color !== undefined) ts.color = p.color
    }
    world.rewireSharedStartingCredits()
    return world
  }

  /** Movie-player seek, spread over frames so the UI never freezes: fast-forward a
   *  short time-budgeted chunk per frame from the current state, or rebuild the
   *  world from tick 0 when the target is behind the current position. */
  private stepSeek(): void {
    const startMsg = this.currentStartMsg
    if (!startMsg || !this.world) {
      this.seekActive = false
      return
    }
    const target = Math.max(0, Math.min(this.seekTarget, this.replayTicks))
    if (target < this.world.tick) {
      this.world = this.buildReplayWorld(startMsg)
      this.replayIndex = 0
    }
    const world = this.world
    if (target === world.tick) {
      this.finishSeek(world)
      return
    }
    const h = this.replayHistory
    const t0 = performance.now()
    let steps = 0
    while (world.tick < target && steps < 4000 && performance.now() - t0 < 20) {
      const cmds: EnvelopeCommand[] = []
      while (this.replayIndex < h.length && h[this.replayIndex].tick <= world.tick) {
        if (h[this.replayIndex].tick === world.tick) cmds.push(h[this.replayIndex])
        this.replayIndex++
      }
      stepWorld(world, cmds)
      steps++
    }
    if (world.tick >= target) this.finishSeek(world)
  }

  private finishSeek(world: World): void {
    this.seekActive = false
    world.drainEvents()
    this.stats = new StatsTracker()
    this.localHash = 0
    this.pendingChecks.clear()
    this.syncOk = true
    this.selection.clear()
    this.clearReplayEndState()
  }

  /** Drop the finished/cinematic/results state so playback can resume after a seek. */
  private clearReplayEndState(): void {
    this.finished = false
    this.paused = false
    this.resultsShown = false
    this.cinematicActive = false
    this.cinematicOverlay.classList.remove('visible')
    this.resultsOverlay.classList.remove('visible')
    this.resultsBoard.hide()
  }

  private fmtTicks(ticks: number): string {
    const s = Math.max(0, Math.floor(ticks / SIM_TICK_HZ))
    const m = Math.floor(s / 60)
    const r = s % 60
    return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
  }

  /** Refresh the transport bar: slider position, time label, play icon, speed. */
  private syncReplayBar(): void {
    if (!this.world) return
    this.replaySlider.max = String(this.replayTicks)
    if (this.seekActive) {
      this.replaySlider.value = String(this.seekTarget)
      this.replayTimeEl.textContent = `${t('replay.seeking')} ${this.fmtTicks(this.seekTarget)} / ${this.fmtTicks(this.replayTicks)}`
    } else if (this.sliderDragging) {
      const v = Number(this.replaySlider.value)
      this.replayTimeEl.textContent = `${this.fmtTicks(v)} / ${this.fmtTicks(this.replayTicks)}`
    } else {
      this.replaySlider.value = String(this.world.tick)
      this.replayTimeEl.textContent = `${this.fmtTicks(this.world.tick)} / ${this.fmtTicks(this.replayTicks)}`
    }
    this.replayPlayBtn.textContent = this.replayPlaying && !this.finished ? '⏸' : '▶'
    this.replaySpeedBtn.textContent = `${this.replaySpeed}×`
  }

  private showResults(winner: number | null): void {
    if (this.resultsShown) return
    this.resultsShown = true
    this.finished = true
    this.paused = true
    this.resultsWinner = winner
    this.recordProfileMatch(winner)
    this.recordModeResults(winner)
    const rows = this.currentStatsRows()
    if (rows) {
      this.resultsBoard.show(this.modeTitle(winner), rows)
    } else {
      this.resultsBoard.hide()
    }
    this.resultsOverlay.classList.add('visible')
    this.resultsSaveReplayBtn.style.display = this.canSaveReplay() ? '' : 'none'
  }

  /** Persist the daily mission results on match finish. When the daily list is
   *  accepted on this match, XP banks for any mission newly completed this play;
   *  a skipped daily list records nothing. */
  private recordModeResults(winner: number | null): void {
    const cfg = this.modeCfg
    if (!cfg || !cfg.daily || !this.trackDaily || !this.session) return
    const storage = window.localStorage
    const summary = this.session.summary()
    this.lastModeNote = null
    const missions = generateDailyMissions(cfg.daily.generation)
    const { done } = evaluateDailyMissions(missions, {
      won: winner === this.localTeam,
      kills: summary.counters.kills,
      unitsTrained: summary.counters.unitsTrained,
      buildingsBuilt: summary.counters.buildingsBuilt,
      supplyHarvested: summary.counters.supplyHarvested,
    })
    // XP is banked only for missions that weren't already finished on this challenge.
    const prior = loadModeRecords(storage).daily
    const already = new Set(prior?.challenge?.generation === cfg.daily.generation ? prior.challenge.doneIds : [])
    const bankedXp = done.filter((m) => !already.has(m.id)).reduce((sum, m) => sum + m.xp, 0)
    // Records the newly completed missions against the persisted challenge (never the date).
    const rec = recordDailyResult(storage, { generation: cfg.daily.generation, missions, doneIds: done.map((m) => m.id) })
    const daily = rec.daily
    const remaining = daily ? remainingDailyMissions(daily, cfg.daily.generation, missions) : missions.length
    if (daily) {
      this.lastModeNote =
        remaining === 0
          ? t('daily.resultsNoteComplete', { xp: bankedXp, level: dailyLevel(daily), progress: dailyLevelXp(daily), required: DAILY_XP_PER_LEVEL })
          : t('daily.resultsNote', { xp: bankedXp, level: dailyLevel(daily), progress: dailyLevelXp(daily), required: DAILY_XP_PER_LEVEL, remaining })
    }
  }

  private modeTitle(winner: number | null): string {
    const base = this.netTitle(winner)
    return this.lastModeNote ? `${base} · ${this.lastModeNote}` : base
  }

  private recordProfileMatch(winner: number | null): void {
    if (this.profileRecorded || !this.session) return
    this.profileRecorded = true
    // The match-options toggle decides whether this match is counted at all.
    if (!this.trackProfile) return
    const storage = window.localStorage
    const profile = loadProfile(storage)
    const config = loadProfileConfig(storage)
    const elapsedMs = Math.max(0, performance.now() - this.matchStartedAt)
    if (this.spectator) {
      recordSpectate(storage, profile, config, {
        mode: this.mode,
        map: this.matchMapLabel || 'default',
        durationSec: Math.round(elapsedMs / 1000),
      })
      return
    }
    const summary = this.session.summary()
    const result: 'win' | 'loss' | 'draw' = winner === null ? 'draw' : winner === this.localTeam ? 'win' : 'loss'
    const matchScore = this.world ? this.world.scoreOf(this.localTeam) : 0
    recordMatch(storage, profile, config, {
      mode: this.mode,
      result,
      map: this.matchMapLabel || 'default',
      durationSec: Math.round(elapsedMs / 1000),
      kills: summary.counters.kills,
      unitsBuilt: summary.counters.unitsTrained,
      buildingsBuilt: summary.counters.buildingsBuilt,
      supplyHarvested: summary.counters.supplyHarvested,
      score: matchScore,
      counters: summary.counters,
      typeCounts: summary.typeCounts,
    })
  }

  private netTitle(winner: number | null): string {
    if (this.spectator) return t('menu.over')
    if (winner !== null && winner === this.localTeam) return t('menu.victory')
    if (winner !== null) return t('menu.defeat')
    return t('menu.draw')
  }

  /** Victory cinematic: all players spectate for a few seconds with only the result text, then the results popup. */
  private beginCinematic(winner: number | null): void {
    if (this.resultShown()) return
    this.finished = true
    this.paused = true
    const secs = getGraphics().victoryCinematicSec
    if (secs <= 0) {
      this.showResults(winner)
      return
    }
    this.cinematicActive = true
    this.cinematicWinner = winner
    this.cinematicUntil = performance.now() + secs * 1000
    const title = this.netTitle(winner)
    this.cinematicText.textContent = title
    this.cinematicText.classList.toggle('defeat', title === t('menu.defeat'))
    this.cinematicOverlay.classList.add('visible')
  }

  private resultShown(): boolean {
    return this.resultsShown || this.cinematicActive
  }

  onNetGameOver(winner: number | null): void {
    if (this.mode !== 'net') return
    this.beginCinematic(winner)
  }

  async startOffline(cfg: MatchConfig): Promise<void> {
    this.mode = 'offline'
    this.localTeam = cfg.localTeam
    this.modeCfg = cfg
    this.stats = new StatsTracker()
    this.session = new SessionRecorder(cfg.localTeam)
    this.matchStartedAt = performance.now()
    this.profileRecorded = false
    this.matchMapLabel = cfg.map.name
    this.achNotified.clear()
    this.lastAchCheckTick = -1
    this.bots = []
    this.finished = false
    this.resultsShown = false
    this.cinematicOverlay.classList.remove('visible')
    this.cinematicActive = false
    this.recordHistory = []
    this.recordTicks = 0
    this.replayRecorded = false
    this.dailyMissionDefs = null
    this.trackDaily = cfg.trackDaily
    this.trackProfile = cfg.trackProfile
    this.hud.showMissionButton(false)
    this.hud.setObjective(null)
    await this.boot(null, cfg)
    // A bots match can be a daily challenge run: wire the mission popup so the
    // fixed task list tracks live progress (it also progress-evaluates on finish).
    // When the player skips the daily list, the popup stays hidden and the match
    // is not counted toward the tasks.
    if (cfg.daily && this.trackDaily) {
      this.dailyMissionDefs = generateDailyMissions(cfg.daily.generation)
      this.hud.showMissionButton(true)
      this.refreshDailyMissions()
    }
  }

  /** Live daily challenge progress for the header Mission popup and objective line. */
  private refreshDailyMissions(): void {
    if (!this.dailyMissionDefs || !this.session) return
    const summary = this.session.summary()
    const { done } = evaluateDailyMissions(this.dailyMissionDefs, {
      won: false,
      kills: summary.counters.kills,
      unitsTrained: summary.counters.unitsTrained,
      buildingsBuilt: summary.counters.buildingsBuilt,
      supplyHarvested: summary.counters.supplyHarvested,
    })
    const banked = new Set(loadModeRecords(window.localStorage).daily?.challenge?.doneIds ?? [])
    const rows = this.dailyMissionDefs.map((m) => ({
      text: t(m.descKey, { n: m.target }),
      xp: m.xp,
      done: banked.has(m.id) || done.includes(m),
    }))
    this.hud.setMissions(rows)
    this.hud.setObjective(t('daily.hudRemaining', { n: rows.filter((r) => !r.done).length }))
  }

  async startNet(net: NetClient, msg: MatchStartMessage): Promise<void> {
    this.mode = 'net'
    this.net = net
    this.localTeam = msg.yourId
    this.spectator = msg.spectator === true
    this.netPlayers = msg.players
    this.team = msg.players.find((p) => p.id === msg.yourId)?.team ?? msg.yourId
    this.modeCfg = null
    this.dailyMissionDefs = null
    this.trackDaily = false
    this.trackProfile = true
    this.hud.showMissionButton(false)
    this.hud.setObjective(null)
    this.bots = []
    this.finished = false
    this.session = new SessionRecorder(msg.yourId)
    this.matchStartedAt = performance.now()
    this.profileRecorded = false
    this.matchMapLabel = msg.map.name
    this.achNotified.clear()
    this.lastAchCheckTick = -1
    this.resultsShown = false
    this.cinematicOverlay.classList.remove('visible')
    this.cinematicActive = false
    await this.boot(msg)
  }

  /** Replays a recorded match from the archive: rebuilds the deterministic world
   *  from the saved seed/map/settings and drives ticks with the command history.
   *  The player is a passive spectator and no profile entry is recorded. */
  async startReplay(replay: ReplayData): Promise<void> {
    this.mode = 'replay'
    this.localTeam = -1
    this.spectator = true
    this.net = null
    this.netPlayers = replay.players
    this.team = replay.players.find((p) => p.id === 0)?.team ?? -1
    this.modeCfg = null
    this.dailyMissionDefs = null
    this.trackDaily = false
    this.trackProfile = true
    this.hud.showMissionButton(false)
    this.hud.setObjective(null)
    this.bots = []
    this.finished = false
    this.session = null
    this.matchStartedAt = performance.now()
    this.profileRecorded = true
    this.matchMapLabel = replay.map.name
    this.achNotified.clear()
    this.lastAchCheckTick = -1
    this.resultsShown = false
    this.cinematicOverlay.classList.remove('visible')
    this.cinematicActive = false
    this.replayHistory = replay.history
    this.replayIndex = 0
    this.replayTicks = replay.ticks
    this.replayWinner = replay.winner
    await this.boot({
      kind: 'S_MATCH_START',
      protocolVersion: replay.version,
      seed: replay.seed,
      tickRate: replay.tickRate,
      map: replay.map,
      players: replay.players,
      hostId: -1,
      yourId: -1,
      spectator: true,
      settings: replay.settings,
      winRule: replay.winRule,
    } satisfies MatchStartMessage)
    this.currentStartMsg = {
      kind: 'S_MATCH_START',
      protocolVersion: replay.version,
      seed: replay.seed,
      tickRate: replay.tickRate,
      map: replay.map,
      players: replay.players,
      hostId: -1,
      yourId: -1,
      spectator: true,
      settings: replay.settings,
      winRule: replay.winRule,
    }
    this.replayPlaying = true
    this.replaySpeed = 1
    this.loop?.setSpeed(this.replaySpeed)
    this.pendingSeek = null
    this.seekActive = false
    this.seekTarget = 0
    this.sliderDragging = false
    const ecoTeams = new Map<number, { name: string; color: number }>()
    for (const p of replay.players) {
      const alliance = p.team ?? p.id
      if (!ecoTeams.has(alliance)) ecoTeams.set(alliance, { name: p.name, color: p.color ?? p.id })
    }
    this.hud.setReplayEco([...ecoTeams].map(([team, v]) => ({ team, ...v })))
    this.replayBar.hidden = false
    this.replaySlider.max = String(this.replayTicks)
    document.getElementById('hud')?.classList.add('replay-hud')
    this.replayHudToggle.classList.toggle('active', !document.getElementById('hud')?.classList.contains('sel-hidden'))
    this.syncReplayBar()
    this.hud.toast(t('game.replayStarted', { date: replayDateLabel(replay.createdAt) }))
  }

  private async boot(startMsg: MatchStartMessage | null, cfg?: MatchConfig): Promise<void> {
    const map = startMsg ? startMsg.map : (cfg?.map ?? generateDefaultMap())
    const seed = startMsg ? startMsg.seed : (cfg?.seed ?? (Math.floor(Math.random() * 0xffffffff) >>> 0))
    const players = startMsg ? startMsg.players.map((p) => p.id) : (cfg ? cfg.slots.map((s) => s.team) : [0])
    const playerColors = startMsg
      ? startMsg.players.map((p) => p.color ?? p.id)
      : (cfg ? cfg.slots.map((s) => s.color ?? s.team) : [0])

    const renderer = new Renderer()
    await renderer.init(document.getElementById('game-canvas')!, map, [...new Set(playerColors)])
    this.renderer = renderer

    if (startMsg) {
      this.world = this.buildReplayWorld(startMsg)
      this.sim = null
    } else {
      this.sim = new Simulator(map, seed, players, { ...(cfg?.settings ?? {}), startingCredits: cfg?.credits ?? map.credits })
      this.world = this.sim.world
    }

    if (cfg) {
      this.world.winRule = cfg.winRule
      for (const s of cfg.slots) {
        const ts = this.world.teams.get(s.team)
        if (ts && s.alliance !== undefined) ts.alliance = s.alliance
        if (ts && s.color !== undefined) ts.color = s.color
      }
      this.world.rewireSharedStartingCredits()
      for (const s of cfg.slots) {
        if (s.difficulty && this.sim) this.bots.push(new BotPlayer(this.sim, s.team, s.difficulty))
      }
    }

    let homeId: number | undefined
    let builderId: number | undefined
    this.world.buildings.forEach((id, b) => {
      if (homeId === undefined && b.team === this.localTeam && b.done) homeId = id
    })
    this.world.units.forEach((id, u) => {
      if (builderId === undefined && u.team === this.localTeam && u.unitType === 'bulldozer') builderId = id
    })
    const initialSel = builderId ?? homeId
    if (initialSel !== undefined) {
      this.selection = new Set([initialSel])
      const t = this.world.transforms.require(homeId ?? initialSel)
      renderer.camera.centerOn(t.x, t.y)
    } else if (startMsg && this.spectator) {
      renderer.camera.centerOnMap(this.world.width, this.world.height)
    }
    if (startMsg && this.spectator) renderer.showAll = true
    const gfx = getGraphics()
    renderer.camera.setZoomRange(this.mode === 'replay' ? gfx.replayZoomMin : gfx.zoomMin, this.mode === 'replay' ? gfx.replayZoomMax : gfx.zoomMax)

    const isMobile = this.isMobileView()
    const mm = new Minimap(map, isMobile ? 0.72 : 1)
    const mmEl = mm.canvas
    mmEl.style.border = '1px solid #26304a'
    mmEl.style.cursor = 'pointer'
    mmEl.style.pointerEvents = 'auto'
    const mmOverlay = mm.viewport
    const mmInner = document.createElement('div')
    mmInner.className = 'mm-inner'
    mmInner.appendChild(mmEl)
    mmOverlay.style.position = 'absolute'
    mmOverlay.style.top = '0'
    mmOverlay.style.left = '0'
    mmInner.appendChild(mmOverlay)
    const mmWrap = document.createElement('div')
    mmWrap.className = 'mm-wrap'
    mmWrap.appendChild(this.buildMinimapRail())
    mmWrap.appendChild(mmInner)
    document.getElementById('selection-bar')?.appendChild(mmWrap)
    this.mmWrap = mmWrap
    this.mm = mm
    this.mmResizeObserver = new ResizeObserver(() => this.layoutSelectionBarHeight())
    this.mmResizeObserver.observe(mmWrap)
    this.layoutSelectionBarHeight()
    this.pingMode = null
    this.layoutToolsBar()
    renderer.setMinimap(mm)
    let mmDragging = false
    let mmLast = { x: 0, y: 0 }
    let mmDown = { x: 0, y: 0 }
    mmEl.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      mmDragging = true
      mmLast = { x: e.clientX, y: e.clientY }
      mmDown = { x: e.clientX, y: e.clientY }
      mmEl.setPointerCapture(e.pointerId)
    })
    mmEl.addEventListener('pointermove', (e) => {
      if (!mmDragging) return
      const dx = e.clientX - mmLast.x
      const dy = e.clientY - mmLast.y
      mmLast = { x: e.clientX, y: e.clientY }
      mm.panBy(dx, dy)
    })
    mmEl.addEventListener('pointerup', (e) => {
      if (!mmDragging) return
      mmDragging = false
      try {
        mmEl.releasePointerCapture(e.pointerId)
      } catch {
        /* already released */
      }
      if (Math.hypot(e.clientX - mmDown.x, e.clientY - mmDown.y) < 5) {
        const rect = mmEl.getBoundingClientRect()
        const t = mm.toTile(e.clientX - rect.left, e.clientY - rect.top)
        if (this.pingMode) {
          this.issue({ type: 'ping', entities: [], x: t.x, y: t.y, pingType: this.pingMode })
          this.audio.uiClick()
          return
        }
        renderer.camera.centerOn(tileToFx(t.x) + 500, tileToFx(t.y) + 500)
      }
    })
    mmEl.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault()
        const rect = mmEl.getBoundingClientRect()
        mm.zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - rect.left, e.clientY - rect.top)
      },
      { passive: false },
    )

    const input = new InputManager(renderer.app.canvas, renderer.camera, {
      onCommand: (kind, worldPt) => this.onCommand(kind, worldPt),
      onClick: (info) => this.onClick(info),
      onBox: (box) => this.onBox(box),
      onPan: (dx, dy) => renderer.camera.panBy(dx, dy),
      onZoom: (factor, px, py) => renderer.camera.zoomAt(px, py, factor),
    })
    input.attach()
    this.input = input
    if (document.body.classList.contains('mobile-mode')) input.setTouchEnabled(true)
    this.syncMobileToolButtons()

    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onWindowBlur)
    window.addEventListener('pointerdown', this.onPointerDown, true)

    this.world.onSyncTick = (hash) => {
      this.localHash = hash
      this.pendingChecks.set(this.world!.tick, hash)
      if (this.net?.connected) {
        this.net.sendChecksum(this.world!.tick, hash)
      }
    }

    this.hud.show()
    this.audio.startGameAmbient()
    this.audio.refitAmbient()
    this.layoutToolsBar()
    this.weather = new WeatherOverlay(document.getElementById('app')!)
    this.weather.setWeather(getGraphics().weather)
    this.audio.startWeatherAmbient(getGraphics().weather)
    this.hud.log(t('game.matchStarted'))
    if (this.mode === 'net') {
      this.chat?.destroy()
      this.chat = new ChatBox((text, target) => this.net?.chat(text, target, this.team), this.spectator)
      this.chat.showButton()
      if (this.spectator) this.hud.toast(t('game.spectating'))
    }
    const botCount = cfg ? cfg.slots.filter((s) => s.difficulty).length : 0
    this.hud.toast(
      startMsg
        ? t('game.matchStarted')
        : botCount > 0
          ? t('game.startPlayers', { n: cfg!.slots.length, b: botCount })
          : t('game.startOffline'),
    )

    this.loop = new GameLoop({
      tick: () => this.onTick(),
      frame: () => this.onFrame(),
      onError: (err) => {
        console.error(err)
        this.hud.toast(t('game.error', { msg: err instanceof Error ? err.message : String(err) }))
      },
    })
    this.loop.start()
    if (this.pendingSpectate) this.stepToTickSync(this.pendingSpectate)
    this.pendingSpectate = null
    if (this.net && !this.spectator) {
      const go = await this.showNetCountdown()
      if (!go) {
        // player cancelled: leave the match before telling the host we are ready
        this.destroy()
        this.net.close()
        return
      }
    }
    if (this.net) this.net.loaded()
  }

  private showNetCountdown(): Promise<boolean> {
    const overlay = document.getElementById('countdown-overlay') as HTMLDivElement | null
    const num = document.getElementById('countdown-num') as HTMLDivElement | null
    const cancel = document.getElementById('countdown-cancel') as HTMLButtonElement | null
    if (!overlay || !num) return Promise.resolve(true)
    cancel?.style.removeProperty('display')
    let remaining = 5
    num.textContent = String(remaining)
    overlay.classList.add('visible')
    return new Promise((resolve) => {
      let done = false
      const finish = (go: boolean): void => {
        if (done) return
        done = true
        window.clearInterval(timer)
        cancel?.removeEventListener('click', onCancel)
        overlay.classList.remove('visible')
        resolve(go)
      }
      const timer = window.setInterval(() => {
        remaining--
        if (remaining <= 0) {
          finish(true)
          return
        }
        num.textContent = String(remaining)
      }, 1000)
      const onCancel = (): void => finish(false)
      cancel?.addEventListener('click', onCancel)
    })
  }

  private onTick(): void {
    if (this.paused || this.finished) return
    if (this.mode === 'offline') {
      const sim = this.sim
      const world = this.world
      if (!sim || !world) return
      const envs = this.pendingCmds
      this.pendingCmds = []
      for (const bot of this.bots) envs.push(...bot.tick())
      for (const env of envs) this.recordHistory.push({ ...env, tick: world.tick })
      sim.step(envs)
      this.recordTicks = world.tick
      // The daily mission list updates against the live session every ~1.2 s.
      if (this.dailyMissionDefs && world.tick % 30 === 0) this.refreshDailyMissions()
      return
    }
    if (this.mode === 'replay') {
      if (!this.replayPlaying || this.seekActive) return
      this.stepReplayTick()
    }
  }

  /** Replay tick driver: applies every command stamped for the current world tick,
   *  then steps the deterministic sim once. Mirrors `flushSpectateSync`. */
  private stepReplayTick(): void {
    const world = this.world
    if (!world) return
    const cmds: EnvelopeCommand[] = []
    while (this.replayIndex < this.replayHistory.length && this.replayHistory[this.replayIndex].tick <= world.tick) {
      if (this.replayHistory[this.replayIndex].tick === world.tick) cmds.push(this.replayHistory[this.replayIndex])
      this.replayIndex++
    }
    stepWorld(world, cmds)
    if (world.tick >= this.replayTicks) this.finishReplay()
  }

  private finishReplay(): void {
    if (this.finished) return
    this.finished = true
    this.beginCinematic(this.replayWinner)
  }

  /** Offline matches run entirely on this machine, so we record the command history
   *  ourselves and persist it the same way the host persists net replays. */
  private saveOfflineReplay(winner: number | null): void {
    const cfg = this.modeCfg
    const world = this.world
    if (!cfg || !world || this.replayRecorded) return
    this.replayRecorded = true
    const replay: ReplayData = {
      version: PROTOCOL_VERSION,
      createdAt: new Date().toISOString(),
      seed: cfg.seed,
      tickRate: SIM_TICK_HZ,
      map: structuredClone(cfg.map),
      settings: world.settings,
      winRule: world.winRule,
      players: cfg.slots.map((s) => ({
        id: s.team,
        name: s.name,
        ready: true,
        host: s.team === cfg.localTeam,
        team: s.alliance,
        spawn: s.team,
        color: s.color,
        bot: !!s.difficulty,
        difficulty: s.difficulty,
      })),
      winner,
      ticks: this.recordTicks,
      history: this.recordHistory,
    }
    void this.persistReplay(replay)
  }

  private async persistReplay(replay: ReplayData): Promise<void> {
    try {
      const res = await fetch('/api/replays/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(replay),
      })
      if (!res.ok) throw new Error('upload rejected')
      await res.json()
      this.hud.toast(t('game.replaySaved'))
      return
    } catch {
      // No host running (e.g. static/vite dev page) — offer the file so it can be
      // uploaded to a host's archive later.
      const blob = new Blob([JSON.stringify(replay)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${defaultReplayName()}.json`
      a.click()
      URL.revokeObjectURL(url)
      this.hud.toast(t('game.replayDownloaded'))
    }
  }

  private onFrame(): void {
    const world = this.world
    const renderer = this.renderer
    const input = this.input
    if (!world || !renderer || !input) return

    if (this.cinematicActive && performance.now() >= this.cinematicUntil) {
      this.cinematicActive = false
      this.cinematicOverlay.classList.remove('visible')
      this.showResults(this.cinematicWinner)
    }

    if (this.mode === 'replay' && !this.sliderDragging && this.pendingSeek !== null) {
      const t = this.pendingSeek
      this.pendingSeek = null
      this.seekTarget = t
      this.seekActive = true
    }
    if (this.mode === 'replay' && this.seekActive) this.stepSeek()
    if (this.mode === 'replay' && this.seekActive) {
      this.syncReplayBar()
      return
    }

    const camCenter = renderer.camera.screenToWorldExact(renderer.camera.viewWidth / 2, renderer.camera.viewHeight / 2)
    this.audio.listenerX = camCenter.x
    this.audio.listenerY = camCenter.y

    const edge = input.edgePanVelocity()
    if (edge) renderer.camera.panBy(edge.x, edge.y)
    this.processMultiRoute()
    const r = this.multiRoute
    renderer.routePoints = r ? r.pts : null
    renderer.routeIdx = r ? r.idx : 0

    if (!this.isMobileView() && input.isMouseInside()) renderer.setHoverWorld(input.mouseWorld)
    else if (input.touchActive) renderer.setHoverWorld(input.mouseWorld)
    else renderer.setHoverWorld(null)

    const ghost = this.computeGhost()
    const rings = new Map<number, { radiusTiles: number; color: number }>()
    for (const [id, mode] of this.abilityModes) {
      if (!world.units.has(id)) {
        this.abilityModes.delete(id)
        continue
      }
      if (!this.selection.has(id)) continue
      rings.set(
        id,
        mode === 'grenade'
          ? { radiusTiles: world.settings.grenadeRange, color: 0xff6a3a }
          : { radiusTiles: world.settings.smokeRange, color: 0x9ad1f5 },
      )
    }
    for (const [id, mode] of this.mineModes) {
      if (!world.units.has(id)) {
        this.mineModes.delete(id)
        continue
      }
      if (!this.selection.has(id)) continue
      rings.set(id, {
        radiusTiles: world.settings.minePlaceRange,
        color: mode === 'place' ? 0xffa843 : 0xff5068,
      })
    }
    renderer.abilityRings = rings
    let healAura = null as { radiusTiles: number; color: number } | null
    for (const id of this.selection) {
      const u = world.units.get(id)
      if (u && u.unitType === 'engineer' && u.veteranRank >= world.settings.engineerHealRank) {
        healAura = { radiusTiles: world.settings.engineerHealAuraRadius, color: 0x52e06a }
        break
      }
    }
    renderer.healAuraRing = healAura
    renderer.render(world, this.localTeam, this.selection, ghost, input.boxRect, this.moveMarker)
    renderer.setDayNight(world.settings.dayNight ? this.dayPhase(world) : 0)
    if (!this.paused) this.weather?.step()
    this.weather?.draw()
    this.hud.update(world, this.localTeam, world.tick, this.localHash, this.syncOk, this.mode === 'replay' ? this.replayTicks : undefined)
    if (this.mode === 'replay') this.syncReplayBar()
    this.refreshGroupsPanel()
    this.hud.selectionChanged(this.selection, world, this.localTeam, this.isMobileView())
    this.syncMobileToolButtonsForSelection()
    this.updateSatelliteButton(world)
    this.updateLaserButton(world)
    this.updateStrikeButton(world)
    this.updateLaserTarget(renderer)
    if (this.devOverlayVisible) this.updateDevOverlay()

    const gfx = getGraphics()
    if (!this.seekActive) {
      for (const e of world.drainEvents()) {
      this.stats.track(e)
      this.audio.onEvent(e)
      this.session?.track(e, world)
      const msg = this.describeEvent(e)
      if (msg) this.hud.log(msg)
      if (e.type === 'shot-fired') {
        if (gfx.effects.effects) {
          renderer.addImpact(e.x, e.y)
          const at = world.transforms.get(e.attacker)
          if (at) renderer.addProjectile(at.x, at.y, e.x, e.y, e.team)
        }
        const atkW = world.attacks.get(e.attacker)
        if (atkW) this.audio.playWeaponSfx(atkW.weaponId, e.x, e.y)
      }
      if (e.type === 'airstrike-bomb') {
        if (gfx.effects.effects) renderer.addImpact(e.x, e.y, 0xffb050)
      }
      if (e.type === 'emp-strike') {
        if (gfx.effects.effects) renderer.addImpact(e.x, e.y, 0xc070ff)
      }
      if (e.type === 'rank-up' && e.team === this.localTeam) {
        this.hud.achievementToast(t('game.rankUpTitle', { rank: e.rank }), t('game.rankUpDesc'), t('game.rankUpHeader'), true)
        this.audio.playSfx('achievement', { gain: 0.1 })
      }
      if (e.type === 'combat-hit' && world.teamOf(e.target) === this.localTeam) {
        hapticDamaged()
      }
      if (e.type === 'shield-hit') {
        const tt = world.transforms.get(e.target)
        if (tt && gfx.effects.effects) renderer.addImpact(tt.x, tt.y)
        if (world.teamOf(e.target) === this.localTeam) hapticDamaged()
      }
      if (e.type === 'base-under-attack' && e.team === this.localTeam) {
        const last = this.baseAlertCooldowns.get(e.team) ?? -Infinity
        if (world.tick - last >= SECONDS_TO_TICKS(4)) {
          this.baseAlertCooldowns.set(e.team, world.tick)
          this.audio.baseAlert(e.x, e.y)
          this.mm?.flashBuilding(world.tick, e.team, e.x, e.y)
        }
      }
      if (e.type === 'scenery-destroyed' && e.kind === 'tree') {
        renderer.addTreeFall(e.x, e.y, e.w, e.h)
      }
      if (e.type === 'unit-sold') {
        renderer.addSellFx(e.x, e.y, 1)
      }
      if (e.type === 'game-over') {
        this.hud.toast(this.netTitle(e.winner))
        this.beginCinematic(e.winner)
        if (this.mode === 'net') this.net?.gameOver(e.winner)
        if (e.winner === null) this.audio.playSfx('game-over', { pitch: 0.5, gain: 0.08 })
        else this.audio.playSfx(e.winner === this.localTeam ? 'victory' : 'game-over', { gain: 0.08 })
      }
      if (e.type === 'command-rejected') {
        if (e.reason === 'build order queue full') {
          this.pendingPlace = null
          this.hud.toast(t('game.orderQueueFull'))
        } else {
          this.hud.toast(t('game.rejected', { reason: e.reason }))
        }
      }
    }
    }
    this.announceSmokeLandings(world)
    this.checkLiveAchievements()
  }

  /** Client-only: play a soft poof when a smoke canister lands (no sim event exists). */
  private announceSmokeLandings(world: World): void {
    if (this.seekActive || this.paused) return
    world.smokes.forEach((id, s) => {
      if (world.tick >= s.landTick && !this.announcedSmokes.has(id)) {
        this.announcedSmokes.add(id)
        this.audio.playSfx('smoke-landed', { x: s.x, y: s.y, gain: 0.06 })
      }
    })
    if (this.announcedSmokes.size > 0) {
      for (const id of [...this.announcedSmokes]) {
        if (!world.smokes.has(id)) this.announcedSmokes.delete(id)
      }
    }
  }

  /** Every ~1s of sim time, see whether any achievement turned on; if so, toast + sound.
   *  Skipped when the match was set to not count toward the profile. */
  private checkLiveAchievements(): void {
    if (this.spectator || !this.trackProfile || !this.session || !this.world) return
    if (this.world.tick - this.lastAchCheckTick < SECONDS_TO_TICKS(1)) return
    this.lastAchCheckTick = this.world.tick
    const storage = window.localStorage
    const profile = loadProfile(storage)
    const config = loadProfileConfig(storage)
    const sum = this.session.summary()
    const counters: ProfileCounters = freshCounters()
    for (const key of Object.keys(counters) as (keyof ProfileCounters)[]) {
      counters[key] = (profile.counters[key] ?? 0) + (sum.counters[key] ?? 0)
    }
    const typeCounts: ProfileTypeCounts = { unitsTrainedByType: {}, buildingsBuiltByType: {}, upgradesResearched: {} }
    for (const [id, n] of Object.entries(profile.typeCounts.unitsTrainedByType)) typeCounts.unitsTrainedByType[id] = (typeCounts.unitsTrainedByType[id] ?? 0) + n
    for (const [id, n] of Object.entries(profile.typeCounts.buildingsBuiltByType)) typeCounts.buildingsBuiltByType[id] = (typeCounts.buildingsBuiltByType[id] ?? 0) + n
    for (const [id, n] of Object.entries(profile.typeCounts.upgradesResearched)) typeCounts.upgradesResearched[id] = (typeCounts.upgradesResearched[id] ?? 0) + n
    for (const [id, n] of Object.entries(sum.typeCounts.unitsTrainedByType)) typeCounts.unitsTrainedByType[id] = (typeCounts.unitsTrainedByType[id] ?? 0) + n
    for (const [id, n] of Object.entries(sum.typeCounts.buildingsBuiltByType)) typeCounts.buildingsBuiltByType[id] = (typeCounts.buildingsBuiltByType[id] ?? 0) + n
    for (const [id, n] of Object.entries(sum.typeCounts.upgradesResearched)) typeCounts.upgradesResearched[id] = (typeCounts.upgradesResearched[id] ?? 0) + n
    for (const def of ACHIEVEMENTS) {
      if (profile.achievements[def.id] || this.achNotified.has(def.id)) continue
      if (achievementProgress(def, counters, typeCounts) >= achievementTarget(config, def)) {
        this.achNotified.add(def.id)
        this.hud.achievementToast(t(def.nameKey), t(def.descKey))
        this.audio.playSfx('achievement', { gain: 0.08 })
      }
    }
  }

  /** 0..1 night factor for the day/night cycle: day → dusk → night → dawn, over one full cycle. */
  private dayPhase(world: World): number {
    const cycle = world.settings.dayNightCycleTicks
    const T = world.settings.dayNightTransitionTicks
    if (cycle <= 0 || T <= 0) return 0
    const cyc = world.tick % cycle
    const half = Math.max(0, (cycle - 2 * T) / 2)
    if (cyc < half) return 0
    if (cyc < half + T) return (cyc - half) / T
    if (cyc < half + T + half) return 1
    return 1 - (cyc - half - T - half) / T
  }

  private describeEvent(e: SimEvent): string | null {
    switch (e.type) {
      case 'building-placed': {
        const d = BUILDINGS[e.buildingType]
        const name = d ? tn(e.buildingType, d.name) : e.buildingType
        return e.team === this.localTeam ? t('game.events.placedYou', { name }) : t('game.events.placedTeam', { t: e.team, name })
      }
      case 'building-completed': {
        const d = BUILDINGS[e.buildingType]
        return t('game.events.complete', { name: d ? tn(e.buildingType, d.name) : e.buildingType })
      }
      case 'unit-trained': {
        const d = UNITS[e.unitType]
        return t('game.events.trained', { name: d ? tn(e.unitType, d.name) : e.unitType })
      }
      case 'order-queued': {
        const d = UNITS[e.unitType]
        return t('game.events.queued', { name: d ? tn(e.unitType, d.name) : e.unitType })
      }
      case 'order-dequeued': {
        const d = UNITS[e.unitType]
        return t('game.events.dequeued', { name: d ? tn(e.unitType, d.name) : e.unitType, c: d?.cost ?? 0 })
      }
      case 'research-started': {
        const d = UPGRADES[e.upgrade]
        return t('game.events.researchStarted', { name: d ? tn(e.upgrade, d.name) : e.upgrade })
      }
      case 'research-queued': {
        const d = UPGRADES[e.upgrade]
        return t('game.events.researchQueued', { name: d ? tn(e.upgrade, d.name) : e.upgrade })
      }
      case 'research-cancelled': {
        const d = UPGRADES[e.upgrade]
        return t('game.events.researchCancelled', { name: d ? tn(e.upgrade, d.name) : e.upgrade })
      }
      case 'upgrade-completed': {
        const d = UPGRADES[e.upgrade]
        return t('game.events.researchDone', { name: d ? tn(e.upgrade, d.name) : e.upgrade })
      }
      case 'building-sold': {
        const d = BUILDINGS[e.buildingType]
        return t('game.events.sold', { name: d ? tn(e.buildingType, d.name) : e.buildingType, r: e.refund })
      }
      case 'unit-sold': {
        const d = UNITS[e.unitType]
        return t('game.events.unitSold', { name: d ? tn(e.unitType, d.name) : e.unitType, r: e.refund })
      }
      case 'wreck-collected':
        return e.team === this.localTeam ? t('game.events.collected', { a: e.value }) : null
      case 'dozer-assigned': {
        const b = this.world?.buildings.get(e.building)
        const name = b ? (BUILDINGS[b.buildingType] ? tn(b.buildingType, BUILDINGS[b.buildingType].name) : b.buildingType) : t('game.events.building')
        return e.kind === 'construct' ? t('game.events.dozerConstruct', { name }) : t('game.events.dozerRepair', { name })
      }
      case 'work-cancelled':
        return t('game.events.workStopped')
      case 'spawn-point-set':
        return t('game.events.rallyPoint')
      case 'flag-point-set':
        return t('game.events.flagPoint')
      case 'harvester-dock-assigned':
        return t('game.events.dockAssigned')
      case 'satellite-used':
        return e.team === this.localTeam ? t('game.events.satelliteLaunched') : null
      case 'laser-strike':
        return e.team === this.localTeam ? t('game.events.laserStrike') : t('game.events.laserStrikeTeam', { t: e.team })
      case 'sw-chosen':
        return e.team === this.localTeam
          ? t('game.events.swChosen', { name: e.choice === 'laser' ? t('tools.swLaser') : e.choice === 'airstrike' ? t('tools.swAirstrike') : t('tools.swEmp') })
          : null
      case 'airstrike-called':
        return e.team === this.localTeam ? t('game.events.airstrikeCalled') : null
      case 'airstrike-bomb':
        return e.team === this.localTeam ? null : t('game.events.airstrikeBombTeam', { t: e.team })
      case 'emp-strike':
        return e.team === this.localTeam ? t('game.events.empStrike') : t('game.events.empStrikeTeam', { t: e.team })
      case 'supply-harvested':
        return e.bonus > 0 ? t('game.events.supplyBonus', { a: e.amount, b: e.bonus }) : t('game.events.supply', { a: e.amount })
      case 'supply-captured':
        return e.team === this.localTeam ? t('game.events.supplyCaptured') : t('game.events.supplyCapturedTeam', { t: e.team })
      case 'supply-captured-lost':
        return e.team === this.localTeam ? t('game.events.supplyCapturedLost') : null
      case 'oil-claiming':
        return e.team === this.localTeam ? t('game.events.oilClaiming') : t('game.events.oilClaimingTeam', { t: e.team })
      case 'oil-claimed':
        return e.team === this.localTeam ? t('game.events.oilClaimed') : t('game.events.oilClaimedTeam', { t: e.team })
      case 'oil-income':
        return e.team === this.localTeam ? t('game.events.oilIncome', { a: e.amount }) : null
      case 'power-down':
        return t('game.events.powerDown')
      case 'power-restored':
        return t('game.events.powerRestored')
      case 'power-boost':
        return e.team === this.localTeam ? t('game.events.maxPowerOn') : t('game.events.maxPowerTeam', { t: e.team })
      case 'power-boost-ended':
        return e.team === this.localTeam ? t('game.events.maxPowerEnd') : null
      case 'entity-destroyed': {
        if (e.kind === 'field') return t('game.events.destroyed', { name: t('oil.fieldName') })
        const d = e.kind === 'unit' && e.typeName ? UNITS[e.typeName] : e.kind === 'building' && e.typeName ? BUILDINGS[e.typeName] : undefined
        return t('game.events.destroyed', { name: d && e.typeName ? tn(e.typeName, d.name) : e.typeName ?? e.kind })
      }
      case 'unit-ranked-up':
        return this.world && this.world.teamOf(e.unit) === this.localTeam ? t('game.events.rankedUp', { rank: e.rank }) : null
      case 'rank-up':
        return e.team === this.localTeam ? t('game.events.rankUp', { rank: e.rank }) : null
      case 'command-rejected':
        return t('game.rejected', { reason: e.reason })
      case 'player-left':
        return t('game.events.playerLeft', { t: e.team, a: e.amount })
      case 'base-under-attack': {
        if (e.team !== this.localTeam) return null
        const last = this.baseAlertCooldowns.get(e.team) ?? -Infinity
        if (this.world && this.world.tick - last < SECONDS_TO_TICKS(4)) return null
        return t('game.events.baseAttacked', { t: e.team })
      }
      case 'game-over':
        return this.netTitle(e.winner)
      default:
        return null
    }
  }

  private computeGhost(): GhostState | null {
    const world = this.world
    const input = this.input
    if (!world || !input || !this.pendingPlace) return null
    const def = getBuilding(this.pendingPlace.buildingType, world.settings)
    if (!def) return null
    const tx = Math.floor(input.mouseWorld.x / 1000)
    const ty = Math.floor(input.mouseWorld.y / 1000)
    const cx = tileToFx(tx) + (def.footprint[0] * 1000) / 2
    const cy = tileToFx(ty) + (def.footprint[1] * 1000) / 2
    return {
      kind: 'building',
      type: this.pendingPlace.buildingType,
      xFx: cx,
      yFx: cy,
      valid: this.canPlace(this.pendingPlace.buildingType, tx, ty),
      team: this.localTeam,
    }
  }

  private canPlace(buildingType: string, tx: number, ty: number): boolean {
    const world = this.world
    if (!world) return false
    const def = getBuilding(buildingType, world.settings)
    if (!def) return false
    world.rebuildGridIfDirty()
    const grid = world.grid as WorldGrid
    const fog = world.fog.get(this.localTeam)
    const rect = { x: tx, y: ty, w: def.footprint[0], h: def.footprint[1] }
    if (tx < 0 || ty < 0 || tx + rect.w > world.width || ty + rect.h > world.height) return false
    if (fog && !placementExplored(fog, world.width, tx, ty, rect.w, rect.h)) return false
    for (let y = ty; y < ty + rect.h; y++) {
      for (let x = tx; x < tx + rect.w; x++) {
        const idx = y * world.width + x
        if (!grid.buildable[idx]) return false
      }
    }
    return true
  }

  private dozerOrderCount(world: World, id: number): number {
    const w = world.works.get(id)
    const queued = world.buildOrderQueues.get(id)?.length ?? 0
    return (w && w.kind === 'construct' ? 1 : 0) + queued
  }

  private startPlacement(type: string): void {
    const world = this.world
    if (!world) return
    // A dozer may take more build orders while busy ONLY if it is constructing
    // (not collecting/repairing) and has queue capacity (Day 20).
    const dozerId = [...this.selection].find((id) => {
      const u = world.units.get(id)
      if (!u || !world.canControl(this.localTeam, id) || u.unitType !== 'bulldozer') return false
      const w = world.works.get(id)
      if (w && w.kind !== 'construct') return false
      return this.dozerOrderCount(world, id) < world.settings.maxBuildOrders
    })
    if (dozerId === undefined) {
      const busyButFull = [...this.selection].some((id) => {
        const u = world.units.get(id)
        if (!u || !world.canControl(this.localTeam, id) || u.unitType !== 'bulldozer') return false
        const w = world.works.get(id)
        if (w && w.kind !== 'construct') return false
        return this.dozerOrderCount(world, id) >= world.settings.maxBuildOrders
      })
      this.hud.toast(busyButFull ? t('game.orderQueueFull') : t('game.noFreeDozer'))
      return
    }
    this.audio.uiClick()
    this.pendingPlace = { buildingType: type, dozerId }
    this.hud.toast(t('game.place', { name: tn(type, getBuilding(type, world.settings).name) }))
  }

  private queueUnit(unitType: string): void {
    const world = this.world
    if (!world) return
    const buildingId = [...this.selection].find((id) => !!world.buildings.get(id) && world.canControl(this.localTeam, id))
    if (buildingId === undefined) return
    this.issue({ type: 'queue', entities: [buildingId], x: 0, y: 0, unitType })
    this.audio.uiClick()
  }

  private dequeueUnit(buildingId: number, index: number): void {
    const world = this.world
    if (!world) return
    const b = world.buildings.get(buildingId)
    if (!b || !world.canControl(this.localTeam, buildingId)) return
    this.issue({ type: 'dequeue', entities: [buildingId], x: 0, y: 0, index })
    this.audio.uiClick()
  }

  private dequeueResearch(buildingId: number, index: number): void {
    const world = this.world
    if (!world) return
    const b = world.buildings.get(buildingId)
    if (!b || !world.canControl(this.localTeam, buildingId)) return
    if (index < 0 || index >= b.researchQueue.length) return
    this.issue({ type: 'dequeue-research', entities: [buildingId], x: 0, y: 0, index })
    this.audio.uiClick()
  }

  private reorderQueue(buildingId: number, from: number, to: number): void {
    const world = this.world
    if (!world) return
    if (from === to) return
    const b = world.buildings.get(buildingId)
    if (!b || !world.canControl(this.localTeam, buildingId)) return
    const q = world.queues.get(buildingId)
    if (!q || from < 0 || from >= q.queue.length || to < 0 || to >= q.queue.length) return
    this.issue({ type: 'reorder-queue', entities: [buildingId], x: 0, y: 0, index: from, to })
    this.audio.uiClick()
  }

  private researchUpgrade(upgrade: string): void {
    const world = this.world
    if (!world) return
    const buildingId = [...this.selection].find((id) => !!world.buildings.get(id) && world.canControl(this.localTeam, id))
    if (buildingId === undefined) return
    const b = world.buildings.get(buildingId)
    if (!b || !b.done) return
    this.issue({ type: 'research', entities: [buildingId], x: 0, y: 0, upgrade })
    this.audio.uiClick()
  }

  private maxPower(buildingIds: number[]): void {
    const world = this.world
    if (!world || buildingIds.length === 0) return
    const ids = buildingIds.filter((id) => {
      const b = world.buildings.get(id)
      return !!b && world.canControl(this.localTeam, id) && b.done && b.buildingType === 'power-plant'
    })
    if (ids.length === 0) return
    this.issue({ type: 'max-power', entities: ids, x: 0, y: 0 })
    this.audio.uiClick()
  }

  private onStopCommand(): void {
    const world = this.world
    if (!world || this.selection.size === 0) return
    const ids = [...this.selection].filter((id) => !!world.units.get(id) && world.canControl(this.localTeam, id))
    if (ids.length === 0) return
    this.multiRoute = null
    this.issue({ type: 'stop', entities: ids, x: 0, y: 0 })
    this.audio.uiClick()
  }

  private processMultiRoute(): void {
    const r = this.multiRoute
    const world = this.world
    if (!r || !world) return
    for (const id of r.ids) {
      if (!world.units.has(id)) {
        this.multiRoute = null
        return
      }
    }
    const pt = r.pts[r.idx]
    const arrived = r.ids.every((id) => {
      if (world.moves.has(id)) return false
      const t = world.transforms.get(id)
      if (!t) return false
      return Math.hypot(t.x - pt.x, t.y - pt.y) <= 2000
    })
    if (!arrived) return
    r.idx++
    if (r.idx >= r.pts.length) {
      this.multiRoute = null
      return
    }
    this.issueMoveCommand('move', r.ids, r.pts[r.idx])
  }

  private onDeselectClick(): void {
    this.selection.clear()
    this.abilityModes.clear()
    this.mineModes.clear()
    this.pendingUnload = false
    this.audio.uiClick()
  }

  private destroySelection(): void {
    const world = this.world
    if (!world || this.selection.size === 0) return
    const ids = [...this.selection].filter((id) => world.canControl(this.localTeam, id))
    if (ids.length === 0) return
    let refund = 0
    const frac = world.settings.sellRefundFraction
    for (const id of ids) {
      const u = world.units.get(id)
      const b = world.buildings.get(id)
      if (u) refund += Math.floor(getUnit(u.unitType, world.settings).cost * frac)
      if (b) refund += Math.floor(getBuilding(b.buildingType, world.settings).cost * frac)
    }
    this.confirmMessage.textContent = t('confirm.sellMsg', { n: ids.length, refund })
    this.confirmOverlay.classList.add('visible')
    this.audio.uiClick()
  }

  private onConfirmYesClick = (): void => {
    this.confirmOverlay.classList.remove('visible')
    this.sellSelection()
  }

  private onConfirmNoClick = (): void => {
    this.confirmOverlay.classList.remove('visible')
  }

  private sellSelection(): void {
    const world = this.world
    if (!world || this.selection.size === 0) return
    const ids = [...this.selection].filter((id) => world.canControl(this.localTeam, id))
    if (ids.length === 0) return
    this.issue({ type: 'sell', entities: ids, x: 0, y: 0 })
    this.selection.clear()
    this.audio.uiClick()
  }

  private onClick(info: ClickInfo): void {
    const world = this.world
    if (!world) return
    if (this.pingMode) {
      this.placePing({ x: info.world.x, y: info.world.y })
      return
    }
    if (this.pendingLaser || this.pendingAirstrike || this.pendingEmp) {
      const tx = Math.floor(info.world.x / 1000)
      const ty = Math.floor(info.world.y / 1000)
      if (tx >= 0 && ty >= 0 && tx < world.width && ty < world.height) {
        if (this.pendingLaser) this.issue({ type: 'laser', entities: [], x: tx, y: ty })
        else if (this.pendingAirstrike) this.issue({ type: 'sw-airstrike', entities: [], x: tx, y: ty })
        else this.issue({ type: 'sw-emp', entities: [], x: tx, y: ty })
        this.cancelStrikeTargeting(true)
      } else {
        this.hud.toast(t('game.laserInvalid'))
      }
      return
    }
    if (this.pendingPlace) {
      const tx = Math.floor(info.world.x / 1000)
      const ty = Math.floor(info.world.y / 1000)
      if (this.canPlace(this.pendingPlace.buildingType, tx, ty)) {
        const busy = this.dozerOrderCount(world, this.pendingPlace.dozerId) > 0
        this.issue({ type: 'place', entities: [this.pendingPlace.dozerId], x: tx, y: ty, buildingType: this.pendingPlace.buildingType })
        // Keep placement active so the player can append more orders by clicking
        // (Day 20). Once the dozer's queue is full, drop out of placement mode.
        const orders = this.dozerOrderCount(world, this.pendingPlace.dozerId) + 1
        if (busy) this.hud.toast(t('game.orderQueued', { n: orders, max: world.settings.maxBuildOrders }))
        if (orders >= world.settings.maxBuildOrders) {
          this.pendingPlace = null
          this.hud.toast(t('game.orderQueueFull'))
        }
      } else {
        this.hud.toast(t('game.cannotPlace'))
      }
      return
    }
    if (this.placePendingMarker(info.world)) return
    const hit = this.pickEntity(info.world.x, info.world.y)
    if (info.touch && this.selection.size > 0) {
      const hasUnits = [...this.selection].some((id) => world.units.has(id))
      if (hasUnits) {
        if (hit !== null && this.isEnemy(hit)) {
          this.onCommand('attack', info.world)
          return
        }
        if (hit !== null) {
          this.selection = new Set([hit])
          this.notifySelection()
          return
        }
        this.onCommand('move', info.world)
        return
      }
    }
    if (hit !== null) {
      if (info.ctrl) {
        if (this.selection.has(hit)) this.selection.delete(hit)
        else this.selection.add(hit)
      } else if (
        !info.touch &&
        this.selection.size > 0 &&
        this.isEnemy(hit) &&
        [...this.selection].some((id) => world.units.has(id))
      ) {
        // Clicking an enemy while friendly units are selected issues an attack
        // order (mirrors the touch/tap path) instead of just re-selecting the
        // enemy — so a single click on a far-away troop reliably engages it.
        this.onCommand('attack', info.world)
        return
      } else {
        this.selection = new Set([hit])
      }
      this.notifySelection()
    } else if (!info.ctrl) {
      this.selection.clear()
    }
  }

  /** Play a selection bleep (pitch by unit class) + select haptic for the current selection. */
  private notifySelection(): void {
    const world = this.world
    if (!world) return
    let clazz: string | null = null
    for (const id of this.selection) {
      const u = world.units.get(id)
      if (u) {
        clazz = u.class
        break
      }
    }
    if (clazz) this.audio.playSelectBleep(clazz)
    hapticSelect()
  }

  private onBox(box: BoxInfo): void {
    const world = this.world
    const renderer = this.renderer
    if (!world || !renderer) return
    const selected = new Set<number>()
    const cam = renderer.camera
    world.units.forEach((id, _u) => {
      if (!this.spectator && !world.canControl(this.localTeam, id)) return
      const t = world.transforms.require(id)
      const p = { x: 0, y: 0 }
      cam.worldToScreen(t.x, t.y, p)
      if (p.x >= box.x0 && p.x <= box.x1 && p.y >= box.y0 && p.y <= box.y1) {
        selected.add(id)
      }
    })
    if (selected.size > 0) {
      this.selection = selected
      this.notifySelection()
    }
  }

  private pickEntity(worldX: number, worldY: number): number | null {
    const world = this.world
    if (!world) return null
    const revealAll = this.renderer?.showAll ?? false
    const tileX = worldX / 1000
    const tileY = worldY / 1000
    let best: number | null = null
    let bestArea = Infinity
    world.units.forEach((id, u) => {
      if (!world.isVisibleTo(this.localTeam, id, revealAll)) return
      const t = world.transforms.require(id)
      const r = u.class === 'vehicle' || u.class === 'naval' ? 1.3 : 1.1
      const dx = tileX - t.x / 1000
      const dy = tileY - t.y / 1000
      if (dx * dx + dy * dy <= r * r) {
        const area = r * r
        if (area < bestArea) {
          bestArea = area
          best = id
        }
      }
    })
    world.buildings.forEach((id, b) => {
      if (!world.isVisibleTo(this.localTeam, id, revealAll)) return
      const t = world.transforms.require(id)
      const rect = rectFromCenter(t.x, t.y, b.footprintW, b.footprintH)
      if (tileX >= rect.x && tileX < rect.x + rect.w && tileY >= rect.y && tileY < rect.y + rect.h) {
        const area = rect.w * rect.h
        if (area < bestArea) {
          bestArea = area
          best = id
        }
      }
    })
    world.scenery.forEach((id, s) => {
      if (s.type !== 'rock') return
      const t = world.transforms.require(id)
      const rect = rectFromCenter(t.x, t.y, s.w, s.h)
      if (tileX >= rect.x && tileX < rect.x + rect.w && tileY >= rect.y && tileY < rect.y + rect.h) {
        const area = rect.w * rect.h
        if (area < bestArea) {
          bestArea = area
          best = id
        }
      }
    })
    world.wrecks.forEach((id) => {
      if (!world.isVisibleTo(this.localTeam, id, revealAll)) return
      const t = world.transforms.require(id)
      const r = 1.3
      const dx = tileX - t.x / 1000
      const dy = tileY - t.y / 1000
      if (dx * dx + dy * dy <= r * r) {
        const area = r * r
        if (area < bestArea) {
          bestArea = area
          best = id
        }
      }
    })
    return best
  }

  private onSatelliteClick = (): void => {
    if (!this.world) return
    this.issue({ type: 'satellite', entities: [], x: 0, y: 0 })
    this.audio.uiClick()
  }

  private onLaserClick = (): void => {
    const world = this.world
    if (!world) return
    if (!world.laserAvailable(this.localTeam)) {
      this.hud.toast(t('game.laserUnavailable'))
      return
    }
    this.pendingLaser = true
    this.hud.toast(t('game.laserTarget'))
    this.audio.uiClick()
  }

  private onStrikeClick = (): void => {
    const world = this.world
    if (!world) return
    if (world.airstrikeAvailable(this.localTeam)) {
      this.pendingAirstrike = true
      this.pendingLaser = false
      this.hud.toast(t('game.airstrikeTarget'))
    } else if (world.empAvailable(this.localTeam)) {
      this.pendingEmp = true
      this.pendingLaser = false
      this.hud.toast(t('game.empTarget'))
    } else {
      this.hud.toast(t('game.laserUnavailable'))
    }
    this.audio.uiClick()
  }

  private cancelStrikeTargeting(quiet: boolean): void {
    const armed = this.pendingLaser || this.pendingAirstrike || this.pendingEmp
    this.pendingLaser = false
    this.pendingAirstrike = false
    this.pendingEmp = false
    if (armed && !quiet) this.hud.toast(t('game.laserCancelled'))
  }

  private onIdleWorkerClick = (): void => {
    this.centerOnIdleWorker('harvester')
  }

  private onIdleDozerClick = (): void => {
    this.centerOnIdleWorker('bulldozer')
  }

  private onLogToggleClick = (): void => {
    this.toggleGameLog()
  }

  private toggleAttackMove = (): void => {
    const input = this.input
    if (!input) return
    input.aKey = !input.aKey
    input.keepAttackKey = false
    input.guardKey = false
    this.hud.toast(input.aKey ? t('game.attackMoveOn') : t('game.attackMoveOff'))
    this.audio.uiClick()
    this.syncMobileToolButtons()
  }

  private toggleKeepAttack = (): void => {
    const input = this.input
    if (!input) return
    input.keepAttackKey = !input.keepAttackKey
    input.aKey = false
    input.guardKey = false
    this.hud.toast(input.keepAttackKey ? t('game.keepAttackOn') : t('game.keepAttackOff'))
    this.audio.uiClick()
    this.syncMobileToolButtons()
  }

  private toggleGuard = (): void => {
    const input = this.input
    if (!input) return
    input.guardKey = !input.guardKey
    input.aKey = false
    input.keepAttackKey = false
    this.hud.toast(input.guardKey ? t('game.guardOn') : t('game.guardOff'))
    this.audio.uiClick()
    this.syncMobileToolButtons()
  }

  /** Day 21: owned selected units that carry a weapon (ground or air). */
  private selectedCombat(): number[] {
    const world = this.world
    if (!world) return []
    return [...this.selection].filter((id) => {
      const u = world.units.get(id)
      return !!u && u.team === this.localTeam && world.attacks.has(id)
    })
  }

  /** Day 21: owned non-air selected units (formations only apply to troops/vehicles). */
  private selectedMovableFormations(): number[] {
    const world = this.world
    if (!world) return []
    return [...this.selection].filter((id) => {
      const u = world.units.get(id)
      return !!u && u.team === this.localTeam && u.class !== 'air'
    })
  }

  private onAutoFireToggle = (): void => {
    const world = this.world
    if (!world) return
    const ids = this.selectedCombat()
    if (ids.length === 0) return
    const on = !this.allAutoFire()
    this.issue({ type: 'set-auto-fire', entities: ids, x: 0, y: 0, autoFire: on })
    this.hud.toast(on ? t('game.autoFireOn') : t('game.autoFireOff'))
    this.audio.uiClick()
  }

  private allAutoFire = (): boolean => {
    const world = this.world
    if (!world) return false
    const ids = this.selectedCombat()
    if (ids.length === 0) return false
    for (const id of ids) {
      if (world.attacks.get(id)?.autoFire !== true) return false
    }
    return true
  }

  private onFormationClick = (mode: 'tight' | 'loose' | 'hold'): void => {
    const world = this.world
    if (!world) return
    const ids = this.selectedMovableFormations()
    if (ids.length === 0) return
    const first = world.units.get(ids[0])
    const currentSpread = first?.formationSpread ?? 1
    const currentCode = currentSpread === 0.7 ? 1 : currentSpread === 1.5 ? 2 : 0
    const currentRel = first?.relativeFormation ?? false
    let spreadCode = currentCode
    let relative = currentRel
    if (mode === 'hold') {
      relative = !this.isFormationActive('hold')
    } else {
      const active = this.isFormationActive(mode)
      spreadCode = active ? 0 : mode === 'tight' ? 1 : 2
    }
    this.issue({ type: 'set-formation', entities: ids, x: 0, y: 0, spreadCode, relative })
    if (mode === 'hold') {
      this.hud.toast(relative ? t('game.formHoldOn') : t('game.formHoldOff'))
    } else if (spreadCode === 1) {
      this.hud.toast(t('game.formTightOn'))
    } else if (spreadCode === 2) {
      this.hud.toast(t('game.formLooseOn'))
    } else {
      this.hud.toast(t('game.formNormal'))
    }
    this.audio.uiClick()
  }

  private isFormationActive = (mode: 'tight' | 'loose' | 'hold'): boolean => {
    const world = this.world
    if (!world) return false
    const ids = this.selectedMovableFormations()
    if (ids.length === 0) return false
    const want = mode === 'tight' ? 0.7 : mode === 'loose' ? 1.5 : 1
    for (const id of ids) {
      const u = world.units.get(id)
      if (!u) return false
      if (mode === 'hold') {
        if (u.relativeFormation !== true) return false
      } else if ((u.formationSpread ?? 1) !== want) {
        return false
      }
    }
    return true
  }

  private onMobileControlsClick = (e: MouseEvent): void => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-tool]')
    if (btn && this.mobileControls?.contains(btn)) this.onMobileToolClick(btn.dataset.tool ?? '')
  }

  private onMobileToolClick = (tool: string): void => {
    const input = this.input
    switch (tool) {
      case 'X':
        if (input) {
          input.boxSelect = !input.boxSelect
          this.hud.toast(input.boxSelect ? t('game.boxSelectOn') : t('game.boxSelectOff'))
        }
        break
      case 'B':
        this.toggleDevOption('borders')
        break
      case 'P':
        this.toggleDevOption('paths')
        break
      case 'F':
        this.toggleDevOption('reveal')
        break
      case 'N':
        this.toggleDevOption('bases')
        break
      case 'M':
        this.toggleMinimapScale()
        break
      case 'H':
        this.centerHome()
        break
      case 'I':
        this.centerOnIdleWorker('harvester')
        break
      case 'D':
        this.centerOnIdleWorker('bulldozer')
        break
      case 'L':
        this.toggleGameLog()
        break
    }
    this.syncMobileToolButtons()
  }

  private syncMobileToolButtons(): void {
    const bar = this.mobileControls
    if (!bar) return
    const renderer = this.renderer
    const input = this.input
    const world = this.world
    let hasCombatUnits = false
    let hasUnits = false
    if (world) {
      for (const id of this.selection) {
        const u = world.units.get(id)
        if (!u || u.team !== this.localTeam) continue
        hasUnits = true
        if (world.attacks.has(id)) hasCombatUnits = true
      }
    }
    for (const btn of bar.querySelectorAll<HTMLButtonElement>('button[data-tool]')) {
      const tool = btn.dataset.tool ?? ''
      const relevant = this.mobileToolRelevant(tool, hasCombatUnits, hasUnits)
      btn.style.display = relevant ? '' : 'none'
      if (!relevant) continue
      let active = false
      if (tool === 'X') active = input?.boxSelect ?? false
      else if (tool === 'B') active = renderer?.showBorders ?? false
      else if (tool === 'P') active = renderer?.showPaths ?? false
      else if (tool === 'F') active = renderer?.showAll ?? false
      else if (tool === 'N') active = renderer?.showBases ?? false
      else if (tool === 'L') active = this.logVisible
      btn.classList.toggle('active', active)
    }
    this.syncPingButtons()
    this.syncDevButtons()
  }

  private mobileToolRelevant(_tool: string, _hasCombatUnits: boolean, _hasUnits: boolean): boolean {
    return true
  }

  private lastMobileSelSig = ''

  private syncMobileToolButtonsForSelection(): void {
    const sig = [...this.selection].sort((a, b) => a - b).join(',')
    if (sig === this.lastMobileSelSig) return
    this.lastMobileSelSig = sig
    this.syncMobileToolButtons()
  }

  private updateSatelliteButton(world: World): void {
    const btn = this.satelliteBtn
    if (!btn) return
    const ts = world.teamState(this.localTeam)
    const cooldown = world.settings.satelliteCooldownTicks - (world.tick - ts.satelliteLastUsed)
    const ready = ts.satellite && cooldown <= 0 && world.hasDoneBuilding(this.localTeam, 'tech-center')
    btn.disabled = !ready
    btn.textContent = !ts.satellite || ready ? t('tools.satellite') : t('tools.satelliteCountdown', { s: Math.ceil(cooldown / SIM_TICK_HZ) })
    btn.title = !ts.satellite
      ? t('tools.satelliteDisabled')
      : !world.hasDoneBuilding(this.localTeam, 'tech-center')
        ? t('tools.satelliteNoCenter')
        : ready
          ? t('tools.satelliteReady')
          : t('tools.satelliteCooldown')
  }

  private updateLaserButton(world: World): void {
    const btn = this.laserBtn
    if (!btn) return
    const ts = world.teamState(this.localTeam)
    const cooldown = world.laserCooldownRemaining(this.localTeam)
    const ready = world.laserAvailable(this.localTeam)
    const lv = world.laserLevel(this.localTeam)
    const label = lv > 0 ? t('tools.laserLevel', { lv }) : t('tools.laser')
    btn.disabled = !ready
    btn.textContent = !ts.laser || ready ? label : t('tools.laserCountdown', { s: Math.ceil(cooldown / SIM_TICK_HZ) })
    btn.title = !ts.laser
      ? t('tools.laserDisabled')
      : !ready
        ? t('tools.laserUnavailable')
        : t('tools.laserReady')
  }

  private updateLaserTarget(renderer: Renderer): void {
    const world = this.world
    const input = this.input
    if (!world || !input || (!this.pendingLaser && !this.pendingAirstrike && !this.pendingEmp)) {
      renderer.laserTarget = null
      return
    }
    const tx = Math.floor(input.mouseWorld.x / 1000)
    const ty = Math.floor(input.mouseWorld.y / 1000)
    const isEmp = this.pendingEmp
    renderer.laserTarget = {
      x: tx * 1000 + 500,
      y: ty * 1000 + 500,
      valid: tx >= 0 && ty >= 0 && tx < world.width && ty < world.height,
      radius: isEmp ? world.settings.empRadiusTiles : this.pendingAirstrike ? world.settings.airstrikeBombRadius : undefined,
      color: isEmp ? 0xc070ff : this.pendingAirstrike ? 0xffa050 : undefined,
    }
  }

  private updateStrikeButton(world: World): void {
    const btn = this.strikeBtn
    if (!btn) return
    const choice = world.teamState(this.localTeam).swChoice
    if (choice !== 'airstrike' && choice !== 'emp') {
      btn.hidden = true
      return
    }
    btn.hidden = false
    const ready = choice === 'airstrike' ? world.airstrikeAvailable(this.localTeam) : world.empAvailable(this.localTeam)
    const cooldown = choice === 'airstrike' ? world.airstrikeCooldownRemaining(this.localTeam) : world.empCooldownRemaining(this.localTeam)
    const label = choice === 'airstrike' ? t('tools.swAirstrike') : t('tools.swEmp')
    btn.disabled = !ready
    if (ready) {
      btn.textContent = label
      btn.title = t('tools.strikeReady')
    } else if (cooldown > 0) {
      // The countdown must name this strike (Airstrike/EMP), not the laser.
      btn.textContent = t('tools.strikeCountdown', { name: label, s: Math.ceil(cooldown / SIM_TICK_HZ) })
      btn.title = t('tools.strikeCooldown', { name: label })
    } else {
      // Super weapon destroyed / powered down — there is no timer to show.
      btn.textContent = label
      btn.title = t('tools.strikeUnavailable', { name: label })
    }
  }

  private selectedProducer(): number | null {
    const world = this.world
    if (!world) return null
    for (const id of this.selection) {
      const b = world.buildings.get(id)
      if (b && b.done && b.team === this.localTeam && PRODUCERS.has(b.buildingType)) return id
    }
    return null
  }

  private placePendingMarker(worldPt: { x: number; y: number }): boolean {
    const world = this.world
    if (!world) return true
    if (this.pendingUnload) {
      const transports: number[] = []
      for (const id of this.selection) {
        const tc = world.transports.get(id)
        if (tc && tc.team === this.localTeam && tc.passengers.length > 0) transports.push(id)
      }
      if (transports.length > 0) {
        const cmds = transports.map((id) => ({
          type: 'transport-unload' as const,
          entities: [],
          x: Math.floor(worldPt.x),
          y: Math.floor(worldPt.y),
          transportId: id,
        }))
        this.issueBatch(cmds)
      }
      this.pendingUnload = false
      this.hud.toast(t('game.unloadOrdered'))
      return true
    }
    if (this.pendingSpawnPoint) {
      const producer = this.selectedProducer()
      if (producer !== null) {
        this.issue({ type: 'set-spawn-point', entities: [producer], x: Math.floor(worldPt.x / 1000), y: Math.floor(worldPt.y / 1000) })
        this.holdPlaced = true
      }
      this.hud.toast(t('game.spawnSet'))
      return true
    }
    if (this.pendingFlag) {
      const producer = this.selectedProducer()
      if (producer !== null) {
        this.issue({ type: 'set-flag-point', entities: [producer], x: Math.floor(worldPt.x / 1000), y: Math.floor(worldPt.y / 1000) })
        this.holdPlaced = true
      }
      this.hud.toast(t('game.flagSet'))
      return true
    }
    return false
  }

  private beginPendingMarker(kind: 'spawn' | 'flag'): void {
    if (this.pendingSpawnPoint || this.pendingFlag) return
    if (this.selectedProducer() === null) {
      this.hud.toast(t('game.selectProducer'))
      return
    }
    this.holdPlaced = false
    if (kind === 'spawn') {
      this.pendingSpawnPoint = true
      this.pendingPlace = null
      this.cancelStrikeTargeting(true)
      this.hud.toast(t('game.spawnTarget'))
    } else {
      this.pendingFlag = true
      this.pendingPlace = null
      this.cancelStrikeTargeting(true)
      this.hud.toast(t('game.flagTarget'))
    }
    this.audio.uiClick()
  }

  private togglePendingMarker(kind: 'spawn' | 'flag'): void {
    if (kind === 'spawn') {
      if (this.pendingSpawnPoint) {
        this.pendingSpawnPoint = false
        this.holdPlaced = false
        this.hud.toast(t('game.spawnCancelled'))
        return
      }
    } else {
      if (this.pendingFlag) {
        this.pendingFlag = false
        this.holdPlaced = false
        this.hud.toast(t('game.flagCancelled'))
        return
      }
    }
    this.beginPendingMarker(kind)
    this.syncMobileToolButtons()
  }

  private onKeyUp = (e: KeyboardEvent): void => {
    if (this.keyMatch(e, 'groupMod')) this.groupModDown = false
    if (this.keyMatch(e, 'spawnPoint') && this.pendingSpawnPoint) {
      this.pendingSpawnPoint = false
      if (!this.holdPlaced) this.hud.toast(t('game.spawnCancelled'))
      this.holdPlaced = false
      return
    }
    if (this.keyMatch(e, 'flag') && this.pendingFlag) {
      this.pendingFlag = false
      if (!this.holdPlaced) this.hud.toast(t('game.flagCancelled'))
      this.holdPlaced = false
      return
    }
    if (this.keyMatch(e, 'esc') && this.pendingUnload) {
      this.pendingUnload = false
      this.hud.toast(t('game.unloadCancelled'))
      return
    }
  }

  private toggleUnload(): void {
    const world = this.world
    if (!world) return
    let anyLoaded = false
    for (const id of this.selection) {
      const tc = world.transports.get(id)
      if (tc && tc.team === this.localTeam && tc.passengers.length > 0) {
        anyLoaded = true
        break
      }
    }
    if (!anyLoaded) {
      this.hud.toast(t('game.selectLoadedTransport'))
      return
    }
    this.pendingUnload = !this.pendingUnload
    this.holdPlaced = false
    if (this.pendingUnload) {
      this.pendingPlace = null
      this.cancelStrikeTargeting(true)
      this.hud.toast(t('game.unloadTarget'))
    } else {
      this.hud.toast(t('game.unloadCancelled'))
    }
    this.audio.uiClick()
  }

  private toggleGameLog(): void {
    this.logVisible = !this.logVisible
    const el = document.getElementById('game-log')
    if (el) el.classList.toggle('visible', this.logVisible)
    this.logToggle?.classList.toggle('active', this.logVisible)
    this.hud.toast(this.logVisible ? t('game.logShown') : t('game.logHidden'))
    this.syncMobileToolButtons()
  }

  private toggleMinimapScale(): void {
    if (!this.mm) return
    const next = this.mm.displayScale > 1 ? 1 : getGraphics().minimapScale
    this.mm.setDisplayScale(next)
    this.layoutToolsBar()
    this.hud.toast(next > 1 ? t('game.minimapEnlarged') : t('game.minimapNormal'))
  }

  private layoutToolsBar(): void {
    if (!this.toolsBar) return
    if (this.isMobileView()) {
      this.toolsBar.style.top = '56px'
      this.toolsBar.style.bottom = 'auto'
      this.toolsBar.style.right = '8px'
    } else {
      this.toolsBar.style.top = '48px'
      this.toolsBar.style.right = '12px'
      this.toolsBar.style.bottom = 'auto'
    }
  }

  /** Keep the selection bar at 75% of the minimap wrap height so the minimap
   * overhangs above the bar (visual trick). Sets `--sel-bar-h` on #hud;
   * the build menu / stat text stay inside that height via CSS. */
  private layoutSelectionBarHeight(): void {
    const hud = document.getElementById('hud')
    const wrap = this.mmWrap
    if (!hud || !wrap) return
    let h = Math.max(64, Math.round(wrap.offsetHeight * 0.75))
    if (hud.classList.contains('sel-expanded')) h = Math.max(h, 128)
    hud.style.setProperty('--sel-bar-h', `${h}px`)
  }

  /** Toggle the Alt+click ping mode to the given flavour (clicking the active
   * flavour again turns the mode off). » Ping » (6.1/6.2). */
  private togglePing(type: PingType): void {
    this.pingMode = this.pingMode === type ? null : type
    this.audio.uiClick()
    if (this.pingMode === null) {
      this.hud.toast(t('game.pingModeOff'))
    } else if (type === 'alert') {
      this.hud.toast(t('game.pingAlert'))
    } else if (type === 'assist') {
      this.hud.toast(t('game.pingAssist'))
    } else {
      this.hud.toast(t('game.pingOmw'))
    }
    this.syncPingButtons()
  }

  private syncPingButtons(): void {
    for (const btn of this.pingBtns) {
      btn.classList.toggle('active', btn.dataset.ping === this.pingMode)
    }
  }

  /** Send a ping command at a world point (fx units); clamped tile coordinates. */
  private placePing(worldPt: { x: number; y: number }): void {
    const world = this.world
    if (!world || !this.pingMode) return
    const tx = Math.floor(worldPt.x / 1000)
    const ty = Math.floor(worldPt.y / 1000)
    if (tx < 0 || ty < 0 || tx >= world.width || ty >= world.height) return
    this.issue({ type: 'ping', entities: [], x: tx, y: ty, pingType: this.pingMode })
    this.audio.uiClick()
  }

  private toggleDevOption(opt: 'borders' | 'paths' | 'reveal' | 'bases'): void {
    const renderer = this.renderer
    if (!renderer) return
    if (opt === 'borders') {
      renderer.showBorders = !renderer.showBorders
      this.hud.toast(renderer.showBorders ? t('game.bordersOn') : t('game.bordersOff'))
    } else if (opt === 'paths') {
      renderer.showPaths = !renderer.showPaths
      this.hud.toast(renderer.showPaths ? t('game.pathsOn') : t('game.pathsOff'))
    } else if (opt === 'reveal') {
      renderer.showAll = !renderer.showAll
      this.hud.toast(renderer.showAll ? t('game.revealOn') : t('game.revealOff'))
    } else {
      renderer.showBases = !renderer.showBases
      this.hud.toast(renderer.showBases ? t('game.basesOn') : t('game.basesOff'))
    }
    this.syncMobileToolButtons()
    this.syncDevButtons()
  }

  private devOptionActive(opt: 'borders' | 'paths' | 'reveal' | 'bases'): boolean {
    const renderer = this.renderer
    if (!renderer) return false
    if (opt === 'borders') return renderer.showBorders
    if (opt === 'paths') return renderer.showPaths
    if (opt === 'reveal') return renderer.showAll
    return renderer.showBases
  }

  private syncDevButtons(): void {
    for (const btn of this.devBtns) {
      const opt = (btn.dataset.dev ?? '') as 'borders' | 'paths' | 'reveal' | 'bases' | ''
      if (opt) btn.classList.toggle('active', this.devOptionActive(opt))
    }
  }

  /** The vertical button rail next to the minimap: pings, dev toggles, map & home. */
  private buildMinimapRail(): HTMLElement {
    const rail = document.createElement('div')
    rail.className = 'mm-rail'
    this.pingBtns = []
    const pingSpecs: Array<{ type: PingType; glyph: string }> = [
      { type: 'alert', glyph: '!' },
      { type: 'assist', glyph: '+' },
      { type: 'on-my-way', glyph: '→' },
    ]
    for (const spec of pingSpecs) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'mm-rail-btn ping ping-' + spec.type
      btn.dataset.ping = spec.type
      btn.textContent = spec.glyph
      btn.title = spec.type === 'alert' ? t('tools.pingAlertTitle') : spec.type === 'assist' ? t('tools.pingAssistTitle') : t('tools.pingOmwTitle')
      btn.addEventListener('click', () => this.togglePing(spec.type))
      rail.appendChild(btn)
      this.pingBtns.push(btn)
    }
    const sep = document.createElement('div')
    sep.className = 'mm-rail-sep'
    rail.appendChild(sep)
    const mapBtn = document.createElement('button')
    mapBtn.type = 'button'
    mapBtn.className = 'mm-rail-btn mm-btn'
    mapBtn.textContent = t('tools.minimapShort')
    mapBtn.title = t('tools.minimapTitle')
    mapBtn.addEventListener('click', () => this.toggleMinimapScale())
    rail.appendChild(mapBtn)
    const homeBtn = document.createElement('button')
    homeBtn.type = 'button'
    homeBtn.className = 'mm-rail-btn mm-btn'
    homeBtn.textContent = t('tools.homeShort')
    homeBtn.title = t('tools.homeTitle')
    homeBtn.addEventListener('click', () => this.centerHome())
    rail.appendChild(homeBtn)
    return rail
  }

  /** Render the B/P/F/N dev-render toggle buttons inside the dev popup (6.3/6.4). */
  private buildDevRenderButtons(): void {
    const container = document.getElementById('dev-render-btns')
    if (!container) return
    container.textContent = ''
    this.devBtns = []
    const devSpecs: Array<{ opt: 'borders' | 'paths' | 'reveal' | 'bases'; glyph: string }> = [
      { opt: 'borders', glyph: 'B' },
      { opt: 'paths', glyph: 'P' },
      { opt: 'reveal', glyph: 'F' },
      { opt: 'bases', glyph: 'N' },
    ]
    for (const spec of devSpecs) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'dev-render-btn dev-' + spec.opt
      btn.dataset.dev = spec.opt
      btn.textContent = spec.glyph
      btn.title =
        spec.opt === 'borders' ? t('mobile.btns.B') : spec.opt === 'paths' ? t('mobile.btns.P') : spec.opt === 'reveal' ? t('mobile.btns.F') : t('mobile.btns.N')
      btn.addEventListener('click', () => this.toggleDevOption(spec.opt))
      container.appendChild(btn)
      this.devBtns.push(btn)
    }
    this.syncDevButtons()
  }

  /** Build the header-part visibility toggles used by the dev popup (6.5). */
  private buildHudPartToggles(): void {
    const container = document.getElementById('dev-hud-toggles')
    if (!container) return
    container.textContent = ''
    const parts: Array<{ id: string; key: string; label: () => string }> = [
      { id: 'fps-info', key: 'fps', label: () => t('dev.hudFps') },
      { id: 'tick-info', key: 'ticks', label: () => t('dev.hudTicks') },
      { id: 'sync-info', key: 'sync', label: () => t('dev.hudSync') },
    ]
    let saved: Record<string, boolean> = {}
    try {
      saved = JSON.parse(localStorage.getItem('space-arenas:hud-parts') ?? '{}') as Record<string, boolean>
    } catch {
      saved = {}
    }
    for (const part of parts) {
      const wrap = document.createElement('label')
      wrap.className = 'dev-toggle-row'
      const cb = document.createElement('input')
      cb.type = 'checkbox'
      const on = saved[part.key] ?? true
      cb.checked = on
      const span = document.createElement('span')
      span.textContent = part.label()
      wrap.appendChild(cb)
      wrap.appendChild(span)
      container.appendChild(wrap)
      this.hudPartToggles.push({ el: cb, key: part.key, on })
      cb.addEventListener('change', () => {
        const tgl = this.hudPartToggles.find((x) => x.key === part.key)
        if (tgl) {
          tgl.on = cb.checked
          this.applyHudPart(part.key, cb.checked)
          this.persistHudParts()
        }
      })
    }
    this.applyHudParts()
  }

  private applyHudParts(): void {
    for (const tgl of this.hudPartToggles) {
      this.applyHudPart(tgl.key, tgl.on)
    }
  }

  private applyHudPart(key: string, on: boolean): void {
    const el = document.getElementById(key === 'fps' ? 'fps-info' : key === 'ticks' ? 'tick-info' : 'sync-info')
    if (el) el.style.display = on ? '' : 'none'
  }

  private persistHudParts(): void {
    const out: Record<string, boolean> = {}
    for (const tgl of this.hudPartToggles) out[tgl.key] = tgl.on
    try {
      localStorage.setItem('space-arenas:hud-parts', JSON.stringify(out))
    } catch {
      /* storage unavailable */
    }
  }

  private onDevClick = (): void => {
    this.devOverlayVisible = !this.devOverlayVisible
    this.devOverlay?.classList.toggle('visible', this.devOverlayVisible)
    this.devBtn?.classList.toggle('active', this.devOverlayVisible)
    if (this.devOverlayVisible) {
      this.updateDevOverlay()
    }
  }

  private closeDevOverlay = (): void => {
    this.devOverlayVisible = false
    this.devOverlay?.classList.remove('visible')
    this.devBtn?.classList.remove('active')
  }

  /** Live perf readout for the dev popup (6.5). */
  private updateDevOverlay(): void {
    const world = this.world
    const el = this.devPerfEl
    if (!el) return
    const rows: Array<[string, string]> = [
      [t('dev.perfFps'), String(this.hud.fps)],
      [t('dev.perfTicks'), world ? String(world.tick) : '—'],
      [t('dev.perfTickRate'), `${SIM_TICK_HZ} ts/s`],
      [t('dev.perfEntities'), world ? String(world.units.size + world.buildings.size) : '—'],
      [t('dev.perfSync'), this.localHash !== 0 ? (this.syncOk ? t('hud.inSync') : t('hud.desync')) : '—'],
    ]
    el.textContent = ''
    for (const [label, value] of rows) {
      const row = document.createElement('div')
      row.className = 'dev-perf-row'
      const l = document.createElement('span')
      l.textContent = label
      const v = document.createElement('b')
      v.textContent = value
      row.appendChild(l)
      row.appendChild(v)
      el.appendChild(row)
    }
    const sh = this.devShortcutsEl
    if (sh) {
      sh.textContent = ''
      const ctrl = getControls()
      const keyFor = (id: string): string => ctrl[id] ?? '-'
      const items: Array<[string, string]> = [
        [t('mobile.btns.B'), keyFor('borders')],
        [t('mobile.btns.P'), keyFor('paths')],
        [t('mobile.btns.F'), keyFor('reveal')],
        [t('mobile.btns.N'), keyFor('bases')],
      ]
      for (const [label, key] of items) {
        const row = document.createElement('div')
        row.className = 'dev-perf-row'
        const l = document.createElement('span')
        l.textContent = label
        const v = document.createElement('b')
        v.textContent = key.toUpperCase()
        row.appendChild(l)
        row.appendChild(v)
        sh.appendChild(row)
      }
    }
  }

  private centerHome(): void {
    const world = this.world
    const renderer = this.renderer
    if (!world || !renderer) return
    let home: { x: number; y: number } | undefined
    world.buildings.forEach((id, b) => {
      if (home === undefined && b.team === this.localTeam && b.done && b.buildingType === 'command-center') {
        const t = world.transforms.get(id)
        if (t) home = { x: t.x, y: t.y }
      }
    })
    if (home) renderer.camera.centerOn(home.x, home.y)
    else renderer.camera.centerOnMap(world.width, world.height)
  }

  private idleCycleIndex: Record<'harvester' | 'bulldozer', number> = { harvester: 0, bulldozer: 0 }

  private idleWorkers(kind: 'harvester' | 'bulldozer'): Array<{ id: number; x: number; y: number; d: number }> {
    const world = this.world
    const renderer = this.renderer
    if (!world || !renderer) return []
    const cam = renderer.camera
    const cx = cam.viewWidth / 2
    const cy = cam.viewHeight / 2
    const pos = { x: 0, y: 0 }
    const list: Array<{ id: number; x: number; y: number; d: number }> = []
    const type = kind === 'harvester' ? 'harvester' : 'bulldozer'
    world.units.forEach((id, u) => {
      if (u.team !== this.localTeam) return
      if (u.unitType !== type) return
      if (world.moves.has(id)) return
      if (world.works.has(id)) return
      const hv = world.harvesters.get(id)
      if (hv && hv.phase !== 'idle') return
      const t = world.transforms.get(id)
      if (!t) return
      cam.worldToScreen(t.x, t.y, pos)
      const d = (pos.x - cx) * (pos.x - cx) + (pos.y - cy) * (pos.y - cy)
      list.push({ id, x: t.x, y: t.y, d })
    })
    list.sort((a, b) => a.d - b.d)
    return list
  }

  private centerOnIdleWorker(kind: 'harvester' | 'bulldozer'): void {
    const renderer = this.renderer
    const world = this.world
    if (!renderer || !world) return
    const list = this.idleWorkers(kind)
    if (list.length === 0) {
      this.hud.toast(kind === 'harvester' ? t('game.noIdleHarvesters') : t('game.noIdleDozers'))
      return
    }
    const idx = this.idleCycleIndex[kind] % list.length
    this.idleCycleIndex[kind] = idx + 1
    const entry = list[idx]
    renderer.camera.centerOn(entry.x, entry.y)
    this.selection = new Set([entry.id])
    this.hud.toast(kind === 'harvester' ? t('game.idleHarvester', { i: idx + 1, n: list.length }) : t('game.idleDozer', { i: idx + 1, n: list.length }))
    this.audio.uiClick()
  }

  private selectAllCombat(): void {
    const world = this.world
    if (!world) return
    const ids: number[] = []
    world.units.forEach((id, u) => {
      if (u.team !== this.localTeam) return
      if (getUnit(u.unitType, world.settings).weapon) ids.push(id)
    })
    if (ids.length === 0) {
      this.hud.toast(t('game.noCombatUnits'))
      return
    }
    this.selection = new Set(ids)
    this.hud.toast(t('game.selectedCombat', { n: ids.length }))
    this.audio.uiClick()
  }

  private selectAllHarvesters(): void {
    const world = this.world
    if (!world) return
    const ids: number[] = []
    world.units.forEach((id, u) => {
      if (u.team !== this.localTeam) return
      if (getUnit(u.unitType, world.settings).isHarvester) ids.push(id)
    })
    if (ids.length === 0) {
      this.hud.toast(t('game.noHarvesters'))
      return
    }
    this.selection = new Set(ids)
    this.hud.toast(t('game.selectedHarvesters', { n: ids.length }))
    this.audio.uiClick()
  }

  private onCommand(kind: CommandKind, worldPt: { x: number; y: number }): void {
    if (kind !== 'move') this.multiRoute = null
    if (this.pendingLaser || this.pendingAirstrike || this.pendingEmp) {
      this.cancelStrikeTargeting(false)
      return
    }
    if (this.pendingPlace) {
      this.pendingPlace = null
      this.hud.toast(t('game.placementCancelled'))
      return
    }
    if (this.placePendingMarker(worldPt)) return
    if (this.pendingUnload) {
      this.pendingUnload = false
      this.hud.toast(t('game.unloadCancelled'))
    }
    const world = this.world
    if (!world || this.selection.size === 0) return
    hapticAction()
    const ids = [...this.selection]

    // Mine modes: selected units armed with place-mine plant a mine at the
    // point (engineers within range). Units armed with remove-mine sweep the
    // owned mine under the cursor (engineers + bulldozers). The per-unit modes
    // stay armed for repeat use until toggled off or cleared.
    const placers = ids.filter((id) => {
      const u = world.units.get(id)
      return !!u && u.unitType === 'engineer' && this.mineModes.get(id) === 'place'
    })
    if (placers.length > 0) {
      const range = tileToFx(world.settings.minePlaceRange)
      const placed = placers.filter((id) => {
        const t = world.transforms.get(id)
        return !!t && (t.x - worldPt.x) ** 2 + (t.y - worldPt.y) ** 2 <= range * range
      })
      if (placed.length > 0) {
        this.issue({ type: 'place-mine', entities: placed, x: Math.floor(worldPt.x), y: Math.floor(worldPt.y) })
        hapticAction()
      }
      return
    }
    const removers = ids.filter((id) => {
      const u = world.units.get(id)
      return !!u && (u.unitType === 'engineer' || u.unitType === 'bulldozer') && this.mineModes.get(id) === 'remove'
    })
    if (removers.length > 0) {
      const mineId = this.pickMine(worldPt.x, worldPt.y)
      if (mineId !== null) {
        this.issue({ type: 'remove-mine', entities: removers, x: 0, y: 0, target: mineId })
        hapticAction()
      }
      return
    }

    // Bandolier toggles: selected units armed with grenade/smoke throw their
    // own ability to the clicked point (in-range units only). The modes stay armed.
    const throwers = ids.filter((id) => {
      const u = world.units.get(id)
      return !!u && canThrowBandolier({ id: u.unitType, class: u.class }) && this.abilityModes.has(id)
    })
    if (throwers.length > 0) {
      if (!this.world?.teamState(this.localTeam).abilitiesUnlocked) return
      for (const ability of ['grenade', 'smoke'] as const) {
        const group = throwers.filter((id) => this.abilityModes.get(id) === ability)
        if (group.length === 0) continue
        const range = ability === 'grenade' ? tileToFx(world.settings.grenadeRange) : tileToFx(world.settings.smokeRange)
        const fired = group.filter((uid) => {
          const t = world.transforms.get(uid)
          return !!t && (t.x - worldPt.x) ** 2 + (t.y - worldPt.y) ** 2 <= range * range
        })
        if (fired.length > 0) {
          this.issue({ type: ability, entities: fired, x: Math.floor(worldPt.x), y: Math.floor(worldPt.y) })
          hapticAction()
        }
      }
      return
    }

    // Combat modes (attack / keep-attack / guard) only apply when the selection
    // contains shooting units. If none are selected (e.g. only buildings), fall
    // back to a plain move so building commands like set-spawn-point still work
    // without the player having to toggle the troop mode off first.
    const anyCombat = ids.some((id) => world.units.has(id) && world.attacks.has(id))
    if (!anyCombat && (kind === 'attack-move' || kind === 'keep-attack' || kind === 'guard')) {
      kind = 'move'
    }

    if (kind === 'stop') {
      this.issue({ type: 'stop', entities: ids, x: 0, y: 0 })
      return
    }
    if (kind === 'home') {
      this.centerHome()
      return
    }
    const target = this.pickEntity(worldPt.x, worldPt.y)
    let commandTarget: number | null = target
    const oilTarget = this.pickOilField(worldPt.x, worldPt.y)
    if (oilTarget !== null) commandTarget = oilTarget
    if (kind === 'attack-move') {
      const combatIds = ids.filter((id) => world.units.has(id) && world.attacks.has(id))
      const moverIds = ids.filter((id) => world.units.has(id) && !world.attacks.has(id))
      if (combatIds.length > 0) {
        const t = commandTarget !== null && this.isEnemy(commandTarget) ? commandTarget : undefined
        this.setMoveMarker(worldPt.x, worldPt.y, 0xff4a5a)
        this.issue({ type: 'attack-move', entities: combatIds, x: Math.floor(worldPt.x), y: Math.floor(worldPt.y), target: t })
      }
      if (moverIds.length > 0) this.issueMoveCommand('move', moverIds, worldPt)
      return
    }
    if (kind === 'keep-attack') {
      const combatIds = ids.filter((id) => world.units.has(id) && world.attacks.has(id))
      if (combatIds.length > 0) {
        const t = commandTarget !== null && this.isEnemy(commandTarget) ? commandTarget : undefined
        this.setMoveMarker(worldPt.x, worldPt.y, 0xff8a3a)
        this.issue({ type: 'keep-attack', entities: combatIds, x: Math.floor(worldPt.x), y: Math.floor(worldPt.y), target: t })
      }
      return
    }
    if (kind === 'guard') {
      const combatIds = ids.filter((id) => world.units.has(id) && world.attacks.has(id))
      if (combatIds.length > 0) {
        const t = commandTarget !== null && this.isEnemy(commandTarget) ? commandTarget : undefined
        this.setMoveMarker(worldPt.x, worldPt.y, 0x4ad8ff)
        this.issue({ type: 'guard', entities: combatIds, x: Math.floor(worldPt.x), y: Math.floor(worldPt.y), target: t })
      }
      return
    }
    const dozerIds = ids.filter((id) => world.units.get(id)?.unitType === 'bulldozer')
    const apcTarget = target !== null ? world.transportCapacityOf(target) : 0
    if (apcTarget > 0) {
      const tu = world.units.get(target!)
      const tb = tu ? null : world.buildings.get(target!)
      const targetTeam = tu ? tu.team : tb ? tb.team : -1
      if (targetTeam === this.localTeam) {
        const loaders = ids.filter((id) => {
          const u = world.units.get(id)
          return !!u && u.team === this.localTeam && u.class !== 'air' && id !== target
        })
        if (loaders.length > 0) {
          this.issue({ type: 'transport-load', entities: loaders, x: 0, y: 0, transportId: target! })
          this.audio.uiClick()
          return
        }
      }
    }
    if (target !== null && dozerIds.length > 0) {
      const w = this.world?.wrecks.get(target)
      if (w) {
        this.issue({ type: 'collect', entities: [dozerIds[0]], x: 0, y: 0, target })
        return
      }
      const b = world.buildings.get(target)
      const h = world.healths.get(target)
      if (b && b.team === this.localTeam && (!b.done || (h && h.hp < h.maxHp))) {
        this.issue({ type: 'build', entities: [dozerIds[0]], x: 0, y: 0, target })
        return
      }
    }
    const engineerIds = ids.filter((id) => world.units.get(id)?.unitType === 'engineer')
    if (target !== null && engineerIds.length > 0) {
      const tu = world.units.get(target)
      const th = world.healths.get(target)
      if (tu && tu.team === this.localTeam && tu.class !== 'air' && th && th.hp < th.maxHp) {
        this.issue({ type: 'repair-unit', entities: engineerIds, x: 0, y: 0, target })
        return
      }
    }
    const harvesters = ids.filter((id) => world.harvesters.has(id))
    if (target !== null && harvesters.length > 0) {
      const b = world.buildings.get(target)
      if (b && b.team === this.localTeam && b.buildingType === 'supply-dock') {
        this.issue({ type: 'assign-dock', entities: harvesters, x: 0, y: 0, target })
        const nonHarvesters = ids.filter((id) => !world.harvesters.has(id) && world.units.has(id))
        if (nonHarvesters.length > 0) this.issueMoveCommand('move', nonHarvesters, worldPt)
        return
      }
    }
    const movableUnits = ids.filter((id) => world.units.has(id))
    const producers = ids.filter((id) => {
      const b = world.buildings.get(id)
      return !!b && b.done && b.team === this.localTeam && PRODUCERS.has(b.buildingType)
    })
    if (kind === 'move' && movableUnits.length === 0 && producers.length > 0) {
      this.issue({
        type: 'set-spawn-point',
        entities: [producers[0]],
        x: Math.floor(worldPt.x / 1000),
        y: Math.floor(worldPt.y / 1000),
      })
      return
    }
    const targets = ids
    if (kind === 'attack' || (commandTarget !== null && this.isEnemy(commandTarget))) {
      const t = commandTarget !== null ? commandTarget : undefined
      if (t !== undefined) {
        const tt = world.transforms.get(t)
        if (tt) this.setMoveMarker(tt.x, tt.y, 0xff4a5a)
      } else {
        this.setMoveMarker(worldPt.x, worldPt.y, 0xff4a5a)
      }
      this.issue({ type: 'attack', entities: targets, x: worldPt.x, y: worldPt.y, target: t })
    } else if (targets.length > 0) {
      if (this.multiPosMode && movableUnits.length > 0 && commandTarget === null) {
        // multi-position mode: append the clicked point to the route
        const sig = movableUnits.join(',')
        if (!this.multiRoute || this.multiRoute.ids.join(',') !== sig) {
          this.multiRoute = { ids: movableUnits, pts: [], idx: 0 }
        }
        this.multiRoute.pts.push({ x: Math.floor(worldPt.x), y: Math.floor(worldPt.y) })
        if (this.multiRoute.pts.length === 1) this.issueMoveCommand('move', movableUnits, worldPt)
      } else {
        this.issueMoveCommand('move', targets, worldPt)
      }
    }
  }

  private issueMoveCommand(kind: 'move', ids: number[], worldPt: { x: number; y: number }): void {
    const world = this.world
    if (!world) return
    const units = ids.filter((id) => world.units.has(id))
    if (units.length === 0) return
    this.setMoveMarker(worldPt.x, worldPt.y)
    if (units.length === 1) {
      this.issue({ type: kind, entities: units, x: Math.floor(worldPt.x), y: Math.floor(worldPt.y) })
      return
    }
    const hasVehicle = units.some((id) => {
      const c = world.units.require(id).class
      return c === 'vehicle' || c === 'naval'
    })
    const cell = hasVehicle ? 2400 : 1400
    const cols = Math.ceil(Math.sqrt(units.length))
    const rows = Math.ceil(units.length / cols)
    // Day 21: units with "hold current position" keep their offset from the group
    // centroid at the new spot; the rest take a grid slot scaled by their own
    // formation density (loose/tight).
    const relUnits = units.filter((id) => world.units.require(id).relativeFormation)
    let cx = 0
    let cy = 0
    let centroidN = 0
    if (relUnits.length > 0) {
      let sx = 0
      let sy = 0
      for (const id of units) {
        const t = world.transforms.get(id)
        if (t) {
          sx += t.x
          sy += t.y
          centroidN++
        }
      }
      if (centroidN > 0) {
        cx = sx / centroidN
        cy = sy / centroidN
      }
    }
    const cmds = units.map((id, i) => {
      const u = world.units.require(id)
      if (u.relativeFormation && centroidN > 0) {
        const t = world.transforms.get(id)
        if (t) {
          return { type: kind, entities: [id], x: Math.floor(worldPt.x + (t.x - cx)), y: Math.floor(worldPt.y + (t.y - cy)) }
        }
      }
      const spread = u.formationSpread ?? 1
      const col = i % cols
      const row = Math.floor(i / cols)
      const dx = Math.floor((col - (cols - 1) / 2) * cell * spread)
      const dy = Math.floor((row - (rows - 1) / 2) * cell * spread)
      return { type: kind, entities: [id], x: worldPt.x + dx, y: worldPt.y + dy }
    })
    this.issueBatch(cmds)
  }

  private setMoveMarker(x: number, y: number, color = 0x52e06a): void {
    if (!this.world) return
    this.moveMarker = { x, y, until: this.world.tick + 60, color }
  }

  private pickOilField(worldX: number, worldY: number): number | null {
    const world = this.world
    if (!world) return null
    const revealAll = this.renderer?.showAll ?? false
    const tileX = worldX / 1000
    const tileY = worldY / 1000
    let best: number | null = null
    let bestArea = Infinity
    world.oilFields.forEach((id, f) => {
      if (f.owner < 0) return
      if (!world.isVisibleTo(this.localTeam, id, revealAll)) return
      if (!this.isEnemy(id)) return
      const t = world.transforms.require(id)
      const r = f.radius + 0.4
      const dx = tileX - t.x / 1000
      const dy = tileY - t.y / 1000
      if (dx * dx + dy * dy <= r * r) {
        const area = r * r
        if (area < bestArea) {
          bestArea = area
          best = id
        }
      }
    })
    return best
  }

  private isEnemy(id: number): boolean {
    const world = this.world
    if (!world) return false
    const team = world.teamOf(id)
    if (team >= 0) return !world.sameTeam(this.localTeam, team)
    const s = world.scenery.get(id)
    return s !== undefined && s.type === 'rock'
  }

  private issue(cmd: SimCommand): void {
    this.issueBatch([cmd])
  }

  private issueBatch(cmds: SimCommand[]): void {
    if (this.spectator) return
    const world = this.world
    if (!world || cmds.length === 0) return
    const envs: EnvelopeCommand[] = cmds.map((cmd) => {
      this.seq++
      return { player: this.localTeam, seq: this.seq, tick: world.tick, cmd }
    })
    if (this.mode === 'offline' && this.sim) {
      this.pendingCmds.push(...envs)
    } else if (this.net) {
      for (const env of envs) this.net.sendCommand(env)
    }
  }

  private keyMatch(e: KeyboardEvent, id: string): boolean {
    const k = getControls()[id]
    return !!k && e.key.toLowerCase() === k.toLowerCase()
  }

  /** The key's identity (letter/digit) independent of modifier state, so Shift+1 resolves to '1', not '!'. */
  private eventKeyChar(e: KeyboardEvent): string {
    const c = e.code
    if (c.startsWith('Digit')) return c.slice('Digit'.length)
    if (c.startsWith('Numpad')) return c.slice('Numpad'.length)
    if (c.startsWith('Key')) return c.slice('Key'.length).toLowerCase()
    return e.key.toLowerCase()
  }

  private saveControlGroup(n: number): void {
    const world = this.world
    if (!world) return
    const ids = [...this.selection].filter((id) => world.canControl(this.localTeam, id))
    this.controlGroups.set(n, ids)
    this.hud.toast(t('game.groupSaved', { n, count: ids.length }))
  }

  private recallControlGroup(n: number): void {
    const world = this.world
    if (!world) return
    const ids = this.controlGroups.get(n)
    if (!ids) return
    const kept: number[] = []
    for (const id of ids) {
      if (world.canControl(this.localTeam, id)) kept.push(id)
    }
    this.selection = new Set(kept)
  }

  private onKeysToggleClick = (): void => {
    this.toggleControlGroupsPanel()
  }

  private onGroupsDoneClick = (): void => {
    this.closeControlGroupsPanel()
  }

  private toggleControlGroupsPanel(): void {
    const el = this.groupsOverlay
    const open = !el.classList.contains('visible')
    el.classList.toggle('visible', open)
    this.keysToggle?.classList.toggle('active', open)
    if (open) {
      this.groupsSig = ''
      this.renderControlGroups()
    }
  }

  private closeControlGroupsPanel(): void {
    this.groupsOverlay.classList.remove('visible')
    this.keysToggle?.classList.remove('active')
  }

  private groupKeyLabel(n: number): string {
    const c = getControls()
    const slot = c[`slot:${n}`] ?? String(n)
    return `${modifierLabel()}+${slot.toUpperCase()}`
  }

  private isOwnedAlive(id: number): boolean {
    const world = this.world
    if (!world) return false
    const b = world.buildings.get(id)
    if (b) return b.team === this.localTeam
    const u = world.units.get(id)
    return !!u && u.team === this.localTeam
  }

  private summarizeGroup(ids: number[]): string {
    const world = this.world
    if (!world) return ''
    const counts = new Map<string, number>()
    for (const id of ids) {
      const u = world.units.get(id)
      let name = ''
      if (u && u.team === this.localTeam) {
        name = tn(u.unitType, getUnit(u.unitType, world.settings).name)
      } else {
        const b = world.buildings.get(id)
        if (b && b.team === this.localTeam) name = tn(b.buildingType, getBuilding(b.buildingType).name)
      }
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1)
    }
    return [...counts.entries()].map(([name, count]) => `${count} ${name}`).join(', ')
  }

  private renderControlGroups(): void {
    const listEl = document.getElementById('groups-list')
    if (!listEl) return
    listEl.innerHTML = ''
    let shown = false
    for (const [n, ids] of [...this.controlGroups.entries()].sort((a, b) => a[0] - b[0])) {
      const alive = ids.filter((id) => this.isOwnedAlive(id))
      if (alive.length === 0) {
        this.controlGroups.delete(n)
        continue
      }
      if (alive.length !== ids.length) this.controlGroups.set(n, alive)
      shown = true
      const row = document.createElement('div')
      row.className = 'group-row'
      const key = document.createElement('span')
      key.className = 'group-key'
      key.textContent = this.groupKeyLabel(n)
      const desc = document.createElement('span')
      desc.className = 'group-desc'
      desc.textContent = this.summarizeGroup(alive)
      const rm = document.createElement('button')
      rm.type = 'button'
      rm.className = 'ghost danger'
      rm.textContent = t('groups.remove')
      rm.title = t('groups.removeTitle', { key: this.groupKeyLabel(n) })
      rm.addEventListener('click', () => this.clearControlGroup(n))
      row.appendChild(key)
      row.appendChild(desc)
      row.appendChild(rm)
      listEl.appendChild(row)
    }
    if (!shown) {
      const empty = document.createElement('div')
      empty.className = 'group-empty'
      empty.textContent = t('groups.empty')
      listEl.appendChild(empty)
    }
  }

  private clearControlGroup(n: number): void {
    this.controlGroups.delete(n)
    this.groupsSig = ''
    this.renderControlGroups()
    this.hud.toast(t('game.groupCleared', { n: this.groupKeyLabel(n) }))
    this.audio.uiClick()
  }

  private refreshGroupsPanel(): void {
    if (!this.groupsOverlay.classList.contains('visible')) return
    const sig = [...this.controlGroups.entries()].map(([n, ids]) => `${n}:${ids.join(',')}`).join('|')
    if (sig === this.groupsSig) return
    this.groupsSig = sig
    this.renderControlGroups()
  }

  private onWindowBlur = (): void => {
    this.groupModDown = false
  }

  private modifierHeld(e: KeyboardEvent): boolean {
    const gm = (getControls().groupMod ?? 'Control').toLowerCase()
    if (gm === 'control') return e.ctrlKey && !e.altKey && !e.metaKey
    if (gm === 'shift') return e.shiftKey
    if (gm === 'alt') return e.altKey
    if (gm === 'meta') return e.metaKey
    return this.groupModDown
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.keyMatch(e, 'groupMod')) this.groupModDown = true
    if (e.key === 'Escape' || this.keyMatch(e, 'esc')) {
      if (this.chat?.isVisible()) {
        this.chat.hide()
        return
      }
      if (this.menuOverlay.classList.contains('visible')) {
        this.onMenuResumeClick()
        return
      }
      if (this.devOverlayVisible) {
        this.closeDevOverlay()
        return
      }
      this.pendingPlace = null
      this.cancelStrikeTargeting(true)
      this.pendingSpawnPoint = false
      this.pendingFlag = false
      this.pendingUnload = false
      this.pingMode = null
      this.syncPingButtons()
      this.holdPlaced = false
      if (this.input) {
        this.input.keepAttackKey = false
        this.input.guardKey = false
      }
      this.selection.clear()
      return
    }
    if (!isTypingTarget(e.target) && this.modifierHeld(e)) {
      e.preventDefault()
      const key = this.eventKeyChar(e)
      if (key.length === 1 && /[a-z]/.test(key) && this.hud.isBuildMenuVisible()) {
        this.hud.hudShortcutByLetter(key)
        return
      }
      const ctrl = getControls()
      for (let i = 1; i <= 9; i++) {
        const k = ctrl[`slot:${i}`]
        if (k && key === k.toLowerCase()) {
          this.saveControlGroup(i)
          return
        }
      }
      return
    }
    if (this.keyMatch(e, 'borders')) {
      this.toggleDevOption('borders')
      return
    }
    if (this.keyMatch(e, 'paths')) {
      this.toggleDevOption('paths')
      return
    }
    if (this.keyMatch(e, 'reveal')) {
      this.toggleDevOption('reveal')
      return
    }
    if (this.keyMatch(e, 'bases')) {
      this.toggleDevOption('bases')
      return
    }
    if (this.keyMatch(e, 'spawnPoint')) {
      if (!e.repeat && !isTypingTarget(e.target)) this.beginPendingMarker('spawn')
      return
    }
    if (this.keyMatch(e, 'flag')) {
      if (!e.repeat && !isTypingTarget(e.target)) this.beginPendingMarker('flag')
      return
    }
    if (this.keyMatch(e, 'minimap')) {
      this.toggleMinimapScale()
      return
    }
    if (this.keyMatch(e, 'boxSelect')) {
      if (this.input) {
        this.input.boxSelect = !this.input.boxSelect
        this.hud.toast(this.input.boxSelect ? t('game.boxSelectOn') : t('game.boxSelectOff'))
      }
      this.syncMobileToolButtons()
      return
    }
    if (this.keyMatch(e, 'stop')) {
      this.onCommand('stop', { x: 0, y: 0 })
      return
    }
    if (this.keyMatch(e, 'home')) {
      this.centerHome()
      return
    }
    if (this.keyMatch(e, 'idleWorker')) {
      this.centerOnIdleWorker('harvester')
      return
    }
    if (this.keyMatch(e, 'idleDozer')) {
      this.centerOnIdleWorker('bulldozer')
      return
    }
    if (this.keyMatch(e, 'selectCombat')) {
      if (!isTypingTarget(e.target)) this.selectAllCombat()
      return
    }
    if (this.keyMatch(e, 'selectHarvesters')) {
      if (!isTypingTarget(e.target)) this.selectAllHarvesters()
      return
    }
    if (this.keyMatch(e, 'log')) {
      this.toggleGameLog()
      return
    }
    if (this.keyMatch(e, 'keepAttack')) {
      if (!isTypingTarget(e.target)) this.toggleKeepAttack()
      return
    }
    if (this.keyMatch(e, 'guard')) {
      if (!isTypingTarget(e.target)) this.toggleGuard()
      return
    }
    if (this.keyMatch(e, 'multiPos')) {
      if (!isTypingTarget(e.target)) this.toggleMoveMode()
      return
    }
    if (this.keyMatch(e, 'zoomIn') || this.keyMatch(e, 'zoomOut')) {
      if (this.renderer && !isTypingTarget(e.target)) {
        const r = this.renderer.app.canvas.getBoundingClientRect()
        const factor = this.keyMatch(e, 'zoomIn') ? 1.15 : 1 / 1.15
        this.renderer.camera.zoomAt(r.width / 2, r.height / 2, factor)
      }
      return
    }
    let panPx = 0
    let panPy = 0
    if (this.keyMatch(e, 'panUp')) panPy = 20
    else if (this.keyMatch(e, 'panDown')) panPy = -20
    if (this.keyMatch(e, 'panLeft')) panPx = 20
    else if (this.keyMatch(e, 'panRight')) panPx = -20
    if ((panPx !== 0 || panPy !== 0) && this.renderer && !isTypingTarget(e.target)) {
      this.renderer.camera.panBy(panPx, panPy)
      return
    }
    if (e.key === 'Delete' || e.key === 'Backspace' || this.keyMatch(e, 'sell')) {
      const world = this.world
      if (!world) return
      const owned = [...this.selection].some((id) => world.canControl(this.localTeam, id))
      if (owned) this.destroySelection()
    }
    if (isTypingTarget(e.target)) return
    const key = e.key.toLowerCase()
    const ctrl = getControls()
    for (let i = 1; i <= 9; i++) {
      const k = ctrl[`slot:${i}`]
      if (!k) continue
      if (key === k.toLowerCase()) {
        this.recallControlGroup(i)
        return
      }
    }
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.target instanceof HTMLCanvasElement) this.audio.unlock()
  }

  applyFrame(tick: number, commands: EnvelopeCommand[]): void {
    const world = this.world
    if (!world || this.finished) return
    if (tick === world.tick) {
      stepWorld(world, commands.filter((c) => c.tick === tick))
      return
    }
    if (this.spectator && tick > world.tick) {
      while (world.tick < tick) stepWorld(world, [])
      stepWorld(world, commands.filter((c) => c.tick === tick))
    }
  }

  onNetChat(msg: ChatRelayMessage): void {
    if (this.mode !== 'net') return
    this.chat?.append(msg)
  }

  setPingMs(ms: number | null): void {
    this.hud.setPingMs(ms)
  }

  applySpectateSync(msg: SpectateSyncMessage): void {
    if (this.mode !== 'net' || !this.spectator) return
    if (!this.world) {
      this.pendingSpectate = msg
      return
    }
    this.stepToTickSync(msg)
    this.hud.toast(t('game.spectatingTick', { t: Math.max(0, msg.currentTick) }))
  }

  /** Fast-forwards the local world to the host's current tick after reconnecting,
   *  for both re-claimed player slots and the spectator fallback. */
  catchUpSync(msg: SpectateSyncMessage): void {
    if (this.mode !== 'net') return
    if (!this.world) {
      this.pendingSpectate = msg
      return
    }
    this.stepToTickSync(msg)
    const target = Math.max(0, msg.currentTick)
    this.hud.toast(t('game.reconnected', { t: target }))
  }

  /** Re-points the running game at a fresh connection (used after a reconnect). */
  attachNet(net: NetClient): void {
    this.net = net
  }

  /** Deterministically replays the relay's command log from the world's current
   *  tick up to `msg.currentTick`. */
  private stepToTickSync(msg: SpectateSyncMessage): void {
    const world = this.world
    if (!world) return
    const target = Math.max(0, msg.currentTick)
    while (world.tick < target) {
      const cmds = msg.log.filter((c) => c.tick === world.tick)
      stepWorld(world, cmds)
    }
  }

  onNetChecksum(player: number, tick: number, crc: number): void {
    if (player !== this.localTeam) return
    const mine = this.pendingChecks.get(tick)
    if (mine === undefined) return
    this.syncOk = mine === crc
  }

  destroy(): void {
    this.loop?.stop()
    this.loop = null
    this.audio.stopAmbient()
    this.input?.detach()
    this.input = null
    this.mmResizeObserver?.disconnect()
    this.mmResizeObserver = null
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onWindowBlur)
    window.removeEventListener('pointerdown', this.onPointerDown, true)
    this.net?.close()
    this.net = null
    if (this.mmWrap?.parentNode) this.mmWrap.parentNode.removeChild(this.mmWrap)
    this.mmWrap = null
    this.mm = null
    this.pingBtns = []
    this.pingMode = null
    this.closeDevOverlay()
    this.satelliteBtn?.removeEventListener('click', this.onSatelliteClick)
    this.satelliteBtn = null
    this.laserBtn?.removeEventListener('click', this.onLaserClick)
    this.laserBtn = null
    this.strikeBtn?.removeEventListener('click', this.onStrikeClick)
    this.strikeBtn = null
    this.cancelStrikeTargeting(true)
    this.idleWorkerBtn?.removeEventListener('click', this.onIdleWorkerClick)
    this.idleWorkerBtn = null
    this.idleDozerBtn?.removeEventListener('click', this.onIdleDozerClick)
    this.idleDozerBtn = null
    this.logToggle?.removeEventListener('click', this.onLogToggleClick)
    this.logToggle = null
    this.keysToggle?.removeEventListener('click', this.onKeysToggleClick)
    this.keysToggle = null
    this.groupsDoneBtn?.removeEventListener('click', this.onGroupsDoneClick)
    this.groupsDoneBtn = null
    this.groupsOverlay.classList.remove('visible')
    this.mobileControls?.removeEventListener('click', this.onMobileControlsClick)
    this.mobileControls = null
    this.renderer?.destroy()
    this.renderer = null
    this.weather?.dispose()
    this.weather = null
    const hudEl = document.getElementById('hud')
    if (hudEl) {
      const log = document.getElementById('game-log')
      if (log) log.textContent = ''
      const build = document.getElementById('build-menu')
      if (build) build.innerHTML = ''
      hudEl.style.display = 'none'
    }
    this.resultsOverlay.classList.remove('visible')
    this.resultsBoard.hide()
    this.cinematicOverlay.classList.remove('visible')
    this.cinematicActive = false
    this.menuOverlay.classList.remove('visible')
    this.menuStatsBoard.hide()
    this.confirmOverlay.classList.remove('visible')
    this.confirmYesBtn.removeEventListener('click', this.onConfirmYesClick)
    this.confirmNoBtn.removeEventListener('click', this.onConfirmNoClick)
    this.menuBtn.removeEventListener('click', this.onMenuBtnClick)
    this.menuSaveReplayBtn.removeEventListener('click', this.onMenuSaveReplayClick)
    this.menuResumeBtn.removeEventListener('click', this.onMenuResumeClick)
    this.menuQuitBtn.removeEventListener('click', this.onMenuQuitClick)
    this.resultsSaveReplayBtn.removeEventListener('click', this.onResultsSaveReplayClick)
    this.resultsQuitBtn.removeEventListener('click', this.onResultsQuitClick)
    this.replayPlayBtn.removeEventListener('click', this.onReplayPlayClick)
    this.replayRestartBtn.removeEventListener('click', this.onReplayRestartClick)
    this.replayBackBtn.removeEventListener('click', this.onReplayBackClick)
    this.replayFwdBtn.removeEventListener('click', this.onReplayFwdClick)
    this.replaySpeedBtn.removeEventListener('click', this.onReplaySpeedClick)
    this.replayHudToggle.removeEventListener('click', this.onReplayHudToggleClick)
    this.world = null
    this.sim = null
    this.pendingSpectate = null
    this.chat?.destroy()
    this.chat = null
    this.replayHistory = []
    this.replayIndex = 0
    this.replayTicks = 0
    this.replayWinner = null
    this.replayBar.hidden = true
    document.getElementById('hud')?.classList.remove('replay-hud', 'sel-hidden')
    this.hud.setReplayEco(null)
    this.currentStartMsg = null
    this.replayPlaying = false
    this.replaySpeed = 1
    this.pendingSeek = null
    this.seekActive = false
    this.seekTarget = 0
    this.sliderDragging = false
  }
}
