import { BUILDINGS, UNITS, UPGRADES, SIM_TICK_HZ, getBuilding, getUnit, getUpgrade, type UpgradeDef } from '@space-arenas/shared'
import type { ProductionOrder, World } from '../core/world.ts'
import { t, tn } from '../i18n/index.ts'

export interface HudActions {
  onBuildClick: (type: string) => void
  onQueueClick: (type: string) => void
  onDequeueClick: (buildingId: number, index: number) => void
  onResearchClick: (upgrade: string) => void
  onStopClick: () => void
  onDestroyClick: () => void
  onAttackToggle: () => void
  isAttackActive: () => boolean
  onKeepAttackToggle: () => void
  isKeepAttackActive: () => boolean
  onGuardToggle: () => void
  isGuardActive: () => boolean
  onSpawnToggle: () => void
  isSpawnActive: () => boolean
  onFlagToggle: () => void
  isFlagActive: () => boolean
  onMoveModeToggle: () => void
  isMoveModeActive: () => boolean
  onMaxPowerClick: (buildingIds: number[]) => void
  onDeselectClick: () => void
}

const BUILDER_BUILDABLES = ['command-center', 'power-plant', 'supply-dock', 'barracks', 'war-factory', 'turret', 'tech-center', 'air-force', 'super-weapon'] as const

const UPGRADES_BY_BUILDING: Record<string, UpgradeDef[]> = {}
for (const u of Object.values(UPGRADES)) {
  ;(UPGRADES_BY_BUILDING[u.availableAt] ??= []).push(u)
}

export class Hud {
  private creditsEl = document.getElementById('credits')!
  private powerTextEl = document.getElementById('power-text')!
  private powerFillEl = document.getElementById('power-fill')!
  private tickEl = document.getElementById('tick-info')!
  private syncEl = document.getElementById('sync-info')!
  private fpsEl = document.getElementById('fps-info')!
  private buildMenu = document.getElementById('build-menu')!
  private selectionInfo = document.getElementById('selection-info')!
  private gameLog = document.getElementById('game-log')!
  private hudEl = document.getElementById('hud')!

  private lastSelSig: string | null = null
  private lastQueueSig: string | null = null
  private lastWorkSig: string | null = null
  private lastResearchSig: string | null = null
  private updaters: Array<() => void> = []
  private menuSlots: Array<{ enabled: () => boolean; act: () => void }> = []

  private fpsFrames = 0
  private fpsTime = performance.now()

  constructor(private actions: HudActions) {}

