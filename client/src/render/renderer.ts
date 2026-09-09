import { Application, Container, Graphics, Sprite, Text, Texture } from 'pixi.js'
import { BUILDINGS, PLAYER_COLOR_COUNT, PLAYER_COLORS, UNITS, getBuilding, getWeapon, type MapData, type PingType } from '@space-arenas/shared'
import type { World, PingComp } from '../core/world.ts'
import { PING_TICKS } from '../core/world.ts'
import { Camera, ISO_HALF_H, ISO_HALF_W } from './camera.ts'
import { addGroundTo, FogRenderer } from './ground.ts'
import { clearShapeCache, fieldTexture, flagTexture, lightningTexture, obstacleTexture, textureFor } from './shapes.ts'
import { buildingStatusIndex, buildingStatusTexture, fxFrameTexture, obstacleImageTexture, oilFieldStatusTexture, preloadBuildingSprites, preloadFieldSprites, preloadFxFrames, preloadUnitSprites, supplyFieldStatusTexture, UNIT_SPRITE_WIDTH, unitDirFromScreenAngle, unitImagesAvailable, unitTextureByName } from './building-sprites.ts'
import type { Minimap } from './minimap.ts'
import type { BoxInfo } from '../input/input.ts'
import { findSpawnTile } from '../systems/production-system.ts'
import { rectFromCenter } from '../core/geometry.ts'
import { t, tn } from '../i18n/index.ts'
import { effectEnabled, getGraphics, dayNightTint } from '../ui/graphics.ts'

const PING_NUM_COLORS: Record<PingType, number> = {
  alert: 0xff5c5c,
  assist: 0xffd45e,
  'on-my-way': 0x7cf27c,
}

const PRODUCERS = new Set(['command-center', 'supply-dock', 'barracks', 'war-factory', 'air-force'])
/** Weapon attack range in tiles for a building that can fire (e.g. turret), or null when it has no weapon. */
const buildingDefRange = (type: string, settings: World['settings']): number | null => {
  const def = getBuilding(type, settings)
  if (!def || !def.weapon) return null
  const weapon = getWeapon(def.weapon, settings)
  return weapon && weapon.range > 0 ? weapon.range : null
}
/** Approximate on-screen width (px) of a vector obstacle shape at scale 1, for image size parity. */
const OBSTACLE_BASE_WIDTH = 30
const BAR_W = 26
const BAR_H = 4

const VETERAN_PIP_COLOR = 0xffcf33
const VETERAN_PIP_W = 3
const VETERAN_PIP_H = 12
const VETERAN_PIP_GAP = 3
const VETERAN_STAR_R = 9

/** Local width of the veterancy icon row for a rank (bars 1–4, star at 5). */
const veteranPipWidth = (rank: number): number =>
  rank >= 5 ? VETERAN_STAR_R * 2 : rank * VETERAN_PIP_W + (rank - 1) * VETERAN_PIP_GAP

/** Draws the veterancy icon, centered on (0,0). Ranks 1–4 = gold bars, rank 5 = star. */
const drawVeteranPips = (shape: Graphics, rank: number): void => {
  shape.clear()
  if (rank >= 5) {
    const pts: number[] = []
    for (let k = 0; k < 10; k++) {
      const ang = -Math.PI / 2 + (k * Math.PI) / 5
      const r = k % 2 === 0 ? VETERAN_STAR_R : VETERAN_STAR_R * 0.45
      pts.push(Math.cos(ang) * r, Math.sin(ang) * r)
    }
    shape.poly(pts).fill(VETERAN_PIP_COLOR)
  } else {
    for (let i = 0; i < rank; i++) {
      const x = -veteranPipWidth(rank) / 2 + i * (VETERAN_PIP_W + VETERAN_PIP_GAP)
      shape.rect(x, -VETERAN_PIP_H / 2, VETERAN_PIP_W, VETERAN_PIP_H).fill(VETERAN_PIP_COLOR)
    }
  }
}

const OBSTRUCTION_COLORS: Record<string, number> = {
  rock: 0xffb35c,
  wreck: 0x9aa7b8,
  tree: 0x58d070,
}

export interface GhostState {
  kind: 'unit' | 'building'
  type: string
  xFx: number
  yFx: number
  valid: boolean
  team: number
}

export class Renderer {
  app!: Application
  showBorders = false
  showAll = false
  showPaths = false
  showBases = true
  private localTeam = -1
  private lastFogTick = -1
  private readonly vv = window.visualViewport
  private worldLayer = new Container()
  private teamLayer = new Container()
  private entityLayer = new Container()
  private hitboxLayer = new Container()
  private fieldLayer = new Container()
  private obstacleLayer = new Container()
  private spawnLayer = new Container()
  private flagLayer = new Container()
  private airLayer = new Container()
  private teamFlagLayer = new Container()
  private unitFlagSprites = new Map<number, Sprite>()
  private flagDotTex: Texture = Texture.EMPTY
  private veteranPipLayer = new Container()
  private veteranPips = new Map<number, Graphics>()
  private veteranPipRank = new Map<number, number>()
  private airShadowTex: Texture = Texture.EMPTY
  private shadowLayer = new Container()
  private airShadowTopLayer = new Container()
  private airShadows = new Map<number, Sprite>()
  private ghostLayer = new Container()
  private barLayer = new Container()
  private fxLayer = new Container()
  private rallyLineG = new Graphics()
  private debugLayer = new Container()
  private pathLayer = new Container()
  private pathGraphics = new Graphics()
  private boxLayer = new Container()
  private boxGraphics = new Graphics()
  private nightOverlay = new Graphics()
  private nightPhase = -1
  private fxGraphics = new Graphics()
  private ghostSprite: Sprite | null = null
  private ghostOutline = new Graphics()
  private rangeRingG = new Graphics()
  private impacts: Array<{ x: number; y: number; age: number }> = []
  private projectiles: Array<{ x0: number; y0: number; x1: number; y1: number; age: number; team: number }> = []
  laserTarget: { x: number; y: number; valid: boolean } | null = null
  /** Pending multi-position move waypoints (fx coords) drawn as green circles. */
  routePoints: Array<{ x: number; y: number }> | null = null
  routeIdx = 0
  /** When a grenade/smoke toggle is armed, draws a throw-range ring around each selected unit. */
  abilityRing: { radiusTiles: number; color: number } | null = null
  private routeLabels: Text[] = []
  private hoverWorld: { x: number; y: number } | null = null
  private hoverText: Text | null = null
  private fog: FogRenderer | null = null
  readonly camera = new Camera(800, 600)
  private entitySprites = new Map<number, Sprite>()
  private unitFacing = new Map<number, string>()
  private flashSprites = new Map<number, Sprite>()
  private flameSprites = new Map<number, Sprite>()
  private burnProcedural: Texture[] = []
  private hitFlashTex: Texture = Texture.EMPTY
  private teamMarkers = new Map<number, Sprite>()
  private hitboxSprites = new Map<number, Sprite>()
  private outlineTexCache = new Map<string, Texture>()
  private fillTexCache = new Map<string, Texture>()
  private spawnMarkers = new Map<number, Sprite>()
  private spawnTex: Texture = Texture.EMPTY
  private flagMarkers = new Map<number, Sprite>()
  private flagTex: Texture = Texture.EMPTY
  private barSprites = new Map<number, { bg: Sprite; fill: Sprite }>()
  private barBgTex: Texture = Texture.EMPTY
  private wreckBars = new Map<number, { bg: Sprite; fill: Sprite }>()
  private fieldSprites = new Map<number, Sprite>()
  private fieldBars = new Map<number, { bg: Sprite; fill: Sprite }>()
  private fieldLabels = new Map<number, Text>()
  private fieldTex: Texture = Texture.EMPTY
  private oilFieldSprites = new Map<number, Sprite>()
  private oilFieldBars = new Map<number, { bg: Sprite; fill: Sprite }>()
  private oilFieldLabels = new Map<number, Text>()
  private scenerySprites = new Map<number, Sprite>()
  private sceneryBars = new Map<number, { bg: Sprite; fill: Sprite }>()
  private treeFalls: Array<{ spr: Sprite; isoX: number; isoY: number; age: number }> = []
  private wreckEntitySprites = new Map<number, Sprite>()
  private sellFx: Array<{ spr: Sprite; isoX: number; isoY: number; scale: number; age: number }> = []
  private minimap: Minimap | null = null
  private powerLayer = new Container()
  private lightningTex: Texture = Texture.EMPTY
  private powerIcons = new Map<number, Sprite>()
  /** Super-weapon camera shake: world ticks during which the view oscillates. */
  private shakeStart = 0
  private shakeUntil = 0
  private shakeAmp = 0

  private onWindowResize = (): void => {
    const w = window.innerWidth
    const h = window.innerHeight
    const cx = this.camera.viewWidth / 2
    const cy = this.camera.viewHeight / 2
    const anchor = this.camera.screenToWorldExact(cx, cy)
    this.camera.resize(w, h)
    this.camera.centerOn(anchor.x, anchor.y)
  }

  async init(container: HTMLElement, map: MapData, colors?: number[]): Promise<void> {
    this.app = new Application()
    await this.app.init({
      resizeTo: window,
      background: 0x101418,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
    })
    container.appendChild(this.app.canvas)

    const barBg = new Graphics().rect(0, 0, BAR_W, BAR_H).fill(0x0a0d14).stroke({ color: 0x2a3350, width: 1 })
    this.barBgTex = this.app.renderer.generateTexture({ target: barBg, resolution: 8, antialias: true })
    barBg.destroy()

    const chevron = new Graphics().poly([0, -8, 7, 8, -7, 8]).fill(0xffffff)
    this.spawnTex = this.app.renderer.generateTexture({ target: chevron, resolution: 8, antialias: true })
    chevron.destroy()

    this.flagTex = flagTexture(this.app.renderer)

    const dot = new Graphics().circle(0, 0, 5).fill(0xffffff)
    this.flagDotTex = this.app.renderer.generateTexture({ target: dot, resolution: 8, antialias: true })
    dot.destroy()

    const shadowCanvas = document.createElement('canvas')
    shadowCanvas.width = 64
    shadowCanvas.height = 64
    const sctx = shadowCanvas.getContext('2d')!
    const grad = sctx.createRadialGradient(32, 32, 4, 32, 32, 30)
    grad.addColorStop(0, 'rgba(0,0,0,0.85)')
    grad.addColorStop(0.6, 'rgba(0,0,0,0.35)')
    grad.addColorStop(1, 'rgba(0,0,0,0)')
    sctx.fillStyle = grad
    sctx.fillRect(0, 0, 64, 64)
    this.airShadowTex = Texture.from(shadowCanvas)

    const makeFireTex = (variant: number): Texture => {
      const fireCanvas = document.createElement('canvas')
      fireCanvas.width = 32
      fireCanvas.height = 32
      const fctx = fireCanvas.getContext('2d')!
      fctx.translate(16, 15)
      const tall = variant === 0
      const rx = tall ? 6.5 : 9.5
      const ry = tall ? 14 : 11
      const fg = fctx.createRadialGradient(0, tall ? 3 : 2, 2, 0, 0, Math.max(rx, ry))
      fg.addColorStop(0, '#fff8d8')
      fg.addColorStop(0.35, '#ffe05c')
      fg.addColorStop(0.72, '#ff8a2a')
      fg.addColorStop(1, 'rgba(255,60,16,0)')
      fctx.fillStyle = fg
      fctx.beginPath()
      fctx.ellipse(0, tall ? 2 : 3, rx, ry, 0, 0, Math.PI * 2)
      fctx.fill()
      fctx.beginPath()
      fctx.arc(0, tall ? 7 : 6, 2.6, 0, Math.PI * 2)
      fctx.fillStyle = 'rgba(255,255,220,0.85)'
      fctx.fill()
      return Texture.from(fireCanvas)
    }
    this.burnProcedural = [makeFireTex(0), makeFireTex(1)]
    if (getGraphics().assetPaths['fx:burn']?.trim()) preloadFxFrames('burn')

    // soft white blaze for the hit-flash overlay (drawn additively over the unit)
    const flashCanvas = document.createElement('canvas')
    flashCanvas.width = 64
    flashCanvas.height = 64
    const fctx = flashCanvas.getContext('2d')!
    const fg2 = fctx.createRadialGradient(32, 32, 2, 32, 32, 30)
    fg2.addColorStop(0, 'rgba(255,255,255,0.95)')
    fg2.addColorStop(0.55, 'rgba(255,255,255,0.4)')
    fg2.addColorStop(1, 'rgba(255,255,255,0)')
    fctx.fillStyle = fg2
    fctx.fillRect(0, 0, 64, 64)
    this.hitFlashTex = Texture.from(flashCanvas)

    this.fieldTex = fieldTexture(this.app.renderer)
    this.lightningTex = lightningTexture(this.app.renderer)

    this.camera.resize(this.app.renderer.width / this.app.renderer.resolution, this.app.renderer.height / this.app.renderer.resolution)
    await preloadBuildingSprites(colors)
    await preloadFieldSprites()
    await preloadUnitSprites(colors)
    window.addEventListener('resize', this.onWindowResize)
    window.addEventListener('orientationchange', this.onWindowResize)
    this.vv?.addEventListener('resize', this.onWindowResize)

    addGroundTo(this.worldLayer, map)
    this.fog = new FogRenderer(map)
    this.worldLayer.addChild(this.fog.container)
    this.worldLayer.addChild(this.shadowLayer)
    this.worldLayer.addChild(this.teamLayer)
    this.worldLayer.addChild(this.entityLayer)
    this.worldLayer.addChild(this.hitboxLayer)
    this.worldLayer.addChild(this.fieldLayer)
    this.worldLayer.addChild(this.obstacleLayer)
    this.worldLayer.addChild(this.spawnLayer)
    this.worldLayer.addChild(this.flagLayer)
    this.flagLayer.addChild(this.rallyLineG)
    this.worldLayer.addChild(this.airLayer)
    this.worldLayer.addChild(this.ghostLayer)
    this.ghostLayer.addChild(this.ghostOutline)
    this.ghostLayer.addChild(this.rangeRingG)
    this.worldLayer.addChild(this.barLayer)
    this.worldLayer.addChild(this.veteranPipLayer)
    this.worldLayer.addChild(this.powerLayer)
    this.worldLayer.addChild(this.teamFlagLayer)
    this.worldLayer.addChild(this.fxLayer)
    this.worldLayer.addChild(this.debugLayer)
    this.worldLayer.addChild(this.pathLayer)
    this.worldLayer.addChild(this.airShadowTopLayer)
    this.fxLayer.addChild(this.fxGraphics)
    this.pathLayer.addChild(this.pathGraphics)
    this.buildStaticScenery(map)
    this.buildStaticDebug(map)
    this.app.stage.addChild(this.worldLayer)
    this.nightOverlay.eventMode = 'none'
    this.app.stage.addChild(this.nightOverlay)

    this.boxLayer.addChild(this.boxGraphics)
    this.app.stage.addChild(this.boxLayer)
  }

