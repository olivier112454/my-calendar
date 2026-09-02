'use client'

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { Copy, Palette, Pencil, Trash2, CalendarDays } from 'lucide-react'
import { api } from '@/lib/client/api'
import { calendarPalette } from '@/config/app'
import { dayKeyOf } from '@/lib/datetime'
import type { EventDetail, EventOccurrence } from '@/types/domain'
import { useAppShell } from '@/components/layout/app-shell-context'
import { applyDraft, useDraft } from './draft-context'
import { DraftBar } from './draft-bar'
import { useCalendarShortcuts } from '@/hooks/use-global-shortcuts'
import { Button } from '@/components/ui/button'
import { EmptyState, ErrorBanner } from '@/components/ui/states'
import { Sheet, SheetContent } from '@/components/ui/overlay'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/menu'
import { ColorDot } from '@/components/ui/primitives'
import { EventComposer } from '@/components/events/event-composer'
import { EventDetailsPanel } from '@/components/events/event-details-panel'
import { RecurrenceScopeDialog } from '@/components/events/recurrence-scope-dialog'
import { useCalendar } from './calendar-context'
import { CalendarToolbar } from './calendar-toolbar'
import { TimeGrid } from './time-grid'
import { MonthView } from './month-view'
import { YearView } from './year-view'
import { AgendaView } from './agenda-view'

/**
 * Wires the calendar state to whichever view is active, and owns the actions a
 * view can trigger: create by dragging, move by dropping, open, edit, delete.
 *
 * Every mutation is optimistic — the grid updates on the same frame as the drop
 * and rolls back with a toast if the server refuses.
 */
