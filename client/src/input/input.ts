import type { Camera } from '../render/camera.ts'
import { getControls, mouseButton } from '../ui/controls.ts'

export type CommandKind = 'move' | 'attack-move' | 'attack' | 'keep-attack' | 'guard' | 'stop' | 'home'

export interface ClickInfo {
  world: { x: number; y: number }
  ctrl: boolean
  shift: boolean
  alt: boolean
  touch: boolean
}

export interface BoxInfo {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface InputCallbacks {
  onCommand: (kind: CommandKind, world: { x: number; y: number }) => void
  onClick: (info: ClickInfo) => void
  onBox: (box: BoxInfo) => void
  onPan: (dx: number, dy: number) => void
  onZoom: (factor: number, px: number, py: number) => void
}

export class InputManager {
  readonly mouseWorld = { x: 0, y: 0 }
  mouseScreen = { x: 0, y: 0 }
  boxRect: BoxInfo | null = null
  aKey = false
  keepAttackKey = false
  guardKey = false
  touchActive = false
  boxSelect = false

  private static readonly EDGE_MARGIN = 24
  private static readonly EDGE_SPEED = 16
  private static readonly TOUCH_DRAG_SLOP = 8
  private static readonly TOUCH_LONG_PRESS_MS = 500

  private ctrl = false
  private shift = false
  private alt = false
  private boxing = false
  private boxStart: { x: number; y: number } | null = null
  private rightDown = false
  private rightStart: { x: number; y: number } | null = null
  private panning = false
  private lastPan: { x: number; y: number } | null = null
  private lastClient = { x: -100, y: -100 }
  private mouseInside = false
  private attached = false

  private touchEnabled = false
  private touches = new Map<number, { x: number; y: number }>()
  private touchMode: 'none' | 'single' | 'dual' = 'none'
  private touchStartPos: { x: number; y: number } | null = null
  private touchMoved = false
  private longPressed = false
  private longPressTimer: number | null = null
  private singlePanning = false
  private lastTouchPan: { x: number; y: number } | null = null
  private dualZoom = false
  private dualBase: { midX: number; midY: number; dist: number } | null = null

  constructor(
    private canvas: HTMLCanvasElement,
    private camera: Camera,
    private cb: InputCallbacks,
  ) {}

  attach(): void {
    if (this.attached) return
    this.attached = true
    const c = this.canvas
    c.addEventListener('contextmenu', (e) => e.preventDefault())
    c.addEventListener('mousedown', this.onMouseDown)
    window.addEventListener('mousemove', this.onMouseMove)
    window.addEventListener('mouseup', this.onMouseUp)
    window.addEventListener('mouseleave', this.onMouseLeave)
    c.addEventListener('wheel', this.onWheel, { passive: false })
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
  }

  detach(): void {
    if (!this.attached) return
    this.attached = false
    const c = this.canvas
    c.removeEventListener('contextmenu', (e) => e.preventDefault())
    c.removeEventListener('mousedown', this.onMouseDown)
    window.removeEventListener('mousemove', this.onMouseMove)
    window.removeEventListener('mouseup', this.onMouseUp)
    window.removeEventListener('mouseleave', this.onMouseLeave)
    c.removeEventListener('wheel', this.onWheel)
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    this.setTouchEnabled(false)
  }

  setTouchEnabled(on: boolean): void {
    if (on === this.touchEnabled) return
    this.touchEnabled = on
    const c = this.canvas
    if (on) {
      c.addEventListener('touchstart', this.onTouchStart, { passive: false })
      c.addEventListener('touchmove', this.onTouchMove, { passive: false })
      c.addEventListener('touchend', this.onTouchEnd, { passive: false })
      c.addEventListener('touchcancel', this.onTouchCancel, { passive: false })
    } else {
      c.removeEventListener('touchstart', this.onTouchStart)
      c.removeEventListener('touchmove', this.onTouchMove)
      c.removeEventListener('touchend', this.onTouchEnd)
      c.removeEventListener('touchcancel', this.onTouchCancel)
      this.cancelTouchGesture()
    }
  }

  private updateWorldPos(e: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    this.mouseScreen = { x: px, y: py }
    const w = this.camera.screenToWorld(px, py)
    this.mouseWorld.x = w.x
    this.mouseWorld.y = w.y
  }

  private onMouseDown = (e: MouseEvent): void => {
    this.updateWorldPos(e)
    if (e.button === 1) {
      this.panning = true
      this.lastPan = { x: e.clientX, y: e.clientY }
      return
    }
    if (e.button === mouseButton('move')) {
      this.rightDown = true
      this.rightStart = { x: e.clientX, y: e.clientY }
      return
    }
    if (e.button === mouseButton('select')) {
      this.boxing = true
      this.boxStart = { x: e.clientX, y: e.clientY }
      this.boxRect = null
    }
  }

