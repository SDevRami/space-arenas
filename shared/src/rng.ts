export class RNG {
  private s: bigint

  constructor(seed: number) {
    this.s = BigInt(Math.floor(seed) >>> 0)
  }

  private next64(): bigint {
    this.s = (this.s + 0x9e3779b97f4a7c15n) & 0xffffffffffffffffn
    let z = this.s
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & 0xffffffffffffffffn
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & 0xffffffffffffffffn
    return z ^ (z >> 31n)
  }

  next(): number {
    return Number(BigInt.asUintN(32, this.next64()))
  }

  nextInt(lo: number, hi: number): number {
    const range = hi - lo
    if (range <= 0) return lo
    return lo + (this.next() % range)
  }

  clone(): RNG {
    const r = new RNG(0)
    r.s = this.s
    return r
  }

  state32(): number {
    return Number(BigInt.asUintN(32, this.s))
  }
}

export const hashSeed = (str: string): number => {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
