'use client'

import * as React from 'react'
import { pixelsToMinutes } from '@/lib/calendar-layout'
import { MINUTES_PER_DAY, addDaysToKey, minutesIntoDay, wallToUtc } from '@/lib/datetime'
import type { EventOccurrence } from '@/types/domain'

/**
 * Pointer handling for the time grid: create by dragging empty space, move an
 * event, and resize it from either edge.
 *
 * Two decisions carried over from the app this replaces, both learned the hard
 * way on a real phone:
 *
 *  - On a touch screen a drag only starts after a 280 ms press. Without that
 *    hold, any attempt to scroll the grid moves whatever event your thumb
 *    landed on, and the calendar becomes unusable.
 *  - Resize handles are only attached to blocks tall enough to hit. On a
 *    15-minute chip the handles would cover the whole block, so dragging to
 *    move it would resize it instead.
 *
 * Everything is pointer events, so mouse, touch and pen share one code path.
 */

const TOUCH_HOLD_MS = 280
/** Movement over this many pixels before the hold completes cancels the drag. */
const TOUCH_SLOP_PX = 10
/** A mouse drag only starts after this much movement, so clicks stay clicks. */
const MOUSE_SLOP_PX = 4
export const SNAP_MINUTES = 15
export const MIN_DURATION_MINUTES = 15

export interface GridGeometry {
  hourHeight: number
  dayKeys: string[]
  timezone: string
  /** Minutes from midnight where the rendered grid starts (usually 0). */
  originMinute: number
}

export type DragPreview =
  | { kind: 'none' }
  | {
      kind: 'create'
      dayIndex: number
      startMinute: number
      endMinute: number
    }
  | {
      kind: 'move'
      occurrenceId: string
      dayIndex: number
      startMinute: number
      endMinute: number
    }
  | {
      kind: 'resize'
      occurrenceId: string
      dayIndex: number
      startMinute: number
      endMinute: number
    }

export interface CommitCreate {
  dayKey: string
  start: Date
  end: Date
}

export interface CommitMove {
  event: EventOccurrence
  start: Date
  end: Date
  dayKey: string
}

interface Options extends GridGeometry {
  /** Column strip element; used to map clientX to a day index. */
  surfaceRef: React.RefObject<HTMLDivElement | null>
  onCreate: (draft: CommitCreate) => void
  onMove: (change: CommitMove) => void
  onSelect: (event: EventOccurrence) => void
  disabled?: boolean
}

