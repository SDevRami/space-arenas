import type { World } from '../core/world.ts'

export const VisionSystem = {
  name: 'Vision',
  update(world: World): void {
    const { width, height } = world

    world.fog.forEach((fog, _team) => {
      for (let i = 0; i < fog.length; i++) {
        if (fog[i] === 2) fog[i] = 1
      }
    })

    const now = world.tick
    const expired: number[] = []
    world.satelliteMarkers.forEach((id, m) => {
      if (m.untilTick < now) expired.push(id)
    })
    for (const id of expired) {
      const m = world.satelliteMarkers.get(id)
      if (m) {
        world.removeEntity(id)
        const s = world.teams.get(m.team)
        if (s && s.satelliteRevealUntil <= now) s.satelliteRevealUntil = -1
      }
    }

    world.visions.forEach((id, v) => {
      const t = world.transforms.get(id)
      if (!t) return
      const team = world.teamOf(id)
      if (team < 0) return
      const fog = world.fog.get(team)
      if (!fog) return
      const r = v.radius
      const cx = Math.floor(t.x / 1000)
      const cy = Math.floor(t.y / 1000)
      const rSq = r * r
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy > rSq) continue
          const x = cx + dx
          const y = cy + dy
          if (x < 0 || y < 0 || x >= width || y >= height) continue
          fog[y * width + x] = 2
        }
      }
    })

    world.lasers.forEach((lid, l) => {
      const lt = world.transforms.get(lid)
      if (!lt) return
      const fog = world.fog.get(l.team)
      if (!fog) return
      const r = Math.ceil(l.radius)
      const cx = Math.floor(lt.x / 1000)
      const cy = Math.floor(lt.y / 1000)
      const rSq = r * r
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy > rSq) continue
          const x = cx + dx
          const y = cy + dy
          if (x < 0 || y < 0 || x >= width || y >= height) continue
          fog[y * width + x] = 2
        }
      }
    })

    const alliances = new Map<number, number[]>()
    for (const team of world.teams.keys()) {
      const a = world.allianceOf(team)
      const list = alliances.get(a)
      if (list) list.push(team)
      else alliances.set(a, [team])
    }
    if (alliances.size < world.teams.size) {
      for (const members of alliances.values()) {
        if (members.length < 2) continue
        const fogs: Uint8Array[] = []
        for (const team of members) {
          const f = world.fog.get(team)
          if (f) fogs.push(f)
        }
        if (fogs.length < 2) continue
        const primary = fogs[0]
        for (let i = 1; i < fogs.length; i++) {
          const other = fogs[i]
          for (let k = 0; k < primary.length; k++) {
            if (other[k] > primary[k]) primary[k] = other[k]
          }
        }
        for (let i = 1; i < fogs.length; i++) {
          fogs[i].set(primary)
        }
      }
    }
  },
}
