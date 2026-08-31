import { describe, expect, it } from 'vitest'
import { RNG, hashSeed } from '@space-arenas/shared'

describe('rng: splitmix32', () => {
  it('matches the standard SplitMix64 first output (low 32 bits) for seed 0', () => {
    expect(new RNG(0).next()).toBe(0x7b1dcdaf)
  })

  it('is deterministic for equal seeds', () => {
    const a = new RNG(123456)
    const b = new RNG(123456)
    const seqA = Array.from({ length: 100 }, () => a.next())
    const seqB = Array.from({ length: 100 }, () => b.next())
    expect(seqA).toEqual(seqB)
  })

  it('differs for different seeds', () => {
    expect(new RNG(1).next()).not.toBe(new RNG(2).next())
  })

  it('nextInt respects inclusive bounds', () => {
    const r = new RNG(777)
    for (let i = 0; i < 500; i++) {
      const v = r.nextInt(0, 10)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(10)
    }
    for (let i = 0; i < 500; i++) {
      const v = r.nextInt(-5, 5)
      expect(v).toBeGreaterThanOrEqual(-5)
      expect(v).toBeLessThan(5)
    }
  })

  it('clone preserves the stream position', () => {
    const a = new RNG(99)
    a.next()
    const b = a.clone()
    expect(a.next()).toBe(b.next())
  })

  it('state32 changes after drawing', () => {
    const r = new RNG(5)
    const s0 = r.state32()
    r.next()
    expect(r.state32()).not.toBe(s0)
  })
})

describe('rng: hashSeed', () => {
  it('matches the FNV-1a 32-bit vector for "a"', () => {
    expect(hashSeed('a')).toBe(0xe40c292c)
  })

  it('is deterministic', () => {
    expect(hashSeed('space-arenas-map-v1')).toBe(hashSeed('space-arenas-map-v1'))
  })

  it('distinguishes inputs', () => {
    expect(hashSeed('alpha')).not.toBe(hashSeed('beta'))
  })
})
