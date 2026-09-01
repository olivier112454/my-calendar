import { describe, expect, it } from 'vitest'
import {
  bucketByDay,
  layoutAllDayEvents,
  layoutDayEvents,
  limitMonthCell,
  pixelsToMinutes,
} from '@/lib/calendar-layout'
import { AMS, makeEvent } from './helpers'

/**
 * Overlap packing and day bucketing.
 *
 * These are the calculations that look almost right when they are wrong: two
 * meetings at half width with a gap beside them, a multi-day event that only
 * appears on its first day, or an event that vanishes from the day it ends on.
 */

describe('packing overlapping events', () => {
  it('gives a lone event the full width', () => {
    const positioned = layoutDayEvents(
      [makeEvent({ start: '2026-08-31T09:00', end: '2026-08-31T10:00' })],
      '2026-08-31',
      AMS,
    )
    expect(positioned).toHaveLength(1)
    expect(positioned[0]!.left).toBe(0)
    expect(positioned[0]!.width).toBe(1)
  })

  it('splits two overlapping events into halves', () => {
    const positioned = layoutDayEvents(
      [
        makeEvent({ start: '2026-08-31T09:00', end: '2026-08-31T10:30', title: 'A' }),
        makeEvent({ start: '2026-08-31T10:00', end: '2026-08-31T11:00', title: 'B' }),
      ],
      '2026-08-31',
      AMS,
    )
    expect(positioned).toHaveLength(2)
    expect(positioned.map((entry) => entry.width)).toEqual([0.5, 0.5])
    expect(positioned.map((entry) => entry.left)).toEqual([0, 0.5])
  })

  /**
   * Two events that merely touch are not overlapping. Without this, a 09:00–10:00
   * followed by a 10:00–11:00 renders as two half-width columns for no reason.
   */
  it('keeps back-to-back events full width', () => {
    const positioned = layoutDayEvents(
      [
        makeEvent({ start: '2026-08-31T09:00', end: '2026-08-31T10:00' }),
        makeEvent({ start: '2026-08-31T10:00', end: '2026-08-31T11:00' }),
      ],
      '2026-08-31',
      AMS,
    )
    expect(positioned.every((entry) => entry.width === 1)).toBe(true)
  })

  it('widens an event over columns nothing else occupies', () => {
    // A long block plus two short ones that only overlap its first half.
    const positioned = layoutDayEvents(
      [
        makeEvent({ start: '2026-08-31T09:00', end: '2026-08-31T12:00', title: 'long' }),
        makeEvent({ start: '2026-08-31T09:00', end: '2026-08-31T09:30', title: 'short' }),
      ],
      '2026-08-31',
      AMS,
    )
    const long = positioned.find((entry) => entry.event.title === 'long')!
    const short = positioned.find((entry) => entry.event.title === 'short')!
    expect(long.width).toBe(0.5)
    expect(short.left).toBe(0.5)
  })

  it('clamps a multi-day event to the day being rendered', () => {
    const event = makeEvent({
      start: '2026-08-30T22:00',
      end: '2026-09-01T02:00',
    })

    const middle = layoutDayEvents([event], '2026-08-31', AMS)
    expect(middle[0]!.startMinute).toBe(0)
    expect(middle[0]!.endMinute).toBe(1440)
    expect(middle[0]!.continuesBefore).toBe(true)
    expect(middle[0]!.continuesAfter).toBe(true)

    const last = layoutDayEvents([event], '2026-09-01', AMS)
    expect(last[0]!.startMinute).toBe(0)
    expect(last[0]!.endMinute).toBe(120)
    expect(last[0]!.continuesAfter).toBe(false)
  })

  it('leaves out a day the event does not touch', () => {
    const event = makeEvent({ start: '2026-08-31T09:00', end: '2026-08-31T10:00' })
    expect(layoutDayEvents([event], '2026-09-01', AMS)).toHaveLength(0)
  })

  /**
   * An event that ends exactly at midnight belongs to the day before it, not to
   * the next one — otherwise every evening event leaves a phantom on the
   * following day.
   */
  it('does not spill an event ending at midnight into the next day', () => {
    const event = makeEvent({ start: '2026-08-31T22:00', end: '2026-09-01T00:00' })
    expect(layoutDayEvents([event], '2026-08-31', AMS)).toHaveLength(1)
    expect(layoutDayEvents([event], '2026-09-01', AMS)).toHaveLength(0)
  })

  it('gives a very short event a usable collision height', () => {
    // A 5-minute event still blocks its neighbour from sharing the column.
    const positioned = layoutDayEvents(
      [
        makeEvent({ start: '2026-08-31T09:00', end: '2026-08-31T09:05' }),
        makeEvent({ start: '2026-08-31T09:10', end: '2026-08-31T09:30' }),
      ],
      '2026-08-31',
      AMS,
    )
    expect(positioned).toHaveLength(2)
    expect(positioned.every((entry) => entry.width === 0.5)).toBe(true)
  })
})

