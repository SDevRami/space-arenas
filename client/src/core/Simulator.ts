import type { EnvelopeCommand, MapData, MatchSettings, SimCommand } from '@space-arenas/shared'
import { World } from './world.ts'
import { stepWorld } from '../systems/registry.ts'
import type { SimEvent } from './events.ts'

export class Simulator {
  readonly world: World
  private readonly seqs = new Map<number, number>()

  constructor(map: MapData, seed: number, players: number[], settings?: Partial<MatchSettings>) {
    this.world = new World(map, seed, players, settings)
  }

  makeCommand(player: number, cmd: SimCommand): EnvelopeCommand {
    const seq = (this.seqs.get(player) ?? 0) + 1
    this.seqs.set(player, seq)
    return { player, seq, tick: this.world.tick, cmd }
  }

  step(commands: EnvelopeCommand[] = []): void {
    stepWorld(this.world, commands)
  }

  advance(ticks: number, commandsPerTick: (tick: number) => EnvelopeCommand[] = () => []): void {
    for (let i = 0; i < ticks; i++) {
      this.step(commandsPerTick(this.world.tick))
    }
  }

  drainEvents(): SimEvent[] {
    return this.world.drainEvents()
  }

  get tick(): number {
    return this.world.tick
  }
}
