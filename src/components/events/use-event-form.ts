'use client'

import * as React from 'react'
import {
  addDaysToKey,
  dayKeyOf,
  formatMinutesOfDay,
  systemTimeZone,
  utcToWall,
  wallToUtc,
} from '@/lib/datetime'
import {
  customToRule,
  presetToRule,
  ruleToCustom,
  ruleToPreset,
  type CustomRecurrence,
  type RecurrencePreset,
} from '@/lib/recurrence'
import type {
  CreateEventInput,
  UpdateEventInput,
} from '@/lib/validation/event'
import type { EventDetail, EventDraft } from '@/types/domain'

/**
 * Form state for creating and editing events.
 *
 * The form works in wall-clock strings (`2026-08-31`, `14:30`) because that is
 * what the inputs produce and what the user is thinking in. Conversion to an
 * instant happens once, on submit, through the event's own time zone — so
 * changing the zone in the editor moves the event rather than relabelling it.
 */

export interface GuestEntry {
  email: string
  name?: string
  isOptional?: boolean
  /** Present for guests already on a saved event. */
  response?: string
}

export interface EventFormState {
  title: string
  calendarId: string
  categoryId: string | null
  kind: CreateEventInput['kind']

  startDayKey: string
  startTime: string
  endDayKey: string
  endTime: string
  allDay: boolean
  timezone: string

  location: string
  meetingProvider: CreateEventInput['meetingProvider']
  meetingUrl: string

  guests: GuestEntry[]
  description: string

  reminders: { minutesBefore: number; method: 'APP' | 'EMAIL' | 'PUSH' }[]

  recurrencePreset: RecurrencePreset
  customRecurrence: CustomRecurrence

  transparency: 'BUSY' | 'FREE'
  visibility: 'DEFAULT' | 'PUBLIC' | 'PRIVATE'
  status: 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED'
  color: string | null
  travelTimeMinutes: number | null
  workingLocation: CreateEventInput['workingLocation']
}

export interface EventFormSeed {
  start?: Date
  end?: Date
  allDay?: boolean
  calendarId?: string
  title?: string
  location?: string
  description?: string
  guests?: GuestEntry[]
  timezone?: string
  defaultReminders?: number[]
  kind?: CreateEventInput['kind']
}

const DEFAULT_CUSTOM: CustomRecurrence = {
  frequency: 'WEEKLY',
  interval: 1,
  byWeekday: [],
  monthlyMode: 'byMonthDay',
  end: { type: 'never' },
}

function timeOf(date: Date, timezone: string): string {
  return utcToWall(date, timezone).slice(11, 16)
}

export function blankForm(seed: EventFormSeed = {}): EventFormState {
  const timezone = seed.timezone ?? systemTimeZone()
  const start = seed.start ?? nextHalfHour()
  const end = seed.end ?? new Date(start.getTime() + 30 * 60_000)

  return {
    title: seed.title ?? '',
    calendarId: seed.calendarId ?? '',
    categoryId: null,
    kind: seed.kind ?? 'EVENT',

    startDayKey: dayKeyOf(start, timezone),
    startTime: timeOf(start, timezone),
    // An all-day event's exclusive end is stored as the next midnight; the form
    // shows the last day the user actually means.
    endDayKey: seed.allDay
      ? dayKeyOf(new Date(end.getTime() - 1), timezone)
      : dayKeyOf(end, timezone),
    endTime: timeOf(end, timezone),
    allDay: seed.allDay ?? false,
    timezone,

    location: seed.location ?? '',
    meetingProvider: 'NONE',
    meetingUrl: '',

    guests: seed.guests ?? [],
    description: seed.description ?? '',

    reminders: (seed.defaultReminders ?? []).map((minutesBefore) => ({
      minutesBefore,
      method: 'APP' as const,
    })),

    recurrencePreset: 'none',
    customRecurrence: DEFAULT_CUSTOM,

    transparency: 'BUSY',
    visibility: 'DEFAULT',
    status: 'CONFIRMED',
    color: null,
    travelTimeMinutes: null,
    workingLocation: 'UNSPECIFIED',
  }
}

