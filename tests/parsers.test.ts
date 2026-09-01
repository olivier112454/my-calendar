import { describe, expect, it } from 'vitest'
import { parseEventText } from '@/lib/nlp/parse-event'
import { parseTaskLine } from '@/lib/nlp/parse-task'
import { utcToWall } from '@/lib/datetime'
import { AMS } from './helpers'

/**
 * The natural-language parsers.
 *
 * These decide what a typed sentence becomes, and the user confirms the result,
 * so the bar is "recognises the common shapes and is honest about the rest" —
 * not "never wrong". The tests below encode the shapes that must work, and the
 * ones that must NOT be mistaken for appointments.
 */

// A fixed Monday, so "tomorrow" and weekday names are deterministic.
const NOW = new Date('2026-08-31T10:00:00Z')

const parse = (text: string) => parseEventText(text, { timezone: AMS, now: NOW })

describe('event text', () => {
  it('reads a day and a time', () => {
    const draft = parse('Dinner tomorrow at 19:00')
    expect(draft.title).toBe('Dinner')
    expect(utcToWall(new Date(draft.start!), AMS)).toBe('2026-09-01T19:00')
    expect(draft.confidence).toBeGreaterThan(0.5)
  })

  it('reads a 12-hour time', () => {
    const draft = parse('Coffee tomorrow at 3pm')
    expect(utcToWall(new Date(draft.start!), AMS)).toBe('2026-09-01T15:00')
  })

  it('reads a range', () => {
    const draft = parse('Workshop Friday 10:00-16:00')
    expect(utcToWall(new Date(draft.start!), AMS)).toBe('2026-09-04T10:00')
    expect(utcToWall(new Date(draft.end!), AMS)).toBe('2026-09-04T16:00')
  })

  it('treats a bare weekday as the next one, never today', () => {
    // NOW is a Monday; "Monday" means next week.
    const draft = parse('Standup Monday at 9')
    expect(utcToWall(new Date(draft.start!), AMS).slice(0, 10)).toBe('2026-09-07')
  })

  it('reads "next" as the week after', () => {
    const draft = parse('Review next Tuesday at 14:00')
    expect(utcToWall(new Date(draft.start!), AMS).slice(0, 10)).toBe('2026-09-08')
  })

  it('reads an explicit date', () => {
    const draft = parse('Conference 12 September at 09:00')
    expect(utcToWall(new Date(draft.start!), AMS).slice(0, 10)).toBe('2026-09-12')
  })

  it('rolls a past date into next year', () => {
    const draft = parse('Party 1 January at 20:00')
    expect(utcToWall(new Date(draft.start!), AMS).slice(0, 4)).toBe('2027')
  })

  it('reads a duration', () => {
    const draft = parse('Call tomorrow at 10:00 for 30 minutes')
    const minutes =
      (Date.parse(draft.end!) - Date.parse(draft.start!)) / 60_000
    expect(minutes).toBe(30)
  })

  it('reads a recurrence', () => {
    const draft = parse('Gym every Monday at 8:00')
    expect(draft.recurrenceRule).toBe('FREQ=WEEKLY;BYDAY=MO')
  })

  it('reads every weekday', () => {
    expect(parse('Standup every weekday at 9:30').recurrenceRule).toBe(
      'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
    )
  })

  it('reads a location at the end', () => {
    const draft = parse('Lunch tomorrow at 12:30 at Fratelli')
    expect(draft.location).toBe('Fratelli')
  })

  it('reads participants by name and by address', () => {
    const draft = parse('Call with Mark and Emma tomorrow at 11:00')
    expect(draft.participants?.map((entry) => entry.name)).toEqual(['Mark', 'Emma'])

    const withEmail = parse('Sync tomorrow at 11:00 emma@example.com')
    expect(withEmail.participants?.[0]?.email).toBe('emma@example.com')
  })

  it('handles an all-day event', () => {
    const draft = parse('Holiday tomorrow all-day')
    expect(draft.allDay).toBe(true)
    expect(utcToWall(new Date(draft.start!), AMS)).toBe('2026-09-01T00:00')
    expect(utcToWall(new Date(draft.end!), AMS)).toBe('2026-09-02T00:00')
  })

  it('keeps confidence low when there is nothing to go on', () => {
    const draft = parse('some thoughts about the thing')
    expect(draft.confidence).toBeLessThan(0.45)
  })

  it('never returns an empty title', () => {
    expect(parse('tomorrow at 10:00').title).toBeTruthy()
  })
})

describe('task lines', () => {
  const parseTask = (text: string) => parseTaskLine(text, AMS)

  it('reads priority, estimate and project', () => {
    const task = parseTask('Send the report tomorrow p1 45m #Work')
    expect(task.title).toBe('Send the report')
    expect(task.priority).toBe('P1')
    expect(task.estimatedMinutes).toBe(45)
    expect(task.projectName).toBe('Work')
    expect(task.dueAt).not.toBeNull()
  })

  it('reads hours as minutes', () => {
    expect(parseTask('Draft the deck 1.5h').estimatedMinutes).toBe(90)
    expect(parseTask('Draft the deck 2 hours').estimatedMinutes).toBe(120)
  })

  it('accepts the bang form for priority', () => {
    expect(parseTask('Fix the bug !2').priority).toBe('P2')
  })

  it('leaves a plain line alone', () => {
    const task = parseTask('Buy milk')
    expect(task.title).toBe('Buy milk')
    expect(task.dueAt).toBeNull()
    expect(task.priority).toBeNull()
    expect(task.estimatedMinutes).toBeNull()
  })

  it('reads an ISO date', () => {
    const task = parseTask('Renew insurance 2026-12-01')
    expect(task.dueAt).not.toBeNull()
    expect(utcToWall(new Date(task.dueAt!), AMS).slice(0, 10)).toBe('2026-12-01')
  })
})
