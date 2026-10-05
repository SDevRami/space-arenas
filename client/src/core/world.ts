import { SparseSet } from '../ecs/sparse-set.ts'
import { RNG, type MapData, Terrain, isPassableTerrain, tileIndex, isBuildableTerrain, tileToFx, tileAt, type WinRule, WIN_RULE_DEFAULT, type MatchSettings, mergeMatchSettings, type PingType, VETERAN_MAX_RANK, VETERAN_ARMOR_FLOOR, getUnit, getBuilding, TRANSPORT_CAPACITY_PER_LEVEL, WEAPON_UPGRADE_MAX_LEVEL, type SwChoice, RANK_FLOORS, MAX_RANK, SCORE_UNIT_KILL, SCORE_BUILDING_KILL, AIRSTRIKE_MAX_LEVEL, EMP_MAX_LEVEL, type CoopControl } from '@space-arenas/shared'
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
  class: 'infantry' | 'vehicle' | 'air' | 'naval'
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
  /** Day 13 EMP: ticks until the unit re-awakens (0/absent = not disabled). */
  empUntil?: number
  /** Day 21: formation spacing multiplier. 1 = normal; loose formations = 1.5, tight = 0.7. */
  formationSpread: number
  /** Day 21: when issuing a group move, keep this unit's offset from the group centroid (hold current position shape). */
  relativeFormation: boolean
}