/** Loads a saved event back into the form. */
export function formFromEvent(event: EventDetail): EventFormState {
  const timezone = event.timezone
  const start = new Date(event.start)
  const end = new Date(event.end)

  return {
    title: event.title,
    calendarId: event.calendarId,
    categoryId: event.categoryId,
    kind: event.kind,

    startDayKey: dayKeyOf(start, timezone),
    startTime: timeOf(start, timezone),
    endDayKey: event.allDay
      ? dayKeyOf(new Date(end.getTime() - 1), timezone)
      : dayKeyOf(end, timezone),
    endTime: timeOf(end, timezone),
    allDay: event.allDay,
    timezone,

    location: event.location ?? '',
    meetingProvider: event.meetingProvider,
    meetingUrl: event.meetingUrl ?? '',

    guests: event.attendees.map((attendee) => ({
      email: attendee.email,
      name: attendee.name ?? undefined,
      isOptional: attendee.isOptional,
      response: attendee.response,
    })),
    description: event.description ?? '',

    reminders: event.reminders.map((reminder) => ({
      minutesBefore: reminder.minutesBefore,
      method: reminder.method,
    })),

    recurrencePreset: ruleToPreset(event.recurrenceRule),
    customRecurrence: ruleToCustom(event.recurrenceRule ?? '') ?? DEFAULT_CUSTOM,

    transparency: event.transparency,
    visibility: event.visibility,
    status: event.status,
    color: event.color === event.calendarColor ? null : event.color,
    travelTimeMinutes: event.travelTimeMinutes,
    workingLocation: event.workingLocation,
  }
}

/** Applies a parsed draft (natural language, or an email) over the form. */
export function applyDraft(
  state: EventFormState,
  draft: EventDraft,
  timezone: string,
): EventFormState {
  const next = { ...state, title: draft.title || state.title }

  if (draft.start) {
    const start = new Date(draft.start)
    next.startDayKey = dayKeyOf(start, timezone)
    next.startTime = timeOf(start, timezone)
  }
  if (draft.end) {
    const end = new Date(draft.end)
    next.endDayKey = dayKeyOf(end, timezone)
    next.endTime = timeOf(end, timezone)
  }
  if (draft.allDay !== undefined) next.allDay = draft.allDay
  if (draft.location) next.location = draft.location
  if (draft.description) next.description = draft.description
  if (draft.meetingUrl) {
    next.meetingUrl = draft.meetingUrl
    next.meetingProvider = 'CUSTOM'
  }
  if (draft.participants?.length) {
    const existing = new Set(next.guests.map((guest) => guest.email.toLowerCase()))
    next.guests = [
      ...next.guests,
      ...draft.participants
        .filter((participant) => participant.email)
        .filter((participant) => !existing.has(participant.email!.toLowerCase()))
        .map((participant) => ({ email: participant.email!, name: participant.name })),
    ]
  }
  return next
}

export interface FormErrors {
  title?: string
  calendarId?: string
  end?: string
  meetingUrl?: string
  guests?: string
}

export function validate(state: EventFormState): FormErrors {
  const errors: FormErrors = {}

  if (!state.title.trim()) errors.title = 'Give the event a title'
  if (!state.calendarId) errors.calendarId = 'Pick a calendar'

  const { start, end } = toInstants(state)
  if (end <= start) errors.end = 'The end must be after the start'

  if (state.meetingProvider === 'CUSTOM' && state.meetingUrl) {
    try {
      new URL(state.meetingUrl)
    } catch {
      errors.meetingUrl = 'Enter a full link, including https://'
    }
  }

  const invalidGuest = state.guests.find(
    (guest) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(guest.email),
  )
  if (invalidGuest) errors.guests = `"${invalidGuest.email}" is not a valid address`

  return errors
}

/** Wall clock -> instants, the single place the conversion happens. */
export function toInstants(state: EventFormState): { start: Date; end: Date } {
  if (state.allDay) {
    return {
      start: wallToUtc(`${state.startDayKey}T00:00`, state.timezone),
      // Exclusive end: the day after the last day the user selected.
      end: wallToUtc(`${addDaysToKey(state.endDayKey, 1)}T00:00`, state.timezone),
    }
  }
  return {
    start: wallToUtc(`${state.startDayKey}T${state.startTime}`, state.timezone),
    end: wallToUtc(`${state.endDayKey}T${state.endTime}`, state.timezone),
  }
}

