import { SparseSet } from '../ecs/sparse-set.ts'
import { RNG, type MapData, isPassableTerrain, tileIndex, isBuildableTerrain, tileToFx, tileAt, type WinRule, WIN_RULE_DEFAULT, type MatchSettings, mergeMatchSettings, type PingType, VETERAN_MAX_RANK, VETERAN_ARMOR_FLOOR } from '@space-arenas/shared'
import type { SimEvent } from './events.ts'
import { rectFromCenter } from './geometry.ts'
import { spawnBuilding, spawnUnit } from '../entities/factories.ts'

/** How long a ping stays visible (in sim ticks). Cosmetic-only. */
export const PING_TICKS = 125

/** Stat multipliers applied to a unit based on its veterancy rank. */
export interface VeteranBonus {
  damage: number
  range: number
  armor: number
}

/** Rank earned from a given kill total (0–5, capped at rank 5). */
export type VeteranRank = 0 | 1 | 2 | 3 | 4 | 5

/** Rank earned from a given kill total (0–5, capped at rank 5). */
export const veteranRankForKills = (world: World, kills: number): VeteranRank => {
  const s = world.settings
  if (kills >= s.veteranRank5Kills) return 5
  if (kills >= s.veteranRank4Kills) return 4
  if (kills >= s.veteranRank3Kills) return 3
  if (kills >= s.veteranRank2Kills) return 2
  if (kills >= s.veteranRank1Kills) return 1
  return 0
}

/** Per-rank veterancy multipliers. Rank 1 = the base values below and rank N
 * scales them linearly (×N). Damage/range increase, armor is damage reduction
 * (incoming-damage multiplier, clamped to ≥ VETERAN_ARMOR_FLOOR). */
export const unitVeteranBonus = (world: World, rank: number): VeteranBonus => {
  const r = Math.max(0, Math.min(VETERAN_MAX_RANK, rank | 0))
  const s = world.settings
  return {
    damage: 1 + (r > 0 ? s.veteranDamagePerRank : 0) * r,
    range: 1 + (r > 0 ? s.veteranRangePerRank : 0) * r,
    armor: Math.max(VETERAN_ARMOR_FLOOR, 1 - (r > 0 ? s.veteranArmorPerRank : 0) * r),
  }
}

/** Cosmetic-only player ping marker. It never affects the sim hash or the
 * network protocol — pings arrive via regular commands and are rendered from
 * this array on every client, exactly like `flashes`. */
export interface PingComp {
  team: number
  x: number
  y: number
  type: PingType
  started: number
}

export interface TransformComp {
  x: number
  y: number
}

export interface UnitComp {
  unitType: string
  team: number
  speed: number
  class: 'infantry' | 'vehicle' | 'air'
  isHarvester: boolean
  /** Enemy units this unit has destroyed (veterancy progress). */
  killCount: number
  /** Veterancy level: 0 = none, 1–4 = gold pips, 5 = star (capped, never regresses). */
  veteranRank: VeteranRank
  /** Stealthed units are invisible to enemies until they fire (or a detector reveals them). */
  stealth: boolean
  /** Tick until a sneak-attack reveal expires (0 = not currently revealed). */
  revealedUntil: number
  /** Ticks left before the unit can throw another grenade/smoke (0 = ready). */
  abilityCooldown: number
}

export interface BuildingComp {
  buildingType: string
  team: number
  footprintW: number
  footprintH: number
  buildProgress: number
  done: boolean
  powerGen: number
  powerUse: number
  researching: string
  researchTicks: number
  assignedDozer: number
  spawnTx: number
  spawnTy: number
  flagTx: number
  flagTy: number
  maxPowerUntil: number
  maxPowerHpTarget: number
  /** Tick at which a pending sale completes (0 = not being sold). While set, the
   * building animates its status frames in reverse and can still be attacked; if
   * destroyed before this tick the owner is denied the refund. */
  sellingUntil: number
  /** Bought per-building detector ability: reveals enemy stealthed units in range. */
  detector: boolean
}