  private onMouseMove = (e: MouseEvent): void => {
    this.updateWorldPos(e)
    this.lastClient = { x: e.clientX, y: e.clientY }
    this.mouseInside = true
    if (this.panning && this.lastPan) {
      const dx = e.clientX - this.lastPan.x
      const dy = e.clientY - this.lastPan.y
      this.lastPan = { x: e.clientX, y: e.clientY }
      this.cb.onPan(dx, dy)
    }
    if (this.boxing && this.boxStart) {
      const x0 = Math.min(this.boxStart.x, e.clientX)
      const y0 = Math.min(this.boxStart.y, e.clientY)
      const x1 = Math.max(this.boxStart.x, e.clientX)
      const y1 = Math.max(this.boxStart.y, e.clientY)
      this.boxRect = { x0, y0, x1, y1 }
    }
  }

  private onMouseLeave = (): void => {
    this.mouseInside = false
    this.lastClient = { x: -100, y: -100 }
  }

  isMouseInside(): boolean {
    return this.mouseInside
  }

  edgePanVelocity(): { x: number; y: number } | null {
    if (!this.ctrl) return null
    if (!this.mouseInside) return null
    const w = this.canvas.clientWidth
    const h = this.canvas.clientHeight
    const { x: cx, y: cy } = this.lastClient
    let dx = 0
    let dy = 0
    if (cx <= InputManager.EDGE_MARGIN) dx = InputManager.EDGE_SPEED
    else if (cx >= w - InputManager.EDGE_MARGIN) dx = -InputManager.EDGE_SPEED
    if (cy <= InputManager.EDGE_MARGIN) dy = InputManager.EDGE_SPEED
    else if (cy >= h - InputManager.EDGE_MARGIN) dy = -InputManager.EDGE_SPEED
    if (dx === 0 && dy === 0) return null
    const el = document.elementFromPoint(cx, cy)
    if (el && el !== this.canvas) return null
    return { x: dx, y: dy }
  }

  private onMouseUp = (e: MouseEvent): void => {
    if (e.button === 1) {
      this.panning = false
      this.lastPan = null
      return
    }
    if (e.button === mouseButton('move') && this.rightDown) {
      this.rightDown = false
      const sx = this.rightStart?.x ?? e.clientX
      const sy = this.rightStart?.y ?? e.clientY
      this.rightStart = null
      if (Math.abs(e.clientX - sx) < 6 && Math.abs(e.clientY - sy) < 6) {
        const kind: CommandKind = this.keepAttackKey ? 'keep-attack' : this.guardKey ? 'guard' : this.aKey ? 'attack-move' : 'move'
        this.cb.onCommand(kind, { x: this.mouseWorld.x, y: this.mouseWorld.y })
      }
      return
    }
    if (e.button === mouseButton('select') && this.boxing) {
      this.boxing = false
      const rect = this.canvas.getBoundingClientRect()
      if (this.boxStart) {
        const dx = e.clientX - this.boxStart.x
        const dy = e.clientY - this.boxStart.y
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) {
          this.cb.onClick({
            world: { x: this.mouseWorld.x, y: this.mouseWorld.y },
            ctrl: this.ctrl,
            shift: this.shift,
            alt: this.alt,
            touch: false,
          })
        } else if (this.boxRect) {
          this.cb.onBox({
            x0: this.boxRect.x0 - rect.left,
            y0: this.boxRect.y0 - rect.top,
            x1: this.boxRect.x1 - rect.left,
            y1: this.boxRect.y1 - rect.top,
          })
        }
      }
      this.boxRect = null
      this.boxStart = null
    }
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault()
    const rect = this.canvas.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
    this.cb.onZoom(factor, px, py)
  }

  private updateTouchWorld(clientX: number, clientY: number): void {
    const rect = this.canvas.getBoundingClientRect()
    const px = clientX - rect.left
    const py = clientY - rect.top
    this.mouseScreen = { x: px, y: py }
    const w = this.camera.screenToWorld(px, py)
    this.mouseWorld.x = w.x
    this.mouseWorld.y = w.y
    this.lastClient = { x: clientX, y: clientY }
    this.mouseInside = true
  }

  private clearLongPress(): void {
    if (this.longPressTimer !== null) {
      window.clearTimeout(this.longPressTimer)
      this.longPressTimer = null
    }
  }

