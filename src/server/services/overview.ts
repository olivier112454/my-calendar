import 'server-only'
import { prisma } from '@/lib/db'
import {
  addDaysToKey,
  endOfDayUtc,
  startOfDayUtc,
  todayKey,
} from '@/lib/datetime'
import type { EventOccurrence, TaskSummary } from '@/types/domain'
import { listOccurrences } from './events'
import { listTasks } from './tasks'

/**
 * Everything the Today page and the context panel need, resolved in one place
 * so the two never disagree about what "today" contains.
 */

export interface DayOverview {
  dayKey: string
  timezone: string
  events: EventOccurrence[]
  /** Events still to come, including one currently running. */
  upcoming: EventOccurrence[]
  current: EventOccurrence | null
  next: EventOccurrence | null
  tasksDue: TaskSummary[]
  tasksScheduled: TaskSummary[]
  unscheduledTasks: TaskSummary[]
  tomorrow: EventOccurrence[]
  stats: {
    meetings: number
    meetingMinutes: number
    focusMinutes: number
    freeMinutes: number
    firstStart: string | null
    lastEnd: string | null
  }
}

export async function getDayOverview(
  userId: string,
  userEmail: string,
  timezone: string,
  dayKey?: string,
): Promise<DayOverview> {
  const key = dayKey ?? todayKey(timezone)
  const from = startOfDayUtc(key, timezone)
  const to = endOfDayUtc(key, timezone)

  const [events, tomorrow, allTasks] = await Promise.all([
    listOccurrences(userId, {
      from,
      to,
      onlyVisibleCalendars: true,
      includeDeclined: false,
      userEmail,
    }),
    listOccurrences(userId, {
      from: to,
      to: endOfDayUtc(addDaysToKey(key, 1), timezone),
      onlyVisibleCalendars: true,
      includeDeclined: false,
      userEmail,
    }),
    listTasks(userId, { timezone }),
  ])

  const now = Date.now()
  const timed = events.filter((event) => !event.allDay)

  const current =
    timed.find(
      (event) => Date.parse(event.start) <= now && Date.parse(event.end) > now,
    ) ?? null

  const upcoming = events.filter((event) => Date.parse(event.end) > now)
  const next = timed.find((event) => Date.parse(event.start) > now) ?? null

  const dueBoundary = to.getTime()
  const tasksDue = allTasks.filter(
    (task) => task.dueAt !== null && Date.parse(task.dueAt) < dueBoundary,
  )
  const tasksScheduled = allTasks.filter(
    (task) =>
      task.timeBlockStart !== null &&
      Date.parse(task.timeBlockStart) >= from.getTime() &&
      Date.parse(task.timeBlockStart) < dueBoundary,
  )
  const unscheduledTasks = allTasks.filter(
    (task) => task.timeBlockStart === null && task.status !== 'DONE',
  )

  return {
    dayKey: key,
    timezone,
    events,
    upcoming,
    current,
    next,
    tasksDue,
    tasksScheduled,
    unscheduledTasks,
    tomorrow,
    stats: summarise(timed),
  }
}

function summarise(timed: EventOccurrence[]): DayOverview['stats'] {
  let meetingMinutes = 0
  let focusMinutes = 0
  let meetings = 0
  let firstStart: number | null = null
  let lastEnd: number | null = null

  for (const event of timed) {
    const start = Date.parse(event.start)
    const end = Date.parse(event.end)
    const minutes = Math.max(0, Math.round((end - start) / 60_000))

    if (firstStart === null || start < firstStart) firstStart = start
    if (lastEnd === null || end > lastEnd) lastEnd = end

    if (event.kind === 'FOCUS' || event.kind === 'TASK_BLOCK') {
      focusMinutes += minutes
    } else if (event.transparency === 'BUSY' && event.status !== 'CANCELLED') {
      meetingMinutes += minutes
      // A "meeting" is something with other people in it; a solo block is not.
      if (event.attendeeCount > 0) meetings += 1
    }
  }

  const busySpan =
    firstStart !== null && lastEnd !== null
      ? Math.round((lastEnd - firstStart) / 60_000)
      : 0

  return {
    meetings,
    meetingMinutes,
    focusMinutes,
    freeMinutes: Math.max(0, busySpan - meetingMinutes - focusMinutes),
    firstStart: firstStart !== null ? new Date(firstStart).toISOString() : null,
    lastEnd: lastEnd !== null ? new Date(lastEnd).toISOString() : null,
  }
}

/** Greeting matched to the local hour — small, but it makes the page feel awake. */
export function greeting(timezone: string, at = new Date()): string {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      hour12: false,
    }).format(at),
  )
  if (hour < 6) return 'Still up'
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

export { prisma }
