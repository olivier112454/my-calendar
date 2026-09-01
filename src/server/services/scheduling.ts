import 'server-only'
import { prisma } from '@/lib/db'
import {
  addDaysToKey,
  endOfDayUtc,
  minutesIntoDay,
  startOfDayUtc,
  todayKey,
  wallToUtc,
} from '@/lib/datetime'
import type { SchedulingProposal, TaskPriority } from '@/types/domain'
import { listOccurrences } from './events'
import { listTasks } from './tasks'
import { scheduleTask } from './tasks'

/**
 * Automatic scheduling.
 *
 * Given the tasks that still need doing and the time that is actually free,
 * this proposes when to do them. It never writes: `propose` returns a plan and
 * the user accepts the parts they want. Anything that silently rearranges
 * someone's week loses their trust the first time it gets one slot wrong.
 *
 * The algorithm is greedy, earliest-fit, in priority-then-deadline order:
 *
 *  1. Build the free/busy picture from working hours minus existing events.
 *  2. Sort tasks: nearest deadline first, then priority, then longest.
 *  3. Place each task in the earliest slot that fits and still beats its
 *     deadline, splitting long tasks into sittings.
 *
 * Greedy is the right choice here, not a compromise: the plan has to be
 * explainable ("Wednesday morning, because it is the first free two hours before
 * Friday"), and an optimal solver's output rarely is.
 */

export interface SchedulingOptions {
  /** First day to consider; defaults to today. */
  fromDayKey?: string
  /** How many days ahead to look. */
  horizonDays?: number
  /** Longest single sitting, in minutes. */
  maxBlockMinutes?: number
  /** Shortest useful sitting when splitting. */
  minBlockMinutes?: number
  /** Gap left either side of an existing event. */
  bufferMinutes?: number
  /** Restrict to these tasks; otherwise every unscheduled task is considered. */
  taskIds?: string[]
}

interface FreeSlot {
  /** Minutes since the epoch, kept as instants throughout. */
  start: number
  end: number
}

export async function proposeSchedule(
  userId: string,
  userEmail: string,
  timezone: string,
  options: SchedulingOptions = {},
): Promise<{ proposals: SchedulingProposal[]; unplaced: { taskId: string; title: string; reason: string }[] }> {
  const fromDayKey = options.fromDayKey ?? todayKey(timezone)
  const horizonDays = options.horizonDays ?? 14
  const maxBlock = options.maxBlockMinutes ?? 120
  const minBlock = options.minBlockMinutes ?? 30

  const settings = await prisma.userSettings.findUnique({ where: { userId } })
  const buffer = options.bufferMinutes ?? settings?.bufferMinutes ?? 15

  const workingHours = await prisma.workingHours.findMany({
    where: { userId },
    orderBy: { weekday: 'asc' },
  })

  const rangeStart = startOfDayUtc(fromDayKey, timezone)
  const rangeEnd = endOfDayUtc(addDaysToKey(fromDayKey, horizonDays - 1), timezone)

  const [events, tasks] = await Promise.all([
    listOccurrences(userId, {
      from: rangeStart,
      to: rangeEnd,
      onlyVisibleCalendars: false,
      includeDeclined: false,
      userEmail,
    }),
    listTasks(userId, { timezone }),
  ])

  const candidates = tasks
    .filter((task) => task.status !== 'DONE')
    .filter((task) => task.timeBlockId === null)
    .filter((task) => (options.taskIds ? options.taskIds.includes(task.id) : true))
    .filter((task) => (task.estimatedMinutes ?? 0) >= 5)
    .sort(compareTasks)

  // Free time, day by day, with existing commitments carved out.
  let slots = buildFreeSlots({
    fromDayKey,
    horizonDays,
    timezone,
    workingHours: workingHours.map((entry) => ({
      weekday: entry.weekday,
      startMinute: entry.startMinute,
      endMinute: entry.endMinute,
      enabled: entry.enabled,
    })),
    busy: events
      .filter((event) => !event.allDay)
      .filter((event) => event.transparency === 'BUSY')
      .filter((event) => event.status !== 'CANCELLED')
      .map((event) => ({
        start: Date.parse(event.start) - buffer * 60_000,
        end: Date.parse(event.end) + buffer * 60_000,
      })),
    // Nothing is proposed in the past.
    notBefore: Math.max(Date.now(), rangeStart.getTime()),
  })

  const proposals: SchedulingProposal[] = []
  const unplaced: { taskId: string; title: string; reason: string }[] = []

  for (const task of candidates) {
    let remaining = task.estimatedMinutes!
    const deadline = task.dueAt ? Date.parse(task.dueAt) : Number.POSITIVE_INFINITY
    let placedAny = false
    let sitting = 0

    while (remaining >= minBlock || (remaining > 0 && !placedAny)) {
      const wanted = Math.min(remaining, maxBlock)
      const placement = findSlot(slots, wanted, deadline, minBlock)

      if (!placement) {
        unplaced.push({
          taskId: task.id,
          title: task.title,
          reason: placedAny
            ? 'Only part of it fits before the deadline'
            : task.dueAt
              ? 'No free time before the deadline'
              : 'No free time in the next two weeks',
        })
        break
      }

      const { start, minutes } = placement
      const end = start + minutes * 60_000
      sitting += 1

      proposals.push({
        taskId: task.id,
        taskTitle: task.title,
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
        reason: explain(task, start, deadline, sitting, remaining > minutes),
        priority: task.priority,
        estimatedMinutes: minutes,
      })

      slots = consume(slots, start, end, buffer)
      remaining -= minutes
      placedAny = true

      if (remaining < minBlock) break
    }
  }

  return { proposals, unplaced }
}

