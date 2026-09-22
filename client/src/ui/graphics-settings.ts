import { t } from '../i18n/index.ts'
import {
  EFFECT_ROWS,
  WEATHERS,
  QUALITIES,
  type GraphicsQuality,
  type WeatherId,
  getGraphics,
  setEffect,
  setQuality,
  setWeather,
  setHudIconSize,
  setUiScale,
  effectEnabled,
} from './graphics.ts'

// ---------- graphics settings ----------

const graphicsQualityEl = document.getElementById('graphics-quality-line') as HTMLElement
const graphicsEffectsEl = document.getElementById('graphics-effects') as HTMLElement
const graphicsStatusEl = document.getElementById('graphics-status') as HTMLElement
const startWeatherEl = document.getElementById('start-weather') as HTMLSelectElement
const matchWeatherEl = document.getElementById('match-weather') as HTMLSelectElement

const setGraphicsStatus = (text: string): void => {
  graphicsStatusEl.textContent = text
}

const renderWeatherRow = (): HTMLElement => {
  const g = getGraphics()
  const div = document.createElement('div')
  div.className = 'ctrl-row'
  const label = document.createElement('div')
  label.className = 'ctrl-label'
  const name = document.createElement('div')
  name.textContent = t('settings.graphics.weather')
  const desc = document.createElement('div')
  desc.className = 'ctrl-desc'
  desc.textContent = t('settings.graphics.weatherHint')
  label.appendChild(name)
  label.appendChild(desc)
  div.appendChild(label)
  const chips = document.createElement('div')
  chips.className = 'ctrl-chips'
  for (const id of WEATHERS) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = `btn small ${g.weather === id ? 'on' : 'off'}`
    btn.textContent = t(`weather.${id}`)
    btn.addEventListener('click', () => applyWeatherSelection(id))
    chips.appendChild(btn)
  }
  div.appendChild(chips)
  return div
}

const renderIconSizeRow = (): HTMLElement => {
  const div = document.createElement('div')
  div.className = 'ctrl-row'
  const label = document.createElement('div')
  label.className = 'ctrl-label'
  const name = document.createElement('div')
  name.textContent = t('settings.graphics.iconSize')
  const desc = document.createElement('div')
  desc.className = 'ctrl-desc'
  desc.textContent = t('settings.graphics.iconSizeDesc')
  label.appendChild(name)
  label.appendChild(desc)
  div.appendChild(label)
  const input = document.createElement('input')
  input.type = 'number'
  input.min = '8'
  input.max = '64'
  input.step = '1'
  input.value = String(getGraphics().hudIconSize)
  input.className = 'ctrl-number'
  input.addEventListener('change', () => {
    const v = Number(input.value)
    setHudIconSize(Number.isFinite(v) ? v : 20)
    input.value = String(getGraphics().hudIconSize)
    renderGraphicsList()
    setGraphicsStatus(t('settings.graphics.saved'))
  })
  div.appendChild(input)
  return div
}

// Every top-level game-UI container except the Pixi canvas. In-match panels live inside
// #hud, so zooming it covers menu/dev/confirm/selection too; the rest are the standalone
// overlays and the whole lobby (settings, map builder, net dialogs) — all scale together.
const UI_SCALE_TARGETS = [
  'hud',
  'cinematic-overlay',
  'results-overlay',
  'groups-overlay',
  'countdown-overlay',
  'reconnect-overlay',
  'roomfull-overlay',
  'lobby',
  'create-overlay',
  'invite-overlay',
  'controls-overlay',
  'controls-info-overlay',
  'err-box',
]

/** Applies the user's UI-size setting to every game-UI overlay plus the lobby. */
const applyUiScale = (): void => {
  const v = getGraphics().uiScale
  for (const id of UI_SCALE_TARGETS) {
    const el = document.getElementById(id)
    if (el) el.style.zoom = String(v)
  }
}

const renderUiScaleRow = (): HTMLElement => {
  const div = document.createElement('div')
  div.className = 'ctrl-row'
  const label = document.createElement('div')
  label.className = 'ctrl-label'
  const name = document.createElement('div')
  name.textContent = t('settings.graphics.uiScale')
  const desc = document.createElement('div')
  desc.className = 'ctrl-desc'
  desc.textContent = t('settings.graphics.uiScaleDesc')
  label.appendChild(name)
  label.appendChild(desc)
  div.appendChild(label)
  const input = document.createElement('input')
  input.type = 'number'
  input.min = '0.5'
  input.max = '1.5'
  input.step = '0.05'
  input.value = String(getGraphics().uiScale)
  input.className = 'ctrl-number'
  input.addEventListener('change', () => {
    const v = Number(input.value)
    setUiScale(Number.isFinite(v) ? v : 0.8)
    input.value = String(getGraphics().uiScale)
    applyUiScale()
    renderGraphicsList()
    setGraphicsStatus(t('settings.graphics.saved'))
  })
  div.appendChild(input)
  return div
}

