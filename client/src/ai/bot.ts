import {
  getBuilding,
  getUnit,
  getUpgrade,
  sqDist,
  type BotDifficulty,
  type EnvelopeCommand,
  type SimCommand,
} from '@space-arenas/shared'
import type { World } from '../core/world.ts'
import type { Simulator } from '../core/Simulator.ts'

export type { BotDifficulty }

export const BOT_DIFFICULTIES: BotDifficulty[] = ['easy', 'medium', 'hard']

export interface BotBuildTarget {
  type: string
  limit: number
}

export interface BotConfig {
  decisionInterval: number
  reserve: number
  hardFloor: number
  armyThreshold: number
  attackInterval: number
  powerMargin: number
  harvesterCap: number
  scoutCount: number
  targets: BotBuildTarget[]
  production: string[]
  maintainDozers: number
}

export const BOT_CONFIGS: Record<BotDifficulty, BotConfig> = {
  easy: {
    decisionInterval: 40,
    reserve: 140,
    hardFloor: 260,
    armyThreshold: 6,
    attackInterval: 1200,
    powerMargin: 2,
    harvesterCap: 4,
    scoutCount: 1,
    targets: [
      { type: 'supply-dock', limit: 1 },
      { type: 'barracks', limit: 1 },
      { type: 'power-plant', limit: 1 },
      { type: 'turret', limit: 1 },
    ],
    production: ['command-center', 'supply-dock', 'barracks'],
    maintainDozers: 1,
  },
  medium: {
    decisionInterval: 30,
    reserve: 120,
    hardFloor: 200,
    armyThreshold: 5,
    attackInterval: 650,
    powerMargin: 3,
    harvesterCap: 6,
    scoutCount: 1,
    targets: [
      { type: 'supply-dock', limit: 1 },
      { type: 'barracks', limit: 1 },
      { type: 'power-plant', limit: 1 },
      { type: 'supply-dock', limit: 2 },
      { type: 'turret', limit: 1 },
    ],
    production: ['command-center', 'supply-dock', 'barracks'],
    maintainDozers: 2,
  },
  hard: {
    decisionInterval: 18,
    reserve: 110,
    hardFloor: 160,
    armyThreshold: 4,
    attackInterval: 400,
    powerMargin: 5,
    harvesterCap: 8,
    scoutCount: 1,
    targets: [
      { type: 'supply-dock', limit: 1 },
      { type: 'barracks', limit: 2 },
      { type: 'power-plant', limit: 2 },
      { type: 'supply-dock', limit: 2 },
      { type: 'war-factory', limit: 1 },
      { type: 'tech-center', limit: 1 },
      { type: 'turret', limit: 3 },
    ],
    production: ['command-center', 'supply-dock', 'barracks', 'war-factory'],
    maintainDozers: 3,
  },
}

const ATTACK_PRIORITY: Record<string, number> = {
  'war-factory': 6,
  barracks: 5,
  'tech-center': 4,
  turret: 4,
  'supply-dock': 3,
  'power-plant': 2,
  'command-center': 1,
}