export interface ResearchOrder {
  /** Stable identity, unique per order — lets the HUD cancel a specific queued upgrade. */
  id: number
  upgrade: string
  remainingTicks: number
  /** Credits paid when this order was queued — refunded when the order is cancelled. */
  cost: number
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
  /** Tech-center upgrade queue: only the head (queue[0]) researches; the rest follow. */
  researchQueue: ResearchOrder[]
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
  /** Defense Dome (Day 12): current shield points on the CC only. Regenerates
   * while the team is powered and absorbs incoming damage before HP. */
  shieldHp: number
  /** Day 13 EMP: ticks until the building re-awakens (0/absent = not disabled). */
  empUntil?: number
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
  /** Day 21: when true (default), idle units attack any in-range enemy on sight; when false they wait for an order. */
  autoFire: boolean
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
  /** Day 22: team whose harvesters get the bonus (scout holding the field); -1 = none. */
  capturer: number
  /** Day 22: ticks of scout presence toward flipping the field to a new team. */
  captureTicks: number
  /** Day 22: the scout currently building capture progress (0 = none). */
  capturingScout: number
  /** Day 22: ticks the field has sat unguarded while captured; drops the bonus after the hold grace. */
  holdTicks: number
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

export type WorkKind = 'construct' | 'repair' | 'collect' | 'repair-unit'

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
  /** Mine Tech researched: engineers can place/remove mines and bulldozers can remove them. */
  mineTech: boolean
  /** Abilities Tech researched: bandolier units can throw grenades and smoke. */
  abilitiesUnlocked: boolean
  /** Troop Capacity researched count: each level adds transport slots to APCs. */
  transportCapacityLevel: number
  /** Defense Dome researched: the Command Center gains a shield while powered. */
  defenseDome: boolean
  /** Weapon Upgrade researched count (max WEAPON_UPGRADE_MAX_LEVEL). Boosts damage
   * of max-rank (veteran rank 5) units only. */
  weaponUpgradeLevel: number
  /** Day 13: the one-time Super Weapon strike picked at the SP building. */
  swChoice: SwChoice | null
  /** Tick of the last Airstrike strike (for cooldown). */
  airstrikeLastUsed: number
  /** Tick of the last EMP strike (for cooldown). */
  empLastUsed: number
  /** Day 15: current-match score (kills, supply, research, expansions). */
  score: number
  /** Day 15: general rank (0..MAX_RANK) — each star unlocks higher-tier research. */
  rank: number
  /** Day 15: Airstrike upgrade level (max AIRSTRIKE_MAX_LEVEL), like the laser. */
  airstrikeLevel: number
  /** Day 15: EMP upgrade level (max EMP_MAX_LEVEL), like the laser. */
  empLevel: number
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

/** Day 13: one kamikaze airstrike plane flying from the map edge to its target. */
export interface AirstrikeComp {
  team: number
  /** Spawn position just off the top edge; held until `startTick`. */
  startX: number
  startY: number
  /** Bomb impact point (fx). */
  tx: number
  ty: number
  /** Tick the plane begins flying toward the target (staggers the squadron). */
  startTick: number
  /** Day 15: per-bomb damage & radius of the leveled strike. */
  damage: number
  radius: number
}

/** Day 13: the EMP nullification zone at a strike point — purple pulse while active. */
export interface EmpPulseComp {
  team: number
  radius: number
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

/** A proximity mine placed by an engineer. It sits on a passable tile and
 * detonates once armed when an enemy ground unit comes within `triggerRadius`
 * tiles, blasting every ground unit of hostile/allied teams (per
 * `friendlyMineDamage`) inside `blastRadius` for `damage`. Friendly owned
 * mines are always visible to the placing team; enemies never see them. */
export interface MineComp {
  team: number
  /** The engineer unit that placed the mine — it earns kill credit. */
  owner: number
  /** Tick from which the mine is armed and can detonate. */
  armTick: number
  /** Tiles: how close an enemy must get before the mine trips. */
  triggerRadius: number
  /** Tiles: how far the blast reaches. */
  blastRadius: number
  /** Damage dealt to every ground unit inside the blast. */
  damage: number
}

/** Cosmetic-only heal marker (green "+"). The renderer draws it while
 * `tick - healTick < 2`; it never affects the sim hash or the network
 * protocol, exactly like `flashes`. */
export interface HealFlashComp {
  healTick: number
}

/** A squaddie riding inside a transport. The passenger is NOT a live entity
 * while loaded: it leaves the world when it boards (full stat snapshot taken at
 * that moment) and is respawned at unload with those stats restored. */
export interface PassengerRecord {
  unitType: string
  hp: number
  maxHp: number
  killCount: number
  veteranRank: VeteranRank
  stealth: boolean
  abilityCooldown: number
  /** Day 21 stance/formation state preserved across boarding. */
  formationSpread: number
  relativeFormation: boolean
  autoFire: boolean
}

/** The loaded-hold of a transport unit (APC). Passengers are carried as
 * `PassengerRecord`s; a `pendingUnload` point makes the APC drive there first
 * (11.3) and then empty its hold, and if the APC is destroyed while loaded its
 * passengers are gone with it (11.2 — they never re-enter the world).
 *
 * To load, the transport command queues riders into `loadQueue`: those units
 * stay alive in the world and walk to the APC (while the APC drives toward
 * them), and each tick the closest queued rider boards one at a time. */
export interface TransportComp {
  /** Owner team. */
  team: number
  passengers: PassengerRecord[]
  /** Live unit ids ordered to board this APC but still walking over. */
  loadQueue: number[]
  /** Unload request target, or null when idle. */
  unloadX: number
  unloadY: number
  pendingUnload: boolean
  /** How many passengers have already stepped off at the current unload point
   * (keeps the drop-off grid position fixed while unloading one per tick). */
  unloadCount: number
  /** Index into `passengers` for a click-to-eject order (unload a single rider
   * next to the transport), or -1 for a regular "Unload Here" command. */
  pendingOne: number
}

export interface WorldGrid {
  width: number
  height: number
  passable: Uint8Array
  buildable: Uint8Array
  /** Every passable tile is labelled with a connected component id (4-neighbour flood fill). */
  component: Uint32Array
  /** Tiles naval units may occupy (open water). Road bridges and terrain blocks ships. */
  water: Uint8Array
  /** Every water tile is labelled with a connected component id (4-neighbour flood fill). */
  waterComponent: Uint32Array
}

export class World {
  readonly map: MapData
  readonly rng: RNG
  readonly width: number
  readonly height: number
  readonly settings: MatchSettings
  readonly teams = new Map<number, TeamState>()
  readonly fog = new Map<number, Uint8Array>()
  /** entity id -> the team that last damaged it, for kill credit & score. */
  readonly lastAttacker = new Map<number, number>()

