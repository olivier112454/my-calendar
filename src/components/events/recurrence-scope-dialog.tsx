'use client'

import * as React from 'react'
import { Dialog, DialogContent } from '@/components/ui/overlay'
import { Button } from '@/components/ui/button'
import type { RecurrenceScope } from '@/lib/validation/event'

/**
 * The three-way choice every calendar has to offer when a repeating event is
 * changed. Presented as three plain buttons rather than a radio group plus a
 * confirm: the choice *is* the action, so an extra confirmation step would only
 * add a click.
 */
export function RecurrenceScopeDialog({
  open,
  onOpenChange,
  action,
  onChoose,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  action: 'edit' | 'delete'
  onChoose: (scope: RecurrenceScope) => void
}) {
  const verb = action === 'delete' ? 'Delete' : 'Change'

  const options: { scope: RecurrenceScope; label: string; hint: string }[] = [
    {
      scope: 'this',
      label: 'This event',
      hint: 'Only this one occurrence. The rest of the series stays as it is.',
    },
    {
      scope: 'following',
      label: 'This and following events',
      hint: 'Everything from this occurrence onwards. Earlier ones keep their history.',
    },
    {
      scope: 'all',
      label: 'All events',
      hint: 'Every occurrence, past and future.',
    },
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`${verb} repeating event`}
        description="This event is part of a series."
        width="sm"
        footer={
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        }
      >
        <div className="space-y-1.5">
          {options.map((option) => (
            <button
              key={option.scope}
              type="button"
              onClick={() => onChoose(option.scope)}
              className="w-full rounded-lg border border-border px-3 py-2.5 text-left transition-colors hover:border-border-strong hover:bg-surface-2"
            >
              <span className="block text-[13px] font-medium text-fg">
                {option.label}
              </span>
              <span className="mt-0.5 block text-xs leading-relaxed text-fg-muted">
                {option.hint}
              </span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
