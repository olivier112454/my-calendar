'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import {
  addDaysToKey,
  dayKeyOf,
  formatTimeCompact,
  isoWeekNumber,
  todayKey,
  wallToUtc,
} from '@/lib/datetime'
import { bucketByDay, limitMonthCell } from '@/lib/calendar-layout'
import { useNow } from '@/hooks/use-now'
import type { EventOccurrence } from '@/types/domain'

/**
 * Month grid.
 *
 * Always six rows, so switching months never changes the height of the page.
 * How many chips fit in a cell is measured rather than guessed: the row height
 * is read from the DOM and divided by the chip height, so a taller window shows
 * more before it falls back to "+N more".
 */

const CHIP_HEIGHT = 19
const CELL_HEADER_HEIGHT = 24

export interface MonthViewProps {
  dayKeys: string[]
  events: EventOccurrence[]
  timezone: string
  use24h: boolean
  anchorKey: string
  weekStartsOn: number
  showWeekNumbers?: boolean
  selectedId: string | null
  onSelect: (event: EventOccurrence) => void
  onCreateOnDay: (dayKey: string) => void
  onOpenDay: (dayKey: string) => void
  onMoveToDay: (event: EventOccurrence, dayKey: string) => void
  onContextMenu?: (event: EventOccurrence, nativeEvent: React.MouseEvent) => void
}

export function MonthView({
  dayKeys,
  events,
  timezone,
  use24h,
  anchorKey,
  weekStartsOn,
  showWeekNumbers = false,
  selectedId,
  onSelect,
  onCreateOnDay,
  onOpenDay,
  onMoveToDay,
  onContextMenu,
}: MonthViewProps) {
  const today = todayKey(timezone)
  const anchorMonth = anchorKey.slice(0, 7)
  const gridRef = React.useRef<HTMLDivElement>(null)
  const [capacity, setCapacity] = React.useState(3)
  const [dragging, setDragging] = React.useState<{
    event: EventOccurrence
    overKey: string | null
  } | null>(null)

  const buckets = React.useMemo(
    () => bucketByDay(events, dayKeys, timezone),
    [events, dayKeys, timezone],
  )

  // Measure once per resize: how many chips a row can hold.
  React.useEffect(() => {
    const element = gridRef.current
    if (!element) return
    const observer = new ResizeObserver(() => {
      const rowHeight = element.clientHeight / 6
      setCapacity(Math.max(1, Math.floor((rowHeight - CELL_HEADER_HEIGHT) / CHIP_HEIGHT)))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  /* Cross-day dragging: the chip is grabbed, and the cell under the pointer is
     resolved from the DOM so the drop target is always what is visibly hovered. */
  React.useEffect(() => {
    if (!dragging) return

    const onMove = (nativeEvent: PointerEvent) => {
      const element = document
        .elementFromPoint(nativeEvent.clientX, nativeEvent.clientY)
        ?.closest('[data-day-key]')
      const key = element?.getAttribute('data-day-key') ?? null
      setDragging((current) => (current ? { ...current, overKey: key } : current))
    }

    const onUp = () => {
      setDragging((current) => {
        if (current?.overKey) {
          const from = dayKeyOf(new Date(current.event.start), timezone)
          if (current.overKey !== from) onMoveToDay(current.event, current.overKey)
        }
        return null
      })
    }

    const onKey = (nativeEvent: KeyboardEvent) => {
      if (nativeEvent.key === 'Escape') setDragging(null)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('keydown', onKey)
    }
  }, [dragging, onMoveToDay, timezone])

  const weekdayLabels = React.useMemo(() => {
    const base = wallToUtc('2024-01-07T12:00', 'UTC') // a Sunday
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(base.getTime() + ((index + weekStartsOn) % 7) * 86_400_000)
      return date.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })
    })
  }, [weekStartsOn])

  return (
    <div className="flex h-full flex-col overflow-hidden bg-surface">
      <div
        className="grid shrink-0 border-b border-border"
        style={{
          gridTemplateColumns: showWeekNumbers
            ? '2.25rem repeat(7, minmax(0, 1fr))'
            : 'repeat(7, minmax(0, 1fr))',
        }}
      >
        {showWeekNumbers ? <div /> : null}
        {weekdayLabels.map((label) => (
          <div
            key={label}
            className="py-1.5 text-center text-[11px] font-medium uppercase tracking-wide text-fg-subtle"
          >
            {label}
          </div>
        ))}
      </div>

      <div
        ref={gridRef}
        className="grid min-h-0 flex-1"
        style={{
          gridTemplateColumns: showWeekNumbers
            ? '2.25rem repeat(7, minmax(0, 1fr))'
            : 'repeat(7, minmax(0, 1fr))',
          gridTemplateRows: 'repeat(6, minmax(0, 1fr))',
        }}
      >
        {Array.from({ length: 6 }, (_, row) => {
          const rowKeys = dayKeys.slice(row * 7, row * 7 + 7)
          return (
            <React.Fragment key={row}>
              {showWeekNumbers && rowKeys[0] ? (
                <div className="flex items-start justify-center border-t border-grid-line pt-1.5 text-[10px] tabular-nums text-fg-subtle">
                  {isoWeekNumber(rowKeys[0])}
                </div>
              ) : null}
              {rowKeys.map((dayKey) => (
                <MonthCell
                  key={dayKey}
                  dayKey={dayKey}
                  events={buckets.get(dayKey) ?? []}
                  capacity={capacity}
                  timezone={timezone}
                  use24h={use24h}
                  isToday={dayKey === today}
                  isOutside={dayKey.slice(0, 7) !== anchorMonth}
                  isDropTarget={dragging?.overKey === dayKey}
                  selectedId={selectedId}
                  onSelect={onSelect}
                  onCreate={() => onCreateOnDay(dayKey)}
                  onOpenDay={() => onOpenDay(dayKey)}
                  onDragStart={(event) => setDragging({ event, overKey: dayKey })}
                  onContextMenu={onContextMenu}
                />
              ))}
            </React.Fragment>
          )
        })}
      </div>
    </div>
  )
}

