import {
  addDays,
  addMinutes,
  differenceInMinutes,
  endOfMonth,
  format,
  getISOWeek,
  startOfMonth,
} from 'date-fns'
import { fromZonedTime, toZonedTime, formatInTimeZone } from 'date-fns-tz'

/**
 * Time handling rules for the whole app.
 *
 * Instants are stored and passed around as UTC `Date`s. Everything a user sees
 * is derived by projecting that instant into an IANA time zone. There are no
 * hand-rolled offset calculations anywhere: `toISOString()` on a local wall
 * clock silently shifts the day (a 23:30–00:30 appointment ends up with a
 * negative duration), so the only bridge between wall clock and instant is
 * `wallToUtc` / `utcToWall` below.
 *
 * A "day key" is a plain `YYYY-MM-DD` string in a given zone. It is the unit
 * the month grid, agenda grouping and all-day events are built on, because it
 * cannot drift across DST the way a Date can.
 */

export const MINUTES_PER_DAY = 1440

export type DayKey = string // YYYY-MM-DD
export type WallClock = string // YYYY-MM-DDTHH:mm

const pad = (n: number) => String(n).padStart(2, '0')

/** The visitor's own zone, used as the default before settings are loaded. */
export function systemTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** `2026-08-31T14:30` in `tz` -> the matching UTC instant (DST-aware). */
export function wallToUtc(wall: WallClock, tz: string): Date {
  return fromZonedTime(wall, tz)
}

/** UTC instant -> the wall clock a viewer in `tz` reads off it. */
export function utcToWall(date: Date, tz: string): WallClock {
  return formatInTimeZone(date, tz, "yyyy-MM-dd'T'HH:mm")
}

export function dayKeyOf(date: Date, tz: string): DayKey {
  return formatInTimeZone(date, tz, 'yyyy-MM-dd')
}

export function dayKeyFromParts(year: number, month: number, day: number): DayKey {
  return `${year}-${pad(month)}-${pad(day)}`
}

/** Midnight at the start of `dayKey` in `tz`, as a UTC instant. */
export function startOfDayUtc(dayKey: DayKey, tz: string): Date {
  return wallToUtc(`${dayKey}T00:00`, tz)
}

/** Midnight at the start of the NEXT day — the exclusive end of `dayKey`. */
export function endOfDayUtc(dayKey: DayKey, tz: string): Date {
  return startOfDayUtc(addDaysToKey(dayKey, 1), tz)
}

/**
 * Minutes from local midnight. Used for vertical placement in the time grid.
 *
 * Deliberately computed from the wall clock rather than from
 * `(instant - midnight) / 60000`: on the 25-hour day that ends DST those two
 * disagree by an hour, and the grid shows labelled wall-clock hours, so the
 * wall clock is what must line up.
 */
export function minutesIntoDay(date: Date, tz: string): number {
  const parts = formatInTimeZone(date, tz, 'HH:mm').split(':')
  return Number(parts[0]) * 60 + Number(parts[1])
}

export function addDaysToKey(dayKey: DayKey, days: number): DayKey {
  const [y, m, d] = dayKey.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
}

export function diffDayKeys(a: DayKey, b: DayKey): number {
  const toUtc = (k: DayKey) => {
    const [y, m, d] = k.split('-').map(Number)
    return Date.UTC(y, m - 1, d)
  }
  return Math.round((toUtc(a) - toUtc(b)) / 86_400_000)
}

/** Local `Date` at noon — safe for calendar-grid arithmetic (never near a DST edge). */
export function dayKeyToLocalDate(dayKey: DayKey): Date {
  const [y, m, d] = dayKey.split('-').map(Number)
  return new Date(y, m - 1, d, 12, 0, 0, 0)
}

export function todayKey(tz: string): DayKey {
  return dayKeyOf(new Date(), tz)
}

/** 0 = Sunday … 6 = Saturday, in the given zone. */
export function weekdayOf(dayKey: DayKey): number {
  return dayKeyToLocalDate(dayKey).getDay()
}

export function isWeekend(dayKey: DayKey): boolean {
  const wd = weekdayOf(dayKey)
  return wd === 0 || wd === 6
}

export function isoWeekNumber(dayKey: DayKey): number {
  return getISOWeek(dayKeyToLocalDate(dayKey))
}

/** First day of the week containing `dayKey`, honouring the user's week start. */
export function startOfWeekKey(dayKey: DayKey, weekStartsOn: number): DayKey {
  const wd = weekdayOf(dayKey)
  const delta = (wd - weekStartsOn + 7) % 7
  return addDaysToKey(dayKey, -delta)
}

export function rangeOfDayKeys(startKey: DayKey, count: number): DayKey[] {
  return Array.from({ length: count }, (_, i) => addDaysToKey(startKey, i))
}

/**
 * The 6x7 grid the month view renders: always six rows, so the layout never
 * jumps between a 4- and 5-row month.
 */
