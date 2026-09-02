import { describe, expect, it } from 'vitest'
import {
  dutchPublicHolidays,
  dutchSchoolHolidays,
  easterSunday,
  knownSchoolYears,
  schoolYearOf,
  type SchoolRegion,
} from '@/lib/holidays/dutch'
import { holidaysFor } from '@/server/services/holidays'

/**
 * The Dutch calendar.
 *
 * A wrong date here is not a cosmetic bug: someone books a client meeting on
 * Hemelvaartsdag, or a week away in what turns out to be a school week. The
 * public holidays are checked against dates that are simply known, and the
 * school table against the shape every published year has.
 */

const on = (year: number, name: string) =>
  dutchPublicHolidays(year).find((holiday) => holiday.name === name)?.startDayKey

describe('Easter', () => {
  it('matches the known dates', () => {
    expect(easterSunday(2024)).toBe('2024-03-31')
    expect(easterSunday(2025)).toBe('2025-04-20')
    expect(easterSunday(2026)).toBe('2026-04-05')
    expect(easterSunday(2027)).toBe('2027-03-28')
    expect(easterSunday(2028)).toBe('2028-04-16')
    // Either end of the possible range: Easter never falls outside these.
    expect(easterSunday(2038)).toBe('2038-04-25')
    expect(easterSunday(2035)).toBe('2035-03-25')
  })

  it('never lands outside 22 March to 25 April', () => {
    for (let year = 2020; year <= 2060; year++) {
      const key = easterSunday(year)
      expect(key >= `${year}-03-22`).toBe(true)
      expect(key <= `${year}-04-25`).toBe(true)
    }
  })

  it('always lands on a Sunday', () => {
    for (let year = 2020; year <= 2060; year++) {
      expect(new Date(`${easterSunday(year)}T12:00:00Z`).getUTCDay()).toBe(0)
    }
  })
})

describe('public holidays', () => {
  it('places the movable feasts relative to Easter', () => {
    // 2026: Easter is 5 April.
    expect(on(2026, 'Goede Vrijdag')).toBe('2026-04-03')
    expect(on(2026, 'Tweede paasdag')).toBe('2026-04-06')
    expect(on(2026, 'Hemelvaartsdag')).toBe('2026-05-14')
    expect(on(2026, 'Eerste pinksterdag')).toBe('2026-05-24')
    expect(on(2026, 'Tweede pinksterdag')).toBe('2026-05-25')
  })

  it('keeps Hemelvaart on a Thursday and Pinksteren on a Sunday', () => {
    for (let year = 2024; year <= 2040; year++) {
      const ascension = on(year, 'Hemelvaartsdag')!
      const whitsun = on(year, 'Eerste pinksterdag')!
      expect(new Date(`${ascension}T12:00:00Z`).getUTCDay()).toBe(4)
      expect(new Date(`${whitsun}T12:00:00Z`).getUTCDay()).toBe(0)
    }
  })

  it('moves Koningsdag off a Sunday', () => {
    // 27 April 2025 is a Sunday, so it is celebrated on the 26th.
    expect(on(2025, 'Koningsdag')).toBe('2025-04-26')
    // 2026 it is a Monday, so it stays put.
    expect(on(2026, 'Koningsdag')).toBe('2026-04-27')
    // It is never on a Sunday, whatever the year.
    for (let year = 2024; year <= 2060; year++) {
      expect(new Date(`${on(year, 'Koningsdag')}T12:00:00Z`).getUTCDay()).not.toBe(0)
    }
  })

  it('includes the ones a foreign calendar leaves out', () => {
    const names = dutchPublicHolidays(2027).map((holiday) => holiday.name)
    expect(names).toContain('Koningsdag')
    expect(names).toContain('Bevrijdingsdag')
    expect(names).toContain('Hemelvaartsdag')
    expect(names).toContain('Tweede pinksterdag')
    expect(names).toContain('Tweede kerstdag')
  })
})

