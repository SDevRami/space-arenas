import { t } from '../i18n/index.ts'
import {
  getAudio,
  setMaster,
  setEffects,
  setAmbient,
  setMuted,
  setAmbientEnabled,
  setHaptics,
  effectsVolume,
  ambientVolume,
} from '../audio/settings.ts'

// ---------- audio settings ----------

const audioStatusEl = document.getElementById('audio-status') as HTMLElement
const audioListEl = document.getElementById('audio-settings') as HTMLElement
let summaryEl: HTMLElement | null = null

const setAudioStatus = (text: string): void => {
  if (audioStatusEl) audioStatusEl.textContent = text
}

const refreshEffective = (): void => {
  if (summaryEl) summaryEl.textContent = t('settings.audio.effective', { e: pct(effectsVolume()), a: pct(ambientVolume()) })
}

const pct = (v: number): number => Math.round(v * 100)

export const renderSliderRow = (labelKey: string, descKey: string, value: number, onInput: (v: number) => void): HTMLElement => {
  const div = document.createElement('div')
  div.className = 'ctrl-row'
  const label = document.createElement('div')
  label.className = 'ctrl-label'
  const name = document.createElement('div')
  name.textContent = t(labelKey)
  const desc = document.createElement('div')
  desc.className = 'ctrl-desc'
  desc.textContent = t(descKey)
  label.appendChild(name)
  label.appendChild(desc)
  div.appendChild(label)
  const slider = document.createElement('input')
  slider.type = 'range'
  slider.min = '0'
  slider.max = '100'
  slider.step = '1'
  slider.value = String(pct(value))
  slider.className = 'ctrl-range'
  const val = document.createElement('span')
  val.className = 'ctrl-val'
  val.textContent = `${pct(value)}%`
  slider.addEventListener('input', () => {
    onInput(Number(slider.value) / 100)
    val.textContent = `${slider.value}%`
    refreshEffective()
    setAudioStatus(t('settings.audio.saved'))
  })
  const wrap = document.createElement('div')
  wrap.className = 'ctrl-range-wrap'
  wrap.appendChild(slider)
  wrap.appendChild(val)
  div.appendChild(wrap)
  return div
}

const renderToggleRow = (labelKey: string, descKey: string, current: () => boolean, onChange: (next: boolean) => void): HTMLElement => {
  const div = document.createElement('div')
  div.className = 'ctrl-row'
  const label = document.createElement('div')
  label.className = 'ctrl-label'
  const name = document.createElement('div')
  name.textContent = t(labelKey)
  const desc = document.createElement('div')
  desc.className = 'ctrl-desc'
  desc.textContent = t(descKey)
  label.appendChild(name)
  label.appendChild(desc)
  div.appendChild(label)
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = `btn small ${current() ? 'on' : 'off'}`
  btn.textContent = current() ? t('settings.audio.on') : t('settings.audio.off')
  const setBtnState = (next: boolean): void => {
    btn.className = `btn small ${next ? 'on' : 'off'}`
    btn.textContent = next ? t('settings.audio.on') : t('settings.audio.off')
  }
  btn.addEventListener('click', () => {
    const next = !current()
    onChange(next)
    setBtnState(next)
    refreshEffective()
    setAudioStatus(t('settings.audio.saved'))
  })
  div.appendChild(btn)
  return div
}

const renderAudioList = (): void => {
  if (!audioListEl) return
  const a = getAudio()
  audioListEl.innerHTML = ''
  audioListEl.appendChild(
    renderSliderRow('settings.audio.master', 'settings.audio.masterDesc', a.master, (v) => setMaster(v)),
  )
  audioListEl.appendChild(
    renderSliderRow('settings.audio.effects', 'settings.audio.effectsDesc', a.effects, (v) => setEffects(v)),
  )
  audioListEl.appendChild(
    renderSliderRow('settings.audio.ambient', 'settings.audio.ambientDesc', a.ambient, (v) => setAmbient(v)),
  )
  audioListEl.appendChild(
    renderToggleRow('settings.audio.muted', 'settings.audio.mutedDesc', () => getAudio().muted, (v) => setMuted(v)),
  )
  audioListEl.appendChild(
    renderToggleRow('settings.audio.ambientOn', 'settings.audio.ambientOnDesc', () => getAudio().ambientEnabled, (v) => setAmbientEnabled(v)),
  )
  audioListEl.appendChild(
    renderToggleRow('settings.audio.haptics', 'settings.audio.hapticsDesc', () => getAudio().haptics, (v) => setHaptics(v)),
  )
  const summary = document.createElement('div')
  summary.className = 'hint'
  summaryEl = summary
  refreshEffective()
  audioListEl.appendChild(summary)
}

export const initAudioSettings = (): { renderAudioList: () => void } => {
  renderAudioList()
  return { renderAudioList }
}