export function toCreateInput(state: EventFormState): CreateEventInput {
  const { start, end } = toInstants(state)
  const rule =
    state.recurrencePreset === 'custom'
      ? customToRule(state.customRecurrence, start, state.timezone)
      : presetToRule(state.recurrencePreset, start, state.timezone)

  return {
    title: state.title.trim(),
    description: state.description.trim() || null,
    location: state.location.trim() || null,
    locationData: null,
    calendarId: state.calendarId,
    start: start.toISOString(),
    end: end.toISOString(),
    timezone: state.timezone,
    allDay: state.allDay,
    kind: state.kind,
    status: state.status,
    visibility: state.visibility,
    transparency: state.transparency,
    meetingProvider: state.meetingProvider,
    meetingUrl: state.meetingUrl.trim() || null,
    color: state.color,
    categoryId: state.categoryId,
    workingLocation: state.workingLocation,
    travelTimeMinutes: state.travelTimeMinutes,
    recurrenceRule: rule,
    attendees: state.guests.map((guest) => ({
      email: guest.email.trim().toLowerCase(),
      name: guest.name,
      isOptional: guest.isOptional,
    })),
    reminders: state.reminders,
    taskId: null,
  }
}

export function toUpdateInput(
  state: EventFormState,
  scope: 'this' | 'following' | 'all',
  occurrenceStart?: string,
): UpdateEventInput {
  const create = toCreateInput(state)
  return {
    ...create,
    description: create.description,
    scope,
    occurrenceStart,
  }
}

/* --------------------------------------------------------------- helpers */

function nextHalfHour(): Date {
  const now = new Date()
  const ms = 30 * 60_000
  return new Date(Math.ceil(now.getTime() / ms) * ms)
}

/** Time options for the start/end dropdowns, every 15 minutes. */
export function timeOptions(use24h: boolean): { value: string; label: string }[] {
  return Array.from({ length: 96 }, (_, index) => {
    const minutes = index * 15
    const hh = String(Math.floor(minutes / 60)).padStart(2, '0')
    const mm = String(minutes % 60).padStart(2, '0')
    return { value: `${hh}:${mm}`, label: formatMinutesOfDay(minutes, use24h) }
  })
}

/**
 * Keeps the end after the start while the user edits the start — the duration
 * is preserved rather than the end time, which is what people expect when they
 * push a meeting an hour later.
 */
export function shiftEndWithStart(
  state: EventFormState,
  nextStartDayKey: string,
  nextStartTime: string,
): EventFormState {
  const previous = toInstants(state)
  const durationMs = previous.end.getTime() - previous.start.getTime()

  const start = wallToUtc(`${nextStartDayKey}T${nextStartTime}`, state.timezone)
  const end = new Date(start.getTime() + Math.max(durationMs, 0))

  return {
    ...state,
    startDayKey: nextStartDayKey,
    startTime: nextStartTime,
    endDayKey: state.allDay
      ? state.endDayKey < nextStartDayKey
        ? nextStartDayKey
        : state.endDayKey
      : dayKeyOf(end, state.timezone),
    endTime: state.allDay ? state.endTime : timeOf(end, state.timezone),
  }
}

export function useEventForm(seed: EventFormSeed = {}) {
  const [state, setState] = React.useState(() => blankForm(seed))
  const [errors, setErrors] = React.useState<FormErrors>({})

  const update = React.useCallback(
    (patch: Partial<EventFormState> | ((prev: EventFormState) => EventFormState)) => {
      setState((prev) =>
        typeof patch === 'function' ? patch(prev) : { ...prev, ...patch },
      )
    },
    [],
  )

  const check = React.useCallback(() => {
    const found = validate(state)
    setErrors(found)
    return Object.keys(found).length === 0
  }, [state])

  return { state, setState, update, errors, setErrors, check }
}