const findBuildSpot = (
  world: World,
  team: number,
  footprintW: number,
  footprintH: number,
  anchorId: number,
): { x: number; y: number } | null => {
  world.rebuildGridIfDirty()
  const grid = world.grid
  const anchor = world.transforms.get(anchorId)
  const fog = world.fog.get(team)
  if (!grid || !anchor) return null
  const ax = Math.floor(anchor.x / 1000)
  const ay = Math.floor(anchor.y / 1000)
  const overlaps = (x: number, y: number): boolean => {
    let hit = false
    world.buildings.forEach((_id, b) => {
      if (hit) return
      const bt = world.transforms.get(_id)
      if (!bt) return
      const bx = Math.floor((bt.x - b.footprintW * 500) / 1000)
      const by = Math.floor((bt.y - b.footprintH * 500) / 1000)
      const pad = 2
      if (x < bx + b.footprintW + pad && bx - pad < x + footprintW && y < by + b.footprintH + pad && by - pad < y + footprintH) hit = true
    })
    return hit
  }
  for (let ring = 1; ring <= 24; ring++) {
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue
        const x = ax + dx
        const y = ay + dy
        if (x < 0 || y < 0 || x + footprintW > world.width || y + footprintH > world.height) continue
        let ok = true
        for (let yy = y; yy < y + footprintH; yy++) {
          for (let xx = x; xx < x + footprintW; xx++) {
            const idx = yy * world.width + xx
            if (!grid.buildable[idx]) {
              ok = false
              break
            }
            if (fog && fog[idx] < 1) {
              ok = false
              break
            }
          }
          if (!ok) break
        }
        if (!ok || overlaps(x, y)) continue
        return { x, y }
      }
    }
  }
  return null
}

export class BotPlayer {
  private decisionTimer: number
  private attackTimer: number

  constructor(
    private readonly sim: Simulator,
    readonly team: number,
    readonly difficulty: BotDifficulty,
  ) {
    this.decisionTimer = this.config.decisionInterval
    this.attackTimer = this.config.attackInterval
  }

  get config(): BotConfig {
    return BOT_CONFIGS[this.difficulty]
  }

  tick(): EnvelopeCommand[] {
    const world = this.sim.world
    if (world.gameOver !== null) return []
    this.decisionTimer--
    this.attackTimer--
    const cmds: SimCommand[] = []
    if (this.decisionTimer <= 0) {
      this.decisionTimer = this.config.decisionInterval
      cmds.push(...this.decideBuild(world))
      cmds.push(...this.decideQueue(world))
      cmds.push(...this.decideResearch(world))
      cmds.push(...this.decideOil(world))
      const army = this.combatUnits(world)
      if (army.length >= this.config.armyThreshold) {
        cmds.push(...this.decideReinforce(world, army))
      }
    }
    if (this.attackTimer <= 0) {
      this.attackTimer = this.config.attackInterval
      const army = this.combatUnits(world)
      if (army.length > 0) {
        cmds.push(...this.decideAttack(world, army))
      }
    }
    return cmds.map((cmd) => this.sim.makeCommand(this.team, cmd))
  }

  private onAttackMove(world: World, id: number): boolean {
    const a = world.attacks.get(id)
    if (a && a.target !== null) return true
    const m = world.moves.get(id)
    return m !== undefined && m.attackMove
  }

  private decideReinforce(world: World, army: number[]): SimCommand[] {
    const split = this.isGroundSplit(world)
    const idle = army.filter((id) => {
      if (this.onAttackMove(world, id)) return false
      const u = world.units.get(id)
      if (!u) return false
      return split ? u.class === 'air' : u.class !== 'air'
    })
    if (idle.length === 0) return []
    if (split) {
      const t = this.airTarget(world)
      if (!t) return []
      return [{ type: 'attack-move', entities: idle, x: t.x, y: t.y, target: t.target ?? undefined }]
    }
    const target = this.enemyTarget(world, idle)
    if (!target) return []
    return [{ type: 'attack-move', entities: idle, x: target.x, y: target.y, target: target.target ?? undefined }]
  }

  private combatUnits(world: World): number[] {
    const out: number[] = []
    world.units.forEach((id, u) => {
      if (u.team === this.team && world.attacks.has(id)) out.push(id)
    })
    return out
  }

