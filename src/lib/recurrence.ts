import { RRule, RRuleSet, Frequency, Weekday } from 'rrule'
import { formatInTimeZone } from 'date-fns-tz'
import { wallToUtc } from './datetime'

/**
 * Recurrence, following RFC 5545.
 *
 * The subtlety that makes hand-rolled recurrence engines wrong is the time
 * zone. `rrule` generates in UTC; a weekly 09:00 series generated that way
 * drifts to 10:00 the moment the clocks change. The fix used throughout this
 * file: run the recurrence on the *wall clock* (a UTC date whose fields are the
 * local ones), then convert each generated field-set back to a real instant
 * through the event's own zone. A 09:00 Monday stays 09:00 on both sides of a
 * DST boundary, which is what the user meant when they said "every Monday".
 */

export interface RecurrenceInput {
  /** RRULE text without the "RRULE:" prefix, e.g. "FREQ=WEEKLY;BYDAY=MO,WE". */
  rule: string
  /** UTC instant of the first occurrence. */
  dtStart: Date
  /** Event duration in milliseconds, held constant across occurrences. */
  durationMs: number
  /** IANA zone the series was authored in. */
  timezone: string
  /** ISO instants removed from the series (EXDATE). */
  exDates?: string[]
}

export interface Occurrence {
  start: Date
  end: Date
  /** The unmodified start, used as the identity of this instance. */
  originalStart: Date
}

const pad = (n: number) => String(n).padStart(2, '0')

/** UTC `Date` whose fields hold the local wall clock in `tz`. */
function toFloating(instant: Date, tz: string): Date {
  const parts = formatInTimeZone(instant, tz, 'yyyy-MM-dd-HH-mm-ss').split('-').map(Number)
  return new Date(Date.UTC(parts[0]!, parts[1]! - 1, parts[2]!, parts[3]!, parts[4]!, parts[5]!))
}

/** Inverse of `toFloating`: wall-clock fields back to a real instant. */
function fromFloating(floating: Date, tz: string): Date {
  const wall =
    `${floating.getUTCFullYear()}-${pad(floating.getUTCMonth() + 1)}-${pad(floating.getUTCDate())}` +
    `T${pad(floating.getUTCHours())}:${pad(floating.getUTCMinutes())}`
  return wallToUtc(wall, tz)
}

function buildSet(input: RecurrenceInput): RRuleSet {
  const set = new RRuleSet()
  const options = RRule.parseString(normaliseRule(input.rule))
  options.dtstart = toFloating(input.dtStart, input.timezone)
  set.rrule(new RRule(options))

  for (const iso of input.exDates ?? []) {
    const date = new Date(iso)
    if (!Number.isNaN(date.getTime())) {
      set.exdate(toFloating(date, input.timezone))
    }
  }
  return set
}

function normaliseRule(rule: string): string {
  return rule.replace(/^RRULE:/i, '').trim()
}

/**
 * Every occurrence overlapping [rangeStart, rangeEnd).
 *
 * The window is widened backwards by the event duration so a long event that
 * *started* before the window but is still running inside it is not missed —
 * the single most common bug in calendar range queries.
 */
export function expandOccurrences(
  input: RecurrenceInput,
  rangeStart: Date,
  rangeEnd: Date,
  limit = 750,
): Occurrence[] {
  if (!input.rule) {
    const end = new Date(input.dtStart.getTime() + input.durationMs)
    return input.dtStart < rangeEnd && end > rangeStart
      ? [{ start: input.dtStart, end, originalStart: input.dtStart }]
      : []
  }

  const set = buildSet(input)
  const searchFrom = new Date(rangeStart.getTime() - input.durationMs)

  const floatingStarts = set.between(
    toFloating(searchFrom, input.timezone),
    toFloating(rangeEnd, input.timezone),
    true,
  )

  const out: Occurrence[] = []
  for (const floating of floatingStarts.slice(0, limit)) {
    const start = fromFloating(floating, input.timezone)
    const end = new Date(start.getTime() + input.durationMs)
    if (start < rangeEnd && end > rangeStart) {
      out.push({ start, end, originalStart: start })
    }
  }
  return out
}

