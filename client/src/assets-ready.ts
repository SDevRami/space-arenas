/** Match-asset preload readiness.
 *
 * `preloadAllMatchAssets()` runs once at boot (see `client/src/main.ts` boot
 * sequence) and populates the renderer's in-memory texture caches. Resolve this
 * promise only when preload reports `done === total` — i.e. true completion,
 * not a budget timeout — so the host never starts a match while a client's
 * sprites are still decoding and a client never reports C_LOADED early.
 *
 * Importing this module does not start any load; call `markMatchAssetsReady()`
 * from the boot sequence once `preloadAllMatchAssets` has fully resolved.
 */

let resolveReady: (() => void) | null = null

/** Resolves once the boot-time match asset preload has fully completed. */
export const matchAssetsReady = new Promise<void>((resolve) => {
  resolveReady = resolve
})

/** Call when the boot-time preload has finished (`done === total`). Idempotent. */
export const markMatchAssetsReady = (): void => {
  if (resolveReady) {
    resolveReady()
    resolveReady = null
  }
}
