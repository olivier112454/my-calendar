import 'server-only'
import { prisma } from '@/lib/db'
import { dayKeyOf, formatDuration } from '@/lib/datetime'
import { buildFreeSlots } from './scheduling'
import { listOccurrences } from './events'

/**
 * What putting something here actually costs.
 *
 * Conflict detection answers "does this clash?", which every calendar does. It
 * says nothing about the far more common damage: an hour dropped in the middle
 * of the one clear afternoon, leaving two stubs too short to think in. Nothing
 * overlaps, so nothing warns, and the day is quietly ruined.
 *
 * This answers the other question — what happens to the shape of the day — and
 * answers it at the moment of the decision, while it is still free to change.
 * Clockwise optimises for the same thing silently in the background; the point
 * here is to show the consequence to the person making the choice.
 *
 * Only the user's own day is considered. Saying what a move costs a guest would
 * need their free/busy, which needs a real shared-calendar connection; claiming
 * it from an attendee list would be a guess dressed as a fact.
 */

/** The shortest stretch anyone can do real work in. Below this it is a gap. */
const USABLE_STRETCH_MINUTES = 90

/** Ignore a loss smaller than this; nobody needs telling about ten minutes. */
const MEANINGFUL_LOSS_MINUTES = 30

export interface ImpactInput {
  /** Free stretches in the working day, as minutes, before placing anything. */
  freeBeforeMinutes: number[]
  /** The same day once the proposed event is in it. */
  freeAfterMinutes: number[]
  /** Protected blocks the proposal would run through. */
  brokenBlocks: { title: string; minutes: number }[]
  /** How many protected blocks that day had in total. */
  focusBlocksThatDay: number
}

export interface Impact {
  longestBeforeMinutes: number
  longestAfterMinutes: number
  freeBeforeMinutes: number
  freeAfterMinutes: number
  brokenBlocks: { title: string; minutes: number }[]
  /** True when the proposal would run through every protected block of the day. */
  removesOnlyFocus: boolean
  /** Plain sentences for the UI, most important first. Empty means no cost. */
  messages: string[]
}

const longest = (values: number[]) => (values.length === 0 ? 0 : Math.max(...values))
const total = (values: number[]) => values.reduce((sum, value) => sum + value, 0)

/**
 * The judgement, separated from the queries that feed it.
 *
 * Pure and exported so it can be tested without a database — the same reason
 * `buildFreeSlots` is, and for the same stakes: if this is wrong, the app talks
 * someone out of a perfectly good meeting slot.
 */
export function assessImpact(input: ImpactInput): Impact {
  const longestBeforeMinutes = longest(input.freeBeforeMinutes)
  const longestAfterMinutes = longest(input.freeAfterMinutes)
  const freeBeforeMinutes = total(input.freeBeforeMinutes)
  const freeAfterMinutes = total(input.freeAfterMinutes)

  const removesOnlyFocus =
    input.brokenBlocks.length > 0 &&
    input.brokenBlocks.length >= input.focusBlocksThatDay

  const messages: string[] = []

  // Breaking protected time is the most concrete cost, so it leads.
  for (const block of input.brokenBlocks) {
    messages.push(
      removesOnlyFocus && input.brokenBlocks.length === 1
        ? `Runs through "${block.title}" — the only focus time you have that day.`
        : `Runs through "${block.title}" (${formatDuration(block.minutes)}).`,
    )
  }

  const lost = longestBeforeMinutes - longestAfterMinutes

  // The quiet one: nothing overlaps, but the day is left in pieces.
  if (lost >= MEANINGFUL_LOSS_MINUTES) {
    if (
      longestBeforeMinutes >= USABLE_STRETCH_MINUTES &&
      longestAfterMinutes < USABLE_STRETCH_MINUTES
    ) {
      messages.push(
        `Leaves no stretch longer than ${formatDuration(longestAfterMinutes)} — ` +
          `the longest clear run that day is ${formatDuration(longestBeforeMinutes)} now.`,
      )
    } else if (lost >= longestBeforeMinutes / 2) {
      messages.push(
        `Cuts the longest clear run from ${formatDuration(longestBeforeMinutes)} to ` +
          `${formatDuration(longestAfterMinutes)}.`,
      )
    }
  }

  return {
    longestBeforeMinutes,
    longestAfterMinutes,
    freeBeforeMinutes,
    freeAfterMinutes,
    brokenBlocks: input.brokenBlocks,
    removesOnlyFocus,
    messages,
  }
}

/**
 * Work out the cost of placing an event at a given time, for one user.
 *
 * `excludeEventId` leaves the event being moved out of its own "before"
 * picture, so a drag reports what changes rather than what already is.
 */
export async function assessMove(
  userId: string,
  input: { start: Date; end: Date; excludeEventId?: string },
): Promise<Impact> {
  const [user, workingHours] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { timezone: true },
    }),
    prisma.workingHours.findMany({ where: { userId } }),
  ])
  const timezone = user.timezone
  const dayKey = dayKeyOf(input.start, timezone)

  // The whole day either side, so a slot at its edges still sees its neighbours.
  const occurrences = await listOccurrences(userId, {
    from: new Date(input.start.getTime() - 24 * 3_600_000),
    to: new Date(input.end.getTime() + 24 * 3_600_000),
    onlyVisibleCalendars: false,
    includeDeclined: false,
  })

  const sameDay = occurrences.filter(
    (occurrence) =>
      !occurrence.allDay &&
      occurrence.status !== 'CANCELLED' &&
      occurrence.transparency !== 'FREE' &&
      occurrence.eventId !== input.excludeEventId &&
      dayKeyOf(new Date(occurrence.start), timezone) === dayKey,
  )

  const busy = sameDay.map((occurrence) => ({
    start: Date.parse(occurrence.start),
    end: Date.parse(occurrence.end),
  }))

  const slotOptions = {
    fromDayKey: dayKey,
    horizonDays: 1,
    timezone,
    workingHours,
    // Free time is free time, whether or not it has already gone by; this is a
    // question about the shape of the day, not about what can still be booked.
    notBefore: 0,
  }

  const before = buildFreeSlots({ ...slotOptions, busy })
  const after = buildFreeSlots({
    ...slotOptions,
    busy: [...busy, { start: input.start.getTime(), end: input.end.getTime() }],
  })

  const toMinutes = (slots: { start: number; end: number }[]) =>
    slots.map((slot) => Math.round((slot.end - slot.start) / 60_000))

  const protectedKinds = new Set(['FOCUS', 'TASK_BLOCK'])
  const focusThatDay = sameDay.filter((occurrence) =>
    protectedKinds.has(occurrence.kind),
  )

  const brokenBlocks = focusThatDay
    .filter((occurrence) => {
      const start = Date.parse(occurrence.start)
      const end = Date.parse(occurrence.end)
      return input.start.getTime() < end && input.end.getTime() > start
    })
    .map((occurrence) => ({
      title: occurrence.title,
      minutes: Math.round(
        (Date.parse(occurrence.end) - Date.parse(occurrence.start)) / 60_000,
      ),
    }))

  return assessImpact({
    freeBeforeMinutes: toMinutes(before),
    freeAfterMinutes: toMinutes(after),
    brokenBlocks,
    focusBlocksThatDay: focusThatDay.length,
  })
}