  /** Cosmetic night overlay tint — `phase` 0 = full day, 1 = full night. */
  setDayNight(phase: number): void {
    if (Math.round(phase * 1000) === this.nightPhase) return
    this.nightPhase = Math.round(phase * 1000)
    const t = dayNightTint(phase)
    this.nightOverlay.clear()
    if (t.a > 0) {
      this.nightOverlay.rect(0, 0, this.app.screen.width, this.app.screen.height).fill({ color: t.color, alpha: t.a })
    }
  }

  setMinimap(m: Minimap | null): void {
    this.minimap = m
  }

  /** Drives the camera shake from live laser strikes: hard the moment the beam
   * starts, decaying linearly so it ends exactly when the strike finishes. */
  private updateLaserShake(world: World): void {
    let until = -1
    let start = 0
    world.lasers.forEach((_id, l) => {
      if (world.tick < l.startTick || world.tick >= l.untilTick) return
      // when several strikes overlap, ride the one that ends last
      if (l.untilTick > until) {
        until = l.untilTick
        start = l.startTick
      }
    })
    if (until >= 0) {
      this.shakeStart = start
      this.shakeUntil = until
      this.shakeAmp = 8
    } else {
      this.shakeAmp = 0
    }
  }

  /** Screen-space pixel offsets applied while a shake is running (world coords × zoom). */
  shakeOffset(worldTick: number): { x: number; y: number } {
    if (worldTick >= this.shakeUntil || this.shakeAmp <= 0) return { x: 0, y: 0 }
    const total = this.shakeUntil - this.shakeStart
    const t = total > 0 ? (worldTick - this.shakeStart) / total : 1
    const amp = this.shakeAmp * (1 - t)
    return { x: Math.sin(worldTick * 1.35) * amp, y: Math.cos(worldTick * 1.75) * amp }
  }

  render(
    world: World,
    localTeam: number,
    selection: Set<number>,
    ghost: GhostState | null,
    box: BoxInfo | null = null,
    moveMarker: { x: number; y: number; until: number; color: number } | null = null,
  ): void {
    // mobile browsers (URL bar show/hide, rotation quirks) can miss resize events —
    // heal the viewport whenever the window size no longer matches the camera
    const vw = Math.round(window.innerWidth)
    const vh = Math.round(window.innerHeight)
    if (vw > 0 && vh > 0 && (vw !== this.camera.viewWidth || vh !== this.camera.viewHeight)) {
      this.onWindowResize()
    }
    const { camera } = this
    this.updateLaserShake(world)
    const shake = this.shakeOffset(world.tick)
    this.localTeam = localTeam
    this.worldLayer.position.set(camera.camX * camera.zoom + shake.x, camera.camY * camera.zoom + shake.y)
    this.worldLayer.scale.set(camera.zoom)
    this.teamLayer.visible = this.showBases

    const seen = new Set<number>()
    world.units.forEach((id, u) => {
      if (!this.isEntityVisible(world, id)) return
      seen.add(id)
      this.syncSprite(id, 'unit', u.unitType, world, camera)
    })
    world.buildings.forEach((id, b) => {
      if (!this.isEntityVisible(world, id)) return
      seen.add(id)
      this.syncSprite(id, 'building', b.buildingType, world, camera)
    })
    for (const [id, spr] of this.entitySprites) {
      if (!seen.has(id)) {
        spr.parent?.removeChild(spr)
        this.entitySprites.delete(id)
        this.unitFacing.delete(id)
      }
    }
    for (const [id, flash] of this.flashSprites) {
      if (!seen.has(id)) {
        flash.parent?.removeChild(flash)
        this.flashSprites.delete(id)
      }
    }
    for (const [id, b] of this.flameSprites) {
      if (!seen.has(id)) {
        b.parent?.removeChild(b)
        this.flameSprites.delete(id)
      }
    }
    for (const [id, sh] of this.airShadows) {
      if (!seen.has(id)) {
        this.shadowLayer.removeChild(sh)
        this.airShadows.delete(id)
      }
    }

    this.syncTeamMarkers(world, camera)
    this.syncHitboxes(world, camera)
    this.syncUnitFlags(world, camera)
    this.syncVeterancy(world, camera)

    const fog = world.fog.get(localTeam)
    if (this.fog) {
      this.fog.container.visible = !this.showAll
      if (fog && !this.showAll && world.tick !== this.lastFogTick) {
        this.fog.update(fog)
        this.lastFogTick = world.tick
      }
    }

    if (ghost) {
      const ghostTex =
        ghost.kind === 'building'
          ? (buildingStatusTexture(ghost.type, 5, this.colorIndex(world, ghost.team)) ?? textureFor(ghost.kind, ghost.type, this.app.renderer))
          : textureFor(ghost.kind, ghost.type, this.app.renderer)
      if (!this.ghostSprite) {
        this.ghostSprite = new Sprite(ghostTex)
        this.ghostSprite.alpha = 0.6
        this.ghostLayer.addChild(this.ghostSprite)
      }
      if (this.ghostSprite.texture !== ghostTex) {
        this.ghostSprite.texture = ghostTex
      }
      this.ghostSprite.anchor.set(0.5)
      this.ghostSprite.tint = !ghost.valid ? 0xff4040 : ghostTex === textureFor(ghost.kind, ghost.type, this.app.renderer) ? this.teamColor(world, ghost.team) : 0xffffff
      this.ghostSprite.position.set((ghost.xFx / 1000 - ghost.yFx / 1000) * ISO_HALF_W, (ghost.xFx / 1000 + ghost.yFx / 1000) * ISO_HALF_H)
      this.ghostOutline.clear()
      if (ghost.kind === 'building') {
        this.ghostSprite.anchor.set(0.5)
        const def = getBuilding(ghost.type, world.settings)
        if (def) {
          const ratio = this.buildingFillRatio()
          if (ratio > 0) {
            const target = ratio * (def.footprint[0] + def.footprint[1]) * ISO_HALF_W
            const base = this.spriteLogicalWidth(this.ghostSprite)
            this.ghostSprite.scale.set(target / base, target / base)
          } else {
            this.ghostSprite.scale.set(1, 1)
          }
          this.ghostSprite.position.y += this.buildingOffsetDist(def.footprint[0], def.footprint[1])
          const sum = def.footprint[0] + def.footprint[1]
          const cx = (ghost.xFx / 1000 - ghost.yFx / 1000) * ISO_HALF_W
          const cy = (ghost.xFx / 1000 + ghost.yFx / 1000) * ISO_HALF_H
          this.ghostOutline
            .poly([
              cx,
              cy - (sum * ISO_HALF_H) / 2,
              cx + (sum * ISO_HALF_W) / 2,
              cy,
              cx,
              cy + (sum * ISO_HALF_H) / 2,
              cx - (sum * ISO_HALF_W) / 2,
              cy,
            ])
            .stroke({ color: ghost.valid ? 0x3fbf5f : 0xff4040, width: 2, alpha: 0.9 })
        }
      } else {
        this.ghostSprite.anchor.set(0.5)
        this.ghostSprite.scale.set(1, 1)
      }
    } else if (this.ghostSprite) {
      this.ghostLayer.removeChild(this.ghostSprite)
      this.ghostSprite = null
      this.ghostOutline.clear()
    }

    this.rangeRingG.clear()
    const hasSelectedWeapon = [...selection].some((id) => {
      const s = world.buildings.get(id)
      return s !== undefined && buildingDefRange(s.buildingType, world.settings) !== null
    })
    if (ghost && ghost.kind === 'building') {
      const range = buildingDefRange(ghost.type, world.settings)
      if (range !== null) {
        const gcx = (ghost.xFx / 1000 - ghost.yFx / 1000) * ISO_HALF_W
        const gcy = (ghost.xFx / 1000 + ghost.yFx / 1000) * ISO_HALF_H
        const ghostColor = ghost.valid ? this.teamColor(world, ghost.team) : 0xff4040
        this.drawRangeRing(this.rangeRingG, gcx, gcy, range, ghostColor, ghost.valid ? 0.45 : 0.55, 2.5, ghost.valid ? 0.07 : 0.09)
        if (!hasSelectedWeapon) {
          world.buildings.forEach((id, b) => {
            if (b.team !== ghost.team) return
            const t = world.transforms.get(id)
            if (!t) return
            const br = buildingDefRange(b.buildingType, world.settings)
            if (br === null) return
            const ix = (t.x / 1000 - t.y / 1000) * ISO_HALF_W
            const iy = (t.x / 1000 + t.y / 1000) * ISO_HALF_H
            this.drawRangeRing(this.rangeRingG, ix, iy, br, this.teamColor(world, b.team), 0.22, 1.5, 0.03)
          })
        }
      }
    }
    if (hasSelectedWeapon) {
      world.buildings.forEach((id, b) => {
        if (b.team !== localTeam) return
        const t = world.transforms.get(id)
        if (!t) return
        const br = buildingDefRange(b.buildingType, world.settings)
        if (br === null) return
        const ix = (t.x / 1000 - t.y / 1000) * ISO_HALF_W
        const iy = (t.x / 1000 + t.y / 1000) * ISO_HALF_H
        const focus = selection.has(id)
        this.drawRangeRing(this.rangeRingG, ix, iy, br, this.teamColor(world, b.team), focus ? 0.45 : 0.22, focus ? 2.5 : 1.5, focus ? 0.07 : 0.03)
      })
    }

    const ability = this.abilityRing
    if (ability) {
      selection.forEach((id) => {
        const u = world.units.get(id)
        if (!u) return
        const t = world.transforms.get(id)
        if (!t) return
        const ix = (t.x / 1000 - t.y / 1000) * ISO_HALF_W
        const iy = (t.x / 1000 + t.y / 1000) * ISO_HALF_H
        this.drawRangeRing(this.rangeRingG, ix, iy, ability.radiusTiles, ability.color, 0.5, 2, 0.05)
      })
    }

    this.debugLayer.visible = this.showBorders

    this.syncBars(world, camera, selection)
    this.syncSpawnMarkers(world, camera, selection)
    this.syncFlagMarkers(world, camera, selection)
    this.syncFields(world, camera)
    this.syncScenery(world, camera)
    this.syncWrecks(world)
    this.syncWreckBars(world, camera)
    this.syncPowerIcons(world, camera)
    this.renderBox(box)
    this.drawFx(world, moveMarker, selection)
    this.stepTreeFalls()
    this.stepFades()
    this.drawPaths(world)
    this.drawHoverName(world, camera)

    if (this.minimap) {
      this.minimap.draw(world, localTeam, this.camera, world.radarActive(localTeam), this.showAll)
    }
  }

