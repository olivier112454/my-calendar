'use client'

import * as React from 'react'
import { CalendarDays } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatDayLabel, todayKey } from '@/lib/datetime'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/overlay'
import { useAppShell } from '@/components/layout/app-shell-context'
import { MiniCalendar } from './mini-calendar'

/**
 * A day field.
 *
 * The forms used `<input type="date">`, which meant the one control in the app
 * that is entirely about dates was drawn by the browser: its own icon, its own
 * calendar, its own idea of which day the week starts on — none of which follow
 * the settings this app already keeps. It also showed the day in the browser's
 * locale rather than the format chosen in Settings, so the same date read two
 * ways on one screen.
 *
 * This is the app's own month grid in a popover instead. `MiniCalendar` already
 * handles the keyboard properly, so the field keeps arrow-key navigation rather
 * than trading it away for the styling.
 *
 * The value stays a plain `YYYY-MM-DD` day key, so callers are unchanged.
 */
export function DatePicker({
  id,
  value,
  onChange,
  min,
  disabled,
  className,
  'aria-label': label,
  'aria-describedby': describedBy,
}: {
  id?: string
  /** Day key, `YYYY-MM-DD`. */
  value: string
  onChange: (dayKey: string) => void
  /** Earliest selectable day, as a day key. */
  min?: string
  disabled?: boolean
  className?: string
  /** Needed where no visible <label> points at the field. */
  'aria-label'?: string
  'aria-describedby'?: string
}) {
  const { weekStartsOn, timezone } = useAppShell()
  const [open, setOpen] = React.useState(false)
  // The month on show is local to the popover: paging through it to look at
  // April should not change what the field is set to.
  const [monthKey, setMonthKey] = React.useState(value)

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        // Opening starts on the month of the current value, so paging away and
        // closing does not leave the popover somewhere else next time.
        if (next) setMonthKey(value || todayKey(timezone))
        setOpen(next)
      }}
    >
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          disabled={disabled}
          aria-label={label}
          aria-describedby={describedBy}
          className={cn(
            'flex h-8 w-full items-center gap-2 rounded-md border border-border bg-surface px-2.5 text-left text-sm text-fg',
            'transition-colors duration-150 hover:border-border-strong',
            'focus:outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent-soft',
            'disabled:cursor-not-allowed disabled:bg-surface-2 disabled:opacity-60',
            className,
          )}
        >
          <CalendarDays className="size-4 shrink-0 text-fg-subtle" aria-hidden="true" />
          <span className="truncate">
            {value ? formatDayLabel(value, 'EEE d MMM yyyy') : 'Pick a date'}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2">
        <MiniCalendar
          monthKey={monthKey}
          selectedKey={value}
          weekStartsOn={weekStartsOn}
          timezone={timezone}
          onMonthChange={setMonthKey}
          minKey={min}
          onSelect={(dayKey) => {
            onChange(dayKey)
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
