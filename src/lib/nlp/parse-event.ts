import { addDaysToKey, dayKeyOf, monthKeyBounds, wallToUtc, weekdayOf } from '../datetime'
import {
  DAYPART_PATTERN,
  DURATION_UNIT_PATTERN,
  DUTCH_CLOCK_PATTERN,
  MONTHS,
  MONTH_PATTERN,
  NAMED_DURATION_PATTERN,
  QUALIFIER_PATTERN,
  WEEKDAYS,
  WEEKDAY_PATTERN,
  type Daypart,
  daypartOf,
  durationUnitToMinutes,
  dutchClockToMinutes,
  isNextQualifier,
  namedDurationToMinutes,
  resolveTwelveHour,
} from './vocabulary'
import type { EventDraft } from '@/types/domain'

/**
 * Natural-language event parser.
 *
 * "Lunch with Mark tomorrow at 13" — or "Lunch met Mark morgen om half twee" —
 * becomes a draft the user confirms, never a saved event. Everything it
 * recognises is reported back in `matched`, so the preview can say what it
 * understood rather than silently guessing.
 *
 * English and Dutch are read the same way, without a language setting: the
 * words live in `./vocabulary` and both are tried against every line.
 *
 * This is deliberately a plain, deterministic parser: it runs instantly, works
 * offline, and costs nothing. `AssistantService` can later hand the same text to
 * a model and return the same `EventDraft` shape when a sentence defeats it —
 * the callers do not change.
 */

const DEFAULT_DURATION_MINUTES = 60

export interface ParseOptions {
  timezone: string
  now?: Date
  defaultDurationMinutes?: number
}