  private beginSingle(x: number, y: number): void {
    this.touchMode = 'single'
    this.touchStartPos = { x, y }
    this.touchMoved = false
    this.longPressed = false
    this.singlePanning = false
    this.lastTouchPan = null
    this.dualZoom = false
    this.dualBase = null
    this.boxing = false
    this.boxStart = null
    this.boxRect = null
    this.clearLongPress()
    if (this.boxSelect) return
    this.longPressTimer = window.setTimeout(() => {
      this.longPressTimer = null
      if (this.touchMode !== 'single' || this.touchMoved || this.longPressed || !this.touchStartPos) return
      this.longPressed = true
      const kind: CommandKind = this.keepAttackKey ? 'keep-attack' : this.guardKey ? 'guard' : this.aKey ? 'attack-move' : 'move'
      this.cb.onCommand(kind, { x: this.mouseWorld.x, y: this.mouseWorld.y })
    }, InputManager.TOUCH_LONG_PRESS_MS)
  }

  private endSingle(x: number, y: number): void {
    this.clearLongPress()
    const start = this.touchStartPos
    this.touchStartPos = null
    this.touchMoved = false
    this.singlePanning = false
    this.lastTouchPan = null
    this.longPressed = false
    this.dualZoom = false
    this.dualBase = null
    if (this.boxSelect) {
      if (this.boxing && this.boxRect) {
        const rect = this.canvas.getBoundingClientRect()
        this.cb.onBox({
          x0: this.boxRect.x0 - rect.left,
          y0: this.boxRect.y0 - rect.top,
          x1: this.boxRect.x1 - rect.left,
          y1: this.boxRect.y1 - rect.top,
        })
      } else if (start) {
        const dx = x - start.x
        const dy = y - start.y
        if (Math.abs(dx) < InputManager.TOUCH_DRAG_SLOP && Math.abs(dy) < InputManager.TOUCH_DRAG_SLOP) {
          this.cb.onClick({
            world: { x: this.mouseWorld.x, y: this.mouseWorld.y },
            ctrl: false,
            shift: false,
            alt: false,
            touch: true,
          })
        }
      }
      this.boxing = false
      this.boxRect = null
      this.boxStart = null
      return
    }
    if (start) {
      const dx = x - start.x
      const dy = y - start.y
      if (Math.abs(dx) < InputManager.TOUCH_DRAG_SLOP && Math.abs(dy) < InputManager.TOUCH_DRAG_SLOP) {
        this.cb.onClick({
          world: { x: this.mouseWorld.x, y: this.mouseWorld.y },
          ctrl: false,
          shift: false,
          alt: false,
          touch: true,
        })
      }
    }
    this.boxRect = null
    this.boxStart = null
  }

  private cancelTouchGesture(): void {
    this.clearLongPress()
    this.touchActive = false
    this.touchStartPos = null
    this.touchMoved = false
    this.longPressed = false
    this.singlePanning = false
    this.lastTouchPan = null
    this.boxing = false
    this.boxRect = null
    this.boxStart = null
    this.dualZoom = false
    this.dualBase = null
    this.touchMode = 'none'
    this.touches.clear()
  }

  private onTouchStart = (e: TouchEvent): void => {
    e.preventDefault()
    this.touchActive = true
    for (const t of Array.from(e.changedTouches)) {
      this.touches.set(t.identifier, { x: t.clientX, y: t.clientY })
    }
    this.updateTouchWorld(e.changedTouches[0].clientX, e.changedTouches[0].clientY)
    if (this.touches.size === 1) {
      this.beginSingle(e.changedTouches[0].clientX, e.changedTouches[0].clientY)
    } else if (this.touches.size >= 2) {
      this.clearLongPress()
      this.touchMode = 'dual'
      this.touchStartPos = null
      this.touchMoved = false
      this.singlePanning = false
      this.lastTouchPan = null
      this.boxing = false
      this.boxRect = null
      this.dualZoom = false
      const [a, b] = Array.from(this.touches.values())
      this.dualBase = {
        midX: (a.x + b.x) / 2,
        midY: (a.y + b.y) / 2,
        dist: Math.hypot(a.x - b.x, a.y - b.y),
      }
    }
  }

