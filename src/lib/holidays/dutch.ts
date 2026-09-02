import { addDaysToKey, dayKeyFromParts, weekdayOf } from '../datetime'

/**
 * Dutch public holidays and school holidays.
 *
 * Every planner built abroad gets the Netherlands slightly wrong: it knows
 * Christmas and misses Koningsdag, Bevrijdingsdag, Hemelvaart and both days of
 * Pinksteren — and it has never heard of the regional school holidays that
 * every Dutch parent plans their year around.
 *
 * The two halves are different in kind, and are treated differently on purpose:
 *
 *  - Public holidays are *computed*. Once Easter is known the movable feasts
 *    follow from it exactly, so this needs no data, works for any year, and
 *    cannot go stale.
 *  - School holidays are *published*. The ministry sets them per region per
 *    year and they follow no formula — the southern spring holiday is often but
 *    not always the carnival week, for instance. So they come from a table with
 *    a stated source, and a year that is not in it returns nothing rather than
 *    a guess. Wrong holiday dates are worse than none: a parent who books
 *    around them finds out in the school car park.
 */

export type SchoolRegion = 'NOORD' | 'MIDDEN' | 'ZUID'

export interface Holiday {
  /** Day key of the first day. */
  startDayKey: string
  /** Day key of the last day, inclusive. */
  endDayKey: string
  /** Dutch name, which is how these are known even in an English interface. */
  name: string
  kind: 'PUBLIC' | 'SCHOOL'
}

/* ------------------------------------------------------------ public days */

/**
 * Easter Sunday, by the anonymous Gregorian algorithm (Meeus/Jones/Butcher).
 *
 * Everything movable in the Dutch calendar hangs off this one date, so it is
 * worth having exactly rather than approximately.
 */
export function easterSunday(year: number): string {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return dayKeyFromParts(year, month, day)
}

/**
 * The public holidays of one calendar year.
 *
 * Both days of Easter, Pinksteren and Kerst are listed separately rather than
 * as a two-day range, because that is how people refer to them and how a
 * calendar should label them.
 */
export function dutchPublicHolidays(year: number): Holiday[] {
  const easter = easterSunday(year)
  const single = (dayKey: string, name: string): Holiday => ({
    startDayKey: dayKey,
    endDayKey: dayKey,
    name,
    kind: 'PUBLIC',
  })

  return [
    single(dayKeyFromParts(year, 1, 1), 'Nieuwjaarsdag'),
    single(addDaysToKey(easter, -2), 'Goede Vrijdag'),
    single(easter, 'Eerste paasdag'),
    single(addDaysToKey(easter, 1), 'Tweede paasdag'),
    single(koningsdag(year), 'Koningsdag'),
    single(dayKeyFromParts(year, 5, 5), 'Bevrijdingsdag'),
    single(addDaysToKey(easter, 39), 'Hemelvaartsdag'),
    single(addDaysToKey(easter, 49), 'Eerste pinksterdag'),
    single(addDaysToKey(easter, 50), 'Tweede pinksterdag'),
    single(dayKeyFromParts(year, 12, 25), 'Eerste kerstdag'),
    single(dayKeyFromParts(year, 12, 26), 'Tweede kerstdag'),
  ]
}

/**
 * Koningsdag is 27 April, except that it is never celebrated on a Sunday — then
 * it moves back to the Saturday. (Before 2014 this was Koninginnedag on 30
 * April; this function is not asked about those years.)
 */
function koningsdag(year: number): string {
  const april27 = dayKeyFromParts(year, 4, 27)
  return weekdayOf(april27) === 0 ? addDaysToKey(april27, -1) : april27
}

/* ------------------------------------------------------------ school days */

/**
 * Published school holidays, keyed by school year.
 *
 * Source: rijksoverheid.nl, "Overzicht schoolvakanties per schooljaar",
 * cross-checked against schoolvakanties-nederland.nl. Both agreed exactly on
 * every date below.
 *
 * These are the ministry's advisory dates. Individual schools may shift them,
 * which is why the app presents them as information rather than as blocked
 * time.
 *
 * To add a school year: take the dates from the source above, add an entry, and
 * extend the test that checks every range is ordered and plausibly long. Do not
 * extrapolate from the year before — there is no pattern to extrapolate.
 */
const SCHOOL_HOLIDAYS: Record<
  string,
  { name: string; regions: Record<SchoolRegion, [string, string]> }[]
> = {
  '2026-2027': [
    {
      name: 'Herfstvakantie',
      regions: {
        NOORD: ['2026-10-10', '2026-10-18'],
        MIDDEN: ['2026-10-17', '2026-10-25'],
        ZUID: ['2026-10-17', '2026-10-25'],
      },
    },
    {
      name: 'Kerstvakantie',
      regions: {
        NOORD: ['2026-12-19', '2027-01-03'],
        MIDDEN: ['2026-12-19', '2027-01-03'],
        ZUID: ['2026-12-19', '2027-01-03'],
      },
    },
    {
      name: 'Voorjaarsvakantie',
      regions: {
        NOORD: ['2027-02-20', '2027-02-28'],
        MIDDEN: ['2027-02-20', '2027-02-28'],
        ZUID: ['2027-02-13', '2027-02-21'],
      },
    },
    {
      name: 'Meivakantie',
      regions: {
        NOORD: ['2027-04-24', '2027-05-02'],
        MIDDEN: ['2027-04-24', '2027-05-02'],
        ZUID: ['2027-04-24', '2027-05-02'],
      },
    },
    {
      name: 'Zomervakantie',
      regions: {
        NOORD: ['2027-07-10', '2027-08-22'],
        MIDDEN: ['2027-07-17', '2027-08-29'],
        ZUID: ['2027-07-24', '2027-09-05'],
      },
    },
  ],
}

/** School years the table actually covers, oldest first. */
export function knownSchoolYears(): string[] {
  return Object.keys(SCHOOL_HOLIDAYS).sort()
}

/**
 * The school holidays of one school year for one region, or an empty list when
 * that year is not in the table. Empty means "not published here", never "no
 * holidays" — the caller should say so rather than draw an empty year.
 */
export function dutchSchoolHolidays(
  schoolYear: string,
  region: SchoolRegion,
): Holiday[] {
  return (SCHOOL_HOLIDAYS[schoolYear] ?? []).map((entry) => {
    const [startDayKey, endDayKey] = entry.regions[region]
    return { startDayKey, endDayKey, name: entry.name, kind: 'SCHOOL' as const }
  })
}

/**
 * The school year a given day falls in, as "2026-2027".
 *
 * Dutch school years run August to July, so anything before August belongs to
 * the year that started the previous summer.
 */
export function schoolYearOf(dayKey: string): string {
  const year = Number(dayKey.slice(0, 4))
  const month = Number(dayKey.slice(5, 7))
  const startYear = month >= 8 ? year : year - 1
  return `${startYear}-${startYear + 1}`
}
