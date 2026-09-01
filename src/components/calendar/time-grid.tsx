'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import {
  MINUTES_PER_DAY,
  formatMinutesOfDay,
  isoWeekNumber,
  minutesIntoDay,
  timeZoneAbbreviation,
  timeZoneCity,
  todayKey,
} from '@/lib/datetime'
import {
  layoutAllDayEvents,
  layoutDayEvents,
  minutesToPixels,
  pixelsToMinutes,
} from '@/lib/calendar-layout'
import type { EventOccurrence } from '@/types/domain'
import { AllDayChip, EventChip } from './event-chip'
import { TASK_DRAG_TYPE, type TaskDragPayload } from '@/components/tasks/task-row'
import { CurrentTimeIndicator, useNowMinute } from './current-time-indicator'
import {
  minuteToInstant,
  useGridInteraction,
  type CommitCreate,
  type CommitMove,
} from './use-grid-interaction'

/**
 * The day/week time grid.
 *
 * Layout is a single scroll container holding a fixed 24-hour canvas, with the
 * hour gutter and the day columns as siblings so they can never drift apart.
 * Sticky headers keep the day names and the all-day row visible while the body
 * scrolls.
 */

const GUTTER_WIDTH = 60

export interface TimeGridProps {
  dayKeys: string[]
  events: EventOccurrence[]
  timezone: string
  secondaryTimezones?: string[]
  use24h: boolean
  compact?: boolean
  showWeekNumbers?: boolean
  selectedId: string | null
  /** Initial scroll target in hours; defaults to just before working hours. */
  scrollToHour?: number
  onSelect: (event: EventOccurrence) => void
  onCreate: (draft: CommitCreate) => void
  onMove: (change: CommitMove) => void
  onContextMenu?: (event: EventOccurrence, nativeEvent: React.MouseEvent) => void
  onDayHeaderClick?: (dayKey: string) => void
  /** Called when a task is dropped onto the grid from the task list. */
  onTaskDrop?: (payload: TaskDragPayload, start: Date, end: Date) => void
}

