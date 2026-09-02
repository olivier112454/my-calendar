import 'server-only'
import { prisma } from '@/lib/db'
import { dayKeyOf, diffDayKeys } from '@/lib/datetime'

/**
 * How often you actually see someone, and who has quietly fallen off it.
 *
 * Every CRM has a "last contacted" column, and it is nearly useless on its own:
 * eight weeks is alarming for the colleague you speak to weekly and completely
 * normal for the supplier you see twice a year. The number that means something
 * is the gap measured against that person's own rhythm, and a calendar is the
 * one place with the history to work it out.
 *
 * So each contact gets their own cadence, learned from the meetings you have
 * actually had with them, and the app only says anything when someone is well
 * past it. The same restraint as the estimate calibration applies, for the same
 * reason — this is advice about relationships, and being confidently wrong
 * about one is worse than staying quiet:
 *
 *  - the median gap, not the mean, so one long absence does not reset the norm
 *  - nothing at all under MIN_MEETINGS, because two coffees is not a rhythm
 *  - overdue only past a clear multiple of the gap, not the first day over
 */

/** Fewer meetings than this and there is no rhythm to speak of. */
const MIN_MEETINGS = 4

/** How far past the usual gap before it is worth mentioning. */
const OVERDUE_FACTOR = 2

/**
 * Gaps longer than this are treated as a break in the relationship rather than
 * part of its rhythm — someone you saw weekly, then not for two years, then
 * weekly again has two rhythms, not one slow one.
 */
const MAX_GAP_DAYS = 400

export interface Cadence {
  /** Past meetings counted, most recent first. */
  meetings: number
  lastMetDayKey: string | null
  daysSince: number | null
  /** Median days between meetings, or null when there is no rhythm yet. */
  typicalGapDays: number | null
  /** True once there is enough history to claim a rhythm. */
  confident: boolean
  /** Days beyond the usual gap, only set when clearly past it. */
  overdueByDays: number | null
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!
}

/**
 * The judgement, separated from the query that feeds it.
 *
 * `meetingDayKeys` are the days you met this person, in any order; only days on
 * or before `today` count, because a meeting in the diary for next week is not
 * evidence of a rhythm and certainly does not mean you have spoken.
 *
 * Pure and exported so it can be tested without a database.
 */
export function cadenceFrom(meetingDayKeys: string[], today: string): Cadence {
  const past = [...new Set(meetingDayKeys.filter((key) => key <= today))].sort()

  const empty: Cadence = {
    meetings: past.length,
    lastMetDayKey: past.at(-1) ?? null,
    daysSince: past.length > 0 ? diffDayKeys(today, past.at(-1)!) : null,
    typicalGapDays: null,
    confident: false,
    overdueByDays: null,
  }

  if (past.length < MIN_MEETINGS) return empty

  const gaps: number[] = []
  for (let i = 1; i < past.length; i++) {
    const gap = diffDayKeys(past[i]!, past[i - 1]!)
    if (gap > 0 && gap <= MAX_GAP_DAYS) gaps.push(gap)
  }

  // Enough meetings but no usable gaps — several on one day, or all of them
  // separated by breaks longer than a rhythm can survive.
  if (gaps.length < MIN_MEETINGS - 1) return empty

  const typicalGapDays = median(gaps)
  const daysSince = empty.daysSince!

  return {
    ...empty,
    typicalGapDays,
    confident: true,
    overdueByDays:
      daysSince > typicalGapDays * OVERDUE_FACTOR
        ? Math.round(daysSince - typicalGapDays)
        : null,
  }
}

export interface OverdueContact {
  contactId: string
  name: string | null
  email: string
  organization: string | null
  avatarUrl: string | null
  cadence: Cadence
}

/**
 * The people you are furthest past your own rhythm with, most overdue first.
 *
 * Only contacts with an address are considered, because that is what ties a
 * person to the attendee rows on their meetings.
 */
export async function overdueContacts(
  userId: string,
  timezone: string,
  limit = 5,
): Promise<OverdueContact[]> {
  const contacts = await prisma.contact.findMany({
    where: { userId, email: { not: null } },
    select: {
      id: true,
      name: true,
      email: true,
      organization: true,
      avatarUrl: true,
    },
    take: 500,
  })
  if (contacts.length === 0) return []

  const emails = contacts.map((contact) => contact.email!.toLowerCase())

  // One query for every meeting with any of them, rather than one per contact.
  const attendances = await prisma.eventAttendee.findMany({
    where: {
      email: { in: emails },
      event: { userId, status: { not: 'CANCELLED' } },
    },
    select: { email: true, event: { select: { startAt: true } } },
    take: 5000,
  })

  const byEmail = new Map<string, string[]>()
  const today = dayKeyOf(new Date(), timezone)

  for (const row of attendances) {
    const key = row.email.toLowerCase()
    const dayKey = dayKeyOf(row.event.startAt, timezone)
    const list = byEmail.get(key)
    if (list) list.push(dayKey)
    else byEmail.set(key, [dayKey])
  }

  return contacts
    .map((contact) => ({
      contactId: contact.id,
      name: contact.name,
      email: contact.email!,
      organization: contact.organization,
      avatarUrl: contact.avatarUrl,
      cadence: cadenceFrom(byEmail.get(contact.email!.toLowerCase()) ?? [], today),
    }))
    .filter((entry) => entry.cadence.overdueByDays !== null)
    .sort((a, b) => {
      // Most overdue relative to their own rhythm, not in absolute days: three
      // weeks is further gone for a weekly colleague than for a monthly one.
      const ratio = (entry: OverdueContact) =>
        entry.cadence.daysSince! / entry.cadence.typicalGapDays!
      return ratio(b) - ratio(a)
    })
    .slice(0, limit)
}
