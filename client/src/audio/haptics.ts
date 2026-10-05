import { hapticsEnabled } from './settings.ts'

const vibrate = (ms: number | number[]): void => {
  if (!hapticsEnabled()) return
  try {
    navigator.vibrate(ms)
  } catch {
    /* unsupported */
  }
}

/** Short tap when selecting or clicking. */
export const hapticSelect = (): void => vibrate(15)

/** Slightly stronger pulse on an issued action (attack/move/build). */
export const hapticAction = (): void => vibrate(30)

/** Two quick pulses when the player's units take damage. */
export const hapticDamaged = (): void => vibrate([25, 30, 25])
