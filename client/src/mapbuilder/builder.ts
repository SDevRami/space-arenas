import { t, tn } from '../i18n/index.ts'
import { Terrain, createEmptyMap, validateMap, type MapData, type Obstruction } from '@space-arenas/shared'
import type { LobbyMessage } from '@space-arenas/shared'
import { MapBuilderEditor, type ToolKind } from './editor.ts'
import { WorldMapPanel } from './worldmap.ts'
import { allMapEntries, deleteCustomMap, entryToMap, findMapEntry, saveCustomMap } from './library.ts'

const DEFAULT_MAP_SIZE = 128
const MAX_BRUSH_SIZE = 8

let mbSelected: string | null = null
const mbStatusEl = document.getElementById('mb-status') as HTMLDivElement
const mbBody = document.getElementById('mb-maps-table')!.querySelector('tbody')!
const mbOverlay = document.getElementById('mapbuilder-overlay') as HTMLDivElement
const mbConfirmOverlay = document.getElementById('mb-confirm-overlay') as HTMLDivElement
const mbInfoOverlay = document.getElementById('mb-info-overlay') as HTMLDivElement
const mbTitleEl = document.getElementById('mb-title') as HTMLSpanElement
const mbEdStatusEl = document.getElementById('mb-ed-status') as HTMLDivElement
const mbInfoNameEl = document.getElementById('mb-info-name') as HTMLInputElement
const mbInfoWidthEl = document.getElementById('mb-info-width') as HTMLInputElement
const mbInfoHeightEl = document.getElementById('mb-info-height') as HTMLInputElement
const mbInfoVariantEl = document.getElementById('mb-info-variant') as HTMLInputElement
const mbInfoDescEl = document.getElementById('mb-info-desc') as HTMLInputElement

let mbEditor: MapBuilderEditor | null = null
let mbWorld: WorldMapPanel | null = null
let mbOpenedName: string | null = null
let mbDirty = false
let mbConfirmAction: (() => void) | null = null

const setMbStatus = (text: string, isError = false): void => {
  mbStatusEl.textContent = text
  mbStatusEl.classList.toggle('error', isError)
}

const renderMapBuilderTable = (): void => {
  mbBody.innerHTML = ''
  allMapEntries().forEach((e, i) => {
    const tr = document.createElement('tr')
    if (mbSelected === e.id) tr.classList.add('selected')
    const cell = (txt: string): HTMLTableCellElement => {
      const td = document.createElement('td')
      td.textContent = txt
      return td
    }
    tr.appendChild(cell(String(i + 1)))
    const nameTd = document.createElement('td')
    const name = document.createElement('b')
    name.textContent = e.kind === 'preset' ? tn(e.id, e.name) : e.name
    nameTd.appendChild(name)
    tr.appendChild(nameTd)
    tr.appendChild(cell(`${e.players}P`))
    tr.appendChild(cell(e.kind === 'preset' ? (e.variant ?? '') : (e.data?.mapVersion ?? '')))
    tr.appendChild(cell(e.kind === 'preset' ? t(`maps.${e.id}.desc`) : (e.data?.description ?? '')))
    tr.addEventListener('click', () => {
      mbSelected = e.id
      renderMapBuilderTable()
    })
    mbBody.appendChild(tr)
  })
}

const refreshMapLists = (getLobbyState: () => LobbyMessage | null, renderMatchOptions: (msg: LobbyMessage, isHost: boolean) => void, renderMapSelect: () => void): void => {
  renderMapBuilderTable()
  renderMapSelect()
  const lobbyState = getLobbyState()
  if (lobbyState && lobbyState.map) {
    renderMatchOptions(lobbyState, lobbyState.yourId === lobbyState.hostId)
  }
}

const openEditor = (map: MapData, openedName: string | null): void => {
  mbWorld?.dispose()
  mbWorld = null
  document.getElementById('mb-worldmap-overlay')!.classList.remove('visible')
  if (mbEditor) {
    mbEditor.dispose()
    mbEditor = null
  }
  const wrap = document.querySelector('.mb-canvas-wrap') as HTMLDivElement
  wrap.innerHTML = ''
  mbOverlay.classList.add('visible')
  mbConfirmOverlay.classList.add('hidden')
  mbInfoOverlay.classList.add('hidden')
  mbEditor = new MapBuilderEditor(wrap, {
    onDirtyChange: (d) => {
      mbDirty = d
      mbEdStatusEl.textContent = d ? t('mapbuilder.dirty') : ''
    },
  })
  mbEditor.open(map)
  mbOpenedName = openedName
  mbDirty = false
  mbTitleEl.textContent = openedName ?? t('mapbuilder.newTitle')
  mbEdStatusEl.textContent = ''
}

