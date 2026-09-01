'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import { formatMinutesOfDay } from '@/lib/datetime'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './controls'

/**
 * A time picker built from the app's own select.
 *
 * Replaces `<input type="time">`, which the browser renders with its own
 * dropdown that stays open after you pick a value — so choosing 23:00 takes two
 * clicks: one to choose, one to dismiss. This closes on selection, like every
 * other menu in the app, and it looks the same in every browser.
 *
 * It also honours the 12/24-hour preference, which the native control takes
 * from the operating system regardless of what the user set here.
 */

export interface TimeSelectProps {
  /** 24-hour "HH:mm". */
  value: string
  onChange: (value: string) => void
  use24h?: boolean
  /** Minutes between options. */
  step?: number
  /** Hides options at or before this time — used to keep an end after a start. */
  minTime?: string
  id?: string
  className?: string
  'aria-label'?: string
  disabled?: boolean
}

export function TimeSelect({
  value,
  onChange,
  use24h = true,
  step = 15,
  minTime,
  id,
  className,
  disabled,
  'aria-label': ariaLabel,
}: TimeSelectProps) {
  const options = React.useMemo(() => {
    const floor = minTime ? toMinutes(minTime) : -1
    const out: { value: string; label: string }[] = []

    for (let minutes = 0; minutes < 1440; minutes += step) {
      if (minutes <= floor) continue
      out.push({ value: toClock(minutes), label: formatMinutesOfDay(minutes, use24h) })
    }

    // A value that is not on the grid — imported data, or a changed step — must
    // still be selectable, or the control would silently show the wrong time.
    if (value && !out.some((option) => option.value === value)) {
      out.push({ value, label: formatMinutesOfDay(toMinutes(value), use24h) })
      out.sort((a, b) => toMinutes(a.value) - toMinutes(b.value))
    }

    return out
  }, [step, use24h, minTime, value])

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} aria-label={ariaLabel} className={cn('w-28', className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function toMinutes(clock: string): number {
  const [hours, minutes] = clock.split(':').map(Number)
  return (hours ?? 0) * 60 + (minutes ?? 0)
}

function toClock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(
    minutes % 60,
  ).padStart(2, '0')}`
}
