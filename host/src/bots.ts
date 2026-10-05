import type { EnvelopeCommand } from '@space-arenas/shared'
import type { Room } from './rooms.ts'
import { BotPlayer } from '../../client/src/ai/bot.ts'
import { Simulator } from '../../client/src/core/Simulator.ts'

/**
 * Runs the server-side bots for a network match.
 *
 * The host is authoritative for commands: it keeps a private deterministic
 * simulator in lockstep with the clients' sims (stepping it each relay frame
 * with the exact command set that was broadcast) and uses the same bot AI as
 * offline play to produce commands for each bot slot. Those commands are
 * injected into the relay with the bot's player id, so clients never have to
 * do anything special — bot commands arrive in the normal frame stream.
 */
export class NetBotRunner {
  private readonly sim: Simulator
  private readonly bots: BotPlayer[]

  constructor(room: Room) {
    const players = this.players(room)
    this.sim = new Simulator(room.map, room.seed, players, room.settings)
    this.sim.world.winRule = room.winRule ?? 'standard'
    this.bots = room.bots.map((b) => new BotPlayer(this.sim, b.id, b.difficulty ?? 'medium'))
  }

  private players(room: Room): number[] {
    return [...room.players.values(), ...room.bots]
      .filter((p) => !p.spectator)
      .map((p) => p.id)
  }

  /** Returns the commands the bots decided for the current tick. */
  commandsForTick(): EnvelopeCommand[] {
    const cmds: EnvelopeCommand[] = []
    for (const bot of this.bots) cmds.push(...bot.tick())
    return cmds
  }

  /** Advances the private sim with the exact commands broadcast this tick. */
  step(commands: EnvelopeCommand[]): void {
    this.sim.step(commands)
  }
}