  show(): void {
    this.hudEl.style.display = 'block'
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

  update(world: World, localTeam: number, tick: number | null, localHash: number | null, syncOk: boolean): void {
    const ts = world.teamState(localTeam)
    this.creditsEl.textContent = `$${ts.credits}`
    const frac = ts.powerUse > 0 ? Math.min(1, ts.powerUse / Math.max(1, ts.powerGen)) : 0
    this.powerFillEl.style.width = `${(frac * 100).toFixed(1)}%`
    this.powerFillEl.style.background = ts.powerDown ? '#e84a4a' : '#4ad8ff'
    this.powerTextEl.textContent = ts.powerDown ? t('hud.powerDown') : t('hud.power', { use: ts.powerUse, gen: ts.powerGen })
    this.tickEl.textContent = tick !== null ? t('hud.tick', { t: tick }) : ''
    this.syncEl.textContent = localHash !== null ? (syncOk ? t('hud.inSync') : t('hud.desync')) : ''
    this.syncEl.style.color = syncOk ? '#7cf27c' : '#ff7a7a'
    this.updateFps()
  }

  private updateFps(): void {
    const now = performance.now()
    this.fpsFrames++
    if (now - this.fpsTime >= 500) {
      this.fpsEl.textContent = t('hud.fps', { fps: Math.round((this.fpsFrames * 1000) / (now - this.fpsTime)) })
      this.fpsFrames = 0
      this.fpsTime = now
    }
  }

  selectionChanged(selection: Set<number>, world: World, localTeam: number, isMobile: boolean): void {
    const sig = [...selection].sort((a, b) => a - b).join(',')
    const queueSig = this.queueSignature(world, selection)
    const workSig = this.workSignature(world, selection)
    const researchSig = this.researchSignature(world, selection)
    if (sig === this.lastSelSig && queueSig === this.lastQueueSig && workSig === this.lastWorkSig && researchSig === this.lastResearchSig) {
      for (const updater of this.updaters) updater()
      return
    }
    this.lastSelSig = sig
    this.lastQueueSig = queueSig
    this.lastWorkSig = workSig
    this.lastResearchSig = researchSig
    this.updaters = []
    this.buildMenu.innerHTML = ''
    if (selection.size === 0) {
      this.selectionInfo.textContent = t('hud.noSelection')
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
          if (world.works.has(id)) hasWorkingDozer = true
          else hasBuilder = true
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
    this.renderMenu(world, selection, localTeam, hasBuilder, hasWorkingDozer, isMobile)
  }

  private describeEntity(world: World, id: number): string {
    const u = world.units.get(id)
    if (u) {
      const def = getUnit(u.unitType, world.settings)
      const h = world.healths.get(id)
      const hp = h && h.maxHp > 0 ? Math.round((h.hp / h.maxHp) * 100) : 100
      return t('hud.unitDesc', { name: tn(u.unitType, def.name), hp, cost: def.cost, speed: def.speed })
    }
    const b = world.buildings.get(id)
    if (b) {
      const def = getBuilding(b.buildingType, world.settings)
      const h = world.healths.get(id)
      const hp = h && h.maxHp > 0 ? Math.round((h.hp / h.maxHp) * 100) : 100
      const parts: string[] = []
      if (!b.done) parts.push(t('hud.buildingPct', { p: Math.round(b.buildProgress * 100) }))
      parts.push(t('hud.hp', { p: hp }))
      parts.push(t('hud.cost', { c: def.cost }))
      if (def.powerGen > 0) parts.push(t('hud.powerPlus', { p: def.powerGen }))
      if (def.powerUse > 0) parts.push(t('hud.powerMinus', { p: def.powerUse }))
      if (b.done && def.powerUse > 0 && world.teamState(b.team).powerDown) parts.push(t('hud.powerDownNote'))
      if (b.maxPowerUntil > world.tick) parts.push(t('hud.maxPowerActive', { s: Math.max(1, Math.ceil((b.maxPowerUntil - world.tick) / SIM_TICK_HZ)) }))
      if (b.maxPowerHpTarget >= 0) parts.push(t('hud.maxPowerHpDrop'))
      if (def.producesUnit) parts.push(t('hud.makes', { name: tn(def.producesUnit, UNITS[def.producesUnit]?.name ?? def.producesUnit) }))
      if (b.researching !== '') {
        const up = getUpgrade(b.researching, world.settings)
        parts.push(t('hud.researching', { name: tn(b.researching, up.name) }))
      }
      return t('hud.buildingDesc', { name: tn(b.buildingType, def.name), parts: parts.join(' · ') })
    }
    return ''
  }

  private queueSignature(world: World, selection: Set<number>): string {    const parts: string[] = []
    for (const id of selection) {
      const b = world.buildings.get(id)
      if (!b || !getBuilding(b.buildingType, world.settings).producesUnit) continue
      const q = world.queues.get(id)
      if (!q || q.queue.length === 0) continue
      parts.push(`${id}:${q.queue.map((o) => o.unitType).join(',')}`)
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
      if (b && b.researching !== '') parts.push(`${id}:${b.researching}`)
    }
    return parts.sort().join('|')
  }

  private renderMenu(world: World, selection: Set<number>, localTeam: number, hasBuilder: boolean, hasWorkingDozer: boolean, isMobile: boolean): void {
    let anySection = false
    this.menuSlots = []

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
    if (hasWorkingDozer || hasMovable) {
      this.appendHeader(t('hud.headers.command'))
      this.addButton(t('hud.stop'), () => true, () => this.actions.onStopClick())
      this.addToggleButton(t('hud.multiPos'), () => this.actions.onMoveModeToggle(), () => this.actions.isMoveModeActive())
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
          if (u.team === localTeam) {
            destroyable = true
            refund += Math.floor(getUnit(u.unitType, world.settings).cost * frac)
          }
        }
        if (b) {
          if (b.team === localTeam) {
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
          `${tn(ud.id, ud.name)} <span class="cost">$${udCost}</span>`,
          () => {
            const ts = world.teamState(bd.team)
            if (ts.credits < udCost) return false
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
        this.addQueueCard(scroll, bd.id, i, order, tn(order.unitType, ud.name), ud.buildTimeTicks)
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
      if (b && b.researching !== '') {
        const up = getUpgrade(b.researching, world.settings)
        const scroll = document.createElement('div')
        scroll.className = 'queue-scroll'
        this.buildMenu.appendChild(scroll)
        this.addResearchCard(scroll, tn(up.id, up.name), () => world.buildings.get(bd.id)?.researchTicks ?? 0, up.researchTimeTicks)
        continue
      }
      for (const up of ups) {
        const upDef = getUpgrade(up.id, world.settings)
        if (up.id === 'space-laser') {
          const maxLv = world.laserMaxLevel()
          const lv = world.laserLevel(bd.team)
          if (lv >= maxLv) continue
          const upCost = world.laserUpgradeCost(bd.team, upDef.cost)
          const tag = t('tools.laserLevel', { lv: lv + 1 })
          this.addButton(
            `${tn(up.id, upDef.name)} (${tag}) <span class="cost">$${upCost}</span>`,
            () => {
              const ts2 = world.teamState(bd.team)
              if (ts2.credits < upCost) return false
              const b2 = world.buildings.get(bd.id)
              if (!b2 || !b2.done) return false
              if (b2.researching !== '') return false
              if (world.laserLevel(bd.team) >= maxLv) return false
              return true
            },
            () => this.actions.onResearchClick(up.id),
          )
          continue
        }
        const upCost = upDef.cost
        this.addButton(
          `${tn(up.id, upDef.name)} <span class="cost">$${upCost}</span>`,
          () => {
            const ts2 = world.teamState(bd.team)
            if (ts2.credits < upCost) return false
            const b2 = world.buildings.get(bd.id)
            if (!b2 || !b2.done) return false
            if (b2.researching !== '') return false
            if (up.id === 'radar' && ts2.radar) return false
            if (up.id === 'satellite' && ts2.satellite) return false
            return true
          },
          () => this.actions.onResearchClick(up.id),
        )
      }
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
      this.menuSlots.push({
        enabled: () => {
          const bb = world.buildings.get(bd.id)
          const hh = world.healths.get(bd.id)
          if (!bb || !bb.done) return false
          if (bb.maxPowerUntil > world.tick) return false
          return !!hh && hh.hp >= hh.maxHp
        },
        act: () => this.actions.onMaxPowerClick([bd.id]),
      })
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
          `${tn(bd.id, bd.name)} <span class="cost">$${bd.cost}</span>`,
          () => {
            const ts = world.teamState(localTeam)
            if (ts.credits < bd.cost) return false
            if (bd.countLimit !== undefined && this.countBuilding(world, bd.id, localTeam) >= bd.countLimit) return false
            return true
          },
          () => this.actions.onBuildClick(bd.id),
        )
      }
    }

    if (!anySection) {
      this.hideBuildMenu()
      return
    }
    this.buildMenu.classList.add('visible')
    for (const updater of this.updaters) updater()
  }

  private addButton(label: string, isEnabled: () => boolean, onClick: () => void, className?: string): void {
    const b = document.createElement('button')
    b.innerHTML = label
    if (className) b.classList.add(className)
    b.addEventListener('click', onClick)
    this.buildMenu.appendChild(b)
    this.menuSlots.push({ enabled: isEnabled, act: onClick })
    this.updaters.push(() => {
      b.disabled = !isEnabled()
    })
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

  private addToggleButton(label: string, onToggle: () => void, isActive: () => boolean): void {
    const b = document.createElement('button')
    b.innerHTML = label
    b.addEventListener('click', onToggle)
    this.buildMenu.appendChild(b)
    this.menuSlots.push({ enabled: () => true, act: onToggle })
    this.updaters.push(() => {
      b.classList.toggle('active', isActive())
    })
  }

  hudShortcut(n: number): boolean {
    if (!this.buildMenu.classList.contains('visible')) return false
    const slot = this.menuSlots[n - 1]
    if (!slot) return false
    if (!slot.enabled()) return true
    slot.act()
    return true
  }

  private addQueueCard(parent: HTMLElement, buildingId: number, index: number, order: ProductionOrder, name: string, totalTicks: number): void {
    const btn = document.createElement('button')
    btn.className = 'queue-card'
    const label = document.createElement('span')
    label.className = 'qc-label'
    label.textContent = name
    const bar = document.createElement('span')
    bar.className = 'qc-bar'
    const fill = document.createElement('span')
    fill.className = 'qc-fill'
    bar.appendChild(fill)
    btn.appendChild(label)
    btn.appendChild(bar)
    btn.title = t('hud.queueCancel')
    btn.addEventListener('click', () => this.actions.onDequeueClick(buildingId, index))
    parent.appendChild(btn)
    this.updaters.push(() => {
      const p = index === 0 ? Math.max(0, Math.min(1, 1 - order.remainingTicks / totalTicks)) : 0
      fill.style.width = `${(p * 100).toFixed(1)}%`
    })
  }

  private addResearchCard(parent: HTMLElement, name: string, getRemaining: () => number, totalTicks: number): void {
    const card = document.createElement('button')
    card.type = 'button'
    card.className = 'queue-card'
    const label = document.createElement('span')
    label.className = 'qc-label'
    label.textContent = name
    const bar = document.createElement('span')
    bar.className = 'qc-bar'
    const fill = document.createElement('span')
    fill.className = 'qc-fill research'
    bar.appendChild(fill)
    card.appendChild(label)
    card.appendChild(bar)
    card.title = t('hud.researchProgress')
    parent.appendChild(card)
    this.updaters.push(() => {
      const p = Math.max(0, Math.min(1, 1 - getRemaining() / totalTicks))
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
    setTimeout(() => el.remove(), 4000)
  }
}
