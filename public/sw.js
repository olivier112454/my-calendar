/**
 * Service worker: offline shell and installability.
 *
 * Deliberately conservative about what it keeps:
 *
 *  - Build output under /_next/static is content-hashed and therefore immutable,
 *    so it is cached forever and served cache-first.
 *  - Navigations are network-first with a cached fallback, so a flaky connection
 *    shows the app rather than the browser's dinosaur.
 *  - API responses are NEVER cached. They are personal data with a short shelf
 *    life, and a stale calendar is worse than no calendar.
 *
 * Bump CACHE_VERSION whenever the shell changes; the activate handler removes
 * every older cache, so a stale worker cannot serve last week's assets.
 */

const CACHE_VERSION = 'dayflow-v1'
const STATIC_CACHE = `${CACHE_VERSION}-static`
const SHELL_CACHE = `${CACHE_VERSION}-shell`

/** The minimum needed to render something useful while offline. */
const SHELL_ASSETS = ['/today', '/manifest.webmanifest', '/icons/icon-192.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // Best effort: a missing asset must not block installation.
      .then((cache) => Promise.allSettled(SHELL_ASSETS.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => !key.startsWith(CACHE_VERSION))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // Personal data: always straight to the network, never stored.
  if (url.pathname.startsWith('/api/')) return

  // Immutable build output.
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone()
              caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy))
            }
            return response
          }),
      ),
    )
    return
  }

  // Page navigations: fresh when possible, cached when not.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone()
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy))
          }
          return response
        })
        .catch(async () => {
          const cached = await caches.match(request)
          if (cached) return cached
          const shell = await caches.match('/today')
          if (shell) return shell
          return new Response(
            '<!doctype html><meta charset="utf-8"><title>Offline</title>' +
              '<style>body{font:15px system-ui;margin:4rem auto;max-width:24rem;padding:0 1rem;color:#16161a}</style>' +
              '<h1>You are offline</h1>' +
              '<p>Dayflow needs a connection to load your calendar. It will pick up where you left off once you are back.</p>',
            { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 503 },
          )
        }),
    )
  }
})

/**
 * Web Push. The subscription and VAPID keys are not wired up yet, so nothing
 * sends here — but the handler exists so switching push on is a server change
 * rather than a service-worker change plus a fresh install for every user.
 */
self.addEventListener('push', (event) => {
  if (!event.data) return

  let payload
  try {
    payload = event.data.json()
  } catch {
    payload = { title: 'Dayflow', body: event.data.text() }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title ?? 'Dayflow', {
      body: payload.body ?? '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: payload.tag,
      data: { url: payload.url ?? '/today' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = event.notification.data?.url ?? '/today'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Reuse an open tab rather than opening a second copy of the app.
      for (const client of clients) {
        if (client.url.includes(target) && 'focus' in client) return client.focus()
      }
      return self.clients.openWindow(target)
    }),
  )
})
