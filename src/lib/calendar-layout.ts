import type { EventOccurrence } from '@/types/domain'
import {
  MINUTES_PER_DAY,
  addDaysToKey,
  dayKeyOf,
  diffDayKeys,
  minutesIntoDay,
} from './datetime'

/**
 * Geometry for the time grid and the month grid.
 *
 * Pure functions over plain data: no DOM, no React, no dates beyond the ones
 * handed in. That makes the fiddly parts — overlap packing, all-day spans,
 * "+2 more" — straightforward to test, which matters because they are exactly
 * the parts that look almost right when they are wrong.
 */

export interface PositionedEvent {
  event: EventOccurrence
  /** Minutes from local midnight, clamped to this day. */
  startMinute: number
  endMinute: number
  /** 0–1 fractions of the column width. */
  left: number
  width: number
  /** Painting order; later events sit on top when they overlap. */
  zIndex: number
  /** True when the event runs past this day's boundaries. */
  continuesBefore: boolean
  continuesAfter: boolean
}

/** Nothing shorter than this is legible or clickable, so short events grow. */
export const MIN_EVENT_MINUTES = 15

/**
 * Splits a day's timed events into positioned boxes.
 *
 * Packing works in three passes:
 *  1. group into clusters of transitively overlapping events;
 *  2. inside a cluster, drop each event into the first free column;
 *  3. widen each event rightwards over columns nothing else occupies.
 *
 * Step 3 is what stops two meetings that merely touch from each rendering at
 * half width with a gap beside them.
 */
export function layoutDayEvents(
  events: EventOccurrence[],
  dayKey: string,
  timezone: string,
): PositionedEvent[] {
  const spans = events
    .filter((event) => !event.allDay)
    .map((event) => toDaySpan(event, dayKey, timezone))
    .filter((span): span is DaySpan => span !== null)
    .sort(
      (a, b) =>
        a.startMinute - b.startMinute ||
        b.endMinute - a.endMinute ||
        a.event.title.localeCompare(b.event.title),
    )

  const out: PositionedEvent[] = []

  for (const cluster of clusterSpans(spans)) {
    const columns: DaySpan[][] = []

    for (const span of cluster) {
      let placed = false
      for (const column of columns) {
        const last = column[column.length - 1]!
        if (last.paintEnd <= span.startMinute) {
          column.push(span)
          span.column = columns.indexOf(column)
          placed = true
          break
        }
      }
      if (!placed) {
        span.column = columns.length
        columns.push([span])
      }
    }

    const columnCount = Math.max(1, columns.length)

    for (const span of cluster) {
      // Widen over any column to the right that is free for this span's extent.
      let reach = span.column + 1
      while (reach < columnCount && columnFree(columns[reach]!, span)) reach++

      const unitWidth = 1 / columnCount
      out.push({
        event: span.event,
        startMinute: span.startMinute,
        endMinute: span.endMinute,
        left: span.column * unitWidth,
        width: (reach - span.column) * unitWidth,
        // Later-starting and narrower events paint above their neighbours, so a
        // short meeting inside a long block stays reachable.
        zIndex: 10 + span.column,
        continuesBefore: span.continuesBefore,
        continuesAfter: span.continuesAfter,
      })
    }
  }

  return out
}

interface DaySpan {
  event: EventOccurrence
  startMinute: number
  endMinute: number
  /** endMinute lifted to the minimum height, used for collision tests. */
  paintEnd: number
  continuesBefore: boolean
  continuesAfter: boolean
  column: number
}

function toDaySpan(
  event: EventOccurrence,
  dayKey: string,
  timezone: string,
): DaySpan | null {
  const start = new Date(event.start)
  const end = new Date(event.end)

  const startKey = dayKeyOf(start, timezone)
  const endKeyRaw = dayKeyOf(new Date(end.getTime() - 1), timezone)

  if (dayKey < startKey || dayKey > endKeyRaw) return null

  const startMinute = dayKey === startKey ? minutesIntoDay(start, timezone) : 0
  const endMinute =
    dayKey === endKeyRaw ? Math.max(minutesIntoDay(end, timezone), startMinute + 1) : MINUTES_PER_DAY

  return {
    event,
    startMinute,
    endMinute,
    paintEnd: Math.max(endMinute, startMinute + MIN_EVENT_MINUTES),
    continuesBefore: dayKey > startKey,
    continuesAfter: dayKey < endKeyRaw,
    column: 0,
  }
}

function clusterSpans(spans: DaySpan[]): DaySpan[][] {
  const clusters: DaySpan[][] = []
  let current: DaySpan[] = []
  let clusterEnd = -1

  for (const span of spans) {
    if (current.length > 0 && span.startMinute >= clusterEnd) {
      clusters.push(current)
      current = []
      clusterEnd = -1
    }
    current.push(span)
    clusterEnd = Math.max(clusterEnd, span.paintEnd)
  }
  if (current.length > 0) clusters.push(current)
  return clusters
}

function columnFree(column: DaySpan[], span: DaySpan): boolean {
  return column.every(
    (other) => other.paintEnd <= span.startMinute || other.startMinute >= span.paintEnd,
  )
}

/* ------------------------------------------------------------- all-day row */