const closeEditorForce = (refreshCb: () => void): void => {
  mbWorld?.dispose()
  mbWorld = null
  document.getElementById('mb-worldmap-overlay')!.classList.remove('visible')
  mbEditor?.dispose()
  mbEditor = null
  mbOpenedName = null
  mbDirty = false
  mbConfirmAction = null
  mbOverlay.classList.remove('visible')
  mbConfirmOverlay.classList.add('hidden')
  mbInfoOverlay.classList.add('hidden')
  refreshCb()
}

const closeEditor = (refreshCb: () => void): void => {
  if (mbDirty) {
    mbConfirmAction = () => closeEditorForce(refreshCb)
    mbConfirmOverlay.classList.remove('hidden')
    return
  }
  closeEditorForce(refreshCb)
}

const saveCurrentMap = (refreshCb: () => void): void => {
  const m = mbEditor?.currentMap
  if (!m) return
  const res = saveCustomMap(m, mbOpenedName ?? undefined)
  if (!res.ok) {
    mbEdStatusEl.textContent = t('mapbuilder.saveError', { n: res.errors[0] ?? 'invalid map' })
    return
  }
  mbOpenedName = m.name
  mbTitleEl.textContent = m.name
  mbEditor?.open(m)
  mbDirty = false
  mbEdStatusEl.textContent = t('mapbuilder.saved')
  setMbStatus(t('mapbuilder.saved'))
  refreshCb()
}