export function monthGridKeys(dayKey: DayKey, weekStartsOn: number): DayKey[] {
  const date = dayKeyToLocalDate(dayKey)
  const first = format(startOfMonth(date), 'yyyy-MM-dd')
  const gridStart = startOfWeekKey(first, weekStartsOn)
  return rangeOfDayKeys(gridStart, 42)
}

export function monthKeyBounds(dayKey: DayKey): { first: DayKey; last: DayKey } {
  const date = dayKeyToLocalDate(dayKey)
  return {
    first: format(startOfMonth(date), 'yyyy-MM-dd'),
    last: format(endOfMonth(date), 'yyyy-MM-dd'),
  }
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function formatTime(date: Date, tz: string, use24h: boolean): string {
  return formatInTimeZone(date, tz, use24h ? 'HH:mm' : 'h:mm a')
}

/** Drops ":00" in 12-hour mode so a grid reads "9 AM" rather than "9:00 AM". */
export function formatTimeCompact(date: Date, tz: string, use24h: boolean): string {
  if (use24h) return formatInTimeZone(date, tz, 'HH:mm')
  const minutes = formatInTimeZone(date, tz, 'mm')
  return formatInTimeZone(date, tz, minutes === '00' ? 'h a' : 'h:mm a')
}

export function formatMinutesOfDay(minutes: number, use24h: boolean): string {
  const h = Math.floor(minutes / 60) % 24
  const m = minutes % 60
  if (use24h) return `${pad(h)}:${pad(m)}`
  const suffix = h < 12 ? 'AM' : 'PM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${h12} ${suffix}` : `${h12}:${pad(m)} ${suffix}`
}

export function formatDayLabel(dayKey: DayKey, pattern = 'EEE d MMM'): string {
  return format(dayKeyToLocalDate(dayKey), pattern)
}

/** "1h 30m", "45m", "2h" — used for durations and time budgets. */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

/** "in 20 minutes", "3 hours ago" — relative to now, never a bare timestamp. */
export function formatRelative(date: Date, now = new Date()): string {
  const diff = differenceInMinutes(date, now)
  const abs = Math.abs(diff)
  const say = (value: number, unit: Intl.RelativeTimeFormatUnit) =>
    new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(
      diff < 0 ? -value : value,
      unit,
    )
  if (abs < 1) return 'now'
  if (abs < 60) return say(abs, 'minute')
  if (abs < 60 * 24) return say(Math.round(abs / 60), 'hour')
  if (abs < 60 * 24 * 30) return say(Math.round(abs / (60 * 24)), 'day')
  return say(Math.round(abs / (60 * 24 * 30)), 'month')
}

/**
 * Human range for an event: collapses the end date when it is the same day.
 * "Mon 31 Aug · 09:00 – 10:30" / "31 Aug 09:00 → 1 Sep 02:00"
 */
export function formatEventRange(
  start: Date,
  end: Date,
  tz: string,
  use24h: boolean,
  allDay = false,
): string {
  const startKey = dayKeyOf(start, tz)
  const endKey = dayKeyOf(end, tz)
  if (allDay) {
    const lastKey = addDaysToKey(endKey, -1)
    return startKey === lastKey || startKey === endKey
      ? formatDayLabel(startKey, 'EEEE d MMMM')
      : `${formatDayLabel(startKey, 'd MMM')} – ${formatDayLabel(lastKey, 'd MMM')}`
  }
  const startTime = formatTime(start, tz, use24h)
  const endTime = formatTime(end, tz, use24h)
  if (startKey === endKey) {
    return `${formatDayLabel(startKey, 'EEEE d MMMM')} · ${startTime} – ${endTime}`
  }
  return `${formatDayLabel(startKey, 'd MMM')} ${startTime} → ${formatDayLabel(endKey, 'd MMM')} ${endTime}`
}

/** Offset label such as "GMT+2" for the time-zone gutter. */
export function timeZoneAbbreviation(tz: string, at = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'shortOffset',
    }).formatToParts(at)
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? tz
  } catch {
    return tz
  }
}

/** Short city label from an IANA name: "Europe/Amsterdam" -> "Amsterdam". */
export function timeZoneCity(tz: string): string {
  const tail = tz.split('/').pop() ?? tz
  return tail.replace(/_/g, ' ')
}

/** Rounds an instant to the nearest `step` minutes — snapping during drags. */
export function snapToMinutes(date: Date, step: number): Date {
  const ms = step * 60_000
  return new Date(Math.round(date.getTime() / ms) * ms)
}

export function nextQuarterHour(from = new Date()): Date {
  const snapped = snapToMinutes(from, 15)
  return snapped <= from ? addMinutes(snapped, 15) : snapped
}

export { addDays, addMinutes, differenceInMinutes, toZonedTime, formatInTimeZone }
