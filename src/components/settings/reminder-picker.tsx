'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import { reminderPresets } from '@/config/app'
import { Checkbox } from '@/components/ui/controls'

/**
 * Picks the reminders added to every new event.
 *
 * Multi-select, because the useful pattern is a pair: one far enough ahead to
 * act on ("the day before") and one close enough to move for ("ten minutes").
 * A single dropdown forces a choice between those two jobs.
 *
 * Capped at five, which is also Google's limit — beyond that reminders stop
 * being a prompt and become noise.
 */

const MAX_REMINDERS = 5

export function ReminderPicker({
  value,
  onChange,
  idPrefix = 'reminder',
}: {
  value: number[]
  onChange: (minutes: number[]) => void
  idPrefix?: string
}) {
  const atLimit = value.length >= MAX_REMINDERS

  const toggle = (minutes: number, checked: boolean) => {
    const next = checked
      ? [...value, minutes]
      : value.filter((entry) => entry !== minutes)
    // Kept in order of when they fire, so the list always reads chronologically.
    onChange([...new Set(next)].sort((a, b) => b - a))
  }

  return (
    <div className="space-y-2">
      <ul className="grid grid-cols-1 gap-x-4 gap-y-0.5 sm:grid-cols-2">
        {reminderPresets.map((preset) => {
          const checked = value.includes(preset.minutes)
          const disabled = !checked && atLimit
          const id = `${idPrefix}-${preset.minutes}`

          return (
            <li key={preset.minutes}>
              <label
                htmlFor={id}
                className={cn(
                  'flex items-center gap-2.5 rounded-md px-1.5 py-1.5 transition-colors',
                  disabled
                    ? 'cursor-not-allowed opacity-45'
                    : 'cursor-pointer hover:bg-surface-2',
                )}
              >
                <Checkbox
                  id={id}
                  checked={checked}
                  disabled={disabled}
                  onCheckedChange={(next) => toggle(preset.minutes, next === true)}
                />
                <span className="text-[13px] text-fg">{preset.label}</span>
              </label>
            </li>
          )
        })}
      </ul>

      <p className="px-1.5 text-xs text-fg-subtle">
        {value.length === 0
          ? 'New events get no reminder. You can still add one per event.'
          : atLimit
            ? `${value.length} of ${MAX_REMINDERS} — untick one to choose another.`
            : `${value.length} selected. Added to every new event; you can change it per event.`}
      </p>
    </div>
  )
}
