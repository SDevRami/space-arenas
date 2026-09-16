import { Terrain, isBuildableTerrain, isPassableTerrain, tileAt, tileToFx, type MapData } from '@space-arenas/shared'
import { RNG } from '@space-arenas/shared'
import type { CampaignConfig } from '../game/match.ts'
import type { World } from '../core/world.ts'
import { setMove, spawnBuilding, spawnUnit } from '../entities/factories.ts'

/** Day 19.3 campaign: a scripted linear chapter (collect troops → rebuild the old base → defend → take the outposts). */

export interface CampaignObjectiveDef {
  id: string
  kind: 'journey' | 'rebuild' | 'defend' | 'attack'
  descKey: string
  target: number
}

export interface SquadDrop {
  tileX: number
  tileY: number
  units: { type: string; count: number }[]
}

export interface CampaignChapter {
  id: string
  titleKey: string
  descriptionKey: string
  map: MapData
  startSquad: { type: string; count: number }[]
  drops: SquadDrop[]
  /** The old base footprint; rebuilding counts only when a command center is placed here. */
  oldBase: { minX: number; minY: number; w: number; h: number }
  enemyOutposts: { tileX: number; tileY: number; towers: number }[]
  waves: { delayTicks: number; units: { type: string; count: number }[] }[]
  assaultReinforcements: { type: string; count: number }[]
  credits: number
}

/** Deterministic chapter map (a fixed seed keeps tests stable and the story the same every run). */
const buildMap = (): MapData => {
  const w = 48
  const h = 48
  const tiles: number[] = new Array<number>(w * h).fill(Terrain.Ground)
  const rng = new RNG(0x5445aa)
  const obs: { type: 'tree'; x: number; y: number; w: number; h: number }[] = []
  for (let i = 0; i < 24; i++) {
    const x = rng.nextInt(2, w - 3)
    const y = rng.nextInt(2, h - 3)
    const nearStart = Math.abs(x - 5) <= 3 && Math.abs(y - 38) <= 3
    const nearBase = Math.abs(x - 13) <= 3 && Math.abs(y - 13) <= 3
    if (nearStart || nearBase) continue
    obs.push({ type: 'tree', x, y, w: 1, h: 1 })
  }
  return {
    schemaVersion: 1,
    format: 'space-arenas-map',
    name: 'Ashes of the Old Base',
    description: 'The old command center fell long ago. March your squad across the scrub, rebuild the base, and drive the invaders out.',
    author: 'campaign',
    mapVersion: '0.1.0',
    width: w,
    height: h,
    tiles,
    obstructions: obs,
    supplyFields: [
      { x: 7, y: 38, radius: 3, capacity: 1200 },
      { x: 16, y: 11, radius: 3, capacity: 1600 },
    ],
    oilFields: [],
    spawnPoints: [
      { x: 4, y: 37, team: 0 },
      { x: 34, y: 7, team: 1 },
    ],
    credits: 750,
  }
}

export const CHAPTER_1: CampaignChapter = {
  id: 'ch1',
  titleKey: 'campaign.ch1.title',
  descriptionKey: 'campaign.ch1.desc',
  map: buildMap(),
  startSquad: [
    { type: 'rifleman', count: 3 },
    { type: 'rocket-trooper', count: 1 },
    { type: 'scout', count: 1 },
  ],
  drops: [
    { tileX: 9, tileY: 30, units: [{ type: 'bulldozer', count: 1 }, { type: 'rifleman', count: 4 }, { type: 'assault-walker', count: 1 }] },
    { tileX: 12, tileY: 23, units: [{ type: 'rifleman', count: 6 }, { type: 'rocket-trooper', count: 2 }] },
    { tileX: 15, tileY: 19, units: [{ type: 'artillery', count: 2 }, { type: 'rocket-trooper', count: 2 }, { type: 'rifleman', count: 2 }] },
  ],
  oldBase: { minX: 11, minY: 11, w: 5, h: 5 },
  enemyOutposts: [
    { tileX: 34, tileY: 7, towers: 2 },
    { tileX: 34, tileY: 27, towers: 2 },
  ],
  waves: [
    { delayTicks: 420, units: [{ type: 'rifleman', count: 6 }, { type: 'rocket-trooper', count: 2 }] },
    { delayTicks: 360, units: [{ type: 'rifleman', count: 7 }, { type: 'rocket-trooper', count: 3 }, { type: 'assault-walker', count: 1 }] },
    { delayTicks: 320, units: [{ type: 'rifleman', count: 8 }, { type: 'rocket-trooper', count: 4 }, { type: 'assault-walker', count: 2 }, { type: 'artillery', count: 1 }] },
  ],
  assaultReinforcements: [
    { type: 'rifleman', count: 6 },
    { type: 'rocket-trooper', count: 2 },
    { type: 'assault-walker', count: 2 },
    { type: 'artillery', count: 1 },
  ],
  credits: 750,
}

