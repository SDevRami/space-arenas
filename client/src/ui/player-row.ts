import type { BotDifficulty } from '../ai/bot.ts'
import { t } from '../i18n/index.ts'

export interface PlayerRowConfig {
  maxPlayers: number
  team: number
  spawn: number
  color: number
  palette: string[]
  name: string
  nameTitle?: string
  isBot: boolean
  difficulty?: BotDifficulty
  editable: boolean
  showYouBadge: boolean
  teamLabel: (n: number) => string
  spawnLabel: (n: number) => string
  teamTitle: string
  spawnTitle: string
  colorTitle: string
  onTeamChange: (v: number) => void
  onSpawnChange: (v: number) => void
  onColorChange: (v: number) => void
  onNameChange: (name: string) => void
  nameDebounceMs?: number
  onNameImmediate?: (name: string) => void
  nameMaxLength?: number
  diffDisabled?: boolean
  onDifficultyChange?: (d: BotDifficulty) => void
  onRemove?: () => void
}

function buildColorPicker(
  className: string,
  title: string,
  palette: string[],
  current: number,
  editable: boolean,
  onChange: (v: number) => void,
): HTMLDivElement {
  const wrap = document.createElement('div')
  wrap.className = className
  wrap.title = title
  wrap.style.display = 'flex'
  wrap.style.gap = '3px'
  wrap.style.alignItems = 'center'
  if (!editable) {
    const dot = document.createElement('span')
    dot.style.width = '14px'
    dot.style.height = '14px'
    dot.style.borderRadius = '50%'
    dot.style.border = '1px solid rgba(255,255,255,0.5)'
    dot.style.background = palette[((current % palette.length) + palette.length) % palette.length] ?? '#888'
    wrap.appendChild(dot)
    return wrap
  }
  palette.forEach((hex, i) => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.title = `${title} ${i + 1}`
    btn.style.width = '16px'
    btn.style.height = '16px'
    btn.style.borderRadius = '50%'
    btn.style.border = i === current ? '2px solid #ffffff' : '1px solid rgba(255,255,255,0.4)'
    btn.style.background = hex
    btn.style.cursor = 'pointer'
    btn.style.padding = '0'
    btn.style.flex = '0 0 auto'
    btn.addEventListener('click', () => onChange(i))
    wrap.appendChild(btn)
  })
  return wrap
}

function buildSelect(
  className: string,
  title: string,
  max: number,
  current: number,
  label: (n: number) => string,
  editable: boolean,
  onChange: (v: number) => void,
): HTMLSelectElement | HTMLSpanElement {
  if (!editable) {
    const span = document.createElement('span')
    span.className = className
    span.textContent = label(current + 1)
    return span
  }
  const sel = document.createElement('select')
  sel.className = className
  sel.title = title
  for (let i = 0; i < max; i++) {
    const opt = document.createElement('option')
    opt.value = String(i)
    opt.textContent = label(i + 1)
    if (i === current) opt.selected = true
    sel.appendChild(opt)
  }
  sel.addEventListener('change', () => onChange(Number(sel.value)))
  return sel
}

export function createPlayerRow(cfg: PlayerRowConfig): HTMLDivElement {
  const div = document.createElement('div')
  div.className = 'player-row'

  div.appendChild(buildSelect('p-team', cfg.teamTitle, cfg.maxPlayers, cfg.team, cfg.teamLabel, cfg.editable, cfg.onTeamChange))
  div.appendChild(buildSelect('p-spawn', cfg.spawnTitle, cfg.maxPlayers, cfg.spawn, cfg.spawnLabel, cfg.editable, cfg.onSpawnChange))
  div.appendChild(buildColorPicker('p-colors', cfg.colorTitle, cfg.palette, cfg.color, cfg.editable, cfg.onColorChange))

  const name = document.createElement('input')
  name.className = 'p-name'
  if (cfg.nameMaxLength) name.maxLength = cfg.nameMaxLength
  name.value = cfg.name
  if (cfg.nameTitle) name.title = cfg.nameTitle
  if (!cfg.editable) name.readOnly = true
  let debounce: number | null = null
  const delay = cfg.nameDebounceMs ?? 400
  name.addEventListener('input', () => {
    if (debounce !== null) clearTimeout(debounce)
    debounce = window.setTimeout(() => {
      const trimmed = name.value.trim()
      if (trimmed) cfg.onNameChange(trimmed)
    }, delay)
  })
  name.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      if (debounce !== null) clearTimeout(debounce)
      const trimmed = name.value.trim()
      if (trimmed) (cfg.onNameImmediate ?? cfg.onNameChange)(trimmed)
      name.blur()
    }
  })
  div.appendChild(name)

  if (cfg.isBot) {
    if (cfg.onDifficultyChange) {
      const diff = document.createElement('select')
      diff.className = 'p-diff'
      diff.title = t('match.botDifficultyTitle')
      if (cfg.diffDisabled) diff.disabled = true
      for (const d of ['easy', 'medium', 'hard'] as const) {
        const opt = document.createElement('option')
        opt.value = d
        opt.textContent = t(`difficulty.${d}`)
        if (d === (cfg.difficulty ?? 'medium')) opt.selected = true
        diff.appendChild(opt)
      }
      diff.addEventListener('change', () => cfg.onDifficultyChange!(diff.value as BotDifficulty))
      div.appendChild(diff)
    }
    if (cfg.onRemove) {
      const remove = document.createElement('button')
      remove.textContent = '×'
      remove.title = t('match.removeBot')
      remove.addEventListener('click', cfg.onRemove)
      div.appendChild(remove)
    }
  } else if (cfg.showYouBadge) {
    const badge = document.createElement('span')
    badge.className = 'you-badge'
    badge.textContent = t('match.you')
    div.appendChild(badge)
  }

  return div
}
