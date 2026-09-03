'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  CalendarCheck,
  CalendarRange,
  Check,
  Clock,
  Sparkles,
  TriangleAlert,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/lib/client/api'
import {
  dayKeyOf,
  formatDayLabel,
  formatDuration,
  formatTimeCompact,
  rangeOfDayKeys,
} from '@/lib/datetime'
import { bucketByDay } from '@/lib/calendar-layout'
import { maxScheduleHorizonDays, scheduleHorizons } from '@/config/app'
import type {
  CalendarSummary,
  ScheduleCommitment,
  SchedulingProposal,
  TaskSummary,
} from '@/types/domain'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/primitives'
import {
  Checkbox,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/controls'
import { EmptyState, ErrorBanner, ListSkeleton } from '@/components/ui/states'
import { TaskRow } from '@/components/tasks/task-row'
import { NotificationBell } from '@/components/layout/notification-bell'

/**
 * The Schedule page: pick the tasks that need time, get a plan, accept the parts
 * you agree with.
 *
 * Proposals are always previewed and always opt-in. Each one carries a plain
 * reason for its slot, so the plan can be argued with rather than merely
 * accepted or discarded.
 */

interface ProposalState extends SchedulingProposal {
  accepted: boolean
}

/**
 * One row in the week list: something already on the calendar, or something the
 * planner suggests putting there. They share a shape so the two interleave by
 * time — the whole point being to see a proposal next to what surrounds it.
 */
type WeekEntry = {
  key: string
  start: string
  end: string
  allDay: boolean
  title: string
} & (
  | { type: 'commitment'; commitment: ScheduleCommitment }
  | { type: 'proposal'; proposal: ProposalState }
)

export function ScheduleView({
  unscheduled,
  commitments,
  calendars,
  timezone,
  today,
  use24h,
  workingHoursSummary,
}: {
  unscheduled: TaskSummary[]
  commitments: ScheduleCommitment[]
  calendars: CalendarSummary[]
  timezone: string
  /** Today in the user's zone, resolved on the server so render stays pure. */
  today: string
  use24h: boolean
  workingHoursSummary: string
}) {
  const router = useRouter()
  const writable = calendars.filter((calendar) => !calendar.isReadOnly)

  // What the user has *un*ticked, rather than what is ticked. Selection is then
  // derived from the tasks that currently exist, so a task that has just been
  // given a block cannot linger in the count — it simply stops being eligible.
  const [deselected, setDeselected] = React.useState<Set<string>>(() => new Set())
  const [proposals, setProposals] = React.useState<ProposalState[] | null>(null)
  const [unplaced, setUnplaced] = React.useState<
    { taskId: string; title: string; reason: string }[]
  >([])
  const [calendarId, setCalendarId] = React.useState(
    () => writable.find((calendar) => calendar.isDefault)?.id ?? writable[0]?.id ?? '',
  )
  const [horizon, setHorizon] = React.useState('14')
  const [maxBlock, setMaxBlock] = React.useState('120')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const eligible = unscheduled.filter((task) => task.estimatedMinutes)
  const needsEstimate = unscheduled.filter((task) => !task.estimatedMinutes)
  const selectedIds = eligible
    .filter((task) => !deselected.has(task.id))
    .map((task) => task.id)

  const propose = async () => {
    setBusy(true)
    setError(null)
    try {
      const result = await api.post<{
        proposals: SchedulingProposal[]
        unplaced: { taskId: string; title: string; reason: string }[]
      }>('/api/schedule/propose', {
        taskIds: selectedIds,
        horizonDays: Number(horizon),
        maxBlockMinutes: Number(maxBlock),
      })
      setProposals(result.proposals.map((proposal) => ({ ...proposal, accepted: true })))
      setUnplaced(result.unplaced)
      if (result.proposals.length === 0) {
        toast.info('No free time found for those tasks.')
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not build a plan.')
    } finally {
      setBusy(false)
    }
  }

  const apply = async () => {
    if (!proposals) return
    const accepted = proposals.filter((proposal) => proposal.accepted)
    if (accepted.length === 0) return

    setBusy(true)
    try {
      const result = await api.put<{ applied: number }>('/api/schedule/propose', {
        calendarId: calendarId || undefined,
        proposals: accepted.map(({ taskId, start, end }) => ({ taskId, start, end })),
      })
      toast.success(
        `${result.applied} block${result.applied === 1 ? '' : 's'} added to your calendar`,
      )
      setProposals(null)
      router.refresh()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Could not apply the plan.')
    } finally {
      setBusy(false)
    }
  }

  const acceptedCount = proposals?.filter((proposal) => proposal.accepted).length ?? 0
  const acceptedMinutes =
    proposals
      ?.filter((proposal) => proposal.accepted)
      .reduce((total, proposal) => total + proposal.estimatedMinutes, 0) ?? 0

  const byDay = React.useMemo(() => {
    const days = Math.min(Number(horizon) || 14, maxScheduleHorizonDays)
    const dayKeys = rangeOfDayKeys(today, days)

    const entries: WeekEntry[] = [
      ...commitments.map((commitment) => ({
        type: 'commitment' as const,
        key: `c:${commitment.occurrenceId}`,
        start: commitment.start,
        end: commitment.end,
        allDay: commitment.allDay,
        title: commitment.title,
        commitment,
      })),
      ...(proposals ?? []).map((proposal) => ({
        type: 'proposal' as const,
        key: `p:${proposal.taskId}:${proposal.start}`,
        start: proposal.start,
        end: proposal.end,
        allDay: false,
        title: proposal.taskTitle,
        proposal,
      })),
    ]

    // A proposal must always be visible, even if it lands a day outside the
    // window — otherwise the plan would count something the list never showed.
    const keys = new Set(dayKeys)
    for (const entry of entries) {
      if (entry.type === 'proposal') keys.add(dayKeyOf(new Date(entry.start), timezone))
    }
    const allKeys = [...keys].sort()

    // bucketByDay spans multi-day events and orders each day by the clock, so a
    // proposal lands between the meetings it was planned around.
    const buckets = bucketByDay(entries, allKeys, timezone)

    return allKeys
      .map((dayKey) => ({ dayKey, entries: buckets.get(dayKey) ?? [] }))
      .filter((day) => day.entries.length > 0)
  }, [commitments, proposals, today, horizon, timezone])

  return (
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
        <header className="mb-5">
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-fg">
              Schedule
            </h1>
            <NotificationBell />
          </div>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-fg-muted">
            Pick what needs doing and {"we'll"} find the time for it around your
            meetings. Nothing goes on your calendar until you say so.
          </p>
          <p className="mt-1.5 text-xs text-fg-subtle">
            Working hours: {workingHoursSummary} ·{' '}
            <Link
              href="/settings/general"
              className="inline-target underline underline-offset-2"
            >
              change
            </Link>
          </p>
        </header>

        {error ? (
          <ErrorBanner
            className="mb-4"
            title="Could not build a plan"
            description={error}
            actions={
              <Button variant="secondary" size="sm" onClick={propose}>
                Try again
              </Button>
            }
          />
        ) : null}

        {/* `min-w-0` on both children: a grid item defaults to min-width:auto,
            so on one column a long task title widens the track past the
            viewport instead of wrapping. */}
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          {/* ------------------------------------------------ task picker */}
          <section aria-labelledby="schedule-tasks" className="min-w-0">
            <h2
              id="schedule-tasks"
              className="mb-2 text-[11px] font-medium uppercase tracking-wide text-fg-subtle"
            >
              Tasks to place
            </h2>

            <div className="rounded-lg border border-border bg-surface">
              {eligible.length === 0 ? (
                <EmptyState
                  compact
                  icon={<CalendarCheck />}
                  title="Nothing waiting"
                  description="Every task with an estimate already has a time block."
                  action={
                    <Button variant="secondary" size="sm" asChild>
                      <Link href="/tasks">Open tasks</Link>
                    </Button>
                  }
                />
              ) : (
                <ul className="space-y-px p-1">
                  {eligible.map((task) => (
                    <li key={task.id} className="flex items-start gap-2 pl-2">
                      <Checkbox
                        className="mt-2.5"
                        checked={!deselected.has(task.id)}
                        onCheckedChange={(checked) =>
                          setDeselected((current) => {
                            const next = new Set(current)
                            if (checked === true) next.delete(task.id)
                            else next.add(task.id)
                            return next
                          })
                        }
                        aria-label={`Include "${task.title}"`}
                      />
                      <div className="min-w-0 flex-1">
                        <TaskRow
                          task={task}
                          timezone={timezone}
                          draggable={false}
                          onToggle={() => {
                            /* completing from here would be a surprising side
                               effect of a planning screen */
                          }}
                          onOpen={() => router.push(`/tasks?task=${task.id}`)}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {needsEstimate.length > 0 ? (
              <div className="mt-3 rounded-lg border border-dashed border-border px-3 py-2.5">
                <p className="flex items-center gap-1.5 text-[13px] font-medium text-fg">
                  <Clock className="size-3.5 text-fg-subtle" aria-hidden="true" />
                  {needsEstimate.length} task
                  {needsEstimate.length === 1 ? '' : 's'} without an estimate
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-fg-muted">
                  We can only reserve time for a task once we know roughly how
                  long it takes.
                </p>
                <Button variant="secondary" size="sm" className="mt-2" asChild>
                  <Link href="/tasks">Add estimates</Link>
                </Button>
              </div>
            ) : null}

            <div className="mt-4 space-y-3 rounded-lg border border-border bg-surface p-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1">
                  <span className="block text-xs font-medium text-fg-muted">
                    Look ahead
                  </span>
                  <Select value={horizon} onValueChange={setHorizon}>
                    <SelectTrigger aria-label="Look ahead">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {/* Driven by the same list the page loads commitments for,
                          so a new option can never look further than the data. */}
                      {scheduleHorizons.map((days) => (
                        <SelectItem key={days} value={String(days)}>
                          {horizonLabel(days)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>

                <label className="space-y-1">
                  <span className="block text-xs font-medium text-fg-muted">
                    Longest sitting
                  </span>
                  <Select value={maxBlock} onValueChange={setMaxBlock}>
                    <SelectTrigger aria-label="Longest sitting">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="60">1 hour</SelectItem>
                      <SelectItem value="90">1.5 hours</SelectItem>
                      <SelectItem value="120">2 hours</SelectItem>
                      <SelectItem value="180">3 hours</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
              </div>

              <Button
                variant="primary"
                block
                loading={busy && proposals === null}
                disabled={selectedIds.length === 0}
                onClick={propose}
              >
                <Sparkles />
                Find time for {selectedIds.length} task{selectedIds.length === 1 ? '' : 's'}
              </Button>
            </div>
          </section>

          {/* -------------------------------------------------- proposals */}
          <section aria-labelledby="schedule-plan" className="min-w-0">
            <div className="mb-2 flex items-center justify-between">
              <h2
                id="schedule-plan"
                className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle"
              >
                Your week
              </h2>
              {proposals && proposals.length > 0 ? (
                <span className="text-xs text-fg-muted">
                  {acceptedCount} of {proposals.length} proposed ·{' '}
                  {formatDuration(acceptedMinutes)}
                </span>
              ) : null}
            </div>

            <div className="rounded-lg border border-border bg-surface">
              {busy && proposals === null ? (
                <ListSkeleton rows={5} className="p-3" />
              ) : byDay.length === 0 ? (
                <EmptyState
                  compact
                  icon={<CalendarRange />}
                  title="Nothing booked yet"
                  description={`Your calendar is empty for the next ${horizon} days. Anything you add shows up here.`}
                  action={
                    <Button variant="secondary" size="sm" asChild>
                      <Link href="/calendar">Open calendar</Link>
                    </Button>
                  }
                />
              ) : (
                <div className="p-1">
                  {byDay.map(({ dayKey, entries }) => (
                    <div key={dayKey} className="mb-2 last:mb-0">
                      <p className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
                        {formatDayLabel(dayKey, 'EEEE d MMMM')}
                      </p>
                      <ul className="space-y-px">
                        {entries.map((entry) =>
                          entry.type === 'proposal' ? (
                            <ProposalRow
                              key={entry.key}
                              proposal={entry.proposal}
                              dayKey={dayKey}
                              timezone={timezone}
                              use24h={use24h}
                              onToggle={(accepted) =>
                                setProposals(
                                  (current) =>
                                    current?.map((item) =>
                                      item === entry.proposal
                                        ? { ...item, accepted }
                                        : item,
                                    ) ?? null,
                                )
                              }
                            />
                          ) : (
                            <CommitmentRow
                              key={entry.key}
                              commitment={entry.commitment}
                              dayKey={dayKey}
                              timezone={timezone}
                              use24h={use24h}
                            />
                          ),
                        )}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {proposals && proposals.length === 0 ? (
              <div className="mt-3 rounded-lg border border-dashed border-border px-3 py-2.5">
                <p className="flex items-center gap-1.5 text-[13px] font-medium text-fg">
                  <TriangleAlert className="size-3.5 text-fg-subtle" aria-hidden="true" />
                  No free time found
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-fg-muted">
                  Your working hours are full for this stretch. Try looking
                  further ahead, or shorten the sittings.
                </p>
              </div>
            ) : null}

            {unplaced.length > 0 ? (
              <div className="mt-3 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2.5">
                <p className="flex items-center gap-1.5 text-[13px] font-medium text-fg">
                  <TriangleAlert className="size-3.5 text-warning" aria-hidden="true" />
                  {unplaced.length} could not be placed
                </p>
                <ul className="mt-1 space-y-0.5">
                  {unplaced.map((entry) => (
                    <li key={entry.taskId} className="text-xs text-fg-muted">
                      <span className="font-medium text-fg">{entry.title}</span> —{' '}
                      {entry.reason}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {proposals && proposals.length > 0 ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Select value={calendarId} onValueChange={setCalendarId}>
                  <SelectTrigger className="w-44" aria-label="Calendar for the blocks">
                    <SelectValue placeholder="Calendar" />
                  </SelectTrigger>
                  <SelectContent>
                    {writable.map((calendar) => (
                      <SelectItem key={calendar.id} value={calendar.id}>
                        {calendar.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Button
                  variant="primary"
                  loading={busy}
                  disabled={acceptedCount === 0}
                  onClick={apply}
                >
                  <Check />
                  Add {acceptedCount} block{acceptedCount === 1 ? '' : 's'}
                </Button>
                <Button variant="ghost" onClick={() => setProposals(null)}>
                  <X />
                  Discard
                </Button>
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  )
}

/**
 * Something already on the calendar. Read-only on purpose: this screen plans
 * around your commitments, it does not edit them — that is the calendar's job,
 * and the link goes there.
 */
function CommitmentRow({
  commitment,
  dayKey,
  timezone,
  use24h,
}: {
  commitment: ScheduleCommitment
  dayKey: string
  timezone: string
  use24h: boolean
}) {
  return (
    <li>
      <Link
        href={`/calendar?view=day&date=${dayKey}`}
        className="flex items-start gap-2.5 rounded-md px-2 py-2 transition-colors hover:bg-surface-2"
      >
        {/* Sits in the checkbox's column so both kinds of row line up. */}
        <span className="mt-1 flex w-4 shrink-0 justify-center" aria-hidden="true">
          <span
            className="size-2 rounded-full"
            style={{ backgroundColor: commitment.color }}
          />
        </span>
        <span className="w-24 shrink-0 text-[12px] tabular-nums text-fg-muted">
          {commitmentTimeLabel(commitment, dayKey, timezone, use24h)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] text-fg">
            {commitment.title}
          </span>
          <span className="mt-0.5 block text-[11px] text-fg-subtle">
            {commitment.kind === 'TASK_BLOCK'
              ? `${commitment.calendarName} · time blocked for a task`
              : commitment.calendarName}
          </span>
        </span>
      </Link>
    </li>
  )
}

/**
 * The part of a commitment that falls on one particular day.
 *
 * An event running from Saturday evening into Sunday night appears under both
 * days, so each row has to say which end of it you are looking at — otherwise
 * Sunday claims a party that started the day before.
 */
function commitmentTimeLabel(
  commitment: ScheduleCommitment,
  dayKey: string,
  timezone: string,
  use24h: boolean,
): string {
  if (commitment.allDay) return 'All day'

  const start = new Date(commitment.start)
  const end = new Date(commitment.end)
  const startsHere = dayKeyOf(start, timezone) === dayKey
  // An end at exactly midnight belongs to the day before, as it does elsewhere.
  const endsHere = dayKeyOf(new Date(end.getTime() - 1), timezone) === dayKey

  const from = formatTimeCompact(start, timezone, use24h)
  const until = formatTimeCompact(end, timezone, use24h)

  if (startsHere && endsHere) return `${from} – ${until}`
  if (startsHere) return `${from} →`
  if (endsHere) return `→ ${until}`
  return 'Whole day'
}

/** "1 week" reads better than "7 days" on the round numbers people pick. */
function horizonLabel(days: number): string {
  if (days === 7) return '1 week'
  if (days === 14) return '2 weeks'
  if (days === 30) return '1 month'
  return `${days} days`
}

/** A slot the planner suggests. Nothing happens until it is accepted. */
function ProposalRow({
  proposal,
  dayKey,
  timezone,
  use24h,
  onToggle,
}: {
  proposal: ProposalState
  dayKey: string
  timezone: string
  use24h: boolean
  onToggle: (accepted: boolean) => void
}) {
  return (
    <li
      className={cn(
        'flex items-start gap-2.5 rounded-md border border-dashed px-2 py-2 transition-colors',
        proposal.accepted
          ? 'border-accent/40 bg-accent-soft'
          : 'border-border opacity-50',
      )}
    >
      <Checkbox
        className="mt-0.5"
        checked={proposal.accepted}
        onCheckedChange={(checked) => onToggle(checked === true)}
        aria-label={`Accept ${proposal.taskTitle} on ${formatDayLabel(dayKey)}`}
      />
      <span className="w-24 shrink-0 text-[12px] tabular-nums text-fg-muted">
        {formatTimeCompact(new Date(proposal.start), timezone, use24h)}
        {' – '}
        {formatTimeCompact(new Date(proposal.end), timezone, use24h)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-fg">
            {proposal.taskTitle}
          </span>
          <Badge tone="neutral">{formatDuration(proposal.estimatedMinutes)}</Badge>
        </span>
        <span className="mt-0.5 block text-[11px] text-fg-muted">
          {proposal.reason}
        </span>
      </span>
    </li>
  )
}
