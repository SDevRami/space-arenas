export class SparseSet<T> {
  private readonly items = new Map<number, T>()
  private readonly ids: number[] = []

  get size(): number {
    return this.ids.length
  }

  has(id: number): boolean {
    return this.items.has(id)
  }

  get(id: number): T | undefined {
    return this.items.get(id)
  }

  require(id: number): T {
    const v = this.items.get(id)
    if (v === undefined) throw new Error(`missing component for entity ${id}`)
    return v
  }

  set(id: number, value: T): void {
    if (!this.items.has(id)) {
      let lo = 0
      let hi = this.ids.length
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (this.ids[mid] < id) lo = mid + 1
        else hi = mid
      }
      this.ids.splice(lo, 0, id)
    }
    this.items.set(id, value)
  }

  delete(id: number): void {
    if (!this.items.delete(id)) return
    const at = this.ids.indexOf(id)
    if (at >= 0) this.ids.splice(at, 1)
  }

  forEach(cb: (id: number, value: T) => void): void {
    for (let i = 0; i < this.ids.length; i++) {
      const id = this.ids[i]
      cb(id, this.items.get(id) as T)
    }
  }

  idsArray(): readonly number[] {
    return this.ids
  }
}
