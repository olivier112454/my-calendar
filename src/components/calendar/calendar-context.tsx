'use client'

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { api, qs } from '@/lib/client/api'
import {
  addDaysToKey,
  endOfDayUtc,
  monthGridKeys,
  rangeOfDayKeys,
  startOfDayUtc,
  startOfWeekKey,
  todayKey,
} from '@/lib/datetime'
import { useIsNarrow } from '@/hooks/use-media-query'
import type {
  CalendarSummary,
  CalendarViewMode,
  EventOccurrence,
} from '@/types/domain'

/**
 * Calendar state.
 *
 * The view and the anchor date live in the URL, not in React state: that makes
 * every view deep-linkable and shareable, keeps the browser's back button
 * meaningful, and means a refresh lands where you were. Everything else —
 * fetched events, selection, in-flight drags — is local.
 */

export interface CalendarPrefs {
  timezone: string
  secondaryTimezones: string[]
  weekStartsOn: number
  use24h: boolean
  showWeekends: boolean
  showWeekNumbers: boolean
  showDeclinedEvents: boolean
  dayStartHour: number
  dayEndHour: number
  compact: boolean
  defaultCalendarId: string | null
  defaultDuration: number
  defaultReminders: number[]
}

interface CalendarContextValue {
  prefs: CalendarPrefs
  calendars: CalendarSummary[]
  visibleCalendarIds: string[]
  toggleCalendar: (calendarId: string, visible?: boolean) => void
  showOnly: (calendarId: string) => void

  view: CalendarViewMode
  setView: (view: CalendarViewMode) => void
  anchorKey: string
  setAnchor: (dayKey: string) => void
  goToday: () => void
  step: (direction: 1 | -1) => void

  /** Day keys currently rendered by the active view. */
  dayKeys: string[]
  rangeLabel: string

  events: EventOccurrence[]
  loading: boolean
  error: string | null
  refresh: () => void

  selectedId: string | null
  select: (occurrenceId: string | null) => void
  selectedEvent: EventOccurrence | null

  /** Applies a local change immediately and reconciles with the server. */
  optimistic: (
    apply: (events: EventOccurrence[]) => EventOccurrence[],
    commit: () => Promise<unknown>,
    options?: { successMessage?: string; undo?: () => Promise<unknown> },
  ) => Promise<void>
}

const CalendarContext = React.createContext<CalendarContextValue | null>(null)

export const VIEW_MODES: CalendarViewMode[] = [
  'day',
  'three-day',
  'work-week',
  'week',
  'month',
  'year',
  'agenda',
]

function isViewMode(value: string | null): value is CalendarViewMode {
  return Boolean(value) && VIEW_MODES.includes(value as CalendarViewMode)
}