export function parseEventText(input: string, options: ParseOptions): EventDraft {
  const timezone = options.timezone
  const now = options.now ?? new Date()
  // Every day expression resolves against this one instant. Reading the real
  // clock again further down would ignore an injected `now`, and would let a
  // sentence straddle midnight and pick two different "today"s.
  const today = dayKeyOf(now, timezone)
  const defaultDuration = options.defaultDurationMinutes ?? DEFAULT_DURATION_MINUTES

  // Pad with spaces so every pattern can rely on word boundaries.
  let rest = ` ${input.trim()} `
  const matched: string[] = []
  let confidence = 0

  // A handler returning false rejects the match: the pattern found something
  // shaped right that turned out not to be, so the text stays for a later rule
  // instead of being eaten and taken out of the title.
  const consume = (
    pattern: RegExp,
    handler: (match: RegExpMatchArray) => void | boolean,
  ) => {
    const match = rest.match(pattern)
    if (!match) return false
    if (handler(match) === false) return false
    rest = rest.replace(match[0], ' ')
    return true
  }

  /* ------------------------------------------------------------ recurrence */

  let recurrenceRule: string | null = null

  // "every Monday" / "elke maandag" / "iedere week"
  consume(
    new RegExp(
      `\\b(?:every|elke|iedere)\\s+(day|weekday|week|month|year|dag|werkdag|weekdag|week|maand|jaar|${WEEKDAY_PATTERN})\\b`,
      'i',
    ),
    (match) => {
      const unit = match[1]!.toLowerCase()
      if (unit === 'day' || unit === 'dag') recurrenceRule = 'FREQ=DAILY'
      else if (unit === 'weekday' || unit === 'werkdag' || unit === 'weekdag') {
        recurrenceRule = 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'
      } else if (unit === 'week') recurrenceRule = 'FREQ=WEEKLY'
      else if (unit === 'month' || unit === 'maand') recurrenceRule = 'FREQ=MONTHLY'
      else if (unit === 'year' || unit === 'jaar') recurrenceRule = 'FREQ=YEARLY'
      else {
        const weekday = WEEKDAYS[unit]!
        recurrenceRule = `FREQ=WEEKLY;BYDAY=${['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][weekday]}`
      }
      matched.push(`repeats ${match[1]}`)
      confidence += 0.15
    },
  )

  // The single-word Dutch forms, which carry no "elke".
  if (!recurrenceRule) {
    consume(/\b(dagelijks|wekelijks|maandelijks|jaarlijks)\b/i, (match) => {
      const word = match[1]!.toLowerCase()
      recurrenceRule =
        word === 'dagelijks'
          ? 'FREQ=DAILY'
          : word === 'wekelijks'
            ? 'FREQ=WEEKLY'
            : word === 'maandelijks'
              ? 'FREQ=MONTHLY'
              : 'FREQ=YEARLY'
      matched.push(`repeats ${word}`)
      confidence += 0.15
    })
  }

  /* ------------------------------------------------------------------ date */

  let dayKey = today
  let dateFound = false
  // Set by the Dutch words that name a part of the day; applied to any 12-hour
  // reading further down.
  let daypart: Daypart | null = null

  const setDay = (key: string, label: string) => {
    dayKey = key
    dateFound = true
    matched.push(label)
    confidence += 0.3
  }

  // "3 September", "September 3", "3 sep", "3 maart"
  if (
    !dateFound &&
    consume(
      new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th|e)?\\s+(${MONTH_PATTERN})\\b`, 'i'),
      (match) => {
        setDay(
          resolveMonthDay(Number(match[1]), MONTHS[match[2]!.toLowerCase()]!, now, timezone),
          `${match[1]} ${match[2]}`,
        )
      },
    )
  ) {
    /* handled */
  } else if (
    !dateFound &&
    consume(
      new RegExp(`\\b(${MONTH_PATTERN})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'i'),
      (match) => {
        setDay(
          resolveMonthDay(Number(match[2]), MONTHS[match[1]!.toLowerCase()]!, now, timezone),
          `${match[1]} ${match[2]}`,
        )
      },
    )
  ) {
    /* handled */
  }

  // "12/9" or "12-9" — day first, matching European convention.
  if (!dateFound) {
    consume(/\b(\d{1,2})[/-](\d{1,2})(?![\d:])\b/, (match) => {
      setDay(
        resolveMonthDay(Number(match[1]), Number(match[2]) - 1, now, timezone),
        `${match[1]}/${match[2]}`,
      )
    })
  }

  if (!dateFound) {
    consume(/\b(?:day\s+after\s+tomorrow|overmorgen)\b/i, () =>
      setDay(addDaysToKey(today, 2), 'day after tomorrow'),
    )
  }
  // The Dutch compounds name a day and a part of it in one word, and have to be
  // tried before the bare "morgen" they contain.
  if (!dateFound) {
    consume(/\bmorgen(ochtend|middag|avond)\b/i, (match) => {
      daypart = daypartOf(match[1]!)
      setDay(addDaysToKey(today, 1), `tomorrow ${match[1]!.toLowerCase()}`)
    })
  }
  if (!dateFound) {
    consume(/\b(vanochtend|vanmorgen|vanmiddag|vanavond|vannacht)\b/i, (match) => {
      daypart = daypartOf(match[1]!)
      setDay(today, match[1]!.toLowerCase())
    })
  }
  if (!dateFound) {
    consume(/\b(?:tomorrow|morgen)\b/i, () => setDay(addDaysToKey(today, 1), 'tomorrow'))
  }
  if (!dateFound) {
    consume(/\b(?:today|vandaag)\b/i, () => setDay(today, 'today'))
  }
  if (!dateFound) {
    consume(/\btonight\b/i, () => {
      daypart = 'pm'
      setDay(today, 'tonight')
    })
  }
  // "eind van de maand" — the last day, which is what a deadline means by it.
  if (!dateFound) {
    consume(/\b(?:aan\s+het\s+)?eind(?:e)?\s+van\s+de\s+maand\b/i, () =>
      setDay(monthKeyBounds(today).last, 'end of the month'),
    )
  }

  // "next Tuesday" / "Tuesday" / "this Friday" / "volgende dinsdag" / "vrijdag"
  const NEXT_WEEK = /\b(?:next\s+week|volgende\s+week)\b/i
  if (!dateFound) {
    const nextWeek = NEXT_WEEK.test(rest)
    consume(
      new RegExp(`\\b(?:(${QUALIFIER_PATTERN})\\s+)?(${WEEKDAY_PATTERN})\\b`, 'i'),
      (match) => {
        const qualifier = match[1]?.toLowerCase()
        const target = WEEKDAYS[match[2]!.toLowerCase()]!

        let delta = (target - weekdayOf(today) + 7) % 7
        // A bare weekday name always means the next one, never today.
        if (delta === 0) delta = 7
        if (isNextQualifier(qualifier) || nextWeek) delta += 7

        setDay(
          addDaysToKey(today, delta),
          `${qualifier ? `${qualifier} ` : ''}${match[2]}`,
        )
      },
    )
    // Only once a weekday has actually used it. Stripping it unconditionally
    // discarded "volgende week" on a line that named no day, leaving the event
    // on today with the words gone from the title.
    if (dateFound) rest = rest.replace(NEXT_WEEK, ' ')
  }

  // A bare "next week" / "volgende week" with no weekday after it.
  if (!dateFound) {
    consume(NEXT_WEEK, () => setDay(addDaysToKey(today, 7), 'next week'))
  }

  if (!dateFound) {
    consume(/\b(?:in|over)\s+(\d{1,2})\s+(?:days?|dagen|dag)\b/i, (match) =>
      setDay(addDaysToKey(today, Number(match[1])), `in ${match[1]} days`),
    )
  }
  if (!dateFound) {
    consume(/\b(?:in|over)\s+(\d{1,2})\s+(?:weeks?|weken|week)\b/i, (match) =>
      setDay(addDaysToKey(today, Number(match[1]) * 7), `in ${match[1]} weeks`),
    )
  }

  /* ------------------------------------------------------------------ time */

  let startMinutes: number | null = null
  let endMinutes: number | null = null
  let allDay = false

  // A part of the day stated on its own ("'s middags", "'s avonds"). Read before
  // any clock so a 12-hour phrase further on knows which half it belongs to.
  consume(new RegExp(`(?<![\\w'])(?:${DAYPART_PATTERN})\\b`, 'i'), (match) => {
    daypart = daypartOf(match[0])
    matched.push(match[0].trim().toLowerCase())
    confidence += 0.05
  })

  const toMinutes = (hour: number, minute: number, meridiem?: string) => {
    let h = hour
    if (meridiem) {
      const pm = /p/i.test(meridiem)
      if (pm && h < 12) h += 12
      if (!pm && h === 12) h = 0
    }
    return h * 60 + minute
  }

  // "from 10:00 to 12:30", "10:00-12:30", "10-12", "van 10 tot 12"
  consume(
    /\b(?:from\s+|van\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|to|until|till|tot(?:\s+en\s+met)?)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i,
    (match) => {
      const startMeridiem = match[3] ?? match[6]
      startMinutes = toMinutes(Number(match[1]), Number(match[2] ?? 0), startMeridiem)
      endMinutes = toMinutes(Number(match[4]), Number(match[5] ?? 0), match[6])
      // "10-12" where the end reads earlier than the start means it crossed noon.
      if (endMinutes <= startMinutes && !match[6]) endMinutes += 12 * 60
      matched.push(formatRange(startMinutes, endMinutes))
      confidence += 0.35
    },
  )

  // "half vier", "kwart over negen", "tien voor half acht". These name the hour
  // they lead up to, so they are resolved by the vocabulary rather than here.
  if (startMinutes === null) {
    consume(new RegExp(DUTCH_CLOCK_PATTERN, 'i'), (match) => {
      const dialMinutes = dutchClockToMinutes(match)
      if (dialMinutes === null) return false
      const hour = resolveTwelveHour(Math.floor(dialMinutes / 60), daypart)
      startMinutes = hour * 60 + (((dialMinutes % 60) + 60) % 60)
      matched.push(formatClock(startMinutes))
      confidence += 0.3
    })
  }

  // "om 15:00", "om 15 uur", "vanaf 9"
  if (startMinutes === null) {
    consume(/\b(?:om|vanaf)\s+(\d{1,2})(?:[:.](\d{2}))?\s*(?:uur|u)?\b/i, (match) => {
      const hour = Number(match[1])
      // A bare hour under 13 is a 12-hour reading; 15 already says which half.
      startMinutes =
        (hour < 13 ? resolveTwelveHour(hour, daypart) : hour) * 60 + Number(match[2] ?? 0)
      matched.push(formatClock(startMinutes))
      confidence += 0.3
    })
  }

  // "15u30", "9u"
  if (startMinutes === null) {
    consume(/\b(\d{1,2})u(\d{2})?\b/i, (match) => {
      startMinutes = Number(match[1]) * 60 + Number(match[2] ?? 0)
      matched.push(formatClock(startMinutes))
      confidence += 0.3
    })
  }

  if (startMinutes === null) {
    consume(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i, (match) => {
      startMinutes = toMinutes(Number(match[1]), Number(match[2] ?? 0), match[3])
      matched.push(formatClock(startMinutes))
      confidence += 0.3
    })
  }

  if (startMinutes === null) {
    consume(/\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/i, (match) => {
      startMinutes = toMinutes(Number(match[1]), Number(match[2]), match[3])
      matched.push(formatClock(startMinutes))
      confidence += 0.3
    })
  }

  if (startMinutes === null) {
    consume(/\b(\d{1,2})\s*(am|pm)\b/i, (match) => {
      startMinutes = toMinutes(Number(match[1]), 0, match[2])
      matched.push(formatClock(startMinutes))
      confidence += 0.3
    })
  }

  // A bare "14 uur". Only above seven, where the hour cannot also be read as a
  // length: "vergadering 2 uur" is a two-hour meeting, "vergadering 14 uur" is
  // a time. Anything lower falls through to the duration patterns below.
  if (startMinutes === null) {
    consume(/\b(\d{1,2})(?:[:.](\d{2}))?\s*uur\b/i, (match) => {
      const hour = Number(match[1])
      if (hour < 7 || hour > 23) return false
      startMinutes = hour * 60 + Number(match[2] ?? 0)
      matched.push(formatClock(startMinutes))
      confidence += 0.3
    })
  }

  /* -------------------------------------------------------------- duration */

  let durationMinutes: number | null = null

  // "anderhalf uur", "een kwartier", "drie kwartier" — Dutch says these as a
  // phrase, and a quarter of an hour is a unit of its own with no English twin.
  consume(new RegExp(`\\b(?:${NAMED_DURATION_PATTERN})\\b`, 'i'), (match) => {
    const minutes = namedDurationToMinutes(match[0])
    if (minutes === null) return false
    durationMinutes = minutes
    matched.push(`${minutes} min`)
    confidence += 0.1
  })

  // "for 90 minutes" / "for 1.5 hours" / "voor 30 minuten" / a bare "1,5 uur"
  if (durationMinutes === null) {
    consume(
      new RegExp(
        `\\b(?:for|voor|gedurende)?\\s*(\\d+(?:[.,]\\d+)?)\\s*(${DURATION_UNIT_PATTERN})\\b`,
        'i',
      ),
      (match) => {
        const value = Number(match[1]!.replace(',', '.'))
        durationMinutes = durationUnitToMinutes(value, match[2]!)
        matched.push(`${durationMinutes} min`)
        confidence += 0.1
      },
    )
  }

  consume(/\b(?:all[- ]day|hele\s+dag)\b/i, () => {
    allDay = true
    matched.push('all day')
    confidence += 0.2
  })

  /* -------------------------------------------------------------- location */

  let location: string | null = null
  consume(
    // "bij" is included; "op" deliberately is not. "op" ends far too many
    // ordinary Dutch phrases ("op tijd", "bel Jan op") to be read as a place.
    /\s(?:at|in|bij)\s+((?:the\s+|de\s+|het\s+)?[A-Za-zÀ-ÿ0-9][\wÀ-ÿ'&.-]*(?:\s+[A-Za-zÀ-ÿ0-9][\wÀ-ÿ'&.-]*){0,4})\s*$/,
    (match) => {
      location = match[1]!.trim()
      matched.push(`at ${location}`)
      confidence += 0.1
    },
  )

  /* ---------------------------------------------------------- participants */

  const participants: { name?: string; email?: string }[] = []

  // Explicit addresses first — they are unambiguous.
  const emailPattern = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g
  const emails = rest.match(emailPattern) ?? []
  for (const email of emails) {
    participants.push({ email })
    rest = rest.replace(email, ' ')
    matched.push(email)
    confidence += 0.1
  }

  consume(
    /\b(?:with|met|samen\s+met)\s+([A-ZÀ-Þ][\wÀ-ÿ'-]*(?:\s+(?:and\s+|en\s+)?[A-ZÀ-Þ][\wÀ-ÿ'-]*)*)\b/,
    (match) => {
      for (const name of match[1]!.split(/\s+and\s+|\s+en\s+|,\s*/)) {
        const trimmed = name.trim()
        if (trimmed) participants.push({ name: trimmed })
      }
      matched.push(`with ${match[1]}`)
      confidence += 0.1
    },
  )

  /* ------------------------------------------------------------------ title */

  const title =
    rest
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^(?:on|at|the|a|an|om|op|de|het|een)\s+/i, '')
      // Prepositions the clock or date took their object from, left dangling:
      // "Lunch met Mark morgen om" once the time behind "om" was consumed.
      .replace(/\s+(?:on|at|from|om|van|vanaf|tot|voor)$/i, '')
      .replace(/[\s,;:-]+$/, '') || 'New event'

  if (title !== 'New event') confidence += 0.2

  /* ---------------------------------------------------------------- assemble */

  if (allDay) {
    return {
      title,
      start: wallToUtc(`${dayKey}T00:00`, timezone).toISOString(),
      end: wallToUtc(`${addDaysToKey(dayKey, 1)}T00:00`, timezone).toISOString(),
      allDay: true,
      location,
      recurrenceRule,
      participants,
      confidence: Math.min(1, confidence),
      matched,
    }
  }

  // With no time at all this is a hint, not a suggestion: default to the next
  // whole hour and let the low confidence tell the UI to stay quiet about it.
  const resolvedStart = startMinutes ?? defaultStartMinutes(now, timezone, dateFound)
  const resolvedEnd =
    endMinutes ?? resolvedStart + (durationMinutes ?? defaultDuration)

  const start = minutesToInstant(dayKey, resolvedStart, timezone)
  const end = minutesToInstant(dayKey, resolvedEnd, timezone)

  return {
    title,
    start: start.toISOString(),
    end: end.toISOString(),
    allDay: false,
    location,
    recurrenceRule,
    participants,
    confidence: Math.min(1, confidence),
    matched,
  }
}

