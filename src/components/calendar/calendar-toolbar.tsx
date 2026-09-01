'use client'

import * as React from 'react'
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Filter,
  Plus,
  RefreshCw,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { SegmentedControl, Tooltip, Checkbox } from '@/components/ui/controls'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/overlay'
import { Badge, ColorDot } from '@/components/ui/primitives'
import { MiniCalendar } from './mini-calendar'
import { NotificationBell } from '@/components/layout/notification-bell'
import { useCalendar, VIEW_MODES } from './calendar-context'
import type { CalendarViewMode } from '@/types/domain'

const VIEW_LABELS: Record<CalendarViewMode, { label: string; short: string; key: string }> = {
  day: { label: 'Day', short: 'D', key: 'D' },
  'three-day': { label: '3 days', short: '3', key: '3' },
  'work-week': { label: 'Work week', short: 'WW', key: 'X' },
  week: { label: 'Week', short: 'W', key: 'W' },
  month: { label: 'Month', short: 'M', key: 'M' },
  year: { label: 'Year', short: 'Y', key: 'Y' },
  agenda: { label: 'Agenda', short: 'A', key: 'A' },
}

/** Views that fit on a narrow screen; the rest move into the overflow menu. */
const COMPACT_VIEWS: CalendarViewMode[] = ['day', 'week', 'month']

export function CalendarToolbar({
  onCreate,
  onSync,
  syncing,
}: {
  onCreate: () => void
  onSync?: () => void
  syncing?: boolean
}) {
  const {
    view,
    setView,
    step,
    goToday,
    rangeLabel,
    anchorKey,
    setAnchor,
    prefs,
    dayKeys,
    calendars,
    toggleCalendar,
    loading,
  } = useCalendar()

  const hiddenCount = calendars.filter((calendar) => !calendar.isVisible).length

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface px-3 py-2 sm:px-4">
      <Button variant="secondary" size="md" onClick={goToday}>
        Today
      </Button>

      <div className="flex items-center">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => step(-1)}
          aria-label="Previous period"
        >
          <ChevronLeft />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => step(1)}
          aria-label="Next period"
        >
          <ChevronRight />
        </Button>
      </div>

      {/* The range label is also the date picker — one control, two jobs. */}
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              'flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors',
              'hover:bg-surface-2',
            )}
          >
            <h1 className="truncate text-[15px] font-semibold tracking-[-0.01em] text-fg">
              {rangeLabel}
            </h1>
            <CalendarDays className="size-3.5 shrink-0 text-fg-subtle" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-64">
          <MiniCalendar
            monthKey={`${anchorKey.slice(0, 7)}-01`}
            selectedKey={anchorKey}
            rangeKeys={dayKeys}
            weekStartsOn={prefs.weekStartsOn}
            timezone={prefs.timezone}
            showWeekNumbers={prefs.showWeekNumbers}
            onSelect={setAnchor}
            onMonthChange={setAnchor}
          />
        </PopoverContent>
      </Popover>

      {loading ? (
        <span className="sr-only" role="status">
          Loading events
        </span>
      ) : null}

      <div className="ml-auto flex items-center gap-1.5">
        <NotificationBell />

        {/* Calendar filter. Shows how many are hidden so a "missing" event has
            an obvious explanation rather than looking like data loss. */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Filter calendars">
              <Filter />
              {hiddenCount > 0 ? (
                <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-accent" />
              ) : null}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-60 p-2">
            <p className="px-1 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
              Calendars
            </p>
            <ul className="space-y-px">
              {calendars.map((calendar) => (
                <li key={calendar.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 transition-colors hover:bg-surface-2">
                    <Checkbox
                      checked={calendar.isVisible}
                      onCheckedChange={(checked) =>
                        toggleCalendar(calendar.id, checked === true)
                      }
                      style={
                        {
                          '--accent': calendar.color,
                        } as React.CSSProperties
                      }
                    />
                    <ColorDot color={calendar.color} />
                    <span className="min-w-0 flex-1 truncate text-[13px] text-fg">
                      {calendar.name}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            {hiddenCount > 0 ? (
              <p className="px-1.5 pt-2 text-[11px] text-fg-subtle">
                {hiddenCount} calendar{hiddenCount === 1 ? '' : 's'} hidden.
              </p>
            ) : null}
          </PopoverContent>
        </Popover>

        {onSync ? (
          <Tooltip content="Sync connected calendars">
            <Button
              variant="ghost"
              size="icon"
              onClick={onSync}
              disabled={syncing}
              aria-label="Sync connected calendars"
            >
              <RefreshCw className={cn(syncing && 'animate-spin')} />
            </Button>
          </Tooltip>
        ) : null}

        {/* Full switcher on desktop, three essentials on a phone. */}
        <SegmentedControl
          className="hidden md:inline-flex"
          label="Calendar view"
          value={view}
          onValueChange={setView}
          options={VIEW_MODES.map((mode) => ({
            value: mode,
            label: VIEW_LABELS[mode].label,
            hint: `Press ${VIEW_LABELS[mode].key}`,
          }))}
        />
        <SegmentedControl
          className="md:hidden"
          size="sm"
          label="Calendar view"
          value={COMPACT_VIEWS.includes(view) ? view : 'day'}
          onValueChange={setView}
          options={COMPACT_VIEWS.map((mode) => ({
            value: mode,
            label: VIEW_LABELS[mode].short,
          }))}
        />

        <Button variant="primary" size="md" onClick={onCreate} className="gap-1">
          <Plus />
          <span className="hidden sm:inline">Create</span>
          <span className="sr-only sm:hidden">Create event</span>
        </Button>
      </div>
    </div>
  )
}

export { VIEW_LABELS }
export type { CalendarViewMode }
export { Badge }