  tick = 0
  gameOver: number | null = null
  /** Scripted modes (survival / campaign) drive their own end condition, so the
   *  winloss system is bypassed and freeze-out / CC checks never force an early
   *  game-over (e.g. a campaign squad that starts without a command center). */
  winless = false
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
  /** Day 20: bulldozer id -> ordered building ids waiting for construction. */
  readonly buildOrderQueues = new Map<number, number[]>()
  readonly satelliteMarkers = new SparseSet<SatelliteMarkerComp>()
  readonly grenades = new SparseSet<GrenadeComp>()
  readonly smokes = new SparseSet<SmokeComp>()
  readonly planes = new SparseSet<PlaneComp>()
  readonly lasers = new SparseSet<LaserComp>()
  readonly airstrikes = new SparseSet<AirstrikeComp>()
  readonly empPulses = new SparseSet<EmpPulseComp>()
  readonly flashes = new SparseSet<DamageFlashComp>()
  readonly healFlashes = new SparseSet<HealFlashComp>()
  readonly scenery = new SparseSet<SceneryComp>()
  readonly mines = new SparseSet<MineComp>()
  readonly transports = new SparseSet<TransportComp>()
  /** Pairs "vid|iid" that have already crush-contacted; re-arms after separation. */
  readonly crushPairs = new Set<string>()
  readonly pings: PingComp[] = []

  readonly events: SimEvent[] = []
  private readonly entityKinds = new Map<number, 'unit' | 'building' | 'field' | 'marker' | 'scenery' | 'wreck' | 'mine'>()

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
      this.teams.set(p, { credits: this.settings.startingCredits, powerGen: 0, powerUse: 0, powerNet: 0, powerDown: false, radar: false, satellite: false, satelliteRevealUntil: -1, satelliteLastUsed: -100000, laser: false, laserLastUsed: -100000, laserFreeShotUsed: false, laserLevel: 0, alliance: p, color: p, stealthTech: false, detectorUnlocked: false, mineTech: false, abilitiesUnlocked: false, transportCapacityLevel: 0, defenseDome: false, weaponUpgradeLevel: 0, swChoice: null, airstrikeLastUsed: -100000, empLastUsed: -100000, score: 0, rank: 0, airstrikeLevel: 0, empLevel: 0 })
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
      this.fields.set(id, { radius, capacity, trips: capacity, capturer: -1, captureTicks: 0, capturingScout: 0, holdTicks: 0 })
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

  createEntity(kind: 'unit' | 'building' | 'field' | 'marker' | 'scenery' | 'wreck' | 'mine', team: number): number {
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
    this.airstrikes.delete(id)
    this.empPulses.delete(id)
    this.flashes.delete(id)
    this.healFlashes.delete(id)
    this.scenery.delete(id)
    this.mines.delete(id)
    this.transports.delete(id)
    if (kind === 'building') {
      for (const q of this.buildOrderQueues.values()) {
        const i = q.indexOf(id)
        if (i >= 0) q.splice(i, 1)
      }
    } else if (kind === 'unit') {
      this.buildOrderQueues.delete(id)
    }
    this.entityKinds.delete(id)
    if (kind === 'building' || kind === 'field' || kind === 'scenery') this.gridDirty = true
    if (team >= 0) {
      this.events.push({ type: 'entity-destroyed', entity: id, kind, team, x: deadX, y: deadY, ...(typeName !== undefined ? { typeName } : {}) })
    }
    // Day 15 kill score: the killer team (last attacker) gets points so the
    // rank ladder can climb from battle alone. No lastAttacker entry means the
    // object was sold/refunded, not destroyed by combat.
    const killer = this.lastAttacker.get(id)
    if (killer !== undefined && killer !== team && killer >= 0) {
      const pts = kind === 'unit' ? SCORE_UNIT_KILL : kind === 'building' ? SCORE_BUILDING_KILL : 0
      if (pts > 0) this.awardScore(killer, pts)
    }
    this.lastAttacker.delete(id)
  }

