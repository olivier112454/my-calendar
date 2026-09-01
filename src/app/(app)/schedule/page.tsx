import type { Metadata } from 'next'
import { prisma } from '@/lib/db'
import { ensureSettings, requireUserPage } from '@/lib/auth'
import { listTasks } from '@/server/services/tasks'
import { listCalendars } from '@/server/services/calendars'
import { listOccurrences } from '@/server/services/events'
import { addDaysToKey, endOfDayUtc, startOfDayUtc, todayKey } from '@/lib/datetime'
import type { ScheduleCommitment } from '@/types/domain'
import { maxScheduleHorizonDays } from '@/config/app'
import { ScheduleView } from '@/components/schedule/schedule-view'

export const metadata: Metadata = { title: 'Schedule' }

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default async function SchedulePage() {
  const user = await requireUserPage('/schedule')

  // The whole span the longest horizon can reach, fetched once. Changing the
  // horizon then filters what is already here rather than making a round trip.
  const from = todayKey(user.timezone)

  const [settings, tasks, calendars, workingHours, occurrences] = await Promise.all([
    ensureSettings(user.id),
    listTasks(user.id, { timezone: user.timezone }),
    listCalendars(user.id),
    prisma.workingHours.findMany({
      where: { userId: user.id },
      orderBy: { weekday: 'asc' },
    }),
    listOccurrences(user.id, {
      from: startOfDayUtc(from, user.timezone),
      to: endOfDayUtc(addDaysToKey(from, maxScheduleHorizonDays - 1), user.timezone),
      onlyVisibleCalendars: false,
      includeDeclined: false,
      userEmail: user.email,
    }),
  ])

  const unscheduled = tasks.filter(
    (task) => task.status !== 'DONE' && task.timeBlockId === null,
  )

  const commitments: ScheduleCommitment[] = occurrences
    .filter((occurrence) => occurrence.status !== 'CANCELLED')
    .map((occurrence) => ({
      occurrenceId: occurrence.occurrenceId,
      eventId: occurrence.eventId,
      title: occurrence.title,
      start: occurrence.start,
      end: occurrence.end,
      allDay: occurrence.allDay,
      color: occurrence.color,
      calendarName: occurrence.calendarName,
      kind: occurrence.kind,
    }))

  return (
    <ScheduleView
      unscheduled={unscheduled}
      commitments={commitments}
      calendars={calendars}
      timezone={user.timezone}
      today={from}
      use24h={settings.timeFormat24h}
      workingHoursSummary={summariseWorkingHours(workingHours)}
    />
  )
}

/** "Mon–Fri 09:00–17:30" when the week is uniform, otherwise a per-day list. */
function summariseWorkingHours(
  hours: { weekday: number; startMinute: number; endMinute: number; enabled: boolean }[],
): string {
  const enabled = hours.filter((entry) => entry.enabled)
  if (enabled.length === 0) return 'none set'

  const clock = (minutes: number) =>
    `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

  const uniform = enabled.every(
    (entry) =>
      entry.startMinute === enabled[0]!.startMinute &&
      entry.endMinute === enabled[0]!.endMinute,
  )

  if (uniform) {
    const days = enabled.map((entry) => entry.weekday).sort((a, b) => a - b)
    const contiguous = days.every((day, index) => index === 0 || day === days[index - 1]! + 1)
    const label = contiguous
      ? `${DAY_NAMES[days[0]!]}–${DAY_NAMES[days[days.length - 1]!]}`
      : days.map((day) => DAY_NAMES[day]).join(', ')
    return `${label} ${clock(enabled[0]!.startMinute)}–${clock(enabled[0]!.endMinute)}`
  }

  return enabled
    .map((entry) => `${DAY_NAMES[entry.weekday]} ${clock(entry.startMinute)}–${clock(entry.endMinute)}`)
    .join(', ')
}
