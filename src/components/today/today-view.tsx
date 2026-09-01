'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  ArrowRight,
  CalendarPlus,
  CheckSquare,
  Clock,
  Coffee,
  MapPin,
  Users,
  Video,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/lib/client/api'
import {
  formatDuration,
  formatRelative,
  formatTimeCompact,
  minutesIntoDay,
} from '@/lib/datetime'
import type { EventOccurrence, TaskSummary } from '@/types/domain'
import type { DayOverview } from '@/server/services/overview'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/primitives'
import { EmptyState } from '@/components/ui/states'
import { TaskRow } from '@/components/tasks/task-row'
import { useAppShell } from '@/components/layout/app-shell-context'
import { NotificationBell } from '@/components/layout/notification-bell'
import { useNow } from '@/hooks/use-now'

/**
 * The daily planner.
 *
 * One question per column: what is happening (the timeline), what is owed (due
 * tasks), and what is next (tomorrow). The header answers "where am I right
 * now" without any reading — the current or next event, and how long until it.
 */

export function TodayView({
  overview,
  greetingText,
  userName,
  use24h,
}: {
  overview: DayOverview
  greetingText: string
  userName: string | null
  use24h: boolean
}) {
  const router = useRouter()
  const { requestCreate, showInPanel, timezone } = useAppShell()
  const now = useNow()
  const [tasks, setTasks] = React.useState(overview.tasksDue)
  // React's documented way to reset state when a prop changes: compare against
  // the previous value during render, rather than syncing in an effect.
  const [syncedFrom, setSyncedFrom] = React.useState(overview.tasksDue)
  if (syncedFrom !== overview.tasksDue) {
    setSyncedFrom(overview.tasksDue)
    setTasks(overview.tasksDue)
  }

  const dateLabel = new Date(`${overview.dayKey}T12:00:00`).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })

  const toggleTask = async (task: TaskSummary, done: boolean) => {
    const snapshot = tasks
    setTasks((current) =>
      current.map((entry) =>
        entry.id === task.id ? { ...entry, status: done ? 'DONE' : 'TODO' } : entry,
      ),
    )
    try {
      await api.patch(`/api/tasks/${task.id}`, { status: done ? 'DONE' : 'TODO' })
      router.refresh()
    } catch {
      setTasks(snapshot)
      toast.error('Could not update the task.')
    }
  }

  const openEvent = (event: EventOccurrence) =>
    showInPanel({
      kind: 'event',
      eventId: event.eventId,
      occurrenceStart: event.occurrenceStart,
    })

  const headline = overview.current ?? overview.next
  const openTasks = tasks.filter((task) => task.status !== 'DONE')

  return (
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        {/* ------------------------------------------------------- header */}
        <header className="mb-6">
          <div className="flex items-start justify-between gap-3">
            <p className="text-[13px] text-fg-muted">{dateLabel}</p>
            <NotificationBell className="-mt-1" />
          </div>
          <h1 className="mt-0.5 text-[26px] font-semibold tracking-[-0.02em] text-fg">
            {greetingText}
            {userName ? `, ${userName.split(' ')[0]}` : ''}
          </h1>

          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
            {headline ? (
              <button
                type="button"
                onClick={() => openEvent(headline)}
                className="flex items-center gap-2.5 rounded-lg border border-border bg-surface px-3 py-2 text-left transition-colors hover:bg-surface-2"
              >
                <span
                  aria-hidden="true"
                  className="h-8 w-[3px] shrink-0 rounded-full"
                  style={{ backgroundColor: headline.color }}
                />
                <span className="min-w-0">
                  <span className="block text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
                    {overview.current ? 'Happening now' : 'Up next'}
                  </span>
                  <span className="block truncate text-[13px] font-medium text-fg">
                    {headline.title}
                  </span>
                </span>
                <span className="ml-2 shrink-0 text-[13px] tabular-nums text-fg-muted">
                  {overview.current
                    ? `until ${formatTimeCompact(new Date(headline.end), timezone, use24h)}`
                    : formatRelative(new Date(headline.start))}
                </span>
              </button>
            ) : (
              <p className="text-[13px] text-fg-muted">
                Nothing else scheduled today.
              </p>
            )}

            <dl className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px]">
              <Stat label="Meetings" value={String(overview.stats.meetings)} />
              {/* Every busy appointment, guests or not — which is why it is not
                  labelled "in meetings" next to a count that needs guests. */}
              <Stat
                label="In appointments"
                value={formatDuration(overview.stats.meetingMinutes)}
              />
              <Stat
                label="Focus time"
                value={formatDuration(overview.stats.focusMinutes)}
              />
              <Stat label="Tasks due" value={String(openTasks.length)} />
            </dl>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          {/* --------------------------------------------------- timeline */}
          <section aria-labelledby="today-schedule">
            <div className="mb-2 flex items-center justify-between">
              <h2
                id="today-schedule"
                className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle"
              >
                Today
              </h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => requestCreate()}
              >
                <CalendarPlus />
                Add event
              </Button>
            </div>

            {overview.events.length === 0 ? (
              <div className="rounded-lg border border-border bg-surface">
                <EmptyState
                  icon={<Coffee />}
                  title="No events today"
                  description="A clear day. Add something if you need to hold time."
                  action={
                    <Button variant="secondary" size="sm" onClick={() => requestCreate()}>
                      Create event
                    </Button>
                  }
                />
              </div>
            ) : (
              <ol className="space-y-px rounded-lg border border-border bg-surface p-1">
                {overview.events.map((event) => (
                  <li key={event.occurrenceId}>
                    <TimelineRow
                      event={event}
                      timezone={timezone}
                      use24h={use24h}
                      isCurrent={event.occurrenceId === overview.current?.occurrenceId}
                      isPast={now > 0 && Date.parse(event.end) < now}
                      onOpen={() => openEvent(event)}
                    />
                  </li>
                ))}
              </ol>
            )}
          </section>

          {/* ------------------------------------------------------ aside */}
          <div className="space-y-6">
            <section aria-labelledby="today-tasks">
              <div className="mb-2 flex items-center justify-between">
                <h2
                  id="today-tasks"
                  className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle"
                >
                  Due today
                </h2>
                <Button variant="ghost" size="sm" asChild>
                  <Link href="/tasks">
                    All tasks
                    <ArrowRight />
                  </Link>
                </Button>
              </div>

              <div className="rounded-lg border border-border bg-surface p-1">
                {tasks.length === 0 ? (
                  <EmptyState
                    compact
                    icon={<CheckSquare />}
                    title="Nothing due"
                    description="No deadlines land today."
                  />
                ) : (
                  <ul className="space-y-px">
                    {tasks.map((task) => (
                      <li key={task.id}>
                        <TaskRow
                          task={task}
                          timezone={timezone}
                          draggable={false}
                          onToggle={(done) => void toggleTask(task, done)}
                          onOpen={() => router.push(`/tasks?task=${task.id}`)}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

            <section aria-labelledby="today-tomorrow">
              <h2
                id="today-tomorrow"
                className="mb-2 text-[11px] font-medium uppercase tracking-wide text-fg-subtle"
              >
                Tomorrow
              </h2>
              <div className="rounded-lg border border-border bg-surface p-1">
                {overview.tomorrow.length === 0 ? (
                  <EmptyState
                    compact
                    icon={<Clock />}
                    title="Nothing scheduled"
                    description="Tomorrow is open."
                  />
                ) : (
                  <ul className="space-y-px">
                    {overview.tomorrow.slice(0, 6).map((event) => (
                      <li key={event.occurrenceId}>
                        <button
                          type="button"
                          onClick={() => openEvent(event)}
                          className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-2"
                        >
                          <span
                            aria-hidden="true"
                            className="w-[3px] shrink-0 self-stretch rounded-full"
                            style={{ backgroundColor: event.color }}
                          />
                          <span className="w-12 shrink-0 text-[12px] tabular-nums text-fg-muted">
                            {event.allDay
                              ? 'All day'
                              : formatTimeCompact(
                                  new Date(event.start),
                                  timezone,
                                  use24h,
                                )}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[13px] text-fg">
                            {event.title}
                          </span>
                        </button>
                      </li>
                    ))}
                    {overview.tomorrow.length > 6 ? (
                      <li className="px-2 py-1 text-[11px] text-fg-subtle">
                        and {overview.tomorrow.length - 6} more
                      </li>
                    ) : null}
                  </ul>
                )}
              </div>
            </section>

            {overview.unscheduledTasks.length > 0 ? (
              <section aria-labelledby="today-unscheduled">
                <h2
                  id="today-unscheduled"
                  className="mb-2 text-[11px] font-medium uppercase tracking-wide text-fg-subtle"
                >
                  Not yet scheduled
                </h2>
                <div className="rounded-lg border border-dashed border-border px-3 py-3">
                  <p className="text-xs leading-relaxed text-fg-muted">
                    {overview.unscheduledTasks.length} task
                    {overview.unscheduledTasks.length === 1 ? '' : 's'} without a
                    time block.
                  </p>
                  <Button variant="secondary" size="sm" className="mt-2" asChild>
                    <Link href="/schedule">Find time for them</Link>
                  </Button>
                </div>
              </section>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-[11px] uppercase tracking-wide text-fg-subtle">{label}</dt>
      <dd className="text-[13px] font-medium tabular-nums text-fg">{value}</dd>
    </div>
  )
}

function TimelineRow({
  event,
  timezone,
  use24h,
  isCurrent,
  isPast,
  onOpen,
}: {
  event: EventOccurrence
  timezone: string
  use24h: boolean
  isCurrent: boolean
  isPast: boolean
  onOpen: () => void
}) {
  const start = new Date(event.start)
  const end = new Date(event.end)
  const minutes = Math.round((end.getTime() - start.getTime()) / 60_000)

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'flex w-full items-start gap-3 rounded-md px-2 py-2 text-left transition-colors',
        'hover:bg-surface-2',
        isCurrent && 'bg-accent-soft',
        isPast && !isCurrent && 'opacity-60',
      )}
    >
      <span className="w-12 shrink-0 pt-px text-[12px] tabular-nums text-fg-muted">
        {event.allDay ? 'All day' : formatTimeCompact(start, timezone, use24h)}
      </span>

      <span
        aria-hidden="true"
        className="mt-0.5 w-[3px] shrink-0 self-stretch rounded-full"
        style={{ backgroundColor: event.color }}
      />

      <span className="min-w-0 flex-1 space-y-0.5">
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-fg">
            {event.title}
          </span>
          {isCurrent ? <Badge tone="accent">Now</Badge> : null}
          {event.kind === 'FOCUS' ? <Badge tone="neutral">Focus</Badge> : null}
          {event.kind === 'TASK_BLOCK' ? <Badge tone="neutral">Task</Badge> : null}
          {event.kind === 'OUT_OF_OFFICE' ? (
            <Badge tone="warning">Out of office</Badge>
          ) : null}
        </span>
        <span className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-fg-muted">
          {!event.allDay ? <span>{formatDuration(minutes)}</span> : null}
          {event.location ? (
            <span className="inline-flex min-w-0 items-center gap-1">
              <MapPin className="size-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{event.location}</span>
            </span>
          ) : null}
          {event.meetingProvider !== 'NONE' ? (
            <span className="inline-flex items-center gap-1">
              <Video className="size-3" aria-hidden="true" />
              Video
            </span>
          ) : null}
          {event.attendeeCount > 0 ? (
            <span className="inline-flex items-center gap-1">
              <Users className="size-3" aria-hidden="true" />
              {event.attendeeCount}
            </span>
          ) : null}
        </span>
      </span>
    </button>
  )
}

export { minutesIntoDay }