const renderGraphicsList = (): void => {
  const g = getGraphics()
  graphicsQualityEl.textContent = t('settings.graphics.qualityLine', {
    q: t(`settings.graphics.quality.${g.quality}`),
  })
  graphicsEffectsEl.innerHTML = ''
  const qualityRow = document.createElement('div')
  qualityRow.className = 'ctrl-row'
  const qLabel = document.createElement('div')
  qLabel.className = 'ctrl-label'
  const qName = document.createElement('div')
  qName.textContent = t('settings.graphics.qualityLabel')
  const qDesc = document.createElement('div')
  qDesc.className = 'ctrl-desc'
  qDesc.textContent = t('settings.graphics.qualityDesc')
  qLabel.appendChild(qName)
  qLabel.appendChild(qDesc)
  qualityRow.appendChild(qLabel)
  const qChips = document.createElement('div')
  qChips.className = 'ctrl-chips'
  for (const q of QUALITIES) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = `btn small ${g.quality === q ? 'on' : 'off'}`
    btn.textContent = t(`settings.graphics.quality.${q}`)
    btn.addEventListener('click', () => applyQualitySelection(q))
    qChips.appendChild(btn)
  }
  qualityRow.appendChild(qChips)
  graphicsEffectsEl.appendChild(qualityRow)
  for (const row of EFFECT_ROWS) {
    const div = document.createElement('div')
    div.className = 'ctrl-row'
    const label = document.createElement('div')
    label.className = 'ctrl-label'
    const name = document.createElement('div')
    name.textContent = t(row.labelKey)
    const desc = document.createElement('div')
    desc.className = 'ctrl-desc'
    desc.textContent = t(row.descKey)
    label.appendChild(name)
    label.appendChild(desc)
    div.appendChild(label)
    const on = effectEnabled(row.id)
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = `btn small ${on ? 'on' : 'off'}`
    btn.textContent = on ? t('settings.graphics.on') : t('settings.graphics.off')
    const setBtnState = (next: boolean): void => {
      btn.className = `btn small ${next ? 'on' : 'off'}`
      btn.textContent = next ? t('settings.graphics.on') : t('settings.graphics.off')
    }
    btn.addEventListener('click', () => {
      const next = !effectEnabled(row.id)
      setEffect(row.id, next)
      setBtnState(next)
      setGraphicsStatus(t('settings.graphics.saved'))
    })
    div.appendChild(btn)
    graphicsEffectsEl.appendChild(div)
  }
  graphicsEffectsEl.appendChild(renderWeatherRow())
  graphicsEffectsEl.appendChild(renderIconSizeRow())
  graphicsEffectsEl.appendChild(renderUiScaleRow())
  applyUiScale()
}

const renderWeatherOptions = (select: HTMLSelectElement): void => {
  select.innerHTML = ''
  for (const id of WEATHERS) {
    const opt = document.createElement('option')
    opt.value = id
    opt.textContent = t(`weather.${id}`)
    select.appendChild(opt)
  }
  select.value = getGraphics().weather
}

const syncWeatherSelects = (): void => {
  for (const el of [startWeatherEl, matchWeatherEl]) {
    if (el) el.value = getGraphics().weather
  }
}

const applyWeatherSelection = (value: WeatherId): void => {
  if (!WEATHERS.includes(value)) return
  setWeather(value)
  syncWeatherSelects()
  renderGraphicsList()
  setGraphicsStatus(t('settings.graphics.saved'))
}

const applyQualitySelection = (q: GraphicsQuality): void => {
  if (!QUALITIES.includes(q)) return
  setQuality(q)
  renderGraphicsList()
  setGraphicsStatus(t('settings.graphics.saved'))
}

export const initGraphicsSettings = (): {
  renderGraphicsList: () => void
  renderWeatherOptions: (select: HTMLSelectElement) => void
  startWeatherEl: HTMLSelectElement
  matchWeatherEl: HTMLSelectElement
} => {
  renderGraphicsList()
  renderWeatherOptions(startWeatherEl)
  renderWeatherOptions(matchWeatherEl)
  startWeatherEl.addEventListener('change', () => applyWeatherSelection(startWeatherEl.value as WeatherId))
  matchWeatherEl.addEventListener('change', () => applyWeatherSelection(matchWeatherEl.value as WeatherId))

  return { renderGraphicsList, renderWeatherOptions, startWeatherEl, matchWeatherEl }
}
