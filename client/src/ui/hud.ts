import { BUILDINGS, UNITS, UPGRADES, SIM_TICK_HZ, SHIELD_MAX_HP, SW_CHOICES, PLAYER_COLORS, canThrowBandolier, getBuilding, getUnit, getUpgrade, type UpgradeDef, type SwChoice, RANK_FLOORS } from '@space-arenas/shared'
import type { ProductionOrder, World } from '../core/world.ts'
import { t, tn } from '../i18n/index.ts'
import { getGraphics } from './graphics.ts'
import { modifierLabel } from './controls.ts'

export interface HudActions {
  onBuildClick: (type: string) => void
  onQueueClick: (type: string) => void
  onDequeueClick: (buildingId: number, index: number) => void
  onReorderClick: (buildingId: number, from: number, to: number) => void
  onResearchClick: (upgrade: string) => void
  onDequeueResearch: (buildingId: number, index: number) => void
  onStopClick: () => void
  onDestroyClick: () => void
  onAttackToggle: () => void
  isAttackActive: () => boolean
  onKeepAttackToggle: () => void
  isKeepAttackActive: () => boolean
  onGuardToggle: () => void
  isGuardActive: () => boolean
  /** Day 21: idle auto-fire toggle (OFF makes units ignore in-range enemies until ordered). */
  onAutoFireToggle: () => void
  isAutoFireActive: () => boolean
  /** Day 21: formation density / hold-current-position for a multi-unit selection. */
  onFormationClick: (mode: 'tight' | 'loose' | 'hold') => void
  isFormationActive: (mode: 'tight' | 'loose' | 'hold') => boolean
  onSpawnToggle: () => void
  isSpawnActive: () => boolean
  onFlagToggle: () => void
  isFlagActive: () => boolean
  onMoveModeToggle: () => void
  isMoveModeActive: () => boolean
  onMaxPowerClick: (buildingIds: number[]) => void
  onDeselectClick: () => void
  onGrenadeToggle: () => void
  isGrenadeActive: () => boolean
  onSmokeToggle: () => void
  isSmokeActive: () => boolean
  onPlaceMineToggle: () => void
  isPlaceMineActive: () => boolean
  onRemoveMineToggle: () => void
  isRemoveMineActive: () => boolean
  onDetectorClick: (buildingIds: number[]) => void
  onStealthClick: (unitIds: number[]) => void
  onUnloadToggle: () => void
  isUnloadActive: () => boolean
  /** Eject a single loaded rider next to its transport (from the garrison list). */
  onUnloadOne: (transportId: number, index: number) => void
  /** One-time Super Weapon strike choice (Laser / Airstrike / EMP). */
  onSwChoose: (choice: SwChoice) => void
  /** Daily mode: refresh the mission list before the popup is shown. */
  onMissionOpen?: () => void
  /** Display name for a slot, when the caller has it (e.g. net lobby). */
  slotName?: (slot: number) => string | null
}

const BUILDER_BUILDABLES = ['command-center', 'power-plant', 'supply-dock', 'barracks', 'war-factory', 'turret', 'bunker', 'tech-center', 'air-force', 'super-weapon', 'dock'] as const

const UPGRADES_BY_BUILDING: Record<string, UpgradeDef[]> = {}
for (const u of Object.values(UPGRADES)) {
  ;(UPGRADES_BY_BUILDING[u.availableAt] ??= []).push(u)
}

/** Resolve an asset URL for a selection-bar icon, or '' when no image asset exists.
 * A dedicated `hud:<type>` icon (plain image, e.g. hud/hud_cc.png) wins over the
 * sprite-frame template; empty/absent falls back to the classic sprite frame. */
