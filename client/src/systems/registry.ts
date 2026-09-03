import type { EnvelopeCommand } from '@space-arenas/shared'
import type { World } from '../core/world.ts'
import { InputSystem } from './input-system.ts'
import { PlacingSystem } from './placing-system.ts'
import { ProductionSystem } from './production-system.ts'
import { EconomySystem } from './economy-system.ts'
import { OilSystem } from './oil-system.ts'
import { MovementSystem } from './movement-system.ts'
import { ScenerySystem } from './scenery-system.ts'
import { PathfindingSystem } from './pathfinding-system.ts'
import { WorkSystem } from './work-system.ts'
import { CombatSystem } from './combat-system.ts'
import { SellSystem } from './sell-system.ts'
import { PlaneSystem } from './plane-system.ts'
import { LaserSystem } from './laser-system.ts'
import { VisionSystem } from './vision-system.ts'
import { WinLossSystem } from './winloss-system.ts'
import { SyncSystem } from './sync-system.ts'

export interface SystemDef {
  name: string
  update: (world: World, commands: EnvelopeCommand[]) => void
}

export const SYSTEMS: SystemDef[] = [
  InputSystem,
  PlacingSystem,
  ProductionSystem,
  EconomySystem,
  OilSystem,
  MovementSystem,
  ScenerySystem,
  PathfindingSystem,
  WorkSystem,
  CombatSystem,
  SellSystem,
  PlaneSystem,
  LaserSystem,
  VisionSystem,
  WinLossSystem,
  SyncSystem,
]

export const stepWorld = (world: World, commands: EnvelopeCommand[]): void => {
  world.rebuildGridIfDirty()
  const valid = commands.filter((c) => c.tick === world.tick)
  for (const s of SYSTEMS) {
    s.update(world, valid)
  }
  world.tick++
}