/* ---------------------------------------------------------------- helpers */

function minutesToInstant(dayKey: string, minutes: number, timezone: string): Date {
  const dayShift = Math.floor(minutes / 1440)
  const within = ((minutes % 1440) + 1440) % 1440
  const hh = String(Math.floor(within / 60)).padStart(2, '0')
  const mm = String(within % 60).padStart(2, '0')
  return wallToUtc(`${addDaysToKey(dayKey, dayShift)}T${hh}:${mm}`, timezone)
}

/** A date in the past almost always means the same date next year. */
function resolveMonthDay(
  day: number,
  monthIndex: number,
  now: Date,
  timezone: string,
): string {
  const year = Number(dayKeyOf(now, timezone).slice(0, 4))
  const candidate = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  if (candidate >= dayKeyOf(now, timezone)) return candidate
  return `${year + 1}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function defaultStartMinutes(now: Date, timezone: string, dateFound: boolean): number {
  if (!dateFound) {
    // No date and no time: the next half hour from now.
    const current =
      Number(new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone,
        hour: '2-digit',
        hour12: false,
      }).format(now)) * 60 +
      Number(
        new Intl.DateTimeFormat('en-GB', { timeZone: timezone, minute: '2-digit' }).format(
          now,
        ),
      )
    return Math.ceil((current + 1) / 30) * 30
  }
  return 9 * 60
}

function formatClock(minutes: number): string {
  return `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(
    minutes % 60,
  ).padStart(2, '0')}`
}

function formatRange(start: number, end: number): string {
  return `${formatClock(start)}–${formatClock(end)}`
}
