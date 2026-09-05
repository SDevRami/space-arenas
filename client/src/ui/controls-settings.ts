import { t } from '../i18n/index.ts'
import { CONTROL_ROWS, getControls, changeBinding, restoreDefaultBindings, slotRows, groupModRow, mouseSide, type ControlRowDef } from './controls.ts'

// ---------- controls (settings) ----------

const ctrlsStatusEl = document.getElementById('ctrls-status') as HTMLDivElement
const controlsOverlay = document.getElementById('controls-overlay') as HTMLDivElement
const controlsInfoOverlay = document.getElementById('controls-info-overlay') as HTMLDivElement
const controlsListEl = document.getElementById('controls-list') as HTMLDivElement
const controlsInfoContent = document.getElementById('controls-info-content') as HTMLDivElement
const ctrlsCaptureHint = document.getElementById('ctrls-capture-hint') as HTMLParagraphElement

let captureId: string | null = null

const setCtrlsStatus = (text: string): void => {
  ctrlsStatusEl.textContent = text
  ctrlsStatusEl.classList.remove('error')
}

const normKey = (k: string): string => {
  if (k === ' ') return 'Space'
  if (k.length === 1 && /^[A-Za-z]$/.test(k)) return k.toLowerCase()
  return k
}

const fmtKey = (k: string): string => (k.length === 1 ? k.toUpperCase() : k)

const ctrlRowEl = (r: ControlRowDef): HTMLElement => {
  const row = document.createElement('div')
  row.className = 'controls-row'
  if (captureId === r.id) row.classList.add('capturing')
  const lab = document.createElement('label')
  lab.textContent = r.kind === 'slot' ? t('settings.controls.slot', { n: r.slot ?? 0 }) : t(r.labelKey ?? '')
  row.appendChild(lab)
  if (r.kind === 'slot' || r.kind === 'key') {
    const keyEl = document.createElement('span')
    keyEl.className = 'key'
    keyEl.textContent = fmtKey(getControls()[r.id])
    row.appendChild(keyEl)
    const btn = document.createElement('button')
    btn.textContent = t('settings.controls.setKey')
    btn.addEventListener('click', () => startCapture(r.id))
    row.appendChild(btn)
  } else if (r.id === 'select' || r.id === 'box' || r.id === 'move') {
    const b = document.createElement('button')
    b.className = 'mouse-side'
    b.textContent = t(mouseSide(r.id) === 'right' ? 'settings.controls.right' : 'settings.controls.left')
    b.addEventListener('click', () => {
      changeBinding(r.id, mouseSide(r.id) === 'right' ? 'left' : 'right')
      renderControlsList()
    })
    row.appendChild(b)
  } else if (r.id === 'ctrl' || r.id === 'edgePan') {
    const keyEl = document.createElement('span')
    keyEl.className = 'key'
    keyEl.textContent = fmtKey(getControls().mod)
    row.appendChild(keyEl)
    const btn = document.createElement('button')
    btn.textContent = t('settings.controls.setKey')
    btn.addEventListener('click', () => startCapture('mod'))
    row.appendChild(btn)
  } else {
    const inp = document.createElement('span')
    inp.className = 'mouse-input'
    inp.textContent = t(r.inputKey ?? '')
    row.appendChild(inp)
    const badge = document.createElement('span')
    badge.className = 'mouse-badge'
    badge.textContent = t('settings.controls.mouse')
    row.appendChild(badge)
  }
  return row
}

const renderControlsList = (): void => {
  controlsListEl.innerHTML = ''
  const groups: Array<{ labelKey: string; rows: ControlRowDef[] }> = [
    { labelKey: 'settings.controls.keyboard', rows: CONTROL_ROWS.filter((r) => r.kind === 'key') },
    { labelKey: 'settings.controls.slots', rows: [groupModRow(), ...slotRows()] },
    { labelKey: 'settings.controls.mouse', rows: CONTROL_ROWS.filter((r) => r.kind === 'mouse') },
  ]
  for (const g of groups) {
    const h = document.createElement('div')
    h.className = 'controls-section-label'
    h.textContent = t(g.labelKey)
    controlsListEl.appendChild(h)
    for (const r of g.rows) controlsListEl.appendChild(ctrlRowEl(r))
  }
}

const onCaptureKey = (e: KeyboardEvent): void => {
  e.preventDefault()
  document.removeEventListener('keydown', onCaptureKey)
  if (e.key === 'Escape') {
    captureId = null
    renderControlsList()
    ctrlsCaptureHint.textContent = t('settings.controls.rebindHint')
    return
  }
  const id = captureId
  captureId = null
  if (id) changeBinding(id, normKey(e.key))
  renderControlsList()
  ctrlsCaptureHint.textContent = t('settings.controls.rebound', { key: fmtKey(id ? getControls()[id] : '') })
}

const startCapture = (id: string): void => {
  captureId = id
  renderControlsList()
  ctrlsCaptureHint.textContent = t('settings.controls.pressKey')
  document.addEventListener('keydown', onCaptureKey)
}

const doRestoreControls = (): void => {
  captureId = null
  restoreDefaultBindings()
  renderControlsList()
  ctrlsCaptureHint.textContent = t('settings.controls.rebindHint')
  setCtrlsStatus(t('settings.controls.restored'))
}

export const initControlsSettings = (getControlsInfoHtml: () => string): { renderControlsList: () => void; controlsOverlay: HTMLDivElement; controlsInfoOverlay: HTMLDivElement; controlsInfoContent: HTMLDivElement } => {
  const openControls = (): void => {
    captureId = null
    setCtrlsStatus('')
    ctrlsCaptureHint.textContent = t('settings.controls.rebindHint')
    renderControlsList()
    controlsOverlay.classList.add('visible')
  }
  document.getElementById('ctrls-change')!.addEventListener('click', openControls)
  document.getElementById('ctrls-restore')!.addEventListener('click', doRestoreControls)
  document.getElementById('controls-reset')!.addEventListener('click', doRestoreControls)
  document.getElementById('controls-done')!.addEventListener('click', () => {
    controlsOverlay.classList.remove('visible')
    captureId = null
    ctrlsCaptureHint.textContent = t('settings.controls.rebindHint')
  })
  document.getElementById('ctrls-info')!.addEventListener('click', () => {
    controlsInfoContent.innerHTML = getControlsInfoHtml()
    controlsInfoOverlay.classList.add('visible')
  })
  document.getElementById('controls-info-close')!.addEventListener('click', () => controlsInfoOverlay.classList.remove('visible'))
  return { renderControlsList, controlsOverlay, controlsInfoOverlay, controlsInfoContent }
}
