'use client'

import * as React from 'react'

/**
 * Registers the service worker in production only.
 *
 * In development a cached shell fights hot reload and produces confusing stale
 * screens, so any previously installed worker is removed instead.
 */
export function ServiceWorkerRegistrar() {
  React.useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    if (process.env.NODE_ENV !== 'production') {
      void navigator.serviceWorker
        .getRegistrations()
        .then((registrations) =>
          Promise.all(registrations.map((registration) => registration.unregister())),
        )
        .catch(() => undefined)
      return
    }

    const register = () => {
      void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
        // An unavailable worker costs offline support and nothing else.
      })
    }

    // Registering after load keeps the worker off the critical path.
    if (document.readyState === 'complete') register()
    else window.addEventListener('load', register, { once: true })
  }, [])

  return null
}