export const getChapter = (id: string): CampaignChapter => (id === 'ch1' ? CHAPTER_1 : CHAPTER_1)

export type CampaignPhase = 'journey' | 'rebuild' | 'defend' | 'attack'

export interface CampaignRun {
  chapterId: string
  phase: CampaignPhase
  collectedDrops: number
  dropCount: number
  /** Per-drop flag: a drop's reinforcements join the player only when a squad reaches its tile. */
  dropCollected: boolean[]
  rebuildDone: boolean
  waveIndex: number
  waveSpawnAt: number
  raiderIds: number[]
  assaultStarted: boolean
  enemyOutpostIds: number[]
  done: boolean
  won: boolean
  objectiveKey: string
  objectiveProgress: number
  objectiveTarget: number
}

export const freshCampaignRun = (chapter: CampaignChapter): CampaignRun => ({
  chapterId: chapter.id,
  phase: 'journey',
  collectedDrops: 0,
  dropCount: chapter.drops.length,
  dropCollected: new Array<boolean>(chapter.drops.length).fill(false),
  rebuildDone: false,
  waveIndex: 0,
  waveSpawnAt: 0,
  raiderIds: [],
  assaultStarted: false,
  enemyOutpostIds: [],
  done: false,
  won: false,
  objectiveKey: 'campaign.obj.journey',
  objectiveProgress: 0,
  objectiveTarget: 1,
})

/** Spawn a squad close to (tileX, tileY) using expanding rings so nobody lands on a tree. */
export const spawnSquadNear = (world: World, team: number, tileX: number, tileY: number, squad: { type: string; count: number }[]): number[] => {
  const ids: number[] = []
  const rings = [0, 1, 2, 3, 4]
  for (const g of squad) {
    for (let n = 0; n < g.count; n++) {
      let placed = false
      for (const rr of rings) {
        for (let dx = -rr; dx <= rr && !placed; dx++) {
          for (let dy = -rr; dy <= rr && !placed; dy++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== rr) continue
            const tx = tileX + dx
            const ty = tileY + dy
            if (tx < 0 || ty < 0 || tx >= world.width || ty >= world.height || !isPassableTerrain(tileAt(world.map, tx, ty))) continue
            ids.push(spawnUnit(world, g.type, team, tileToFx(tx) + 500, tileToFx(ty) + 500))
            placed = true
          }
        }
      }
      if (!placed) ids.push(spawnUnit(world, g.type, team, tileToFx(tileX) + 500, tileToFx(tileY) + 500))
    }
  }
  return ids
}

export const spawnEnemyOutpost = (world: World, o: { tileX: number; tileY: number; towers: number }, team: number): number => {
  const cc = spawnBuilding(world, 'command-center', team, o.tileX, o.tileY, true)
  for (let i = 0; i < o.towers; i++) {
    const ax = i === 0 ? o.tileX - 4 : o.tileX + 2
    const ay = i === 0 ? o.tileY : o.tileY - 4
    if (ax >= 0 && ay >= 0 && isBuildableTerrain(tileAt(world.map, ax, ay))) spawnBuilding(world, 'turret', team, ax, ay, true)
  }
  return cc
}

