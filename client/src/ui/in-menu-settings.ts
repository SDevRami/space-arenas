import { t } from '../i18n/index.ts'
import { getAudio, setAmbient, setEffects, setMaster } from '../audio/settings.ts'
import { renderSliderRow } from './audio-settings.ts'
import { renderHudSizeRow } from './graphics-settings.ts'

const listEl = document.getElementById('menu-settings') as HTMLDivElement | null

export const renderInMenuSettings = (): void => {
  if (!listEl) return
  listEl.innerHTML = ''
  const title = document.createElement('div')
  title.className = 'menu-settings-title'
  title.textContent = t('menu.settings')
  listEl.appendChild(title)
  listEl.appendChild(renderSliderRow('settings.audio.master', 'settings.audio.masterDesc', getAudio().master, (v) => setMaster(v)))
  listEl.appendChild(renderSliderRow('settings.audio.effects', 'settings.audio.effectsDesc', getAudio().effects, (v) => setEffects(v)))
  listEl.appendChild(renderSliderRow('settings.audio.ambient', 'settings.audio.ambientDesc', getAudio().ambient, (v) => setAmbient(v)))
  listEl.appendChild(renderHudSizeRow())
}