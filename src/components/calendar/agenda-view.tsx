'use client'

import * as React from 'react'
import { CalendarPlus, MapPin, Users, Video } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  dayKeyOf,
  formatTimeCompact,
  formatDuration,
  todayKey,
} from '@/lib/datetime'
import { bucketByDay } from '@/lib/calendar-layout'
import type { EventOccurrence } from '@/types/domain'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/states'
import { useNow } from '@/hooks/use-now'

/**
 * Agenda / list view: a scrolling list grouped by day, with empty days omitted.
 * Sticky day headers keep the date in view while a long day scrolls past.
 */

export function AgendaView({
  dayKeys,
  events,
  timezone,
  use24h,
  selectedId,
  onSelect,
  onCreate,
  onContextMenu,
}: {
  dayKeys: string[]
  events: EventOccurrence[]
  timezone: string
  use24h: boolean
  selectedId: string | null
  onSelect: (event: EventOccurrence) => void
  onCreate: () => void
  onContextMenu?: (event: EventOccurrence, nativeEvent: React.MouseEvent) => void
}) {
  const today = todayKey(timezone)
  const buckets = React.useMemo(
    () => bucketByDay(events, dayKeys, timezone),
    [events, dayKeys, timezone],
  )

  const days = dayKeys
    .map((dayKey) => ({ dayKey, items: buckets.get(dayKey) ?? [] }))
    .filter(({ items }) => items.length > 0)

  if (days.length === 0) {
    return (
      <div className="flex h-full items-center justify-center bg-surface">
        <EmptyState
          icon={<CalendarPlus />}
          title="Nothing scheduled"
          description="There are no events in this stretch of the calendar."
          action={
            <Button variant="primary" size="sm" onClick={onCreate}>
              Create event
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <div className="scrollbar-thin h-full overflow-y-auto bg-surface">
      <ul className="divide-y divide-border">
        {days.map(({ dayKey, items }) => {
          const date = new Date(`${dayKey}T12:00:00`)
          const isToday = dayKey === today
          return (
            <li key={dayKey} className="flex gap-3 px-4 py-3 sm:gap-5 sm:px-6">
              <div className="sticky top-3 h-fit w-14 shrink-0 self-start sm:w-16">
                <p
                  className={cn(
                    'text-[11px] font-medium uppercase tracking-wide',
                    isToday ? 'text-accent' : 'text-fg-subtle',
                  )}
                >
                  {date.toLocaleDateString('en-GB', { weekday: 'short' })}
                </p>
                <p
                  className={cn(
                    'text-[22px] font-semibold leading-tight tabular-nums',
                    isToday ? 'text-accent' : 'text-fg',
                  )}
                >
                  {date.getDate()}
                </p>
                <p className="text-[11px] text-fg-subtle">
                  {date.toLocaleDateString('en-GB', { month: 'short' })}
                </p>
              </div>

              <ul className="min-w-0 flex-1 space-y-0.5">
                {items.map((event) => (
                  <li key={event.occurrenceId}>
                    <AgendaRow
                      event={event}
                      timezone={timezone}
                      use24h={use24h}
                      selected={event.occurrenceId === selectedId}
                      onSelect={() => onSelect(event)}
                      onContextMenu={onContextMenu}
                    />
                  </li>
                ))}
              </ul>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function AgendaRow({
  event,
  timezone,
  use24h,
  selected,
  onSelect,
  onContextMenu,
}: {
  event: EventOccurrence
  timezone: string
  use24h: boolean
  selected: boolean
  onSelect: () => void
  onContextMenu?: (event: EventOccurrence, nativeEvent: React.MouseEvent) => void
}) {
  const now = useNow()
  const start = new Date(event.start)
  const end = new Date(event.end)
  const duration = Math.round((end.getTime() - start.getTime()) / 60_000)
  const isPast = now > 0 && end.getTime() < now
  const sameDayEnd = dayKeyOf(end, timezone) === dayKeyOf(start, timezone)

  return (
    <button
      type="button"
      onClick={onSelect}
      onContextMenu={(nativeEvent) => onContextMenu?.(event, nativeEvent)}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'group flex w-full items-start gap-3 rounded-md px-2 py-1.5 text-left transition-colors',
        'hover:bg-surface-2',
        selected && 'bg-surface-2 ring-1 ring-inset ring-accent',
        isPast && 'opacity-65',
      )}
    >
      <span
        aria-hidden="true"
        className="mt-1 w-[3px] shrink-0 self-stretch rounded-full"
        style={{ backgroundColor: event.color }}
      />

      <span className="w-[4.5rem] shrink-0 pt-px text-[12px] tabular-nums text-fg-muted">
        {event.allDay ? (
          'All day'
        ) : (
          <>
            {formatTimeCompact(start, timezone, use24h)}
            <span className="block text-[11px] text-fg-subtle">
              {sameDayEnd ? formatTimeCompact(end, timezone, use24h) : formatDuration(duration)}
            </span>
          </>
        )}
      </span>

      <span className="min-w-0 flex-1 space-y-0.5">
        <span
          className={cn(
            'block break-user-text text-[13px] font-medium text-fg',
            event.status === 'CANCELLED' && 'line-through opacity-60',
          )}
        >
          {event.title}
        </span>
        <span className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-fg-muted">
          <span className="inline-flex items-center gap-1">
            <span
              aria-hidden="true"
              className="size-1.5 rounded-full"
              style={{ backgroundColor: event.color }}
            />
            {event.calendarName}
          </span>
          {event.location ? (
            <span className="inline-flex min-w-0 items-center gap-1">
              <MapPin className="size-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{event.location}</span>
            </span>
          ) : null}
          {event.meetingProvider !== 'NONE' ? (
            <span className="inline-flex items-center gap-1">
              <Video className="size-3" aria-hidden="true" />
              Video call
            </span>
          ) : null}
          {event.attendeeCount > 0 ? (
            <span className="inline-flex items-center gap-1">
              <Users className="size-3" aria-hidden="true" />
              {event.attendeeCount}
            </span>
          ) : null}
        </span>
      </span>
    </button>
  )
}