export interface CampaignTickOutcome {
  objectiveKey: string
  objectiveProgress: number
  objectiveTarget: number
  toastKey: string | null
  logKey: string | null
  done: boolean
  winner: number | null
}

const outcome = (run: CampaignRun, o: Partial<CampaignTickOutcome>): CampaignTickOutcome => ({
  objectiveKey: o.objectiveKey ?? run.objectiveKey,
  objectiveProgress: o.objectiveProgress ?? run.objectiveProgress,
  objectiveTarget: o.objectiveTarget ?? run.objectiveTarget,
  toastKey: o.toastKey ?? null,
  logKey: o.logKey ?? null,
  done: o.done ?? run.done,
  winner: o.winner ?? null,
})

const isAt = (world: World, id: number, tileX: number, tileY: number, range: number): boolean => {
  const t = world.transforms.get(id)
  if (!t) return false
  return Math.max(Math.abs(Math.floor(t.x / 1000) - tileX), Math.abs(Math.floor(t.y / 1000) - tileY)) <= range
}

/** The scripted director: place() builds the opening, tick() walks the phases. Runs in the offline sim. */
export class CampaignScript {
  readonly chapter: CampaignChapter
  readonly run: CampaignRun

  constructor(cfg: CampaignConfig, readonly localTeam: number) {
    this.chapter = getChapter(cfg.chapterId)
    this.run = freshCampaignRun(this.chapter)
  }

  /** Lays out the chapter world: strips the machine-made start, drops the squads and enemy outposts. */
  place(world: World): void {
    const remove: number[] = []
    world.buildings.forEach((id, b) => {
      if (b.team === this.localTeam) remove.push(id)
    })
    world.units.forEach((id, u) => {
      if (u.team === this.localTeam) remove.push(id)
    })
    for (const id of remove) world.removeEntity(id)

    spawnSquadNear(world, this.localTeam, 4, 37, this.chapter.startSquad)
    for (const o of this.chapter.enemyOutposts) {
      this.run.enemyOutpostIds.push(spawnEnemyOutpost(world, o, 1))
    }
  }

