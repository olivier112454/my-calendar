import { describe, expect, it } from 'vitest'
import { buildFreeSlots } from '@/server/services/scheduling'
import { wallToUtc, utcToWall } from '@/lib/datetime'
import { AMS } from './helpers'

/**
 * The free/busy calculation the scheduler builds every proposal on.
 *
 * Pure and exported precisely so it can be tested without a database: if this
 * is wrong, every suggestion is wrong, and the failure looks like bad judgement
 * rather than a bug.
 */

const MONDAY = '2026-08-31' // a Monday

const WORKING_WEEK = Array.from({ length: 7 }, (_, weekday) => ({
  weekday,
  startMinute: 9 * 60,
  endMinute: 17 * 60,
  enabled: weekday >= 1 && weekday <= 5,
}))

function slotsFor(
  busy: { start: string; end: string }[],
  options: { days?: number; notBefore?: string } = {},
) {
  return buildFreeSlots({
    fromDayKey: MONDAY,
    horizonDays: options.days ?? 1,
    timezone: AMS,
    workingHours: WORKING_WEEK,
    busy: busy.map((entry) => ({
      start: wallToUtc(entry.start, AMS).getTime(),
      end: wallToUtc(entry.end, AMS).getTime(),
    })),
    notBefore: wallToUtc(options.notBefore ?? `${MONDAY}T00:00`, AMS).getTime(),
  })
}

const asWall = (slots: { start: number; end: number }[]) =>
  slots.map((slot) => [
    utcToWall(new Date(slot.start), AMS),
    utcToWall(new Date(slot.end), AMS),
  ])

describe('free slots', () => {
  it('offers the whole working day when nothing is booked', () => {
    expect(asWall(slotsFor([]))).toEqual([[`${MONDAY}T09:00`, `${MONDAY}T17:00`]])
  })

  it('splits the day around a meeting', () => {
    const slots = slotsFor([
      { start: `${MONDAY}T11:00`, end: `${MONDAY}T12:00` },
    ])
    expect(asWall(slots)).toEqual([
      [`${MONDAY}T09:00`, `${MONDAY}T11:00`],
      [`${MONDAY}T12:00`, `${MONDAY}T17:00`],
    ])
  })

  it('merges back-to-back meetings into one busy stretch', () => {
    const slots = slotsFor([
      { start: `${MONDAY}T11:00`, end: `${MONDAY}T12:00` },
      { start: `${MONDAY}T12:00`, end: `${MONDAY}T13:00` },
    ])
    expect(asWall(slots)).toEqual([
      [`${MONDAY}T09:00`, `${MONDAY}T11:00`],
      [`${MONDAY}T13:00`, `${MONDAY}T17:00`],
    ])
  })

  it('handles overlapping meetings without producing a negative gap', () => {
    const slots = slotsFor([
      { start: `${MONDAY}T11:00`, end: `${MONDAY}T13:00` },
      { start: `${MONDAY}T12:00`, end: `${MONDAY}T12:30` },
    ])
    expect(asWall(slots)).toEqual([
      [`${MONDAY}T09:00`, `${MONDAY}T11:00`],
      [`${MONDAY}T13:00`, `${MONDAY}T17:00`],
    ])
  })

  it('ignores events outside working hours', () => {
    const slots = slotsFor([
      { start: `${MONDAY}T07:00`, end: `${MONDAY}T08:00` },
      { start: `${MONDAY}T19:00`, end: `${MONDAY}T20:00` },
    ])
    expect(asWall(slots)).toEqual([[`${MONDAY}T09:00`, `${MONDAY}T17:00`]])
  })

  it('trims a meeting that starts before the working day', () => {
    const slots = slotsFor([{ start: `${MONDAY}T08:00`, end: `${MONDAY}T10:00` }])
    expect(asWall(slots)).toEqual([[`${MONDAY}T10:00`, `${MONDAY}T17:00`]])
  })

  it('returns nothing when the day is full', () => {
    expect(slotsFor([{ start: `${MONDAY}T09:00`, end: `${MONDAY}T17:00` }])).toEqual([])
  })

  it('never proposes time in the past', () => {
    const slots = slotsFor([], { notBefore: `${MONDAY}T14:00` })
    expect(asWall(slots)).toEqual([[`${MONDAY}T14:00`, `${MONDAY}T17:00`]])
  })

  it('skips a day that is not a working day', () => {
    // Monday to Sunday: Saturday and Sunday are off.
    const slots = buildFreeSlots({
      fromDayKey: MONDAY,
      horizonDays: 7,
      timezone: AMS,
      workingHours: WORKING_WEEK,
      busy: [],
      notBefore: wallToUtc(`${MONDAY}T00:00`, AMS).getTime(),
    })
    expect(slots).toHaveLength(5)
  })

  it('drops slivers shorter than five minutes', () => {
    const slots = slotsFor([
      { start: `${MONDAY}T09:00`, end: `${MONDAY}T16:58` },
    ])
    expect(slots).toHaveLength(0)
  })

  it('keeps the working window across a DST change', () => {
    // 25 October 2026 is the Sunday the clocks go back; the Monday after must
    // still offer exactly eight hours.
    const slots = buildFreeSlots({
      fromDayKey: '2026-10-26',
      horizonDays: 1,
      timezone: AMS,
      workingHours: WORKING_WEEK,
      busy: [],
      notBefore: 0,
    })
    expect(asWall(slots)).toEqual([['2026-10-26T09:00', '2026-10-26T17:00']])
    expect(slots[0]!.end - slots[0]!.start).toBe(8 * 60 * 60 * 1000)
  })
})
