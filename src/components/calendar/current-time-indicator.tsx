'use client'

import * as React from 'react'
import { formatMinutesOfDay, minutesIntoDay } from '@/lib/datetime'
import { minutesToPixels } from '@/lib/calendar-layout'

/**
 * "Now" line. A thin rule with a dot on the leading edge — the smallest thing
 * that answers "where am I in the day", which is what people scan a calendar
 * for first.
 */

export function useNowMinute(timezone: string): number {
  const [minute, setMinute] = React.useState(() => minutesIntoDay(new Date(), timezone))

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
