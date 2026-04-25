const CACHE_NAME = 'whatsapp-personal-crm-v1'

// Install: skip waiting to activate immediately
self.addEventListener('install', event => {
  self.skipWaiting()
})

// Activate: claim clients + clear old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

// Fetch: stale-while-revalidate for app assets, network-only for AI APIs
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)

  // Never intercept AI API calls
  if (url.hostname === 'api.anthropic.com') return

  // Never intercept non-GET requests
  if (event.request.method !== 'GET') return

  // For everything else: cache-first with network fallback
  event.respondWith(
    caches.open(CACHE_NAME).then(async cache => {
      const cached = await cache.match(event.request)
      const networkPromise = fetch(event.request).then(response => {
        if (response.ok) {
          cache.put(event.request, response.clone())
        }
        return response
      }).catch(() => null)

      return cached || networkPromise
    })
  )
})