  private onTouchMove = (e: TouchEvent): void => {
    e.preventDefault()
    for (const t of Array.from(e.changedTouches)) {
      if (this.touches.has(t.identifier)) this.touches.set(t.identifier, { x: t.clientX, y: t.clientY })
    }
    const first = e.touches[0] ?? e.changedTouches[0]
    if (first) this.updateTouchWorld(first.clientX, first.clientY)
    if (this.touchMode === 'single' && this.touches.size === 1 && this.touchStartPos) {
      const t = e.touches[0]
      const dx = t.clientX - this.touchStartPos.x
      const dy = t.clientY - this.touchStartPos.y
      if (this.boxSelect) {
        if (!this.touchMoved && (Math.abs(dx) > InputManager.TOUCH_DRAG_SLOP || Math.abs(dy) > InputManager.TOUCH_DRAG_SLOP)) {
          this.touchMoved = true
          this.clearLongPress()
          this.boxing = true
          this.boxStart = this.touchStartPos
          this.boxRect = null
        }
        if (this.boxing && this.boxStart) {
          const x0 = Math.min(this.boxStart.x, t.clientX)
          const y0 = Math.min(this.boxStart.y, t.clientY)
          const x1 = Math.max(this.boxStart.x, t.clientX)
          const y1 = Math.max(this.boxStart.y, t.clientY)
          this.boxRect = { x0, y0, x1, y1 }
        }
        return
      }
      if (!this.touchMoved && (Math.abs(dx) > InputManager.TOUCH_DRAG_SLOP || Math.abs(dy) > InputManager.TOUCH_DRAG_SLOP)) {
        this.touchMoved = true
        this.clearLongPress()
        this.singlePanning = true
        this.lastTouchPan = { x: t.clientX, y: t.clientY }
      }
      if (this.singlePanning && this.lastTouchPan) {
        const pdx = t.clientX - this.lastTouchPan.x
        const pdy = t.clientY - this.lastTouchPan.y
        if (pdx !== 0 || pdy !== 0) {
          this.cb.onPan(pdx, pdy)
          this.lastTouchPan = { x: t.clientX, y: t.clientY }
        }
      }
    } else if (this.touchMode === 'dual' && this.touches.size >= 2 && this.dualBase) {
      const [a, b] = Array.from(this.touches.values())
      const midX = (a.x + b.x) / 2
      const midY = (a.y + b.y) / 2
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      if (!this.dualZoom && this.dualBase.dist > 0) {
        const ratio = dist / this.dualBase.dist
        if (Math.abs(ratio - 1) > 0.35) this.dualZoom = true
      }
      if (this.dualZoom) {
        if (dist > 0 && this.dualBase.dist > 0) {
          const factor = dist / this.dualBase.dist
          const rect = this.canvas.getBoundingClientRect()
          this.cb.onZoom(factor, midX - rect.left, midY - rect.top)
        }
        this.dualBase = { midX, midY, dist }
        this.boxRect = null
        this.boxStart = null
        this.boxing = false
      }
    }
  }

  private onTouchEnd = (e: TouchEvent): void => {
    e.preventDefault()
    const lifted: { x: number; y: number }[] = []
    for (const t of Array.from(e.changedTouches)) {
      if (this.touches.has(t.identifier)) {
        lifted.push(this.touches.get(t.identifier)!)
        this.touches.delete(t.identifier)
      }
    }
    if (this.touchMode === 'dual') {
      this.dualZoom = false
      this.dualBase = null
      this.boxRect = null
      this.boxStart = null
      this.boxing = false
      if (this.touches.size === 1) {
        const rest = Array.from(this.touches.values())[0]
        this.updateTouchWorld(rest.x, rest.y)
        this.beginSingle(rest.x, rest.y)
      } else {
        this.touchMode = 'none'
      }
      if (this.touches.size === 0) this.touchActive = false
      return
    }
    if (lifted.length > 0) this.endSingle(lifted[0].x, lifted[0].y)
    if (this.touches.size === 1) {
      const rest = Array.from(this.touches.values())[0]
      this.updateTouchWorld(rest.x, rest.y)
      this.beginSingle(rest.x, rest.y)
      return
    }
    this.touchActive = false
  }

  private onTouchCancel = (e: TouchEvent): void => {
    e.preventDefault()
    this.touchActive = false
    this.cancelTouchGesture()
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.key.toLowerCase() === getControls().mod?.toLowerCase()) this.ctrl = true
    if (e.key === 'Shift') this.shift = true
    if (e.key === 'Alt') this.alt = true
    if (e.key.toLowerCase() === getControls().attackMove?.toLowerCase()) this.aKey = true
  }

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.key.toLowerCase() === getControls().mod?.toLowerCase()) this.ctrl = false
    if (e.key === 'Shift') this.shift = false
    if (e.key === 'Alt') this.alt = false
    if (e.key.toLowerCase() === getControls().attackMove?.toLowerCase()) this.aKey = false
  }
}