export interface AllDayBar {
  event: EventOccurrence
  /** Index of the first visible column this bar covers. */
  startIndex: number
  /** Number of columns it spans. */
  span: number
  /** Stacking row inside the all-day area. */
  lane: number
  continuesBefore: boolean
  continuesAfter: boolean
}

/**
 * Lays out all-day and multi-day events as horizontal bars across the visible
 * days, packing them into as few lanes as possible so the header stays shallow.
 */
export function layoutAllDayEvents(
  events: EventOccurrence[],
  dayKeys: string[],
  timezone: string,
): { bars: AllDayBar[]; laneCount: number } {
  if (dayKeys.length === 0) return { bars: [], laneCount: 0 }

  const first = dayKeys[0]!
  const last = dayKeys[dayKeys.length - 1]!

  const candidates = events
    .filter((event) => event.allDay || spansWholeDay(event, timezone))
    .map((event) => {
      const startKey = dayKeyOf(new Date(event.start), timezone)
      const endKey = dayKeyOf(new Date(new Date(event.end).getTime() - 1), timezone)
      return { event, startKey, endKey }
    })
    .filter(({ startKey, endKey }) => endKey >= first && startKey <= last)
    .sort(
      (a, b) =>
        a.startKey.localeCompare(b.startKey) ||
        diffDayKeys(b.endKey, b.startKey) - diffDayKeys(a.endKey, a.startKey) ||
        a.event.title.localeCompare(b.event.title),
    )

  const lanes: number[][] = []
  const bars: AllDayBar[] = []

  for (const { event, startKey, endKey } of candidates) {
    const startIndex = Math.max(0, diffDayKeys(startKey, first))
    const endIndex = Math.min(dayKeys.length - 1, diffDayKeys(endKey, first))
    const span = Math.max(1, endIndex - startIndex + 1)

    let lane = lanes.findIndex((occupied) =>
      occupied.every((index) => index < startIndex || index > endIndex),
    )
    if (lane === -1) {
      lane = lanes.length
      lanes.push([])
    }
    for (let i = startIndex; i <= endIndex; i++) lanes[lane]!.push(i)

    bars.push({
      event,
      startIndex,
      span,
      lane,
      continuesBefore: startKey < first,
      continuesAfter: endKey > last,
    })
  }

  return { bars, laneCount: lanes.length }
}

/** A timed event covering a full local day belongs in the all-day row too. */
function spansWholeDay(event: EventOccurrence, timezone: string): boolean {
  const start = new Date(event.start)
  const end = new Date(event.end)
  if (end.getTime() - start.getTime() < 20 * 60 * 60 * 1000) return false
  return minutesIntoDay(start, timezone) === 0
}

/* ---------------------------------------------------------------- month */

export interface MonthCellEvents {
  visible: EventOccurrence[]
  hiddenCount: number
}

/**
 * Chooses which chips fit in a month cell. All-day and multi-day events sort
 * first so a holiday never gets pushed under a 15-minute call.
 */
export function limitMonthCell(
  events: EventOccurrence[],
  capacity: number,
): MonthCellEvents {
  if (events.length <= capacity) return { visible: events, hiddenCount: 0 }
  // Keep one slot for the "+N more" affordance itself.
  const keep = Math.max(0, capacity - 1)
  return { visible: events.slice(0, keep), hiddenCount: events.length - keep }
}

/**
 * Buckets occurrences by the day key they should appear under.
 *
 * Generic over the four fields it reads, so a screen carrying a thinner slice
 * than a full `EventOccurrence` — the Schedule page's commitments, say — gets
 * the same multi-day spanning and ordering instead of a second implementation.
 */
export function bucketByDay<
  T extends { start: string; end: string; allDay: boolean; title: string },
>(events: T[], dayKeys: string[], timezone: string): Map<string, T[]> {
  const buckets = new Map<string, T[]>()
  for (const key of dayKeys) buckets.set(key, [])

  for (const event of events) {
    const startKey = dayKeyOf(new Date(event.start), timezone)
    const endKey = dayKeyOf(new Date(new Date(event.end).getTime() - 1), timezone)

    let cursor = startKey
    // Multi-day events appear in every day they touch.
    for (let guard = 0; guard < 400 && cursor <= endKey; guard++) {
      const bucket = buckets.get(cursor)
      if (bucket) bucket.push(event)
      cursor = addDaysToKey(cursor, 1)
    }
  }

  for (const bucket of buckets.values()) {
    bucket.sort(
      (a, b) =>
        Number(b.allDay) - Number(a.allDay) ||
        Date.parse(a.start) - Date.parse(b.start) ||
        a.title.localeCompare(b.title),
    )
  }
  return buckets
}

/* ------------------------------------------------------- pixel conversion */

/** Minutes -> pixels, given the height of one hour. */
export function minutesToPixels(minutes: number, hourHeight: number): number {
  return (minutes / 60) * hourHeight
}

/** Pixels -> minutes, snapped to a step (15 minutes while dragging). */
export function pixelsToMinutes(
  pixels: number,
  hourHeight: number,
  snapMinutes = 15,
): number {
  const raw = (pixels / hourHeight) * 60
  return Math.round(raw / snapMinutes) * snapMinutes
}
