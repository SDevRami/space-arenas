import { ACHIEVEMENTS } from './achievements.ts'
import { achievementTarget, countFor, loadProfile, loadProfileConfig, resetProfile, totalScore, unlockedCount, updateProfileName, type Profile } from './profile.ts'
import { t } from '../i18n/index.ts'

let lastRender = 0
let lastUsername = ''

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const fmt = (n: number): string => n.toLocaleString('en-US')

const winRate = (wins: number, matches: number): string => (matches > 0 ? `${Math.round((wins / matches) * 100)}%` : '—')

/** Day 15: player-card hexagon radar chart. Each axis is a battle stat,
 * normalized against a fixed cap so the shape stays readable from the start. */
const HEX_AXES: { key: string; cap: number; color: string }[] = [
  { key: 'profile.hex.combat', cap: 150, color: '#ffd75e' },
  { key: 'profile.hex.economy', cap: 8000, color: '#4ad8ff' },
  { key: 'profile.hex.army', cap: 300, color: '#7cf27c' },
  { key: 'profile.hex.expansion', cap: 60, color: '#ff9d5c' },
  { key: 'profile.hex.research', cap: 30, color: '#c9a53a' },
  { key: 'profile.hex.intel', cap: 60, color: '#b77cff' },
]

const hexChart = (profile: Profile): string => {
  const c = profile.counters
  const research = Object.values(profile.typeCounts.upgradesResearched).reduce((a, b) => a + b, 0)
  const values = [
    c.kills, // combat
    c.supplyHarvested, // economy
    c.unitsTrained, // army
    c.buildingsBuilt, // expansion
    research, // research
    c.satelliteScans + c.laserStrikes + c.airstrikes + c.empStrikes, // intel
  ]
  const frac = values.map((v, i) => Math.min(1, v / HEX_AXES[i].cap))
  const cx = 110
  const cy = 110
  const r = 80
  const pt = (t: number, i: number): [number, number] => {
    const ang = (Math.PI / 180) * (-90 + i * 60)
    return [cx + Math.cos(ang) * r * t, cy + Math.sin(ang) * r * t]
  }
  const ring = (t: number): string => Array.from({ length: 6 }, (_, i) => `${pt(t, i)[0].toFixed(1)},${pt(t, i)[1].toFixed(1)}`).join(' ')
  const data = Array.from({ length: 6 }, (_, i) => `${pt(frac[i], i)[0].toFixed(1)},${pt(frac[i], i)[1].toFixed(1)}`).join(' ')
  const spokes = Array.from({ length: 6 }, (_, i) => `M${cx},${cy} L${pt(1, i)[0].toFixed(1)},${pt(1, i)[1].toFixed(1)}`).join(' ')
  const legend = HEX_AXES.map((ax, i) => `
      <div class="hex-axis">
        <span class="hex-axis-dot" style="background:${ax.color}"></span>
        <label>${esc(t(ax.key))}</label>
        <span class="hex-axis-value">${fmt(values[i])}</span>
      </div>`).join('')
  // Small colored dots sit on each plotted value so every axis stat is marked
  // in the chart itself, matching the legend colors.
  const valueDots = Array.from({ length: 6 }, (_, i) => {
    const [px, py] = pt(frac[i], i)
    return `<circle class="hex-value-dot" cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="3.5" fill="${HEX_AXES[i].color}" />`
  }).join('')
  return `
    <div class="profile-hex-wrap">
      <div class="profile-hex-title">${esc(t('profile.radarChart'))}</div>
      <svg class="profile-hex" viewBox="0 0 220 220" role="img" aria-label="${esc(t('profile.radarChart'))}">
        <polygon points="${ring(0.33)}" class="hex-guide" />
        <polygon points="${ring(0.66)}" class="hex-guide" />
        <polygon points="${ring(1)}" class="hex-guide" />
        <path d="${spokes}" class="hex-spoke" />
        <polygon points="${data}" class="hex-data" />
        ${valueDots}
      </svg>
      <div class="profile-hex-legend">${legend}</div>
    </div>
  `
}

