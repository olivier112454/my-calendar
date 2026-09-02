'use client'

import * as React from 'react'
import { Check, Timer, X } from 'lucide-react'
import { api } from '@/lib/client/api'
import { formatDuration } from '@/lib/datetime'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { TaskSummary } from '@/types/domain'

/**
 * "How long did that actually take?", asked once, at the only moment anyone
 * knows the answer.
 *
 * This is the small piece of friction the whole calibration rests on, so it is
 * built to be answered with one tap and ignored with none: the options bracket
 * the estimate, nothing is required, and the strip disappears either way. A
 * dialog here would be answered honestly twice and then dismissed for ever.
 *
 * It is deliberately only offered for tasks that carried an estimate. Without
 * one there is nothing to compare against, so the question would be work for
 * the user and no information for the app.
 */

/** Multiples of the estimate offered as one-tap answers. */
const FACTORS = [0.5, 1, 1.5, 2]

function optionsFor(estimate: number): number[] {
  const values = FACTORS.map((factor) =>
    Math.max(5, Math.round((estimate * factor) / 5) * 5),
  )
  // A short estimate collapses several factors onto the same number.
  return [...new Set(values)].sort((a, b) => a - b)
}

export function ActualTimePrompt({
  task,
  onDone,
}: {
  task: TaskSummary
  onDone: () => void
}) {
  const [custom, setCustom] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const estimate = task.estimatedMinutes ?? 0

  const save = async (minutes: number) => {
    if (saving) return
    setSaving(true)
    try {
      await api.patch(`/api/tasks/${task.id}`, { actualMinutes: minutes })
    } catch {
      // Losing one data point is not worth interrupting someone who has just
      // finished something; the estimate simply goes unlearned.
    } finally {
      onDone()
    }
  }

  const customMinutes = Number(custom)
  const customValid =
    custom.trim() !== '' &&
    Number.isFinite(customMinutes) &&
    customMinutes >= 1 &&
    customMinutes <= 1440

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2">
      <Timer className="size-4 shrink-0 text-fg-subtle" aria-hidden="true" />
      <p className="text-[13px] text-fg">
        <span className="font-medium">{task.title}</span>
        <span className="text-fg-muted">
          {' '}
          — you said {formatDuration(estimate)}. How long did it take?
        </span>
      </p>

      <div className="ml-auto flex flex-wrap items-center gap-1.5">
        {optionsFor(estimate).map((minutes) => (
          <Button
            key={minutes}
            variant={minutes === estimate ? 'subtle' : 'secondary'}
            size="sm"
            disabled={saving}
            onClick={() => void save(minutes)}
          >
            {formatDuration(minutes)}
          </Button>
        ))}

        <form
          className="flex items-center gap-1"
          onSubmit={(nativeEvent) => {
            nativeEvent.preventDefault()
            if (customValid) void save(customMinutes)
          }}
        >
          <Input
            value={custom}
            onChange={(nativeEvent) => setCustom(nativeEvent.target.value)}
            inputMode="numeric"
            placeholder="min"
            aria-label={`Minutes spent on ${task.title}`}
            className="h-7 w-16 text-xs"
          />
          <Button
            type="submit"
            variant="ghost"
            size="iconSm"
            disabled={!customValid || saving}
            aria-label="Save the time spent"
          >
            <Check />
          </Button>
        </form>

        <Button
          variant="ghost"
          size="iconSm"
          onClick={onDone}
          disabled={saving}
          aria-label="Skip the question"
        >
          <X />
        </Button>
      </div>
    </div>
  )
}
