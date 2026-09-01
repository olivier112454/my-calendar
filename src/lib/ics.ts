import { fromZonedTime } from 'date-fns-tz'
import { dayKeyOf } from './datetime'
import { appConfig } from '@/config/app'

/**
 * iCalendar (RFC 5545) import and export.
 *
 * Hand-written rather than pulled from a library, for two reasons: the subset
 * a calendar app actually needs is small, and the awkward parts — line folding,
 * escaping, and the `DTSTART;VALUE=DATE` form for all-day events — are exactly
 * the parts a general parser gets wrong for our data model anyway.
 *
 * Scope: VEVENT only. VTODO and VJOURNAL are skipped rather than half-read.
 */

export interface IcsEvent {
  uid: string
  summary: string
  description: string | null
  location: string | null
  start: Date
  end: Date
  allDay: boolean
  timezone: string | null
  recurrenceRule: string | null
  exDates: string[]
  status: 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED'
  transparency: 'BUSY' | 'FREE'
  organizer: string | null
  attendees: { email: string; name: string | null }[]
  url: string | null
}

/* ------------------------------------------------------------- exporting */

export interface IcsExportOptions {
  calendarName: string
  productId?: string
}

export function toIcs(events: IcsEvent[], options: IcsExportOptions): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${options.productId ?? `-//${appConfig.name}//EN`}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(options.calendarName)}`,
  ]

  for (const event of events) {
    lines.push('BEGIN:VEVENT')
    lines.push(`UID:${event.uid}`)
    lines.push(`DTSTAMP:${formatUtc(new Date())}`)

    if (event.allDay) {
      const zone = event.timezone ?? 'UTC'
      lines.push(`DTSTART;VALUE=DATE:${compactDate(dayKeyOf(event.start, zone))}`)
      lines.push(`DTEND;VALUE=DATE:${compactDate(dayKeyOf(event.end, zone))}`)
    } else {
      lines.push(`DTSTART:${formatUtc(event.start)}`)
      lines.push(`DTEND:${formatUtc(event.end)}`)
    }

    lines.push(`SUMMARY:${escapeText(event.summary)}`)
    if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`)
    if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`)
    if (event.url) lines.push(`URL:${escapeText(event.url)}`)
    lines.push(`STATUS:${event.status}`)
    lines.push(`TRANSP:${event.transparency === 'FREE' ? 'TRANSPARENT' : 'OPAQUE'}`)

    if (event.recurrenceRule) lines.push(`RRULE:${event.recurrenceRule}`)
    if (event.exDates.length > 0) {
      lines.push(
        `EXDATE:${event.exDates.map((iso) => formatUtc(new Date(iso))).join(',')}`,
      )
    }

    if (event.organizer) {
      lines.push(`ORGANIZER:mailto:${event.organizer}`)
    }
    for (const attendee of event.attendees) {
      const name = attendee.name ? `;CN=${escapeText(attendee.name)}` : ''
      lines.push(`ATTENDEE${name}:mailto:${attendee.email}`)
    }

    lines.push('END:VEVENT')
  }

  lines.push('END:VCALENDAR')

  // RFC 5545 requires CRLF and folding at 75 octets.
  return lines.map(fold).join('\r\n') + '\r\n'
}

function formatUtc(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

function compactDate(dayKey: string): string {
  return dayKey.replace(/-/g, '')
}

function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

/** Folds a long line into 75-octet chunks with a leading space on each fold. */
function fold(line: string): string {
  if (line.length <= 75) return line
  const parts: string[] = [line.slice(0, 75)]
  let rest = line.slice(75)
  while (rest.length > 74) {
    parts.push(` ${rest.slice(0, 74)}`)
    rest = rest.slice(74)
  }
  if (rest.length > 0) parts.push(` ${rest}`)
  return parts.join('\r\n')
}

/* ------------------------------------------------------------- importing */

export interface IcsParseResult {
  calendarName: string | null
  events: IcsEvent[]
  /** Components we recognised but did not import, so the UI can say so. */
  skipped: { type: string; count: number }[]
}

export function parseIcs(input: string): IcsParseResult {
  const lines = unfold(input)
  const events: IcsEvent[] = []
  const skipped = new Map<string, number>()

  let calendarName: string | null = null
  let current: Record<string, { value: string; params: Record<string, string> }> | null =
    null
  let currentAttendees: { email: string; name: string | null }[] = []
  let currentExDates: string[] = []
  const componentStack: string[] = []

  for (const line of lines) {
    const parsed = parseLine(line)
    if (!parsed) continue
    const { name, value, params } = parsed

    if (name === 'BEGIN') {
      componentStack.push(value)
      if (value === 'VEVENT') {
        current = {}
        currentAttendees = []
        currentExDates = []
      }
      continue
    }

    if (name === 'END') {
      const component = componentStack.pop()
      if (component === 'VEVENT' && current) {
        const event = buildEvent(current, currentAttendees, currentExDates)
        if (event) events.push(event)
        current = null
      } else if (component && component !== 'VCALENDAR' && component !== 'VEVENT') {
        skipped.set(component, (skipped.get(component) ?? 0) + 1)
      }
      continue
    }

    // Ignore properties inside nested components such as VALARM or VTIMEZONE.
    if (componentStack[componentStack.length - 1] !== 'VEVENT') {
      if (name === 'X-WR-CALNAME') calendarName = unescapeText(value)
      continue
    }

    if (name === 'ATTENDEE') {
      const email = value.replace(/^mailto:/i, '').trim().toLowerCase()
      if (email) {
        currentAttendees.push({ email, name: params.CN ? unescapeText(params.CN) : null })
      }
      continue
    }

    if (name === 'EXDATE') {
      for (const entry of value.split(',')) {
        const date = parseDateValue(entry.trim(), params)
        if (date) currentExDates.push(date.toISOString())
      }
      continue
    }

    if (current) current[name] = { value, params }
  }

  return {
    calendarName,
    events,
    skipped: [...skipped.entries()].map(([type, count]) => ({ type, count })),
  }
}

function buildEvent(
  fields: Record<string, { value: string; params: Record<string, string> }>,
  attendees: { email: string; name: string | null }[],
  exDates: string[],
): IcsEvent | null {
  const startField = fields.DTSTART
  if (!startField) return null

  const allDay = startField.params.VALUE === 'DATE'
  const start = parseDateValue(startField.value, startField.params)
  if (!start) return null

  let end: Date | null = fields.DTEND
    ? parseDateValue(fields.DTEND.value, fields.DTEND.params)
    : null

  // No DTEND: use DURATION, or fall back to a sensible default.
  if (!end && fields.DURATION) {
    const minutes = parseDuration(fields.DURATION.value)
    if (minutes !== null) end = new Date(start.getTime() + minutes * 60_000)
  }
  if (!end) {
    end = new Date(start.getTime() + (allDay ? 86_400_000 : 60 * 60_000))
  }

  const status = (fields.STATUS?.value ?? 'CONFIRMED').toUpperCase()

  return {
    uid: fields.UID?.value ?? `${start.getTime()}-${Math.random().toString(36).slice(2)}`,
    summary: unescapeText(fields.SUMMARY?.value ?? '(no title)'),
    description: fields.DESCRIPTION ? unescapeText(fields.DESCRIPTION.value) : null,
    location: fields.LOCATION ? unescapeText(fields.LOCATION.value) : null,
    start,
    end,
    allDay,
    timezone: startField.params.TZID ?? null,
    recurrenceRule: fields.RRULE?.value ?? null,
    exDates,
    status:
      status === 'CANCELLED'
        ? 'CANCELLED'
        : status === 'TENTATIVE'
          ? 'TENTATIVE'
          : 'CONFIRMED',
    transparency: fields.TRANSP?.value === 'TRANSPARENT' ? 'FREE' : 'BUSY',
    organizer: fields.ORGANIZER?.value.replace(/^mailto:/i, '').toLowerCase() ?? null,
    attendees,
    url: fields.URL?.value ?? null,
  }
}

/** Reverses RFC 5545 line folding. */
function unfold(input: string): string[] {
  const raw = input.split(/\r\n|\n|\r/)
  const out: string[] = []
  for (const line of raw) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length > 0) {
      out[out.length - 1] += line.slice(1)
    } else {
      out.push(line)
    }
  }
  return out.filter((line) => line.trim() !== '')
}

function parseLine(
  line: string,
): { name: string; value: string; params: Record<string, string> } | null {
  const colon = indexOfUnquoted(line, ':')
  if (colon === -1) return null

  const head = line.slice(0, colon)
  const value = line.slice(colon + 1)
  const [name, ...paramParts] = head.split(';')

  const params: Record<string, string> = {}
  for (const part of paramParts) {
    const equals = part.indexOf('=')
    if (equals === -1) continue
    params[part.slice(0, equals).toUpperCase()] = part
      .slice(equals + 1)
      .replace(/^"|"$/g, '')
  }

  return { name: (name ?? '').toUpperCase(), value, params }
}

/** A colon inside a quoted parameter value does not end the property name. */
function indexOfUnquoted(line: string, target: string): number {
  let quoted = false
  for (let index = 0; index < line.length; index++) {
    const char = line[index]
    if (char === '"') quoted = !quoted
    else if (char === target && !quoted) return index
  }
  return -1
}

function parseDateValue(value: string, params: Record<string, string>): Date | null {
  const dateOnly = value.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (dateOnly) {
    const [, y, m, d] = dateOnly
    return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)))
  }

  const full = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/)
  if (!full) return null
  const [, y, m, d, hh, mm, ss, zulu] = full

  if (zulu) {
    return new Date(
      Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss)),
    )
  }

  // A local time with a TZID: interpret it in that zone.
  const tzid = params.TZID
  if (tzid) {
    try {
      return fromZonedTime(`${y}-${m}-${d}T${hh}:${mm}`, tzid)
    } catch {
      // An unknown or malformed TZID falls through to a floating reading rather
      // than dropping the event.
    }
  }

  // Floating time: treat as UTC, which is what the spec leaves to the client.
  return new Date(
    Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss)),
  )
}

/** "PT1H30M" -> 90. */
function parseDuration(value: string): number | null {
  const match = value.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/)
  if (!match) return null
  const [, days, hours, minutes] = match
  return (
    Number(days ?? 0) * 1440 + Number(hours ?? 0) * 60 + Number(minutes ?? 0)
  )
}

function unescapeText(value: string): string {
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
}