describe('school holidays', () => {
  const REGIONS: SchoolRegion[] = ['NOORD', 'MIDDEN', 'ZUID']

  it('returns nothing at all for a year that was never published', () => {
    // Not "no holidays" — the caller has to be able to tell the difference.
    expect(dutchSchoolHolidays('2031-2032', 'NOORD')).toEqual([])
  })

  it('has every published year ordered and plausibly long', () => {
    for (const schoolYear of knownSchoolYears()) {
      for (const region of REGIONS) {
        const holidays = dutchSchoolHolidays(schoolYear, region)
        expect(holidays.length).toBeGreaterThanOrEqual(5)

        for (const holiday of holidays) {
          expect(holiday.endDayKey >= holiday.startDayKey).toBe(true)

          const days =
            (Date.parse(`${holiday.endDayKey}T00:00:00Z`) -
              Date.parse(`${holiday.startDayKey}T00:00:00Z`)) /
              86_400_000 +
            1
          // A week off to six weeks of summer; nothing published falls outside.
          expect(days).toBeGreaterThanOrEqual(7)
          expect(days).toBeLessThanOrEqual(60)
        }

        // Holidays never overlap, and are listed in order.
        for (let i = 1; i < holidays.length; i++) {
          expect(holidays[i]!.startDayKey > holidays[i - 1]!.endDayKey).toBe(true)
        }
      }
    }
  })

  it('reads the 2026-2027 dates as published', () => {
    const zuid = dutchSchoolHolidays('2026-2027', 'ZUID')
    const noord = dutchSchoolHolidays('2026-2027', 'NOORD')

    const find = (list: typeof zuid, name: string) =>
      list.find((holiday) => holiday.name === name)

    expect(find(noord, 'Herfstvakantie')?.startDayKey).toBe('2026-10-10')
    expect(find(zuid, 'Herfstvakantie')?.startDayKey).toBe('2026-10-17')
    // The south takes its spring week a week before the rest.
    expect(find(zuid, 'Voorjaarsvakantie')?.startDayKey).toBe('2027-02-13')
    expect(find(noord, 'Voorjaarsvakantie')?.startDayKey).toBe('2027-02-20')
    // Summer is staggered so the country does not leave at once.
    expect(find(noord, 'Zomervakantie')?.startDayKey).toBe('2027-07-10')
    expect(find(zuid, 'Zomervakantie')?.startDayKey).toBe('2027-07-24')
  })

  it('knows which school year a day belongs to', () => {
    expect(schoolYearOf('2026-09-02')).toBe('2026-2027')
    expect(schoolYearOf('2026-08-01')).toBe('2026-2027')
    // July still belongs to the year that began the previous August.
    expect(schoolYearOf('2027-07-31')).toBe('2026-2027')
    expect(schoolYearOf('2027-08-01')).toBe('2027-2028')
  })
})

describe('what gets placed on the calendar', () => {
  it('places public holidays with no region chosen', () => {
    const holidays = holidaysFor(2026, 2026, null)
    expect(holidays.every((holiday) => holiday.kind === 'PUBLIC')).toBe(true)
    expect(holidays).toHaveLength(11)
  })

  it('adds the school holidays of the years it covers once a region is set', () => {
    const withRegion = holidaysFor(2026, 2027, 'ZUID')
    const school = withRegion.filter((holiday) => holiday.kind === 'SCHOOL')
    expect(school.length).toBeGreaterThan(0)
    expect(school.some((holiday) => holiday.name === 'Zomervakantie')).toBe(true)
  })

  it('adds nothing for years the table does not cover', () => {
    // 2035 is not published, so the school half is simply absent.
    const holidays = holidaysFor(2035, 2035, 'NOORD')
    expect(holidays.every((holiday) => holiday.kind === 'PUBLIC')).toBe(true)
  })

  it('gives every holiday a distinct identity, so a re-sync cannot duplicate', () => {
    const holidays = holidaysFor(2026, 2028, 'MIDDEN')
    const ids = holidays.map((h) => `${h.kind}:${h.startDayKey}:${h.name}`)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
