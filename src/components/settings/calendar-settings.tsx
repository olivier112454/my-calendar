'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Download, Plus, Star, Trash2, Upload } from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/lib/client/api'
import { calendarPalette } from '@/config/app'
import type { CalendarSummary } from '@/types/domain'
import { Button } from '@/components/ui/button'
import { Badge, ColorDot } from '@/components/ui/primitives'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/controls'
import { ConfirmDialog } from '@/components/ui/overlay'
import { CalendarCreateDialog } from '@/components/layout/calendar-create-dialog'
import { SettingsSection } from './settings-nav'

/**
 * Calendar management: colours, the default, deletion, and .ics import/export.
 *
 * Calendars that came from a connected account are shown with their source and
 * cannot be renamed here — that would drift from the provider on the next sync,
 * so the rename belongs where the calendar lives.
 */
export function CalendarSettings({
  calendars,
}: {
  calendars: CalendarSummary[]
}) {
  const router = useRouter()
  const [createOpen, setCreateOpen] = React.useState(false)
  const [pendingDelete, setPendingDelete] = React.useState<CalendarSummary | null>(null)
  const [importTarget, setImportTarget] = React.useState(
    () => calendars.find((calendar) => calendar.isDefault)?.id ?? calendars[0]?.id ?? '',
  )
  const [importing, setImporting] = React.useState(false)
  const fileRef = React.useRef<HTMLInputElement>(null)

  const patch = async (calendarId: string, changes: Record<string, unknown>) => {
    try {
      await api.patch(`/api/calendars/${calendarId}`, changes)
      router.refresh()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'That change was not saved.')
    }
  }

  const remove = async (calendar: CalendarSummary) => {
    try {
      await api.delete(`/api/calendars/${calendar.id}`)
      toast.success(`"${calendar.name}" deleted`)
      router.refresh()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Could not delete.')
    }
  }

  const runImport = async (file: File) => {
    if (!importTarget) {
      toast.error('Pick a calendar to import into first.')
      return
    }
    setImporting(true)
    try {
      const body = new FormData()
      body.set('file', file)
      body.set('calendarId', importTarget)

      const response = await fetch('/api/calendars/import', {
        method: 'POST',
        body,
        credentials: 'same-origin',
      })
      const payload = (await response.json()) as
        | { data: { created: number; updated: number } }
        | { error: { message: string } }

      if ('error' in payload) throw new Error(payload.error.message)

      toast.success(
        `Imported ${payload.data.created} new event${payload.data.created === 1 ? '' : 's'}` +
          (payload.data.updated > 0 ? `, updated ${payload.data.updated}` : ''),
      )
      router.refresh()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'That file could not be imported.')
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const writable = calendars.filter((calendar) => !calendar.isReadOnly)

  return (
    <>
      <SettingsSection
        title="Calendars"
        description="Colours, the default for new events, and what to keep."
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setCreateOpen(true)}
            aria-label="New calendar"
          >
            <Plus />
            New
          </Button>
        }
      >
        <ul className="divide-y divide-border">
          {calendars.map((calendar) => (
            <li
              key={calendar.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3"
            >
              <ColorDot color={calendar.color} size={12} />

              <div className="min-w-[7rem] flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-medium text-fg">{calendar.name}</span>
                  {calendar.isDefault ? <Badge tone="accent">Default</Badge> : null}
                  {calendar.isReadOnly ? <Badge tone="neutral">Read-only</Badge> : null}
                </div>
                {calendar.accountEmail ? (
                  <p className="text-xs text-fg-subtle">From {calendar.accountEmail}</p>
                ) : null}
              </div>

              <div className="flex w-full items-center justify-between gap-1 sm:w-auto sm:justify-start">
                <div className="flex flex-wrap items-center gap-1">
                  {calendarPalette.slice(0, 7).map((entry) => (
                    <button
                      key={entry.value}
                      type="button"
                      aria-label={`${calendar.name}: ${entry.name}`}
                      title={entry.name}
                      onClick={() => patch(calendar.id, { color: entry.value })}
                      className={cn(
                        'size-4 rounded-full border-2 transition-transform hover:scale-110',
                        calendar.color === entry.value
                          ? 'border-fg'
                          : 'border-transparent',
                      )}
                      style={{ backgroundColor: entry.value }}
                    />
                  ))}
                </div>

                {!calendar.isDefault && !calendar.isReadOnly ? (
                  <Button
                    variant="ghost"
                    size="iconSm"
                    onClick={() => patch(calendar.id, { isDefault: true })}
                    aria-label={`Make ${calendar.name} the default`}
                    title="Make default"
                  >
                    <Star />
                  </Button>
                ) : null}

                <Button variant="ghost" size="iconSm" asChild aria-label={`Export ${calendar.name}`}>
                  <a href={`/api/calendars/${calendar.id}/export`} title="Export as .ics">
                    <Download />
                  </a>
                </Button>

                {!calendar.isDefault && !calendar.provider ? (
                  <Button
                    variant="dangerGhost"
                    size="iconSm"
                    onClick={() => setPendingDelete(calendar)}
                    aria-label={`Delete ${calendar.name}`}
                  >
                    <Trash2 />
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </SettingsSection>

      <SettingsSection
        title="Import"
        description="Bring in an .ics file from another calendar. Events are matched on their identifier, so importing the same file twice updates rather than duplicates."
      >
        <div className="flex flex-wrap items-end gap-2 py-3">
          <label className="space-y-1">
            <span className="block text-xs font-medium text-fg-muted">Import into</span>
            <Select value={importTarget} onValueChange={setImportTarget}>
              <SelectTrigger className="w-52" aria-label="Import into calendar">
                <SelectValue placeholder="Pick a calendar" />
              </SelectTrigger>
              <SelectContent>
                {writable.map((calendar) => (
                  <SelectItem key={calendar.id} value={calendar.id}>
                    <span className="flex items-center gap-2">
                      <ColorDot color={calendar.color} />
                      {calendar.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <input
            ref={fileRef}
            type="file"
            accept=".ics,text/calendar"
            className="sr-only"
            onChange={(nativeEvent) => {
              const file = nativeEvent.target.files?.[0]
              if (file) void runImport(file)
            }}
          />
          <Button
            variant="secondary"
            loading={importing}
            onClick={() => fileRef.current?.click()}
            disabled={writable.length === 0}
          >
            <Upload />
            Choose .ics file
          </Button>
        </div>
      </SettingsSection>

      <CalendarCreateDialog open={createOpen} onOpenChange={setCreateOpen} />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title={`Delete "${pendingDelete?.name}"?`}
        description="Its events are deleted with it. This cannot be undone."
        confirmLabel="Delete calendar"
        onConfirm={async () => {
          if (pendingDelete) await remove(pendingDelete)
        }}
      />
    </>
  )
}