function assetIconUrl(kind: 'unit' | 'building', type: string): string {
  const hud = getGraphics().assetPaths[`hud:${type}`]
  if (hud) {
    const raw = hud.replaceAll('{color}', '1').replaceAll('{frame}', '0001')
    if (raw.includes('{')) return ''
    if (/^https?:\/\//i.test(raw) || raw.startsWith('/')) return raw
    return `${import.meta.env.BASE_URL}${raw}`
  }
  const tpl = getGraphics().assetPaths[`${kind}:${type}`]
  if (!tpl) return ''
  const raw =
    kind === 'building'
      ? tpl.replaceAll('{color}', '1').replaceAll('{frame}', '0005')
      : tpl.replaceAll('{color}', '1').replaceAll('{frame}', '0002')
  if (raw.includes('{')) return ''
  if (/^https?:\/\//i.test(raw) || raw.startsWith('/')) return raw
  return `${import.meta.env.BASE_URL}${raw}`
}

/** Class badge for an icon, by entity type for coloring and fallback letter. */
function iconBadgeClass(kind: 'unit' | 'building', type: string): string {
  if (kind === 'building') return 'building'
  return UNITS[type]?.class ?? 'vehicle'
}

/** Small icon markup (image sprite with a colored letter-badge fallback). */
function hudIconHtml(kind: 'unit' | 'building', type: string, label: string): string {
  const url = assetIconUrl(kind, type)
  const letter = (label.trim().charAt(0) || '?').toUpperCase()
  const badge = iconBadgeClass(kind, type)
  const size = getGraphics().hudIconSize
  const img = url ? `<img src="${url}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''
  return `<span class="hud-icon hud-icon-${badge}" style="width:${size}px;height:${size}px;font-size:${Math.max(8, Math.round(size * 0.55))}px"><span class="hud-icon-letter">${letter}</span>${img}</span>`
}

export class Hud {
  private creditsEl = document.getElementById('credits')!
  private powerTextEl = document.getElementById('power-text')!
  private powerFillEl = document.getElementById('power-fill')!
  private powerWrapEl = document.querySelector<HTMLElement>('.hud-power')!
  private replayEcoEl = document.getElementById('replay-eco') as HTMLDivElement
  private replayEcoCols: Array<{ team: number; credits: HTMLElement; fill: HTMLElement; power: HTMLElement }> | null = null
  private tickEl = document.getElementById('tick-info')!
  private syncEl = document.getElementById('sync-info')!
  private fpsEl = document.getElementById('fps-info')!
  private buildMenu = document.getElementById('build-menu')!
  private selectionInfo = document.getElementById('selection-info')!
  private selectionAchievement = document.getElementById('selection-achievement')!
  private gameLog = document.getElementById('game-log')!
  private objectiveEl = document.getElementById('hud-objective')!
  private missionBtn = document.getElementById('mission-btn') as HTMLButtonElement
  private missionPopup = document.getElementById('mission-popup') as HTMLDivElement
  private missionPopupList = document.getElementById('mission-popup-list') as HTMLDivElement
  private hudEl = document.getElementById('hud')!
  private rankBtn = document.getElementById('rank-btn')!
  private rankBtnStars = document.getElementById('rank-btn-stars')!
  private rankBtnScore = document.getElementById('rank-btn-score')!
  private rankMenu = document.getElementById('rank-menu')!
  private rankMenuBackdrop = document.getElementById('rank-menu-backdrop')!
  private rankPanelTitle = document.getElementById('rank-panel-title')!
  private rankPanelScore = document.getElementById('rank-panel-score')!
  private rankTierList = document.getElementById('rank-tier-list')!

  private lastSelSig: string | null = null
  private lastQueueSig: string | null = null
  private lastWorkSig: string | null = null
  private lastResearchSig: string | null = null
  private lastGarrisonSig: string | null = null
  private updaters: Array<() => void> = []
  private dragState: { btn: HTMLButtonElement; container: HTMLElement; wrap: HTMLElement; from: number; buildingId: number; moved: boolean; startX: number; startY: number } | null = null
  private hotkeySlots: Array<{ key: string; enabled: () => boolean; act: () => void }> = []
  private usedHotkeys = new Set<string>()

  private fpsFrames = 0
  private fpsTime = performance.now()
  private lastFps = 0
  private pingMs: number | null = null

  constructor(private actions: HudActions) {
    this.rankBtn.addEventListener('click', () => this.toggleRankMenu())
    const close = document.getElementById('rank-close')
    close?.addEventListener('click', () => this.closeRankMenu())
    this.rankMenuBackdrop.addEventListener('click', () => this.closeRankMenu())
    this.missionBtn.addEventListener('click', () => this.toggleMissionPopup())
    document.getElementById('mission-popup-close')?.addEventListener('click', () => this.closeMissionPopup())
    this.missionPopup.addEventListener('click', (e) => {
      if (e.target === this.missionPopup) this.closeMissionPopup()
    })
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return
      if (this.rankMenu.classList.contains('open')) this.closeRankMenu()
      else if (!this.missionPopup.hidden) this.closeMissionPopup()
    })
  }

  /** Show/hide the match-header Mission button (daily tasks, tracked in bots matches). */
  showMissionButton(show: boolean): void {
    this.missionBtn.hidden = !show
  }

  /** Populate the Mission popup with the daily challenge rows. */
  setMissions(rows: Array<{ text: string; xp: number; done: boolean }>): void {
    this.missionPopupList.innerHTML = ''
    for (const r of rows) {
      const row = document.createElement('div')
      row.className = 'mission-row' + (r.done ? ' done' : '')
      const desc = document.createElement('span')
      desc.textContent = r.done ? `✔ ${r.text}` : r.text
      const badge = document.createElement('span')
      badge.className = 'xp-badge'
      badge.textContent = `+${r.xp} XP`
      row.appendChild(desc)
      row.appendChild(badge)
      this.missionPopupList.appendChild(row)
    }
  }

  private toggleMissionPopup(): void {
    if (this.missionPopup.hidden) {
      this.actions.onMissionOpen?.()
      this.missionPopup.hidden = false
    } else {
      this.closeMissionPopup()
    }
  }

  private closeMissionPopup(): void {
    this.missionPopup.hidden = true
  }

  private lastWorld: World | null = null
  private lastTeam = -1
  private lastRankSig: string | null = null

  private toggleRankMenu(): void {
    if (!this.lastWorld || this.lastTeam < 0) return
    if (this.rankMenu.classList.contains('open')) {
      this.closeRankMenu()
    } else {
      this.renderRankOverlay(this.lastWorld, this.lastTeam)
      this.rankMenu.classList.add('open')
      this.rankMenuBackdrop.classList.add('open')
    }
  }

  private closeRankMenu(): void {
    this.rankMenu.classList.remove('open')
    this.rankMenuBackdrop.classList.remove('open')
  }

  /** Rebuild the rank side menu from live world state (score floors + star unlocks). */
  private renderRankOverlay(world: World, team: number): void {
    const rank = world.rankOf(team)
    const score = world.scoreOf(team)
    const starHtml = (n: number): string => '<span class="rank-star">★</span>'.repeat(Math.max(0, n))
    this.rankPanelTitle.innerHTML = `${starHtml(rank)}<span class="rank-current">${t('hud.rankStars', { n: rank })}</span>`
    this.rankPanelScore.textContent = score > 0 || rank > 0 ? t('hud.rankScore', { score, next: world.rankFloor(rank + 1) }) : t('hud.rankScoreEmpty')
    const floors = RANK_FLOORS
    this.rankTierList.innerHTML = ''
    for (let i = 1; i <= floors.length; i++) {
      const unlocked = rank >= i
      const row = document.createElement('div')
      row.className = 'rank-tier' + (unlocked ? ' unlocked' : '')
      const stars = document.createElement('span')
      stars.className = 'rank-tier-stars'
      stars.textContent = '★'.repeat(i)
      // Title + info sit in their own column so the info wraps under the title
      // instead of stretching across the row.
      const copy = document.createElement('span')
      copy.className = 'rank-tier-copy'
      const title = document.createElement('span')
      title.className = 'rank-tier-title'
      title.textContent = t('hud.rankFloor', { n: i, pts: floors[i - 1] })
      const info = document.createElement('span')
      info.className = 'rank-tier-info'
      info.textContent = t('hud.rankTier' + i)
      copy.append(title, info)
      const state = document.createElement('span')
      state.className = 'rank-tier-state'
      state.textContent = unlocked ? t('hud.rankUnlocked') : t('hud.rankLocked')
      row.append(stars, copy, state)
      this.rankTierList.appendChild(row)
    }
  }

  show(): void {
    this.hudEl.style.display = 'block'
  }

  /** The most recently measured frames-per-second (updated every ~500 ms). */
  get fps(): number {
    return this.lastFps
  }

  hide(): void {
    this.hudEl.style.display = 'none'
  }

  log(msg: string): void {
    const el = document.createElement('div')
    el.className = 'log-line'
    el.textContent = msg
    this.gameLog.appendChild(el)
    while (this.gameLog.children.length > 8) {
      this.gameLog.removeChild(this.gameLog.firstChild!)
    }
  }

  /** Persistent objective line (e.g. daily missions left). */
  setObjective(text: string | null): void {
    if (text) {
      this.objectiveEl.textContent = text
      this.objectiveEl.hidden = false
    } else {
      this.objectiveEl.hidden = true
    }
  }

  update(world: World, localTeam: number, tick: number | null, localHash: number | null, syncOk: boolean, totalTicks?: number): void {
    const ts = this.replayEcoCols ? null : world.teamState(localTeam)
    this.lastWorld = world
    this.lastTeam = localTeam
    if (this.replayEcoCols) {
      for (const col of this.replayEcoCols) {
        const credits = world.creditsOf(col.team)
        const pw = world.alliancePowerOf(col.team)
        col.credits.textContent = `$${credits}`
        const frac = pw.use > 0 ? Math.min(1, pw.use / Math.max(1, pw.gen)) : 0
        col.fill.style.width = `${(frac * 100).toFixed(1)}%`
        col.fill.style.background = pw.net < 0 ? '#e84a4a' : '#4ad8ff'
        col.power.textContent = pw.net < 0 ? t('hud.powerDown') : t('hud.power', { use: pw.use, gen: pw.gen })
      }
    } else {
      this.creditsEl.textContent = `$${world.creditsOf(localTeam)}`
      const frac = ts!.powerUse > 0 ? Math.min(1, ts!.powerUse / Math.max(1, ts!.powerGen)) : 0
      this.powerFillEl.style.width = `${(frac * 100).toFixed(1)}%`
      this.powerFillEl.style.background = ts!.powerDown ? '#e84a4a' : '#4ad8ff'
      this.powerTextEl.textContent = ts!.powerDown ? t('hud.powerDown') : t('hud.power', { use: ts!.powerUse, gen: ts!.powerGen })
      this.updateRankBtn(world, localTeam)
    }
    this.tickEl.textContent =
      tick !== null
        ? totalTicks !== undefined
          ? t('hud.tickTotal', { t: tick, total: totalTicks })
          : t('hud.tick', { t: tick })
        : ''
    this.syncEl.textContent = localHash !== null ? (syncOk ? t('hud.inSync') : t('hud.desync')) : ''
    this.syncEl.style.color = syncOk ? '#7cf27c' : '#ff7a7a'
    this.updateFps()
  }

  /** Show one economy column per alliance (replay spectator header), hiding the
   *  player's own credits/power/rank until a normal game is started again. */
  setReplayEco(entries: Array<{ team: number; color: number; name: string }> | null): void {
    this.replayEcoEl.innerHTML = ''
    this.replayEcoCols = null
    const active = !!entries && entries.length > 0
    this.rankBtn.style.display = active ? 'none' : ''
    this.creditsEl.style.display = active ? 'none' : ''
    this.powerWrapEl.style.display = active ? 'none' : ''
    this.replayEcoEl.style.display = active ? 'flex' : 'none'
    if (!active) {
      this.lastRankSig = null
      return
    }
    this.replayEcoCols = []
    for (const e of entries!) {
      const col = document.createElement('div')
      col.className = 'replay-eco-col'
      const hex = `#${PLAYER_COLORS[Math.min(PLAYER_COLORS.length - 1, Math.max(0, e.color))].toString(16).padStart(6, '0')}`
      col.style.borderLeftColor = hex
      const name = document.createElement('span')
      name.className = 'replay-eco-name'
      name.textContent = e.name
      const credits = document.createElement('span')
      credits.className = 'replay-eco-credits'
      const barWrap = document.createElement('span')
      barWrap.className = 'power-bar replay-eco-bar'
      const fill = document.createElement('span')
      fill.className = 'power-fill'
      barWrap.appendChild(fill)
      const power = document.createElement('span')
      power.className = 'replay-eco-power'
      col.appendChild(name)
      col.appendChild(credits)
      col.appendChild(barWrap)
      col.appendChild(power)
      this.replayEcoEl.appendChild(col)
      this.replayEcoCols.push({ team: e.team, credits, fill, power })
    }
  }

  /** Keep the top-left rank button in sync: earned stars + match score, pulsing
   * while the next promotion is ready. Always visible so the ladder is reachable. */
  private updateRankBtn(world: World, team: number): void {
    const rank = world.rankOf(team)
    const can = world.canRankUp(team)
    const score = world.scoreOf(team)
    this.rankBtnStars.textContent = '★'.repeat(can ? rank + 1 : rank)
    this.rankBtnScore.textContent = score.toLocaleString('en-US')
    this.rankBtn.classList.toggle('pulse', can)
    const sig = `${rank}|${can}|${score}`
    if (sig !== this.lastRankSig) {
      this.lastRankSig = sig
      if (!this.rankMenu.classList.contains('open')) this.renderRankOverlay(world, team)
    }
  }

  setPingMs(ms: number | null): void {
    this.pingMs = ms
  }

  private updateFps(): void {
    const now = performance.now()
    this.fpsFrames++
    if (now - this.fpsTime >= 500) {
      this.lastFps = Math.round((this.fpsFrames * 1000) / (now - this.fpsTime))
      const fps = t('hud.fps', { fps: this.lastFps })
      this.fpsEl.textContent = this.pingMs !== null ? `${fps} · ${t('hud.ping', { ms: this.pingMs })}` : fps
      this.fpsFrames = 0
      this.fpsTime = now
    }
  }

  selectionChanged(selection: Set<number>, world: World, localTeam: number, isMobile: boolean): void {
    const sig = [...selection].sort((a, b) => a - b).join(',')
    const queueSig = this.queueSignature(world, selection)
    const workSig = this.workSignature(world, selection)
    const researchSig = this.researchSignature(world, selection)
    const garrisonSig = this.garrisonSignature(world, selection)
    if (sig === this.lastSelSig && queueSig === this.lastQueueSig && workSig === this.lastWorkSig && researchSig === this.lastResearchSig && garrisonSig === this.lastGarrisonSig) {
      for (const updater of this.updaters) updater()
      return
    }
    this.lastSelSig = sig
    this.lastQueueSig = queueSig
    this.lastWorkSig = workSig
    this.lastResearchSig = researchSig
    this.lastGarrisonSig = garrisonSig
    this.updaters = []
    this.buildMenu.innerHTML = ''
    if (selection.size === 0) {
      this.selectionInfo.textContent = t('hud.noSelection')
      this.selectionAchievement.style.display = 'none'
      this.hideBuildMenu()
      return
    }

    const names: string[] = []
    let hasBuilder = false
    let hasWorkingDozer = false
    selection.forEach((id) => {
      const u = world.units.get(id)
      const b = world.buildings.get(id)
      if (u) {
        names.push(tn(u.unitType, UNITS[u.unitType]?.name ?? u.unitType))
        if (u.unitType === 'bulldozer' && u.team === localTeam) {
          const w = world.works.get(id)
          if (w) {
            hasWorkingDozer = true
            // A constructing dozer can still accept more build orders (Day 20 queue),
            // so keep the build list visible; collecting/repairing dozers cannot.
            if (w.kind === 'construct') hasBuilder = true
          } else {
            hasBuilder = true
          }
        }
      }
      if (b) names.push(tn(b.buildingType, BUILDINGS[b.buildingType]?.name ?? b.buildingType))
    })
    if (selection.size === 1) {
      const only = [...selection][0]
      this.selectionInfo.textContent = this.describeEntity(world, only)
      this.updaters.push(() => {
        this.selectionInfo.textContent = this.describeEntity(world, only)
      })
    } else {
      this.selectionInfo.textContent = t('hud.selected', { n: names.length, names: names.slice(0, 6).join(', ') })
    }
    this.updaters.push(() => this.renderAchievement(world, selection))
    this.renderAchievement(world, selection)
    this.renderMenu(world, selection, localTeam, hasBuilder, hasWorkingDozer, isMobile)
  }

  /** Kills + current rank for the selected rank-capable units (troops/vehicles/air). */
  private renderAchievement(world: World, selection: Set<number>): void {
    let bestRank = 0
    let totalKills = 0
    let found = false
    selection.forEach((id) => {
      const u = world.units.get(id)
      if (!u) return
      found = true
      totalKills += u.killCount
      if (u.veteranRank > bestRank) bestRank = u.veteranRank
    })
    if (!found) {
      this.selectionAchievement.style.display = 'none'
      return
    }
    const pips = bestRank >= 5 ? '★' : bestRank > 0 ? '|'.repeat(bestRank) : '–'
    this.selectionAchievement.title = t('hud.achievementTitle')
    this.selectionAchievement.innerHTML =
      `<span class="ach-pips">${pips}</span>` +
      `<span class="ach-rank">${t('hud.rankLevel', { rank: bestRank })}</span>` +
      `<span class="ach-kills">${t('hud.kills', { kills: totalKills })}</span>`
    this.selectionAchievement.style.display = 'flex'
  }

  private describeEntity(world: World, id: number): string {
    const u = world.units.get(id)
    if (u) {
      const def = getUnit(u.unitType, world.settings)
      const h = world.healths.get(id)
      const hp = h && h.maxHp > 0 ? Math.round((h.hp / h.maxHp) * 100) : 100
      return t('hud.unitDesc', { name: tn(u.unitType, def.name), hp, speed: def.speed })
    }
    const b = world.buildings.get(id)
    if (b) {
      const def = getBuilding(b.buildingType, world.settings)
      const h = world.healths.get(id)
      const hp = h && h.maxHp > 0 ? Math.round((h.hp / h.maxHp) * 100) : 100
      const parts: string[] = []
      if (!b.done) parts.push(t('hud.buildingPct', { p: Math.round(b.buildProgress * 100) }))
      if (def.powerGen > 0) parts.push(t('hud.powerPlus', { p: def.powerGen }))
      if (def.powerUse > 0) parts.push(t('hud.powerMinus', { p: def.powerUse }))
      if (b.done && def.powerUse > 0 && world.teamState(b.team).powerDown) parts.push(t('hud.powerDownNote'))
      if (b.maxPowerUntil > world.tick) parts.push(t('hud.maxPowerActive', { s: Math.max(1, Math.ceil((b.maxPowerUntil - world.tick) / SIM_TICK_HZ)) }))
      if (b.maxPowerHpTarget >= 0) parts.push(t('hud.maxPowerHpDrop'))
      if (b.researchQueue.length > 0) {
        const top = b.researchQueue[0]
        const up = getUpgrade(top.upgrade, world.settings)
        parts.push(t('hud.researching', { name: tn(top.upgrade, up.name) }))
      }
      if (b.shieldHp > 0) parts.push(t('hud.shieldStatus', { p: Math.round((b.shieldHp / SHIELD_MAX_HP) * 100) }))
      const head = t('hud.buildingDesc', { name: tn(b.buildingType, def.name), p: hp })
      return parts.length ? `${head}\n${parts.join(' · ')}` : head
    }
    return ''
  }

  private queueSignature(world: World, selection: Set<number>): string {    const parts: string[] = []
    for (const id of selection) {
      const b = world.buildings.get(id)
      if (!b || !getBuilding(b.buildingType, world.settings).producesUnit) continue
      const q = world.queues.get(id)
      if (!q || q.queue.length === 0) continue
      parts.push(`${id}:${q.queue.map((o) => o.id).join(',')}`)
    }
    return parts.join('|')
  }

  private workSignature(world: World, selection: Set<number>): string {
    const parts: string[] = []
    for (const id of selection) {
      const w = world.works.get(id)
      if (w) parts.push(`${id}:${w.kind}:${w.building}`)
    }
    return parts.sort().join('|')
  }

  private researchSignature(world: World, selection: Set<number>): string {
    const parts: string[] = []
    for (const id of selection) {
      const b = world.buildings.get(id)
      if (b && b.researchQueue.length > 0) parts.push(`${id}:${b.researchQueue.map((o) => o.id).join(',')}`)
    }
    return parts.sort().join('|')
  }

  /** Passenger contents of every selected transport, so the list refreshes as riders board/unload. */
  private garrisonSignature(world: World, selection: Set<number>): string {
    const parts: string[] = []
    for (const id of selection) {
      const tc = world.transports.get(id)
      if (!tc) continue
      parts.push(`${id}:${tc.passengers.map((p) => p.unitType).join(',')}`)
    }
    return parts.sort().join('|')
  }

  private renderMenu(world: World, selection: Set<number>, localTeam: number, hasBuilder: boolean, hasWorkingDozer: boolean, isMobile: boolean): void {
    let anySection = false
    this.hotkeySlots = []
    this.usedHotkeys.clear()

    const buildings: Array<{ id: number; type: string; team: number }> = []
    selection.forEach((id) => {
      const b = world.buildings.get(id)
      if (b) buildings.push({ id, type: b.buildingType, team: b.team })
    })

    const hasMovable = (() => {
      let any = false
      selection.forEach((id) => {
        const u = world.units.get(id)
        if (u && u.team === localTeam) any = true
      })
      return any
    })()
    const movableGround: number[] = (() => {
      const ids: number[] = []
      selection.forEach((id) => {
        const u = world.units.get(id)
        if (u && u.team === localTeam && u.class !== 'air') ids.push(id)
      })
      return ids
    })()
    const hasLoadedTransport = (() => {
      let any = false
      selection.forEach((id) => {
        const tc = world.transports.get(id)
        if (tc && tc.team === localTeam && tc.passengers.length > 0) any = true
      })
      return any
    })()
    const hasThrower = (() => {
      let any = false
      selection.forEach((id) => {
        const u = world.units.get(id)
        if (u && u.team === localTeam && canThrowBandolier({ id: u.unitType, class: u.class })) any = true
      })
      return any
    })()
    if (hasWorkingDozer || hasMovable || hasLoadedTransport) {
      this.appendHeader(t('hud.headers.command'))
      this.addButton(t('hud.stop'), () => true, () => this.actions.onStopClick())
      this.addToggleButton(t('hud.multiPos'), () => this.actions.onMoveModeToggle(), () => this.actions.isMoveModeActive())
      if (movableGround.length >= 2) {
        this.addToggleButton(t('hud.formHold'), () => this.actions.onFormationClick('hold'), () => this.actions.isFormationActive('hold'))
        this.addToggleButton(t('hud.formTight'), () => this.actions.onFormationClick('tight'), () => this.actions.isFormationActive('tight'))
        this.addToggleButton(t('hud.formLoose'), () => this.actions.onFormationClick('loose'), () => this.actions.isFormationActive('loose'))
      }
      if (hasThrower && world.teamState(localTeam).abilitiesUnlocked) {
        this.addToggleButton(t('hud.grenade'), () => this.actions.onGrenadeToggle(), () => this.actions.isGrenadeActive())
        this.addToggleButton(t('hud.smoke'), () => this.actions.onSmokeToggle(), () => this.actions.isSmokeActive())
      }
      if (hasMovable && world.teamState(localTeam).mineTech) {
        let hasEngineer = false
        let hasMineRemover = false
        selection.forEach((id) => {
          const u = world.units.get(id)
          if (!u || u.team !== localTeam) return
          if (u.unitType === 'engineer') {
            hasEngineer = true
            hasMineRemover = true
          }
          if (u.unitType === 'bulldozer') hasMineRemover = true
        })
        if (hasEngineer) {
          this.addToggleButton(
            `${t('hud.placeMine')} <span class="cost">$${world.settings.mineCost}</span>`,
            () => this.actions.onPlaceMineToggle(),
            () => this.actions.isPlaceMineActive(),
            this.assignUniqueHotkey(t('hud.placeMine')),
          )
        }
        if (hasMineRemover) {
          this.addToggleButton(
            t('hud.removeMine'),
            () => this.actions.onRemoveMineToggle(),
            () => this.actions.isRemoveMineActive(),
            this.assignUniqueHotkey(t('hud.removeMine')),
          )
        }
      }
      if (hasMovable && world.teamState(localTeam).stealthTech) {
        let anyEligible = false
        const stealthEligible: number[] = []
        selection.forEach((id) => {
          const u = world.units.get(id)
          if (!u || u.team !== localTeam) return
          if (u.class !== 'infantry' && u.class !== 'vehicle') return
          anyEligible = true
          if (!u.stealth) stealthEligible.push(id)
        })
        if (anyEligible) {
          const stealthCost = world.settings.stealthCost
          this.addButton(
            `${t('hud.stealth')} <span class="cost">$${stealthCost}</span>`,
            () => stealthEligible.length > 0 && world.creditsOf(localTeam) >= stealthCost,
            () => this.actions.onStealthClick(stealthEligible),
            undefined,
            undefined,
            this.assignUniqueHotkey(t('hud.stealth')),
          )
        }
      }
      if (hasLoadedTransport) {
        this.addToggleButton(t('hud.unload'), () => this.actions.onUnloadToggle(), () => this.actions.isUnloadActive())
      }
      anySection = true
    }

    if (selection.size > 0) {
      let destroyable = false
      let refund = 0
      const frac = world.settings.sellRefundFraction
      selection.forEach((id) => {
        const u = world.units.get(id)
        const b = world.buildings.get(id)
        if (u) {
          if (world.canControl(localTeam, id)) {
            destroyable = true
            refund += Math.floor(getUnit(u.unitType, world.settings).cost * frac)
          }
        }
        if (b) {
          if (world.canControl(localTeam, id)) {
            destroyable = true
            refund += Math.floor(getBuilding(b.buildingType, world.settings).cost * frac)
          }
        }
      })
      if (destroyable) {
        if (!anySection) {
          this.appendHeader(t('hud.headers.command'))
          anySection = true
        }
        this.addButton(t('hud.destroy', { r: refund }), () => true, () => this.actions.onDestroyClick(), 'danger')
      }
      if (this.hasAttackable(world, selection, localTeam)) {
        if (!anySection) {
          this.appendHeader(t('hud.headers.command'))
          anySection = true
        }
        this.addToggleButton(t('hud.attack'), () => this.actions.onAttackToggle(), () => this.actions.isAttackActive())
        this.addToggleButton(t('hud.keepAttack'), () => this.actions.onKeepAttackToggle(), () => this.actions.isKeepAttackActive())
        this.addToggleButton(t('hud.guard'), () => this.actions.onGuardToggle(), () => this.actions.isGuardActive())
        this.addToggleButton(t('hud.autoFire'), () => this.actions.onAutoFireToggle(), () => this.actions.isAutoFireActive())
      }
      if (this.hasProducer(world, selection, localTeam)) {
        if (!anySection) {
          this.appendHeader(t('hud.headers.command'))
          anySection = true
        }
        this.addToggleButton(t('hud.spawnPoint'), () => this.actions.onSpawnToggle(), () => this.actions.isSpawnActive())
        this.addToggleButton(t('hud.flag'), () => this.actions.onFlagToggle(), () => this.actions.isFlagActive())
      }
      if (isMobile) {
        if (!anySection) {
          this.appendHeader(t('hud.headers.command'))
          anySection = true
        }
        this.addButton(t('hud.deselect'), () => true, () => this.actions.onDeselectClick())
      }
    }

    let produced = false
    for (const bd of buildings) {
      if (bd.team !== localTeam) continue
      const trainable = Object.values(UNITS).filter((ud) => ud.producedBy === bd.type)
      if (trainable.length === 0) continue
      if (!produced) {
        this.appendHeader(t('hud.headers.produce'))
        produced = true
        anySection = true
      }
      for (const ud of trainable) {
        const udCost = getUnit(ud.id, world.settings).cost
        this.addButton(
          `${hudIconHtml('unit', ud.id, tn(ud.id, ud.name))}<span>${tn(ud.id, ud.name)}</span> <span class="cost">$${udCost}</span>`,
          () => {
            if (world.creditsOf(bd.team) < udCost) return false
            const q = world.queues.get(bd.id)
            if (q && q.queue.length >= world.settings.queueLimit) return false
            if (ud.class === 'air') {
              let airCount = 0
              world.planes.forEach((_pid, p) => {
                if (p.home === bd.id) airCount++
              })
              if (q) {
                for (const o of q.queue) {
                  const od = UNITS[o.unitType]
                  if (od && od.class === 'air') airCount++
                }
              }
              if (airCount >= (ud.capacity ?? 3)) return false
            }
            return true
          },
          () => this.actions.onQueueClick(ud.id),
          undefined,
          undefined,
          this.assignUniqueHotkey(tn(ud.id, ud.name)),
        )
      }
    }

    let queueShown = false
    for (const bd of buildings) {
      if (bd.team !== localTeam) continue
      const def = BUILDINGS[bd.type]
      if (!def) continue
      const q = world.queues.get(bd.id)
      if (!q || q.queue.length === 0) continue
      if (!queueShown) {
        this.appendHeader(t('hud.headers.queue'))
        queueShown = true
        anySection = true
      }
      const scroll = document.createElement('div')
      scroll.className = 'queue-scroll'
      this.buildMenu.appendChild(scroll)
      q.queue.forEach((order, i) => {
        const ud = getUnit(order.unitType, world.settings)
        this.addQueueCard(scroll, bd.id, i, order, tn(order.unitType, ud.name), ud.buildTimeTicks, q.queue.length)
      })
    }

    let researched = false
    for (const bd of buildings) {
      if (bd.team !== localTeam) continue
      const ups = UPGRADES_BY_BUILDING[bd.type]
      if (!ups || ups.length === 0) continue
      if (!researched) {
        this.appendHeader(t('hud.headers.research'))
        researched = true
        anySection = true
      }
      const b = world.buildings.get(bd.id)
      if (b && b.researchQueue.length > 0) {
        const scroll = document.createElement('div')
        scroll.className = 'queue-scroll'
        this.buildMenu.appendChild(scroll)
        b.researchQueue.forEach((ord, i) => {
          const up = getUpgrade(ord.upgrade, world.settings)
          const isHead = i === 0
          this.addResearchCard(scroll, bd.id, i, tn(ord.upgrade, up.name), () => world.buildings.get(bd.id)?.researchQueue[i]?.remainingTicks ?? 0, up.researchTimeTicks, isHead)
        })
      }
      for (const up of ups) {
        const upDef = getUpgrade(up.id, world.settings)
        if (up.id === 'space-laser') {
          const maxLv = world.laserMaxLevel()
          const lv = world.laserLevel(bd.team)
          const upCost = world.laserUpgradeCost(bd.team, upDef.cost)
          const tag = lv >= maxLv ? 'Max' : t('tools.laserLevel', { lv: lv + 1 })
          this.addButton(
            `${tn(up.id, upDef.name)} (${tag}) <span class="cost">$${upCost}</span>${this.rankBadge(upDef.requiredRank, world.rankOf(bd.team))}`,
            () => {
              if (world.rankOf(bd.team) < upDef.requiredRank) return false
              if (world.creditsOf(bd.team) < upCost) return false
              const b2 = world.buildings.get(bd.id)
              if (!b2 || !b2.done) return false
              if (b2.researchQueue.length >= world.settings.queueLimit) return false
              if (world.laserLevel(bd.team) >= maxLv) return false
              return true
            },
            () => this.actions.onResearchClick(up.id),
            world.rankOf(bd.team) < upDef.requiredRank ? 'locked' : undefined,
            undefined,
            this.assignUniqueHotkey(tn(up.id, upDef.name)),
          )
          continue
        }
        if (up.id === 'weapon-upgrade') {
          const maxLv = world.weaponMaxLevel()
          const lv = world.weaponUpgradeLevel(bd.team)
          const upCost = world.weaponUpgradeCost(bd.team, upDef.cost)
          const tag = lv >= maxLv ? 'Max' : t('tools.weaponLevel', { lv: lv + 1 })
          this.addButton(
            `${tn(up.id, upDef.name)} (${tag}) <span class="cost">$${upCost}</span>${this.rankBadge(upDef.requiredRank, world.rankOf(bd.team))}`,
            () => {
              if (world.rankOf(bd.team) < upDef.requiredRank) return false
              if (world.creditsOf(bd.team) < upCost) return false
              const b2 = world.buildings.get(bd.id)
              if (!b2 || !b2.done) return false
              if (b2.researchQueue.length >= world.settings.queueLimit) return false
              if (world.weaponUpgradeLevel(bd.team) >= maxLv) return false
              return true
            },
            () => this.actions.onResearchClick(up.id),
            world.rankOf(bd.team) < upDef.requiredRank ? 'locked' : undefined,
            undefined,
            this.assignUniqueHotkey(tn(up.id, upDef.name)),
          )
          continue
        }
        if (up.id === 'airstrike-level' || up.id === 'emp-level') {
          const maxLv = up.id === 'airstrike-level' ? world.airstrikeMaxLevel() : world.empMaxLevel()
          const lv = up.id === 'airstrike-level' ? world.airstrikeLevel(bd.team) : world.empLevel(bd.team)
          const upCost = lv * 1000 + upDef.cost
          const tag = lv >= maxLv ? 'Max' : t('tools.laserLevel', { lv: lv + 1 })
          const armed = world.swChoiceOf(bd.team) === (up.id === 'airstrike-level' ? 'airstrike' : 'emp')
          this.addButton(
            `${tn(up.id, upDef.name)} (${tag}) <span class="cost">$${upCost}</span>${this.rankBadge(upDef.requiredRank, world.rankOf(bd.team))}`,
            () => {
              if (world.rankOf(bd.team) < upDef.requiredRank) return false
              if (!armed) return false
              if (world.creditsOf(bd.team) < upCost) return false
              const b2 = world.buildings.get(bd.id)
              if (!b2 || !b2.done) return false
              if (b2.researchQueue.length >= world.settings.queueLimit) return false
              if (lv >= maxLv) return false
              return true
            },
            () => this.actions.onResearchClick(up.id),
            world.rankOf(bd.team) < upDef.requiredRank ? 'locked' : undefined,
            undefined,
            this.assignUniqueHotkey(tn(up.id, upDef.name)),
          )
          continue
        }
        const upCost = upDef.cost
        this.addButton(
          `${tn(up.id, upDef.name)} <span class="cost">$${upCost}</span>${this.rankBadge(upDef.requiredRank, world.rankOf(bd.team))}`,
          () => {
            const ts2 = world.teamState(bd.team)
            if (world.rankOf(bd.team) < upDef.requiredRank) return false
            if (world.creditsOf(bd.team) < upCost) return false
            const b2 = world.buildings.get(bd.id)
            if (!b2 || !b2.done) return false
            if (b2.researchQueue.length >= world.settings.queueLimit) return false
            if (up.id === 'radar' && ts2.radar) return false
            if (up.id === 'satellite' && ts2.satellite) return false
            if (up.id === 'stealth-tech' && ts2.stealthTech) return false
            if (up.id === 'detector-upgrade' && ts2.detectorUnlocked) return false
            if (up.id === 'mine-tech' && ts2.mineTech) return false
            if (up.id === 'abilities-tech' && ts2.abilitiesUnlocked) return false
            if (up.id === 'defense-dome' && ts2.defenseDome) return false
            return true
          },
          () => this.actions.onResearchClick(up.id),
          world.rankOf(bd.team) < upDef.requiredRank ? 'locked' : undefined,
          undefined,
          this.assignUniqueHotkey(tn(up.id, upDef.name)),
        )
      }
    }

    let swShown = false
    for (const bd of buildings) {
      if (bd.team !== localTeam || bd.type !== 'super-weapon') continue
      const b = world.buildings.get(bd.id)
      if (!b || !b.done) continue
      const ts = world.teamState(bd.team)
      if (!swShown) {
        this.appendHeader(t('hud.headers.superWeapon'))
        swShown = true
        anySection = true
      }
      const chosen = ts.swChoice
      // Day 15: the Space Laser is armed by default — the panel only offers
      // the *additional* one-time strike (Airstrike vs EMP), each upgradeable.
      const note = document.createElement('div')
      note.className = 'sw-panel-note'
      note.textContent = t('hud.swLaserDefault')
      this.buildMenu.appendChild(note)
      for (const choice of SW_CHOICES) {
        if (choice === 'laser') continue
        const labelKey = choice === 'airstrike' ? 'tools.swAirstrike' : 'tools.swEmp'
        const isChosen = chosen === choice
        // The second super weapon only unlocks once the team reaches 1★.
        const rank = world.rankOf(bd.team)
        this.addButton(
          `${t(labelKey)}${isChosen ? ' ✓' : ''}${this.rankBadge(1, rank)}`,
          () => chosen === null && world.rankOf(bd.team) >= 1,
          () => this.actions.onSwChoose(choice),
        )
      }
    }

    let detectorShown = false
    for (const bd of buildings) {
      if (bd.team !== localTeam) continue
      const ts = world.teamState(bd.team)
      if (!ts.detectorUnlocked) continue
      const b = world.buildings.get(bd.id)
      if (!b || !b.done) continue
      if (!detectorShown) {
        this.appendHeader(t('hud.headers.detector'))
        detectorShown = true
        anySection = true
      }
      const detectorCost = world.settings.detectorCost
      this.addButton(
        `${t('hud.detector')} <span class="cost">$${detectorCost}</span>`,
        () => {
          if (world.creditsOf(bd.team) < detectorCost) return false
          const b2 = world.buildings.get(bd.id)
          if (!b2 || !b2.done || b2.detector) return false
          return true
        },
        () => this.actions.onDetectorClick([bd.id]),
        undefined,
        undefined,
        this.assignUniqueHotkey(t('hud.detector')),
      )
    }

    let maxPowerShown = false
    for (const bd of buildings) {
      if (bd.team !== localTeam || bd.type !== 'power-plant') continue
      const b2 = world.buildings.get(bd.id)
      if (!b2 || !b2.done) continue
      if (!maxPowerShown) {
        this.appendHeader(t('hud.headers.power'))
        maxPowerShown = true
        anySection = true
      }
      const scroll = document.createElement('div')
      scroll.className = 'queue-scroll'
      this.buildMenu.appendChild(scroll)
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'queue-card'
      const label = document.createElement('span')
      label.className = 'qc-label'
      btn.appendChild(label)
      scroll.appendChild(btn)
      btn.addEventListener('click', () => this.actions.onMaxPowerClick([bd.id]))
      this.updaters.push(() => {
        const bb = world.buildings.get(bd.id)
        if (!bb) return
        const active = bb.maxPowerUntil > world.tick
        const hh = world.healths.get(bd.id)
        const full = !!hh && hh.hp >= hh.maxHp
        btn.disabled = active || !full
        btn.classList.toggle('active', active)
        label.textContent = active
          ? t('hud.maxPowerActive', { s: Math.max(1, Math.ceil((bb.maxPowerUntil - world.tick) / SIM_TICK_HZ)) })
          : t('hud.maxPower')
      })
    }

    if (hasBuilder) {
      this.appendHeader(t('hud.headers.build'))
      anySection = true
      for (const bdId of BUILDER_BUILDABLES) {
        const bd = getBuilding(bdId, world.settings)
        this.addButton(
          `${hudIconHtml('building', bd.id, tn(bd.id, bd.name))}<span>${tn(bd.id, bd.name)}</span> <span class="cost">$${bd.cost}</span>`,
          () => {
            if (world.creditsOf(localTeam) < bd.cost) return false
            if (bd.countLimit !== undefined && this.countBuilding(world, bd.id, localTeam) >= bd.countLimit) return false
            return true
          },
          () => this.actions.onBuildClick(bd.id),
          undefined,
          undefined,
          this.assignUniqueHotkey(tn(bd.id, bd.name)),
        )
      }
    }

    if (this.renderPassengers(world, selection, localTeam)) {
      anySection = true
    }

    if (!anySection) {
      this.hideBuildMenu()
      return
    }
    this.buildMenu.classList.add('visible')
    for (const updater of this.updaters) updater()
  }

  /** Lists the units riding inside every selected local transport (APC or bunker garrison). */
  private renderPassengers(world: World, selection: Set<number>, localTeam: number): boolean {
    const transports: number[] = []
    selection.forEach((id) => {
      const tc = world.transports.get(id)
      if (tc && tc.team === localTeam && tc.passengers.length > 0) transports.push(id)
    })
    if (transports.length === 0) return false

    this.appendHeader(t('hud.headers.garrison'))
    const scroll = document.createElement('div')
    scroll.className = 'queue-scroll load-scroll'
    this.buildMenu.appendChild(scroll)
    for (const id of transports) {
      const tc = world.transports.get(id)
      if (!tc) continue
      const carrierName = (() => {
        const u = world.units.get(id)
        if (u) return tn(u.unitType, UNITS[u.unitType]?.name ?? u.unitType)
        const b = world.buildings.get(id)
        if (b) return tn(b.buildingType, BUILDINGS[b.buildingType]?.name ?? b.buildingType)
        return ''
      })()
      if (transports.length > 1) {
        const group = document.createElement('div')
        group.className = 'load-group'
        group.textContent = carrierName
        scroll.appendChild(group)
      }
      for (const [i, p] of tc.passengers.entries()) {
        const def = getUnit(p.unitType, world.settings)
        const row = document.createElement('div')
        row.className = 'load-row'
        row.title = t('hud.unloadRider')
        row.innerHTML = `${hudIconHtml('unit', p.unitType, tn(p.unitType, def.name))}<span>${tn(p.unitType, def.name)}</span><span class="load-row-eject">⤓</span>`
        row.addEventListener('click', (ev) => {
          ev.stopPropagation()
          this.actions.onUnloadOne(id, i)
        })
        scroll.appendChild(row)
      }
    }
    return true
  }

  private addButton(label: string, isEnabled: () => boolean, onClick: () => void, className?: string, iconHtml = '', hotkey?: string, hover?: { onEnter: () => void; onLeave: () => void }): void {
    const b = document.createElement('button')
    b.type = 'button'
    b.innerHTML = iconHtml + label
    if (iconHtml) b.classList.add('has-icon')
    if (className) b.classList.add(className)
    b.addEventListener('click', onClick)
    if (hover) {
      b.addEventListener('mouseenter', hover.onEnter)
      b.addEventListener('mouseleave', hover.onLeave)
    }
    this.buildMenu.appendChild(b)
    if (hotkey) {
      this.hotkeySlots.push({ key: hotkey, enabled: isEnabled, act: onClick })
      b.title = `${label.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()} (${modifierLabel()}+${hotkey.toUpperCase()})`
    }
    this.updaters.push(() => {
      b.disabled = !isEnabled()
    })
  }

  /** Day 15: tiny lock tag shown next to a rank-gated research button. */
  private rankBadge(requiredRank: number, rank: number): string {
    if (requiredRank <= 0 || rank >= requiredRank) return ''
    return ` <span class="lock-badge" title="${t('hud.rankRequired', { n: requiredRank })}"><span class="lock-badge-star">★</span>${requiredRank}</span>`
  }

  /** Pick a unique letter hotkey for a menu button: first free letter (1st, then 2nd, then 3rd…). */
  private assignUniqueHotkey(label: string): string {
    const lower = label.toLowerCase()
    let pick = ''
    for (const ch of lower) {
      if (!/[a-z]/.test(ch)) continue
      if (this.usedHotkeys.has(ch)) continue
      pick = ch
      break
    }
    if (!pick) {
      const c = lower.trim().charAt(0) || ''
      if (c && !/[a-z]/.test(c)) pick = c
    }
    if (pick) this.usedHotkeys.add(pick)
    return pick
  }

  private hasAttackable(world: World, selection: Set<number>, localTeam: number): boolean {
    for (const id of selection) {
      const u = world.units.get(id)
      if (u && u.team === localTeam && world.attacks.has(id)) return true
    }
    return false
  }

  private hasProducer(world: World, selection: Set<number>, localTeam: number): boolean {
    for (const id of selection) {
      const b = world.buildings.get(id)
      if (b && b.done && b.team === localTeam && getBuilding(b.buildingType, world.settings).producesUnit) return true
    }
    return false
  }

  private addToggleButton(label: string, onToggle: () => void, isActive: () => boolean, hotkey?: string): void {
    const b = document.createElement('button')
    b.type = 'button'
    b.innerHTML = label
    b.addEventListener('click', onToggle)
    this.buildMenu.appendChild(b)
    if (hotkey) {
      this.hotkeySlots.push({ key: hotkey, enabled: () => true, act: onToggle })
      b.title = `${label.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()} (${modifierLabel()}+${hotkey.toUpperCase()})`
    }
    this.updaters.push(() => {
      b.classList.toggle('active', isActive())
    })
  }

  isBuildMenuVisible(): boolean {
    return this.buildMenu.classList.contains('visible')
  }

  hudShortcutByLetter(letter: string): boolean {
    if (!this.isBuildMenuVisible()) return false
    const l = letter.toLowerCase()
    for (const s of this.hotkeySlots) {
      if (s.key === l) {
        if (!s.enabled()) return true
        s.act()
        return true
      }
    }
    return false
  }

  private addQueueCard(parent: HTMLElement, buildingId: number, index: number, order: ProductionOrder, name: string, totalTicks: number, count: number): void {
    const wrap = document.createElement('div')
    wrap.className = 'queue-item'
    const moveLeft = document.createElement('button')
    moveLeft.type = 'button'
    moveLeft.className = 'q-arrow q-left'
    moveLeft.textContent = '◀'
    moveLeft.disabled = index === 0
    moveLeft.title = t('hud.queueMoveLeft')
    moveLeft.addEventListener('click', () => this.actions.onReorderClick(buildingId, index, index - 1))
    const btn = document.createElement('button')
    btn.className = 'queue-card'
    btn.type = 'button'
    btn.dataset.index = String(index)
    const label = document.createElement('span')
    label.className = 'qc-label'
    label.textContent = name
    const fill = document.createElement('span')
    fill.className = 'qc-fill'
    btn.appendChild(fill)
    btn.appendChild(label)
    btn.title = t('hud.queueCancel')
    btn.addEventListener('click', () => {
      if (btn.dataset.suppressClick === '1') {
        delete btn.dataset.suppressClick
        return
      }
      this.actions.onDequeueClick(buildingId, index)
    })
    const moveRight = document.createElement('button')
    moveRight.type = 'button'
    moveRight.className = 'q-arrow q-right'
    moveRight.textContent = '▶'
    moveRight.disabled = index >= count - 1
    moveRight.title = t('hud.queueMoveRight')
    moveRight.addEventListener('click', () => this.actions.onReorderClick(buildingId, index, index + 1))
    wrap.appendChild(moveLeft)
    wrap.appendChild(btn)
    wrap.appendChild(moveRight)
    this.attachQueueDrag(btn, parent, wrap, buildingId, index)
    parent.appendChild(wrap)
    this.updaters.push(() => {
      const p = index === 0 ? Math.max(0, Math.min(1, 1 - order.remainingTicks / totalTicks)) : 0
      fill.style.width = `${(p * 100).toFixed(1)}%`
    })
  }

  /** Drag + drop reorder (Day 7): pointer-drag a queue card (wrapper) to a new slot, commit on release. */
  private attachQueueDrag(btn: HTMLButtonElement, container: HTMLElement, wrap: HTMLElement, buildingId: number, index: number): void {
    const startDrag = (e: PointerEvent): void => {
      if (e.button !== 0) return
      this.dragState = { btn, container, wrap, from: index, buildingId, moved: false, startX: e.clientX, startY: e.clientY }
      try {
        btn.setPointerCapture(e.pointerId)
      } catch {
        /* pointer capture unavailable */
      }
    }
    const move = (e: PointerEvent): void => {
      const ds = this.dragState
      if (!ds || ds.btn !== btn) return
      if (!ds.moved && Math.hypot(e.clientX - ds.startX, e.clientY - ds.startY) > 6) ds.moved = true
      if (!ds.moved) return
      e.preventDefault()
      btn.classList.add('dragging')
      container.querySelectorAll('.queue-card.drag-over').forEach((c) => c.classList.remove('drag-over'))
      let anchor: HTMLElement | null = null
      for (const c of Array.from(container.children) as HTMLElement[]) {
        if (c === ds.wrap) continue
        const r = c.getBoundingClientRect()
        if (e.clientX < r.left + r.width / 2) {
          anchor = c
          break
        }
      }
      if (anchor) {
        container.insertBefore(ds.wrap, anchor)
        anchor.querySelector('.queue-card')?.classList.add('drag-over')
      } else {
        container.appendChild(ds.wrap)
      }
    }
    const end = (): void => {
      const ds = this.dragState
      if (!ds || ds.btn !== btn) return
      btn.classList.remove('dragging')
      container.querySelectorAll('.queue-card.drag-over').forEach((c) => c.classList.remove('drag-over'))
      if (ds.moved) {
        const to = Array.from(container.children).indexOf(ds.wrap)
        if (to !== ds.from) {
          btn.dataset.suppressClick = '1'
          this.actions.onReorderClick(ds.buildingId, ds.from, to)
        }
      }
      this.dragState = null
    }
    const cancel = (): void => {
      if (this.dragState?.btn === btn) this.dragState = null
      btn.classList.remove('dragging')
    }
    btn.addEventListener('pointerdown', startDrag)
    btn.addEventListener('pointermove', move)
    btn.addEventListener('pointerup', end)
    btn.addEventListener('pointercancel', cancel)
  }

  private addResearchCard(parent: HTMLElement, buildingId: number, index: number, name: string, getRemaining: () => number, totalTicks: number, isHead: boolean): void {
    const card = document.createElement('button')
    card.type = 'button'
    card.className = 'queue-card'
    const label = document.createElement('span')
    label.className = 'qc-label'
    label.textContent = name
    const fill = document.createElement('span')
    fill.className = 'qc-fill research'
    card.appendChild(fill)
    card.appendChild(label)
    card.title = t('hud.queueCancel')
    card.addEventListener('click', () => this.actions.onDequeueResearch(buildingId, index))
    parent.appendChild(card)
    this.updaters.push(() => {
      const p = isHead ? Math.max(0, Math.min(1, 1 - getRemaining() / totalTicks)) : 0
      fill.style.width = `${(p * 100).toFixed(1)}%`
    })
  }

  private appendHeader(text: string): void {
    const h = document.createElement('h3')
    h.textContent = text
    this.buildMenu.appendChild(h)
  }

  private countBuilding(world: World, type: string, team: number): number {
    let n = 0
    world.buildings.forEach((_id, b) => {
      if (b.buildingType === type && b.team === team) n++
    })
    return n
  }

  private hideBuildMenu(): void {
    this.buildMenu.classList.remove('visible')
  }

  toast(msg: string): void {
    const el = document.createElement('div')
    el.className = 'toast'
    el.textContent = msg
    document.getElementById('app')!.appendChild(el)
    requestAnimationFrame(() => el.classList.add('visible'))
    setTimeout(() => {
      el.classList.remove('visible')
      setTimeout(() => el.remove(), 350)
    }, 4000)
  }

  /** Achievement unlocked banner: pops near the top of the screen, then fades away.
   *  Also used for rank-ups (pass a different `header`, e.g. "Rank up!"). When `combined`
   *  is set, the body renders title + desc as one text line (empty header is skipped). */
  achievementToast(title: string, desc: string, header = t('profile.toastTitle'), combined = false): void {
    const el = document.createElement('div')
    el.className = 'toast ach'
    el.innerHTML = combined
      ? `<span class="toast-icon">★</span><span class="toast-body"><span class="toast-text">${this.esc([header, title, desc].filter(Boolean).join(' '))}</span></span>`
      : `<span class="toast-icon">★</span><span class="toast-body"><span class="toast-header">${this.esc(header)}</span><span class="toast-title">${this.esc(title)}</span><span class="toast-desc">${this.esc(desc)}</span></span>`
    document.getElementById('app')!.appendChild(el)
    requestAnimationFrame(() => el.classList.add('visible'))
    setTimeout(() => {
      el.classList.remove('visible')
      setTimeout(() => el.remove(), 350)
    }, 3200)
  }

  private esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }
}