/** The next `count` occurrences from `after` — used by reminders and previews. */
export function nextOccurrences(
  input: RecurrenceInput,
  after: Date,
  count: number,
): Occurrence[] {
  if (!input.rule) {
    const end = new Date(input.dtStart.getTime() + input.durationMs)
    return input.dtStart >= after
      ? [{ start: input.dtStart, end, originalStart: input.dtStart }]
      : []
  }
  const set = buildSet(input)
  const floatingAfter = toFloating(after, input.timezone)
  const out: Occurrence[] = []
  let cursor: Date | null = floatingAfter

  while (out.length < count) {
    const next: Date | null = set.after(cursor, false)
    if (!next) break
    const start = fromFloating(next, input.timezone)
    out.push({
      start,
      end: new Date(start.getTime() + input.durationMs),
      originalStart: start,
    })
    cursor = next
  }
  return out
}

/** Whether an instant is one of the series' occurrences. */
export function isOccurrenceOf(input: RecurrenceInput, instant: Date): boolean {
  if (!input.rule) return input.dtStart.getTime() === instant.getTime()
  const set = buildSet(input)
  const floating = toFloating(instant, input.timezone)
  const found = set.before(new Date(floating.getTime() + 1), true)
  return found?.getTime() === floating.getTime()
}

/* -------------------------------------------------------------- authoring */

export type RecurrencePreset =
  | 'none'
  | 'daily'
  | 'weekdays'
  | 'weekly'
  | 'biweekly'
  | 'monthly'
  | 'yearly'
  | 'custom'

export const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const
export type WeekdayCode = (typeof WEEKDAY_CODES)[number]

export interface CustomRecurrence {
  frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'
  interval: number
  /** Only for WEEKLY. */
  byWeekday?: WeekdayCode[]
  /** Only for MONTHLY: "same date" vs "same weekday of the month". */
  monthlyMode?: 'byMonthDay' | 'byWeekday'
  end?:
    | { type: 'never' }
    | { type: 'until'; date: string } // YYYY-MM-DD
    | { type: 'count'; count: number }
}

/** Turns the composer's preset into an RRULE, given the event's start date. */
export function presetToRule(
  preset: RecurrencePreset,
  startInstant: Date,
  timezone: string,
): string | null {
  if (preset === 'none' || preset === 'custom') return null
  const weekday = WEEKDAY_CODES[Number(formatInTimeZone(startInstant, timezone, 'i')) % 7]
  const dayOfMonth = formatInTimeZone(startInstant, timezone, 'd')
  const monthDay = formatInTimeZone(startInstant, timezone, 'M')

  switch (preset) {
    case 'daily':
      return 'FREQ=DAILY'
    case 'weekdays':
      return 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'
    case 'weekly':
      return `FREQ=WEEKLY;BYDAY=${weekday}`
    case 'biweekly':
      return `FREQ=WEEKLY;INTERVAL=2;BYDAY=${weekday}`
    case 'monthly':
      return `FREQ=MONTHLY;BYMONTHDAY=${dayOfMonth}`
    case 'yearly':
      return `FREQ=YEARLY;BYMONTH=${monthDay};BYMONTHDAY=${dayOfMonth}`
    default:
      return null
  }
}

