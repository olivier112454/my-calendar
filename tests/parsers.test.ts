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

/**
 * Dutch.
 *
 * The interface is English but the people typing into it are not, and a
 * half-understood line is worse than an unrecognised one: before this,
 * "Lunch met Mark morgen om 13:00" produced an event called "Lunch met Mark
 * morgen om", on the wrong day, with no guest.
 *
 * The clock cases carry most of the weight. Dutch names the hour it is heading
 * towards rather than the one just passed, so "half vier" is 15:30 — an
 * English-shaped reading of it is out by an hour in the wrong direction.
 */
describe('Dutch event text', () => {
  const at = (text: string) => utcToWall(new Date(parse(text).start!), AMS)

  it('reads a day, a time and a guest', () => {
    const draft = parse('Lunch met Mark morgen om 13:00')
    expect(draft.title).toBe('Lunch')
    expect(at('Lunch met Mark morgen om 13:00')).toBe('2026-09-01T13:00')
    expect(draft.participants?.map((entry) => entry.name)).toEqual(['Mark'])
  })

  it('reads "half vier" as half an hour before four', () => {
    expect(at('Tandarts vrijdag om half vier')).toBe('2026-09-04T15:30')
  })

  it('keeps an early "half" in the morning', () => {
    expect(at('Standup morgen om half acht')).toBe('2026-09-01T07:30')
  })

  it('reads "half zeven" as the evening', () => {
    expect(at('Diner zaterdag om half zeven')).toBe('2026-09-05T18:30')
  })

  it('reads quarters past and to', () => {
    expect(at('Kapper morgen kwart over negen')).toBe('2026-09-01T09:15')
    expect(at('Kapper morgen kwart voor negen')).toBe('2026-09-01T08:45')
  })

  it('reads minutes either side of the half hour', () => {
    expect(at('Bel Jan morgen vijf voor half acht')).toBe('2026-09-01T07:25')
    expect(at('Bel Jan morgen tien voor half acht')).toBe('2026-09-01T07:20')
    expect(at('Bel Jan morgen tien over half vier')).toBe('2026-09-01T15:40')
  })

  it('lets the part of the day decide the half', () => {
    expect(at("Etentje vrijdag 's avonds om 7")).toBe('2026-09-04T19:00')
    expect(at("Loop vrijdag 's ochtends om 7")).toBe('2026-09-04T07:00')
  })

  it('reads the compound day words', () => {
    expect(at('Standup morgenochtend om 9')).toBe('2026-09-01T09:00')
    expect(at('Borrel vanavond om 8')).toBe('2026-08-31T20:00')
  })

  it('does not mistake "vanmorgen" or "overmorgen" for "morgen"', () => {
    expect(at('Overleg vanmorgen om 10:00').slice(0, 10)).toBe('2026-08-31')
    expect(at('Overleg overmorgen om 10:00').slice(0, 10)).toBe('2026-09-02')
  })

  it('reads Dutch weekdays, bare and qualified', () => {
    expect(at('Overleg dinsdag om 14:00').slice(0, 10)).toBe('2026-09-01')
    expect(at('Overleg volgende dinsdag om 14:00').slice(0, 10)).toBe('2026-09-08')
    // NOW is a Monday, so a bare "maandag" is the next one.
    expect(at('Overleg maandag om 14:00').slice(0, 10)).toBe('2026-09-07')
  })

  it('reads relative spans', () => {
    expect(at('Training over 3 dagen om 10:00').slice(0, 10)).toBe('2026-09-03')
    expect(at('Sportles over 2 weken om 18:00').slice(0, 10)).toBe('2026-09-14')
    expect(at('Review volgende week om 09:00').slice(0, 10)).toBe('2026-09-07')
  })

  it('reads Dutch month names', () => {
    expect(at('Concert 12 september om 20:00').slice(0, 10)).toBe('2026-09-12')
    // Already past this year, so it rolls forward.
    expect(at('Bespreking 3 maart om 11:00').slice(0, 10)).toBe('2027-03-03')
  })

  it('reads a range with van/tot', () => {
    const draft = parse('Overleg overmorgen van 10 tot 12')
    expect(utcToWall(new Date(draft.start!), AMS)).toBe('2026-09-02T10:00')
    expect(utcToWall(new Date(draft.end!), AMS)).toBe('2026-09-02T12:00')
  })

  it('reads the hour written with a u', () => {
    expect(at('Afspraak morgen om 15u30')).toBe('2026-09-01T15:30')
  })

  it('reads recurrence', () => {
    expect(parse('Sportschool elke maandag om 7 uur').recurrenceRule).toBe(
      'FREQ=WEEKLY;BYDAY=MO',
    )
    expect(parse('Yoga elke dag om 7 uur').recurrenceRule).toBe('FREQ=DAILY')
    expect(parse('Sprint review wekelijks om 10:00').recurrenceRule).toBe('FREQ=WEEKLY')
    expect(parse('Rapportage elke werkdag om 9:00').recurrenceRule).toBe(
      'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
    )
  })

  it('reads durations, including the phrases Dutch has no number for', () => {
    const minutes = (text: string) =>
      (Date.parse(parse(text).end!) - Date.parse(parse(text).start!)) / 60_000
    expect(minutes('Overleg morgen om 10:00 voor 30 minuten')).toBe(30)
    expect(minutes('Workshop morgen om 9:00 anderhalf uur')).toBe(90)
    expect(minutes('Koffie morgen om 15:00 een kwartier')).toBe(15)
    expect(minutes('Standup morgen om 9:00 drie kwartier')).toBe(45)
  })

  it('reads an all-day event', () => {
    expect(parse('Vakantie morgen hele dag').allDay).toBe(true)
  })

  it('reads several guests joined with en', () => {
    const draft = parse('Call met Emma en Priya morgen om 11:00')
    expect(draft.participants?.map((entry) => entry.name)).toEqual(['Emma', 'Priya'])
  })

  it('reads a location after bij', () => {
    expect(parse('Lunch morgen om 12:30 bij Fratelli').location).toBe('Fratelli')
  })

  it('leaves no Dutch preposition stranded in the title', () => {
    expect(parse('Lunch met Mark morgen om 13:00').title).toBe('Lunch')
    expect(parse('Tandarts vrijdag om half vier').title).toBe('Tandarts')
    expect(parse('Overleg overmorgen van 10 tot 12').title).toBe('Overleg')
  })

  it('does not read the English word "do" as Thursday', () => {
    // "do" is the standard Dutch abbreviation for donderdag, which is exactly
    // why the two-letter forms are not in the vocabulary.
    const draft = parse('Do the dishes tomorrow at 18:00')
    expect(utcToWall(new Date(draft.start!), AMS).slice(0, 10)).toBe('2026-09-01')
    expect(draft.title).toBe('Do the dishes')
  })
})

