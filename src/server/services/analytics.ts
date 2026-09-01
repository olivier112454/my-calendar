import 'server-only'
import { prisma } from '@/lib/db'
import {
  addDaysToKey,
  dayKeyOf,
  endOfDayUtc,
  startOfDayUtc,
  startOfWeekKey,
  todayKey,
} from '@/lib/datetime'
import { listOccurrences } from './events'

/**
 * Analytics over real data.
 *
 * Everything here is computed from the user's own events and tasks — there are
 * no illustrative numbers anywhere. That constraint is why the empty state
 * matters: a new account genuinely has nothing to show, and saying so is more
 * useful than a chart of invented data.
 */

export interface AnalyticsRange {
  /** Inclusive first day. */
  fromDayKey: string
  /** Inclusive last day. */
  toDayKey: string
  label: string
}

export interface AnalyticsResult {
  range: AnalyticsRange
  totals: {
    meetings: number
    meetingMinutes: number
    focusMinutes: number
    taskBlockMinutes: number
    tasksCompleted: number
    tasksCreated: number
    /** Longest run of consecutive minutes with nothing booked, in working hours. */
    longestFreeStretchMinutes: number
    busiestDayKey: string | null
  }
  /** One entry per day in the range, for the bar chart. */
  perDay: {
    dayKey: string
    meetingMinutes: number
    focusMinutes: number
    tasksCompleted: number
  }[]
  /** Time split by category, largest first. */
  byCategory: { name: string; color: string; minutes: number }[]
  /** Time split by calendar. */
  byCalendar: { name: string; color: string; minutes: number }[]
  /** Who you spend the most time with. */
  topPeople: { email: string; name: string | null; meetings: number; minutes: number }[]
  /** Average load per weekday, to show where the week is heavy. */
  byWeekday: { weekday: number; meetingMinutes: number }[]
}

export type RangePreset = 'week' | 'month' | 'quarter'

export function resolveRange(
  preset: RangePreset,
  timezone: string,
  weekStartsOn: number,
): AnalyticsRange {
  const today = todayKey(timezone)

  if (preset === 'week') {
    const start = startOfWeekKey(today, weekStartsOn)
    return { fromDayKey: start, toDayKey: addDaysToKey(start, 6), label: 'This week' }
  }
  if (preset === 'month') {
    return {
      fromDayKey: `${today.slice(0, 7)}-01`,
      toDayKey: today,
      label: 'This month',
    }
  }
  return {
    fromDayKey: addDaysToKey(today, -89),
    toDayKey: today,
    label: 'Last 90 days',
  }
}

