import 'server-only'
import { prisma } from '@/lib/db'
import { addDaysToKey, startOfDayUtc } from '@/lib/datetime'
import {
  dutchPublicHolidays,
  dutchSchoolHolidays,
  knownSchoolYears,
  schoolYearOf,
  type Holiday,
  type SchoolRegion,
} from '@/lib/holidays/dutch'

/**
 * Putting the Dutch calendar on the user's calendar.
 *
 * These are written as ordinary all-day events in the read-only Holidays
 * calendar rather than drawn as a special layer, so they flow through
 * everything that already exists — the grid, the agenda, conflict checking,
 * search, export — without a single one of those knowing about holidays.
 *
 * Writing is idempotent and additive-only for the user: the sync owns exactly
 * the rows it created (marked by `externalProvider: 'LOCAL'` with an
 * `externalId` built from the holiday itself), so re-running it never
 * duplicates, and turning the region off removes only the school holidays it
 * put there. Anything the user added to that calendar by hand is left alone.
 */

/** Marks a row as ours, and identifies which holiday it is. */
function externalIdFor(holiday: Holiday): string {
  return `nl-holiday:${holiday.kind}:${holiday.startDayKey}:${holiday.name}`
}

const SCHOOL_PREFIX = 'nl-holiday:SCHOOL:'
const PUBLIC_PREFIX = 'nl-holiday:PUBLIC:'

/**
 * The holidays that should exist for a user, over the calendar years touched by
 * `fromYear`..`toYear`.
 *
 * School holidays are only included when a region is chosen, and only for
 * school years the table actually covers — an unpublished year yields nothing
 * rather than a guess.
 */
export function holidaysFor(
  fromYear: number,
  toYear: number,
  region: SchoolRegion | null,
): Holiday[] {
  const holidays: Holiday[] = []

  for (let year = fromYear; year <= toYear; year++) {
    holidays.push(...dutchPublicHolidays(year))
  }

  if (region) {
    const wanted = new Set<string>()
    for (let year = fromYear; year <= toYear; year++) {
      wanted.add(schoolYearOf(`${year}-09-01`))
      wanted.add(schoolYearOf(`${year}-01-01`))
    }
    for (const schoolYear of knownSchoolYears()) {
      if (wanted.has(schoolYear)) {
        holidays.push(...dutchSchoolHolidays(schoolYear, region))
      }
    }
  }

  return holidays
}

/**
 * Bring the Holidays calendar in line with the settings.
 *
 * Returns what changed, so a caller can tell the user something true rather
 * than "done". Does nothing at all when the user has no Holidays calendar —
 * that is a deliberate deletion, not a state to repair.
 */
export async function syncDutchHolidays(
  userId: string,
  options: {
    region: SchoolRegion | null
    fromYear: number
    toYear: number
    /** The user's zone; a calendar of its own may not carry one. */
    timezone: string
  },
): Promise<{ added: number; removed: number }> {
  const calendar = await prisma.calendar.findFirst({
    where: { userId, kind: 'HOLIDAYS' },
    select: { id: true, timezone: true },
  })
  if (!calendar) return { added: 0, removed: 0 }

  const timezone = calendar.timezone ?? options.timezone

  const wanted = holidaysFor(options.fromYear, options.toYear, options.region)
  const wantedById = new Map(wanted.map((holiday) => [externalIdFor(holiday), holiday]))

  const existing = await prisma.event.findMany({
    where: {
      userId,
      calendarId: calendar.id,
      externalId: { startsWith: 'nl-holiday:' },
    },
    select: { id: true, externalId: true },
  })

  const existingIds = new Set(existing.map((row) => row.externalId!))

  // Ours, but no longer wanted — a region switched off, or a year rolled out of
  // range. Never touches anything without our prefix.
  const stale = existing.filter((row) => !wantedById.has(row.externalId!))
  if (stale.length > 0) {
    await prisma.event.deleteMany({ where: { id: { in: stale.map((row) => row.id) } } })
  }

  const missing = [...wantedById.entries()].filter(([id]) => !existingIds.has(id))

  if (missing.length > 0) {
    await prisma.event.createMany({
      data: missing.map(([externalId, holiday]) => ({
        userId,
        calendarId: calendar.id,
        title: holiday.name,
        kind: 'HOLIDAY' as const,
        allDay: true,
        // An all-day range is stored half-open, so the end is the morning after
        // the last day off.
        startAt: startOfDayUtc(holiday.startDayKey, timezone),
        endAt: startOfDayUtc(addDaysToKey(holiday.endDayKey, 1), timezone),
        startDate: holiday.startDayKey,
        endDate: addDaysToKey(holiday.endDayKey, 1),
        timezone,
        // Holidays should never make someone look busy: a client can still book
        // a call on Bevrijdingsdag if that is what both of them want.
        transparency: 'FREE' as const,
        externalProvider: 'LOCAL' as const,
        externalId,
      })),
    })
  }

  return { added: missing.length, removed: stale.length }
}

/** Removes every holiday this sync owns. Used when the feature is turned off. */
export async function clearDutchHolidays(
  userId: string,
  scope: 'ALL' | 'SCHOOL' = 'ALL',
): Promise<number> {
  const result = await prisma.event.deleteMany({
    where: {
      userId,
      externalId: {
        startsWith: scope === 'SCHOOL' ? SCHOOL_PREFIX : 'nl-holiday:',
      },
    },
  })
  return result.count
}

export { PUBLIC_PREFIX, SCHOOL_PREFIX }
