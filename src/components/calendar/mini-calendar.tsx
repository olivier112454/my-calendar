'use client'

import * as React from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  addDaysToKey,
  isoWeekNumber,
  monthGridKeys,
  todayKey,
} from '@/lib/datetime'
import { Button } from '@/components/ui/button'

/**
 * Compact month picker used in the sidebar and as the building block of the
 * year view. Fully keyboard operable: arrows move day by day, PageUp/PageDown
 * by month, Home/End to the ends of the week.
 */

export interface MiniCalendarProps {
  /** Month to display, as any day key inside it. */
  monthKey: string
  /** Currently selected day. */
  selectedKey?: string | null
  /** Days to highlight as the active range (the week being viewed). */
  rangeKeys?: string[]
  weekStartsOn: number
  timezone: string
  showWeekNumbers?: boolean
  /** Day keys that have at least one event, drawn with a dot. */
  busyKeys?: Set<string>
  /**
   * Earliest selectable day. Days before it are shown but disabled rather than
   * hidden, so the month keeps its shape and it stays obvious why a day cannot
   * be picked — an end date before its start, usually.
   */
  minKey?: string
  onSelect: (dayKey: string) => void
  onMonthChange?: (monthKey: string) => void
  showHeader?: boolean
  className?: string
}

export function MiniCalendar({
  monthKey,
  selectedKey,
  rangeKeys,
  weekStartsOn,
  timezone,
  showWeekNumbers = false,
  busyKeys,
  minKey,
  onSelect,
  onMonthChange,
  showHeader = true,
  className,
}: MiniCalendarProps) {
  const today = todayKey(timezone)
  const gridKeys = React.useMemo(
    () => monthGridKeys(monthKey, weekStartsOn),
    [monthKey, weekStartsOn],
  )
  const monthPrefix = monthKey.slice(0, 7)
  const range = React.useMemo(() => new Set(rangeKeys ?? []), [rangeKeys])

  const weekdayLabels = React.useMemo(
    () =>
      Array.from({ length: 7 }, (_, index) => {
        // 2024-01-07 was a Sunday; offset from there to respect week start.
        const date = new Date(Date.UTC(2024, 0, 7 + ((index + weekStartsOn) % 7)))
        return date.toLocaleDateString('en-GB', { weekday: 'narrow', timeZone: 'UTC' })
      }),
    [weekStartsOn],
  )

  const shiftMonth = (delta: number) => {
    const [year, month] = monthKey.split('-').map(Number)
    const date = new Date(year!, month! - 1 + delta, 1)
    const next = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`
    onMonthChange?.(next)
  }

  const handleKeyDown = (nativeEvent: React.KeyboardEvent, dayKey: string) => {
    const moves: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    }
    if (nativeEvent.key in moves) {
      nativeEvent.preventDefault()
      const target = addDaysToKey(dayKey, moves[nativeEvent.key]!)
      if (minKey && target < minKey) return
      onSelect(target)
      // Follow the cursor into the neighbouring month when it crosses over.
      if (target.slice(0, 7) !== monthPrefix) onMonthChange?.(target)
      requestAnimationFrame(() => {
        document
          .querySelector<HTMLButtonElement>(`[data-mini-day="${target}"]`)
          ?.focus()
      })
    } else if (nativeEvent.key === 'PageUp') {
      nativeEvent.preventDefault()
      shiftMonth(-1)
    } else if (nativeEvent.key === 'PageDown') {
      nativeEvent.preventDefault()
      shiftMonth(1)
    }
  }

  const monthLabel = new Date(`${monthPrefix}-15T12:00:00`).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
  })

  return (
    <div className={cn('select-none', className)}>
      {showHeader ? (
        <div className="mb-1.5 flex items-center justify-between gap-1">
          <span className="text-[13px] font-medium text-fg">{monthLabel}</span>
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="iconSm"
              onClick={() => shiftMonth(-1)}
              aria-label="Previous month"
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="ghost"
              size="iconSm"
              onClick={() => shiftMonth(1)}
              aria-label="Next month"
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
      ) : null}

      <div
        role="grid"
        aria-label={monthLabel}
        className="grid gap-y-px"
        style={{
          gridTemplateColumns: showWeekNumbers
            ? '1.25rem repeat(7, minmax(0, 1fr))'
            : 'repeat(7, minmax(0, 1fr))',
        }}
      >
        {showWeekNumbers ? <span /> : null}
        {weekdayLabels.map((label, index) => (
          <span
            key={index}
            role="columnheader"
            className="pb-1 text-center text-[10px] font-medium text-fg-subtle"
          >
            {label}
          </span>
        ))}

        {Array.from({ length: 6 }, (_, row) => {
          const rowKeys = gridKeys.slice(row * 7, row * 7 + 7)
          return (
            <React.Fragment key={row}>
              {showWeekNumbers && rowKeys[0] ? (
                <span className="flex items-center justify-center text-[9px] tabular-nums text-fg-subtle">
                  {isoWeekNumber(rowKeys[0])}
                </span>
              ) : null}
              {rowKeys.map((dayKey) => {
                const isToday = dayKey === today
                const isSelected = dayKey === selectedKey
                const inRange = range.has(dayKey)
                const outside = dayKey.slice(0, 7) !== monthPrefix
                const blocked = minKey !== undefined && dayKey < minKey

                return (
                  <button
                    key={dayKey}
                    data-mini-day={dayKey}
                    role="gridcell"
                    type="button"
                    tabIndex={isSelected || (!selectedKey && isToday) ? 0 : -1}
                    aria-selected={isSelected}
                    aria-current={isToday ? 'date' : undefined}
                    disabled={blocked}
                    onClick={() => onSelect(dayKey)}
                    onKeyDown={(nativeEvent) => handleKeyDown(nativeEvent, dayKey)}
                    className={cn(
                      'relative mx-auto flex size-6 items-center justify-center rounded-md',
                      'text-[11px] tabular-nums transition-colors duration-100',
                      outside ? 'text-fg-subtle' : 'text-fg',
                      inRange && !isSelected && 'bg-accent-soft',
                      isSelected
                        ? 'bg-accent font-medium text-accent-fg'
                        : 'hover:bg-surface-2',
                      isToday && !isSelected && 'font-semibold text-accent',
                      blocked && 'cursor-not-allowed text-fg-subtle opacity-40 hover:bg-transparent',
                    )}
                  >
                    {Number(dayKey.slice(8))}
                    {busyKeys?.has(dayKey) && !isSelected ? (
                      <span
                        aria-hidden="true"
                        className={cn(
                          'absolute bottom-0.5 size-[3px] rounded-full',
                          isToday ? 'bg-accent' : 'bg-fg-subtle',
                        )}
                      />
                    ) : null}
                  </button>
                )
              })}
            </React.Fragment>
          )
        })}
      </div>
    </div>
  )
}