export async function computeAnalytics(
  userId: string,
  userEmail: string,
  timezone: string,
  range: AnalyticsRange,
): Promise<AnalyticsResult> {
  const from = startOfDayUtc(range.fromDayKey, timezone)
  const to = endOfDayUtc(range.toDayKey, timezone)

  const [events, tasksCompleted, tasksCreated, categories, calendars] = await Promise.all([
    listOccurrences(userId, {
      from,
      to,
      onlyVisibleCalendars: false,
      includeDeclined: false,
      userEmail,
    }),
    prisma.task.count({
      where: { userId, status: 'DONE', completedAt: { gte: from, lt: to } },
    }),
    prisma.task.count({ where: { userId, createdAt: { gte: from, lt: to } } }),
    prisma.category.findMany({
      where: { userId },
      select: { id: true, name: true, color: true },
    }),
    prisma.calendar.findMany({
      where: { userId },
      select: { id: true, name: true, color: true },
    }),
  ])

  const categoryById = new Map(categories.map((entry) => [entry.id, entry]))
  const calendarById = new Map(calendars.map((entry) => [entry.id, entry]))

  const dayKeys: string[] = []
  for (
    let key = range.fromDayKey;
    key <= range.toDayKey;
    key = addDaysToKey(key, 1)
  ) {
    dayKeys.push(key)
    if (dayKeys.length > 400) break
  }

  const perDay = new Map(
    dayKeys.map((dayKey) => [
      dayKey,
      { dayKey, meetingMinutes: 0, focusMinutes: 0, tasksCompleted: 0 },
    ]),
  )

  const categoryMinutes = new Map<string, number>()
  const calendarMinutes = new Map<string, number>()
  const weekdayMinutes = new Map<number, number>()

  let meetings = 0
  let meetingMinutes = 0
  let focusMinutes = 0
  let taskBlockMinutes = 0

  for (const event of events) {
    if (event.allDay) continue
    if (event.status === 'CANCELLED') continue
    if (event.kind === 'BIRTHDAY' || event.kind === 'HOLIDAY') continue

    const start = new Date(event.start)
    const minutes = Math.max(
      0,
      Math.round((Date.parse(event.end) - start.getTime()) / 60_000),
    )
    const dayKey = dayKeyOf(start, timezone)
    const bucket = perDay.get(dayKey)

    if (event.kind === 'FOCUS') {
      focusMinutes += minutes
      if (bucket) bucket.focusMinutes += minutes
    } else if (event.kind === 'TASK_BLOCK') {
      taskBlockMinutes += minutes
      if (bucket) bucket.focusMinutes += minutes
    } else if (event.transparency === 'BUSY') {
      meetingMinutes += minutes
      if (bucket) bucket.meetingMinutes += minutes
      // "Meeting" means other people were involved; a solo block is not one.
      if (event.attendeeCount > 0) meetings += 1

      const weekday = new Date(`${dayKey}T12:00:00`).getDay()
      weekdayMinutes.set(weekday, (weekdayMinutes.get(weekday) ?? 0) + minutes)
    }

    if (event.categoryId) {
      categoryMinutes.set(
        event.categoryId,
        (categoryMinutes.get(event.categoryId) ?? 0) + minutes,
      )
    }
    calendarMinutes.set(
      event.calendarId,
      (calendarMinutes.get(event.calendarId) ?? 0) + minutes,
    )
  }

  // Completed tasks per day, in one grouped read.
  const completedRows = await prisma.task.findMany({
    where: { userId, status: 'DONE', completedAt: { gte: from, lt: to } },
    select: { completedAt: true },
  })
  for (const row of completedRows) {
    if (!row.completedAt) continue
    const bucket = perDay.get(dayKeyOf(row.completedAt, timezone))
    if (bucket) bucket.tasksCompleted += 1
  }

  const topPeople = await computeTopPeople(userId, userEmail, from, to)

  const busiest = [...perDay.values()].reduce<{ dayKey: string; minutes: number } | null>(
    (best, entry) =>
      !best || entry.meetingMinutes > best.minutes
        ? { dayKey: entry.dayKey, minutes: entry.meetingMinutes }
        : best,
    null,
  )

  return {
    range,
    totals: {
      meetings,
      meetingMinutes,
      focusMinutes,
      taskBlockMinutes,
      tasksCompleted,
      tasksCreated,
      longestFreeStretchMinutes: longestFreeStretch(events, timezone),
      busiestDayKey: busiest && busiest.minutes > 0 ? busiest.dayKey : null,
    },
    perDay: [...perDay.values()],
    byCategory: [...categoryMinutes.entries()]
      .map(([id, minutes]) => ({
        name: categoryById.get(id)?.name ?? 'Uncategorised',
        color: categoryById.get(id)?.color ?? '#64748b',
        minutes,
      }))
      .sort((a, b) => b.minutes - a.minutes),
    byCalendar: [...calendarMinutes.entries()]
      .map(([id, minutes]) => ({
        name: calendarById.get(id)?.name ?? 'Unknown',
        color: calendarById.get(id)?.color ?? '#64748b',
        minutes,
      }))
      .sort((a, b) => b.minutes - a.minutes),
    topPeople,
    byWeekday: Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      meetingMinutes: weekdayMinutes.get(weekday) ?? 0,
    })),
  }
}

/** Who the user actually spends time with, by shared meeting minutes. */
async function computeTopPeople(
  userId: string,
  userEmail: string,
  from: Date,
  to: Date,
) {
  const attendees = await prisma.eventAttendee.findMany({
    where: {
      event: { userId, startAt: { gte: from, lt: to }, status: { not: 'CANCELLED' } },
      email: { not: userEmail.toLowerCase() },
      response: { not: 'DECLINED' },
    },
    select: {
      email: true,
      name: true,
      event: { select: { startAt: true, endAt: true } },
    },
  })

  const byEmail = new Map<
    string,
    { email: string; name: string | null; meetings: number; minutes: number }
  >()

  for (const attendee of attendees) {
    const minutes = Math.round(
      (attendee.event.endAt.getTime() - attendee.event.startAt.getTime()) / 60_000,
    )
    const existing = byEmail.get(attendee.email)
    if (existing) {
      existing.meetings += 1
      existing.minutes += minutes
      existing.name ??= attendee.name
    } else {
      byEmail.set(attendee.email, {
        email: attendee.email,
        name: attendee.name,
        meetings: 1,
        minutes,
      })
    }
  }

  return [...byEmail.values()].sort((a, b) => b.minutes - a.minutes).slice(0, 8)
}

/**
 * The longest uninterrupted gap between commitments in the range. A proxy for
 * whether the week has room for real work in it, rather than only slivers.
 */
function longestFreeStretch(
  events: { start: string; end: string; allDay: boolean; transparency: string }[],
  _timezone: string,
): number {
  const busy = events
    .filter((event) => !event.allDay && event.transparency === 'BUSY')
    .map((event) => ({ start: Date.parse(event.start), end: Date.parse(event.end) }))
    .sort((a, b) => a.start - b.start)

  if (busy.length < 2) return 0

  let longest = 0
  let cursor = busy[0]!.end

  for (const entry of busy.slice(1)) {
    if (entry.start > cursor) {
      const gap = Math.round((entry.start - cursor) / 60_000)
      // Ignore overnight gaps — nobody counts sleeping as focus time.
      if (gap < 14 * 60) longest = Math.max(longest, gap)
    }
    cursor = Math.max(cursor, entry.end)
  }

  return longest
}
