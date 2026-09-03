'use client'

import * as React from 'react'
import { formatMinutesOfDay, minutesIntoDay } from '@/lib/datetime'
import { minutesToPixels } from '@/lib/calendar-layout'

/**
 * "Now" line. A thin rule with a dot on the leading edge — the smallest thing
 * that answers "where am I in the day", which is what people scan a calendar
 * for first.
 */

/**
 * Minutes into the day, or null until the browser has told us.
 *
 * Null rather than a guess, because the server has a clock too and it is not
 * this one. Seeding the state from `new Date()` renders the server's minute
 * into the HTML, and if the clock ticks between that and hydration React finds
 * different text and throws away the tree. Nobody misses a "now" line for the
 * few milliseconds before it appears.
 */
export function useNowMinute(timezone: string): number | null {
  const [minute, setMinute] = React.useState<number | null>(null)

  React.useEffect(() => {
    const update = () => setMinute(minutesIntoDay(new Date(), timezone))
    update()

    // Tick on the minute rather than every 60s from mount, so the line moves
    // when the clock does.
    let interval: ReturnType<typeof setInterval> | undefined
    const msToNextMinute = 60_000 - (Date.now() % 60_000)
    const timeout = setTimeout(() => {
      update()
      interval = setInterval(update, 60_000)
    }, msToNextMinute)

    // A laptop waking from sleep has missed every tick; resync on return.
    const onVisible = () => {
      if (document.visibilityState === 'visible') update()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      clearTimeout(timeout)
      if (interval) clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [timezone])

  return minute
}

export function CurrentTimeIndicator({
  minute,
  hourHeight,
  use24h,
}: {
  minute: number
  hourHeight: number
  use24h: boolean
}) {
  const top = minutesToPixels(minute, hourHeight)

  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-30 flex items-center"
      style={{ top: top - 1 }}
      role="presentation"
    >
      <span className="absolute -left-[3px] size-[7px] rounded-full bg-danger" />
      <span className="h-px w-full bg-danger" />
      <span className="sr-only">Current time {formatMinutesOfDay(minute, use24h)}</span>
    </div>
  )
}