export interface HealthComp {
  hp: number
  maxHp: number
}

export interface VisionComp {
  radius: number
}

export interface AttackComp {
  weaponId: string
  cooldownTicks: number
  currentCooldown: number
  target: number | null
  targetPos: { x: number; y: number } | null
  lastHit: number
  keepAttack: { x: number; y: number } | null
  guardMode: boolean
  guardPost: { x: number; y: number } | null
}

/** Cosmetic-only hit-flash marker. The renderer draws a white overlay while
 * `tick - hitTick < 2`; it never affects the sim hash or the network protocol. */
export interface DamageFlashComp {
  hitTick: number
}

export interface MoveComp {
  tx: number
  ty: number
  path: number[]
  pathIndex: number
  attackMove: boolean
  needsPath: boolean
  chase: boolean
  repathCooldown: number
}

export interface ProductionOrder {
  /** Stable identity, unique per order — lets the HUD detect reorders even among identical unit types. */
  id: number
  unitType: string
  remainingTicks: number
}

export interface ProductionQueueComp {
  queue: ProductionOrder[]
}

export type HarvesterPhase = 'idle' | 'to-field' | 'loading' | 'to-dock'

export interface HarvesterComp {
  phase: HarvesterPhase
  field: number
  dock: number
  loadTicks: number
}

export interface SupplyFieldComp {
  radius: number
  capacity: number
  trips: number
}

export interface OilFieldComp {
  radius: number
  owner: number
  claimTicks: number
  claimingScout: number
  incomeTicks: number
}

export interface SceneryComp {
  type: 'rock' | 'tree'
  /** tile-space footprint of the obstruction it came from */
  x: number
  y: number
  w: number
  h: number
}

export type WorkKind = 'construct' | 'repair' | 'collect'

export interface WorkComp {
  kind: WorkKind
  building: number
  stuckTicks?: number
  lastPadDist?: number
  /** Progress (ticks worked) collecting a wreck when kind === 'collect'. */
  collectTicks?: number
}

/** A persistent wreck left behind by a destroyed unit/building. Any team's
 * bulldozer can collect it for `value` credits. */
export interface WreckComp {
  /** Credits granted to the collecting team. */
  value: number
  /** The team that originally owned the destroyed object. */
  team: number
  /** 'unit' or 'building' — the kind of the destroyed object. */
  srcKind: 'unit' | 'building'
}

export interface TeamState {
  credits: number
  powerGen: number
  powerUse: number
  powerNet: number
  powerDown: boolean
  radar: boolean
  satellite: boolean
  satelliteRevealUntil: number
  satelliteLastUsed: number
  laser: boolean
  laserLastUsed: number
  laserFreeShotUsed: boolean
  laserLevel: number
  alliance: number
  color: number
  /** Stealth Tech researched: the team's units are invisible until they fire. */
  stealthTech: boolean
  /** Detector Upgrade researched: buildings can buy the Detector ability. */
  detectorUnlocked: boolean
}

export type PlaneState = 'idle' | 'attacking' | 'returning'

export interface PlaneComp {
  home: number
  state: PlaneState
  hoverX: number
  hoverY: number
  ammo: number
  reloadTicks: number
}

export interface LaserComp {
  team: number
  radius: number
  startTick: number
  untilTick: number
}

export interface SatelliteMarkerComp {
  team: number
  untilTick: number
}

/** A grenade in flight/landed, waiting out its fuse before exploding. */
export interface GrenadeComp {
  team: number
  /** Thrower position at launch — the renderer draws the arc from here. */
  fromX: number
  fromY: number
  x: number
  y: number
  startTick: number
  explodeAt: number
  /** Blast radius in tiles. */
  radius: number
  damage: number
}

/** A thrown smoke canister that arcs from the thrower (like a grenade) and,
 * once landed, billows into a lingering cloud that makes shots crossing it
 * miss. The cloud grows after landing and shrinks as it fades near expiry. */