const renderSummary = (): string => {
  const profile = loadProfile(window.localStorage)
  const c = profile.counters
  const seconds = profile.history.reduce((sum, r) => sum + r.durationSec, 0)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return `
    <div class="profile-card">
      <div class="profile-card-left">
        <div class="profile-name">${esc(profile.name)}</div>
        <div class="profile-total"><span>${fmt(totalScore(profile))}</span><label>${t('profile.totalScore')}</label></div>
      </div>
      ${hexChart(profile)}
    </div>
    <div class="profile-stats">
      <div><span>${fmt(c.gamesPlayed)}</span><label>${t('profile.games')}</label></div>
      <div><span>${fmt(c.wins)}</span><label>${t('profile.wins')}</label></div>
      <div><span>${fmt(c.losses)}</span><label>${t('profile.losses')}</label></div>
      <div><span>${winRate(c.wins, c.gamesPlayed)}</span><label>${t('profile.winRate')}</label></div>
      <div><span>${fmt(c.spectatedMatches)}</span><label>${t('profile.spectated')}</label></div>
      <div><span>${fmt(c.kills)}</span><label>${t('profile.kills')}</label></div>
      <div><span>${fmt(c.supplyHarvested)}</span><label>${t('profile.supplies')}</label></div>
      <div><span>${fmt(c.unitsTrained)}</span><label>${t('profile.unitsTrained')}</label></div>
      <div><span>${fmt(c.buildingsBuilt)}</span><label>${t('profile.buildingsBuilt')}</label></div>
      <div><span>${fmt(unlockedCount(profile))} / ${ACHIEVEMENTS.length}</span><label>${t('profile.unlocked')}</label></div>
      <div><span>${hours}h ${minutes}m</span><label>${t('profile.timePlayed')}</label></div>
    </div>
  `
}

/** Achievement list markup rendered into the profile panel. */
const achievementsMarkup = (profile: Profile, config: ReturnType<typeof loadProfileConfig>): string => {
  const groups: { id: string; items: string[] }[] = []
  for (const def of ACHIEVEMENTS) {
    let g = groups.find((x) => x.id === def.group)
    if (!g) {
      g = { id: def.group, items: [] }
      groups.push(g)
    }
    const current = countFor(profile, def)
    const target = achievementTarget(config, def)
    const unlocked = profile.achievements[def.id] !== undefined
    const pct = Math.min(100, Math.round((current / target) * 100))
    const when = unlocked ? new Date(profile.achievements[def.id].unlockedAt).toLocaleDateString() : ''
    g.items.push(`
      <div class="achievement ${unlocked ? 'unlocked' : ''}">
        <div class="achievement-main">
          <span class="achievement-name">${unlocked ? '✓ ' : ''}${esc(t(def.nameKey))}</span>
          <span class="achievement-desc">${esc(t(def.descKey))}</span>
          ${when ? `<span class="achievement-when">${when}</span>` : ''}
        </div>
        <div class="achievement-bar"><div class="bar" style="width:${unlocked ? 100 : pct}%"></div></div>
        <span class="achievement-count">${fmt(current)}/${fmt(target)}</span>
      </div>
    `)
  }
  return groups
    .map((g) => `<h2 class="profile-group" data-i18n="profile.group.${g.id}">${esc(t(`profile.group.${g.id}`))}</h2>${g.items.join('')}`)
    .join('')
}

const renderAchievements = (): string => {
  const profile = loadProfile(window.localStorage)
  const config = loadProfileConfig(window.localStorage)
  return achievementsMarkup(profile, config)
}

/** Re-render the profile panel contents (stats + achievements). Pure DOM update. */
export const renderProfilePanel = (): void => {
  const summary = document.getElementById('profile-summary')
  const list = document.getElementById('profile-achievements')
  if (summary) summary.innerHTML = renderSummary()
  if (list) list.innerHTML = renderAchievements()
  const nameInput = document.getElementById('profile-username') as HTMLInputElement | null
  if (nameInput) {
    const name = loadProfile(window.localStorage).name
    if (name !== lastUsername) {
      lastUsername = name
      nameInput.value = name
    }
  }
  lastRender = performance.now()
}

/** Called when the Profile tab is opened — re-renders so counters are fresh. */
export const onProfileTabShown = (): void => {
  if (lastRender + 1000 >= performance.now()) return
  renderProfilePanel()
}

/** Wire the reset button, username field, and the player-card popup once. */
export const initProfilePanel = (onNameSaved?: (name: string) => void): void => {
  const resetBtn = document.getElementById('profile-reset') as HTMLButtonElement | null
  resetBtn?.addEventListener('click', () => {
    const name = prompt(t('profile.prompt'))?.trim()
    resetProfile(window.localStorage, name || undefined)
    renderProfilePanel()
  })
  const nameInput = document.getElementById('profile-username') as HTMLInputElement | null
  nameInput?.addEventListener('change', () => {
    const profile = updateProfileName(window.localStorage, loadProfile(window.localStorage), nameInput.value)
    renderProfilePanel()
    onNameSaved?.(profile.name)
  })
}