/* --------------------------------------------------------------- ordering */

const PRIORITY_RANK: Record<TaskPriority, number> = { P1: 0, P2: 1, P3: 2, P4: 3 }

function compareTasks(
  a: { dueAt: string | null; priority: TaskPriority; estimatedMinutes: number | null },
  b: { dueAt: string | null; priority: TaskPriority; estimatedMinutes: number | null },
): number {
  // A deadline beats a preference: an undated P1 should not push out a P3 due
  // tomorrow, because only one of them has a consequence for being late.
  const aDue = a.dueAt ? Date.parse(a.dueAt) : Number.POSITIVE_INFINITY
  const bDue = b.dueAt ? Date.parse(b.dueAt) : Number.POSITIVE_INFINITY
  if (aDue !== bDue) return aDue - bDue

  const byPriority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
  if (byPriority !== 0) return byPriority

  // Longest first among equals: big blocks are harder to place later.
  return (b.estimatedMinutes ?? 0) - (a.estimatedMinutes ?? 0)
}

/* ------------------------------------------------------------- free slots */

interface BuildOptions {
  fromDayKey: string
  horizonDays: number
  timezone: string
  workingHours: {
    weekday: number
    startMinute: number
    endMinute: number
    enabled: boolean
  }[]
  busy: { start: number; end: number }[]
  notBefore: number
}

export function buildFreeSlots(options: BuildOptions): FreeSlot[] {
  const byWeekday = new Map(options.workingHours.map((entry) => [entry.weekday, entry]))
  const slots: FreeSlot[] = []

  for (let offset = 0; offset < options.horizonDays; offset++) {
    const dayKey = addDaysToKey(options.fromDayKey, offset)
    const weekday = new Date(`${dayKey}T12:00:00`).getDay()
    const hours = byWeekday.get(weekday)
    if (!hours?.enabled) continue

    const dayStart = wallToUtc(
      `${dayKey}T${minutesToClock(hours.startMinute)}`,
      options.timezone,
    ).getTime()
    const dayEnd = wallToUtc(
      `${dayKey}T${minutesToClock(hours.endMinute)}`,
      options.timezone,
    ).getTime()

    let cursor = Math.max(dayStart, options.notBefore)
    if (cursor >= dayEnd) continue

    const overlapping = options.busy
      .filter((entry) => entry.end > cursor && entry.start < dayEnd)
      .sort((a, b) => a.start - b.start)

    for (const entry of overlapping) {
      if (entry.start > cursor) {
        slots.push({ start: cursor, end: Math.min(entry.start, dayEnd) })
      }
      cursor = Math.max(cursor, entry.end)
      if (cursor >= dayEnd) break
    }

    if (cursor < dayEnd) slots.push({ start: cursor, end: dayEnd })
  }

  return slots.filter((slot) => slot.end - slot.start >= 5 * 60_000)
}