function MonthCell({
  dayKey,
  events,
  capacity,
  timezone,
  use24h,
  isToday,
  isOutside,
  isDropTarget,
  selectedId,
  onSelect,
  onCreate,
  onOpenDay,
  onDragStart,
  onContextMenu,
}: {
  dayKey: string
  events: EventOccurrence[]
  capacity: number
  timezone: string
  use24h: boolean
  isToday: boolean
  isOutside: boolean
  isDropTarget: boolean
  selectedId: string | null
  onSelect: (event: EventOccurrence) => void
  onCreate: () => void
  onOpenDay: () => void
  onDragStart: (event: EventOccurrence) => void
  onContextMenu?: (event: EventOccurrence, nativeEvent: React.MouseEvent) => void
}) {
  const { visible, hiddenCount } = limitMonthCell(events, capacity)
  const date = new Date(`${dayKey}T12:00:00`)
  const isFirstOfMonth = date.getDate() === 1

  return (
    <div
      data-day-key={dayKey}
      onDoubleClick={onCreate}
      className={cn(
        'group relative flex min-w-0 flex-col gap-px border-l border-t border-grid-line p-1 first:border-l-0',
        isOutside && 'bg-surface-2/40',
        isDropTarget && 'bg-accent-soft ring-1 ring-inset ring-accent',
      )}
    >
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onOpenDay}
          aria-label={`Open ${date.toLocaleDateString('en-GB', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          })}`}
          className={cn(
            'flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-medium tabular-nums transition-colors',
            isToday
              ? 'bg-accent text-accent-fg'
              : isOutside
                ? 'text-fg-subtle hover:bg-surface-2'
                : 'text-fg hover:bg-surface-2',
          )}
        >
          {isFirstOfMonth && !isToday
            ? date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
            : date.getDate()}
        </button>

        {/* Appears on hover and on keyboard focus, never a permanent + in every cell. */}
        <button
          type="button"
          onClick={onCreate}
          aria-label={`New event on ${date.toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'long',
          })}`}
          className="rounded p-0.5 text-fg-subtle opacity-0 transition-opacity hover:bg-surface-2 hover:text-fg focus-visible:opacity-100 group-hover:opacity-100"
        >
          <svg viewBox="0 0 12 12" className="size-3" aria-hidden="true">
            <path
              d="M6 2v8M2 6h8"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-px overflow-hidden">
        {visible.map((event) => (
          <MonthChip
            key={event.occurrenceId}
            event={event}
            timezone={timezone}
            use24h={use24h}
            selected={event.occurrenceId === selectedId}
            onOpen={() => onSelect(event)}
            onDragStart={() => onDragStart(event)}
            onContextMenu={onContextMenu}
          />
        ))}
        {hiddenCount > 0 ? (
          <button
            type="button"
            onClick={onOpenDay}
            className="mt-px rounded px-1 text-left text-[10px] font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
          >
            +{hiddenCount} more
          </button>
        ) : null}
      </div>
    </div>
  )
}

