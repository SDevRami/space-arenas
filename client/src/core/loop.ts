import { SIM_TICK_MS } from '@space-arenas/shared'

export interface LoopCallbacks {
  tick: () => void
  frame: () => void
  onError?: (err: unknown) => void
}

export class GameLoop {
  private raf = 0
  private lastTime = 0
  private acc = 0
  private running = false
  private errorLogged = false
  private timeScale = 1

  constructor(private readonly cbs: LoopCallbacks) {}

  /** Playback speed multiplier: 1 = real time, 4 = four sim seconds per real second. */
  setSpeed(s: number): void {
    this.timeScale = s > 0 ? s : 1
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.lastTime = performance.now()
    this.acc = 0
    this.raf = requestAnimationFrame(this.frame)
  }

  stop(): void {
    this.running = false
    cancelAnimationFrame(this.raf)
  }

  private readonly frame = (now: number): void => {
    if (!this.running) return
    const dt = Math.min(now - this.lastTime, 250)
    this.lastTime = now
    this.acc += dt * this.timeScale
    const maxSteps = 4
    let steps = 0
    while (this.acc >= SIM_TICK_MS && steps < maxSteps) {
      try {
        this.cbs.tick()
      } catch (err) {
        this.report(err)
        this.acc = 0
        break
      }
      this.acc -= SIM_TICK_MS
      steps++
    }
    if (steps === maxSteps) this.acc = 0
    try {
      this.cbs.frame()
    } catch (err) {
      this.report(err)
    }
    this.raf = requestAnimationFrame(this.frame)
  }

  private report(err: unknown): void {
    if (this.errorLogged) return
    this.errorLogged = true
    console.error('[game-loop error]', err)
    this.cbs.onError?.(err)
  }
}