export function useGridInteraction(options: Options) {
  const { surfaceRef, hourHeight, dayKeys, timezone, onCreate, onMove, onSelect } = options

  const [preview, setPreview] = React.useState<DragPreview>({ kind: 'none' })
  // Held in a ref as well: the pointer handlers run on every move and must not
  // depend on a re-render having landed.
  const session = React.useRef<Session | null>(null)

  const positionFromPointer = React.useCallback(
    (clientX: number, clientY: number) => {
      const surface = surfaceRef.current
      if (!surface) return null
      const rect = surface.getBoundingClientRect()
      const columnWidth = rect.width / Math.max(1, dayKeys.length)

      const dayIndex = clamp(
        Math.floor((clientX - rect.left) / columnWidth),
        0,
        dayKeys.length - 1,
      )
      const minute = clamp(
        pixelsToMinutes(clientY - rect.top, hourHeight, SNAP_MINUTES),
        0,
        MINUTES_PER_DAY,
      )
      return { dayIndex, minute }
    },
    [surfaceRef, dayKeys.length, hourHeight],
  )

  const finish = React.useCallback(() => {
    const active = session.current
    session.current = null
    setPreview({ kind: 'none' })
    if (!active) return

    if (active.moved && active.kind === 'create') {
      const dayKey = dayKeys[active.dayIndex]
      if (!dayKey) return
      const [from, until] = ordered(active.startMinute, active.currentMinute)
      onCreate({
        dayKey,
        start: minuteToInstant(dayKey, from, timezone),
        end: minuteToInstant(dayKey, Math.max(until, from + MIN_DURATION_MINUTES), timezone),
      })
      return
    }

    if (active.moved && (active.kind === 'move' || active.kind === 'resize')) {
      const dayKey = dayKeys[active.dayIndex]
      if (!dayKey || !active.event) return

      const { startMinute, endMinute } = resolveBounds(active)
      onMove({
        event: active.event,
        dayKey,
        start: minuteToInstant(dayKey, startMinute, timezone),
        end: minuteToInstant(dayKey, endMinute, timezone),
      })
      return
    }

    // No movement: this was a click, not a drag.
    if (!active.moved && active.event) onSelect(active.event)
  }, [dayKeys, timezone, onCreate, onMove, onSelect])

  /* --------------------------------------------------------- global moves */

  React.useEffect(() => {
    const handleMove = (nativeEvent: PointerEvent) => {
      const active = session.current
      if (!active) return

      const distance = Math.hypot(
        nativeEvent.clientX - active.originX,
        nativeEvent.clientY - active.originY,
      )

      if (!active.armed) {
        // Still waiting for the touch hold: a real scroll gesture cancels it.
        if (active.pointerType === 'touch') {
          if (distance > TOUCH_SLOP_PX) {
            clearTimeout(active.holdTimer)
            session.current = null
          }
          return
        }
        if (distance < MOUSE_SLOP_PX) return
        active.armed = true
      }

      const position = positionFromPointer(nativeEvent.clientX, nativeEvent.clientY)
      if (!position) return

      active.moved = true
      active.currentMinute = position.minute

      if (active.kind === 'create') {
        // Creating stays inside the column it started in — dragging diagonally
        // across days while sketching a block is never what someone meant.
        const [from, until] = ordered(active.startMinute, position.minute)
        setPreview({
          kind: 'create',
          dayIndex: active.dayIndex,
          startMinute: from,
          endMinute: Math.max(until, from + MIN_DURATION_MINUTES),
        })
        return
      }

      if (active.kind === 'move') {
        active.dayIndex = position.dayIndex
        const start = clamp(
          position.minute - active.grabOffsetMinutes,
          0,
          MINUTES_PER_DAY - active.durationMinutes,
        )
        active.startMinute = start
        setPreview({
          kind: 'move',
          occurrenceId: active.event!.occurrenceId,
          dayIndex: position.dayIndex,
          startMinute: start,
          endMinute: start + active.durationMinutes,
        })
        return
      }

      // resize
      if (active.edge === 'start') {
        active.startMinute = clamp(
          position.minute,
          0,
          active.endMinute - MIN_DURATION_MINUTES,
        )
      } else {
        active.endMinute = clamp(
          position.minute,
          active.startMinute + MIN_DURATION_MINUTES,
          MINUTES_PER_DAY,
        )
      }
      setPreview({
        kind: 'resize',
        occurrenceId: active.event!.occurrenceId,
        dayIndex: active.dayIndex,
        startMinute: active.startMinute,
        endMinute: active.endMinute,
      })
    }

    const handleUp = () => {
      const active = session.current
      if (active?.holdTimer) clearTimeout(active.holdTimer)
      finish()
    }

    const handleCancel = () => {
      const active = session.current
      if (active?.holdTimer) clearTimeout(active.holdTimer)
      session.current = null
      setPreview({ kind: 'none' })
    }

    const handleKey = (nativeEvent: KeyboardEvent) => {
      if (nativeEvent.key === 'Escape' && session.current) {
        handleCancel()
      }
    }

    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    window.addEventListener('pointercancel', handleCancel)
    window.addEventListener('keydown', handleKey)
    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      window.removeEventListener('pointercancel', handleCancel)
      window.removeEventListener('keydown', handleKey)
    }
  }, [positionFromPointer, finish])

  /* ------------------------------------------------------------- starters */

  const startCreate = React.useCallback(
    (nativeEvent: React.PointerEvent) => {
      if (options.disabled) return
      if (nativeEvent.button !== 0 && nativeEvent.pointerType === 'mouse') return
      const position = positionFromPointer(nativeEvent.clientX, nativeEvent.clientY)
      if (!position) return

      session.current = {
        kind: 'create',
        pointerType: nativeEvent.pointerType,
        originX: nativeEvent.clientX,
        originY: nativeEvent.clientY,
        dayIndex: position.dayIndex,
        startMinute: position.minute,
        endMinute: position.minute + SNAP_MINUTES,
        currentMinute: position.minute + SNAP_MINUTES,
        durationMinutes: SNAP_MINUTES,
        grabOffsetMinutes: 0,
        moved: false,
        armed: nativeEvent.pointerType !== 'touch',
        event: null,
        edge: null,
        holdTimer: undefined,
      }

      if (nativeEvent.pointerType === 'touch') {
        session.current.holdTimer = setTimeout(() => {
          if (session.current) session.current.armed = true
        }, TOUCH_HOLD_MS)
      }
    },
    [options.disabled, positionFromPointer],
  )

  const startMove = React.useCallback(
    (nativeEvent: React.PointerEvent, event: EventOccurrence, dayIndex: number) => {
      if (options.disabled || event.readOnly) return
      if (nativeEvent.button !== 0 && nativeEvent.pointerType === 'mouse') return
      const position = positionFromPointer(nativeEvent.clientX, nativeEvent.clientY)
      if (!position) return

      const startMinute = minutesIntoDay(new Date(event.start), timezone)
      const durationMinutes = Math.max(
        MIN_DURATION_MINUTES,
        Math.round(
          (Date.parse(event.end) - Date.parse(event.start)) / 60_000,
        ),
      )

      session.current = {
        kind: 'move',
        pointerType: nativeEvent.pointerType,
        originX: nativeEvent.clientX,
        originY: nativeEvent.clientY,
        dayIndex,
        startMinute,
        endMinute: startMinute + durationMinutes,
        currentMinute: position.minute,
        durationMinutes,
        // Keep the point under the finger fixed relative to the block.
        grabOffsetMinutes: position.minute - startMinute,
        moved: false,
        armed: nativeEvent.pointerType !== 'touch',
        event,
        edge: null,
        holdTimer: undefined,
      }

      if (nativeEvent.pointerType === 'touch') {
        session.current.holdTimer = setTimeout(() => {
          if (session.current) session.current.armed = true
        }, TOUCH_HOLD_MS)
      }
    },
    [options.disabled, positionFromPointer, timezone],
  )

  const startResize = React.useCallback(
    (
      nativeEvent: React.PointerEvent,
      event: EventOccurrence,
      dayIndex: number,
      edge: 'start' | 'end',
    ) => {
      if (options.disabled || event.readOnly) return
      nativeEvent.stopPropagation()
      const startMinute = minutesIntoDay(new Date(event.start), timezone)
      const endMinute = startMinute + Math.round(
        (Date.parse(event.end) - Date.parse(event.start)) / 60_000,
      )

      session.current = {
        kind: 'resize',
        pointerType: nativeEvent.pointerType,
        originX: nativeEvent.clientX,
        originY: nativeEvent.clientY,
        dayIndex,
        startMinute,
        endMinute,
        currentMinute: startMinute,
        durationMinutes: endMinute - startMinute,
        grabOffsetMinutes: 0,
        moved: false,
        // A handle is a deliberate target, so it arms immediately even on touch.
        armed: true,
        event,
        edge,
        holdTimer: undefined,
      }
    },
    [options.disabled, timezone],
  )

  return { preview, startCreate, startMove, startResize }
}