  tick(world: World): CampaignTickOutcome {
    const run = this.run
    if (run.done) return outcome(run, { done: true, winner: run.won ? this.localTeam : 1 })

    // Raiders always march on the old base while defending.
    if (run.phase === 'defend' && run.raiderIds.length > 0) {
      for (const id of run.raiderIds) {
        if (world.units.has(id)) setMove(world, id, tileToFx(this.chapter.oldBase.minX + 1) + 500, tileToFx(this.chapter.oldBase.minY + 1) + 500)
      }
    }

    if (run.phase === 'journey') {
      for (let i = 0; i < this.chapter.drops.length; i++) {
        const d = this.chapter.drops[i]
        if (run.dropCollected[i]) continue
        let near = false
        world.units.forEach((id, u) => {
          if (near || u.team !== this.localTeam) return
          if (isAt(world, id, d.tileX, d.tileY, 3)) near = true
        })
        if (near) {
          run.dropCollected[i] = true
          spawnSquadNear(world, this.localTeam, d.tileX, d.tileY, d.units)
        }
      }
      const count = run.dropCollected.filter(Boolean).length
      const newly = count - run.collectedDrops
      run.collectedDrops = count
      run.objectiveKey = 'campaign.obj.journey'
      run.objectiveProgress = count
      run.objectiveTarget = run.dropCount
      if (count >= run.dropCount) {
        run.phase = 'rebuild'
        run.objectiveKey = 'campaign.obj.rebuild'
        run.objectiveProgress = 0
        run.objectiveTarget = 1
        return outcome(run, { toastKey: 'campaign.toast.marchComplete', logKey: 'campaign.log.marchComplete' })
      }
      return outcome(run, newly > 0 ? { toastKey: 'campaign.toast.dropFound', logKey: 'campaign.log.dropFound' } : {})
    }

    if (run.phase === 'rebuild') {
      world.buildings.forEach((_id, b) => {
        if (run.rebuildDone || b.team !== this.localTeam || b.buildingType !== 'command-center') return
        const t = world.transforms.get(_id)
        if (!t) return
        const tx = Math.floor((t.x - 500) / 1000)
        const ty = Math.floor((t.y - 500) / 1000)
        const ob = this.chapter.oldBase
        if (tx >= ob.minX && tx < ob.minX + ob.w && ty >= ob.minY && ty < ob.minY + ob.h) run.rebuildDone = true
      })
      run.objectiveKey = 'campaign.obj.rebuild'
      run.objectiveProgress = run.rebuildDone ? 1 : 0
      run.objectiveTarget = 1
      if (run.rebuildDone) {
        run.phase = 'defend'
        run.waveIndex = 0
        run.waveSpawnAt = world.tick + this.chapter.waves[0].delayTicks
        run.objectiveKey = 'campaign.obj.defend'
        run.objectiveProgress = 0
        run.objectiveTarget = this.chapter.waves.length
        return outcome(run, { toastKey: 'campaign.toast.baseRebuilt', logKey: 'campaign.log.baseRebuilt' })
      }
      return outcome(run, {})
    }

    if (run.phase === 'defend') {
      if (world.tick >= run.waveSpawnAt && run.waveIndex < this.chapter.waves.length) {
        const wave = this.chapter.waves[run.waveIndex]
        run.raiderIds.push(...spawnSquadNear(world, 1, 18, 34, wave.units))
        run.waveIndex++
        run.waveSpawnAt = run.waveIndex < this.chapter.waves.length ? world.tick + this.chapter.waves[run.waveIndex].delayTicks : Number.POSITIVE_INFINITY
        run.objectiveKey = 'campaign.obj.defend'
        run.objectiveProgress = run.waveIndex
        run.objectiveTarget = this.chapter.waves.length
        return outcome(run, { toastKey: 'campaign.toast.wave', logKey: 'campaign.log.wave' })
      }
      let ccAlive = false
      world.buildings.forEach((buildingId, b) => {
        if (b.team === this.localTeam && b.buildingType === 'command-center') {
          ccAlive = true
          // keep a reference to suppress unused-param lint
          void buildingId
        }
      })
      run.objectiveKey = 'campaign.obj.defend'
      run.objectiveTarget = this.chapter.waves.length
      if (!ccAlive) {
        run.done = true
        run.won = false
        return outcome(run, { toastKey: 'campaign.toast.lost', winner: 1 })
      }
      if (run.waveIndex >= this.chapter.waves.length) {
        run.phase = 'attack'
        let toast: string | null = null
        if (!run.assaultStarted) {
          run.assaultStarted = true
          spawnSquadNear(world, this.localTeam, 14, 12, this.chapter.assaultReinforcements)
          toast = 'campaign.toast.reinforcements'
        }
        run.objectiveKey = 'campaign.obj.attack'
        run.objectiveProgress = 0
        run.objectiveTarget = this.chapter.enemyOutposts.length
        return outcome(run, { toastKey: toast, logKey: toast ? 'campaign.log.reinforcements' : null })
      }
      return outcome(run, {})
    }

    // attack: every outpost command centre falls.
    run.objectiveKey = 'campaign.obj.attack'
    let killed = 0
    for (const id of run.enemyOutpostIds) {
      if (!world.buildings.has(id)) killed++
    }
    run.objectiveProgress = killed
    run.objectiveTarget = this.chapter.enemyOutposts.length
    if (killed >= this.chapter.enemyOutposts.length) {
      run.done = true
      run.won = true
      return outcome(run, { toastKey: 'campaign.toast.victory', logKey: 'campaign.log.victory', winner: this.localTeam })
    }
    return outcome(run, {})
  }
}