describe('Dutch task lines', () => {
  const parseTask = (text: string) => parseTaskLine(text, AMS, NOW)
  const due = (text: string) => utcToWall(new Date(parseTask(text).dueAt!), AMS)

  it('reads the whole line', () => {
    const task = parseTask('Bel de accountant vrijdag om 15:00 p1 30m')
    expect(task.title).toBe('Bel de accountant')
    expect(task.priority).toBe('P1')
    expect(task.estimatedMinutes).toBe(30)
    expect(due('Bel de accountant vrijdag om 15:00 p1 30m')).toBe('2026-09-04T15:00')
  })

  it('keeps the stated time rather than the end of the working day', () => {
    expect(due('Rapport nakijken morgen om 09:30')).toBe('2026-09-01T09:30')
    // Nothing stated, so the default still applies.
    expect(due('Rapport nakijken morgen')).toBe('2026-09-01T17:00')
  })

  it('treats a time on its own as today', () => {
    expect(due('Tandarts bellen om half vier')).toBe('2026-08-31T15:30')
  })

  it('reads Dutch estimates', () => {
    expect(parseTask('Rapport afmaken morgen 1 uur').estimatedMinutes).toBe(60)
    expect(parseTask('Presentatie voorbereiden drie kwartier').estimatedMinutes).toBe(45)
    expect(parseTask('Mail beantwoorden 20 minuten').estimatedMinutes).toBe(20)
    expect(parseTask('Deck maken 1,5 uur').estimatedMinutes).toBe(90)
  })

  it('reads Dutch due dates', () => {
    expect(due('Boodschappen doen vandaag').slice(0, 10)).toBe('2026-08-31')
    expect(due('Verzekering verlengen overmorgen').slice(0, 10)).toBe('2026-09-02')
    expect(due('Offerte sturen volgende week').slice(0, 10)).toBe('2026-09-07')
    expect(due('Mail beantwoorden over 3 dagen').slice(0, 10)).toBe('2026-09-03')
    expect(due('Factuur betalen eind van de maand').slice(0, 10)).toBe('2026-08-31')
  })

  it('leaves a plain Dutch line alone', () => {
    const task = parseTask('Melk kopen')
    expect(task.title).toBe('Melk kopen')
    expect(task.dueAt).toBeNull()
    expect(task.priority).toBeNull()
    expect(task.estimatedMinutes).toBeNull()
  })
})
