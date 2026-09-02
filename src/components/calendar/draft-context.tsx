'use client'

import * as React from 'react'
import type { EventOccurrence } from '@/types/domain'

/**
 * The what-if week.
 *
 * Every calendar makes you edit to find out. You want to know whether four
 * tasks still fit this week, so you drag things about, discover they do not,
 * drag two meetings aside, discover the focus block is gone, drag back — and
 * your guests have watched all five intermediate versions arrive in their inbox.
 * There is no way to ask "what would my week look like if…" without also
 * changing it.
 *
 * Draft mode is that way. While it is on, dragging rearranges a layer that sits
 * over the real week: the grid, the conflict checks and the cost notice all
 * work against it, nothing reaches the database, nobody is notified, and one
 * button either commits the lot or throws it away.
 *
 * It is deliberately a *view transform* rather than a set of pending mutations.
 * The real occurrences are never touched, which buys three things for free:
 * discarding is nothing more than emptying a map, the original position is
 * always available to draw as a shadow, and a bug in here can misdraw the week
 * but can never corrupt it.
 *
 * State lives in memory only. A draft is a train of thought, and one that
 * outlived a browser restart would be a set of changes nobody remembers making.
 */

export interface DraftMove {
  occurrenceId: string
  eventId: string
  title: string
  /** Where it sits in the real week, kept for the shadow and for undo. */
  originalStart: string
  originalEnd: string
  start: string
  end: string
  occurrenceStart: string | null
  isRecurring: boolean
}

/** An occurrence carrying the client-only marks the draft layer needs. */
export type DraftOccurrence = EventOccurrence & {
  /** The greyed-out original, drawn where the event used to be. */
  draftGhost?: boolean
  /** The event in its proposed position. */
  draftMoved?: boolean
}

interface DraftContextValue {
  active: boolean
  moves: DraftMove[]
  /** Enters draft mode, or leaves it and throws away any changes. */
  setActive: (active: boolean) => void
  /** Records a move. Called instead of saving while draft mode is on. */
  record: (move: DraftMove) => void
  /** Puts one event back where it was. */
  revert: (occurrenceId: string) => void
  discard: () => void
}

const DraftContext = React.createContext<DraftContextValue | null>(null)

export function DraftProvider({ children }: { children: React.ReactNode }) {
  const [active, setActiveState] = React.useState(false)
  const [byOccurrence, setByOccurrence] = React.useState<Record<string, DraftMove>>({})

  const discard = React.useCallback(() => setByOccurrence({}), [])

  const setActive = React.useCallback((next: boolean) => {
    setActiveState(next)
    // Leaving always abandons: a draft that survived being switched off would
    // reappear later as changes nobody remembers proposing.
    if (!next) setByOccurrence({})
  }, [])

  const record = React.useCallback((move: DraftMove) => {
    setByOccurrence((current) => {
      const existing = current[move.occurrenceId]
      return {
        ...current,
        [move.occurrenceId]: {
          ...move,
          // Dragging the same event twice keeps its true starting point, so the
          // shadow stays where the week really has it.
          originalStart: existing?.originalStart ?? move.originalStart,
          originalEnd: existing?.originalEnd ?? move.originalEnd,
        },
      }
    })
  }, [])

  const revert = React.useCallback((occurrenceId: string) => {
    setByOccurrence((current) => {
      const next = { ...current }
      delete next[occurrenceId]
      return next
    })
  }, [])

  // A move back to where it started is not a change; dropping it keeps the
  // count honest and lets the bar disappear when the week is itself again.
  const moves = React.useMemo(
    () =>
      Object.values(byOccurrence).filter(
        (move) => move.start !== move.originalStart || move.end !== move.originalEnd,
      ),
    [byOccurrence],
  )

  const value = React.useMemo<DraftContextValue>(
    () => ({ active, moves, setActive, record, revert, discard }),
    [active, moves, setActive, record, revert, discard],
  )

  return <DraftContext.Provider value={value}>{children}</DraftContext.Provider>
}

export function useDraft(): DraftContextValue {
  const value = React.useContext(DraftContext)
  if (!value) throw new Error('useDraft must be used inside a DraftProvider')
  return value
}

/**
 * The week as the draft proposes it: moved events in their new places, plus a
 * shadow of each one where it really is.
 *
 * Returns the input untouched when there is nothing to apply, so the ordinary
 * case costs one comparison rather than a rebuilt array.
 */
export function applyDraft(
  events: EventOccurrence[],
  moves: DraftMove[],
): DraftOccurrence[] {
  if (moves.length === 0) return events

  const byOccurrence = new Map(moves.map((move) => [move.occurrenceId, move]))

  const moved: DraftOccurrence[] = events.map((event) => {
    const move = byOccurrence.get(event.occurrenceId)
    if (!move) return event
    return { ...event, start: move.start, end: move.end, draftMoved: true }
  })

  const ghosts: DraftOccurrence[] = moves.flatMap((move) => {
    const original = events.find((event) => event.occurrenceId === move.occurrenceId)
    if (!original) return []
    return [
      {
        ...original,
        // A distinct id keeps React keys and the layout algorithm from treating
        // the shadow and the event it belongs to as the same block.
        occurrenceId: `${original.occurrenceId}:ghost`,
        start: move.originalStart,
        end: move.originalEnd,
        // Nothing about a shadow should be draggable, selectable or savable.
        readOnly: true,
        draftGhost: true,
      },
    ]
  })

  return [...ghosts, ...moved]
}
