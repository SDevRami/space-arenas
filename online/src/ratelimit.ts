// In-memory sliding-window rate limiter (zero dependencies). A single Render instance
// means one shared bucket map; the limits are a deterrence layer, not a security boundary.

import type { IncomingMessage } from 'node:http'

const WINDOW_MS = 60_000

// bucket key → hit timestamps within the current window (insertion order ≈ time order).
const buckets = new Map<string, number[]>()

export interface RateLimitResult {
  ok: boolean
  retryAfterSeconds: number
}

const prune = (key: string, now: number): void => {
  const list = buckets.get(key)
  if (!list) return
  while (list.length > 0 && now - list[0] >= WINDOW_MS) list.shift()
  if (list.length === 0) buckets.delete(key)
}

/** Records a hit for `key`; returns false (with seconds until the window opens) when over.
 *  `now` is injectable so the window math is unit-testable without sleeping. */
export const rateLimit = (key: string, limit: number, now = Date.now()): RateLimitResult => {
  prune(key, now)
  const list = buckets.get(key) ?? []
  if (list.length >= limit) {
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((WINDOW_MS - (now - list[0])) / 1000)) }
  }
  list.push(now)
  buckets.set(key, list)
  return { ok: true, retryAfterSeconds: 0 }
}

/** Drops expired buckets so the map cannot grow forever (call from the room sweep). */
export const sweepRateLimits = (now = Date.now()): void => {
  const cutoff = now - WINDOW_MS
  for (const [key, list] of buckets) {
    while (list.length > 0 && list[0] <= cutoff) list.shift()
    if (list.length === 0) buckets.delete(key)
  }
}

/** Best effort client IP: Render sets X-Forwarded-For; dev falls back to the socket address. */
export const clientIp = (req: IncomingMessage): string => {
  const xff = req.headers['x-forwarded-for']
  if (typeof xff === 'string' && xff.trim() !== '') return xff.split(',')[0].trim()
  return req.socket.remoteAddress ?? 'unknown'
}