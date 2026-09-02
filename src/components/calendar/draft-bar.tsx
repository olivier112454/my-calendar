'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { Check, RotateCcw, Trash2, Undo2 } from 'lucide-react'
import { api } from '@/lib/client/api'
import { formatDayLabel, formatTime } from '@/lib/datetime'
import { Button } from '@/components/ui/button'
import { useDraft } from './draft-context'

/**
 * The bar that turns a rearranged week back into a real one.
 *
 * It stays visible for the whole of draft mode, including when nothing has been
 * moved yet, because the one thing worse than a draft you cannot commit is a
 * draft you did not realise you were in. Nothing on screen is saved while this
 * is showing, and the bar says so in as many words.
 */
export function DraftBar({
  timezone,
  use24h,
  onApplied,
}: {
  timezone: string
  use24h: boolean
  onApplied: () => void
}) {
  const { active, moves, setActive, revert, discard } = useDraft()
  const [applying, setApplying] = React.useState(false)

  if (!active) return null

  const apply = async () => {
    setApplying(true)
    // Sequential rather than parallel: each move is checked against the others
    // server-side, and a burst of simultaneous writes to overlapping times is
    // exactly where that goes wrong.
    const failed: string[] = []
    for (const move of moves) {
      try {
        await api.patch(`/api/events/${move.eventId}/move`, {
          start: move.start,
          end: move.end,
          occurrenceStart: move.occurrenceStart ?? undefined,
          scope: move.isRecurring ? 'this' : 'all',
        })
      } catch {
        failed.push(move.title)
      }
    }
    setApplying(false)

    if (failed.length === 0) {
      toast.success(
        moves.length === 1 ? 'Change applied' : `${moves.length} changes applied`,
      )
      setActive(false)
    } else {
      // Partial success is the honest outcome to report: the rest did land, and
      // saying "failed" would send someone looking for changes that are there.
      toast.error(
        `${failed.length} of ${moves.length} could not be moved: ${failed.join(', ')}.`,
      )
    }
    onApplied()
  }

  return (
    <div className="shrink-0 border-t border-border bg-surface-2 px-4 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="flex items-center gap-1.5 text-[13px] font-medium text-fg">
          <span className="inline-block size-2 rounded-full bg-accent" aria-hidden="true" />
          Draft week
        </span>

        <span className="text-xs text-fg-muted">
          {moves.length === 0
            ? 'Drag anything about. Nothing is saved until you apply.'
            : `${moves.length} change${moves.length === 1 ? '' : 's'}, not saved`}
        </span>

        {moves.length > 0 ? (
          <ul className="flex min-w-0 flex-wrap items-center gap-1.5">
            {moves.slice(0, 3).map((move) => (
              <li key={move.occurrenceId}>
                <button
                  type="button"
                  onClick={() => revert(move.occurrenceId)}
                  title={`Put "${move.title}" back`}
                  className="inline-flex max-w-[16rem] items-center gap-1 rounded border border-border bg-surface px-1.5 py-px text-[11px] text-fg-muted transition-colors hover:text-fg"
                >
                  <Undo2 className="size-3 shrink-0" aria-hidden="true" />
                  <span className="truncate">
                    {move.title} → {formatDayLabel(move.start.slice(0, 10), 'EEE')}{' '}
                    {formatTime(new Date(move.start), timezone, use24h)}
                  </span>
                </button>
              </li>
            ))}
            {moves.length > 3 ? (
              <li className="text-[11px] text-fg-subtle">
                and {moves.length - 3} more
              </li>
            ) : null}
          </ul>
        ) : null}

        <div className="ml-auto flex items-center gap-1.5">
          {moves.length > 0 ? (
            <Button variant="ghost" size="sm" onClick={discard} disabled={applying}>
              <RotateCcw />
              Reset
            </Button>
          ) : null}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setActive(false)}
            disabled={applying}
          >
            <Trash2 />
            Discard
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void apply()}
            loading={applying}
            disabled={moves.length === 0}
          >
            <Check />
            Apply {moves.length > 0 ? moves.length : ''}
          </Button>
        </div>
      </div>
    </div>
  )
}
