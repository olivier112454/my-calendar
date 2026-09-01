'use client'

import * as React from 'react'
import { MapPin, Repeat, Users, Video, Lock, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatTimeCompact } from '@/lib/datetime'
import type { EventOccurrence } from '@/types/domain'

/**
 * One event drawn in the time grid.
 *
 * The height of the block decides how much can be shown. Rather than truncating
 * to a fixed number of lines, the chip works out how many lines actually fit and
 * lets the title use them — a title that is cut short while there is empty space
 * below it is a bug, not a style choice. The full title is always available to
 * assistive technology and on hover.
 */

/** Below this height the handles would cover the whole block. */
const MIN_HEIGHT_FOR_HANDLES = 34
/** Below this the time and title share one line. */
const MIN_HEIGHT_FOR_TIME_ROW = 30
const LINE_HEIGHT = 15

export interface EventChipProps {
  event: EventOccurrence
  top: number
  height: number
  left: number
  width: number
  zIndex: number
  timezone: string
  use24h: boolean
  selected: boolean
  isPast: boolean
  dragging?: boolean
  continuesBefore?: boolean
  continuesAfter?: boolean
  onPointerDown?: (nativeEvent: React.PointerEvent) => void
  onResizeStart?: (nativeEvent: React.PointerEvent, edge: 'start' | 'end') => void
  onOpen?: () => void
  onContextMenu?: (nativeEvent: React.MouseEvent) => void
}