  private decideBuild(world: World): SimCommand[] {
    const out: SimCommand[] = []
    const team = this.team
    const ts = world.teamState(team)
    const count = (type: string): number => {
      let n = 0
      world.buildings.forEach((_id, b) => {
        if (b.buildingType === type && b.team === team) n++
      })
      return n
    }
    const doneCount = (type: string): number => {
      let n = 0
      world.buildings.forEach((_id, b) => {
        if (b.buildingType === type && b.team === team && b.done) n++
      })
      return n
    }
    const freeDozer = (): number | undefined => {
      let found: number | undefined
      world.units.forEach((id, u) => {
        if (found === undefined && u.team === team && u.unitType === 'bulldozer' && !world.works.has(id)) found = id
      })
      return found
    }

    const supplyDone = doneCount('supply-dock') > 0
    const ref = this.referenceBuilding(world)
    const assigned = new Set<number>()
    let spend = 0
    const targets = this.isGroundSplit(world)
      ? [...this.config.targets, { type: 'air-force', limit: 1 }]
      : this.config.targets
    for (const target of targets) {
      const { type, limit } = target
      if (count(type) >= limit) continue
      const def = getBuilding(type, world.settings)
      if (def.countLimit !== undefined && count(type) >= def.countLimit) continue
      if (type === 'turret') {
        if (doneCount('barracks') === 0 && doneCount('war-factory') === 0) continue
      }
      if (!supplyDone && type !== 'supply-dock' && type !== 'power-plant') continue
      const isFirstDock = type === 'supply-dock' && count(type) === 0
      if (!isFirstDock && type !== 'power-plant' && def.powerUse > 0 && ts.powerNet - def.powerUse < this.config.powerMargin) continue
      const floor = type === 'supply-dock' ? this.config.reserve : this.config.hardFloor
      if (ts.credits - spend < def.cost + floor) continue
      for (;;) {
        if (assigned.size >= 2) break
        const d = freeDozer()
        if (d === undefined || assigned.has(d)) break
        const spot = ref !== undefined ? findBuildSpot(world, team, def.footprint[0], def.footprint[1], ref) : null
        if (spot === null) break
        assigned.add(d)
        spend += def.cost
        out.push({ type: 'place', entities: [d], x: spot.x, y: spot.y, buildingType: type })
        if (count(type) + assigned.size >= limit) break
        if (ts.credits - spend < def.cost + floor) break
      }
    }
    return out
  }

  private decideQueue(world: World): SimCommand[] {
    const out: SimCommand[] = []
    const team = this.team
    const ts = world.teamState(team)
    let spend = 0
    let harvesters = 0
    world.units.forEach((_id, u) => {
      if (u.team === team && u.unitType === 'harvester') harvesters++
    })
    world.queues.forEach((id, q) => {
      const b = world.buildings.get(id)
      if (!b || b.team !== team) return
      for (const o of q.queue) {
        if (o.unitType === 'harvester') harvesters++
      }
    })
    let pendingDozers = 0
    let scoutPending = 0
    const queuedScout = (): number => {
      let n = 0
      world.queues.forEach((_qid, q) => {
        const b = world.buildings.get(_qid)
        if (!b || b.team !== team) return
        for (const o of q.queue) {
          if (o.unitType === 'scout') n++
        }
      })
      return n
    }
    const unownedOil = this.unownedOilCount(world)
    const split = this.isGroundSplit(world)
    const armyReady = this.combatUnits(world).length >= this.config.armyThreshold
    world.buildings.forEach((id, b) => {
      if (b.team !== team || !b.done) return
      const def = getBuilding(b.buildingType, world.settings)
      if (!def || !def.producesUnit) return
      if (split && b.buildingType === 'air-force') {
        let airCount = 0
        world.planes.forEach((_pid, p) => {
          if (p.home === id) airCount++
        })
        const q = world.queues.get(id)
        if (q) {
          for (const o of q.queue) {
            const od = getUnit(o.unitType, world.settings)
            if (od.class === 'air') airCount++
          }
        }
        const ud = getUnit('fighter', world.settings)
        const cap = ud.capacity ?? 3
        if (airCount >= cap) return
        if (q && q.queue.length >= world.settings.queueLimit) return
        if (ts.credits - spend < ud.cost + this.config.reserve) return
        spend += ud.cost
        out.push({ type: 'queue', entities: [id], x: 0, y: 0, unitType: 'fighter' })
        return
      }
      if (!this.config.production.includes(b.buildingType)) return
      if (unownedOil > 0 && armyReady && !split && b.buildingType === 'barracks' && this.scoutCountOf(world) + queuedScout() + scoutPending < this.config.scoutCount) {
        const q = world.queues.get(id)
        if (q && q.queue.length >= world.settings.queueLimit) return
        const sd = getUnit('scout', world.settings)
        if (ts.credits - spend < sd.cost + this.config.reserve) return
        scoutPending++
        spend += sd.cost
        out.push({ type: 'queue', entities: [id], x: 0, y: 0, unitType: 'scout' })
        return
      }
      if (def.producesUnit === 'harvester' && harvesters >= this.config.harvesterCap) return
      if (b.buildingType === 'command-center') {
        const queuedDozers = (world.queues.get(id)?.queue.filter((o) => o.unitType === 'bulldozer').length ?? 0) + pendingDozers
        if (this.dozerCount(world) + queuedDozers >= this.config.maintainDozers) return
        pendingDozers++
      }
      const q = world.queues.get(id)
      if (q && q.queue.length >= world.settings.queueLimit) return
      const ud = getUnit(def.producesUnit, world.settings)
      if (ts.credits - spend < ud.cost + this.config.reserve) return
      spend += ud.cost
      out.push({ type: 'queue', entities: [id], x: 0, y: 0, unitType: def.producesUnit })
    })
    return out
  }