  /** Draws a building's attack-range ring (world circle → iso ellipse) centered at an entity transform. */
  private drawRangeRing(g: Graphics, cx: number, cy: number, rangeTiles: number, color: number, strokeAlpha: number, width: number, fillAlpha: number): void {
    const ax = rangeTiles * Math.SQRT2 * ISO_HALF_W
    const ay = rangeTiles * Math.SQRT2 * ISO_HALF_H
    if (fillAlpha > 0) g.ellipse(cx, cy, ax, ay).fill({ color, alpha: fillAlpha })
    g.ellipse(cx, cy, ax, ay).stroke({ color, width, alpha: strokeAlpha })
  }

  addImpact(x: number, y: number): void {
    this.impacts.push({ x, y, age: 0 })
  }

  addProjectile(x0: number, y0: number, x1: number, y1: number, team: number): void {
    this.projectiles.push({ x0, y0, x1, y1, age: 0, team })
  }

  setHoverWorld(pt: { x: number; y: number } | null): void {
    this.hoverWorld = pt
  }

  private hoverName(world: World, id: number): string | null {
    const u = world.units.get(id)
    if (u) return tn(u.unitType, UNITS[u.unitType]?.name ?? u.unitType)
    const b = world.buildings.get(id)
    if (b) return tn(b.buildingType, BUILDINGS[b.buildingType]?.name ?? b.buildingType)
    if (world.oilFields.has(id)) return t('oil.fieldName')
    if (world.fields.has(id)) return t('supply.fieldName')
    return null
  }

  private pickHoverEntity(world: World): number | null {
    if (!this.hoverWorld) return null
    const wx = this.hoverWorld.x / 1000
    const wy = this.hoverWorld.y / 1000
    let best: number | null = null
    let bestArea = Infinity
    world.units.forEach((id, u) => {
      if (!this.isEntityVisible(world, id)) return
      const t = world.transforms.get(id)
      if (!t) return
      const r = u.class === 'vehicle' ? 1.3 : 1.1
      const dx = wx - t.x / 1000
      const dy = wy - t.y / 1000
      if (dx * dx + dy * dy <= r * r) {
        const area = r * r
        if (area < bestArea) {
          bestArea = area
          best = id
        }
      }
    })
    world.buildings.forEach((id, b) => {
      if (!this.isEntityVisible(world, id)) return
      const t = world.transforms.get(id)
      if (!t) return
      const rect = rectFromCenter(t.x, t.y, b.footprintW, b.footprintH)
      if (wx >= rect.x && wx < rect.x + rect.w && wy >= rect.y && wy < rect.y + rect.h) {
        const area = rect.w * rect.h
        if (area < bestArea) {
          bestArea = area
          best = id
        }
      }
    })
    const considerField = (id: number, radius: number): void => {
      const t = world.transforms.get(id)
      if (!t) return
      const dx = wx - t.x / 1000
      const dy = wy - t.y / 1000
      const r = radius
      if (dx * dx + dy * dy <= r * r) {
        const area = r * r
        if (area < bestArea) {
          bestArea = area
          best = id
        }
      }
    }
    world.oilFields.forEach((id, f) => considerField(id, f.radius + 0.4))
    world.fields.forEach((id, f) => considerField(id, f.radius))
    return best
  }

  private drawHoverName(world: World, camera: Camera): void {
    if (this.hoverWorld === null) {
      if (this.hoverText) this.hoverText.visible = false
      return
    }
    const id = this.pickHoverEntity(world)
    if (id === null) {
      if (this.hoverText) this.hoverText.visible = false
      return
    }
    const name = this.hoverName(world, id)
    if (name === null) {
      if (this.hoverText) this.hoverText.visible = false
      return
    }
    if (!this.hoverText) {
      this.hoverText = new Text({
        text: '',
        style: {
          fontFamily: 'ui-monospace, monospace',
          fontSize: 12,
          fill: '#ffffff',
          stroke: { color: '#000000', width: 3 },
        },
      })
      this.hoverText.anchor.set(0.5, 1)
      this.barLayer.addChild(this.hoverText)
    }
    this.hoverText.text = name
    const t = world.transforms.get(id)
    if (!t) {
      this.hoverText.visible = false
      return
    }
    const isoX = (t.x / 1000 - t.y / 1000) * ISO_HALF_W
    const isoY = (t.x / 1000 + t.y / 1000) * ISO_HALF_H
    const b = world.buildings.get(id)
    const f = world.oilFields.get(id) ?? world.fields.get(id)
    let offset = 20
    if (b) offset = (b.footprintW + b.footprintH) * ISO_HALF_H * 0.5 + 12
    else if (f) offset = f.radius * 32 + 22
    this.hoverText.position.set(isoX, isoY - offset - 26)
    const pos = { x: 0, y: 0 }
    camera.worldToScreen(t.x, t.y, pos)
    this.hoverText.visible = camera.isInView(pos.x, pos.y, 200)
  }

  private isEntityVisible(world: World, id: number): boolean {
    if (this.showAll) return true
    if (world.teamOf(id) < 0) return true
    return world.isVisibleTo(this.localTeam, id)
  }

  private entityHalfExtents(id: number, world: World, camera: Camera): { halfW: number; halfH: number } | null {
    const b = world.buildings.get(id)
    if (!b) return null
    const sum = (b.footprintW + b.footprintH) * camera.zoom
    return { halfW: (sum * ISO_HALF_W) / 2, halfH: (sum * ISO_HALF_H) / 2 }
  }

  private inView(pos: { x: number; y: number }, id: number, world: World, camera: Camera): boolean {
    const ext = this.entityHalfExtents(id, world, camera)
    return ext ? camera.isInViewBox(pos.x, pos.y, ext.halfW, ext.halfH) : camera.isInView(pos.x, pos.y)
  }

  /** Palette index chosen by a team (its player's color slot). */
  private colorIndex(world: World, team: number): number {
    if (team < 0) return 0
    const s = world.teams.get(team)
    const idx = s ? s.color : team
    return ((Math.round(idx) % PLAYER_COLOR_COUNT) + PLAYER_COLOR_COUNT) % PLAYER_COLOR_COUNT
  }

  private teamColor(world: World, team: number): number {
    if (team < 0) return 0xffffff
    return PLAYER_COLORS[this.colorIndex(world, team)]
  }

  private drawPaths(world: World): void {
    this.pathGraphics.clear()
    if (!this.showPaths) return
    world.moves.forEach((id, m) => {
      const t = world.transforms.get(id)
      if (!t) return
      const team = world.teamOf(id)
      const color = team >= 0 && !world.sameTeam(this.localTeam, team) ? 0xff8a8a : 0xff4a4a
      const pts: Array<{ x: number; y: number }> = [{ x: t.x, y: t.y }]
      for (const tile of m.path) {
        const x = (tile % world.width) * 1000 + 500
        const y = Math.floor(tile / world.width) * 1000 + 500
        pts.push({ x, y })
      }
      pts.push({ x: m.tx, y: m.ty })
      for (let i = 0; i + 1 < pts.length; i++) {
        const ax = (pts[i].x / 1000 - pts[i].y / 1000) * ISO_HALF_W
        const ay = (pts[i].x / 1000 + pts[i].y / 1000) * ISO_HALF_H
        const bx = (pts[i + 1].x / 1000 - pts[i + 1].y / 1000) * ISO_HALF_W
        const by = (pts[i + 1].x / 1000 + pts[i + 1].y / 1000) * ISO_HALF_H
        this.pathGraphics.moveTo(ax, ay).lineTo(bx, by).stroke({ color, width: 1.5, alpha: 0.7 })
      }
    })
  }