export interface SmokeComp {
  team: number
  /** Thrower position at launch — the renderer draws the arc from here. */
  fromX: number
  fromY: number
  x: number
  y: number
  startTick: number
  /** Tick the canister lands and the cloud starts billowing out. */
  landTick: number
  radius: number
  /** Cloud expiry; the cloud shrinks over the last moments before it. */
  untilTick: number
}

export interface WorldGrid {
  width: number
  height: number
  passable: Uint8Array
  buildable: Uint8Array
  /** Every passable tile is labelled with a connected component id (4-neighbour flood fill). */
  component: Uint32Array
}

export class World {
  readonly map: MapData
  readonly rng: RNG
  readonly width: number
  readonly height: number
  readonly settings: MatchSettings
  readonly teams = new Map<number, TeamState>()
  readonly fog = new Map<number, Uint8Array>()

  tick = 0
  gameOver: number | null = null
  lastHash = 0
  onSyncTick: ((hash: number) => void) | null = null
  winRule: WinRule = WIN_RULE_DEFAULT

  readonly transforms = new SparseSet<TransformComp>()
  readonly units = new SparseSet<UnitComp>()
  readonly buildings = new SparseSet<BuildingComp>()
  readonly healths = new SparseSet<HealthComp>()
  readonly visions = new SparseSet<VisionComp>()
  readonly attacks = new SparseSet<AttackComp>()
  readonly moves = new SparseSet<MoveComp>()
  readonly queues = new SparseSet<ProductionQueueComp>()
  readonly harvesters = new SparseSet<HarvesterComp>()
  readonly fields = new SparseSet<SupplyFieldComp>()
  readonly oilFields = new SparseSet<OilFieldComp>()
  readonly works = new SparseSet<WorkComp>()
  readonly wrecks = new SparseSet<WreckComp>()
  readonly satelliteMarkers = new SparseSet<SatelliteMarkerComp>()
  readonly grenades = new SparseSet<GrenadeComp>()
  readonly smokes = new SparseSet<SmokeComp>()
  readonly planes = new SparseSet<PlaneComp>()
  readonly lasers = new SparseSet<LaserComp>()
  readonly flashes = new SparseSet<DamageFlashComp>()
  readonly scenery = new SparseSet<SceneryComp>()
  readonly pings: PingComp[] = []

  readonly events: SimEvent[] = []
  private readonly entityKinds = new Map<number, 'unit' | 'building' | 'field' | 'marker' | 'scenery' | 'wreck'>()

  grid: WorldGrid | null = null
  gridDirty = true

  private nextId = 1
  private staticFieldId = 0x20000000
  private sceneryId = 0x40000000

  constructor(map: MapData, seed: number, players: number[], settings?: Partial<MatchSettings>) {
    this.map = map
    this.width = map.width
    this.height = map.height
    this.settings = mergeMatchSettings(settings)
    this.rng = new RNG(seed)
    for (const p of players) {
      this.teams.set(p, { credits: this.settings.startingCredits, powerGen: 0, powerUse: 0, powerNet: 0, powerDown: false, radar: false, satellite: false, satelliteRevealUntil: -1, satelliteLastUsed: -100000, laser: false, laserLastUsed: -100000, laserFreeShotUsed: false, laserLevel: 0, alliance: p, color: p, stealthTech: false, detectorUnlocked: false })
      this.fog.set(p, new Uint8Array(map.width * map.height))
    }
    this.initStatic(map)
    this.spawnStartingBuildings(map, players)
  }

  private spawnStartingBuildings(map: MapData, players: number[]): void {
    const sorted = [...map.spawnPoints].sort((a, b) => a.team - b.team)
    for (const s of sorted) {
      if (players.includes(s.team)) {
        spawnBuilding(this, 'command-center', s.team, s.x, s.y, true)
        this.spawnStartingBulldozer(map, s.x, s.y, s.team)
      }
    }
  }