  private decideResearch(world: World): SimCommand[] {    const out: SimCommand[] = []
    const team = this.team
    const ts = world.teamState(team)
    if (ts.radar && ts.satellite) return out
    const upgradeId = ts.radar ? 'satellite' : 'radar'
    world.buildings.forEach((id, b) => {
      if (b.team !== team || !b.done || b.buildingType !== 'tech-center') return
      if (b.researchQueue.length > 0) return
      const up = getUpgrade(upgradeId, world.settings)
      if (ts.credits < up.cost + this.config.reserve) return
      out.push({ type: 'research', entities: [id], x: 0, y: 0, upgrade: upgradeId })
    })
    return out
  }

  private unownedOilCount(world: World): number {
    let n = 0
    world.oilFields.forEach((_id, f) => {
      if (f.owner < 0) n++
    })
    return n
  }

  private scoutCountOf(world: World): number {
    let n = 0
    world.units.forEach((_id, u) => {
      if (u.team === this.team && u.unitType === 'scout') n++
    })
    return n
  }

  private oilClaimPoint(world: World, fieldId: number, scoutId: number): { x: number; y: number } | null {
    world.rebuildGridIfDirty()
    const grid = world.grid
    if (!grid) return null
    const f = world.oilFields.get(fieldId)
    const fc = world.transforms.get(fieldId)
    const st = world.transforms.get(scoutId)
    if (!f || !fc) return null
    const r = f.radius
    const fromX = st ? st.x : fc.x
    const fromY = st ? st.y : fc.y
    const sides: Array<{ x: number; y: number }> = [
      { x: fc.x - (r + 1) * 1000, y: fc.y },
      { x: fc.x + (r + 1) * 1000, y: fc.y },
      { x: fc.x, y: fc.y - (r + 1) * 1000 },
      { x: fc.x, y: fc.y + (r + 1) * 1000 },
    ]
    sides.sort((a, b) => sqDist(a.x, a.y, fromX, fromY) - sqDist(b.x, b.y, fromX, fromY))
    for (const s of sides) {
      const tx = Math.floor(s.x / 1000)
      const ty = Math.floor(s.y / 1000)
      if (tx < 0 || ty < 0 || tx >= world.width || ty >= world.height) continue
      if (!grid.passable[ty * world.width + tx]) continue
      return s
    }
    return null
  }