export function TimeGrid({
  dayKeys,
  events,
  timezone,
  secondaryTimezones = [],
  use24h,
  compact = false,
  showWeekNumbers = false,
  selectedId,
  scrollToHour,
  onSelect,
  onCreate,
  onMove,
  onContextMenu,
  onDayHeaderClick,
  onTaskDrop,
}: TimeGridProps) {
  const hourHeight = compact ? 38 : 48
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const surfaceRef = React.useRef<HTMLDivElement>(null)
  const today = todayKey(timezone)
  const nowMinute = useNowMinute(timezone)

  const { preview, startCreate, startMove, startResize } = useGridInteraction({
    surfaceRef,
    hourHeight,
    dayKeys,
    timezone,
    originMinute: 0,
    onCreate,
    onMove,
    onSelect,
  })

  // Land on the working day rather than at midnight. Runs once per view change;
  // scrolling afterwards is the user's business.
  const scrollKey = dayKeys.join('|')
  React.useEffect(() => {
    const container = scrollRef.current
    if (!container) return
    const targetHour = scrollToHour ?? Math.max(0, Math.floor(nowMinute / 60) - 2)
    container.scrollTop = Math.max(0, targetHour * hourHeight)
    // nowMinute intentionally omitted: re-scrolling every minute would fight
    // the user for control of the scroll position.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollKey, hourHeight, scrollToHour])

  const allDay = React.useMemo(
    () => layoutAllDayEvents(events, dayKeys, timezone),
    [events, dayKeys, timezone],
  )

  const perDay = React.useMemo(
    () => dayKeys.map((dayKey) => layoutDayEvents(events, dayKey, timezone)),
    [events, dayKeys, timezone],
  )

  const columnTemplate = `repeat(${dayKeys.length}, minmax(0, 1fr))`
  const gutterWidth = GUTTER_WIDTH + secondaryTimezones.length * 44

  /* Dropping a task onto the grid.
     HTML5 drag-and-drop is the right tool here: it is what a mouse user expects,
     it gives the browser's own drag image for free, and it cannot be confused
     with the pointer gestures that move events. Touch devices have no HTML5 DnD,
     so the task editor and the Schedule page offer the same action as a button. */
  const [dropPreview, setDropPreview] = React.useState<{
    dayIndex: number
    startMinute: number
    endMinute: number
    title: string
  } | null>(null)

  const readTaskPayload = (transfer: DataTransfer): TaskDragPayload | null => {
    const raw = transfer.getData(TASK_DRAG_TYPE)
    if (!raw) return null
    try {
      return JSON.parse(raw) as TaskDragPayload
    } catch {
      return null
    }
  }

  const dropPositionFrom = (nativeEvent: React.DragEvent) => {
    const surface = surfaceRef.current
    if (!surface) return null
    const rect = surface.getBoundingClientRect()
    const columnWidth = rect.width / Math.max(1, dayKeys.length)
    const dayIndex = Math.min(
      dayKeys.length - 1,
      Math.max(0, Math.floor((nativeEvent.clientX - rect.left) / columnWidth)),
    )
    const startMinute = Math.max(
      0,
      Math.min(
        MINUTES_PER_DAY - 15,
        pixelsToMinutes(nativeEvent.clientY - rect.top, hourHeight, 15),
      ),
    )
    return { dayIndex, startMinute }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-surface">
      {/* ------------------------------------------------------- day header */}
      <div className="flex shrink-0 border-b border-border">
        <div
          className="flex shrink-0 flex-col items-end justify-end gap-0.5 pb-1.5 pr-1.5"
          style={{ width: gutterWidth }}
        >
          {showWeekNumbers && dayKeys[0] ? (
            <span
              className="text-[10px] font-medium text-fg-subtle"
              title={`Week ${isoWeekNumber(dayKeys[0])}`}
            >
              W{isoWeekNumber(dayKeys[0])}
            </span>
          ) : null}
          {/* Zone labels belong in the sticky corner: inside the scroll canvas
              they disappear the moment the grid is scrolled. */}
          {secondaryTimezones.length > 0 ? (
            <span className="flex gap-1">
              {[timezone, ...secondaryTimezones].map((zone) => (
                <span
                  key={zone}
                  className="w-10 text-right text-[9px] font-medium uppercase text-fg-subtle"
                  title={`${timeZoneCity(zone)} (${timeZoneAbbreviation(zone)})`}
                >
                  {timeZoneCity(zone).slice(0, 3)}
                </span>
              ))}
            </span>
          ) : null}
        </div>
        <div className="grid flex-1" style={{ gridTemplateColumns: columnTemplate }}>
          {dayKeys.map((dayKey) => (
            <DayHeader
              key={dayKey}
              dayKey={dayKey}
              isToday={dayKey === today}
              single={dayKeys.length === 1}
              onClick={onDayHeaderClick ? () => onDayHeaderClick(dayKey) : undefined}
            />
          ))}
        </div>
      </div>

      {/* ------------------------------------------------------ all-day row */}
      <div className="flex shrink-0 border-b border-border">
        <div
          className="flex shrink-0 items-start justify-end pr-2 pt-1.5"
          style={{ width: gutterWidth }}
        >
          <span className="text-[10px] leading-none text-fg-subtle">all-day</span>
        </div>
        <div
          className="relative flex-1"
          style={{
            minHeight: 24,
            height: Math.max(24, allDay.laneCount * 21 + 6),
          }}
        >
          <div
            className="absolute inset-0 grid"
            style={{ gridTemplateColumns: columnTemplate }}
            aria-hidden="true"
          >
            {dayKeys.map((dayKey) => (
              <div
                key={dayKey}
                className={cn(
                  'border-l border-grid-line first:border-l-0',
                  isWeekendKey(dayKey) && 'bg-weekend-tint',
                )}
              />
            ))}
          </div>
          {allDay.bars.map((bar) => (
            <div
              key={`${bar.event.occurrenceId}-${bar.lane}`}
              className="absolute px-px"
              style={{
                top: bar.lane * 21 + 3,
                left: `${(bar.startIndex / dayKeys.length) * 100}%`,
                width: `${(bar.span / dayKeys.length) * 100}%`,
              }}
            >
              <AllDayChip
                event={bar.event}
                selected={bar.event.occurrenceId === selectedId}
                continuesBefore={bar.continuesBefore}
                continuesAfter={bar.continuesAfter}
                onOpen={() => onSelect(bar.event)}
                onContextMenu={
                  onContextMenu
                    ? (nativeEvent) => onContextMenu(bar.event, nativeEvent)
                    : undefined
                }
              />
            </div>
          ))}
        </div>
      </div>

      {/* ----------------------------------------------------------- body */}
      <div ref={scrollRef} className="scrollbar-thin flex-1 overflow-y-auto">
        <div className="relative flex" style={{ height: 24 * hourHeight }}>
          <TimeGutter
            hourHeight={hourHeight}
            use24h={use24h}
            timezone={timezone}
            secondaryTimezones={secondaryTimezones}
            width={gutterWidth}
            nowMinute={dayKeys.includes(today) ? nowMinute : null}
          />

          <div
            ref={surfaceRef}
            onPointerDown={startCreate}
            onDragOver={(nativeEvent) => {
              if (!onTaskDrop) return
              if (!nativeEvent.dataTransfer.types.includes(TASK_DRAG_TYPE)) return
              // Only preventDefault for a payload we can actually accept, so
              // unrelated drags still get the browser's "not allowed" cursor.
              nativeEvent.preventDefault()
              nativeEvent.dataTransfer.dropEffect = 'move'
              const position = dropPositionFrom(nativeEvent)
              if (!position) return
              setDropPreview((current) => ({
                ...position,
                endMinute: position.startMinute + (current?.endMinute && current?.startMinute
                  ? current.endMinute - current.startMinute
                  : 60),
                title: current?.title ?? 'Task',
              }))
            }}
            onDragLeave={(nativeEvent) => {
              // Ignore the events fired while crossing child elements.
              if (nativeEvent.currentTarget.contains(nativeEvent.relatedTarget as Node)) return
              setDropPreview(null)
            }}
            onDrop={(nativeEvent) => {
              setDropPreview(null)
              if (!onTaskDrop) return
              const payload = readTaskPayload(nativeEvent.dataTransfer)
              if (!payload) return
              nativeEvent.preventDefault()
              const position = dropPositionFrom(nativeEvent)
              const dayKey = position ? dayKeys[position.dayIndex] : undefined
              if (!position || !dayKey) return
              const minutes = payload.estimatedMinutes ?? 60
              onTaskDrop(
                payload,
                minuteToInstant(dayKey, position.startMinute, timezone),
                minuteToInstant(dayKey, position.startMinute + minutes, timezone),
              )
            }}
            className="relative grid flex-1"
            style={{ gridTemplateColumns: columnTemplate, touchAction: 'pan-y' }}
          >
            {/* Hour rules sit behind everything and never intercept a pointer. */}
            <div className="pointer-events-none absolute inset-0" aria-hidden="true">
              {Array.from({ length: 24 }, (_, hour) => (
                <div
                  key={hour}
                  className="absolute inset-x-0 border-t border-grid-line"
                  style={{ top: hour * hourHeight }}
                />
              ))}
            </div>

            {dayKeys.map((dayKey, dayIndex) => (
              <div
                key={dayKey}
                className={cn(
                  'relative border-l border-grid-line first:border-l-0',
                  isWeekendKey(dayKey) && 'bg-weekend-tint',
                )}
                role="gridcell"
                aria-label={new Date(`${dayKey}T12:00:00`).toLocaleDateString('en-GB', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                })}
              >
                {perDay[dayIndex]?.map((positioned) => {
                  const isDragging =
                    (preview.kind === 'move' || preview.kind === 'resize') &&
                    preview.occurrenceId === positioned.event.occurrenceId
                  return (
                    <EventChip
                      key={positioned.event.occurrenceId}
                      event={positioned.event}
                      top={minutesToPixels(positioned.startMinute, hourHeight)}
                      height={Math.max(
                        16,
                        minutesToPixels(
                          positioned.endMinute - positioned.startMinute,
                          hourHeight,
                        ) - 1,
                      )}
                      left={positioned.left}
                      width={positioned.width}
                      zIndex={positioned.zIndex}
                      timezone={timezone}
                      use24h={use24h}
                      selected={positioned.event.occurrenceId === selectedId}
                      isPast={Date.parse(positioned.event.end) < Date.now()}
                      dragging={isDragging}
                      continuesBefore={positioned.continuesBefore}
                      continuesAfter={positioned.continuesAfter}
                      onPointerDown={(nativeEvent) => {
                        nativeEvent.stopPropagation()
                        startMove(nativeEvent, positioned.event, dayIndex)
                      }}
                      onResizeStart={(nativeEvent, edge) =>
                        startResize(nativeEvent, positioned.event, dayIndex, edge)
                      }
                      onOpen={() => onSelect(positioned.event)}
                      onContextMenu={
                        onContextMenu
                          ? (nativeEvent) => onContextMenu(positioned.event, nativeEvent)
                          : undefined
                      }
                    />
                  )
                })}

                {dayKey === today ? (
                  <CurrentTimeIndicator
                    minute={nowMinute}
                    hourHeight={hourHeight}
                    use24h={use24h}
                  />
                ) : null}
              </div>
            ))}

            {dropPreview ? (
              <div
                className="pointer-events-none absolute z-50 px-px"
                style={{
                  top: minutesToPixels(dropPreview.startMinute, hourHeight),
                  height: Math.max(
                    16,
                    minutesToPixels(
                      dropPreview.endMinute - dropPreview.startMinute,
                      hourHeight,
                    ) - 1,
                  ),
                  left: `${(dropPreview.dayIndex / dayKeys.length) * 100}%`,
                  width: `${(1 / dayKeys.length) * 100}%`,
                }}
              >
                <div className="flex size-full flex-col justify-center rounded-[5px] border border-dashed border-accent bg-accent-soft px-1.5 text-[11px] font-medium text-accent">
                  {formatMinutesOfDay(dropPreview.startMinute, use24h)}
                </div>
              </div>
            ) : null}

            <DragGhost
              preview={preview}
              dayKeys={dayKeys}
              hourHeight={hourHeight}
              timezone={timezone}
              use24h={use24h}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------- sub-parts */

function DayHeader({
  dayKey,
  isToday,
  single,
  onClick,
}: {
  dayKey: string
  isToday: boolean
  single: boolean
  onClick?: () => void
}) {
  const date = new Date(`${dayKey}T12:00:00`)
  const weekday = date.toLocaleDateString('en-GB', {
    weekday: single ? 'long' : 'short',
  })
  const dayNumber = date.getDate()

  const content = (
    <>
      <span
        className={cn(
          'text-[11px] font-medium uppercase tracking-wide',
          isToday ? 'text-accent' : 'text-fg-subtle',
        )}
      >
        {weekday}
      </span>
      <span
        className={cn(
          'flex items-center justify-center rounded-full text-[15px] font-medium tabular-nums',
          isToday
            ? 'size-7 bg-accent text-accent-fg'
            : 'size-7 text-fg',
        )}
      >
        {dayNumber}
      </span>
    </>
  )

  return (
    <div className="flex flex-col items-center gap-0.5 py-1.5">
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          className="flex flex-col items-center gap-0.5 rounded-md px-2 py-0.5 transition-colors hover:bg-surface-2"
          aria-label={`Show ${date.toLocaleDateString('en-GB', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          })}`}
        >
          {content}
        </button>
      ) : (
        content
      )}
    </div>
  )
}

function TimeGutter({
  hourHeight,
  use24h,
  timezone,
  secondaryTimezones,
  width,
  nowMinute,
}: {
  hourHeight: number
  use24h: boolean
  timezone: string
  secondaryTimezones: string[]
  width: number
  /** Null when today is not among the visible days. */
  nowMinute: number | null
}) {
  const zones = [timezone, ...secondaryTimezones]

  return (
    <div
      className="relative shrink-0 select-none border-r border-grid-line"
      style={{ width }}
      aria-hidden="true"
    >
      {Array.from({ length: 24 }, (_, hour) => (
        <div
          key={hour}
          className="absolute inset-x-0 flex justify-end gap-1 pr-1.5"
          // Nudged up so the label sits on its rule rather than below it.
          style={{ top: hour * hourHeight - 6 }}
        >
          {zones.map((zone, index) => (
            <span
              key={zone}
              className={cn(
                'text-right text-[10px] leading-3 tabular-nums',
                index === 0 ? 'text-fg-subtle' : 'text-fg-subtle/60',
                zones.length > 1 ? 'w-10' : '',
              )}
            >
              {(hour === 0 && index === 0) ||
              (nowMinute !== null &&
                index === 0 &&
                Math.abs(hour * 60 - nowMinute) < 20)
                ? ''
                : formatMinutesOfDay(shiftHourToZone(hour, timezone, zone), use24h)}
            </span>
          ))}
        </div>
      ))}

      {/* The current time replaces the hour label it would otherwise cover,
          rather than floating over the second time-zone column. */}
      {nowMinute !== null ? (
        <div
          className="absolute right-1.5 flex items-center"
          style={{ top: minutesToPixels(nowMinute, hourHeight) - 8 }}
        >
          <span className="rounded bg-danger px-1 py-px text-[10px] font-medium leading-tight tabular-nums text-white">
            {formatMinutesOfDay(nowMinute, use24h)}
          </span>
        </div>
      ) : null}
    </div>
  )
}

/** The wall-clock hour in `target` at the moment `hour` strikes in `base`. */
function shiftHourToZone(hour: number, base: string, target: string): number {
  if (base === target) return hour * 60
  const reference = new Date()
  reference.setHours(hour, 0, 0, 0)
  const minutes = minutesIntoDay(reference, target)
  return minutes
}

function DragGhost({
  preview,
  dayKeys,
  hourHeight,
  timezone,
  use24h,
}: {
  preview: ReturnType<typeof useGridInteraction>['preview']
  dayKeys: string[]
  hourHeight: number
  timezone: string
  use24h: boolean
}) {
  if (preview.kind === 'none') return null

  const top = minutesToPixels(preview.startMinute, hourHeight)
  const height = Math.max(
    16,
    minutesToPixels(preview.endMinute - preview.startMinute, hourHeight) - 1,
  )
  const dayKey = dayKeys[preview.dayIndex]
  if (!dayKey) return null

  const start = minuteToInstant(dayKey, preview.startMinute, timezone)
  const end = minuteToInstant(dayKey, preview.endMinute, timezone)
  const duration = Math.round((end.getTime() - start.getTime()) / 60_000)

  return (
    <div
      className="pointer-events-none absolute z-50 px-px"
      style={{
        top,
        height,
        left: `${(preview.dayIndex / dayKeys.length) * 100}%`,
        width: `${(1 / dayKeys.length) * 100}%`,
      }}
      aria-live="polite"
    >
      <div
        className={cn(
          'flex size-full flex-col overflow-hidden rounded-[5px] px-1.5 py-1',
          'border border-accent bg-accent-soft text-accent shadow-md',
        )}
      >
        <span className="whitespace-nowrap text-[10px] font-medium leading-[15px]">
          {formatMinutesOfDay(preview.startMinute % MINUTES_PER_DAY, use24h)} –{' '}
          {formatMinutesOfDay(preview.endMinute % MINUTES_PER_DAY, use24h)}
        </span>
        {height > 30 ? (
          <span className="text-[11px] font-medium leading-[15px]">
            {duration >= 60
              ? `${Math.floor(duration / 60)}h${duration % 60 ? ` ${duration % 60}m` : ''}`
              : `${duration}m`}
          </span>
        ) : null}
      </div>
    </div>
  )
}

function isWeekendKey(dayKey: string): boolean {
  const day = new Date(`${dayKey}T12:00:00`).getDay()
  return day === 0 || day === 6
}
