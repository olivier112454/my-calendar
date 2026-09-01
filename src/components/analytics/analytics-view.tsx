'use client'

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { BarChart3, Table2 } from 'lucide-react'
import { formatDayLabel, formatDuration } from '@/lib/datetime'
import { initials } from '@/lib/utils'
import type { AnalyticsResult, RangePreset } from '@/server/services/analytics'
import { Button } from '@/components/ui/button'
import { SegmentedControl } from '@/components/ui/controls'
import { EmptyState } from '@/components/ui/states'
import { NotificationBell } from '@/components/layout/notification-bell'
import { DailyLoadChart, StatTile, TimeByBars, WeekdayHeat } from './charts'

/**
 * Analytics.
 *
 * Every figure is computed from the user's own events and tasks. A new account
 * has nothing to show, and the page says so rather than filling the space with
 * a demonstration chart.
 *
 * A table view sits behind a toggle: it is the accessible equivalent of the
 * bars, and it is also the fastest way to read exact numbers.
 */
export function AnalyticsView({
  analytics,
  preset,
  weekStartsOn,
}: {
  analytics: AnalyticsResult
  preset: RangePreset
  weekStartsOn: number
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [showTable, setShowTable] = React.useState(false)

  const setPreset = (next: RangePreset) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('range', next)
    router.replace(`?${params.toString()}`, { scroll: false })
  }

  const { totals, perDay } = analytics
  const hasData =
    totals.meetingMinutes > 0 || totals.focusMinutes > 0 || totals.tasksCompleted > 0

  const bookedMinutes = totals.meetingMinutes + totals.focusMinutes
  const focusShare =
    bookedMinutes > 0 ? Math.round((totals.focusMinutes / bookedMinutes) * 100) : 0

  return (
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
        <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-fg">
              Analytics
            </h1>
            <p className="mt-1 text-[13px] text-fg-muted">
              {analytics.range.label} · {formatDayLabel(analytics.range.fromDayKey, 'd MMM')} –{' '}
              {formatDayLabel(analytics.range.toDayKey, 'd MMM')}
            </p>
          </div>

          <div className="flex items-center gap-1.5">
            <NotificationBell />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowTable((value) => !value)}
              aria-pressed={showTable}
              aria-label={showTable ? 'Show charts' : 'Show as a table'}
              title={showTable ? 'Show charts' : 'Show as a table'}
            >
              {showTable ? <BarChart3 /> : <Table2 />}
            </Button>
            <SegmentedControl
              label="Time range"
              value={preset}
              onValueChange={setPreset}
              options={[
                { value: 'week', label: 'Week' },
                { value: 'month', label: 'Month' },
                { value: 'quarter', label: '90 days' },
              ]}
            />
          </div>
        </header>

        {!hasData ? (
          <div className="rounded-lg border border-border bg-surface">
            <EmptyState
              icon={<BarChart3 />}
              title="Nothing to measure yet"
              description="Once you have events and completed tasks in this period, this page shows where your time actually went."
            />
          </div>
        ) : (
          <>
            <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatTile
                label="Meetings"
                value={String(totals.meetings)}
                hint={
                  totals.busiestDayKey
                    ? `Busiest: ${formatDayLabel(totals.busiestDayKey, 'EEEE')}`
                    : undefined
                }
              />
              {/* Not "in meetings": this is every busy appointment, including
                  the ones with no guests, which the Meetings count excludes. */}
              <StatTile
                label="In appointments"
                value={formatDuration(totals.meetingMinutes)}
                hint={`${100 - focusShare}% of booked time`}
              />
              <StatTile
                label="Focus time"
                value={formatDuration(totals.focusMinutes)}
                hint={`${focusShare}% of booked time`}
              />
              <StatTile
                label="Tasks completed"
                value={String(totals.tasksCompleted)}
                hint={`${totals.tasksCreated} added`}
              />
            </div>

            {showTable ? (
              <DataTable analytics={analytics} />
            ) : (
              <div className="space-y-5">
                <section className="rounded-lg border border-border bg-surface px-4 py-4">
                  <h2 className="mb-3 text-[13px] font-medium text-fg">
                    Booked time per day
                  </h2>
                  <DailyLoadChart data={perDay} />
                </section>

                <div className="grid gap-5 lg:grid-cols-2">
                  <section className="rounded-lg border border-border bg-surface px-4 py-4">
                    <h2 className="mb-3 text-[13px] font-medium text-fg">
                      Time by category
                    </h2>
                    <TimeByBars
                      data={analytics.byCategory}
                      emptyLabel="No events have a category yet."
                    />
                  </section>

                  <section className="rounded-lg border border-border bg-surface px-4 py-4">
                    <h2 className="mb-3 text-[13px] font-medium text-fg">
                      Time by calendar
                    </h2>
                    <TimeByBars
                      data={analytics.byCalendar}
                      emptyLabel="Nothing scheduled in this period."
                    />
                  </section>

                  <section className="rounded-lg border border-border bg-surface px-4 py-4">
                    <h2 className="mb-3 text-[13px] font-medium text-fg">
                      Appointment load by weekday
                    </h2>
                    <WeekdayHeat
                      data={analytics.byWeekday}
                      weekStartsOn={weekStartsOn}
                    />
                    {totals.longestFreeStretchMinutes > 0 ? (
                      <p className="mt-3 text-[11px] leading-relaxed text-fg-muted">
                        Longest uninterrupted stretch in this period:{' '}
                        <span className="font-medium text-fg">
                          {formatDuration(totals.longestFreeStretchMinutes)}
                        </span>
                        .
                      </p>
                    ) : null}
                  </section>

                  <section className="rounded-lg border border-border bg-surface px-4 py-4">
                    <h2 className="mb-3 text-[13px] font-medium text-fg">
                      Who you meet most
                    </h2>
                    {analytics.topPeople.length === 0 ? (
                      <p className="py-6 text-center text-[13px] text-fg-muted">
                        No meetings with guests in this period.
                      </p>
                    ) : (
                      <ul className="space-y-2">
                        {analytics.topPeople.map((person) => (
                          <li key={person.email} className="flex items-center gap-2.5">
                            <span
                              aria-hidden="true"
                              className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[10px] font-medium text-fg-muted"
                            >
                              {initials(person.name ?? person.email)}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[13px] text-fg">
                                {person.name ?? person.email}
                              </span>
                              <span className="block text-[11px] text-fg-subtle">
                                {person.meetings} meeting
                                {person.meetings === 1 ? '' : 's'}
                              </span>
                            </span>
                            <span className="shrink-0 text-[12px] tabular-nums text-fg-muted">
                              {formatDuration(person.minutes)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/** The same figures as a table — the accessible equivalent of the charts. */
function DataTable({ analytics }: { analytics: AnalyticsResult }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="w-full min-w-[28rem] text-left text-[13px]">
        <caption className="sr-only">
          Booked time and completed tasks per day for {analytics.range.label}.
        </caption>
        <thead>
          <tr className="border-b border-border text-[11px] uppercase tracking-wide text-fg-subtle">
            <th scope="col" className="px-4 py-2 font-medium">
              Day
            </th>
            <th scope="col" className="px-4 py-2 text-right font-medium">
              Appointments
            </th>
            <th scope="col" className="px-4 py-2 text-right font-medium">
              Focus
            </th>
            <th scope="col" className="px-4 py-2 text-right font-medium">
              Tasks done
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {analytics.perDay.map((entry) => (
            <tr key={entry.dayKey}>
              <th scope="row" className="px-4 py-2 font-normal text-fg">
                {formatDayLabel(entry.dayKey, 'EEE d MMM')}
              </th>
              <td className="px-4 py-2 text-right tabular-nums text-fg-muted">
                {entry.meetingMinutes > 0 ? formatDuration(entry.meetingMinutes) : '—'}
              </td>
              <td className="px-4 py-2 text-right tabular-nums text-fg-muted">
                {entry.focusMinutes > 0 ? formatDuration(entry.focusMinutes) : '—'}
              </td>
              <td className="px-4 py-2 text-right tabular-nums text-fg-muted">
                {entry.tasksCompleted > 0 ? entry.tasksCompleted : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