  private decideOil(world: World): SimCommand[] {
    const out: SimCommand[] = []
    const unowned: number[] = []
    world.oilFields.forEach((id, f) => {
      if (f.owner < 0) unowned.push(id)
    })
    if (unowned.length === 0) return out
    const assignedFields = new Set<number>()
    world.units.forEach((id, u) => {
      if (u.team !== this.team || u.unitType !== 'scout') return
      const st = world.transforms.get(id)
      if (!st) return
      let best = -1
      let bestD = Infinity
      for (const fid of unowned) {
        if (assignedFields.has(fid)) continue
        const ft = world.transforms.get(fid)
        if (!ft) continue
        const d = sqDist(st.x, st.y, ft.x, ft.y)
        if (d < bestD) {
          bestD = d
          best = fid
        }
      }
      if (best < 0) return
      const p = this.oilClaimPoint(world, best, id)
      if (!p) return
      assignedFields.add(best)
      world.rebuildGridIfDirty()
      const grid = world.grid
      if (grid && grid.component) {
        const st = world.transforms.get(id)
        if (st) {
          const si = Math.floor(st.y / 1000) * world.width + Math.floor(st.x / 1000)
          const pi = Math.floor(p.y / 1000) * world.width + Math.floor(p.x / 1000)
          if (grid.passable[si] && grid.passable[pi] && grid.component[si] !== grid.component[pi]) return
        }
      }
      const m = world.moves.get(id)
      if (m && m.tx === p.x && m.ty === p.y) return
      out.push({ type: 'move', entities: [id], x: p.x, y: p.y })
    })
    return out
  }

  private decideAttack(world: World, army: number[]): SimCommand[] {
    const cmds: SimCommand[] = []
    const air: number[] = []
    const ground: number[] = []
    for (const id of army) {
      const u = world.units.get(id)
      if (!u) continue
      if (u.class === 'air') air.push(id)
      else ground.push(id)
    }
    const split = this.isGroundSplit(world)
    if (ground.length > 0 && !split) {
      const t = this.enemyTarget(world, ground)
      if (t) cmds.push({ type: 'attack-move', entities: ground, x: t.x, y: t.y, target: t.target ?? undefined })
    }
    if (air.length > 0) {
      const t = this.airTarget(world)
      if (t) cmds.push({ type: 'attack-move', entities: air, x: t.x, y: t.y, target: t.target ?? undefined })
    }
    return cmds
  }

  private enemyTarget(world: World, army: number[]): { target: number | null; x: number; y: number } | null {
    world.rebuildGridIfDirty()
    const grid = world.grid
    if (!grid) return null
    let sx = 0
    let sy = 0
    let n = 0
    for (const id of army) {
      const t = world.transforms.get(id)
      if (!t) continue
      sx += t.x
      sy += t.y
      n++
    }
    const px = n > 0 ? sx / n : 0
    const py = n > 0 ? sy / n : 0

    let best = -1
    let bestScore = -Infinity
    world.buildings.forEach((id, b) => {
      if (world.sameTeam(this.team, b.team)) return
      if (b.buildingType !== 'command-center' && !b.done) return
      const t = world.transforms.get(id)
      if (!t) return
      const d = Math.sqrt(sqDist(t.x, t.y, px, py))
      const priority = ATTACK_PRIORITY[b.buildingType] ?? 1
      const score = priority * 20000 - d
      if (score > bestScore) {
        bestScore = score
        best = id
      }
    })
    if (best >= 0) {
      const bt = world.transforms.require(best)
      const b = world.buildings.require(best)
      const bx = Math.floor((bt.x - b.footprintW * 500) / 1000)
      const by = Math.floor((bt.y - b.footprintH * 500) / 1000)
      const spot = this.rallySpot(world, grid, bx, by, b.footprintW, b.footprintH, px, py)
      if (spot) return { target: best, x: spot.x, y: spot.y }
    }

    const spawn = world.map.spawnPoints.find((s) => !world.sameTeam(this.team, s.team))
    if (!spawn) return null
    const spot = this.rallySpot(world, grid, spawn.x, spawn.y, 1, 1, px, py)
    if (!spot) return null
    return { target: null, x: spot.x, y: spot.y }
  }