/* ---------------------------------------------------------------- types */

interface Session {
  kind: 'create' | 'move' | 'resize'
  pointerType: string
  originX: number
  originY: number
  dayIndex: number
  startMinute: number
  endMinute: number
  currentMinute: number
  durationMinutes: number
  grabOffsetMinutes: number
  moved: boolean
  armed: boolean
  event: EventOccurrence | null
  edge: 'start' | 'end' | null
  holdTimer: ReturnType<typeof setTimeout> | undefined
}

function resolveBounds(session: Session) {
  if (session.kind === 'move') {
    return {
      startMinute: session.startMinute,
      endMinute: session.startMinute + session.durationMinutes,
    }
  }
  return { startMinute: session.startMinute, endMinute: session.endMinute }
}

function ordered(a: number, b: number): [number, number] {
  return a <= b ? [a, b] : [b, a]
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

/**
 * Minutes-from-midnight back to a real instant.
 *
 * Goes through the wall clock deliberately: adding milliseconds to midnight
 * lands an hour out on the two days a year the clocks change.
 */
export function minuteToInstant(dayKey: string, minute: number, timezone: string): Date {
  const normalisedDay = minute >= MINUTES_PER_DAY ? addDaysToKey(dayKey, 1) : dayKey
  const within = minute % MINUTES_PER_DAY
  const hours = String(Math.floor(within / 60)).padStart(2, '0')
  const minutes = String(within % 60).padStart(2, '0')
  return wallToUtc(`${normalisedDay}T${hours}:${minutes}`, timezone)
}
