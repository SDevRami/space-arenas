const CACHE_VERSION = 'space-arenas-v1'
const APP_CACHE = `app-${CACHE_VERSION}`
const RUNTIME_CACHE = `runtime-${CACHE_VERSION}`

// Precache a minimal core set: the app shell will be cached on first load;
// additionally precache any files that exist at install time (served from SW cache)
const PRECACHE_URLS = [
  './index.html',
  './',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_CACHE).then((cache) => {
      return cache.addAll(PRECACHE_URLS).catch(() => {
        // Ignore failures (some URLs may not be present in this build)
      })
    }).then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  const expectedCaches = [APP_CACHE, RUNTIME_CACHE]
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(keys.filter((k) => !expectedCaches.includes(k)).map((k) => caches.delete(k)))
    }).then(() => self.clients.claim()),
  )
})

// Serve content-hashed assets from cache if present, otherwise from network
// (stale-while-revalidate not necessary; hashed files are immutable)
self.addEventListener('fetch', (event) => {
  const req = event.request
  // Skip non-GET
  if (req.method !== 'GET') return
  // Only handle same-origin requests
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  // For /assets/ (hashed) cache-first
  if (url.pathname.includes('/assets/')) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached
        return fetch(req).then((resp) => {
          const copy = resp.clone()
          caches.open(APP_CACHE).then((c) => c.put(req, copy)).catch(() => {})
          return resp
        }).catch(() => cached)
      }),
    )
    return
  }
  // Runtime (sprites/sounds) cache-first for repeat loads
  if (url.pathname.startsWith('/cc/') || url.pathname.startsWith('/sf/') || url.pathname.startsWith('/of/') || url.pathname.startsWith('/ao/') || url.pathname.endsWith('.wav')) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached
        return fetch(req).then((resp) => {
          if (resp.ok) {
            const copy = resp.clone()
            caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy)).catch(() => {})
          }
          return resp
        })
      }),
    )
    return
  }
  // HTML: prefer network, fallback to cache
  if (req.destination === 'document') {
    event.respondWith(
      fetch(req).then((resp) => {
        if (resp.ok) {
          const copy = resp.clone()
          caches.open(APP_CACHE).then((c) => c.put(req, copy)).catch(() => {})
        }
        return resp
      }).catch(() => caches.match(req)),
    )
    return
  }
  // JS/CSS: network first, fallback to cache
  if (req.destination === 'script' || req.destination === 'style') {
    event.respondWith(
      fetch(req).then((resp) => {
        if (resp.ok) {
          const copy = resp.clone()
          caches.open(APP_CACHE).then((c) => c.put(req, copy)).catch(() => {})
        }
        return resp
      }).catch(() => caches.match(req)),
    )
    return
  }
  // Default: network first
  event.respondWith(
    fetch(req).then((resp) => resp).catch(() => caches.match(req)),
  )
})