  private airTarget(world: World): { target: number; x: number; y: number } | null {
    world.rebuildGridIfDirty()
    const grid = world.grid
    if (!grid) return null
    let best = -1
    let bestScore = -Infinity
    world.buildings.forEach((id, b) => {
      if (world.sameTeam(this.team, b.team)) return
      if (b.buildingType !== 'command-center' && !b.done) return
      const t = world.transforms.get(id)
      if (!t) return
      const priority = ATTACK_PRIORITY[b.buildingType] ?? 1
      const score = priority * 20000 - Math.floor(t.x / 10) - Math.floor(t.y / 10)
      if (score > bestScore) {
        bestScore = score
        best = id
      }
    })
    if (best < 0) return null
    const bt = world.transforms.require(best)
    const b = world.buildings.require(best)
    const bx = Math.floor((bt.x - b.footprintW * 500) / 1000)
    const by = Math.floor((bt.y - b.footprintH * 500) / 1000)
    const spot = this.rallySpot(world, grid, bx, by, b.footprintW, b.footprintH, bt.x, bt.y)
    return { target: best, x: spot?.x ?? bt.x, y: spot?.y ?? bt.y }
  }

  /** True when no enemy spawn point shares a walkable region with this bot's own spawn (river-separated map). */
  private isGroundSplit(world: World): boolean {
    world.rebuildGridIfDirty()
    const grid = world.grid
    if (!grid || !grid.component) return false
    let myComp = 0
    for (const s of world.map.spawnPoints) {
      if (world.sameTeam(this.team, s.team)) {
        const idx = s.y * world.width + s.x
        if (grid.passable[idx]) {
          myComp = grid.component[idx]
          break
        }
      }
    }
    if (myComp === 0) return false
    for (const s of world.map.spawnPoints) {
      if (world.sameTeam(this.team, s.team)) continue
      const idx = s.y * world.width + s.x
      if (grid.passable[idx] && grid.component[idx] === myComp) return false
    }
    return true
  }

  private rallySpot(
    world: World,
    grid: { passable: Uint8Array },
    bx: number,
    by: number,
    fw: number,
    fh: number,
    px: number,
    py: number,
  ): { x: number; y: number } | null {
    let best: { x: number; y: number } | null = null
    let bestD = Infinity
    for (let r = 1; r <= 5; r++) {
      for (let dy = -r; dy < fh + r; dy++) {
        for (let dx = -r; dx < fw + r; dx++) {
          const ox = Math.max(-dx, dx - (fw - 1), 0)
          const oy = Math.max(-dy, dy - (fh - 1), 0)
          if (ox + oy !== r) continue
          const tx = bx + dx
          const ty = by + dy
          if (tx < 0 || ty < 0 || tx >= world.width || ty >= world.height) continue
          if (!grid.passable[ty * world.width + tx]) continue
          const tpx = tx * 1000 + 500
          const tpy = ty * 1000 + 500
          const d = sqDist(tpx, tpy, px, py)
          if (d < bestD) {
            bestD = d
            best = { x: tpx, y: tpy }
          }
        }
      }
    }
    return best
  }

  private referenceBuilding(world: World): number | undefined {
    let ref: number | undefined
    world.buildings.forEach((id, b) => {
      if (ref === undefined && b.team === this.team && b.done && b.buildingType === 'command-center') ref = id
    })
    if (ref !== undefined) return ref
    world.buildings.forEach((id, b) => {
      if (ref === undefined && b.team === this.team && b.done) ref = id
    })
    return ref
  }

  private dozerCount(world: World): number {
    let n = 0
    world.units.forEach((_id, u) => {
      if (u.team === this.team && u.unitType === 'bulldozer') n++
    })
    return n
  }
}