export const EventChip = React.memo(function EventChip({
  event,
  top,
  height,
  left,
  width,
  zIndex,
  timezone,
  use24h,
  selected,
  isPast,
  dragging,
  continuesBefore,
  continuesAfter,
  onPointerDown,
  onResizeStart,
  onOpen,
  onContextMenu,
}: EventChipProps) {
  const showHandles = height >= MIN_HEIGHT_FOR_HANDLES && !event.readOnly
  const stacked = height >= MIN_HEIGHT_FOR_TIME_ROW
  const start = new Date(event.start)
  const timeLabel = formatTimeCompact(start, timezone, use24h)

  // Lines available for the title once the time row and padding are accounted
  // for. The gaps count too — leaving them out overestimates and clips.
  const reserved = stacked ? LINE_HEIGHT + 6 : 6
  const titleLines = Math.max(1, Math.floor((height - reserved) / LINE_HEIGHT))

  const declined = event.myResponse === 'DECLINED'
  const tentative = event.status === 'TENTATIVE' || event.myResponse === 'TENTATIVE'

  return (
    <div
      className="absolute px-px"
      style={{ top, height, left: `${left * 100}%`, width: `${width * 100}%`, zIndex }}
    >
      <button
        type="button"
        onPointerDown={onPointerDown}
        onContextMenu={onContextMenu}
        onKeyDown={(keyEvent) => {
          if (keyEvent.key === 'Enter' || keyEvent.key === ' ') {
            keyEvent.preventDefault()
            onOpen?.()
          }
        }}
        data-past={isPast || undefined}
        data-selected={selected || undefined}
        data-dragging={dragging || undefined}
        data-tentative={tentative || undefined}
        data-cancelled={event.status === 'CANCELLED' || undefined}
        aria-label={ariaLabel(event, timeLabel)}
        title={`${timeLabel} · ${event.title}`}
        style={
          {
            '--event-color': event.color,
            touchAction: 'none',
          } as React.CSSProperties
        }
        className={cn(
          'event-chip group relative flex size-full flex-col overflow-hidden text-left',
          'px-1.5 py-1 transition-shadow duration-150',
          'hover:shadow-sm focus-visible:z-50',
          height < 22 ? 'rounded-[3px]' : 'rounded-[5px]',
          continuesBefore && 'rounded-t-none border-t-transparent',
          continuesAfter && 'rounded-b-none border-b-transparent',
          declined && 'opacity-55',
          event.readOnly ? 'cursor-default' : 'cursor-grab active:cursor-grabbing',
        )}
      >
        {stacked ? (
          <>
            {/* nowrap: if the time wraps it eats the title's lines. */}
            <span className="flex items-center gap-1 whitespace-nowrap text-[10px] font-medium leading-[15px] opacity-80">
              {timeLabel}
              <ChipIcons event={event} />
            </span>
            <span
              className="break-user-text text-[11px] font-medium leading-[15px]"
              style={{
                display: '-webkit-box',
                WebkitLineClamp: titleLines,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {event.title}
            </span>
          </>
        ) : (
          <span className="flex items-baseline gap-1 overflow-hidden whitespace-nowrap text-[11px] leading-[14px]">
            <span className="font-medium opacity-80">{timeLabel}</span>
            <span className="truncate font-medium">{event.title}</span>
          </span>
        )}

        {showHandles ? (
          <>
            {/* Handles are wider than they look: 8px of grab area, a 3px line. */}
            <span
              role="presentation"
              onPointerDown={(pointerEvent) => onResizeStart?.(pointerEvent, 'start')}
              className="absolute inset-x-0 top-0 h-2 cursor-ns-resize"
              style={{ touchAction: 'none' }}
            />
            <span
              role="presentation"
              onPointerDown={(pointerEvent) => onResizeStart?.(pointerEvent, 'end')}
              className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize"
              style={{ touchAction: 'none' }}
            />
          </>
        ) : null}
      </button>
    </div>
  )
})

function ChipIcons({ event }: { event: EventOccurrence }) {
  return (
    <span className="inline-flex items-center gap-0.5 [&_svg]:size-2.5 [&_svg]:opacity-75">
      {event.meetingProvider !== 'NONE' ? <Video aria-hidden="true" /> : null}
      {event.location ? <MapPin aria-hidden="true" /> : null}
      {event.attendeeCount > 0 ? <Users aria-hidden="true" /> : null}
      {event.isRecurring ? <Repeat aria-hidden="true" /> : null}
      {event.visibility === 'PRIVATE' ? <Lock aria-hidden="true" /> : null}
      {event.kind === 'TASK_BLOCK' ? <CheckCircle2 aria-hidden="true" /> : null}
    </span>
  )
}

/**
 * Everything the chip conveys visually, spelled out for screen readers —
 * including the state that colour alone would carry.
 */
function ariaLabel(event: EventOccurrence, timeLabel: string): string {
  const parts = [timeLabel, event.title, `in ${event.calendarName}`]
  if (event.location) parts.push(`at ${event.location}`)
  if (event.attendeeCount > 0) {
    parts.push(`${event.attendeeCount} guest${event.attendeeCount === 1 ? '' : 's'}`)
  }
  if (event.isRecurring) parts.push('repeating')
  if (event.status === 'TENTATIVE') parts.push('tentative')
  if (event.status === 'CANCELLED') parts.push('cancelled')
  if (event.myResponse === 'DECLINED') parts.push('you declined')
  if (event.readOnly) parts.push('read-only')
  return parts.join(', ')
}

/** Bar used in the all-day row; horizontal rather than vertical. */
export function AllDayChip({
  event,
  selected,
  continuesBefore,
  continuesAfter,
  onOpen,
  onContextMenu,
}: {
  event: EventOccurrence
  selected: boolean
  continuesBefore?: boolean
  continuesAfter?: boolean
  onOpen?: () => void
  onContextMenu?: (nativeEvent: React.MouseEvent) => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      onContextMenu={onContextMenu}
      data-selected={selected || undefined}
      data-tentative={event.status === 'TENTATIVE' || undefined}
      data-cancelled={event.status === 'CANCELLED' || undefined}
      aria-label={ariaLabel(event, 'All day')}
      title={event.title}
      style={{ '--event-color': event.color } as React.CSSProperties}
      className={cn(
        'event-chip flex h-[19px] w-full items-center gap-1 rounded-[4px] px-1.5',
        'text-[11px] font-medium leading-none transition-shadow duration-150 hover:shadow-sm',
        continuesBefore && 'rounded-l-none',
        continuesAfter && 'rounded-r-none',
      )}
    >
      {continuesBefore ? <span aria-hidden="true">‹</span> : null}
      <span className="truncate">{event.title}</span>
      {continuesAfter ? (
        <span aria-hidden="true" className="ml-auto">
          ›
        </span>
      ) : null}
    </button>
  )
}
