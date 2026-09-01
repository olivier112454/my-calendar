import { describe, expect, it } from 'vitest'
import {
  addDaysToKey,
  dayKeyOf,
  diffDayKeys,
  formatDuration,
  isoWeekNumber,
  minutesIntoDay,
  monthGridKeys,
  startOfDayUtc,
  startOfWeekKey,
  utcToWall,
  wallToUtc,
} from '@/lib/datetime'

/**
 * Time-zone and DST behaviour.
 *
 * These are the cases that break calendars quietly: an all-day event landing a
 * day out, a recurring 09:00 meeting drifting to 10:00 after the clocks change,
 * and an appointment across midnight ending up with a negative duration.
 */

const AMS = 'Europe/Amsterdam'
const NYC = 'America/New_York'

describe('wall clock <-> instant', () => {
  it('round-trips a wall clock through its own zone', () => {
    const wall = '2026-08-31T14:30'
    const instant = wallToUtc(wall, AMS)
    expect(utcToWall(instant, AMS)).toBe(wall)
  })

  it('resolves the same wall clock differently per zone', () => {
    const amsterdam = wallToUtc('2026-08-31T14:30', AMS)
    const newYork = wallToUtc('2026-08-31T14:30', NYC)
    // Six hours apart in summer.
    expect(newYork.getTime() - amsterdam.getTime()).toBe(6 * 60 * 60 * 1000)
  })

  it('keeps an event across midnight positive in length', () => {
    const start = wallToUtc('2026-08-31T23:30', AMS)
    const end = wallToUtc('2026-09-01T00:30', AMS)
    expect(end.getTime() - start.getTime()).toBe(60 * 60 * 1000)
  })
})

describe('daylight saving', () => {
  // The Netherlands moves the clocks on 25 October 2026 (03:00 -> 02:00).
  it('keeps the same wall clock across the autumn change', () => {
    const before = wallToUtc('2026-10-24T09:00', AMS)
    const after = wallToUtc('2026-10-26T09:00', AMS)

    expect(utcToWall(before, AMS).slice(11)).toBe('09:00')
    expect(utcToWall(after, AMS).slice(11)).toBe('09:00')
    // 09:00 to 09:00 spans 48 hours of wall clock but 49 of real time.
    expect(after.getTime() - before.getTime()).toBe(49 * 60 * 60 * 1000)
  })

  it('reports minutes-into-day from the wall clock, not from midnight', () => {
    // On the 25-hour day, 09:00 is still 540 minutes into the day as displayed.
    const instant = wallToUtc('2026-10-25T09:00', AMS)
    expect(minutesIntoDay(instant, AMS)).toBe(540)
  })

  it('spring forward: a 25-hour and a 23-hour day still start at midnight', () => {
    // 29 March 2026 loses an hour at 02:00.
    const midnight = startOfDayUtc('2026-03-29', AMS)
    expect(utcToWall(midnight, AMS)).toBe('2026-03-29T00:00')
  })
})

describe('day keys', () => {
  it('derives the day in the viewer zone, not UTC', () => {
    // 23:30 in New York is already the next day in Amsterdam.
    const instant = wallToUtc('2026-08-31T23:30', NYC)
    expect(dayKeyOf(instant, NYC)).toBe('2026-08-31')
    expect(dayKeyOf(instant, AMS)).toBe('2026-09-01')
  })

  it('adds days across a month boundary', () => {
    expect(addDaysToKey('2026-08-31', 1)).toBe('2026-09-01')
    expect(addDaysToKey('2026-01-01', -1)).toBe('2025-12-31')
  })

  it('adds days across a DST boundary without slipping', () => {
    expect(addDaysToKey('2026-10-24', 2)).toBe('2026-10-26')
  })

  it('counts whole days between keys', () => {
    expect(diffDayKeys('2026-09-01', '2026-08-31')).toBe(1)
    expect(diffDayKeys('2026-08-31', '2026-09-01')).toBe(-1)
    expect(diffDayKeys('2026-08-31', '2026-08-31')).toBe(0)
  })
})

describe('week and month grids', () => {
  it('starts the week on the configured day', () => {
    // 2026-08-31 is a Monday.
    expect(startOfWeekKey('2026-09-02', 1)).toBe('2026-08-31')
    expect(startOfWeekKey('2026-09-02', 0)).toBe('2026-08-30')
  })

  it('always produces a six-row month grid', () => {
    const grid = monthGridKeys('2026-02-15', 1)
    expect(grid).toHaveLength(42)
    // February 2026 starts on a Sunday, so a Monday-start grid opens on 26 Jan.
    expect(grid[0]).toBe('2026-01-26')
  })

  it('numbers ISO weeks', () => {
    expect(isoWeekNumber('2026-01-01')).toBe(1)
    expect(isoWeekNumber('2026-08-31')).toBe(36)
  })
})

describe('formatting', () => {
  it('writes durations the way people say them', () => {
    expect(formatDuration(45)).toBe('45m')
    expect(formatDuration(60)).toBe('1h')
    expect(formatDuration(90)).toBe('1h 30m')
    expect(formatDuration(1440)).toBe('24h')
  })
})
