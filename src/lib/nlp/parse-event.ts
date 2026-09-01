import { addDaysToKey, dayKeyOf, wallToUtc } from '../datetime'
import type { EventDraft } from '@/types/domain'

/**
 * Natural-language event parser.
 *
 * "Lunch with Mark tomorrow at 13" becomes a draft the user confirms — never a
 * saved event. Everything it recognises is reported back in `matched`, so the
 * preview can say what it understood rather than silently guessing.
 *
 * This is deliberately a plain, deterministic parser: it runs instantly, works
 * offline, and costs nothing. `AssistantService` can later hand the same text to
 * a model and return the same `EventDraft` shape when a sentence defeats it —
 * the callers do not change.
 */

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
}

const MONTHS: Record<string, number> = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
}

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

  const consume = (pattern: RegExp, handler: (match: RegExpMatchArray) => void) => {
    const match = rest.match(pattern)
    if (!match) return false
    handler(match)
    rest = rest.replace(match[0], ' ')
    return true
  }

  /* ------------------------------------------------------------ recurrence */

  let recurrenceRule: string | null = null
  consume(
    /\bevery\s+(day|weekday|week|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\b/i,
    (match) => {
      const unit = match[1]!.toLowerCase()
      if (unit === 'day') recurrenceRule = 'FREQ=DAILY'
      else if (unit === 'weekday') recurrenceRule = 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'
      else if (unit === 'week') recurrenceRule = 'FREQ=WEEKLY'
      else if (unit === 'month') recurrenceRule = 'FREQ=MONTHLY'
      else if (unit === 'year') recurrenceRule = 'FREQ=YEARLY'
      else {
        const weekday = WEEKDAYS[unit]!
        recurrenceRule = `FREQ=WEEKLY;BYDAY=${['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][weekday]}`
      }
      matched.push(`repeats ${match[1]}`)
      confidence += 0.15
    },
  )

  /* ------------------------------------------------------------------ date */

  let dayKey = today
  let dateFound = false

  const setDay = (key: string, label: string) => {
    dayKey = key
    dateFound = true
    matched.push(label)
    confidence += 0.3
  }

  // "3 September", "September 3", "3 sep"
  if (
    !dateFound &&
    consume(
      /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sept?|september|oct|october|nov|november|dec|december)\b/i,
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
      /\b(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sept?|september|oct|october|nov|november|dec|december)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i,
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
    consume(/\bday\s+after\s+tomorrow\b/i, () =>
      setDay(addDaysToKey(today, 2), 'day after tomorrow'),
    )
  }
  if (!dateFound) {
    consume(/\btomorrow\b/i, () => setDay(addDaysToKey(today, 1), 'tomorrow'))
  }
  if (!dateFound) {
    consume(/\btoday\b/i, () => setDay(today, 'today'))
  }
  if (!dateFound) {
    consume(/\btonight\b/i, () => setDay(today, 'tonight'))
  }

  // "next Tuesday" / "Tuesday" / "this Friday"
  if (!dateFound) {
    const nextWeek = /\bnext\s+week\b/i.test(rest)
    consume(
      /\b(?:(next|this|coming)\s+)?(sunday|sun|monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat)\b/i,
      (match) => {
        const qualifier = match[1]?.toLowerCase()
        const target = WEEKDAYS[match[2]!.toLowerCase()]!
        const todayName = today
        const currentDay = new Date(`${todayName}T12:00:00`).getDay()

        let delta = (target - currentDay + 7) % 7
        // A bare weekday name always means the next one, never today.
        if (delta === 0) delta = 7
        if (qualifier === 'next' || nextWeek) delta += 7

        setDay(
          addDaysToKey(todayName, delta),
          `${qualifier ? `${qualifier} ` : ''}${match[2]}`,
        )
      },
    )
    rest = rest.replace(/\bnext\s+week\b/i, ' ')
  }

  if (!dateFound) {
    consume(/\bin\s+(\d{1,2})\s+days?\b/i, (match) =>
      setDay(addDaysToKey(today, Number(match[1])), `in ${match[1]} days`),
    )
  }

  /* ------------------------------------------------------------------ time */

  let startMinutes: number | null = null
  let endMinutes: number | null = null
  let allDay = false

  const toMinutes = (hour: number, minute: number, meridiem?: string) => {
    let h = hour
    if (meridiem) {
      const pm = /p/i.test(meridiem)
      if (pm && h < 12) h += 12
      if (!pm && h === 12) h = 0
    }
    return h * 60 + minute
  }

  // "from 10:00 to 12:30", "10:00-12:30", "10-12"
  consume(
    /\b(?:from\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|to|until|till)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i,
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

  // "for 90 minutes" / "for 1.5 hours"
  let durationMinutes: number | null = null
  consume(/\bfor\s+(\d+(?:[.,]\d+)?)\s*(m|min|mins|minutes?|h|hr|hrs|hours?)\b/i, (match) => {
    const value = Number(match[1]!.replace(',', '.'))
    durationMinutes = /^h/i.test(match[2]!) ? Math.round(value * 60) : Math.round(value)
    matched.push(`${durationMinutes} min`)
    confidence += 0.1
  })

  consume(/\ball[- ]day\b/i, () => {
    allDay = true
    matched.push('all day')
    confidence += 0.2
  })

  /* -------------------------------------------------------------- location */

  let location: string | null = null
  consume(
    /\s(?:at|in)\s+((?:the\s+)?[A-Za-zÀ-ÿ0-9][\wÀ-ÿ'&.-]*(?:\s+[A-Za-zÀ-ÿ0-9][\wÀ-ÿ'&.-]*){0,4})\s*$/,
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
    /\bwith\s+([A-ZÀ-Þ][\wÀ-ÿ'-]*(?:\s+(?:and\s+)?[A-ZÀ-Þ][\wÀ-ÿ'-]*)*)\b/,
    (match) => {
      for (const name of match[1]!.split(/\s+and\s+|,\s*/)) {
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
      .replace(/^(?:on|at|the|a|an)\s+/i, '')
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
