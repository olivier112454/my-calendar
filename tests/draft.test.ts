import { describe, expect, it } from 'vitest'
import { applyDraft, type DraftMove } from '@/components/calendar/draft-context'
import { makeEvent } from './helpers'

/**
 * The what-if layer over the week.
 *
 * The property that matters most is that it never touches the real week: the
 * whole point of a draft is that discarding it costs nothing, and that only
 * holds while the underlying occurrences are left alone. If this transform ever
 * mutates its input, "throw it away" quietly stops working.
 */

const monday = makeEvent({
  occurrenceId: 'occ-1',
  eventId: 'evt-1',
  title: 'Design review',
  start: '2026-09-02T10:00',
  end: '2026-09-02T11:00',
})

const other = makeEvent({
  occurrenceId: 'occ-2',
  eventId: 'evt-2',
  title: 'Standup',
  start: '2026-09-02T09:00',
  end: '2026-09-02T09:15',
})

const moveOf = (overrides: Partial<DraftMove> = {}): DraftMove => ({
  occurrenceId: 'occ-1',
  eventId: 'evt-1',
  title: 'Design review',
  originalStart: monday.start,
  originalEnd: monday.end,
  start: new Date(Date.parse(monday.start) + 3 * 3_600_000).toISOString(),
  end: new Date(Date.parse(monday.end) + 3 * 3_600_000).toISOString(),
  occurrenceStart: null,
  isRecurring: false,
  ...overrides,
})

describe('draft layer', () => {
  it('hands back the same array when there is nothing to apply', () => {
    const events = [monday, other]
    expect(applyDraft(events, [])).toBe(events)
  })

  it('never mutates the real week', () => {
    const events = [monday, other]
    const snapshot = JSON.stringify(events)
    applyDraft(events, [moveOf()])
    expect(JSON.stringify(events)).toBe(snapshot)
  })

  it('moves the event and leaves a shadow where it was', () => {
    const move = moveOf()
    const result = applyDraft([monday, other], [move])

    const moved = result.find((event) => event.occurrenceId === 'occ-1')
    expect(moved?.start).toBe(move.start)
    expect(moved?.draftMoved).toBe(true)

    const ghost = result.find((event) => event.occurrenceId === 'occ-1:ghost')
    expect(ghost?.start).toBe(monday.start)
    expect(ghost?.draftGhost).toBe(true)
    // A shadow is scenery: it cannot be dragged, resized or saved.
    expect(ghost?.readOnly).toBe(true)
  })

  it('leaves events with no draft entry exactly as they were', () => {
    const result = applyDraft([monday, other], [moveOf()])
    const untouched = result.find((event) => event.occurrenceId === 'occ-2')
    expect(untouched).toEqual(other)
  })

  it('gives the shadow its own identity, so the layout keeps them apart', () => {
    const result = applyDraft([monday], [moveOf()])
    const ids = result.map((event) => event.occurrenceId)
    expect(new Set(ids).size).toBe(ids.length)
    expect(result).toHaveLength(2)
  })

  it('ignores a draft entry for an event no longer on screen', () => {
    // Paged to another week, or the event was deleted elsewhere.
    const result = applyDraft([other], [moveOf()])
    expect(result.some((event) => event.draftGhost)).toBe(false)
    expect(result).toHaveLength(1)
  })

  it('carries the event\'s own details into its new position', () => {
    const result = applyDraft([monday], [moveOf()])
    const moved = result.find((event) => event.occurrenceId === 'occ-1')
    expect(moved?.title).toBe('Design review')
    expect(moved?.calendarId).toBe(monday.calendarId)
  })
})
