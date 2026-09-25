export const FX = 1000

export const tileToFx = (tile: number): number => tile * FX

export const fxToTile = (fx: number): number => {
  if (fx >= 0) return Math.floor(fx / FX)
  return -Math.ceil(-fx / FX)
}

export const sqDist = (ax: number, ay: number, bx: number, by: number): number => {
  const dx = ax - bx
  const dy = ay - by
  return dx * dx + dy * dy
}

export const isqrt = (n: number): number => {
  if (n <= 0) return 0
  let x = n
  let y = Math.floor((x + 1) / 2)
  while (y < x) {
    x = y
    y = Math.floor((x + Math.floor(n / x)) / 2)
  }
  return x
}

export const dist = (ax: number, ay: number, bx: number, by: number): number => isqrt(sqDist(ax, ay, bx, by))