  teamOf(id: number): number {
    const u = this.units.get(id)
    if (u) return u.team
    const b = this.buildings.get(id)
    if (b) return b.team
    const f = this.oilFields.get(id)
    if (f && f.owner >= 0) return f.owner
    const m = this.mines.get(id)
    if (m) return m.team
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

  // ---- Day 16: team co-op (shared economy / rank / control) ----

  /** Sorted slot ids sharing the given team's alliance. */
  allianceMembers(team: number): number[] {
    const a = this.allianceOf(team)
    const out: number[] = []
    this.teams.forEach((_s, t) => {
      if (this.allianceOf(t) === a) out.push(t)
    })
    out.sort((x, y) => x - y)
    return out
  }

  /** Lowest slot id of the alliance — canonical holder of its shared pool/ladder. */
  coopCanonical(team: number): number {
    return this.allianceMembers(team)[0] ?? team
  }

  /** Slot whose `credits` is the alliance bank (own slot when supply isn't shared). */
  creditsSlot(team: number): number {
    const eco = this.settings.coopEconomy
    return eco === 'supply' || eco === 'both' ? this.coopCanonical(team) : team
  }

  /** Day 16: with shared supply, move every member's starting credits into the
   * canonical slot so the alliance opens the match with the combined bank.
   * Call once after alliances are assigned (Game.boot). */
  rewireSharedStartingCredits(): void {
    if (this.settings.coopEconomy !== 'supply' && this.settings.coopEconomy !== 'both') return
    const seen = new Set<number>()
    for (const t of [...this.teams.keys()]) {
      const a = this.allianceOf(t)
      if (seen.has(a)) continue
      seen.add(a)
      const members = this.allianceMembers(t)
      if (members.length < 2) continue
      const canon = members[0]
      const canonTs = this.teams.get(canon)
      if (!canonTs) continue
      let total = canonTs.credits
      for (const m of members) {
        if (m === canon) continue
        total += this.teams.get(m)?.credits ?? 0
      }
      canonTs.credits = total
      for (const m of members) {
        if (m === canon) continue
        const ts = this.teams.get(m)
        if (ts) ts.credits = 0
      }
    }
  }

  /** Slot whose power totals are the fused alliance grid (own when power isn't shared). */
  powerSlot(team: number): number {
    const eco = this.settings.coopEconomy
    return eco === 'power' || eco === 'both' ? this.coopCanonical(team) : team
  }

  /** Slot whose score/rank is the alliance ladder (own when co-op rank is off). */
  rankSlot(team: number): number {
    return this.settings.coopRank !== 'none' ? this.coopCanonical(team) : team
  }

  creditsOf(team: number): number {
    return this.teams.get(this.creditsSlot(team))?.credits ?? 0
  }

  canAfford(team: number, cost: number): boolean {
    return this.creditsOf(team) >= cost
  }

  grantCredits(team: number, amount: number): void {
    const s = this.teams.get(this.creditsSlot(team))
    if (s) s.credits += amount
  }

  spendCredits(team: number, amount: number): boolean {
    const s = this.teams.get(this.creditsSlot(team))
    if (!s || s.credits < amount) return false
    s.credits -= amount
    return true
  }

  /** Fused power totals for the alliance (used by the HUD + placing fusion pass). */
  alliancePowerOf(team: number): { gen: number; use: number; net: number } {
    let gen = 0
    let use = 0
    for (const m of this.allianceMembers(team)) {
      const s = this.teams.get(m)
      if (s) {
        gen += s.powerGen
        use += s.powerUse
      }
    }
    return { gen, use, net: gen - use }
  }

  /** Effective control-sharing level for the team's alliance (lobby setting). */
  controlLevel(_team: number): CoopControl {
    return this.settings.coopControl
  }

  /** Whether `player` may command the entity (unit or building) `id`. Allies get
   * units when sharing is 'units' (buildings stay own) or everything at 'all'. */
  canControl(player: number, id: number): boolean {
    const u = this.units.get(id)
    if (u) {
      if (u.team === player) return true
      const eff = this.controlLevel(player)
      if (eff === 'none') return false
      return this.allianceOf(u.team) === this.allianceOf(player)
    }
    const b = this.buildings.get(id)
    if (b) {
      if (b.team === player) return true
      return this.controlLevel(player) === 'all' && this.allianceOf(b.team) === this.allianceOf(player)
    }
    return false
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

  kindOf(id: number): 'unit' | 'building' | 'field' | 'marker' | 'scenery' | 'wreck' | 'mine' | undefined {
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
      s = { credits: 0, powerGen: 0, powerUse: 0, powerNet: 0, powerDown: false, radar: false, satellite: false, satelliteRevealUntil: -1, satelliteLastUsed: -100000, laser: false, laserLastUsed: -100000, laserFreeShotUsed: false, laserLevel: 0, alliance: team, color: team, stealthTech: false, detectorUnlocked: false, mineTech: false, abilitiesUnlocked: false, transportCapacityLevel: 0, defenseDome: false, weaponUpgradeLevel: 0, swChoice: null, airstrikeLastUsed: -100000, empLastUsed: -100000, score: 0, rank: 0, airstrikeLevel: 0, empLevel: 0 }
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
    return !!s && s.radar
  }

  /** Total transport slots of an APC unit or garrison building (bunker),
   * including Tech-Center capacity research for APCs. */
  transportCapacityOf(id: number): number {
    const unit = this.units.get(id)
    if (unit) {
      const def = getUnit(unit.unitType, this.settings)
      const base = def.transportCapacity ?? 0
      if (base === 0) return 0
      const level = this.teams.get(unit.team)?.transportCapacityLevel ?? 0
      return base + level * TRANSPORT_CAPACITY_PER_LEVEL
    }
    const building = this.buildings.get(id)
    if (building) {
      const def = getBuilding(building.buildingType, this.settings)
      return def.transportCapacity ?? 0
    }
    return 0
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

  /** The Super Weapon strike this team locked in, or null before the first `sw-choose`. */
  swChoiceOf(team: number): SwChoice | null {
    return this.teams.get(team)?.swChoice ?? null
  }

  /** Whether the team can call an airstrike right now (chosen, SW alive, off cooldown, powered). */
  airstrikeAvailable(team: number): boolean {
    const s = this.teams.get(team)
    if (!s || s.swChoice !== 'airstrike') return false
    if (this.tick - s.airstrikeLastUsed < this.settings.airstrikeCooldownTicks) return false
    if (s.powerDown) return false
    if (!this.hasDoneBuilding(team, 'super-weapon')) return false
    return true
  }

  airstrikeCooldownRemaining(team: number): number {
    const s = this.teams.get(team)
    if (!s || s.swChoice !== 'airstrike') return 0
    return Math.max(0, this.settings.airstrikeCooldownTicks - (this.tick - s.airstrikeLastUsed))
  }

  /** Whether the team can call an EMP right now (chosen, SW alive, off cooldown, powered). */
  empAvailable(team: number): boolean {
    const s = this.teams.get(team)
    if (!s || s.swChoice !== 'emp') return false
    if (this.tick - s.empLastUsed < this.settings.empCooldownTicks) return false
    if (s.powerDown) return false
    if (!this.hasDoneBuilding(team, 'super-weapon')) return false
    return true
  }

  empCooldownRemaining(team: number): number {
    const s = this.teams.get(team)
    if (!s || s.swChoice !== 'emp') return 0
    return Math.max(0, this.settings.empCooldownTicks - (this.tick - s.empLastUsed))
  }

  /** Day 13 EMP: whether a unit/building is disabled by a nullification zone. */
  empStunned(id: number): boolean {
    const u = this.units.get(id)
    if (u && u.empUntil !== undefined && u.empUntil > this.tick) return true
    const b = this.buildings.get(id)
    if (b && b.empUntil !== undefined && b.empUntil > this.tick) return true
    return false
  }

  weaponUpgradeLevel(team: number): number {
    return this.teams.get(team)?.weaponUpgradeLevel ?? 0
  }

  weaponMaxLevel(): number {
    return WEAPON_UPGRADE_MAX_LEVEL
  }

  weaponUpgradeCost(team: number, baseCost: number): number {
    return baseCost * (this.weaponUpgradeLevel(team) + 1)
  }

  // ---- Day 15: match score + general rank (Zero Hour style) ----

  /** Add match score to a team and return the new total. Score sources are
   * deterministic sim events (kills, supply, research, expansions) so the host
   * and every client agree on when a rank-up becomes available. When the team
   * shares a co-op ladder (Day 16) the score lands on the alliance's slot. */
  awardScore(team: number, pts: number): number {
    const s = this.teams.get(this.rankSlot(team))
    if (!s || pts <= 0) return s?.score ?? 0
    s.score += pts
    // Promotion is automatic: every client sees the score cross a floor at the
    // same sim tick, so no "rank up" button or command is needed.
    while (this.canRankUp(team)) this.rankUp(team)
    return s.score
  }

  scoreOf(team: number): number {
    return this.teams.get(this.rankSlot(team))?.score ?? 0
  }

  rankOf(team: number): number {
    return this.teams.get(this.rankSlot(team))?.rank ?? 0
  }

  /** Score threshold needed for the given rank-up (1-based star). */
  rankFloor(rank: number): number {
    return rank > 0 && rank <= RANK_FLOORS.length ? RANK_FLOORS[rank - 1] : Number.POSITIVE_INFINITY
  }

  /** Whether the team has scored enough to reach the next star (and isn't maxed). */
  canRankUp(team: number): boolean {
    const s = this.teams.get(this.rankSlot(team))
    if (!s || s.rank >= MAX_RANK) return false
    return s.score >= this.rankFloor(s.rank + 1)
  }

  /** Apply a rank-up: rank++ and a free credits prize (Zero Hour: nothing is consumed). */
  rankUp(team: number): boolean {
    const s = this.teams.get(this.rankSlot(team))
    if (!s || !this.canRankUp(team)) return false
    s.rank += 1
    if (this.settings.rankUpPrizeCredits > 0) this.grantCredits(team, this.settings.rankUpPrizeCredits)
    this.emit({ type: 'rank-up', team, rank: s.rank, score: s.score })
    return true
  }

  // ---- Day 15: leveled super weapons (airstrike / EMP at 3★) ----

  airstrikeLevel(team: number): number {
    return this.teams.get(team)?.airstrikeLevel ?? 0
  }

  airstrikeMaxLevel(): number {
    return AIRSTRIKE_MAX_LEVEL
  }

  /** Damage multiplier of the leveled airstrike (lvl1 = 1.5x, lvl2 = 2x). */
  airstrikeDamageMultiplier(team: number): number {
    return 1 + 0.5 * this.airstrikeLevel(team)
  }

  /** Radius multiplier of the leveled airstrike (lvl1 = 1.15x, lvl2 = 1.3x). */
  airstrikeRadiusMultiplier(team: number): number {
    return 1 + 0.15 * this.airstrikeLevel(team)
  }

  empLevel(team: number): number {
    return this.teams.get(team)?.empLevel ?? 0
  }

  empMaxLevel(): number {
    return EMP_MAX_LEVEL
  }

  /** Radius multiplier of the leveled EMP pulse (lvl1 = 1.15x, lvl2 = 1.3x). */
  empRadiusMultiplier(team: number): number {
    return 1 + 0.15 * this.empLevel(team)
  }

  /** Duration multiplier of the leveled EMP stun. */
  empDurationMultiplier(team: number): number {
    return 1 + 0.5 * this.empLevel(team)
  }

  /** Flat duration (ticks) of a leveled EMP pulse for a team. */
  empDurationTicks(team: number): number {
    return Math.round(this.settings.empDurationTicks * this.empDurationMultiplier(team))
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
    // Shared "hard blocked" layer: anything that fully occupies a tile (a building,
    // field, oil field or solid terrain obstacle). passable/buildable/water masks
    // are derived from terrain plus this layer so ships never sail through a built-up tile.
    const hardBlocked = new Uint8Array(width * height)
    for (const o of map.obstructions) {
      if (o.type === 'rock' || o.type === 'tree') continue
      for (let y = o.y; y < o.y + o.h; y++) {
        for (let x = o.x; x < o.x + o.w; x++) {
          hardBlocked[tileIndex(map, x, y)] = 1
        }
      }
    }
    this.scenery.forEach((_id, s) => {
      if (s.type !== 'rock') return
      for (let y = s.y; y < s.y + s.h; y++) {
        for (let x = s.x; x < s.x + s.w; x++) {
          if (x >= 0 && y >= 0 && x < width && y < height) hardBlocked[tileIndex(map, x, y)] = 1
        }
      }
    })
    this.fields.forEach((id, f) => {
      const t = this.transforms.require(id)
      const cx = Math.floor(t.x / 1000)
      const cy = Math.floor(t.y / 1000)
      for (let y = cy - f.radius; y <= cy + f.radius; y++) {
        for (let x = cx - f.radius; x <= cx + f.radius; x++) {
          if (x >= 0 && y >= 0 && x < width && y < height) hardBlocked[tileIndex(map, x, y)] = 1
        }
      }
    })
    this.oilFields.forEach((id, f) => {
      const t = this.transforms.require(id)
      const cx = Math.floor(t.x / 1000)
      const cy = Math.floor(t.y / 1000)
      for (let y = cy - f.radius; y <= cy + f.radius; y++) {
        for (let x = cx - f.radius; x <= cx + f.radius; x++) {
          if (x >= 0 && y >= 0 && x < width && y < height) hardBlocked[tileIndex(map, x, y)] = 1
        }
      }
    })
    this.buildings.forEach((id, b) => {
      const t = this.transforms.require(id)
      const r = rectFromCenter(t.x, t.y, b.footprintW, b.footprintH)
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) {
          if (x >= 0 && y >= 0 && x < width && y < height) hardBlocked[tileIndex(map, x, y)] = 1
        }
      }
    })
    const passable = new Uint8Array(width * height)
    const buildable = new Uint8Array(width * height)
    const water = new Uint8Array(width * height)
    for (let i = 0; i < passable.length; i++) {
      const blocked = hardBlocked[i]
      const t = map.tiles[i]
      passable[i] = isPassableTerrain(t) && !blocked ? 1 : 0
      buildable[i] = isBuildableTerrain(t) && !blocked ? 1 : 0
      water[i] = t === Terrain.Water && !blocked ? 1 : 0
    }
    this.grid = {
      width,
      height,
      passable,
      buildable,
      component: new Uint32Array(passable.length),
      water,
      waterComponent: new Uint32Array(passable.length),
    }
    this.gridDirty = false
    this.computeComponents()
  }

  private computeComponents(): void {
    const grid = this.grid
    if (!grid) return
    this.computeComponentsOf(grid.passable, grid.component)
    this.computeComponentsOf(grid.water, grid.waterComponent)
  }

  private computeComponentsOf(mask: Uint8Array, component: Uint32Array): void {
    const grid = this.grid!
    const { width, height } = grid
    const queue = new Int32Array(mask.length)
    let cid = 0
    component.fill(0)
    for (let start = 0; start < mask.length; start++) {
      if (!mask[start] || component[start] !== 0) continue
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
        if (cx > 0 && mask[ni] && component[ni] === 0) {
          component[ni] = cid
          queue[tail++] = ni
        }
        const ei = cy * width + (cx + 1)
        if (cx + 1 < width && mask[ei] && component[ei] === 0) {
          component[ei] = cid
          queue[tail++] = ei
        }
        const ui2 = (cy - 1) * width + cx
        if (cy > 0 && mask[ui2] && component[ui2] === 0) {
          component[ui2] = cid
          queue[tail++] = ui2
        }
        const di = (cy + 1) * width + cx
        if (cy + 1 < height && mask[di] && component[di] === 0) {
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
