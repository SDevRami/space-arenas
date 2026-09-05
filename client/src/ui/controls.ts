export type ControlKind = 'key' | 'slot' | 'mouse'

export interface ControlRowDef {
  id: string
  kind: ControlKind
  labelKey?: string
  inputKey?: string
  slot?: number
}

const STORAGE_KEY = 'space-arenas:controls'

export interface Bindings {
  [id: string]: string
}

export const DEFAULT_BINDINGS: Bindings = {
  esc: 'Escape',
  borders: 'b',
  paths: 'p',
  reveal: 'f',
  bases: 'n',
  minimap: 'm',
  boxSelect: 'x',
  stop: 's',
  home: 'h',
  idleWorker: 'i',
  idleDozer: 'd',
  selectCombat: 'c',
  selectHarvesters: 'w',
  log: 'l',
  attackMove: 'a',
  keepAttack: 'k',
  guard: 'g',
  multiPos: 'j',
  sell: 'Delete',
  spawnPoint: 'v',
  flag: 'r',
  zoomIn: '=',
  zoomOut: '-',
  panUp: 'ArrowUp',
  panDown: 'ArrowDown',
  panLeft: 'ArrowLeft',
  panRight: 'ArrowRight',
  mod: 'Control',
  groupMod: 'Control',
  select: 'left',
  box: 'left',
  ctrl: 'left',
  move: 'right',
  'slot:1': '1',
  'slot:2': '2',
  'slot:3': '3',
  'slot:4': '4',
  'slot:5': '5',
  'slot:6': '6',
  'slot:7': '7',
  'slot:8': '8',
  'slot:9': '9',
}

const isKnown = (id: string): boolean => Object.prototype.hasOwnProperty.call(DEFAULT_BINDINGS, id)

const load = (): Bindings => {
  const merged: Bindings = { ...DEFAULT_BINDINGS }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      if (parsed && typeof parsed === 'object') {
        for (const [id, v] of Object.entries(parsed)) {
          if (isKnown(id) && typeof v === 'string' && v.length > 0) merged[id] = v
        }
      }
    }
  } catch {
    /* storage unavailable */
  }
  return merged
}

let current: Bindings = load()

const persist = (): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current))
  } catch {
    /* storage unavailable */
  }
}

export const getControls = (): Bindings => current

export const changeBinding = (id: string, key: string): void => {
  if (!isKnown(id)) return
  const prev = getControls()[id]
  current[id] = key
  for (const other of Object.keys(DEFAULT_BINDINGS)) {
    if (other !== id && current[other] === key) current[other] = prev
  }
  persist()
}

export const restoreDefaultBindings = (): void => {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* storage unavailable */
  }
  current = { ...DEFAULT_BINDINGS }
}

export const mouseSide = (id: string): 'left' | 'right' => (getControls()[id] === 'right' ? 'right' : 'left')

export const mouseButton = (id: string): number => (mouseSide(id) === 'right' ? 2 : 0)

export const CONTROL_ROWS: ControlRowDef[] = [
  { id: 'esc', kind: 'key', labelKey: 'info.controls.esc' },
  { id: 'borders', kind: 'key', labelKey: 'info.controls.borders' },
  { id: 'paths', kind: 'key', labelKey: 'info.controls.paths' },
  { id: 'reveal', kind: 'key', labelKey: 'info.controls.reveal' },
  { id: 'bases', kind: 'key', labelKey: 'info.controls.bases' },
  { id: 'minimap', kind: 'key', labelKey: 'info.controls.minimap' },
  { id: 'boxSelect', kind: 'key', labelKey: 'settings.controls.entries.boxSelect' },
  { id: 'stop', kind: 'key', labelKey: 'info.controls.stop' },
  { id: 'home', kind: 'key', labelKey: 'info.controls.home' },
  { id: 'idleWorker', kind: 'key', labelKey: 'info.controls.idleWorker' },
  { id: 'idleDozer', kind: 'key', labelKey: 'info.controls.idleDozer' },
  { id: 'selectCombat', kind: 'key', labelKey: 'settings.controls.entries.selectCombat' },
  { id: 'selectHarvesters', kind: 'key', labelKey: 'settings.controls.entries.selectHarvesters' },
  { id: 'log', kind: 'key', labelKey: 'settings.controls.entries.log' },
  { id: 'attackMove', kind: 'key', labelKey: 'info.controls.attackMove' },
  { id: 'keepAttack', kind: 'key', labelKey: 'info.controls.keepAttack' },
  { id: 'guard', kind: 'key', labelKey: 'info.controls.guard' },
  { id: 'multiPos', kind: 'key', labelKey: 'info.controls.multiPos' },
  { id: 'sell', kind: 'key', labelKey: 'info.controls.sell' },
  { id: 'spawnPoint', kind: 'key', labelKey: 'info.controls.spawnPoint' },
  { id: 'flag', kind: 'key', labelKey: 'info.controls.flag' },
  { id: 'zoomIn', kind: 'key', labelKey: 'info.controls.zoomIn' },
  { id: 'zoomOut', kind: 'key', labelKey: 'info.controls.zoomOut' },
  { id: 'panUp', kind: 'key', labelKey: 'info.controls.panUp' },
  { id: 'panDown', kind: 'key', labelKey: 'info.controls.panDown' },
  { id: 'panLeft', kind: 'key', labelKey: 'info.controls.panLeft' },
  { id: 'panRight', kind: 'key', labelKey: 'info.controls.panRight' },
  { id: 'select', kind: 'mouse', labelKey: 'info.controls.select', inputKey: 'info.controls.inputSelect' },
  { id: 'box', kind: 'mouse', labelKey: 'info.controls.box', inputKey: 'info.controls.inputBox' },
  { id: 'ctrl', kind: 'mouse', labelKey: 'info.controls.ctrl', inputKey: 'info.controls.inputCtrl' },
  { id: 'move', kind: 'mouse', labelKey: 'info.controls.move', inputKey: 'info.controls.inputMove' },
  { id: 'pan', kind: 'mouse', labelKey: 'info.controls.pan', inputKey: 'info.controls.inputPan' },
  { id: 'zoom', kind: 'mouse', labelKey: 'info.controls.zoom', inputKey: 'info.controls.inputZoom' },
  { id: 'minimapJump', kind: 'mouse', labelKey: 'info.controls.minimapJump', inputKey: 'info.controls.inputMinimapJump' },
  { id: 'edgePan', kind: 'mouse', labelKey: 'info.controls.edgePan', inputKey: 'info.controls.inputEdgePan' },
]

export const slotRows = (): ControlRowDef[] =>
  Array.from({ length: 9 }, (_, i) => ({
    id: `slot:${i + 1}`,
    kind: 'slot' as const,
    slot: i + 1,
  }))

export const groupModRow = (): ControlRowDef => ({ id: 'groupMod', kind: 'key', labelKey: 'settings.controls.entries.groupMod' })

/** Human label for a modifier binding: 'Control' → Ctrl, 'Shift' → Shift, letters → uppercase. */
export const modifierLabel = (id: 'groupMod' | 'mod' = 'groupMod'): string => {
  const k = getControls()[id] ?? 'Control'
  const l = k.toLowerCase()
  if (l === 'control') return 'Ctrl'
  if (l === 'meta') return 'Meta'
  if (l === 'shift') return 'Shift'
  if (l === 'alt') return 'Alt'
  return k.length === 1 ? k.toUpperCase() : k
}