  private drawFx(world: World, moveMarker: { x: number; y: number; until: number; color: number } | null, selection: Set<number>): void {
    this.fxGraphics.clear()
    for (const p of this.projectiles) {
      const t = p.age / 10
      if (t >= 1) continue
      const alpha = 1 - t
      const cx = p.x0 + (p.x1 - p.x0) * t
      const cy = p.y0 + (p.y1 - p.y0) * t
      let dx = p.x1 - p.x0
      let dy = p.y1 - p.y0
      const len = Math.hypot(dx, dy)
      if (len > 0) {
        dx /= len
        dy /= len
      }
      const enemy = p.team >= 0 && !world.sameTeam(this.localTeam, p.team)
      const seg = 110
      const ax = ((cx - dx * seg) / 1000 - (cy - dy * seg) / 1000) * ISO_HALF_W
      const ay = ((cx - dx * seg) / 1000 + (cy - dy * seg) / 1000) * ISO_HALF_H
      const bx = ((cx + dx * seg) / 1000 - (cy + dy * seg) / 1000) * ISO_HALF_W
      const by = ((cx + dx * seg) / 1000 + (cy + dy * seg) / 1000) * ISO_HALF_H
      const color = enemy ? 0xff5a5a : 0xffe08a
      const core = enemy ? 0xffd0d0 : 0xfff2c8
      this.fxGraphics.moveTo(ax, ay).lineTo(bx, by).stroke({ color, width: 2.5, alpha: alpha * 0.9 })
      const hx = ((cx + dx * (seg * 0.35)) / 1000 - (cy + dy * (seg * 0.35)) / 1000) * ISO_HALF_W
      const hy = ((cx + dx * (seg * 0.35)) / 1000 + (cy + dy * (seg * 0.35)) / 1000) * ISO_HALF_H
      this.fxGraphics.circle(hx, hy, 2.2).fill({ color: core, alpha: alpha })
      p.age++
    }
    this.projectiles = this.projectiles.filter((p) => p.age < 10)
    for (const imp of this.impacts) {
      const t = imp.age / 14
      if (t >= 1) continue
      const px = (imp.x / 1000 - imp.y / 1000) * ISO_HALF_W
      const py = (imp.x / 1000 + imp.y / 1000) * ISO_HALF_H
      const r = 3 + t * 17
      const alpha = 1 - t
      this.fxGraphics.circle(px, py, r).stroke({ color: 0xffe08a, width: 2, alpha: alpha * 0.9 })
      this.fxGraphics.circle(px, py, r * 0.5).fill({ color: 0xffd06a, alpha: alpha * 0.35 })
      imp.age++
    }
    this.impacts = this.impacts.filter((i) => i.age < 14)
    if (this.laserTarget) {
      const r = world.laserStrikeRadius(this.localTeam) * 32
      const px = (this.laserTarget.x / 1000 - this.laserTarget.y / 1000) * ISO_HALF_W
      const py = (this.laserTarget.x / 1000 + this.laserTarget.y / 1000) * ISO_HALF_H
      const color = this.laserTarget.valid ? 0xff4a5a : 0xff4040
      this.fxGraphics.circle(px, py, r).stroke({ color, width: 2, alpha: 0.9 })
      this.fxGraphics.circle(px, py, r).fill({ color, alpha: 0.08 })
    }
    world.lasers.forEach((id, l) => {
      const t = world.transforms.get(id)
      if (!t) return
      const r = l.radius * 32
      const px = (t.x / 1000 - t.y / 1000) * ISO_HALF_W
      const py = (t.x / 1000 + t.y / 1000) * ISO_HALF_H
      if (world.tick < l.startTick) {
        const pulse = 0.55 + Math.sin(world.tick * 0.9) * 0.35
        this.fxGraphics.circle(px, py, r).stroke({ color: 0xff4a5a, width: 1.5, alpha: pulse })
        this.fxGraphics.circle(px, py, r).fill({ color: 0xff4a5a, alpha: 0.05 + pulse * 0.06 })
        this.fxGraphics.circle(px, py, 3).stroke({ color: 0xffdca0, width: 1.5, alpha: pulse })
        return
      }
      const left = l.untilTick - world.tick
      const frac = Math.max(0, Math.min(1, left / world.settings.laserDurationTicks))
      const pulse = 0.5 + Math.sin(world.tick * 0.5 + id) * 0.5
      this.fxGraphics.circle(px, py, r).stroke({ color: 0xff4a5a, width: 3, alpha: 0.9 * frac })
      this.fxGraphics.circle(px, py, r * (0.6 + pulse * 0.4)).fill({ color: 0xff2a4a, alpha: 0.12 * frac })
      if (effectEnabled('effects')) {
        const core = 0xfff2d0
        const beamH = 6000
        const top = py - beamH
        this.fxGraphics.rect(px - r * 1.2, top, r * 2.4, beamH).fill({ color: 0xff4a5a, alpha: 0.05 * frac })
        this.fxGraphics.rect(px - r * 0.6, top, r * 1.2, beamH).fill({ color: 0xff4a5a, alpha: 0.14 * frac })
        this.fxGraphics.rect(px - 2, top, 4, beamH).fill({ color: core, alpha: 0.35 * frac })
        let sx = 0
        let sy = 0
        let found = false
        world.buildings.forEach((bid, b) => {
          if (found || !b.done || b.team !== l.team || b.buildingType !== 'super-weapon') return
          const bt = world.transforms.get(bid)
          if (bt) {
            sx = bt.x
            sy = bt.y
            found = true
          }
        })
        if (found) {
          const bpx = (sx / 1000 - sy / 1000) * ISO_HALF_W
          const bpy = (sx / 1000 + sy / 1000) * ISO_HALF_H
          this.fxGraphics.moveTo(bpx, bpy).lineTo(px, py).stroke({ color: 0xff4a5a, width: 1.5, alpha: 0.25 * frac })
          this.fxGraphics.circle(bpx, bpy, 16).stroke({ color: 0xff4a5a, width: 3, alpha: 0.9 * frac })
          this.fxGraphics.circle(bpx, bpy, 16).fill({ color: 0xff4a5a, alpha: 0.15 * frac })
        }
      }
    })
    if (moveMarker && world.tick < moveMarker.until) {
      const left = moveMarker.until - world.tick
      const alpha = Math.min(1, left / 12)
      const px = (moveMarker.x / 1000 - moveMarker.y / 1000) * ISO_HALF_W
      const py = (moveMarker.x / 1000 + moveMarker.y / 1000) * ISO_HALF_H
      const color = moveMarker.color
      this.fxGraphics.circle(px, py, 8).stroke({ color, width: 2.5, alpha })
      this.fxGraphics.circle(px, py, 8).fill({ color, alpha: alpha * 0.18 })
    }
    if (this.routePoints) {
      const pts = this.routePoints
      const proj: Array<{ x: number; y: number }> = []
      for (let i = this.routeIdx; i < pts.length; i++) {
        proj.push({
          x: (pts[i].x / 1000 - pts[i].y / 1000) * ISO_HALF_W,
          y: (pts[i].x / 1000 + pts[i].y / 1000) * ISO_HALF_H,
        })
      }
      // Dotted polyline connecting the unconsumed waypoints.
      for (let i = 0; i < proj.length - 1; i++) {
        const a = proj[i]
        const b = proj[i + 1]
        const dx = b.x - a.x
        const dy = b.y - a.y
        const len = Math.hypot(dx, dy) || 1
        const ux = dx / len
        const uy = dy / len
        const dash = 9
        const gap = 7
        for (let s = 0; s < len; s += dash + gap) {
          const e = Math.min(s + dash, len)
          this.fxGraphics
            .moveTo(a.x + ux * s, a.y + uy * s)
            .lineTo(a.x + ux * e, a.y + uy * e)
            .stroke({ color: 0x52e06a, width: 1.6, alpha: 0.55 })
        }
      }
      // Numbered order badges, current waypoint emphasized.
      proj.forEach((p, j) => {
        const current = j === 0
        const r = current ? 9 : 6
        const alpha = current ? 0.95 : 0.5
        this.fxGraphics.circle(p.x, p.y, r).stroke({ color: 0x52e06a, width: current ? 2.5 : 2, alpha })
        this.fxGraphics.circle(p.x, p.y, r).fill({ color: 0x52e06a, alpha: alpha * 0.15 })
        this.ensureRouteLabel(j, j + this.routeIdx + 1, p.x, p.y)
      })
      this.hideRouteLabels(proj.length)
    }
    world.satelliteMarkers.forEach((id, m) => {
      const t = world.transforms.get(id)
      if (!t) return
      const left = m.untilTick - world.tick
      const alpha = Math.min(1, left / 15)
      const px = (t.x / 1000 - t.y / 1000) * ISO_HALF_W
      const py = (t.x / 1000 + t.y / 1000) * ISO_HALF_H
      this.fxGraphics.circle(px, py, 100).stroke({ color: 0x4ad8ff, width: 2, alpha })
      this.fxGraphics.circle(px, py, 100).fill({ color: 0x4ad8ff, alpha: alpha * 0.05 })
    })
    // grenades: arc from the thrower to the target, with a pulsing red blast
    // ring at the landing point while waiting out the fuse
    world.grenades.forEach((id, g) => {
      const t = world.transforms.get(id)
      if (!t) return
      const total = g.explodeAt - g.startTick
      const frac = Math.max(0, Math.min(1, total > 0 ? (world.tick - g.startTick) / total : 1))
      const cx = g.fromX + (t.x - g.fromX) * frac
      const cy = g.fromY + (t.y - g.fromY) * frac
      const px = (cx / 1000 - cy / 1000) * ISO_HALF_W
      const py = (cx / 1000 + cy / 1000) * ISO_HALF_H
      this.fxGraphics.circle(px, py, 4 + Math.sin(world.tick * 0.6) * 1.2).fill({ color: 0x333a3d, alpha: 0.95 })
      const tx = (t.x / 1000 - t.y / 1000) * ISO_HALF_W
      const ty = (t.x / 1000 + t.y / 1000) * ISO_HALF_H
      const pulse = 0.5 + Math.sin(world.tick * 0.35) * 0.3
      this.fxGraphics.circle(tx, ty, g.radius * 32).stroke({ color: 0xff4a3a, width: 2, alpha: 0.4 + pulse * 0.35 })
    })
    // smoke: soft grey clouds that linger, making shots through them miss
    world.smokes.forEach((id, s) => {
      const t = world.transforms.get(id)
      if (!t) return
      const left = s.untilTick - world.tick
      const px = (t.x / 1000 - t.y / 1000) * ISO_HALF_W
      const py = (t.x / 1000 + t.y / 1000) * ISO_HALF_H
      const r = s.radius * 32
      const alpha = Math.min(1, left / 30) * 0.5
      this.fxGraphics.circle(px, py, r).fill({ color: 0x9aa0aa, alpha })
      this.fxGraphics.circle(px, py, r).stroke({ color: 0xe6e8ee, width: 1.5, alpha: alpha * 0.8 })
    })
    // keep-attack and guard position markers for selected units
    world.attacks.forEach((id, a) => {
      if (a.keepAttack) {
        const px = (a.keepAttack.x / 1000 - a.keepAttack.y / 1000) * ISO_HALF_W
        const py = (a.keepAttack.x / 1000 + a.keepAttack.y / 1000) * ISO_HALF_H
        const pulse = 0.5 + Math.sin(world.tick * 0.06) * 0.3
        this.fxGraphics.circle(px, py, 7).stroke({ color: 0xff6a3a, width: 1.8, alpha: pulse })
      }
      if (a.guardMode && selection.has(id) && a.guardPost) {
        const gx = a.guardPost.x
        const gy = a.guardPost.y
        const px = (gx / 1000 - gy / 1000) * ISO_HALF_W
        const py = (gx / 1000 + gy / 1000) * ISO_HALF_H
        const weapon = getWeapon(a.weaponId, world.settings)
        const r = weapon.range * 32
        const pulse = 0.5 + Math.sin(world.tick * 0.06) * 0.25
        this.fxGraphics.circle(px, py, r).stroke({ color: 0x4ad8ff, width: 1.4, alpha: 0.12 + pulse * 0.2 })
      }
    })
    this.drawPings(world)
  }

  /** Reuse pooled Text badges for waypoint order numbers. */
  private ensureRouteLabel(idx: number, number: number, x: number, y: number): void {
    let label = this.routeLabels[idx]
    if (!label) {
      label = new Text({
        text: '',
        style: {
          fontFamily: 'ui-monospace, monospace',
          fontSize: 11,
          fontWeight: '700',
          fill: '#eaffea',
          stroke: { color: '#06220f', width: 3 },
        },
      })
      label.anchor.set(0.5)
      this.fxLayer.addChild(label)
      this.routeLabels[idx] = label
    }
    label.text = String(number)
    label.visible = true
    label.position.set(x, y - 18)
  }

  private hideRouteLabels(from: number): void {
    for (let i = from; i < this.routeLabels.length; i++) this.routeLabels[i].visible = false
  }

  /** Draw allied ping markers — expanding color-coded ring + crosshair. Cosmetically
   * reflects `world.pings`, which is populated deterministically from ping commands. */
  private drawPings(world: World): void {
    if (this.localTeam < 0 || world.pings.length === 0) return
    const myAlliance = world.allianceOf(this.localTeam)
    for (const p of world.pings) {
      if (world.allianceOf(p.team) !== myAlliance) continue
      this.drawPing(world, p)
    }
  }

  private drawPing(world: World, p: PingComp): void {
    const age = world.tick - p.started
    if (age >= PING_TICKS) return
    const a = 1 - age / PING_TICKS
    const color = PING_NUM_COLORS[p.type]
    const fx = p.x * 1000 + 500
    const fy = p.y * 1000 + 500
    const px = (fx / 1000 - fy / 1000) * ISO_HALF_W
    const py = (fx / 1000 + fy / 1000) * ISO_HALF_H
    const r = 12 + age * (84 / PING_TICKS)
    const base = Math.max(a * 0.85, 0.3)
    this.fxGraphics.circle(px, py, r).stroke({ color, width: 3, alpha: base })
    this.fxGraphics.circle(px, py, r * 0.3).fill({ color, alpha: base * 0.5 })
    const c = r * 0.55
    this.fxGraphics.moveTo(px - c, py).lineTo(px + c, py).stroke({ color, width: 1.5, alpha: base })
    this.fxGraphics.moveTo(px, py - c).lineTo(px, py + c).stroke({ color, width: 1.5, alpha: base })
  }

