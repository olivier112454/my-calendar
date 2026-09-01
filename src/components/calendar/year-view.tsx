'use client'

import * as React from 'react'
import { dayKeyOf } from '@/lib/datetime'
import type { EventOccurrence } from '@/types/domain'
import { MiniCalendar } from './mini-calendar'

/**
 * Twelve months at a glance. Each day carries a dot when something is scheduled,
 * so the year reads as a density map — where the busy stretches are — rather
 * than twelve decorative grids.
 */
export function YearView({
  year,
  events,
  timezone,
  weekStartsOn,
  selectedKey,
  showWeekNumbers,
  onSelectDay,
}: {
  year: number
  events: EventOccurrence[]
  timezone: string
  weekStartsOn: number
  selectedKey: string | null
  showWeekNumbers?: boolean
  onSelectDay: (dayKey: string) => void
}) {
  const busyKeys = React.useMemo(() => {
    const keys = new Set<string>()
    for (const event of events) {
      const start = new Date(event.start)
      const end = new Date(new Date(event.end).getTime() - 1)
      const startKey = dayKeyOf(start, timezone)
      const endKey = dayKeyOf(end, timezone)
      keys.add(startKey)
      if (endKey !== startKey) keys.add(endKey)
    }
    return keys
  }, [events, timezone])

  return (
    <div className="scrollbar-thin h-full overflow-y-auto bg-surface p-4 sm:p-6">
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-x-6 gap-y-7 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 12 }, (_, month) => {
          const monthKey = `${year}-${String(month + 1).padStart(2, '0')}-01`
          return (
            <div key={monthKey}>
              <h3 className="mb-1.5 text-[13px] font-medium text-fg">
                {new Date(`${monthKey}T12:00:00`).toLocaleDateString('en-GB', {
                  month: 'long',
                })}
              </h3>
              <MiniCalendar
                monthKey={monthKey}
                selectedKey={selectedKey}
                weekStartsOn={weekStartsOn}
                timezone={timezone}
                showWeekNumbers={showWeekNumbers}
                busyKeys={busyKeys}
                onSelect={onSelectDay}
                showHeader={false}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