describe('all-day bars', () => {
  const week = [
    '2026-08-31',
    '2026-09-01',
    '2026-09-02',
    '2026-09-03',
    '2026-09-04',
    '2026-09-05',
    '2026-09-06',
  ]

  it('spans the days an all-day event covers', () => {
    const { bars } = layoutAllDayEvents(
      [
        makeEvent({
          allDay: true,
          start: '2026-09-01T00:00',
          end: '2026-09-04T00:00', // exclusive end
        }),
      ],
      week,
      AMS,
    )
    expect(bars).toHaveLength(1)
    expect(bars[0]!.startIndex).toBe(1)
    expect(bars[0]!.span).toBe(3)
  })

  it('marks a bar that runs off both edges of the view', () => {
    const { bars } = layoutAllDayEvents(
      [makeEvent({ allDay: true, start: '2026-08-24T00:00', end: '2026-09-14T00:00' })],
      week,
      AMS,
    )
    expect(bars[0]!.continuesBefore).toBe(true)
    expect(bars[0]!.continuesAfter).toBe(true)
    expect(bars[0]!.span).toBe(7)
  })

  it('stacks overlapping bars into separate lanes', () => {
    const { bars, laneCount } = layoutAllDayEvents(
      [
        makeEvent({ allDay: true, start: '2026-08-31T00:00', end: '2026-09-03T00:00' }),
        makeEvent({ allDay: true, start: '2026-09-02T00:00', end: '2026-09-05T00:00' }),
      ],
      week,
      AMS,
    )
    expect(laneCount).toBe(2)
    expect(new Set(bars.map((bar) => bar.lane)).size).toBe(2)
  })

  it('reuses a lane when bars do not touch', () => {
    const { laneCount } = layoutAllDayEvents(
      [
        makeEvent({ allDay: true, start: '2026-08-31T00:00', end: '2026-09-01T00:00' }),
        makeEvent({ allDay: true, start: '2026-09-03T00:00', end: '2026-09-04T00:00' }),
      ],
      week,
      AMS,
    )
    expect(laneCount).toBe(1)
  })
})

describe('day buckets', () => {
  it('places a multi-day event in every day it touches', () => {
    const buckets = bucketByDay(
      [makeEvent({ start: '2026-08-31T22:00', end: '2026-09-02T02:00' })],
      ['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03'],
      AMS,
    )
    expect(buckets.get('2026-08-31')).toHaveLength(1)
    expect(buckets.get('2026-09-01')).toHaveLength(1)
    expect(buckets.get('2026-09-02')).toHaveLength(1)
    expect(buckets.get('2026-09-03')).toHaveLength(0)
  })

  it('sorts all-day events above timed ones', () => {
    const buckets = bucketByDay(
      [
        makeEvent({ start: '2026-08-31T09:00', end: '2026-08-31T10:00', title: 'timed' }),
        makeEvent({
          allDay: true,
          start: '2026-08-31T00:00',
          end: '2026-09-01T00:00',
          title: 'all day',
        }),
      ],
      ['2026-08-31'],
      AMS,
    )
    expect(buckets.get('2026-08-31')!.map((entry) => entry.title)).toEqual([
      'all day',
      'timed',
    ])
  })
})

describe('month cell capacity', () => {
  it('shows everything when it fits', () => {
    const events = [1, 2, 3].map((n) =>
      makeEvent({ start: `2026-08-31T0${n}:00`, end: `2026-08-31T0${n + 1}:00` }),
    )
    const result = limitMonthCell(events, 3)
    expect(result.visible).toHaveLength(3)
    expect(result.hiddenCount).toBe(0)
  })

  it('reserves a slot for the "more" affordance', () => {
    const events = [1, 2, 3, 4, 5].map((n) =>
      makeEvent({ start: `2026-08-31T0${n}:00`, end: `2026-08-31T0${n + 1}:00` }),
    )
    const result = limitMonthCell(events, 3)
    expect(result.visible).toHaveLength(2)
    expect(result.hiddenCount).toBe(3)
  })
})

describe('pixel conversion', () => {
  it('snaps to the nearest step', () => {
    expect(pixelsToMinutes(48, 48, 15)).toBe(60)
    expect(pixelsToMinutes(10, 48, 15)).toBe(15)
    expect(pixelsToMinutes(0, 48, 15)).toBe(0)
  })
})
