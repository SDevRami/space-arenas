import { ACHIEVEMENTS } from './achievements.ts'
import { achievementTarget, countFor, loadProfile, loadProfileConfig, resetProfile, unlockedCount, updateProfileName } from './profile.ts'
import { t } from '../i18n/index.ts'

let lastRender = 0
let lastUsername = ''

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const fmt = (n: number): string => n.toLocaleString('en-US')

const winRate = (wins: number, matches: number): string => (matches > 0 ? `${Math.round((wins / matches) * 100)}%` : '—')

const renderSummary = (): string => {
  const profile = loadProfile(window.localStorage)
  const c = profile.counters
  const seconds = profile.history.reduce((sum, r) => sum + r.durationSec, 0)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return `
    <div class="profile-name">${esc(profile.name)}</div>
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

const renderAchievements = (): string => {
  const profile = loadProfile(window.localStorage)
  const config = loadProfileConfig(window.localStorage)
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

/** Wire the reset button and the username field once. */
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