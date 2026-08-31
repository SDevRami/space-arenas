import type { World } from './world.ts'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export const rectFromCenter = (cxFx: number, cyFx: number, wTiles: number, hTiles: number): Rect => {
  const x = Math.floor((cxFx - wTiles * 500) / 1000)
  const y = Math.floor((cyFx - hTiles * 500) / 1000)
  return { x, y, w: wTiles, h: hTiles }
}

export const rectsOverlap = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

export const rectDistanceTiles = (a: Rect, b: Rect): number => {
  const dx = Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w), 0)
  const dy = Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h), 0)
  return dx + dy
}

export const buildingRect = (world: World, id: number): Rect => {
  const b = world.buildings.require(id)
  const t = world.transforms.require(id)
  return rectFromCenter(t.x, t.y, b.footprintW, b.footprintH)
}

export const containsTile = (r: Rect, x: number, y: number): boolean =>
  x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h