  private renderBox(box: BoxInfo | null): void {
    this.boxGraphics.clear()
    if (!box) return
    this.boxGraphics
      .rect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0)
      .fill({ color: 0x2a7dff, alpha: 0.12 })
      .stroke({ color: 0x2a7dff, width: 1.5, alpha: 0.9 })
  }

  /** Draw persistent wreck sprites for every live wreck entity (never fade —
   * they are collected by bulldozers and removed by the sim). */
  private syncWrecks(world: World): void {
    const seen = new Set<number>()
    world.wrecks.forEach((id, w) => {
      const t = world.transforms.get(id)
      if (!t) return
      if (!this.isEntityVisible(world, id)) return
      seen.add(id)
      let spr = this.wreckEntitySprites.get(id)
      if (!spr) {
        spr = new Sprite(obstacleTexture('wreck', this.app.renderer))
        spr.anchor.set(0.5)
        spr.tint = 0xffffff
        const aoTex = obstacleImageTexture('wreck')
        if (aoTex) {
          spr.texture = aoTex
          spr.scale.set(Math.max(0.6, w.srcKind === 'building' ? 3 : 1) * (OBSTACLE_BASE_WIDTH / (aoTex.frame.width || 1)))
        } else {
          spr.scale.set(Math.max(0.6, w.srcKind === 'building' ? 3 : 1) * 1.1)
        }
        spr.alpha = 0.95
        this.fxLayer.addChild(spr)
        this.wreckEntitySprites.set(id, spr)
      }
      const isoX = (t.x / 1000 - t.y / 1000) * ISO_HALF_W
      const isoY = (t.x / 1000 + t.y / 1000) * ISO_HALF_H
      spr.position.set(isoX, isoY)
      spr.zIndex = isoY
    })
    for (const [id, spr] of this.wreckEntitySprites) {
      if (!seen.has(id)) {
        this.fxLayer.removeChild(spr)
        spr.destroy()
        this.wreckEntitySprites.delete(id)
      }
    }
  }

  /** Draw a progress bar over a wreck while a bulldozer is collecting it. */
  private syncWreckBars(world: World, camera: Camera): void {
    const seen = new Set<number>()
    world.works.forEach((_id, w) => {
      if (w.kind !== 'collect') return
      const ticks = w.collectTicks ?? 0
      if (ticks <= 0) return
      const wc = world.wrecks.get(w.building)
      if (!wc) return
      if (!this.isEntityVisible(world, w.building)) return
      const t = world.transforms.get(w.building)
      if (!t) return
      seen.add(w.building)
      let pair = this.wreckBars.get(w.building)
      if (!pair) {
        const bg = new Sprite(this.barBgTex)
        bg.anchor.set(0.5)
        const fill = new Sprite(Texture.WHITE)
        fill.anchor.set(0, 0.5)
        fill.scale.y = BAR_H
        this.barLayer.addChild(bg)
        this.barLayer.addChild(fill)
        pair = { bg, fill }
        this.wreckBars.set(w.building, pair)
      }
      const total = world.settings.wreckCollectTicks || 1
      const frac = Math.max(0, Math.min(1, ticks / total))
      const isoX = (t.x / 1000 - t.y / 1000) * ISO_HALF_W
      const isoY = (t.x / 1000 + t.y / 1000) * ISO_HALF_H
      const barY = isoY - 24
      pair.bg.position.set(isoX, barY)
      pair.fill.position.set(isoX - BAR_W / 2, barY)
      pair.fill.scale.x = Math.max(0.001, BAR_W * frac)
      pair.fill.tint = 0xe8a24a
      const pos = { x: 0, y: 0 }
      camera.worldToScreen(t.x, t.y, pos)
      const vis = this.inView(pos, w.building, world, camera)
      pair.bg.visible = vis
      pair.fill.visible = vis
    })
    for (const [id, pair] of this.wreckBars) {
      if (!seen.has(id)) {
        this.barLayer.removeChild(pair.bg)
        this.barLayer.removeChild(pair.fill)
        this.wreckBars.delete(id)
      }
    }
  }

  private syncBars(world: World, camera: Camera, selection: Set<number>): void {
    const seen = new Set<number>()
    world.units.forEach((id, u) => {
      if (!this.isEntityVisible(world, id)) return
      seen.add(id)
      this.syncBar(id, world, camera, u.class === 'vehicle' ? 18 : 14, selection.has(id))
    })
    world.buildings.forEach((id, b) => {
      if (!this.isEntityVisible(world, id)) return
      seen.add(id)
      const top = (b.footprintW + b.footprintH) * ISO_HALF_H * 0.5
      this.syncBar(id, world, camera, top, selection.has(id))
    })
    world.oilFields.forEach((id, f) => {
      if (!this.isEntityVisible(world, id)) return
      seen.add(id)
      this.syncBar(id, world, camera, f.radius * 32 + 26, selection.has(id))
    })
    for (const [id, pair] of this.barSprites) {
      if (!seen.has(id)) {
        this.barLayer.removeChild(pair.bg)
        this.barLayer.removeChild(pair.fill)
        this.barSprites.delete(id)
      }
    }
  }

  private syncBar(id: number, world: World, camera: Camera, yOffset: number, selected: boolean): void {
    const t = world.transforms.get(id)
    const h = world.healths.get(id)
    const b = world.buildings.get(id)
    if (!t) return
    const hpFrac = h && h.maxHp > 0 ? h.hp / h.maxHp : 1
    const buildFrac = b ? b.buildProgress : 1
    const showBuild = !!b && !b.done
    const showHp = selected || hpFrac < 1
    if (!showBuild && !showHp) {
      const pair = this.barSprites.get(id)
      if (pair) {
        this.barLayer.removeChild(pair.bg)
        this.barLayer.removeChild(pair.fill)
        this.barSprites.delete(id)
      }
      return
    }
    let pair = this.barSprites.get(id)
    if (!pair) {
      const bg = new Sprite(this.barBgTex)
      bg.anchor.set(0.5)
      const fill = new Sprite(Texture.WHITE)
      fill.anchor.set(0, 0.5)
      fill.scale.y = BAR_H
      this.barLayer.addChild(bg)
      this.barLayer.addChild(fill)
      pair = { bg, fill }
      this.barSprites.set(id, pair)
    }
    const isoX = (t.x / 1000 - t.y / 1000) * ISO_HALF_W
    const isoY = (t.x / 1000 + t.y / 1000) * ISO_HALF_H
    const barY = isoY - yOffset - 8
    pair.bg.position.set(isoX, barY)
    pair.fill.position.set(isoX - BAR_W / 2, barY)
    const frac = showBuild ? buildFrac : hpFrac
    const color = showBuild ? 0x4ad8ff : hpFrac > 0.5 ? 0x4ade6a : hpFrac > 0.25 ? 0xe8d24a : 0xe84a4a
    pair.fill.scale.x = Math.max(0.001, BAR_W * frac)
    pair.fill.tint = color
    const pos = { x: 0, y: 0 }
    camera.worldToScreen(t.x, t.y, pos)
    const vis = this.inView(pos, id, world, camera)
    pair.bg.visible = vis
    pair.fill.visible = vis
  }

  private syncSpawnMarkers(world: World, camera: Camera, selection: Set<number>): void {
    world.rebuildGridIfDirty()
    const grid = world.grid
    const seen = new Set<number>()
    world.buildings.forEach((id, b) => {
      if (!PRODUCERS.has(b.buildingType)) return
      if (!selection.has(id)) return
      seen.add(id)
      const spot = grid ? findSpawnTile(world, id, grid) : null
      this.syncSpawnMarker(id, spot, world, camera)
    })
    for (const [id, spr] of this.spawnMarkers) {
      if (!seen.has(id)) {
        this.spawnLayer.removeChild(spr)
        this.spawnMarkers.delete(id)
      }
    }
  }

  private syncSpawnMarker(id: number, spot: { x: number; y: number } | null, world: World, camera: Camera): void {
    let spr = this.spawnMarkers.get(id)
    if (spot === null) {
      if (spr) {
        this.spawnLayer.removeChild(spr)
        this.spawnMarkers.delete(id)
      }
      return
    }
    if (!spr) {
      spr = new Sprite(this.spawnTex)
      spr.anchor.set(0.5)
      spr.alpha = 0.85
      this.spawnLayer.addChild(spr)
      this.spawnMarkers.set(id, spr)
    }
    const x = spot.x * 1000 + 500
    const y = spot.y * 1000 + 500
    spr.position.set((x / 1000 - y / 1000) * ISO_HALF_W, (x / 1000 + y / 1000) * ISO_HALF_H)
    const team = world.teamOf(id)
    spr.tint = this.teamColor(world, team)
    const pos = { x: 0, y: 0 }
    camera.worldToScreen(x, y, pos)
    spr.visible = camera.isInView(pos.x, pos.y)
  }

  private syncFlagMarkers(world: World, camera: Camera, selection: Set<number>): void {
    const seen = new Set<number>()
    this.rallyLineG.clear()
    world.buildings.forEach((id, b) => {
      if (!PRODUCERS.has(b.buildingType)) return
      if (b.flagTx < 0 || b.flagTy < 0) return
      if (!selection.has(id)) return
      if (b.team !== this.localTeam && !this.showAll) return
      if (!this.isEntityVisible(world, id)) return
      seen.add(id)
      const fx = b.flagTx * 1000 + 500
      const fy = b.flagTy * 1000 + 500
      this.syncFlagMarker(id, fx, fy, world, camera)
      // white dotted line from the building to its flag
      const t = world.transforms.get(id)
      if (!t) return
      const ax = (t.x / 1000 - t.y / 1000) * ISO_HALF_W
      const ay = (t.x / 1000 + t.y / 1000) * ISO_HALF_H
      const bx = (fx / 1000 - fy / 1000) * ISO_HALF_W
      const by = (fx / 1000 + fy / 1000) * ISO_HALF_H
      const len = Math.hypot(bx - ax, by - ay)
      if (len < 24) return
      const steps = Math.floor(len / 16)
      for (let i = 1; i <= steps; i++) {
        const k = i / (steps + 1)
        this.rallyLineG.circle(ax + (bx - ax) * k, ay + (by - ay) * k, 1.8).fill({ color: 0xffffff, alpha: 0.75 })
      }
    })
    for (const [id, spr] of this.flagMarkers) {
      if (!seen.has(id)) {
        this.flagLayer.removeChild(spr)
        this.flagMarkers.delete(id)
      }
    }
  }

  private syncFlagMarker(id: number, x: number, y: number, world: World, camera: Camera): void {
    let spr = this.flagMarkers.get(id)
    if (!spr) {
      spr = new Sprite(this.flagTex)
      spr.anchor.set(0.5)
      spr.alpha = 0.9
      this.flagLayer.addChild(spr)
      this.flagMarkers.set(id, spr)
    }
    spr.position.set((x / 1000 - y / 1000) * ISO_HALF_W, (x / 1000 + y / 1000) * ISO_HALF_H)
    spr.tint = this.teamColor(world, world.teamOf(id))
    const pos = { x: 0, y: 0 }
    camera.worldToScreen(x, y, pos)
    spr.visible = camera.isInView(pos.x, pos.y)
  }

  /** Ground-space on-screen width (world px) of an entity, independent of whatever
   * texture the sprite happens to show (image or vector shape). Buildings use their
   * footprint tiles; vehicles/infantry use the canonical unit scale. */
  private effectWidthPx(world: World, id: number, kind: 'unit' | 'building'): number {
    if (kind === 'building') {
      const b = world.buildings.get(id)
      if (b) return Math.max(1, (b.footprintW + b.footprintH) * ISO_HALF_W)
    }
    const cls = world.units.get(id)?.class ?? 'vehicle'
    const scaleCls = cls === 'air' ? 'vehicle' : cls
    const mult = getGraphics().unitScale[scaleCls] ?? 1
    return Math.max(1, UNIT_SPRITE_WIDTH * mult)
  }

  /** Animated burning-fire texture: either the 2 loaded `fx:burn` frames or a
   * 2-frame procedural flame fallback. Frame cycles roughly every 2 ticks. */
  private burnTex(tick: number): Texture {
    preloadFxFrames('burn')
    const frame = 1 + ((tick >> 2) & 1)
    const imgTex = fxFrameTexture('burn', frame)
    return imgTex ?? this.burnProcedural[frame - 1] ?? this.burnProcedural[0]
  }

  private syncSprite(id: number, kind: 'unit' | 'building', type: string, world: World, camera: Camera): void {
    let spr = this.entitySprites.get(id)
    if (!spr) {
      spr = new Sprite(textureFor(kind, type, this.app.renderer))
      spr.anchor.set(0.5)
      this.entityLayer.addChild(spr)
      this.entitySprites.set(id, spr)
    }
    const textureColor = this.colorIndex(world, world.teamOf(id))
    // aircraft fly above everything ground-level (fields, buildings, obstacles)
    const isAir = kind === 'unit' && world.units.get(id)?.class === 'air'
    if (kind === 'unit') {
      const targetLayer = isAir ? this.airLayer : this.entityLayer
      if (spr.parent !== targetLayer) {
        spr.parent?.removeChild(spr)
        targetLayer.addChild(spr)
      }
    }
    const t = world.transforms.require(id)
    const isoX = (t.x / 1000 - t.y / 1000) * ISO_HALF_W
    const isoY = (t.x / 1000 + t.y / 1000) * ISO_HALF_H
    spr.position.set(isoX, isoY)
    if (kind === 'unit') {
      let sh = this.airShadows.get(id)
      if (!sh) {
        sh = new Sprite(this.airShadowTex)
        sh.anchor.set(0.5)
        this.airShadows.set(id, sh)
      }
      if (isAir) {
        // high above the ground: drawn on top of everything, pushed well down the
        // screen so the vertical distance reads as altitude
        if (sh.parent !== this.airShadowTopLayer) {
          sh.parent?.removeChild(sh)
          this.airShadowTopLayer.addChild(sh)
        }
        sh.position.set(isoX, isoY + 26)
        sh.scale.set(0.85, 0.42)
        sh.alpha = 0.5
      } else {
        if (sh.parent !== this.shadowLayer) {
          sh.parent?.removeChild(sh)
          this.shadowLayer.addChild(sh)
        }
        const cls = world.units.get(id)?.class
        const big = cls === 'vehicle'
        sh.position.set(isoX, isoY + 3)
        sh.scale.set(big ? 0.6 : 0.42, big ? 0.3 : 0.21)
        sh.alpha = 0.4
      }
    }
    let statusTex: Texture | null = null
    if (kind === 'building') {
      const b = world.buildings.get(id)
      if (b) {
        const h = world.healths.get(id)
        let frame: number
        if (b.sellingUntil >= world.tick) {
          // Being sold: play the status frames in reverse (5→1) over the timer.
          // Use >= so the final rendered frame (at the removal tick) is 0001,
          // not the completed 0005 frame.
          const total = world.settings.sellTicks || 1
          const remain = Math.max(0, b.sellingUntil - world.tick)
          frame = Math.max(1, Math.min(5, Math.ceil((remain / total) * 5)))
        } else {
          frame = buildingStatusIndex(b.done, b.buildProgress, h ? h.hp / h.maxHp : 1)
        }
        statusTex = buildingStatusTexture(type, frame, textureColor)
        if (statusTex && spr.texture !== statusTex) spr.texture = statusTex
        const ratio = this.buildingFillRatio()
        if (ratio > 0) {
          const target = ratio * (b.footprintW + b.footprintH) * ISO_HALF_W
          const base = this.spriteLogicalWidth(spr)
          spr.scale.set(target / base, target / base)
        } else {
          spr.scale.set(1, 1)
        }
        spr.position.y += this.buildingOffsetDist(b.footprintW, b.footprintH)
      }
    }
    if (kind === 'unit' && unitImagesAvailable(type, textureColor)) {
      let dirName: string | null = null
      const face = (fx: number, fy: number): void => {
        const dx = fx - t.x
        const dy = fy - t.y
        if (dx !== 0 || dy !== 0) {
          const sx = (dx / 1000 - dy / 1000) * ISO_HALF_W
          const sy = (dx / 1000 + dy / 1000) * ISO_HALF_H
          dirName = unitDirFromScreenAngle(Math.atan2(sy, sx))
        }
      }
      // 1) attacking: face the target / shot impact point
      const a = world.attacks.get(id)
      let aim: { x: number; y: number } | null = null
      if (a) {
        if (a.target !== null && world.isAlive(a.target)) {
          const tp = world.transforms.get(a.target)
          if (tp) aim = tp
        }
        if (!aim && a.targetPos) aim = a.targetPos
      }
      if (aim) {
        face(aim.x, aim.y)
      } else {
        const plane = world.planes.get(id)
        // 2) idle fighter orbiting its hover point: follow the circle
        if (plane && plane.state === 'idle' && !world.moves.has(id)) {
          const angle = ((world.tick % 6000) * 0.01 + id * 1.7) % (Math.PI * 2)
          face(t.x - Math.sin(angle) * 1000, t.y + Math.cos(angle) * 1000)
        } else {
          // 3) otherwise face the current path waypoint (not the final destination)
          const m = world.moves.get(id)
          if (m) {
            let hx = m.tx
            let hy = m.ty
            if (m.pathIndex < m.path.length) {
              const tile = m.path[m.pathIndex]
              hx = (tile % world.width) * 1000 + 500
              hy = Math.floor(tile / world.width) * 1000 + 500
            }
            face(hx, hy)
          }
        }
      }
      // keep the last facing when idle; fresh spawns face the camera
      if (!dirName) dirName = this.unitFacing.get(id) ?? 'south'
      this.unitFacing.set(id, dirName)
      const dirTex = unitTextureByName(type, dirName, textureColor)
      if (dirTex) {
        if (spr.texture !== dirTex) spr.texture = dirTex
        const cls = world.units.get(id)?.class ?? 'vehicle'
        // aircraft share the vehicle scale slider
        const scaleCls = cls === 'air' ? 'vehicle' : cls
        const mult = getGraphics().unitScale[scaleCls] ?? 1
        spr.scale.set((UNIT_SPRITE_WIDTH / (dirTex.frame.width || 1)) * mult)
      }
    }
    let color = this.teamColor(world, world.teamOf(id))
    let powerDown = false
    if (kind === 'building') {
      const b = world.buildings.get(id)
      if (b && b.done && b.powerUse > 0) {
        const s = world.teamState(b.team)
        if (s.powerDown) {
          color = 0xff5540
          powerDown = true
        }
      }
    }
    // if the sprite currently shows an image texture (unit directions / building states), don't colorize it
    const useImg = spr.texture !== textureFor(kind, type, this.app.renderer)
    spr.tint = useImg ? (powerDown ? color : 0xffffff) : color
    if (kind === 'unit' && useImg) {
      // re-apply the class scale every frame so dev-setting changes apply live
      const cls = world.units.get(id)?.class ?? 'vehicle'
      const scaleCls = cls === 'air' ? 'vehicle' : cls
      const mult = getGraphics().unitScale[scaleCls] ?? 1
      const w = spr.texture.frame.width || 1
      spr.scale.set((UNIT_SPRITE_WIDTH / w) * mult)
    }
    const pos = { x: 0, y: 0 }
    camera.worldToScreen(t.x, t.y, pos)
    spr.visible = this.inView(pos, id, world, camera)

    // hit flash — additive white blaze while `tick - hitTick < 4` (cosmetic only),
    // distinct from the small ring-shaped bullet impact sparks
    const hit = world.flashes.get(id)
    const flashing = effectEnabled('effects') && hit !== undefined && world.tick - hit.hitTick < 4
    let flash = this.flashSprites.get(id)
    if (flashing) {
      if (!flash) {
        flash = new Sprite(this.hitFlashTex)
        flash.anchor.set(0.5)
        flash.blendMode = 'add'
        this.flashSprites.set(id, flash)
      }
      const delta = world.tick - hit.hitTick
      const alpha = 1 - delta / 4
      flash.alpha = alpha
      // sized to a fraction of the entity's ground footprint (see fxScale dev setting)
      const s = (this.effectWidthPx(world, id, kind) * getGraphics().fxScale * (0.95 + 0.4 * alpha)) / 64
      flash.scale.set(s)
      flash.rotation = 0
      flash.position.copyFrom(spr.position)
      flash.visible = spr.visible
      const parent = spr.parent
      if (parent && flash.parent !== parent) parent.addChild(flash)
    } else if (flash) {
      flash.parent?.removeChild(flash)
      this.flashSprites.delete(id)
    }

    // burning-fire overlay for heavily damaged buildings & vehicles (<=25% hp,
    // visual only). Troops/infantry never burn.
    let flame: Sprite | undefined
    const burns = kind === 'building' || (kind === 'unit' && world.units.get(id)?.class === 'vehicle')
    if (burns && effectEnabled('effects')) {
      const hp = world.healths.get(id)
      if (hp && hp.maxHp > 0 && hp.hp > 0 && hp.hp / hp.maxHp <= 0.25) {
        flame = this.flameSprites.get(id)
        if (!flame) {
          flame = new Sprite(this.burnTex(world.tick))
          flame.anchor.set(0.5)
          this.flameSprites.set(id, flame)
        }
        const imageFrame = fxFrameTexture('burn', 1 + ((world.tick >> 2) & 1))
        if (imageFrame) {
          if (flame.texture !== imageFrame) flame.texture = imageFrame
        } else {
          const tex = this.burnTex(world.tick)
          if (flame.texture !== tex) flame.texture = tex
        }
        // sized to a fraction of the entity's ground footprint (see fxScale dev setting)
        const texW = imageFrame ? imageFrame.frame.width || 1 : 32
        flame.scale.set((this.effectWidthPx(world, id, kind) * getGraphics().fxScale) / texW)
        flame.tint = 0xffffff
        flame.rotation = 0
        flame.alpha = 0.85 + Math.sin((world.tick + id) * 0.9) * 0.15
        flame.position.copyFrom(spr.position)
        flame.position.y -= 14
        flame.visible = spr.visible
        const parent = spr.parent
        if (parent && flame.parent !== parent) parent.addChild(flame)
      }
    }
    const existingFlame = this.flameSprites.get(id)
    if (existingFlame !== undefined && existingFlame !== flame) {
      existingFlame.parent?.removeChild(existingFlame)
      this.flameSprites.delete(id)
    }
  }

  private syncTeamMarkers(world: World, camera: Camera): void {
    const seen = new Set<number>()
    world.units.forEach((id, u) => {
      if (!this.isEntityVisible(world, id)) return
      seen.add(id)
      this.syncTeamMarker(id, this.fillTexForUnit(u.class), 0.35, world, camera)
    })
    world.buildings.forEach((id, b) => {
      if (!this.isEntityVisible(world, id)) return
      seen.add(id)
      this.syncTeamMarker(id, this.fillTexForBuilding(b.footprintW, b.footprintH), 0.25, world, camera)
    })
    for (const [id, spr] of this.teamMarkers) {
      if (!seen.has(id)) {
        this.teamLayer.removeChild(spr)
        this.teamMarkers.delete(id)
      }
    }
  }

  private syncTeamMarker(id: number, tex: Texture, alpha: number, world: World, camera: Camera): void {
    let spr = this.teamMarkers.get(id)
    if (!spr) {
      spr = new Sprite(tex)
      spr.anchor.set(0.5)
      this.teamLayer.addChild(spr)
      this.teamMarkers.set(id, spr)
    }
    const t = world.transforms.require(id)
    const team = world.teamOf(id)
    spr.texture = tex
    spr.alpha = alpha
    spr.tint = this.teamColor(world, team)
    spr.position.set((t.x / 1000 - t.y / 1000) * ISO_HALF_W, (t.x / 1000 + t.y / 1000) * ISO_HALF_H)
    const pos = { x: 0, y: 0 }
    camera.worldToScreen(t.x, t.y, pos)
    spr.visible = this.inView(pos, id, world, camera)
  }

  private syncHitboxes(world: World, camera: Camera): void {
    const seen = new Set<number>()
    world.units.forEach((id, u) => {
      if (!this.isEntityVisible(world, id)) return
      seen.add(id)
      this.syncHitbox(id, this.outlineForUnit(u.class), world, camera)
    })
    world.buildings.forEach((id, b) => {
      if (!this.isEntityVisible(world, id)) return
      seen.add(id)
      this.syncHitbox(id, this.outlineForBuilding(b.footprintW, b.footprintH), world, camera)
    })
    for (const [id, spr] of this.hitboxSprites) {
      if (!seen.has(id)) {
        this.hitboxLayer.removeChild(spr)
        this.hitboxSprites.delete(id)
      }
    }
  }

  /** Small green/red ownership dot beside the health bar of every object (high quality only). */
  private syncUnitFlags(world: World, camera: Camera): void {
    if (getGraphics().quality !== 'high') {
      for (const [id, spr] of this.unitFlagSprites) {
        this.teamFlagLayer.removeChild(spr)
        this.unitFlagSprites.delete(id)
      }
      return
    }
    const seen = new Set<number>()
    const place = (id: number, xFx: number, yFx: number, barY: number, team: number): void => {
      seen.add(id)
      let spr = this.unitFlagSprites.get(id)
      if (!spr) {
        spr = new Sprite(this.flagDotTex)
        spr.anchor.set(0.5)
        this.teamFlagLayer.addChild(spr)
        this.unitFlagSprites.set(id, spr)
      }
      const ally = this.localTeam >= 0 && world.sameTeam(this.localTeam, team)
      spr.tint = ally ? 0x3fd45a : 0xe84040
      spr.scale.set(0.7)
      const isoX = (xFx / 1000 - yFx / 1000) * ISO_HALF_W
      spr.position.set(isoX + BAR_W / 2 + 8, barY)
      const pos = { x: 0, y: 0 }
      camera.worldToScreen(xFx, yFx, pos)
      spr.visible = camera.isInView(pos.x, pos.y)
    }
    world.units.forEach((id, u) => {
      if (!this.isEntityVisible(world, id)) return
      const t = world.transforms.get(id)
      if (!t) return
      const team = world.teamOf(id)
      if (team < 0) return
      const isoY = (t.x / 1000 + t.y / 1000) * ISO_HALF_H
      place(id, t.x, t.y, isoY - (u.class === 'vehicle' ? 18 : 14) - 8, team)
    })
    world.buildings.forEach((id, b) => {
      if (!this.isEntityVisible(world, id)) return
      const t = world.transforms.get(id)
      if (!t) return
      const isoY = (t.x / 1000 + t.y / 1000) * ISO_HALF_H
      place(id, t.x, t.y, isoY - ((b.footprintW + b.footprintH) * ISO_HALF_H) / 2 - 8, b.team)
    })
    for (const [id, spr] of this.unitFlagSprites) {
      if (!seen.has(id)) {
        this.teamFlagLayer.removeChild(spr)
        this.unitFlagSprites.delete(id)
      }
    }
  }

  /** Gold veterancy pips to the LEFT of the health bar (pips | hp bar | alliance circle).
   * Ranks 1–4 show that many gold bars, rank 5 shows a single star. */
  private syncVeterancy(world: World, camera: Camera): void {
    const seen = new Set<number>()
    world.units.forEach((id, u) => {
      if (u.veteranRank < 1) return
      if (!this.isEntityVisible(world, id)) return
      const t = world.transforms.get(id)
      if (!t) return
      const team = world.teamOf(id)
      if (team < 0) return
      seen.add(id)
      const isoX = (t.x / 1000 - t.y / 1000) * ISO_HALF_W
      const isoY = (t.x / 1000 + t.y / 1000) * ISO_HALF_H
      const barY = isoY - (u.class === 'vehicle' ? 18 : 14) - 8
      let g = this.veteranPips.get(id)
      if (!g) {
        g = new Graphics()
        this.veteranPipLayer.addChild(g)
        this.veteranPips.set(id, g)
      }
      if (this.veteranPipRank.get(id) !== u.veteranRank) {
        this.veteranPipRank.set(id, u.veteranRank)
        drawVeteranPips(g, u.veteranRank)
      }
      const pos = { x: 0, y: 0 }
      camera.worldToScreen(t.x, t.y, pos)
      const vis = camera.isInView(pos.x, pos.y)
      g.visible = vis
      if (vis) g.position.set(isoX - BAR_W / 2 - 9 - veteranPipWidth(u.veteranRank) / 2, barY)
    })
    for (const [id, g] of this.veteranPips) {
      if (!seen.has(id)) {
        this.veteranPipLayer.removeChild(g)
        this.veteranPips.delete(id)
        this.veteranPipRank.delete(id)
      }
    }
  }

  private syncHitbox(id: number, tex: Texture, world: World, camera: Camera): void {
    let spr = this.hitboxSprites.get(id)
    if (!spr) {
      spr = new Sprite(tex)
      spr.anchor.set(0.5)
      this.hitboxLayer.addChild(spr)
      this.hitboxSprites.set(id, spr)
    }
    const t = world.transforms.require(id)
    spr.texture = tex
    spr.tint = this.teamColor(world, world.teamOf(id))
    spr.position.set((t.x / 1000 - t.y / 1000) * ISO_HALF_W, (t.x / 1000 + t.y / 1000) * ISO_HALF_H)
    const pos = { x: 0, y: 0 }
    camera.worldToScreen(t.x, t.y, pos)
    spr.visible = this.showBorders && this.inView(pos, id, world, camera)
  }

  private outlineForUnit(cls: string): Texture {
    const key = `unit-${cls}`
    const hit = this.outlineTexCache.get(key)
    if (hit) return hit
    const r = cls === 'vehicle' ? { hw: 34, hh: 18 } : { hw: 26, hh: 14 }
    const pad = 3
    const s = (r.hw + pad) * 2
    const c = s / 2
    const g = new Graphics()
    g.circle(c, c, r.hw + pad).stroke({ color: 0x3fbf5f, width: 1.5, alpha: 0.85 })
    const tex = this.app.renderer.generateTexture({ target: g, resolution: 8, antialias: true })
    g.destroy()
    this.outlineTexCache.set(key, tex)
    return tex
  }

  private outlineForBuilding(fw: number, fh: number): Texture {
    const key = `bld-${fw}x${fh}`
    const hit = this.outlineTexCache.get(key)
    if (hit) return hit
    const pad = 3
    const sum = fw + fh
    const g = new Graphics()
    g.poly([
      sum * ISO_HALF_W * 0.5 + pad,
      sum * ISO_HALF_H + pad,
      sum * ISO_HALF_W + pad,
      sum * ISO_HALF_H * 0.5 + pad,
      sum * ISO_HALF_W * 0.5 + pad,
      pad,
      pad,
      sum * ISO_HALF_H * 0.5 + pad,
    ]).stroke({ color: 0x3fbf5f, width: 1.5, alpha: 0.85 })
    const tex = this.app.renderer.generateTexture({ target: g, resolution: 8, antialias: true })
    g.destroy()
    this.outlineTexCache.set(key, tex)
    return tex
  }

  private buildingFillRatio(): number {
    const q = getGraphics().quality
    if (q === 'medium' || q === 'high') return getGraphics().buildingFill[q]
    return 0
  }

  private buildingOffsetDist(fw: number, fh: number): number {
    const q = getGraphics().quality
    if (q !== 'medium' && q !== 'high') return 0
    // r = distance from footprint-diamond center to its bottom vertex
    const r = ((fw + fh) * ISO_HALF_H) / 2
    return getGraphics().buildingOffset[q] * r
  }

  private spriteLogicalWidth(spr: Sprite): number {
    return spr.texture.frame.width || 1
  }

  private fillTexForUnit(cls: string): Texture {
    const key = `funit-${cls}`
    const hit = this.fillTexCache.get(key)
    if (hit) return hit
    const r = cls === 'vehicle' ? { hw: 34, hh: 18 } : { hw: 26, hh: 14 }
    const s = r.hw * 2
    const g = new Graphics()
    g.circle(s / 2, s / 2, r.hw).fill(0xffffff)
    const tex = this.app.renderer.generateTexture({ target: g, resolution: 8, antialias: true })
    g.destroy()
    this.fillTexCache.set(key, tex)
    return tex
  }

  private fillTexForBuilding(fw: number, fh: number): Texture {
    const key = `fbld-${fw}x${fh}`
    const hit = this.fillTexCache.get(key)
    if (hit) return hit
    const sum = fw + fh
    const g = new Graphics()
    g.poly([
      sum * ISO_HALF_W * 0.5,
      sum * ISO_HALF_H,
      sum * ISO_HALF_W,
      sum * ISO_HALF_H * 0.5,
      sum * ISO_HALF_W * 0.5,
      0,
      0,
      sum * ISO_HALF_H * 0.5,
    ]).fill(0xffffff)
    const tex = this.app.renderer.generateTexture({ target: g, resolution: 8, antialias: true })
    g.destroy()
    this.fillTexCache.set(key, tex)
    return tex
  }

  private syncFields(world: World, camera: Camera): void {
    const seen = new Set<number>()
    world.fields.forEach((id, f) => {
      seen.add(id)
      const t = world.transforms.get(id)
      if (!t) return
      let spr = this.fieldSprites.get(id)
      if (!spr) {
        spr = new Sprite(this.fieldTex)
        spr.anchor.set(0.5)
        spr.tint = 0x5ae0d8
        spr.alpha = 0.85
        this.fieldLayer.addChild(spr)
        this.fieldSprites.set(id, spr)
      }
      const scale = f.radius * 2
      const fillFrac = f.capacity > 0 ? Math.max(0, Math.min(1, f.trips / f.capacity)) : 0
      const fillTex = supplyFieldStatusTexture(fillFrac)
      if (fillTex) {
        if (spr.texture !== fillTex) spr.texture = fillTex
        spr.tint = 0xffffff
        spr.alpha = 1
        const baseW = fillTex.frame.width || 1
        spr.scale.set((scale * (this.fieldTex.frame.width || 64)) / baseW)
        spr.visible = true
      } else {
        // vector diamond only for low quality; medium/high rely on images/icons/bars
        spr.tint = 0x5ae0d8
        spr.alpha = 0.85
        spr.scale.set(scale)
        spr.visible = getGraphics().quality === 'low'
      }
      const isoX = (t.x / 1000 - t.y / 1000) * ISO_HALF_W
      let isoY = (t.x / 1000 + t.y / 1000) * ISO_HALF_H
      if (fillTex) {
        const halfH = ((fillTex.frame.height || 1) / (fillTex.frame.width || 1)) * (scale * (this.fieldTex.frame.width || 64)) * 0.5
        isoY += getGraphics().fieldOffset * halfH
      }
      spr.position.set(isoX, isoY)

      let pair = this.fieldBars.get(id)
      if (!pair) {
        const bg = new Sprite(this.barBgTex)
        bg.anchor.set(0.5)
        const fill = new Sprite(Texture.WHITE)
        fill.anchor.set(0, 0.5)
        fill.scale.y = BAR_H
        this.barLayer.addChild(bg)
        this.barLayer.addChild(fill)
        pair = { bg, fill }
        this.fieldBars.set(id, pair)
      }
      const frac = f.capacity > 0 ? Math.max(0, Math.min(1, f.trips / f.capacity)) : 0
      const barY = isoY - f.radius * 32 - 10
      pair.bg.position.set(isoX, barY)
      pair.fill.position.set(isoX - BAR_W / 2, barY)
      pair.fill.scale.x = Math.max(0.001, BAR_W * frac)
      pair.fill.tint = frac > 0.3 ? 0x5ae0d8 : frac > 0 ? 0xe8d24a : 0x888888

      let label = this.fieldLabels.get(id)
      if (!label) {
        label = new Text({
          text: '',
          style: {
            fontFamily: 'ui-monospace, monospace',
            fontSize: 11,
            fill: '#dff6f2',
            stroke: { color: '#000000', width: 3 },
          },
        })
        label.anchor.set(0.5)
        this.barLayer.addChild(label)
        this.fieldLabels.set(id, label)
      }
      label.text = `${f.trips}/${f.capacity}`
      label.position.set(isoX, barY - 11)

      const pos = { x: 0, y: 0 }
      camera.worldToScreen(t.x, t.y, pos)
      const vis = camera.isInView(pos.x, pos.y, 120)
      spr.visible = vis
      pair.bg.visible = vis
      pair.fill.visible = vis
      label.visible = vis
    })
    world.oilFields.forEach((id, f) => {
      seen.add(id)
      const t = world.transforms.get(id)
      if (!t) return
      let spr = this.oilFieldSprites.get(id)
      if (!spr) {
        spr = new Sprite(this.fieldTex)
        spr.anchor.set(0.5)
        spr.alpha = 0.95
        this.fieldLayer.addChild(spr)
        this.oilFieldSprites.set(id, spr)
      }
      const scale = f.radius * 2
      const oh = world.healths.get(id)
      const oilTex = oilFieldStatusTexture(oh && oh.maxHp > 0 ? oh.hp / oh.maxHp : 1)
      if (oilTex) {
        if (spr.texture !== oilTex) spr.texture = oilTex
        spr.tint = 0xffffff
        spr.alpha = 1
        const baseW = oilTex.frame.width || 1
        spr.scale.set((scale * (this.fieldTex.frame.width || 64)) / baseW)
        spr.visible = true
      } else {
        spr.alpha = 0.95
        spr.scale.set(scale)
        spr.tint = f.owner >= 0 ? PLAYER_COLORS[this.colorIndex(world, f.owner)] : 0xc8a04a
        spr.visible = getGraphics().quality === 'low'
      }
      const isoX = (t.x / 1000 - t.y / 1000) * ISO_HALF_W
      let isoY = (t.x / 1000 + t.y / 1000) * ISO_HALF_H
      if (oilTex) {
        const halfH = ((oilTex.frame.height || 1) / (oilTex.frame.width || 1)) * (scale * (this.fieldTex.frame.width || 64)) * 0.5
        isoY += getGraphics().fieldOffset * halfH
      }
      spr.position.set(isoX, isoY)

      let pair = this.oilFieldBars.get(id)
      if (!pair) {
        const bg = new Sprite(this.barBgTex)
        bg.anchor.set(0.5)
        const fill = new Sprite(Texture.WHITE)
        fill.anchor.set(0, 0.5)
        fill.scale.y = BAR_H
        this.barLayer.addChild(bg)
        this.barLayer.addChild(fill)
        pair = { bg, fill }
        this.oilFieldBars.set(id, pair)
      }
      let frac = 0
      let barTint = 0x888888
      let labelText = ''
      if (f.owner >= 0) {
        frac = Math.min(1, f.incomeTicks / world.settings.oilIncomeIntervalTicks)
        barTint = PLAYER_COLORS[this.colorIndex(world, f.owner)]
        labelText = `+${world.settings.oilIncome}`
      } else if (f.claimingScout !== 0) {
        frac = Math.min(1, f.claimTicks / world.settings.oilClaimTicks)
        barTint = 0xe8d24a
        labelText = `${Math.floor((f.claimTicks / world.settings.oilClaimTicks) * 100)}%`
      } else {
        labelText = 'OIL'
      }
      const barY = isoY - f.radius * 32 - 10
      pair.bg.position.set(isoX, barY)
      pair.fill.position.set(isoX - BAR_W / 2, barY)
      pair.fill.scale.x = Math.max(0.001, BAR_W * frac)
      pair.fill.tint = barTint

      let label = this.oilFieldLabels.get(id)
      if (!label) {
        label = new Text({
          text: '',
          style: {
            fontFamily: 'ui-monospace, monospace',
            fontSize: 11,
            fill: '#f5ecd6',
            stroke: { color: '#000000', width: 3 },
          },
        })
        label.anchor.set(0.5)
        this.barLayer.addChild(label)
        this.oilFieldLabels.set(id, label)
      }
      label.text = labelText
      label.position.set(isoX, barY - 11)

      const pos = { x: 0, y: 0 }
      camera.worldToScreen(t.x, t.y, pos)
      const vis = camera.isInView(pos.x, pos.y, 120)
      spr.visible = vis
      pair.bg.visible = vis
      pair.fill.visible = vis
      label.visible = vis
    })
    for (const [id, spr] of this.fieldSprites) {
      if (!seen.has(id)) {
        this.fieldLayer.removeChild(spr)
        this.fieldSprites.delete(id)
      }
    }
    for (const [id, pair] of this.fieldBars) {
      if (!seen.has(id)) {
        this.barLayer.removeChild(pair.bg)
        this.barLayer.removeChild(pair.fill)
        this.fieldBars.delete(id)
      }
    }
    for (const [id, label] of this.fieldLabels) {
      if (!seen.has(id)) {
        this.barLayer.removeChild(label)
        this.fieldLabels.delete(id)
      }
    }
    for (const [id, spr] of this.oilFieldSprites) {
      if (!seen.has(id)) {
        this.fieldLayer.removeChild(spr)
        this.oilFieldSprites.delete(id)
      }
    }
    for (const [id, pair] of this.oilFieldBars) {
      if (!seen.has(id)) {
        this.barLayer.removeChild(pair.bg)
        this.barLayer.removeChild(pair.fill)
        this.oilFieldBars.delete(id)
      }
    }
    for (const [id, label] of this.oilFieldLabels) {
      if (!seen.has(id)) {
        this.barLayer.removeChild(label)
        this.oilFieldLabels.delete(id)
      }
    }
  }

  private syncScenery(world: World, camera: Camera): void {
    const seen = new Set<number>()
    world.scenery.forEach((id, s) => {
      seen.add(id)
      const t = world.transforms.get(id)
      if (!t) return
      const h = world.healths.get(id)
      let spr = this.scenerySprites.get(id)
      if (!spr) {
        spr = new Sprite(obstacleTexture(s.type, this.app.renderer))
        spr.anchor.set(0.5)
        this.obstacleLayer.addChild(spr)
        this.scenerySprites.set(id, spr)
      }
      const scale = Math.max(s.w, s.h)
      const aoTex = obstacleImageTexture(s.type)
      if (aoTex) {
        if (spr.texture !== aoTex) spr.texture = aoTex
        spr.tint = 0xffffff
        spr.alpha = 1
        const baseW = aoTex.frame.width || 1
        spr.scale.set((scale * OBSTACLE_BASE_WIDTH) / baseW)
      } else {
        spr.scale.set(scale)
        spr.tint = OBSTRUCTION_COLORS[s.type] ?? 0xffffff
        spr.alpha = 0.95
      }
      const isoX = (t.x / 1000 - t.y / 1000) * ISO_HALF_W
      const isoY = (t.x / 1000 + t.y / 1000) * ISO_HALF_H
      spr.position.set(isoX, isoY)

      let vis = true
      const pos = { x: 0, y: 0 }
      camera.worldToScreen(t.x, t.y, pos)
      vis = camera.isInView(pos.x, pos.y, 120)
      spr.visible = vis

      if (s.type === 'rock' && h) {
        let pair = this.sceneryBars.get(id)
        if (!pair) {
          const bg = new Sprite(this.barBgTex)
          bg.anchor.set(0.5)
          const fill = new Sprite(Texture.WHITE)
          fill.anchor.set(0, 0.5)
          fill.scale.y = BAR_H
          this.barLayer.addChild(bg)
          this.barLayer.addChild(fill)
          pair = { bg, fill }
          this.sceneryBars.set(id, pair)
        }
        const frac = h.maxHp > 0 ? Math.max(0, Math.min(1, h.hp / h.maxHp)) : 0
        const barY = isoY - Math.max(s.w, s.h) * 32 - 10
        pair.bg.position.set(isoX, barY)
        pair.fill.position.set(isoX - BAR_W / 2, barY)
        pair.fill.scale.x = Math.max(0.001, BAR_W * frac)
        pair.fill.tint = frac > 0.3 ? 0xffb35c : frac > 0 ? 0xe8d24a : 0x888888
        pair.bg.visible = vis && frac < 1
        pair.fill.visible = vis && frac < 1
      } else {
        const pair = this.sceneryBars.get(id)
        if (pair) {
          this.barLayer.removeChild(pair.bg)
          this.barLayer.removeChild(pair.fill)
          this.sceneryBars.delete(id)
        }
      }
    })
    for (const [id, spr] of this.scenerySprites) {
      if (!seen.has(id)) {
        this.obstacleLayer.removeChild(spr)
        this.scenerySprites.delete(id)
      }
    }
    for (const [id, pair] of this.sceneryBars) {
      if (!seen.has(id)) {
        this.barLayer.removeChild(pair.bg)
        this.barLayer.removeChild(pair.fill)
        this.sceneryBars.delete(id)
      }
    }
  }

  private stepTreeFalls(): void {
    for (const f of this.treeFalls) {
      const t = f.age / 40
      if (t >= 1) {
        this.fxLayer.removeChild(f.spr)
        f.spr.destroy()
        continue
      }
      f.spr.rotation = (-Math.PI / 2) * t
      f.spr.alpha = 1 - t
      f.spr.y = f.isoY - t * 22
      f.age++
    }
    this.treeFalls = this.treeFalls.filter((f) => f.age < 40)
  }

  addTreeFall(x: number, y: number, w: number, h: number): void {
    const spr = new Sprite(obstacleTexture('tree', this.app.renderer))
    spr.anchor.set(0.5)
    spr.tint = OBSTRUCTION_COLORS.tree ?? 0xffffff
    const aoTex = obstacleImageTexture('tree')
    if (aoTex) {
      spr.texture = aoTex
      spr.tint = 0xffffff
      spr.alpha = 1
      spr.scale.set((Math.max(w, h) * OBSTACLE_BASE_WIDTH) / (aoTex.frame.width || 1))
    } else {
      spr.scale.set(Math.max(w, h))
    }
    this.fxLayer.addChild(spr)
    const isoX = (x / 1000 - y / 1000) * ISO_HALF_W
    const isoY = (x / 1000 + y / 1000) * ISO_HALF_H
    spr.position.set(isoX, isoY)
    this.treeFalls.push({ spr, isoX, isoY, age: 0 })
  }

  /** Play a shrink + smoke-puff animation at a sold entity's position. */
  addSellFx(x: number, y: number, scale: number): void {
    const spr = new Sprite(obstacleTexture('wreck', this.app.renderer))
    spr.anchor.set(0.5)
    spr.tint = 0x9aa7b8
    spr.scale.set(Math.max(0.6, scale) * 1.1)
    const isoX = (x / 1000 - y / 1000) * ISO_HALF_W
    const isoY = (x / 1000 + y / 1000) * ISO_HALF_H
    spr.position.set(isoX, isoY)
    spr.alpha = 0.9
    this.fxLayer.addChild(spr)
    this.sellFx.push({ spr, isoX, isoY, scale, age: 0 })
  }

  /** Advance + clear the purely-visual unit sell animation. */
  private stepFades(): void {
    for (const f of this.sellFx) {
      const t = f.age / 20
      if (t >= 1) {
        this.fxLayer.removeChild(f.spr)
        f.spr.destroy()
        continue
      }
      f.spr.scale.set(f.scale * (1 - t) * 1.1)
      f.spr.alpha = 0.9 * (1 - t)
      f.age++
    }
    this.sellFx = this.sellFx.filter((f) => f.age < 20)
  }

  private syncPowerIcons(world: World, camera: Camera): void {
    const seen = new Set<number>()
    world.buildings.forEach((id, b) => {
      if (!this.isEntityVisible(world, id)) return
      if (!b.done || b.powerUse <= 0) return
      const s = world.teamState(b.team)
      if (!s.powerDown) return
      seen.add(id)
      const t = world.transforms.get(id)
      if (!t) return
      let spr = this.powerIcons.get(id)
      if (!spr) {
        spr = new Sprite(this.lightningTex)
        spr.anchor.set(0.5)
        this.powerLayer.addChild(spr)
        this.powerIcons.set(id, spr)
      }
      const top = (b.footprintW + b.footprintH) * ISO_HALF_H * 0.5
      const isoX = (t.x / 1000 - t.y / 1000) * ISO_HALF_W
      const isoY = (t.x / 1000 + t.y / 1000) * ISO_HALF_H
      spr.position.set(isoX, isoY - top - 14)
      spr.tint = 0xff3b30
      const pos = { x: 0, y: 0 }
      camera.worldToScreen(t.x, t.y, pos)
      spr.visible = camera.isInView(pos.x, pos.y, 200)
    })
    for (const [id, spr] of this.powerIcons) {
      if (!seen.has(id)) {
        this.powerLayer.removeChild(spr)
        this.powerIcons.delete(id)
      }
    }
  }

  private buildStaticScenery(map: MapData): void {
    for (const o of map.obstructions) {
      if (o.type === 'rock' || o.type === 'tree') continue
      const cx = (o.x + o.w / 2) * 1000
      const cy = (o.y + o.h / 2) * 1000
      const spr = new Sprite(obstacleTexture(o.type, this.app.renderer))
      spr.anchor.set(0.5)
      const scale = Math.max(o.w, o.h)
      const aoTex = obstacleImageTexture(o.type)
      if (aoTex) {
        spr.texture = aoTex
        spr.tint = 0xffffff
        spr.alpha = 1
        spr.scale.set((scale * OBSTACLE_BASE_WIDTH) / (aoTex.frame.width || 1))
      } else {
        spr.scale.set(scale)
        spr.tint = OBSTRUCTION_COLORS[o.type] ?? 0xffffff
        spr.alpha = 0.95
      }
      spr.position.set((cx / 1000 - cy / 1000) * ISO_HALF_W, (cx / 1000 + cy / 1000) * ISO_HALF_H)
      spr.alpha = 0.95
      this.obstacleLayer.addChild(spr)
    }
  }

  private buildStaticDebug(map: MapData): void {
    for (const s of map.spawnPoints) {
      const cx = s.x * 1000 + 500
      const cy = s.y * 1000 + 500
      const spr = new Sprite(this.outlineForBuilding(2, 2))
      spr.anchor.set(0.5)
      spr.position.set((cx / 1000 - cy / 1000) * ISO_HALF_W, (cx / 1000 + cy / 1000) * ISO_HALF_H)
      spr.tint = PLAYER_COLORS[s.team % PLAYER_COLORS.length]
      spr.alpha = 0.9
      this.debugLayer.addChild(spr)
    }
  }

  destroy(): void {
    window.removeEventListener('resize', this.onWindowResize)
    window.removeEventListener('orientationchange', this.onWindowResize)
    this.vv?.removeEventListener('resize', this.onWindowResize)
    for (const spr of this.powerIcons.values()) {
      this.powerLayer.removeChild(spr)
      spr.destroy()
    }
    this.powerIcons.clear()
    for (const spr of this.scenerySprites.values()) {
      this.obstacleLayer.removeChild(spr)
      spr.destroy()
    }
    this.scenerySprites.clear()
    for (const pair of this.sceneryBars.values()) {
      this.barLayer.removeChild(pair.bg)
      this.barLayer.removeChild(pair.fill)
    }
    this.sceneryBars.clear()
    for (const f of this.treeFalls) {
      this.fxLayer.removeChild(f.spr)
      f.spr.destroy()
    }
    this.treeFalls = []
    for (const spr of this.wreckEntitySprites.values()) {
      this.fxLayer.removeChild(spr)
      spr.destroy()
    }
    this.wreckEntitySprites.clear()
    for (const f of this.sellFx) {
      this.fxLayer.removeChild(f.spr)
      f.spr.destroy()
    }
    this.sellFx = []
    clearShapeCache()
    this.app.destroy(true, { children: true, texture: true })
  }
}
