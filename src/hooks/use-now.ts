'use client'

import * as React from 'react'

/**
 * A stable "now" for rendering.
 *
 * Calling `Date.now()` while rendering makes a component non-deterministic: two
 * renders of the same props can disagree about whether an event is in the past.
 * This hook reads the clock through `useSyncExternalStore`, so every component
 * in a render sees the same instant, and the value advances on a real tick
 * rather than whenever React happens to re-render.
 *
 * A minute is the right granularity: the things that depend on it — "past",
 * "now", "in 20 minutes" — all change at minute resolution.
 */

const listeners = new Set<() => void>()
let snapshot = Date.now()
let timer: ReturnType<typeof setInterval> | undefined

function subscribe(listener: () => void): () => void {
  listeners.add(listener)

  if (!timer) {
    // Align to the start of the next minute, then tick steadily.
    const untilNextMinute = 60_000 - (Date.now() % 60_000)
    const start = setTimeout(() => {
      tick()
      timer = setInterval(tick, 60_000)
    }, untilNextMinute)
    timer = start as unknown as ReturnType<typeof setInterval>
  }

  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && timer) {
      clearInterval(timer)
      clearTimeout(timer)
      timer = undefined
    }
  }
}

function tick() {
  snapshot = Date.now()
  for (const listener of listeners) listener()
}

function getSnapshot(): number {
  return snapshot
}

/**
 * The server has no clock the client can agree with, so it renders from a
 * fixed reference and the first client tick corrects it. Using `Date.now()`
 * here instead would produce a hydration mismatch on every page.
 */
function getServerSnapshot(): number {
  return 0
}

export function useNow(): number {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

/** True when the instant has passed. Safe during render. */
export function useIsPast(iso: string | null | undefined): boolean {
  const now = useNow()
  if (!iso || now === 0) return false
  return Date.parse(iso) < now
}