  private spawnStartingBulldozer(map: MapData, ccX: number, ccY: number, team: number): void {
    for (let r = 1; r <= 3; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
          const x = ccX + 4 + dx
          const y = ccY + dy
          if (x < 0 || y < 0 || x >= this.width || y >= this.height) continue
          if (!isPassableTerrain(tileAt(map, x, y))) continue
          spawnUnit(this, 'bulldozer', team, tileToFx(x) + 500, tileToFx(y) + 500)
          return
        }
      }
    }
  }

  private initStatic(map: MapData): void {
    for (const f of map.supplyFields) {
      const id = this.createEntity('field', -1)
      const radius = this.settings.supplyFieldRadius || f.radius
      const capacity = this.settings.supplyFieldCapacity || f.capacity
      this.transforms.set(id, { x: f.x * 1000 + 500, y: f.y * 1000 + 500 })
      this.fields.set(id, { radius, capacity, trips: capacity })
    }
    for (const f of map.oilFields ?? []) {
      const id = this.staticFieldId++
      this.entityKinds.set(id, 'field')
      this.transforms.set(id, { x: f.x * 1000 + 500, y: f.y * 1000 + 500 })
      this.oilFields.set(id, { radius: this.settings.oilFieldRadius || f.radius, owner: -1, claimTicks: 0, claimingScout: 0, incomeTicks: 0 })
      const ohp = this.settings.oilFieldHp
      this.healths.set(id, { hp: ohp, maxHp: ohp })
    }
    for (const o of map.obstructions) {
      if (o.type === 'wreck') continue
      const id = this.sceneryId++
      this.entityKinds.set(id, 'scenery')
      this.transforms.set(id, { x: Math.floor((o.x + o.w / 2) * 1000) + 500, y: Math.floor((o.y + o.h / 2) * 1000) + 500 })
      const hp = o.type === 'tree' ? this.settings.treeHp : this.settings.rockHp
      this.healths.set(id, { hp, maxHp: hp })
      this.scenery.set(id, { type: o.type, x: o.x, y: o.y, w: o.w, h: o.h })
    }
  }

  createEntity(kind: 'unit' | 'building' | 'field' | 'marker' | 'scenery' | 'wreck', team: number): number {
    const id = this.nextId++
    this.entityKinds.set(id, kind)
    if (team >= 0) this.events.push({ type: 'entity-created', entity: id, kind, team })
    return id
  }

  /** Allocate a stable, deterministic id without side effects (used for production order identities). */
  allocId(): number {
    return this.nextId++
  }

  removeEntity(id: number): void {
    const kind = this.entityKinds.get(id)
    if (kind === undefined) return
    const team = this.teamOf(id)
    const typeName = kind === 'unit' ? this.units.get(id)?.unitType : kind === 'building' ? this.buildings.get(id)?.buildingType : undefined
    if (kind === 'scenery') {
      const s = this.scenery.get(id)
      const t = this.transforms.get(id)
      if (s && t) this.events.push({ type: 'scenery-destroyed', entity: id, kind: s.type, x: t.x, y: t.y, w: s.w, h: s.h })
    }
    const deadT = this.transforms.get(id)
    const deadX = deadT?.x ?? 0
    const deadY = deadT?.y ?? 0
    this.transforms.delete(id)
    this.units.delete(id)
    this.buildings.delete(id)
    this.healths.delete(id)
    this.visions.delete(id)
    this.attacks.delete(id)
    this.moves.delete(id)
    this.queues.delete(id)
    this.harvesters.delete(id)
    this.fields.delete(id)
    this.oilFields.delete(id)
    this.works.delete(id)
    this.wrecks.delete(id)
    this.satelliteMarkers.delete(id)
    this.grenades.delete(id)
    this.smokes.delete(id)
    this.planes.delete(id)
    this.lasers.delete(id)
    this.flashes.delete(id)
    this.scenery.delete(id)
    this.entityKinds.delete(id)
    if (kind === 'building' || kind === 'field' || kind === 'scenery') this.gridDirty = true
    if (team >= 0) {
      this.events.push({ type: 'entity-destroyed', entity: id, kind, team, x: deadX, y: deadY, ...(typeName !== undefined ? { typeName } : {}) })
    }
  }

  teamOf(id: number): number {
    const u = this.units.get(id)
    if (u) return u.team
    const b = this.buildings.get(id)
    if (b) return b.team
    const f = this.oilFields.get(id)
    if (f && f.owner >= 0) return f.owner
    return -1
  }

  /** Create a persistent wreck at a world position for a destroyed unit/building. */
  spawnWreck(x: number, y: number, value: number, team: number, srcKind: 'unit' | 'building'): number {
    const id = this.createEntity('wreck', -1)
    this.transforms.set(id, { x, y })
    this.wrecks.set(id, { value, team, srcKind })
    return id
  }

  sameTeam(a: number, b: number): boolean {
    if (a === b) return true
    const ta = this.teams.get(a)
    const tb = this.teams.get(b)
    if (!ta || !tb) return false
    return ta.alliance >= 0 && ta.alliance === tb.alliance
  }

  allianceOf(team: number): number {
    return this.teams.get(team)?.alliance ?? team
  }

  isVisibleTo(team: number, entityId: number, revealAll = false): boolean {
    if (revealAll) return true
    const eTeam = this.teamOf(entityId)
    if (eTeam < 0) return true
    if (this.sameTeam(team, eTeam)) return true
    const targetUnit = this.units.get(entityId)
    if (targetUnit && targetUnit.stealth) {
      // Stealth: invisible until the unit fires (then it is briefly revealed)
      // or comes within range of a detector building of the viewing team.
      if (this.detectorNear(team, entityId)) return true
      if (targetUnit.revealedUntil < this.tick) return false
      // recently revealed by firing: fall through to normal fog visibility
    }
    const s = this.teams.get(team)
    if (s && s.satelliteRevealUntil >= this.tick) return true
    const f = this.fog.get(team)
    if (!f) return true
    const t = this.transforms.get(entityId)
    if (!t) return true
    const tx = Math.floor(t.x / 1000)
    const ty = Math.floor(t.y / 1000)
    if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) return false
    if (f[tileIndex(this.map, tx, ty)] >= 2) return true
    const fade = Math.floor(this.settings.fogFadeDistance)
    if (fade <= 0) return false
    const { width, height } = this
    const fadeSq = fade * fade
    for (let dy = -fade; dy <= fade; dy++) {
      const ny = ty + dy
      if (ny < 0 || ny >= height) continue
      for (let dx = -fade; dx <= fade; dx++) {
        if (dx * dx + dy * dy > fadeSq) continue
        const nx = tx + dx
        if (nx < 0 || nx >= width) continue
        if (f[ny * width + nx] >= 2) return true
      }
    }
    return false
  }

  /** Whether one of `team`'s done detector buildings covers the entity's tile. */
  detectorNear(team: number, entityId: number): boolean {
    const t = this.transforms.get(entityId)
    if (!t) return false
    const rangeSq = (this.settings.detectorRange * 1000) ** 2
    let found = false
    this.buildings.forEach((id, b) => {
      if (found) return
      if (b.team !== team || !b.done || !b.detector) return
      const pos = this.transforms.get(id)
      if (!pos) return
      const dx = pos.x - t.x
      const dy = pos.y - t.y
      if (dx * dx + dy * dy <= rangeSq) found = true
    })
    return found
  }

  addSatelliteMarker(team: number, x: number, y: number, untilTick: number): void {
    const id = this.createEntity('marker', -1)
    this.transforms.set(id, { x, y })
    this.satelliteMarkers.set(id, { team, untilTick })
  }

  clearSatelliteMarkers(team: number): void {
    const stale: number[] = []
    this.satelliteMarkers.forEach((id, m) => {
      if (m.team === team) stale.push(id)
    })
    for (const id of stale) this.removeEntity(id)
  }

  kindOf(id: number): 'unit' | 'building' | 'field' | 'marker' | 'scenery' | 'wreck' | undefined {
    return this.entityKinds.get(id)
  }

  isAlive(id: number): boolean {
    return this.entityKinds.has(id)
  }

  positionOf(id: number): { x: number; y: number } | undefined {
    return this.transforms.get(id)
  }

  teamState(team: number): TeamState {    let s = this.teams.get(team)
    if (!s) {
      s = { credits: 0, powerGen: 0, powerUse: 0, powerNet: 0, powerDown: false, radar: false, satellite: false, satelliteRevealUntil: -1, satelliteLastUsed: -100000, laser: false, laserLastUsed: -100000, laserFreeShotUsed: false, laserLevel: 0, alliance: team, color: team, stealthTech: false, detectorUnlocked: false }
      this.teams.set(team, s)
    }
    return s
  }

  hasDoneBuilding(team: number, type: string): boolean {
    let found = false
    this.buildings.forEach((_id, b) => {
      if (!found && b.team === team && b.done && b.buildingType === type) found = true
    })
    return found
  }

  radarActive(team: number): boolean {
    const s = this.teams.get(team)
    return !!s && s.radar && this.hasDoneBuilding(team, 'tech-center')
  }

  laserAvailable(team: number): boolean {
    const s = this.teams.get(team)
    if (!s || !s.laser) return false
    if (this.tick - s.laserLastUsed < this.settings.laserCooldownTicks) return false
    if (s.powerDown) return false
    if (this.hasDoneBuilding(team, 'super-weapon')) return true
    if (s.laserFreeShotUsed) return false
    return this.hasDoneBuilding(team, 'command-center')
  }

  laserCooldownRemaining(team: number): number {
    const s = this.teams.get(team)
    if (!s || !s.laser) return 0
    return Math.max(0, this.settings.laserCooldownTicks - (this.tick - s.laserLastUsed))
  }

  laserLevel(team: number): number {
    return this.teams.get(team)?.laserLevel ?? 0
  }

  laserMaxLevel(): number {
    return this.settings.laserMaxLevel
  }

  laserStrikeRadius(team: number): number {
    return this.settings.laserRadius * Math.max(1, this.laserLevel(team))
  }

  laserUpgradeCost(team: number, baseCost: number): number {
    return baseCost * (this.laserLevel(team) + 1)
  }

  emit(event: SimEvent): void {
    this.events.push(event)
  }

  /** Record a team ping (visible to allies). Cosmetic-only; see `PingComp`. */
  addPing(team: number, x: number, y: number, type: PingType): void {
    this.pings.push({ team, x, y, type, started: this.tick })
  }

  drainEvents(): SimEvent[] {
    const out = this.events.slice()
    this.events.length = 0
    return out
  }

  eachUnit(cb: (id: number, u: UnitComp, t: TransformComp) => void): void {
    this.units.forEach((id, u) => {
      cb(id, u, this.transforms.require(id))
    })
  }

  eachBuilding(cb: (id: number, b: BuildingComp, t: TransformComp) => void): void {
    this.buildings.forEach((id, b) => {
      cb(id, b, this.transforms.require(id))
    })
  }

  markGridDirty(): void {
    this.gridDirty = true
  }

  rngState(): number {
    return this.rng.state32()
  }

  rebuildGridIfDirty(): void {
    if (!this.gridDirty) return
    const { width, height, map } = this
    const passable = new Uint8Array(width * height)
    const buildable = new Uint8Array(width * height)
    for (let i = 0; i < passable.length; i++) {
      const t = map.tiles[i]
      passable[i] = isPassableTerrain(t) ? 1 : 0
      buildable[i] = isBuildableTerrain(t) ? 1 : 0
    }
    for (const o of map.obstructions) {
      if (o.type === 'rock' || o.type === 'tree') continue
      for (let y = o.y; y < o.y + o.h; y++) {
        for (let x = o.x; x < o.x + o.w; x++) {
          passable[tileIndex(map, x, y)] = 0
        }
      }
    }
    this.scenery.forEach((_id, s) => {
      if (s.type !== 'rock') return
      for (let y = s.y; y < s.y + s.h; y++) {
        for (let x = s.x; x < s.x + s.w; x++) {
          if (x >= 0 && y >= 0 && x < width && y < height) passable[tileIndex(map, x, y)] = 0
        }
      }
    })
    this.fields.forEach((id, f) => {
      const t = this.transforms.require(id)
      const cx = Math.floor(t.x / 1000)
      const cy = Math.floor(t.y / 1000)
      for (let y = cy - f.radius; y <= cy + f.radius; y++) {
        for (let x = cx - f.radius; x <= cx + f.radius; x++) {
          if (x >= 0 && y >= 0 && x < width && y < height) {
            const idx = tileIndex(map, x, y)
            buildable[idx] = 0
            passable[idx] = 0
          }
        }
      }
    })
    this.oilFields.forEach((id, f) => {
      const t = this.transforms.require(id)
      const cx = Math.floor(t.x / 1000)
      const cy = Math.floor(t.y / 1000)
      for (let y = cy - f.radius; y <= cy + f.radius; y++) {
        for (let x = cx - f.radius; x <= cx + f.radius; x++) {
          if (x >= 0 && y >= 0 && x < width && y < height) {
            const idx = tileIndex(map, x, y)
            buildable[idx] = 0
            passable[idx] = 0
          }
        }
      }
    })
    this.buildings.forEach((id, b) => {
      const t = this.transforms.require(id)
      const r = rectFromCenter(t.x, t.y, b.footprintW, b.footprintH)
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) {
          if (x >= 0 && y >= 0 && x < width && y < height) {
            const idx = tileIndex(map, x, y)
            passable[idx] = 0
            buildable[idx] = 0
          }
        }
      }
    })
    this.grid = { width, height, passable, buildable, component: new Uint32Array(passable.length) }
    this.gridDirty = false
    this.computeComponents()
  }

  private computeComponents(): void {
    const grid = this.grid
    if (!grid) return
    const { width, height, passable, component } = grid
    const queue = new Int32Array(passable.length)
    let cid = 0
    for (let start = 0; start < passable.length; start++) {
      if (!passable[start] || component[start] !== 0) continue
      cid++
      component[start] = cid
      let head = 0
      let tail = 0
      queue[tail++] = start
      while (head < tail) {
        const cur = queue[head++]
        const cx = cur % width
        const cy = Math.floor(cur / width)
        const ni = cy * width + (cx - 1)
        if (cx > 0 && passable[ni] && component[ni] === 0) {
          component[ni] = cid
          queue[tail++] = ni
        }
        const ei = cy * width + (cx + 1)
        if (cx + 1 < width && passable[ei] && component[ei] === 0) {
          component[ei] = cid
          queue[tail++] = ei
        }
        const ui2 = (cy - 1) * width + cx
        if (cy > 0 && passable[ui2] && component[ui2] === 0) {
          component[ui2] = cid
          queue[tail++] = ui2
        }
        const di = (cy + 1) * width + cx
        if (cy + 1 < height && passable[di] && component[di] === 0) {
          component[di] = cid
          queue[tail++] = di
        }
      }
    }
  }
}

export const placementExplored = (
  fog: Uint8Array | undefined,
  width: number,
  tx: number,
  ty: number,
  footprintW: number,
  footprintH: number,
): boolean => {
  if (!fog) return true
  const cx = tx + (footprintW >> 1)
  const cy = ty + (footprintH >> 1)
  const idx = cy * width + cx
  if (idx < 0 || idx >= fog.length) return false
  return fog[idx] >= 1
}
