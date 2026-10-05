import { describe, expect, it } from 'vitest'
import { Camera } from '../client/src/render/camera.ts'

describe('Camera.isInViewBox', () => {
  const cam = new Camera(400, 300)

  // 4x4 building footprint (sum = 8) at zoom 2.5:
  // halfW = 8 * 32 / 2 * 2.5 = 320, halfH = 8 * 16 / 2 * 2.5 = 160
  const halfW = 320
  const halfH = 160

  it('keeps a building visible while any part of its footprint is on screen', () => {
    expect(cam.isInViewBox(380, 150, halfW, halfH)).toBe(true) // center 20px past right edge
    expect(cam.isInViewBox(-380, 150, halfW, halfH)).toBe(true) // center past left edge
    expect(cam.isInViewBox(200, -160, halfW, halfH)).toBe(true) // top edge exactly on screen edge
  })

  it('culls only once the whole footprint leaves the view', () => {
    expect(cam.isInViewBox(400 + 320 + 100, 150, halfW, halfH)).toBe(false)
    expect(cam.isInViewBox(-400 - 320 - 100, 150, halfW, halfH)).toBe(false)
    expect(cam.isInViewBox(200, 300 + 160 + 100, halfW, halfH)).toBe(false)
  })

  it('still respects the cull margin', () => {
    expect(cam.isInViewBox(400 + 64 + 300, 150, halfW, halfH)).toBe(true)
    expect(cam.isInViewBox(400 + 64 + 400, 150, halfW, halfH)).toBe(false)
  })

  it('degenerates to a point test for a zero-size box', () => {
    expect(cam.isInViewBox(0, 0, 0, 0)).toBe(true)
    expect(cam.isInViewBox(400 + 100, 0, 0, 0)).toBe(false)
  })
})
