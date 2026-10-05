/** Local folder backup: mirrors the browser's localStorage to the LAN host as a
 *  single JSON file (`profile/backup.json`) in the game folder. localStorage is
 *  scoped to origin (scheme://host:port), so if the game ever moves to another
 *  port the browser presents empty storage and the player would lose everything.
 *  The snapshot lives in the filesystem instead — it survives port/URL changes.
 *  The client saves on load, before closing, and on an idle heartbeat, but only
 *  when the storage actually changed (cheap fingerprint), so an idle game never
 *  re-serializes megabytes of data for nothing. A restore only fills keys that
 *  are currently missing (existing local data always wins).
 */

const PROFILE_API_URL = `${import.meta.env.BASE_URL}api/profile`

const IDENTITY_KEYS = new Set(['space-arenas:clientId'])

/** Every localStorage entry this origin has, as a JSON-safe string map. */
export const dumpLocalStorage = (): Record<string, string> => {
  const entries: Record<string, string> = {}
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k === null || IDENTITY_KEYS.has(k)) continue
    try {
      const v = localStorage.getItem(k)
      if (v !== null) entries[k] = v
    } catch {
      /* unreadable key — skip */
    }
  }
  return entries
}

/** Cheap check that changes whenever any stored value changes, without building
 *  the big serialized payload (no big strings allocated). */
const storageFingerprint = (): string => {
  const keys: string[] = []
  let length = 0
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k === null) continue
      keys.push(k)
      const v = localStorage.getItem(k)
      if (v !== null) length += k.length + v.length
    }
  } catch {
    /* storage unavailable */
  }
  keys.sort()
  return `${keys.length}:${length}:${keys.join(',')}`
}

let lastSavedFingerprint = ''

/** POSTs the current localStorage to the host, stored as `profile/backup.json`.
 *  Skips the upload when nothing changed since the last successful save.
 *  `keepalive` lets the request outlive page unload (memory/body limits apply,
 *  so an oversized dump silently falls back to the next normal save). */
export const saveLocalProfile = async (keepalive = false): Promise<boolean> => {
  const fingerprint = storageFingerprint()
  if (fingerprint === lastSavedFingerprint) return true
  try {
    const res = await fetch(PROFILE_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive,
      body: JSON.stringify({
        v: 1,
        origin: location.origin,
        savedAt: new Date().toISOString(),
        keys: dumpLocalStorage(),
      }),
    })
    if (res.ok) lastSavedFingerprint = fingerprint
    return res.ok
  } catch {
    return false
  }
}

interface LocalProfile {
  keys: Record<string, string>
  savedAt: string
  origin: string
}

/** Newest snapshot the host has on disk, or null when none exists. */
export const fetchLatestLocalProfile = async (): Promise<LocalProfile | null> => {
  try {
    const res = await fetch(`${PROFILE_API_URL}/latest`)
    if (!res.ok) return null
    const j = (await res.json()) as {
      ok?: boolean
      profile?: { keys?: Record<string, string>; savedAt?: string; origin?: string }
    }
    const p = j.profile
    if (!p || !p.keys || typeof p.keys !== 'object') return null
    return { keys: p.keys, savedAt: p.savedAt ?? '', origin: p.origin ?? '' }
  } catch {
    return null
  }
}

/** Safe restore: writes only keys that are currently absent, so a fresh origin
 *  (new port/URL) gets its data back while this origin's own newer values are
 *  never overwritten. Returns how many keys were restored. */
export const restoreLocalProfile = async (): Promise<number> => {
  const profile = await fetchLatestLocalProfile()
  if (!profile) return 0
  let restored = 0
  for (const [k, vRaw] of Object.entries(profile.keys)) {
    if (typeof vRaw !== 'string') continue
    if (IDENTITY_KEYS.has(k)) continue // never share device identity
    let present = true
    try {
      present = localStorage.getItem(k) !== null
    } catch {
      continue
    }
    if (present) continue
    try {
      localStorage.setItem(k, vRaw)
      restored++
    } catch {
      /* this origin's storage is full — skip that key */
    }
  }
  return restored
}