const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function CalendarProvider({
  prefs,
  calendars: initialCalendars,
  initialEvents,
  defaultView = 'week',
  children,
}: {
  prefs: CalendarPrefs
  calendars: CalendarSummary[]
  initialEvents?: EventOccurrence[]
  defaultView?: CalendarViewMode
  children: React.ReactNode
}) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [calendars, setCalendars] = React.useState(initialCalendars)
  // Reset local visibility state when the server sends a new list. Compared
  // during render rather than synced in an effect, so there is no extra pass.
  const [syncedCalendars, setSyncedCalendars] = React.useState(initialCalendars)
  if (syncedCalendars !== initialCalendars) {
    setSyncedCalendars(initialCalendars)
    setCalendars(initialCalendars)
  }

  // Seven columns do not fit on a phone. Without an explicit choice in the URL,
  // a narrow viewport opens on the day view; picking a view still works, and
  // the choice is remembered because it lives in the URL.
  const narrow = useIsNarrow()
  const view = isViewMode(searchParams.get('view'))
    ? (searchParams.get('view') as CalendarViewMode)
    : narrow
      ? 'day'
      : defaultView

  const dateParam = searchParams.get('date')
  const anchorKey =
    dateParam && DAY_KEY_PATTERN.test(dateParam) ? dateParam : todayKey(prefs.timezone)

  const setParams = React.useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString())
      for (const [key, value] of Object.entries(patch)) {
        if (value === null) next.delete(key)
        else next.set(key, value)
      }
      router.replace(`?${next.toString()}`, { scroll: false })
    },
    [router, searchParams],
  )

  const dayKeys = React.useMemo(
    () => computeDayKeys(view, anchorKey, prefs),
    [view, anchorKey, prefs],
  )

  const visibleCalendarIds = React.useMemo(
    () => calendars.filter((c) => c.isVisible).map((c) => c.id),
    [calendars],
  )

  /* ------------------------------------------------------------- fetching */

  const [events, setEvents] = React.useState<EventOccurrence[]>(initialEvents ?? [])
  const [loading, setLoading] = React.useState(!initialEvents)
  const [error, setError] = React.useState<string | null>(null)
  const [nonce, setNonce] = React.useState(0)

  const from = React.useMemo(
    () => (dayKeys.length ? startOfDayUtc(dayKeys[0]!, prefs.timezone) : new Date()),
    [dayKeys, prefs.timezone],
  )
  const to = React.useMemo(
    () =>
      dayKeys.length
        ? endOfDayUtc(dayKeys[dayKeys.length - 1]!, prefs.timezone)
        : new Date(),
    [dayKeys, prefs.timezone],
  )

  const visibleKey = visibleCalendarIds.join(',')

  React.useEffect(() => {
    // Only the newest request may write to state; a slow response to an old
    // range must not overwrite the range the user is now looking at.
    const controller = new AbortController()
    let active = true

    // eslint-disable-next-line react-hooks/set-state-in-effect -- flags the in-flight fetch for the newly requested date range
    setLoading(true)
    api
      .get<EventOccurrence[]>(
        `/api/events${qs({
          from: from.toISOString(),
          to: to.toISOString(),
          calendarIds: visibleKey || undefined,
          includeDeclined: prefs.showDeclinedEvents ? 'true' : 'false',
        })}`,
        { signal: controller.signal },
      )
      .then((data) => {
        if (!active) return
        setEvents(data)
        setError(null)
      })
      .catch((cause: unknown) => {
        if (!active || controller.signal.aborted) return
        setError(
          cause instanceof Error ? cause.message : 'Could not load your calendar.',
        )
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [from, to, visibleKey, prefs.showDeclinedEvents, nonce])

  /**
   * Re-reads the grid *and* the server-rendered shell around it.
   *
   * The nonce alone only refetches this context's own events; the right panel's
   * "Up next" list is resolved by the layout on the server, so without the
   * router refresh it would keep listing an event the grid has already dropped.
   */
  const refresh = React.useCallback(() => {
    setNonce((n) => n + 1)
    router.refresh()
  }, [router])

  /* ------------------------------------------------------------ selection */

  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const selectedEvent = React.useMemo(
    () => events.find((e) => e.occurrenceId === selectedId) ?? null,
    [events, selectedId],
  )

  /* ------------------------------------------------------------ mutation */

  const optimistic = React.useCallback<CalendarContextValue['optimistic']>(
    async (apply, commit, options) => {
      let snapshot: EventOccurrence[] = []
      setEvents((current) => {
        snapshot = current
        return apply(current)
      })

      try {
        await commit()
        if (options?.successMessage) {
          toast.success(options.successMessage, {
            action: options.undo
              ? {
                  label: 'Undo',
                  onClick: () => {
                    void options
                      .undo!()
                      .then(refresh)
                      .catch(() => toast.error('Could not undo that.'))
                  },
                }
              : undefined,
          })
        }
        refresh()
      } catch (cause) {
        // Put the calendar back exactly as it was, then say what went wrong.
        setEvents(snapshot)
        toast.error(
          cause instanceof Error ? cause.message : 'That change could not be saved.',
        )
      }
    },
    [refresh],
  )

  /* ------------------------------------------------------------ navigation */

  const setView = React.useCallback(
    (next: CalendarViewMode) => setParams({ view: next }),
    [setParams],
  )

  const setAnchor = React.useCallback(
    (dayKey: string) => setParams({ date: dayKey }),
    [setParams],
  )

  const goToday = React.useCallback(
    () => setParams({ date: todayKey(prefs.timezone) }),
    [setParams, prefs.timezone],
  )

  const step = React.useCallback(
    (direction: 1 | -1) => {
      setParams({ date: stepAnchor(view, anchorKey, direction) })
    },
    [setParams, view, anchorKey],
  )

  /* ------------------------------------------------------------ calendars */

  const toggleCalendar = React.useCallback(
    (calendarId: string, visible?: boolean) => {
      setCalendars((current) =>
        current.map((calendar) =>
          calendar.id === calendarId
            ? { ...calendar, isVisible: visible ?? !calendar.isVisible }
            : calendar,
        ),
      )
      const next =
        visible ?? !calendars.find((c) => c.id === calendarId)?.isVisible
      void api
        .patch(`/api/calendars/${calendarId}`, { isVisible: next })
        .catch(() => {
          // Visibility is a display preference; a failed write is worth a quiet
          // revert rather than an alarming error.
          setCalendars(initialCalendars)
        })
    },
    [calendars, initialCalendars],
  )

  const showOnly = React.useCallback(
    (calendarId: string) => {
      setCalendars((current) =>
        current.map((calendar) => ({
          ...calendar,
          isVisible: calendar.id === calendarId,
        })),
      )
      void api
        .post('/api/calendars/visibility', { visibleIds: [calendarId] })
        .catch(() => setCalendars(initialCalendars))
    },
    [initialCalendars],
  )

  const value = React.useMemo<CalendarContextValue>(
    () => ({
      prefs,
      calendars,
      visibleCalendarIds,
      toggleCalendar,
      showOnly,
      view,
      setView,
      anchorKey,
      setAnchor,
      goToday,
      step,
      dayKeys,
      rangeLabel: describeRange(view, anchorKey, dayKeys),
      events,
      loading,
      error,
      refresh,
      selectedId,
      select: setSelectedId,
      selectedEvent,
      optimistic,
    }),
    [
      prefs,
      calendars,
      visibleCalendarIds,
      toggleCalendar,
      showOnly,
      view,
      setView,
      anchorKey,
      setAnchor,
      goToday,
      step,
      dayKeys,
      events,
      loading,
      error,
      refresh,
      selectedId,
      selectedEvent,
      optimistic,
    ],
  )

  return <CalendarContext.Provider value={value}>{children}</CalendarContext.Provider>
}

export function useCalendar() {
  const ctx = React.useContext(CalendarContext)
  if (!ctx) throw new Error('useCalendar must be used inside <CalendarProvider>')
  return ctx
}

/* ------------------------------------------------------------- helpers */

export function computeDayKeys(
  view: CalendarViewMode,
  anchorKey: string,
  prefs: Pick<CalendarPrefs, 'weekStartsOn' | 'showWeekends'>,
): string[] {
  switch (view) {
    case 'day':
      return [anchorKey]
    case 'three-day':
      return rangeOfDayKeys(anchorKey, 3)
    case 'work-week': {
      // Monday to Friday of the week containing the anchor, regardless of the
      // user's week start — "work week" means the working days, not days 1–5.
      const monday = startOfWeekKey(anchorKey, 1)
      return rangeOfDayKeys(monday, 5)
    }
    case 'week': {
      const start = startOfWeekKey(anchorKey, prefs.weekStartsOn)
      const week = rangeOfDayKeys(start, 7)
      if (prefs.showWeekends) return week
      return week.filter((key) => {
        const day = new Date(`${key}T12:00:00`).getDay()
        return day !== 0 && day !== 6
      })
    }
    case 'month':
      return monthGridKeys(anchorKey, prefs.weekStartsOn)
    case 'year': {
      const year = Number(anchorKey.slice(0, 4))
      return [`${year}-01-01`, `${year}-12-31`]
    }
    case 'agenda':
      return rangeOfDayKeys(anchorKey, 30)
    default:
      return [anchorKey]
  }
}

function stepAnchor(
  view: CalendarViewMode,
  anchorKey: string,
  direction: 1 | -1,
): string {
  switch (view) {
    case 'day':
      return addDaysToKey(anchorKey, direction)
    case 'three-day':
      return addDaysToKey(anchorKey, 3 * direction)
    case 'work-week':
    case 'week':
      return addDaysToKey(anchorKey, 7 * direction)
    case 'month': {
      const [year, month] = anchorKey.split('-').map(Number)
      // Day 1 at noon: adding months from the 31st would otherwise skip a month.
      const date = new Date(year!, month! - 1 + direction, 1, 12)
      const nextMonth = String(date.getMonth() + 1).padStart(2, '0')
      return `${date.getFullYear()}-${nextMonth}-01`
    }
    case 'year':
      return `${Number(anchorKey.slice(0, 4)) + direction}-01-01`
    case 'agenda':
      return addDaysToKey(anchorKey, 30 * direction)
    default:
      return addDaysToKey(anchorKey, direction)
  }
}

function describeRange(
  view: CalendarViewMode,
  anchorKey: string,
  dayKeys: string[],
): string {
  const fmt = (key: string, options: Intl.DateTimeFormatOptions) =>
    new Date(`${key}T12:00:00`).toLocaleDateString('en-GB', options)

  if (view === 'year') return anchorKey.slice(0, 4)
  if (view === 'month') {
    return fmt(`${anchorKey.slice(0, 8)}15`, { month: 'long', year: 'numeric' })
  }
  if (view === 'day') {
    return fmt(anchorKey, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  }

  const first = dayKeys[0]
  const last = dayKeys[dayKeys.length - 1]
  if (!first || !last) return ''

  const sameMonth = first.slice(0, 7) === last.slice(0, 7)
  const sameYear = first.slice(0, 4) === last.slice(0, 4)

  if (sameMonth) return fmt(first, { month: 'long', year: 'numeric' })
  if (sameYear) {
    return `${fmt(first, { month: 'short' })} – ${fmt(last, { month: 'short', year: 'numeric' })}`
  }
  return `${fmt(first, { month: 'short', year: 'numeric' })} – ${fmt(last, { month: 'short', year: 'numeric' })}`
}