const exportSelectedMap = (): void => {
  const entry = mbSelected ? findMapEntry(mbSelected) : undefined
  if (!entry) {
    setMbStatus(t('mapbuilder.noSelection'), true)
    return
  }
  const m = entryToMap(entry)
  const blob = new Blob([JSON.stringify(m, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${m.name.replace(/[^a-z0-9_-]+/gi, '-') || 'map'}.json`
  a.click()
  URL.revokeObjectURL(a.href)
  setMbStatus(t('mapbuilder.exported'))
}

const importMapFile = (file: File, refreshCb: () => void): void => {
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result)) as MapData
      const v = validateMap(parsed)
      if (!v.ok) {
        setMbStatus(t('mapbuilder.importError', { n: v.errors[0] ?? 'bad file' }), true)
        return
      }
      const res = saveCustomMap(parsed)
      setMbStatus(res.ok ? t('mapbuilder.imported') : t('mapbuilder.importError', { n: res.errors[0] ?? 'bad file' }), !res.ok)
      refreshCb()
    } catch {
      setMbStatus(t('mapbuilder.importError', { n: 'bad JSON' }), true)
    }
  }
  reader.readAsText(file)
}

const openSelected = (): void => {
  const entry = mbSelected ? findMapEntry(mbSelected) : undefined
  if (!entry) {
    setMbStatus(t('mapbuilder.noSelection'), true)
    return
  }
  openEditor(entryToMap(entry), entry.kind === 'custom' ? entry.name : null)
}

const cloneSelected = (): void => {
  const entry = mbSelected ? findMapEntry(mbSelected) : undefined
  if (!entry) {
    setMbStatus(t('mapbuilder.noSelection'), true)
    return
  }
  const m = entryToMap(entry)
  m.name = `${m.name} copy`
  m.description = ''
  m.mapVersion = '0.1.0'
  openEditor(m, null)
}

export function initMapBuilder(callbacks: {
  getLobbyState: () => LobbyMessage | null
  renderMatchOptions: (msg: LobbyMessage, isHost: boolean) => void
  renderMapSelect: () => void
}) {
  const { getLobbyState, renderMatchOptions, renderMapSelect } = callbacks
  const refreshCb = (): void => refreshMapLists(getLobbyState, renderMatchOptions, renderMapSelect)

  document.getElementById('mb-create')!.addEventListener('click', () => {
    const m = createEmptyMap(DEFAULT_MAP_SIZE, DEFAULT_MAP_SIZE)
    m.name = t('mapbuilder.newMapName')
    openEditor(m, null)
  })
  document.getElementById('mb-import')!.addEventListener('click', () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    input.addEventListener('change', () => {
      const file = input.files?.[0]
      if (file) importMapFile(file, refreshCb)
    })
    input.click()
  })
  document.getElementById('mb-export')!.addEventListener('click', exportSelectedMap)
  document.getElementById('mb-refresh')!.addEventListener('click', () => {
    mbSelected = null
    renderMapBuilderTable()
    setMbStatus(t('mapbuilder.refreshed'))
  })
  document.getElementById('mb-clone')!.addEventListener('click', () => cloneSelected())
  document.getElementById('mb-edit')!.addEventListener('click', () => openSelected())
  document.getElementById('mb-delete')!.addEventListener('click', () => {
    const entry = mbSelected ? findMapEntry(mbSelected) : undefined
    if (!entry || entry.kind !== 'custom') {
      setMbStatus(t('mapbuilder.deleteNoCustom'), true)
      return
    }
    deleteCustomMap(entry.name)
    mbSelected = null
    setMbStatus(t('mapbuilder.deleted'))
    refreshCb()
  })

  document.getElementById('mb-back')!.addEventListener('click', () => closeEditor(refreshCb))
  document.getElementById('mb-reset')!.addEventListener('click', () => {
    mbEditor?.reset()
    mbEdStatusEl.textContent = mbEditor?.dirty ? t('mapbuilder.dirty') : ''
  })
  document.getElementById('mb-save')!.addEventListener('click', () => saveCurrentMap(refreshCb))
  document.getElementById('mb-info')!.addEventListener('click', () => {
    const m = mbEditor?.currentMap
    if (!m) return
    mbInfoNameEl.value = m.name
    mbInfoWidthEl.value = String(m.width)
    mbInfoHeightEl.value = String(m.height)
    mbInfoVariantEl.value = m.mapVersion
    mbInfoDescEl.value = m.description
    mbInfoOverlay.classList.remove('hidden')
  })
  document.getElementById('mb-info-save')!.addEventListener('click', () => {
    mbEditor?.applyInfo({ name: mbInfoNameEl.value, description: mbInfoDescEl.value, variant: mbInfoVariantEl.value })
    const w = Number(mbInfoWidthEl.value)
    const h = Number(mbInfoHeightEl.value)
    if (Number.isFinite(w) && Number.isFinite(h)) mbEditor?.resize(w, h)
    mbInfoOverlay.classList.add('hidden')
    mbEdStatusEl.textContent = mbEditor?.dirty ? t('mapbuilder.dirty') : ''
  })
  document.getElementById('mb-info-cancel')!.addEventListener('click', () => {
    mbInfoOverlay.classList.add('hidden')
  })
  document.getElementById('mb-confirm-ok')!.addEventListener('click', () => {
    mbConfirmOverlay.classList.add('hidden')
    const action = mbConfirmAction
    mbConfirmAction = null
    action?.()
  })
  document.getElementById('mb-confirm-cancel')!.addEventListener('click', () => {
    mbConfirmOverlay.classList.add('hidden')
    mbConfirmAction = null
  })

  document.querySelectorAll<HTMLButtonElement>('.mb-brush').forEach((b) => {
    b.addEventListener('click', () => {
      document.querySelectorAll<HTMLButtonElement>('.mb-brush').forEach((x) => x.classList.toggle('active', x === b))
      const brush = b.dataset.brush
      const terrain = brush === 'water' ? Terrain.Water : Terrain.Ground
      document.querySelectorAll<HTMLButtonElement>('.mb-swatch').forEach((s) => {
        s.classList.toggle('active', Number(s.dataset.terrain) === terrain)
      })
      mbEditor?.setBrush(terrain)
    })
  })
  document.querySelectorAll<HTMLButtonElement>('.mb-swatch').forEach((b) => {
    b.addEventListener('click', () => {
      document.querySelectorAll<HTMLButtonElement>('.mb-swatch').forEach((x) => x.classList.remove('active'))
      b.classList.add('active')
      const terrain = Number(b.dataset.terrain)
      const swatchColors: Record<number, string> = { 0: '#39422f', 1: '#6a5c4a', 3: '#454b4f' }
      if (swatchColors[terrain]) mbBrushColorEl.value = swatchColors[terrain]
      mbEditor?.setBrush(terrain)
    })
  })
  document.querySelectorAll<HTMLButtonElement>('.mb-tool').forEach((b) => {
    b.addEventListener('click', () => {
      document.querySelectorAll<HTMLButtonElement>('.mb-tool').forEach((x) => x.classList.remove('active'))
      b.classList.add('active')
      mbEditor?.setTool(b.dataset.tool as ToolKind)
    })
  })

  const mbBrushSizeEl = document.getElementById('mb-brush-size') as HTMLInputElement
  const mbBrushSizeLabelEl = document.getElementById('mb-brush-size-label') as HTMLDivElement
  mbBrushSizeEl.addEventListener('input', () => {
    const v = Math.max(1, Math.min(MAX_BRUSH_SIZE, Math.round(Number(mbBrushSizeEl.value)) || 1))
    mbBrushSizeLabelEl.textContent = String(v)
    mbEditor?.setBrushSize(v)
  })
  const mbBrushColorEl = document.getElementById('mb-brush-color') as HTMLInputElement
  document.getElementById('mb-brush-color-clear')!.addEventListener('click', () => {
    document.querySelectorAll<HTMLButtonElement>('.mb-brush').forEach((b) => b.classList.toggle('active', b.dataset.brush === 'ground'))
    document.querySelectorAll<HTMLButtonElement>('.mb-swatch').forEach((s) => s.classList.toggle('active', Number(s.dataset.terrain) === Terrain.Ground))
    mbEditor?.setBrushColor(null)
  })
  mbBrushColorEl.addEventListener('input', () => {
    document.querySelectorAll<HTMLButtonElement>('.mb-brush').forEach((b) => b.classList.toggle('active', b.dataset.brush === 'ground'))
    document.querySelectorAll<HTMLButtonElement>('.mb-swatch').forEach((s) => s.classList.remove('active'))
    mbEditor?.setBrushColor(mbBrushColorEl.value)
  })

  document.querySelectorAll<HTMLButtonElement>('#mb-object-kind .mb-shape').forEach((b) => {
    b.addEventListener('click', () => {
      document.querySelectorAll<HTMLButtonElement>('#mb-object-kind .mb-shape').forEach((x) => x.classList.remove('active'))
      b.classList.add('active')
      const kind = b.dataset.kind as Obstruction['type']
      if (kind === 'tree' || kind === 'rock' || kind === 'wreck') mbEditor?.setObjectKind(kind)
    })
  })

  const mbLightEl = document.getElementById('mb-light') as HTMLInputElement
  const mbLightLabelEl = document.getElementById('mb-light-label') as HTMLDivElement
  mbLightEl.addEventListener('input', () => {
    const v = Math.max(-10, Math.min(10, Math.round(Number(mbLightEl.value) || 0)))
    mbLightLabelEl.textContent = v > 0 ? `+${v}` : String(v)
    mbEditor?.setBrightness(v)
  })

  // real-world map import
  const mbWorldOverlay = document.getElementById('mb-worldmap-overlay') as HTMLDivElement
  document.getElementById('mb-worldmap')!.addEventListener('click', () => {
    if (!mbEditor) return
    mbWorld?.dispose()
    mbWorld = null
    mbWorldOverlay.classList.add('visible')
    mbWorld = new WorldMapPanel(mbWorldOverlay, {
      loadingText: t('mapbuilder.world.loading'),
      onImport: (res) => {
        mbWorldOverlay.classList.remove('visible')
        mbWorld?.dispose()
        mbWorld = null
        mbEditor?.importWorld(res.tiles, res.groundColors, res.width, res.height)
        setMbStatus(t('mapbuilder.world.imported'))
      },
    })
    mbWorld.open()
  })
  document.getElementById('mb-world-close')!.addEventListener('click', () => {
    mbWorld?.dispose()
    mbWorld = null
    mbWorldOverlay.classList.remove('visible')
  })
  document.getElementById('mb-world-import')!.addEventListener('click', () => {
    mbWorld?.onImportRequested()
  })

  return { renderMapBuilderTable }
}
