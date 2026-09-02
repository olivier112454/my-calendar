'use client'

import * as React from 'react'
import { Bell, Plus, Repeat, X } from 'lucide-react'
import { cn, initials } from '@/lib/utils'
import { addDaysToKey, formatDayLabel } from '@/lib/datetime'
import { calendarPalette, reminderPresets } from '@/config/app'
import {
  WEEKDAY_CODES,
  describeRule,
  type CustomRecurrence,
  type RecurrencePreset,
  type WeekdayCode,
} from '@/lib/recurrence'
import type { CalendarSummary, CategorySummary } from '@/types/domain'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/calendar/date-picker'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from '@/components/ui/controls'
import { Badge, ColorDot, Field, Label } from '@/components/ui/primitives'
import { timeOptions, type EventFormState, type GuestEntry } from './use-event-form'

/* ------------------------------------------------------------- calendars */

export function CalendarSelect({
  calendars,
  value,
  onChange,
  error,
  id = 'calendar',
}: {
  calendars: CalendarSummary[]
  value: string
  onChange: (calendarId: string) => void
  error?: string
  id?: string
}) {
  // Read-only calendars are listed but disabled rather than hidden: leaving
  // them out entirely makes "why can't I pick Holidays?" a mystery.
  const ordered = [...calendars].sort(
    (a, b) => Number(a.isReadOnly) - Number(b.isReadOnly),
  )

  return (
    <Field label="Calendar" htmlFor={id} error={error}>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id}>
          <SelectValue placeholder="Pick a calendar" />
        </SelectTrigger>
        <SelectContent>
          {ordered.map((calendar) => (
            <SelectItem
              key={calendar.id}
              value={calendar.id}
              disabled={calendar.isReadOnly}
            >
              <span className="flex items-center gap-2">
                <ColorDot color={calendar.color} />
                <span className="truncate">{calendar.name}</span>
                {calendar.isReadOnly ? (
                  <span className="text-[11px] text-fg-subtle">read-only</span>
                ) : null}
                {calendar.accountEmail ? (
                  <span className="truncate text-[11px] text-fg-subtle">
                    {calendar.accountEmail}
                  </span>
                ) : null}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}

/* ------------------------------------------------------------ categories */

/** The value Radix carries for "no category"; Select cannot hold an empty one. */
const NO_CATEGORY = 'none'

export function CategorySelect({
  categories,
  value,
  onChange,
  id = 'category',
}: {
  categories: CategorySummary[]
  value: string | null
  onChange: (categoryId: string | null) => void
  id?: string
}) {
  // Nothing to choose from means nothing to show — an empty dropdown is worse
  // than no dropdown.
  if (categories.length === 0) return null

  return (
    <Field
      label="Category"
      htmlFor={id}
      hint="What this is about. Analytics groups your time by it."
    >
      <Select
        value={value ?? NO_CATEGORY}
        onValueChange={(next) => onChange(next === NO_CATEGORY ? null : next)}
      >
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_CATEGORY}>
            <span className="text-fg-muted">No category</span>
          </SelectItem>
          {categories.map((category) => (
            <SelectItem key={category.id} value={category.id}>
              <span className="flex items-center gap-2">
                <ColorDot color={category.color} />
                <span className="truncate">{category.name}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}

/* --------------------------------------------------------- date and time */

export function DateTimeFields({
  state,
  onChange,
  use24h,
  error,
}: {
  state: EventFormState
  onChange: (patch: Partial<EventFormState>) => void
  use24h: boolean
  error?: string
}) {
  const options = React.useMemo(() => timeOptions(use24h), [use24h])

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Starts" htmlFor="start-date" className="min-w-[8.5rem] flex-1">
          <DatePicker
            id="start-date"
            value={state.startDayKey}
            onChange={(startDayKey) => onChange({ startDayKey })}
          />
        </Field>
        {!state.allDay ? (
          <div className="w-[6.5rem]">
            <Label htmlFor="start-time" className="sr-only">
              Start time
            </Label>
            <Select
              value={state.startTime}
              onValueChange={(startTime) => onChange({ startTime })}
            >
              <SelectTrigger id="start-time">
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
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <Field label="Ends" htmlFor="end-date" className="min-w-[8.5rem] flex-1" error={error}>
          <DatePicker
            id="end-date"
            min={state.startDayKey}
            value={state.endDayKey}
            onChange={(endDayKey) => onChange({ endDayKey })}
          />
        </Field>
        {!state.allDay ? (
          <div className="w-[6.5rem]">
            <Label htmlFor="end-time" className="sr-only">
              End time
            </Label>
            <Select value={state.endTime} onValueChange={(endTime) => onChange({ endTime })}>
              <SelectTrigger id="end-time">
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
          </div>
        ) : null}
      </div>

      <label className="flex w-fit cursor-pointer items-center gap-2 pt-0.5">
        <Switch
          checked={state.allDay}
          onCheckedChange={(allDay) =>
            onChange({
              allDay,
              // Coming out of all-day, a same-day event would otherwise end at
              // the moment it starts.
              endDayKey: allDay
                ? state.endDayKey
                : state.endDayKey < state.startDayKey
                  ? state.startDayKey
                  : state.endDayKey,
            })
          }
        />
        <span className="text-[13px] text-fg">All day</span>
      </label>
    </div>
  )
}

/* ------------------------------------------------------------- recurrence */

const PRESET_OPTIONS: { value: RecurrencePreset; label: string }[] = [
  { value: 'none', label: 'Does not repeat' },
  { value: 'daily', label: 'Every day' },
  { value: 'weekdays', label: 'Every weekday' },
  { value: 'weekly', label: 'Every week' },
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'monthly', label: 'Every month' },
  { value: 'yearly', label: 'Every year' },
  { value: 'custom', label: 'Custom…' },
]

export function RecurrenceField({
  preset,
  custom,
  onPresetChange,
  onCustomChange,
  summary,
}: {
  preset: RecurrencePreset
  custom: CustomRecurrence
  onPresetChange: (preset: RecurrencePreset) => void
  onCustomChange: (custom: CustomRecurrence) => void
  summary?: string | null
}) {
  return (
    <Field label="Repeat" htmlFor="repeat">
      <Select
        value={preset}
        onValueChange={(next) => onPresetChange(next as RecurrencePreset)}
      >
        <SelectTrigger id="repeat">
          <span className="flex items-center gap-2 truncate">
            <Repeat className="size-3.5 shrink-0 text-fg-subtle" aria-hidden="true" />
            <SelectValue />
          </span>
        </SelectTrigger>
        <SelectContent>
          {PRESET_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {preset === 'custom' ? (
        <CustomRecurrenceEditor value={custom} onChange={onCustomChange} />
      ) : null}

      {summary && preset !== 'none' ? (
        <p className="text-xs text-fg-subtle">{summary}</p>
      ) : null}
    </Field>
  )
}

function CustomRecurrenceEditor({
  value,
  onChange,
}: {
  value: CustomRecurrence
  onChange: (custom: CustomRecurrence) => void
}) {
  const toggleWeekday = (code: WeekdayCode) => {
    const current = value.byWeekday ?? []
    onChange({
      ...value,
      byWeekday: current.includes(code)
        ? current.filter((entry) => entry !== code)
        : [...current, code],
    })
  }

  return (
    <div className="mt-2 space-y-3 rounded-lg border border-border bg-surface-2 p-3">
      <div className="flex items-center gap-2">
        <span className="text-[13px] text-fg-muted">Every</span>
        <Input
          type="number"
          min={1}
          max={99}
          value={value.interval}
          onChange={(nativeEvent) =>
            onChange({ ...value, interval: Math.max(1, Number(nativeEvent.target.value)) })
          }
          className="w-16"
          aria-label="Repeat interval"
        />
        <Select
          value={value.frequency}
          onValueChange={(frequency) =>
            onChange({ ...value, frequency: frequency as CustomRecurrence['frequency'] })
          }
        >
          <SelectTrigger className="w-32" aria-label="Repeat unit">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="DAILY">{value.interval === 1 ? 'day' : 'days'}</SelectItem>
            <SelectItem value="WEEKLY">
              {value.interval === 1 ? 'week' : 'weeks'}
            </SelectItem>
            <SelectItem value="MONTHLY">
              {value.interval === 1 ? 'month' : 'months'}
            </SelectItem>
            <SelectItem value="YEARLY">
              {value.interval === 1 ? 'year' : 'years'}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {value.frequency === 'WEEKLY' ? (
        <div className="space-y-1.5">
          <Label>On</Label>
          <div className="flex flex-wrap gap-1">
            {/* Monday first, matching how a working week is read. */}
            {(['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as WeekdayCode[]).map((code) => {
              const active = value.byWeekday?.includes(code)
              return (
                <button
                  key={code}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleWeekday(code)}
                  className={cn(
                    'size-7 rounded-md text-[11px] font-medium transition-colors',
                    active
                      ? 'bg-accent text-accent-fg'
                      : 'bg-surface text-fg-muted hover:bg-surface-3',
                  )}
                >
                  {code[0]}
                  {code === 'TH' || code === 'SU' ? code[1]?.toLowerCase() : ''}
                </button>
              )
            })}
          </div>
        </div>
      ) : null}

      {value.frequency === 'MONTHLY' ? (
        <Select
          value={value.monthlyMode ?? 'byMonthDay'}
          onValueChange={(mode) =>
            onChange({ ...value, monthlyMode: mode as CustomRecurrence['monthlyMode'] })
          }
        >
          <SelectTrigger aria-label="Monthly pattern">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="byMonthDay">On the same date</SelectItem>
            <SelectItem value="byWeekday">On the same weekday</SelectItem>
          </SelectContent>
        </Select>
      ) : null}

      <div className="space-y-1.5">
        <Label>Ends</Label>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={value.end?.type ?? 'never'}
            onValueChange={(type) => {
              if (type === 'never') onChange({ ...value, end: { type: 'never' } })
              else if (type === 'count')
                onChange({ ...value, end: { type: 'count', count: 10 } })
              else
                onChange({
                  ...value,
                  end: { type: 'until', date: addDaysToKey(todayString(), 90) },
                })
            }}
          >
            <SelectTrigger className="w-32" aria-label="Repeat end condition">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="never">Never</SelectItem>
              <SelectItem value="until">On date</SelectItem>
              <SelectItem value="count">After</SelectItem>
            </SelectContent>
          </Select>

          {value.end?.type === 'until' ? (
            <DatePicker
              value={value.end.date}
              onChange={(date) => onChange({ ...value, end: { type: 'until', date } })}
              className="w-44"
              aria-label="Repeat until"
            />
          ) : null}

          {value.end?.type === 'count' ? (
            <span className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                max={999}
                value={value.end.count}
                onChange={(nativeEvent) =>
                  onChange({
                    ...value,
                    end: { type: 'count', count: Math.max(1, Number(nativeEvent.target.value)) },
                  })
                }
                className="w-20"
                aria-label="Number of occurrences"
              />
              <span className="text-[13px] text-fg-muted">times</span>
            </span>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function todayString() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`
}

/* ----------------------------------------------------------------- guests */

export function GuestsField({
  guests,
  onChange,
  suggestions = [],
  error,
}: {
  guests: GuestEntry[]
  onChange: (guests: GuestEntry[]) => void
  suggestions?: { name: string; email: string; avatarUrl?: string | null }[]
  error?: string
}) {
  const [draft, setDraft] = React.useState('')
  const listId = React.useId()

  const add = (raw: string) => {
    const email = raw.trim().toLowerCase()
    if (!email) return
    if (guests.some((guest) => guest.email.toLowerCase() === email)) {
      setDraft('')
      return
    }
    const match = suggestions.find((entry) => entry.email.toLowerCase() === email)
    onChange([...guests, { email, name: match?.name }])
    setDraft('')
  }

  return (
    <Field label="Guests" htmlFor="guest-input" error={error}>
      <Input
        id="guest-input"
        type="email"
        list={listId}
        placeholder="Add people by email"
        value={draft}
        onChange={(nativeEvent) => setDraft(nativeEvent.target.value)}
        onKeyDown={(nativeEvent) => {
          // Enter and comma both commit — people type both.
          if (nativeEvent.key === 'Enter' || nativeEvent.key === ',') {
            nativeEvent.preventDefault()
            add(draft)
          } else if (nativeEvent.key === 'Backspace' && !draft && guests.length) {
            onChange(guests.slice(0, -1))
          }
        }}
        onBlur={() => add(draft)}
      />
      <datalist id={listId}>
        {suggestions.map((entry) => (
          <option key={entry.email} value={entry.email}>
            {entry.name}
          </option>
        ))}
      </datalist>

      {guests.length > 0 ? (
        <ul className="mt-1.5 space-y-1">
          {guests.map((guest) => (
            <li
              key={guest.email}
              className="flex items-center gap-2 rounded-md bg-surface-2 px-2 py-1.5"
            >
              <span
                aria-hidden="true"
                className="flex size-5 shrink-0 items-center justify-center rounded-full bg-surface text-[9px] font-medium text-fg-muted"
              >
                {initials(guest.name ?? guest.email)}
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px] text-fg">
                {guest.name ? (
                  <>
                    {guest.name}{' '}
                    <span className="text-fg-subtle">{guest.email}</span>
                  </>
                ) : (
                  guest.email
                )}
              </span>
              {guest.response && guest.response !== 'NEEDS_ACTION' ? (
                <Badge
                  tone={
                    guest.response === 'ACCEPTED'
                      ? 'success'
                      : guest.response === 'DECLINED'
                        ? 'danger'
                        : 'warning'
                  }
                >
                  {guest.response === 'ACCEPTED'
                    ? 'Yes'
                    : guest.response === 'DECLINED'
                      ? 'No'
                      : 'Maybe'}
                </Badge>
              ) : null}
              <Button
                variant="ghost"
                size="iconSm"
                aria-label={`Remove ${guest.email}`}
                onClick={() =>
                  onChange(guests.filter((entry) => entry.email !== guest.email))
                }
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </Field>
  )
}

/* -------------------------------------------------------------- reminders */

export function RemindersField({
  reminders,
  onChange,
}: {
  reminders: EventFormState['reminders']
  onChange: (reminders: EventFormState['reminders']) => void
}) {
  return (
    <Field label="Reminders">
      <div className="space-y-1.5">
        {reminders.map((reminder, index) => (
          <div key={index} className="flex items-center gap-2">
            <Bell className="size-3.5 shrink-0 text-fg-subtle" aria-hidden="true" />
            <Select
              value={String(reminder.minutesBefore)}
              onValueChange={(minutes) =>
                onChange(
                  reminders.map((entry, position) =>
                    position === index
                      ? { ...entry, minutesBefore: Number(minutes) }
                      : entry,
                  ),
                )
              }
            >
              <SelectTrigger className="flex-1" aria-label="Reminder time">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {reminderPresets.map((preset) => (
                  <SelectItem key={preset.minutes} value={String(preset.minutes)}>
                    {preset.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={reminder.method}
              onValueChange={(method) =>
                onChange(
                  reminders.map((entry, position) =>
                    position === index
                      ? { ...entry, method: method as 'APP' | 'EMAIL' | 'PUSH' }
                      : entry,
                  ),
                )
              }
            >
              <SelectTrigger className="w-28" aria-label="Reminder method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="APP">In app</SelectItem>
                <SelectItem value="PUSH">Notification</SelectItem>
                <SelectItem value="EMAIL">Email</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="iconSm"
              aria-label="Remove reminder"
              onClick={() =>
                onChange(reminders.filter((_, position) => position !== index))
              }
            >
              <X />
            </Button>
          </div>
        ))}

        {reminders.length < 5 ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              onChange([...reminders, { minutesBefore: 10, method: 'APP' }])
            }
          >
            <Plus />
            Add reminder
          </Button>
        ) : null}
      </div>
    </Field>
  )
}

/* ------------------------------------------------------------------ colour */

export function ColorField({
  value,
  calendarColor,
  onChange,
}: {
  value: string | null
  calendarColor: string
  onChange: (color: string | null) => void
}) {
  return (
    <Field label="Colour">
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-pressed={value === null}
          aria-label="Use the calendar's colour"
          title="Calendar colour"
          className={cn(
            'flex size-6 items-center justify-center rounded-full border-2 transition-transform',
            value === null ? 'border-fg' : 'border-transparent hover:scale-110',
          )}
        >
          <span
            className="size-4 rounded-full"
            style={{ backgroundColor: calendarColor }}
          />
        </button>
        {calendarPalette.map((entry) => (
          <button
            key={entry.value}
            type="button"
            onClick={() => onChange(entry.value)}
            aria-pressed={value === entry.value}
            aria-label={entry.name}
            title={entry.name}
            className={cn(
              'flex size-6 items-center justify-center rounded-full border-2 transition-transform',
              value === entry.value ? 'border-fg' : 'border-transparent hover:scale-110',
            )}
          >
            <span className="size-4 rounded-full" style={{ backgroundColor: entry.value }} />
          </button>
        ))}
      </div>
    </Field>
  )
}

export { describeRule, formatDayLabel, WEEKDAY_CODES }
