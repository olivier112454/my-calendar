'use client'

import * as React from 'react'

/**
 * A media query as an external store.
 *
 * Read this way rather than through an effect, so a component can branch on
 * viewport size during render without a second pass — and without the flash
 * that comes from rendering the desktop layout first and correcting it after.
 *
 * On the server every query reports false, which is why the layouts are written
 * so that `false` is the safe answer: the desktop column is a real column, and
 * only the mobile overlay is gated on a true result.
 */

const stores = new Map<
  string,
  { subscribe: (listener: () => void) => () => void; getSnapshot: () => boolean }
>()

function storeFor(query: string) {
  const existing = stores.get(query)
  if (existing) return existing

  const store = {
    subscribe(listener: () => void) {
      const media = window.matchMedia(query)
      media.addEventListener('change', listener)
      return () => media.removeEventListener('change', listener)
    },
    getSnapshot() {
      return window.matchMedia(query).matches
    },
  }
  stores.set(query, store)
  return store
}

export function useMediaQuery(query: string): boolean {
  const store = React.useMemo(() => storeFor(query), [query])
  return React.useSyncExternalStore(store.subscribe, store.getSnapshot, () => false)
}

/** Tailwind's `md` breakpoint: below this, navigation moves to the bottom bar. */
export const NARROW_QUERY = '(max-width: 767px)'

/** Below `lg` there is no room for a third column. */
export const NO_SIDE_PANEL_QUERY = '(max-width: 1023px)'

export function useIsNarrow(): boolean {
  return useMediaQuery(NARROW_QUERY)
}
