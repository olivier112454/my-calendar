import { describe, expect, it } from 'vitest'
import {
  customToRule,
  describeRule,
  expandOccurrences,
  isOccurrenceOf,
  nextOccurrences,
  presetToRule,
  ruleToPreset,
} from '@/lib/recurrence'
import { wallToUtc, utcToWall } from '@/lib/datetime'

const AMS = 'Europe/Amsterdam'
const HOUR = 60 * 60 * 1000

describe('expanding a series', () => {
  const weekly = {
    rule: 'FREQ=WEEKLY;BYDAY=MO',
    dtStart: wallToUtc('2026-08-31T09:00', AMS), // a Monday
    durationMs: HOUR,
    timezone: AMS,
  }

  it('produces one occurrence per week', () => {
    const occurrences = expandOccurrences(
      weekly,
      wallToUtc('2026-08-31T00:00', AMS),
      wallToUtc('2026-09-28T00:00', AMS),
    )
    expect(occurrences).toHaveLength(4)
    expect(utcToWall(occurrences[0]!.start, AMS)).toBe('2026-08-31T09:00')
  })

  /**
   * The case that catches naive implementations: adding seven days of
   * milliseconds moves a 09:00 meeting to 10:00 once the clocks change.
   */
  it('keeps the wall-clock time across a DST change', () => {
    const occurrences = expandOccurrences(
      weekly,
      wallToUtc('2026-10-19T00:00', AMS),
      wallToUtc('2026-11-09T00:00', AMS),
    )
    for (const occurrence of occurrences) {
      expect(utcToWall(occurrence.start, AMS).slice(11)).toBe('09:00')
    }
    expect(occurrences.length).toBeGreaterThanOrEqual(3)
  })

  it('includes an event that started before the window but is still running', () => {
    const longEvent = {
      rule: '',
      dtStart: wallToUtc('2026-08-31T08:00', AMS),
      durationMs: 4 * HOUR,
      timezone: AMS,
    }
    const occurrences = expandOccurrences(
      longEvent,
      wallToUtc('2026-08-31T10:00', AMS),
      wallToUtc('2026-08-31T11:00', AMS),
    )
    expect(occurrences).toHaveLength(1)
  })

  it('honours EXDATE', () => {
    const second = wallToUtc('2026-09-07T09:00', AMS)
    const occurrences = expandOccurrences(
      { ...weekly, exDates: [second.toISOString()] },
      wallToUtc('2026-08-31T00:00', AMS),
      wallToUtc('2026-09-28T00:00', AMS),
    )
    expect(occurrences).toHaveLength(3)
    expect(
      occurrences.some((entry) => entry.start.getTime() === second.getTime()),
    ).toBe(false)
  })

  it('respects UNTIL', () => {
    const occurrences = expandOccurrences(
      { ...weekly, rule: 'FREQ=WEEKLY;BYDAY=MO;UNTIL=20260914T235900Z' },
      wallToUtc('2026-08-31T00:00', AMS),
      wallToUtc('2026-10-31T00:00', AMS),
    )
    expect(occurrences).toHaveLength(3)
  })

  it('respects COUNT', () => {
    const occurrences = expandOccurrences(
      { ...weekly, rule: 'FREQ=WEEKLY;BYDAY=MO;COUNT=2' },
      wallToUtc('2026-08-31T00:00', AMS),
      wallToUtc('2026-12-31T00:00', AMS),
    )
    expect(occurrences).toHaveLength(2)
  })

  it('expands a weekday rule to five days', () => {
    const occurrences = expandOccurrences(
      { ...weekly, rule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' },
      wallToUtc('2026-08-31T00:00', AMS),
      wallToUtc('2026-09-07T00:00', AMS),
    )
    expect(occurrences).toHaveLength(5)
  })

  it('returns the single event when there is no rule', () => {
    const occurrences = expandOccurrences(
      { ...weekly, rule: '' },
      wallToUtc('2026-08-31T00:00', AMS),
      wallToUtc('2026-09-01T00:00', AMS),
    )
    expect(occurrences).toHaveLength(1)
  })
})

describe('next occurrences', () => {
  it('walks forward from an instant', () => {
    const next = nextOccurrences(
      {
        rule: 'FREQ=DAILY',
        dtStart: wallToUtc('2026-08-31T09:00', AMS),
        durationMs: HOUR,
        timezone: AMS,
      },
      wallToUtc('2026-09-02T00:00', AMS),
      3,
    )
    expect(next).toHaveLength(3)
    expect(utcToWall(next[0]!.start, AMS)).toBe('2026-09-02T09:00')
  })
})

describe('membership', () => {
  it('recognises an instant that belongs to the series', () => {
    const input = {
      rule: 'FREQ=WEEKLY;BYDAY=MO',
      dtStart: wallToUtc('2026-08-31T09:00', AMS),
      durationMs: HOUR,
      timezone: AMS,
    }
    expect(isOccurrenceOf(input, wallToUtc('2026-09-07T09:00', AMS))).toBe(true)
    expect(isOccurrenceOf(input, wallToUtc('2026-09-08T09:00', AMS))).toBe(false)
  })
})

describe('authoring rules', () => {
  const monday = wallToUtc('2026-08-31T09:00', AMS)

  it('maps presets to RRULEs', () => {
    expect(presetToRule('daily', monday, AMS)).toBe('FREQ=DAILY')
    expect(presetToRule('weekdays', monday, AMS)).toBe('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR')
    expect(presetToRule('weekly', monday, AMS)).toBe('FREQ=WEEKLY;BYDAY=MO')
    expect(presetToRule('biweekly', monday, AMS)).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO')
    expect(presetToRule('monthly', monday, AMS)).toBe('FREQ=MONTHLY;BYMONTHDAY=31')
    expect(presetToRule('none', monday, AMS)).toBeNull()
  })

  it('round-trips a preset back from its rule', () => {
    for (const preset of ['daily', 'weekdays', 'weekly', 'biweekly', 'monthly'] as const) {
      const rule = presetToRule(preset, monday, AMS)
      expect(ruleToPreset(rule)).toBe(preset)
    }
    expect(ruleToPreset(null)).toBe('none')
  })

  it('builds a custom rule with an interval, weekdays and an end date', () => {
    const rule = customToRule(
      {
        frequency: 'WEEKLY',
        interval: 2,
        byWeekday: ['MO', 'WE'],
        end: { type: 'until', date: '2026-12-31' },
      },
      monday,
      AMS,
    )
    expect(rule).toContain('FREQ=WEEKLY')
    expect(rule).toContain('INTERVAL=2')
    expect(rule).toContain('BYDAY=MO,WE')
    expect(rule).toContain('UNTIL=')
  })

  it('describes a rule in words', () => {
    expect(describeRule('FREQ=WEEKLY;BYDAY=MO')).toMatch(/week/i)
    expect(describeRule(null)).toBeNull()
  })
})
