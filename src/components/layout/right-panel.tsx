'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { CalendarClock, CheckSquare, PanelRightClose } from 'lucide-react'
import { api } from '@/lib/client/api'
import { formatRelative, formatTimeCompact } from '@/lib/datetime'
import { cn } from '@/lib/utils'
import type { EventDetail, EventOccurrence, TaskSummary } from '@/types/domain'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/states'
import { EventDetailsPanel } from '@/components/events/event-details-panel'
import { TaskRow } from '@/components/tasks/task-row'
import { useNow } from '@/hooks/use-now'
import { useAppShell } from './app-shell-context'

/**
 * The context column.
 *
 * With nothing selected it answers "what is next" and "what still needs a slot"
 * — and the tasks in the second list are draggable straight onto the grid, which
 * is the shortest path from an intention to a time block.
 *
 * Both lists come from the layout's server render rather than their own fetch,
 * so a change anywhere in the app updates them in the same pass as the page.
 */
export function RightPanel() {
  const {
    rightPanelContent,
    closePanel,
    setRightPanelOpen,
    timezone,
    use24h,
    requestCreate,
    todayEvents,
    looseTasks,
  } = useAppShell()
  const router = useRouter()

  if (rightPanelContent?.kind === 'event') {
    return (
      <EventDetailsPanel
        eventId={rightPanelContent.eventId}
        occurrenceStart={rightPanelContent.occurrenceStart}
        timezone={timezone}
        use24h={use24h}
        onEdit={(event: EventDetail) =>
          router.push(`/calendar?event=${event.eventId}&edit=1`)
        }
        onClose={closePanel}
        onChanged={() => router.refresh()}
      />
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-13 shrink-0 items-center justify-between px-3">
        <h2 className="text-[13px] font-semibold text-fg">Up next</h2>
        <Button
          variant="ghost"
          size="iconSm"
          onClick={() => setRightPanelOpen(false)}
          aria-label="Hide details panel"
        >
          <PanelRightClose />
        </Button>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 space-y-5 overflow-y-auto px-3 pb-3">
        <RestOfDay
          events={todayEvents}
          timezone={timezone}
          use24h={use24h}
          onCreate={() => requestCreate()}
        />
        <UnscheduledTasks tasks={looseTasks} timezone={timezone} />
      </div>
    </div>
  )
}

/** Everything still ahead today. */
export function RestOfDay({
  events,
  timezone,
  use24h,
  onCreate,
  onSelect,
}: {
  events: EventOccurrence[]
  timezone: string
  use24h: boolean
  onCreate?: () => void
  onSelect?: (event: EventOccurrence) => void
}) {
  const now = useNow()
  // Before the first client tick there is no clock to filter against, so the
  // whole day is shown rather than an empty list that flashes.
  const remaining =
    now === 0 ? events : events.filter((event) => Date.parse(event.end) > now)

  if (remaining.length === 0) {
    return (
      <EmptyState
        compact
        icon={<CalendarClock />}
        title="Nothing left today"
        description="The rest of the day is yours."
        action={
          onCreate ? (
            <Button variant="secondary" size="sm" onClick={onCreate}>
              Add an event
            </Button>
          ) : undefined
        }
      />
    )
  }

  return (
    <ul className="space-y-0.5">
      {remaining.map((event) => {
        const start = new Date(event.start)
        const running = now > 0 && Date.parse(event.start) <= now
        return (
          <li key={event.occurrenceId}>
            <button
              type="button"
              onClick={() => onSelect?.(event)}
              disabled={!onSelect}
              className={cn(
                'flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left transition-colors',
                onSelect && 'hover:bg-surface-2',
                running && 'bg-accent-soft',
              )}
            >
              <span
                aria-hidden="true"
                className="mt-1 w-[3px] shrink-0 self-stretch rounded-full"
                style={{ backgroundColor: event.color }}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-fg">
                  {event.title}
                </span>
                <span className="block text-[11px] text-fg-muted">
                  {event.allDay
                    ? 'All day'
                    : `${formatTimeCompact(start, timezone, use24h)} · ${
                        running ? 'now' : formatRelative(start)
                      }`}
                </span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * Tasks without a time block, ready to be dragged onto the grid. This is the
 * pairing that makes the two halves of the app one product rather than two.
 */
function UnscheduledTasks({
  tasks,
  timezone,
}: {
  tasks: TaskSummary[]
  timezone: string
}) {
  const router = useRouter()

  return (
    <section>
      <div className="flex items-center justify-between px-1 pb-1">
        <h3 className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
          Needs a slot
        </h3>
        <Link
          href="/schedule"
          className="text-[11px] text-fg-subtle underline-offset-2 hover:text-fg-muted hover:underline"
        >
          Plan
        </Link>
      </div>

      {tasks.length === 0 ? (
        <EmptyState
          compact
          icon={<CheckSquare />}
          title="Everything has a time"
          description="No loose tasks waiting for a slot."
        />
      ) : (
        <>
          <p className="px-1 pb-1 text-[11px] text-fg-subtle">
            Drag one onto the calendar to block time for it.
          </p>
          <ul className="space-y-px">
            {tasks.slice(0, 8).map((task) => (
              <li key={task.id}>
                <TaskRow
                  task={task}
                  timezone={timezone}
                  onToggle={async (done) => {
                    await api
                      .patch(`/api/tasks/${task.id}`, {
                        status: done ? 'DONE' : 'TODO',
                      })
                      .catch(() => undefined)
                    router.refresh()
                  }}
                  onOpen={() => router.push(`/tasks?task=${task.id}`)}
                />
              </li>
            ))}
          </ul>
          {tasks.length > 8 ? (
            <p className="px-1 pt-1 text-[11px] text-fg-subtle">
              and {tasks.length - 8} more
            </p>
          ) : null}
        </>
      )}
    </section>
  )
}