function minutesToClock(minutes: number): string {
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0')
  const mm = String(minutes % 60).padStart(2, '0')
  return `${hh}:${mm}`
}

/**
 * Earliest slot that fits. Prefers a whole sitting; falls back to a shorter one
 * when nothing longer is available before the deadline, so a task with a tight
 * deadline still gets started.
 */
function findSlot(
  slots: FreeSlot[],
  wantedMinutes: number,
  deadline: number,
  minMinutes: number,
): { start: number; minutes: number } | null {
  const wantedMs = wantedMinutes * 60_000

  for (const slot of slots) {
    if (slot.start >= deadline) continue
    const usableEnd = Math.min(slot.end, deadline)
    const available = usableEnd - slot.start
    if (available >= wantedMs) return { start: slot.start, minutes: wantedMinutes }
  }

  for (const slot of slots) {
    if (slot.start >= deadline) continue
    const usableEnd = Math.min(slot.end, deadline)
    const available = Math.floor((usableEnd - slot.start) / 60_000)
    if (available >= minMinutes) {
      // Round down to a quarter hour so proposals land on tidy times.
      const minutes = Math.floor(Math.min(available, wantedMinutes) / 15) * 15
      if (minutes >= minMinutes) return { start: slot.start, minutes }
    }
  }

  return null
}

/** Removes a booked range from the free list, keeping the leftovers usable. */
function consume(
  slots: FreeSlot[],
  start: number,
  end: number,
  bufferMinutes: number,
): FreeSlot[] {
  const paddedEnd = end + bufferMinutes * 60_000
  const out: FreeSlot[] = []

  for (const slot of slots) {
    if (slot.end <= start || slot.start >= paddedEnd) {
      out.push(slot)
      continue
    }
    if (slot.start < start) out.push({ start: slot.start, end: start })
    if (slot.end > paddedEnd) out.push({ start: paddedEnd, end: slot.end })
  }

  return out.filter((slot) => slot.end - slot.start >= 5 * 60_000)
}

/** Human reason shown next to each proposal, so the plan is arguable. */
function explain(
  task: { dueAt: string | null; priority: TaskPriority },
  start: number,
  deadline: number,
  sitting: number,
  willContinue: boolean,
): string {
  const when = new Date(start).toLocaleDateString('en-GB', {
    weekday: 'long',
  })
  const partOfDay =
    new Date(start).getHours() < 12
      ? 'morning'
      : new Date(start).getHours() < 17
        ? 'afternoon'
        : 'evening'

  if (sitting > 1 || willContinue) {
    return `${when} ${partOfDay} — sitting ${sitting}${
      Number.isFinite(deadline) ? ', before your deadline' : ''
    }`
  }
  if (task.dueAt && Number.isFinite(deadline)) {
    return `First free slot before your ${new Date(deadline).toLocaleDateString('en-GB', {
      weekday: 'long',
    })} deadline`
  }
  if (task.priority === 'P1') return `Earliest free ${partOfDay}, and it is urgent`
  return `First free ${partOfDay}`
}

/* ---------------------------------------------------------------- accept */

/** Turns accepted proposals into real, linked calendar blocks. */
export async function applyProposals(
  userId: string,
  proposals: { taskId: string; start: string; end: string }[],
  calendarId?: string,
): Promise<number> {
  let applied = 0
  for (const proposal of proposals) {
    try {
      await scheduleTask(userId, proposal.taskId, {
        start: new Date(proposal.start),
        end: new Date(proposal.end),
        calendarId,
      })
      applied += 1
    } catch (error) {
      // One bad proposal must not abandon the rest of an accepted plan.
      console.error('[scheduling] could not apply proposal', proposal.taskId, error)
    }
  }
  return applied
}

export { minutesIntoDay }