export function CalendarSurface() {
  const {
    view,
    dayKeys,
    anchorKey,
    prefs,
    events,
    error,
    loading,
    refresh,
    calendars,
    selectedId,
    select,
    selectedEvent,
    setView,
    setAnchor,
    goToday,
    step,
    optimistic,
  } = useCalendar()

  const { showInPanel, closePanel, rightPanelContent, categories } = useAppShell()
  const draft = useDraft()

  /*
   * What the grid draws.
   *
   * In draft mode this is the week as the draft proposes it, plus a shadow of
   * every moved event where it really still is. Outside draft mode it is the
   * same array that came from the server, untouched — the transform costs one
   * comparison when there is nothing to apply.
   */
  const shownEvents = React.useMemo(
    () => applyDraft(events, draft.active ? draft.moves : []),
    [events, draft.active, draft.moves],
  )
  const router = useRouter()
  const searchParams = useSearchParams()

  const [composer, setComposer] = React.useState<{
    seed?: { start?: Date; end?: Date; allDay?: boolean; calendarId?: string }
    editing?: EventDetail | null
  } | null>(null)
  const [contextTarget, setContextTarget] = React.useState<{
    event: EventOccurrence
    x: number
    y: number
  } | null>(null)
  const [deleteScopePrompt, setDeleteScopePrompt] = React.useState<EventOccurrence | null>(
    null,
  )
  const [mobileDetail, setMobileDetail] = React.useState<EventOccurrence | null>(null)
  const [syncing, setSyncing] = React.useState(false)
  const [guestSuggestions, setGuestSuggestions] = React.useState<
    { name: string; email: string; avatarUrl?: string | null }[]
  >([])

  // Guest autocomplete comes from the user's own contacts, fetched once.
  React.useEffect(() => {
    let active = true
    api
      .get<{ name: string; email: string; avatarUrl: string | null }[]>(
        '/api/contacts?mode=guests',
      )
      .then((data) => {
        if (active) setGuestSuggestions(data)
      })
      .catch(() => {
        // Suggestions are a convenience; the field still accepts any address.
      })
    return () => {
      active = false
    }
  }, [])

  const syncProviders = React.useCallback(async () => {
    setSyncing(true)
    try {
      const result = await api.post<{
        pulled: number
        pushed: number
        errors: { calendar: string; message: string }[]
      }>('/api/sync/google', {})

      if (result.errors.length > 0) {
        toast.error(result.errors[0]!.message, {
          action: {
            label: 'Fix',
            onClick: () => router.push('/settings/integrations'),
          },
        })
      } else {
        toast.success(`Synced — ${result.pulled} in, ${result.pushed} out`)
      }
      refresh()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Sync failed.')
    } finally {
      setSyncing(false)
    }
  }, [refresh, router])

  useCalendarShortcuts({
    setView: (next) => setView(next as never),
    goToday,
    step,
    onDelete: selectedEvent ? () => requestDelete(selectedEvent) : undefined,
  })

  /* A shared link like /calendar?event=… opens straight onto that event. */
  const deepLinkEventId = searchParams.get('event')
  const deepLinkEdit = searchParams.get('edit')
  React.useEffect(() => {
    if (!deepLinkEventId) return
    if (deepLinkEdit === '1') {
      void api
        .get<EventDetail>(`/api/events/${deepLinkEventId}`)
        .then((detail) => setComposer({ editing: detail }))
        .catch(() => toast.error('That event could not be opened.'))
    } else {
      showInPanel({ kind: 'event', eventId: deepLinkEventId })
    }
    // Clear the parameter so a refresh does not reopen the dialog.
    router.replace(
      `/calendar?view=${view}&date=${anchorKey}`,
      { scroll: false },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkEventId, deepLinkEdit])

  /* ------------------------------------------------------------- actions */

  const openEvent = React.useCallback(
    (event: EventOccurrence) => {
      select(event.occurrenceId)
      // On a narrow screen there is no context column, so the details arrive as
      // a bottom sheet instead of pushing the calendar off screen.
      if (window.matchMedia('(max-width: 1023px)').matches) {
        setMobileDetail(event)
      } else {
        showInPanel({
          kind: 'event',
          eventId: event.eventId,
          occurrenceStart: event.occurrenceStart,
        })
      }
    },
    [select, showInPanel],
  )

  const createInRange = React.useCallback(
    ({ start, end }: { start: Date; end: Date }) => {
      setComposer({ seed: { start, end } })
    },
    [],
  )

  const moveEvent = React.useCallback(
    async ({
      event,
      start,
      end,
    }: {
      event: EventOccurrence
      start: Date
      end: Date
    }) => {
      const previousStart = event.start
      const previousEnd = event.end

      // Draft mode: record the intention and draw it, but write nothing. The
      // shadow the grid then shows comes from the untouched original.
      if (draft.active) {
        draft.record({
          occurrenceId: event.occurrenceId,
          eventId: event.eventId,
          title: event.title,
          originalStart: previousStart,
          originalEnd: previousEnd,
          start: start.toISOString(),
          end: end.toISOString(),
          occurrenceStart: event.occurrenceStart ?? null,
          isRecurring: event.isRecurring,
        })
        return
      }

      await optimistic(
        (current) =>
          current.map((entry) =>
            entry.occurrenceId === event.occurrenceId
              ? { ...entry, start: start.toISOString(), end: end.toISOString() }
              : entry,
          ),
        () =>
          api.patch(`/api/events/${event.eventId}/move`, {
            start: start.toISOString(),
            end: end.toISOString(),
            occurrenceStart: event.occurrenceStart ?? undefined,
            scope: event.isRecurring ? 'this' : 'all',
          }),
        {
          successMessage: 'Event moved',
          undo: () =>
            api.patch(`/api/events/${event.eventId}/move`, {
              start: previousStart,
              end: previousEnd,
              occurrenceStart: event.occurrenceStart ?? undefined,
              scope: event.isRecurring ? 'this' : 'all',
            }),
        },
      )
    },
    [optimistic, draft],
  )

  const moveToDay = React.useCallback(
    async (event: EventOccurrence, dayKey: string) => {
      const from = dayKeyOf(new Date(event.start), prefs.timezone)
      const delta = Math.round(
        (Date.parse(`${dayKey}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000,
      )
      if (delta === 0) return

      const start = new Date(Date.parse(event.start) + delta * 86_400_000)
      const end = new Date(Date.parse(event.end) + delta * 86_400_000)
      await moveEvent({ event, start, end })
    },
    [prefs.timezone, moveEvent],
  )

  // The details panel keeps showing whatever it was given, so a deleted event
  // would linger there with Edit and Duplicate pointing at a row that is gone.
  const dropFromPanel = React.useCallback(
    (eventId: string) => {
      if (rightPanelContent?.kind === 'event' && rightPanelContent.eventId === eventId) {
        closePanel()
      }
    },
    [rightPanelContent, closePanel],
  )

  const requestDelete = React.useCallback(
    (event: EventOccurrence) => {
      if (event.readOnly) {
        toast.error('That calendar is read-only.')
        return
      }
      if (event.isRecurring) {
        setDeleteScopePrompt(event)
        return
      }
      void optimistic(
        (current) => current.filter((entry) => entry.occurrenceId !== event.occurrenceId),
        () => api.delete(`/api/events/${event.eventId}`, { scope: 'all' }),
        { successMessage: `"${event.title}" deleted` },
      )
      dropFromPanel(event.eventId)
    },
    [optimistic, dropFromPanel],
  )

  const changeColor = React.useCallback(
    async (event: EventOccurrence, color: string) => {
      await optimistic(
        (current) =>
          current.map((entry) =>
            entry.occurrenceId === event.occurrenceId ? { ...entry, color } : entry,
          ),
        () => api.patch(`/api/events/${event.eventId}`, { color, scope: 'all' }),
      )
    },
    [optimistic],
  )

  const duplicate = React.useCallback(
    async (event: EventOccurrence) => {
      try {
        await api.post(`/api/events/${event.eventId}/duplicate`)
        toast.success('Event duplicated')
        refresh()
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : 'Could not duplicate.')
      }
    },
    [refresh],
  )

  /** A task dragged from the sidebar becomes a linked block on the calendar. */
  const scheduleTask = React.useCallback(
    async (
      payload: { taskId: string; title: string },
      start: Date,
      end: Date,
    ) => {
      try {
        await api.post(`/api/tasks/${payload.taskId}/schedule`, {
          start: start.toISOString(),
          end: end.toISOString(),
          timezone: prefs.timezone,
        })
        toast.success(`"${payload.title}" scheduled`, {
          action: {
            label: 'Undo',
            onClick: () => {
              void api
                .delete(`/api/tasks/${payload.taskId}/schedule`)
                .then(() => {
                  refresh()
                  router.refresh()
                })
                .catch(() => toast.error('Could not undo that.'))
            },
          },
        })
        refresh()
        router.refresh()
      } catch (cause) {
        toast.error(
          cause instanceof Error ? cause.message : 'Could not schedule that task.',
        )
      }
    },
    [prefs.timezone, refresh, router],
  )

  const editEvent = React.useCallback(async (event: EventOccurrence) => {
    try {
      const detail = await api.get<EventDetail>(
        `/api/events/${event.eventId}${
          event.occurrenceStart
            ? `?occurrenceStart=${encodeURIComponent(event.occurrenceStart)}`
            : ''
        }`,
      )
      setComposer({ editing: detail })
    } catch {
      toast.error('That event could not be opened.')
    }
  }, [])

  /* ---------------------------------------------------------------- view */

  const writableCalendars = calendars.filter((calendar) => !calendar.isReadOnly)
  const noCalendars = writableCalendars.length === 0
  // The sync button only appears when there is something to sync with.
  const hasConnectedCalendars = calendars.some((calendar) => calendar.provider !== null)

  let body: React.ReactNode

  if (noCalendars) {
    body = (
      <EmptyState
        icon={<CalendarDays />}
        title="No calendars yet"
        description="Create a calendar to start adding events, or connect an account you already use."
      />
    )
  } else if (view === 'month') {
    body = (
      <MonthView
        dayKeys={dayKeys}
        events={shownEvents}
        timezone={prefs.timezone}
        use24h={prefs.use24h}
        anchorKey={anchorKey}
        weekStartsOn={prefs.weekStartsOn}
        showWeekNumbers={prefs.showWeekNumbers}
        selectedId={selectedId}
        onSelect={openEvent}
        onCreateOnDay={(dayKey) =>
          setComposer({
            seed: {
              start: new Date(`${dayKey}T09:00:00`),
              end: new Date(`${dayKey}T10:00:00`),
            },
          })
        }
        onOpenDay={(dayKey) => {
          setAnchor(dayKey)
          setView('day')
        }}
        onMoveToDay={(event, dayKey) => void moveToDay(event, dayKey)}
        onContextMenu={(event, nativeEvent) => {
          nativeEvent.preventDefault()
          setContextTarget({ event, x: nativeEvent.clientX, y: nativeEvent.clientY })
        }}
      />
    )
  } else if (view === 'year') {
    body = (
      <YearView
        year={Number(anchorKey.slice(0, 4))}
        events={shownEvents}
        timezone={prefs.timezone}
        weekStartsOn={prefs.weekStartsOn}
        showWeekNumbers={prefs.showWeekNumbers}
        selectedKey={anchorKey}
        onSelectDay={(dayKey) => {
          setAnchor(dayKey)
          setView('day')
        }}
      />
    )
  } else if (view === 'agenda') {
    body = (
      <AgendaView
        dayKeys={dayKeys}
        events={shownEvents}
        timezone={prefs.timezone}
        use24h={prefs.use24h}
        selectedId={selectedId}
        onSelect={openEvent}
        onCreate={() => setComposer({ seed: {} })}
        onContextMenu={(event, nativeEvent) => {
          nativeEvent.preventDefault()
          setContextTarget({ event, x: nativeEvent.clientX, y: nativeEvent.clientY })
        }}
      />
    )
  } else {
    body = (
      <TimeGrid
        dayKeys={dayKeys}
        events={shownEvents}
        timezone={prefs.timezone}
        secondaryTimezones={prefs.secondaryTimezones}
        use24h={prefs.use24h}
        compact={prefs.compact}
        showWeekNumbers={prefs.showWeekNumbers}
        selectedId={selectedId}
        onSelect={openEvent}
        onCreate={createInRange}
        onMove={(change) => void moveEvent(change)}
        onDayHeaderClick={(dayKey) => {
          setAnchor(dayKey)
          setView('day')
        }}
        onTaskDrop={(payload, start, end) => void scheduleTask(payload, start, end)}
        onContextMenu={(event, nativeEvent) => {
          nativeEvent.preventDefault()
          setContextTarget({ event, x: nativeEvent.clientX, y: nativeEvent.clientY })
        }}
      />
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CalendarToolbar
        onCreate={() => setComposer({ seed: {} })}
        onSync={hasConnectedCalendars ? syncProviders : undefined}
        syncing={syncing}
      />

      {error ? (
        <div className="px-4 pt-3">
          <ErrorBanner
            title="Could not load your calendar"
            description={error}
            actions={
              <Button variant="secondary" size="sm" onClick={refresh}>
                Try again
              </Button>
            }
          />
        </div>
      ) : null}

      <div className="min-h-0 flex-1" aria-busy={loading}>
        {body}
      </div>

      <DraftBar
        timezone={prefs.timezone}
        use24h={prefs.use24h}
        onApplied={refresh}
      />

      {/* ------------------------------------------------------- composer */}
      <EventComposer
        open={composer !== null}
        onOpenChange={(open) => !open && setComposer(null)}
        calendars={calendars}
        categories={categories}
        timezone={prefs.timezone}
        use24h={prefs.use24h}
        defaultCalendarId={prefs.defaultCalendarId}
        defaultReminders={prefs.defaultReminders}
        seed={composer?.seed}
        editing={composer?.editing}
        contactSuggestions={guestSuggestions}
        onSaved={refresh}
      />

      {/* --------------------------------------------------- context menu */}
      {contextTarget ? (
        <DropdownMenu
          open
          onOpenChange={(open) => !open && setContextTarget(null)}
        >
          {/* A zero-size trigger parked at the pointer, so one menu definition
              serves the grid, the month cells and the agenda list. */}
          <DropdownMenuTrigger asChild>
            <span
              aria-hidden="true"
              style={{
                position: 'fixed',
                left: contextTarget.x,
                top: contextTarget.y,
                width: 1,
                height: 1,
              }}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" sideOffset={0}>
            <DropdownMenuItem
              disabled={contextTarget.event.readOnly}
              onSelect={() => void editEvent(contextTarget.event)}
            >
              <Pencil />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={contextTarget.event.readOnly}
              onSelect={() => void duplicate(contextTarget.event)}
            >
              <Copy />
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger disabled={contextTarget.event.readOnly}>
                <Palette />
                Change colour
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-auto p-2">
                <div className="grid grid-cols-5 gap-1.5">
                  {calendarPalette.map((entry) => (
                    <button
                      key={entry.value}
                      type="button"
                      aria-label={entry.name}
                      title={entry.name}
                      onClick={() => {
                        void changeColor(contextTarget.event, entry.value)
                        setContextTarget(null)
                      }}
                      className="flex size-6 items-center justify-center rounded-full transition-transform hover:scale-110"
                    >
                      <ColorDot color={entry.value} size={16} />
                    </button>
                  ))}
                </div>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              danger
              disabled={contextTarget.event.readOnly}
              onSelect={() => requestDelete(contextTarget.event)}
              shortcut="Del"
            >
              <Trash2 />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      <RecurrenceScopeDialog
        open={deleteScopePrompt !== null}
        onOpenChange={(open) => !open && setDeleteScopePrompt(null)}
        action="delete"
        onChoose={(scope) => {
          const event = deleteScopePrompt
          setDeleteScopePrompt(null)
          if (!event) return
          void optimistic(
            (current) =>
              scope === 'this'
                ? current.filter((entry) => entry.occurrenceId !== event.occurrenceId)
                : current.filter((entry) => entry.eventId !== event.eventId),
            () =>
              api.delete(`/api/events/${event.eventId}`, {
                scope,
                occurrenceStart: event.occurrenceStart ?? undefined,
              }),
            { successMessage: 'Event deleted' },
          )
          if (scope !== 'this') dropFromPanel(event.eventId)
        }}
      />

      {/* ------------------------------------------------- mobile details */}
      <Sheet
        open={mobileDetail !== null}
        onOpenChange={(open) => !open && setMobileDetail(null)}
      >
        {mobileDetail ? (
          <SheetContent side="bottom" title={mobileDetail.title} className="p-0">
            <EventDetailsPanel
              eventId={mobileDetail.eventId}
              occurrenceStart={mobileDetail.occurrenceStart}
              timezone={prefs.timezone}
              use24h={prefs.use24h}
              onEdit={(detail) => {
                setMobileDetail(null)
                setComposer({ editing: detail })
              }}
              onClose={() => setMobileDetail(null)}
              onChanged={refresh}
            />
          </SheetContent>
        ) : null}
      </Sheet>

    </div>
  )
}