export function customToRule(
  custom: CustomRecurrence,
  startInstant: Date,
  timezone: string,
): string {
  const parts: string[] = [`FREQ=${custom.frequency}`]
  if (custom.interval > 1) parts.push(`INTERVAL=${custom.interval}`)

  if (custom.frequency === 'WEEKLY' && custom.byWeekday?.length) {
    parts.push(`BYDAY=${custom.byWeekday.join(',')}`)
  }

  if (custom.frequency === 'MONTHLY') {
    if (custom.monthlyMode === 'byWeekday') {
      const weekday = WEEKDAY_CODES[Number(formatInTimeZone(startInstant, timezone, 'i')) % 7]
      const nth = Math.ceil(Number(formatInTimeZone(startInstant, timezone, 'd')) / 7)
      parts.push(`BYDAY=${nth}${weekday}`)
    } else {
      parts.push(`BYMONTHDAY=${formatInTimeZone(startInstant, timezone, 'd')}`)
    }
  }

  if (custom.end?.type === 'count') {
    parts.push(`COUNT=${custom.end.count}`)
  } else if (custom.end?.type === 'until') {
    // UNTIL is an instant; take the end of that local day so the last
    // occurrence on the chosen date is included.
    const until = wallToUtc(`${custom.end.date}T23:59`, timezone)
    parts.push(`UNTIL=${until.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`)
  }

  return parts.join(';')
}

/** Best-effort read of an existing rule back into the custom editor's shape. */
export function ruleToCustom(rule: string): CustomRecurrence | null {
  try {
    const options = RRule.parseString(normaliseRule(rule))
    const freqName = (
      ['YEARLY', 'MONTHLY', 'WEEKLY', 'DAILY'] as const
    )[[Frequency.YEARLY, Frequency.MONTHLY, Frequency.WEEKLY, Frequency.DAILY].indexOf(
      options.freq as Frequency,
    )]
    if (!freqName) return null

    const byWeekday = normaliseWeekdays(options.byweekday)

    return {
      frequency: freqName,
      interval: options.interval ?? 1,
      byWeekday: byWeekday.length ? byWeekday : undefined,
      monthlyMode: options.byweekday ? 'byWeekday' : 'byMonthDay',
      end: options.count
        ? { type: 'count', count: options.count }
        : options.until
          ? { type: 'until', date: options.until.toISOString().slice(0, 10) }
          : { type: 'never' },
    }
  } catch {
    return null
  }
}

function normaliseWeekdays(value: unknown): WeekdayCode[] {
  if (value == null) return []
  const list = Array.isArray(value) ? value : [value]
  const out: WeekdayCode[] = []
  for (const entry of list) {
    if (typeof entry === 'number') out.push(WEEKDAY_CODES[(entry + 1) % 7]!)
    else if (entry instanceof Weekday) out.push(WEEKDAY_CODES[(entry.weekday + 1) % 7]!)
  }
  return out
}

/**
 * Plain-English summary shown in the composer and the details panel.
 * `rrule`'s own toText() produces "every week on Monday, Wednesday"; this
 * trims it to sentence case and appends the end condition readably.
 */
export function describeRule(rule: string | null | undefined): string | null {
  if (!rule) return null
  try {
    const options = RRule.parseString(normaliseRule(rule))
    const text = new RRule(options).toText()
    return text.charAt(0).toUpperCase() + text.slice(1)
  } catch {
    return 'Repeats'
  }
}

/** Matches a preset to an existing rule, so the composer can preselect it. */
export function ruleToPreset(rule: string | null | undefined): RecurrencePreset {
  if (!rule) return 'none'
  const normalised = normaliseRule(rule).toUpperCase()
  if (normalised === 'FREQ=DAILY') return 'daily'
  if (normalised === 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR') return 'weekdays'
  if (/^FREQ=WEEKLY;BYDAY=[A-Z]{2}$/.test(normalised)) return 'weekly'
  if (/^FREQ=WEEKLY;INTERVAL=2;BYDAY=[A-Z]{2}$/.test(normalised)) return 'biweekly'
  if (/^FREQ=MONTHLY;BYMONTHDAY=\d+$/.test(normalised)) return 'monthly'
  if (/^FREQ=YEARLY/.test(normalised)) return 'yearly'
  return 'custom'
}

export function isValidRule(rule: string): boolean {
  try {
    RRule.parseString(normaliseRule(rule))
    return true
  } catch {
    return false
  }
}
