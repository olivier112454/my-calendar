import { addDaysToKey, dayKeyOf, monthKeyBounds, wallToUtc, weekdayOf } from '../datetime'
import {
  DAYPART_PATTERN,
  DURATION_UNIT_PATTERN,
  DUTCH_CLOCK_PATTERN,
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
import type { TaskPriority } from '@/types/domain'

/**
 * Quick-add parser for tasks.
 *
 * Deliberately smaller in scope than the event parser: a task line is short and
 * the conventions are well established, so it recognises a handful of explicit
 * tokens rather than trying to read a sentence. English and Dutch are both
 * read, from the shared vocabulary in `./vocabulary`.
 *
 *   "Send the report tomorrow p1 45m #Work"
 *   -> title "Send the report", due tomorrow, P1, 45 minutes, project Work
 *
 *   "Bel de accountant vrijdag om 15:00 p1 30m"
 *   -> title "Bel de accountant", due Friday 15:00, P1, 30 minutes
 */

export interface ParsedTask {
  title: string
  dueAt: string | null
  priority: TaskPriority | null
  estimatedMinutes: number | null
  projectName: string | null
  /** What was recognised, echoed back so the user can see the interpretation. */
  matched: string[]
}

/** Tasks without a stated time are due at the end of the working day. */
const DEFAULT_DUE_HOUR = 17

/**
 * `now` exists so a caller — and a test — can pin the instant every relative
 * day resolves against. Without it the parser reads the wall clock twice and a
 * line typed at midnight can land on two different days.
 */
export function parseTaskLine(
  input: string,
  timezone: string,
  now: Date = new Date(),
): ParsedTask {
  let rest = ` ${input.trim()} `
  const matched: string[] = []

  // A handler returning false rejects the match, leaving the text in place for
  // a later rule rather than swallowing it out of the title.
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

  /* -------------------------------------------------------------- priority */

  let priority: TaskPriority | null = null
  // `!` is not a word character, so a leading \b would never match "!2" —
  // each alternative carries its own boundary instead.
  consume(/(?:\bp([1-4])\b|!([1-4])\b)/i, (match) => {
    priority = `P${match[1] ?? match[2]}` as TaskPriority
    matched.push(priority)
  })

  /* --------------------------------------------------------------- project */

  let projectName: string | null = null
  consume(/\s#([A-Za-zÀ-ÿ0-9][\wÀ-ÿ-]*)/, (match) => {
    projectName = match[1]!
    matched.push(`#${projectName}`)
  })

  /* ------------------------------------------------------------------ time */

  // Read before the estimate: "om 15 uur" is a clock time, and letting the
  // duration patterns see it first would turn it into a fifteen-hour task.
  let daypart: Daypart | null = null
  consume(new RegExp(`(?<![\\w'])(?:${DAYPART_PATTERN})\\b`, 'i'), (match) => {
    daypart = daypartOf(match[0])
  })

  let dueMinutes: number | null = null

  const setTime = (minutes: number) => {
    dueMinutes = minutes
    matched.push(formatClock(minutes))
  }

  // "om 15:00", "at 9", "om 15 uur"
  consume(/\b(?:om|at)\s+(\d{1,2})(?:[:.](\d{2}))?\s*(?:uur|u)?\b/i, (match) => {
    const hour = Number(match[1])
    setTime(
      (hour < 13 ? resolveTwelveHour(hour, daypart) : hour) * 60 + Number(match[2] ?? 0),
    )
  })

  // "half vier", "kwart over negen"
  if (dueMinutes === null) {
    consume(new RegExp(DUTCH_CLOCK_PATTERN, 'i'), (match) => {
      const dialMinutes = dutchClockToMinutes(match)
      if (dialMinutes === null) return false
      const hour = resolveTwelveHour(Math.floor(dialMinutes / 60), daypart)
      setTime(hour * 60 + (((dialMinutes % 60) + 60) % 60))
    })
  }

  // A bare "15:00".
  if (dueMinutes === null) {
    consume(/\b(\d{1,2}):(\d{2})\b/, (match) => {
      setTime(Number(match[1]) * 60 + Number(match[2]))
    })
  }

  /* -------------------------------------------------------------- estimate */

  let estimatedMinutes: number | null = null

  consume(new RegExp(`\\b(?:${NAMED_DURATION_PATTERN})\\b`, 'i'), (match) => {
    const minutes = namedDurationToMinutes(match[0])
    if (minutes === null) return false
    estimatedMinutes = minutes
    matched.push(`${minutes} min`)
  })

  if (estimatedMinutes === null) {
    consume(
      new RegExp(
        `\\b(\\d+(?:[.,]\\d+)?)\\s*(${DURATION_UNIT_PATTERN})\\b`,
        'i',
      ),
      (match) => {
        const value = Number(match[1]!.replace(',', '.'))
        estimatedMinutes = durationUnitToMinutes(value, match[2]!)
        matched.push(`${estimatedMinutes} min`)
      },
    )
  }

  /* ------------------------------------------------------------------- due */

  let dueKey: string | null = null
  const today = dayKeyOf(now, timezone)

  const setDue = (key: string, label: string) => {
    dueKey = key
    matched.push(label)
  }

  if (!dueKey) consume(/\b(?:today|vandaag)\b/i, () => setDue(today, 'today'))
  if (!dueKey) {
    consume(/\b(?:day\s+after\s+tomorrow|overmorgen)\b/i, () =>
      setDue(addDaysToKey(today, 2), 'day after tomorrow'),
    )
  }
  if (!dueKey) {
    consume(/\b(?:tomorrow|morgen)\b/i, () => setDue(addDaysToKey(today, 1), 'tomorrow'))
  }
  if (!dueKey) {
    consume(/\b(?:in|over)\s+(\d{1,2})\s+(?:days?|dagen|dag)\b/i, (match) =>
      setDue(addDaysToKey(today, Number(match[1])), `in ${match[1]} days`),
    )
  }
  if (!dueKey) {
    consume(/\b(?:in|over)\s+(\d{1,2})\s+(?:weeks?|weken|week)\b/i, (match) =>
      setDue(addDaysToKey(today, Number(match[1]) * 7), `in ${match[1]} weeks`),
    )
  }
  if (!dueKey) {
    consume(/\b(?:aan\s+het\s+)?eind(?:e)?\s+van\s+de\s+maand\b/i, () =>
      setDue(monthKeyBounds(today).last, 'end of the month'),
    )
  }
  if (!dueKey) {
    consume(/\b(?:next\s+week|volgende\s+week)\b/i, () =>
      setDue(addDaysToKey(today, 7), 'next week'),
    )
  }
  if (!dueKey) {
    consume(
      new RegExp(`\\b(?:(${QUALIFIER_PATTERN})\\s+)?(${WEEKDAY_PATTERN})\\b`, 'i'),
      (match) => {
        const target = WEEKDAYS[match[2]!.toLowerCase()]!
        let delta = (target - weekdayOf(today) + 7) % 7
        if (delta === 0) delta = 7
        if (isNextQualifier(match[1])) delta += 7
        setDue(
          addDaysToKey(today, delta),
          `${match[1] ? `${match[1]} ` : ''}${match[2]}`,
        )
      },
    )
  }
  if (!dueKey) {
    consume(/\b(\d{4}-\d{2}-\d{2})\b/, (match) => setDue(match[1]!, match[1]!))
  }

  // A time on its own means today: "Bel de accountant om 15:00" is not a task
  // without a date, it is one due in a few hours.
  if (!dueKey && dueMinutes !== null) dueKey = today

  /* ----------------------------------------------------------------- title */

  const title =
    rest
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^(?:by|on|due|om|op)\s+/i, '')
      // A preposition whose object was consumed behind it.
      .replace(/\s+(?:by|on|at|due|om|op|van|voor|tot)$/i, '')
      .replace(/[\s,;:-]+$/, '') || 'New task'

  const hour = Math.floor((dueMinutes ?? DEFAULT_DUE_HOUR * 60) / 60)
  const minute = (dueMinutes ?? 0) % 60

  return {
    title,
    dueAt: dueKey
      ? wallToUtc(
          `${dueKey}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
          timezone,
        ).toISOString()
      : null,
    priority,
    estimatedMinutes,
    projectName,
    matched,
  }
}

function formatClock(minutes: number): string {
  return `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(
    minutes % 60,
  ).padStart(2, '0')}`
}
