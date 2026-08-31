import type { WorldGrid } from '../core/world.ts'

export interface PathCosts {
  straight: number
  diagonal: number
}

const DEFAULT_COSTS: PathCosts = { straight: 10, diagonal: 14 }

const scratch: {
  area: number
  g: Int32Array | null
  closed: Uint8Array | null
  parent: Int32Array | null
  heapIdx: Int32Array | null
  heapScore: Float64Array | null
} = { area: 0, g: null, closed: null, parent: null, heapIdx: null, heapScore: null }

const ensureScratch = (area: number): {
  g: Int32Array
  closed: Uint8Array
  parent: Int32Array
  heapIdx: Int32Array
  heapScore: Float64Array
} => {
  if (scratch.area !== area) {
    scratch.area = area
    scratch.g = new Int32Array(area)
    scratch.closed = new Uint8Array(area)
    scratch.parent = new Int32Array(area)
    scratch.heapIdx = new Int32Array(area)
    scratch.heapScore = new Float64Array(area)
  }
  return {
    g: scratch.g!,
    closed: scratch.closed!,
    parent: scratch.parent!,
    heapIdx: scratch.heapIdx!,
    heapScore: scratch.heapScore!,
  }
}

export const lineClear = (grid: WorldGrid, x0: number, y0: number, x1: number, y1: number): boolean => {
  const { width, passable } = grid
  const dx = Math.abs(x1 - x0)
  const dy = -Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let err = dx + dy
  for (;;) {
    if (x0 < 0 || y0 < 0 || x0 >= grid.width || y0 >= grid.height) return false
    if (!passable[y0 * width + x0]) return false
    if (x0 === x1 && y0 === y1) break
    const e2 = 2 * err
    if (e2 >= dy) {
      err += dy
      x0 += sx
    }
    if (e2 <= dx) {
      err += dx
      y0 += sy
    }
  }
  return true
}

export const findPath = (
  grid: WorldGrid,
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  maxNodes = 8000,
  costs: PathCosts = DEFAULT_COSTS,
): number[] | null | undefined => {
  const { width, height, passable, component } = grid
  if (sx < 0 || sy < 0 || tx < 0 || ty < 0 || sx >= width || sy >= height || tx >= width || ty >= height) {
    return null
  }
  const start = sy * width + sx
  const goal = ty * width + tx
  if (!passable[start] || !passable[goal]) return null
  if (component && component[start] !== component[goal]) return null

  const area = width * height
  const { g, closed, parent, heapIdx, heapScore } = ensureScratch(area)
  g.fill(-1)
  closed.fill(0)
  parent.fill(-1)
  let heapSize = 0

  const push = (idx: number, score: number): void => {
    let i = heapSize++
    heapIdx[i] = idx
    heapScore[i] = score
    while (i > 0) {
      const p = (i - 1) >> 1
      if (heapScore[p] <= heapScore[i]) break
      const ti = heapIdx[i]
      heapIdx[i] = heapIdx[p]
      heapIdx[p] = ti
      const ts = heapScore[i]
      heapScore[i] = heapScore[p]
      heapScore[p] = ts
      i = p
    }
  }

  const pop = (): number => {
    const top = heapIdx[0]
    heapSize--
    if (heapSize > 0) {
      heapIdx[0] = heapIdx[heapSize]
      heapScore[0] = heapScore[heapSize]
      let i = 0
      for (;;) {
        const l = i * 2 + 1
        const r = l + 1
        let s = i
        if (l < heapSize && heapScore[l] < heapScore[s]) s = l
        if (r < heapSize && heapScore[r] < heapScore[s]) s = r
        if (s === i) break
        const ti = heapIdx[i]
        heapIdx[i] = heapIdx[s]
        heapIdx[s] = ti
        const ts = heapScore[i]
        heapScore[i] = heapScore[s]
        heapScore[s] = ts
        i = s
      }
    }
    return top
  }

  const D = costs.straight
  const D2 = costs.diagonal
  const h = (x: number, y: number): number => {
    const dx = Math.abs(tx - x)
    const dy = Math.abs(ty - y)
    const mn = Math.min(dx, dy)
    return D2 * mn + D * (dx + dy - 2 * mn)
  }

  g[start] = 0
  push(start, h(sx, sy))

  let nodes = 0
  while (heapSize > 0) {
    if (++nodes > maxNodes) return undefined
    const cur = pop()
    if (closed[cur]) continue
    closed[cur] = 1
    if (cur === goal) {
      const path: number[] = []
      let node = goal
      while (node !== start && node !== -1) {
        path.push(node)
        node = parent[node]
      }
      path.reverse()
      return path
    }
    const cx = cur % width
    const cy = Math.floor(cur / width)
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue
        const nx = cx + dx
        const ny = cy + dy
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        if (dx !== 0 && dy !== 0) {
          if (!passable[cy * width + nx] || !passable[ny * width + cx]) continue
        }
        const ni = ny * width + nx
        if (!passable[ni] || closed[ni]) continue
        const cost = dx !== 0 && dy !== 0 ? D2 : D
        const ng = g[cur] + cost
        if (g[ni] === -1 || ng < g[ni]) {
          g[ni] = ng
          parent[ni] = cur
          push(ni, ng + h(nx, ny))
        }
      }
    }
  }
  return null
}

const nearestPassable = (grid: WorldGrid, tx: number, ty: number, maxRadius: number): Array<[number, number]> => {
  const out: Array<[number, number]> = []
  for (let r = 1; r <= maxRadius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
        const nx = tx + dx
        const ny = ty + dy
        if (nx < 0 || ny < 0 || nx >= grid.width || ny >= grid.height) continue
        if (grid.passable[ny * grid.width + nx]) out.push([nx, ny])
      }
    }
  }
  out.sort((a, b) => Math.abs(a[0] - tx) + Math.abs(a[1] - ty) - (Math.abs(b[0] - tx) + Math.abs(b[1] - ty)))
  return out
}

export const findPathNear = (
  grid: WorldGrid,
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  maxRadius = 5,
  maxNodes = 8000,
  costs: PathCosts = DEFAULT_COSTS,
): number[] | null | undefined => {
  if (tx >= 0 && ty >= 0 && tx < grid.width && ty < grid.height && grid.passable[ty * grid.width + tx]) {
    const p = findPath(grid, sx, sy, tx, ty, maxNodes, costs)
    return p
  }
  const candidates = nearestPassable(grid, tx, ty, maxRadius)
  for (const [nx, ny] of candidates.slice(0, 3)) {
    const p = findPath(grid, sx, sy, nx, ny, maxNodes, costs)
    if (p !== null && p !== undefined) return p
    if (p === undefined) return undefined
  }
  return null
}

export const nearestPassablePoint = (grid: WorldGrid, tx: number, ty: number, maxRadius = 8): { x: number; y: number } | null => {
  const candidates = nearestPassable(grid, tx, ty, maxRadius)
  if (candidates.length === 0) return null
  const [nx, ny] = candidates[0]
  return { x: nx * 1000 + 500, y: ny * 1000 + 500 }
}

export const sameComponent = (grid: WorldGrid, ax: number, ay: number, bx: number, by: number): boolean => {
  const a = ay * grid.width + ax
  const b = by * grid.width + bx
  if (!grid.passable[a] || !grid.passable[b]) return false
  if (!grid.component) return true
  return grid.component[a] === grid.component[b]
}
