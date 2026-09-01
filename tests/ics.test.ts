import { describe, expect, it } from 'vitest'
import { parseIcs, toIcs, type IcsEvent } from '@/lib/ics'
import { wallToUtc } from '@/lib/datetime'
import { AMS } from './helpers'

/**
 * iCalendar round-tripping.
 *
 * The awkward parts are line folding, escaping, and the two ways a date can be
 * written. Getting them wrong shows up as an import that silently drops half a
 * file, so they are pinned here.
 */

function makeIcsEvent(overrides: Partial<IcsEvent> = {}): IcsEvent {
  return {
    uid: 'test-1@dayflow',
    summary: 'Quarterly planning',
    description: null,
    location: null,
    start: wallToUtc('2026-08-31T11:00', AMS),
    end: wallToUtc('2026-08-31T12:30', AMS),
    allDay: false,
    timezone: AMS,
    recurrenceRule: null,
    exDates: [],
    status: 'CONFIRMED',
    transparency: 'BUSY',
    organizer: null,
    attendees: [],
    url: null,
    ...overrides,
  }
}

describe('export', () => {
  it('writes a valid calendar envelope', () => {
    const ics = toIcs([makeIcsEvent()], { calendarName: 'Work' })
    expect(ics.startsWith('BEGIN:VCALENDAR')).toBe(true)
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true)
    expect(ics).toContain('VERSION:2.0')
    expect(ics).toContain('X-WR-CALNAME:Work')
    expect(ics).toContain('\r\n')
  })

  it('writes all-day events as plain dates', () => {
    const ics = toIcs(
      [
        makeIcsEvent({
          allDay: true,
          start: wallToUtc('2026-09-01T00:00', AMS),
          end: wallToUtc('2026-09-02T00:00', AMS),
        }),
      ],
      { calendarName: 'Personal' },
    )
    expect(ics).toContain('DTSTART;VALUE=DATE:20260901')
    expect(ics).toContain('DTEND;VALUE=DATE:20260902')
  })

  it('escapes the characters the spec reserves', () => {
    const ics = toIcs(
      [makeIcsEvent({ summary: 'Lunch; with Ann, Bob', description: 'Line one\nLine two' })],
      { calendarName: 'Work' },
    )
    expect(ics).toContain('SUMMARY:Lunch\\; with Ann\\, Bob')
    expect(ics).toContain('DESCRIPTION:Line one\\nLine two')
  })

  it('folds long lines', () => {
    const ics = toIcs(
      [makeIcsEvent({ summary: 'x'.repeat(200) })],
      { calendarName: 'Work' },
    )
    for (const line of ics.split('\r\n')) {
      expect(line.length).toBeLessThanOrEqual(75)
    }
  })
})

describe('import', () => {
  it('reads back what it wrote', () => {
    const original = makeIcsEvent({
      description: 'Agenda:\nQ3 results',
      location: 'Boardroom',
      attendees: [{ email: 'emma@example.com', name: 'Emma' }],
      organizer: 'me@example.com',
    })
    const parsed = parseIcs(toIcs([original], { calendarName: 'Work' }))

    expect(parsed.calendarName).toBe('Work')
    expect(parsed.events).toHaveLength(1)

    const event = parsed.events[0]!
    expect(event.summary).toBe(original.summary)
    expect(event.description).toBe(original.description)
    expect(event.location).toBe('Boardroom')
    expect(event.start.getTime()).toBe(original.start.getTime())
    expect(event.end.getTime()).toBe(original.end.getTime())
    expect(event.attendees[0]).toEqual({ email: 'emma@example.com', name: 'Emma' })
    expect(event.organizer).toBe('me@example.com')
  })

  it('round-trips an all-day event without shifting the day', () => {
    const original = makeIcsEvent({
      allDay: true,
      start: wallToUtc('2026-09-01T00:00', AMS),
      end: wallToUtc('2026-09-02T00:00', AMS),
    })
    const event = parseIcs(toIcs([original], { calendarName: 'Personal' })).events[0]!

    expect(event.allDay).toBe(true)
    expect(event.start.toISOString().slice(0, 10)).toBe('2026-09-01')
  })

  it('round-trips a recurrence rule', () => {
    const parsed = parseIcs(
      toIcs([makeIcsEvent({ recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO' })], {
        calendarName: 'Work',
      }),
    )
    expect(parsed.events[0]!.recurrenceRule).toBe('FREQ=WEEKLY;BYDAY=MO')
  })

  it('unfolds a folded line', () => {
    const raw = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:folded@example',
      'DTSTART:20260831T090000Z',
      'DTEND:20260831T100000Z',
      'SUMMARY:A very long title that has been split across',
      '  two physical lines',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')

    const event = parseIcs(raw).events[0]!
    expect(event.summary).toBe(
      'A very long title that has been split across two physical lines',
    )
  })

  it('falls back to DURATION when DTEND is missing', () => {
    const raw = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:duration@example',
      'DTSTART:20260831T090000Z',
      'DURATION:PT1H30M',
      'SUMMARY:With duration',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')

    const event = parseIcs(raw).events[0]!
    expect(event.end.getTime() - event.start.getTime()).toBe(90 * 60 * 1000)
  })

  it('reads a local time with a TZID', () => {
    const raw = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:tzid@example',
      'DTSTART;TZID=Europe/Amsterdam:20260831T090000',
      'DTEND;TZID=Europe/Amsterdam:20260831T100000',
      'SUMMARY:Local time',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')

    const event = parseIcs(raw).events[0]!
    expect(event.start.getTime()).toBe(wallToUtc('2026-08-31T09:00', AMS).getTime())
  })

  it('skips components it does not import, and says so', () => {
    const raw = [
      'BEGIN:VCALENDAR',
      'BEGIN:VTIMEZONE',
      'TZID:Europe/Amsterdam',
      'END:VTIMEZONE',
      'BEGIN:VEVENT',
      'UID:with-alarm@example',
      'DTSTART:20260831T090000Z',
      'DTEND:20260831T100000Z',
      'SUMMARY:Has an alarm',
      'BEGIN:VALARM',
      'TRIGGER:-PT10M',
      'ACTION:DISPLAY',
      'END:VALARM',
      'END:VEVENT',
      'BEGIN:VTODO',
      'UID:todo@example',
      'SUMMARY:Not imported',
      'END:VTODO',
      'END:VCALENDAR',
    ].join('\r\n')

    const parsed = parseIcs(raw)
    expect(parsed.events).toHaveLength(1)
    expect(parsed.events[0]!.summary).toBe('Has an alarm')
    expect(parsed.skipped.map((entry) => entry.type)).toContain('VTODO')
  })

  it('returns nothing for input that is not a calendar', () => {
    expect(parseIcs('just some text').events).toHaveLength(0)
  })
})
