import type { PingType, SwChoice } from '@space-arenas/shared'

export type SimEvent =
  | { type: 'entity-created'; entity: number; kind: 'unit' | 'building' | 'field' | 'marker' | 'scenery' | 'wreck' | 'mine'; team: number }
  | { type: 'entity-destroyed'; entity: number; kind: 'unit' | 'building' | 'field' | 'marker' | 'scenery' | 'wreck' | 'mine'; team: number; typeName?: string; x?: number; y?: number }
  | { type: 'unit-trained'; entity: number; unitType: string; team: number }
  | { type: 'building-placed'; entity: number; buildingType: string; team: number }
  | { type: 'building-completed'; entity: number; buildingType: string; team: number }
  | { type: 'upgrade-completed'; building: number; upgrade: string; team: number }
  | { type: 'combat-hit'; attacker: number; target: number; damage: number; team: number }
  | { type: 'shield-hit'; attacker: number; target: number; damage: number; team: number }
  | { type: 'unit-ranked-up'; unit: number; rank: 1 | 2 | 3 | 4 | 5 }
  | { type: 'base-under-attack'; building: number; team: number; x: number; y: number }
  | { type: 'shot-fired'; attacker: number; x: number; y: number; team: number }
  | { type: 'shot-missed'; attacker: number; x: number; y: number; team: number }
  | { type: 'grenade-exploded'; team: number; x: number; y: number }
  | { type: 'mine-placed'; entity: number; team: number; x: number; y: number }
  | { type: 'mine-removed'; entity: number; team: number }
  | { type: 'mine-exploded'; entity: number; team: number; x: number; y: number }
  | { type: 'detector-bought'; building: number; team: number }
  | { type: 'stealth-bought'; team: number }
  | { type: 'supply-harvested'; team: number; amount: number }
  | { type: 'oil-claiming'; field: number; entity: number; team: number }
  | { type: 'oil-claimed'; field: number; entity: number; team: number }
  | { type: 'oil-income'; field: number; team: number; amount: number }
  | { type: 'scenery-destroyed'; entity: number; kind: 'rock' | 'tree'; x: number; y: number; w: number; h: number }
  | { type: 'order-queued'; building: number; unitType: string; team: number }
  | { type: 'order-dequeued'; building: number; unitType: string; team: number }
  | { type: 'order-reordered'; building: number; from: number; to: number; team: number }
  | { type: 'research-started'; building: number; upgrade: string; team: number }
  | { type: 'research-queued'; building: number; upgrade: string; team: number }
  | { type: 'research-cancelled'; building: number; upgrade: string; team: number }
  | { type: 'building-sold'; entity: number; buildingType: string; team: number; refund: number; x: number; y: number }
  | { type: 'unit-sold'; entity: number; unitType: string; team: number; refund: number; x: number; y: number }
  | { type: 'wreck-collected'; entity: number; team: number; value: number }
  | { type: 'dozer-assigned'; entity: number; building: number; kind: 'construct' | 'repair'; team: number }
  | { type: 'build-order-queued'; entity: number; building: number; team: number }
  | { type: 'repair-target-assigned'; entity: number; target: number; team: number }
  | { type: 'unit-loaded'; entity: number; transport: number; unitType: string; team: number }
  | { type: 'unit-unloaded'; entity: number; transport: number; unitType: string; team: number }
  | { type: 'unload-ordered'; entity: number; x: number; y: number; team: number }
  | { type: 'work-cancelled'; entity: number; building: number; team: number }
  | { type: 'spawn-point-set'; building: number; team: number }
  | { type: 'flag-point-set'; building: number; team: number }
  | { type: 'harvester-dock-assigned'; entity: number; building: number; team: number }
  | { type: 'satellite-used'; team: number }
  | { type: 'laser-strike'; team: number; x: number; y: number }
  | { type: 'sw-chosen'; team: number; choice: SwChoice }
  | { type: 'airstrike-called'; team: number; x: number; y: number }
  | { type: 'airstrike-bomb'; team: number; x: number; y: number }
  | { type: 'rank-up'; team: number; rank: number; score: number }
  | { type: 'emp-strike'; team: number; x: number; y: number; radius: number }
  | { type: 'ping-point'; team: number; x: number; y: number; pingType: PingType }
  | { type: 'player-left'; team: number; amount: number }
  | { type: 'game-over'; winner: number | null; eliminated: number[] }
  | { type: 'power-down'; team: number }
  | { type: 'power-restored'; team: number }
  | { type: 'power-boost'; entity: number; team: number }
  | { type: 'power-boost-ended'; entity: number; team: number }
  | { type: 'command-rejected'; player: number; reason: string }

export type EventListener = (event: SimEvent) => void