function MonthChip({
  event,
  timezone,
  use24h,
  selected,
  onOpen,
  onDragStart,
  onContextMenu,
}: {
  event: EventOccurrence
  timezone: string
  use24h: boolean
  selected: boolean
  onOpen: () => void
  onDragStart: () => void
  onContextMenu?: (event: EventOccurrence, nativeEvent: React.MouseEvent) => void
}) {
  const pressTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const now = useNow()

  // Timed events read as a dot plus a time; all-day events as a filled bar. The
  // difference is structural, not just colour, so it survives a greyscale print.
  if (event.allDay) {
    return (
      <button
        type="button"
        onClick={onOpen}
        onContextMenu={(nativeEvent) => onContextMenu?.(event, nativeEvent)}
        onPointerDown={(nativeEvent) => {
          if (event.readOnly) return
          if (nativeEvent.pointerType === 'mouse') onDragStart()
          else pressTimer.current = setTimeout(onDragStart, 280)
        }}
        onPointerUp={() => clearTimeout(pressTimer.current)}
        data-selected={selected || undefined}
        data-cancelled={event.status === 'CANCELLED' || undefined}
        style={{ '--event-color': event.color } as React.CSSProperties}
        className="event-chip flex h-[18px] w-full items-center rounded-[4px] px-1 text-[11px] font-medium leading-none"
        title={event.title}
      >
        <span className="truncate">{event.title}</span>
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      onContextMenu={(nativeEvent) => onContextMenu?.(event, nativeEvent)}
      onPointerDown={(nativeEvent) => {
        if (event.readOnly) return
        if (nativeEvent.pointerType === 'mouse') onDragStart()
        else pressTimer.current = setTimeout(onDragStart, 280)
      }}
      onPointerUp={() => clearTimeout(pressTimer.current)}
      title={`${formatTimeCompact(new Date(event.start), timezone, use24h)} ${event.title}`}
      className={cn(
        'flex h-[18px] w-full items-center gap-1 rounded-[4px] px-1 text-[11px] leading-none transition-colors',
        'hover:bg-surface-2',
        selected && 'bg-surface-2 ring-1 ring-inset ring-accent',
        now > 0 && Date.parse(event.end) < now && 'opacity-60',
      )}
    >
      <span
        aria-hidden="true"
        className="size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: event.color }}
      />
      <span className="shrink-0 tabular-nums text-fg-muted">
        {formatTimeCompact(new Date(event.start), timezone, use24h)}
      </span>
      <span className="truncate font-medium text-fg">{event.title}</span>
    </button>
  )
}

export { addDaysToKey }
