import { PLAYER_COLORS } from '@space-arenas/shared'
import type { SimEvent } from '../core/events.ts'
import type { MatchSlot } from '../game/match.ts'
import { t } from '../i18n/index.ts'

export interface TeamStats {
  unitsBuilt: number
  buildingsBuilt: number
  unitsLost: number
  buildingsLost: number
  kills: number
  damageDealt: number
  supplyHarvested: number
}

const EMPTY: TeamStats = { unitsBuilt: 0, buildingsBuilt: 0, unitsLost: 0, buildingsLost: 0, kills: 0, damageDealt: 0, supplyHarvested: 0 }

export class StatsTracker {
  private readonly stats = new Map<number, TeamStats>()
  private readonly lastAttacker = new Map<number, number>()

  private state(team: number): TeamStats {
    let s = this.stats.get(team)
    if (!s) {
      s = { ...EMPTY }
      this.stats.set(team, s)
    }
    return s
  }

  track(e: SimEvent): void {
    switch (e.type) {
      case 'unit-trained':
        this.state(e.team).unitsBuilt++
        break
      case 'building-placed':
        this.state(e.team).buildingsBuilt++
        break
      case 'combat-hit':
        this.state(e.team).damageDealt += e.damage
        this.lastAttacker.set(e.target, e.team)
        break
      case 'supply-harvested':
        this.state(e.team).supplyHarvested += e.amount
        break
      case 'entity-destroyed': {
        const attacker = this.lastAttacker.get(e.entity)
        if (attacker !== undefined) this.state(attacker).kills++
        if (e.kind === 'unit') this.state(e.team).unitsLost++
        else if (e.kind === 'building') this.state(e.team).buildingsLost++
        break
      }
      default:
        break
    }
  }

  snapshot(teams: number[]): Map<number, TeamStats> {
    const out = new Map<number, TeamStats>()
    for (const t of teams) out.set(t, this.state(t))
    return out
  }
}

export interface StatsRow {
  team: number
  alliance: number
  name: string
  sub: string
  unitsBuilt: number
  buildingsBuilt: number
  kills: number
  losses: number
  damageDealt: number
  supplyHarvested: number
}

const teamHex = (team: number): string => {
  const c = PLAYER_COLORS[((team % PLAYER_COLORS.length) + PLAYER_COLORS.length) % PLAYER_COLORS.length]
  return `#${c.toString(16).padStart(6, '0')}`
}

export class StatsBoard {
  constructor(private readonly root: HTMLElement) {}

  show(title: string, rows: StatsRow[]): void {
    this.root.classList.add('visible')
    this.root.innerHTML = ''
    const h = document.createElement('h2')
    h.textContent = title
    this.root.appendChild(h)

    const table = document.createElement('div')
    table.className = 'stats-table'
    const header = document.createElement('div')
    header.className = 'stats-row stats-header'
    for (const col of ['player', 'units', 'buildings', 'kills', 'losses', 'damage', 'supply'] as const) {
      const cell = document.createElement('span')
      cell.className = 'stats-cell'
      cell.textContent = t(`stats.headers.${col}`)
      header.appendChild(cell)
    }
    table.appendChild(header)

    const groups = rows.slice().sort((a, b) => a.alliance - b.alliance)
    let prevAlliance: number | null = null
    for (const r of groups) {
      if (r.alliance !== prevAlliance) {
        prevAlliance = r.alliance
        const sep = document.createElement('div')
        sep.className = 'stats-team'
        sep.textContent = t('stats.team', { n: r.alliance + 1 })
        table.appendChild(sep)
      }
      const rowEl = document.createElement('div')
      rowEl.className = 'stats-row'
      const name = document.createElement('span')
      name.className = 'stats-cell stats-name'
      const dot = document.createElement('span')
      dot.className = 'stats-dot'
      dot.style.background = teamHex(r.team)
      name.appendChild(dot)
      const label = document.createElement('span')
      label.textContent = r.name
      name.appendChild(label)
      if (r.sub) {
        const sub = document.createElement('span')
        sub.className = 'stats-sub'
        sub.textContent = r.sub
        label.appendChild(sub)
      }
      rowEl.appendChild(name)
      for (const v of [r.unitsBuilt, r.buildingsBuilt, r.kills, r.losses, r.damageDealt, r.supplyHarvested]) {
        const cell = document.createElement('span')
        cell.className = 'stats-cell'
        cell.textContent = String(v)
        rowEl.appendChild(cell)
      }
      table.appendChild(rowEl)
    }
    this.root.appendChild(table)
  }

  hide(): void {
    this.root.classList.remove('visible')
  }
}

export const buildStatsRows = (slots: MatchSlot[], snapshot: Map<number, TeamStats>): StatsRow[] =>
  slots.map((s) => {
    const teamStats = snapshot.get(s.team) ?? EMPTY
    return {
      team: s.team,
      alliance: s.alliance ?? s.team,
      name: s.name,
      sub: s.difficulty ? t('stats.subBot', { d: t(`difficulty.${s.difficulty}`) }) : t('stats.player'),
      unitsBuilt: teamStats.unitsBuilt,
      buildingsBuilt: teamStats.buildingsBuilt,
      kills: teamStats.kills,
      losses: teamStats.unitsLost + teamStats.buildingsLost,
      damageDealt: teamStats.damageDealt,
      supplyHarvested: teamStats.supplyHarvested,
    }
  })
