export const ISO_HALF_W = 32
export const ISO_HALF_H = 16

export interface CameraView {
  zoom: number
  camX: number
  camY: number
}

export class Camera implements CameraView {
  zoom = 1
  camX = 0
  camY = 0
  /** Camera zoom-out floor (dev-settings adjustable, wider in replays). */
  zoomMin = 0.5
  /** Camera zoom-in ceiling (dev-settings adjustable, deeper in replays). */
  zoomMax = 2.5

  constructor(
    private viewportW: number,
    private viewportH: number,
  ) {}

  setZoomRange(min: number, max: number): void {
    if (Number.isFinite(min) && min > 0) this.zoomMin = min
    if (Number.isFinite(max) && max > this.zoomMin) this.zoomMax = max
    this.zoom = Math.max(this.zoomMin, Math.min(this.zoomMax, this.zoom))
  }

  get viewWidth(): number {
    return this.viewportW
  }

  get viewHeight(): number {
    return this.viewportH
  }

  worldSize(mapW: number, mapH: number): { w: number; h: number } {
    return { w: (mapW + mapH) * ISO_HALF_W, h: (mapW + mapH) * ISO_HALF_H }
  }

  centerOnMap(mapW: number, mapH: number): void {
    const s = this.worldSize(mapW, mapH)
    this.camX = this.viewportW / (2 * this.zoom)
    this.camY = this.viewportH / (2 * this.zoom) - s.h / 2
  }

  centerOn(worldFxX: number, worldFxY: number): void {
    const isoX = (worldFxX / 1000 - worldFxY / 1000) * ISO_HALF_W
    const isoY = (worldFxX / 1000 + worldFxY / 1000) * ISO_HALF_H
    this.camX = this.viewportW / (2 * this.zoom) - isoX
    this.camY = this.viewportH / (2 * this.zoom) - isoY
  }

  worldToScreen(xFx: number, yFx: number, out: { x: number; y: number }): void {
    const tx = xFx / 1000
    const ty = yFx / 1000
    const isoX = (tx - ty) * ISO_HALF_W
    const isoY = (tx + ty) * ISO_HALF_H
    out.x = (isoX + this.camX) * this.zoom
    out.y = (isoY + this.camY) * this.zoom
  }

  screenToWorld(px: number, py: number): { x: number; y: number } {
    const a = (px / this.zoom - this.camX) / ISO_HALF_W
    const b = (py / this.zoom - this.camY) / ISO_HALF_H
    const tx = (a + b) / 2
    const ty = (b - a) / 2
    return { x: Math.floor(tx) * 1000 + 500, y: Math.floor(ty) * 1000 + 500 }
  }

  screenToWorldExact(px: number, py: number): { x: number; y: number } {
    const a = (px / this.zoom - this.camX) / ISO_HALF_W
    const b = (py / this.zoom - this.camY) / ISO_HALF_H
    const tx = (a + b) / 2
    const ty = (b - a) / 2
    return { x: tx * 1000, y: ty * 1000 }
  }

  panBy(dxPx: number, dyPx: number): void {
    this.camX += dxPx / this.zoom
    this.camY += dyPx / this.zoom
  }

  zoomAt(px: number, py: number, factor: number): void {
    const sx0 = px / this.zoom - this.camX
    const sy0 = py / this.zoom - this.camY
    this.zoom = Math.max(this.zoomMin, Math.min(this.zoomMax, this.zoom * factor))
    this.camX = px / this.zoom - sx0
    this.camY = py / this.zoom - sy0
  }

  isInView(sx: number, sy: number, margin = 64): boolean {
    return sx >= -margin && sx <= this.viewportW + margin && sy >= -margin && sy <= this.viewportH + margin
  }

  isInViewBox(sx: number, sy: number, halfW: number, halfH: number, margin = 64): boolean {
    return (
      sx + halfW >= -margin &&
      sx - halfW <= this.viewportW + margin &&
      sy + halfH >= -margin &&
      sy - halfH <= this.viewportH + margin
    )
  }

  resize(w: number, h: number): void {
    this.viewportW = w
    this.viewportH = h
  }
}
