'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { EventComposer } from '@/components/events/event-composer'
import { CommandPalette } from '@/components/command/command-palette'
import { useGlobalShortcuts } from '@/hooks/use-global-shortcuts'
import { useAppShell } from './app-shell-context'

/**
 * Application-wide surfaces that must exist on every page: the composer, the
 * command palette, and the keyboard shortcuts that open them.
 *
 * Mounted once by the layout rather than by each page, so "press C to create"
 * works from Tasks and Settings exactly as it does from the calendar.
 */
export function AppChrome({
  defaultCalendarId,
  defaultReminders,
}: {
  defaultCalendarId: string | null
  defaultReminders: number[]
}) {
  const router = useRouter()
  const {
    calendars,
    categories,
    timezone,
    use24h,
    createRequest,
    clearCreateRequest,
    commandOpen,
    setCommandOpen,
  } = useAppShell()

  useGlobalShortcuts()

  return (
    <>
      <EventComposer
        open={createRequest !== null}
        onOpenChange={(open) => {
          if (!open) clearCreateRequest()
        }}
        calendars={calendars}
        categories={categories}
        timezone={timezone}
        use24h={use24h}
        defaultCalendarId={defaultCalendarId}
        defaultReminders={defaultReminders}
        seed={
          createRequest
            ? {
                start: createRequest.start,
                end: createRequest.end,
                allDay: createRequest.allDay,
              }
            : undefined
        }
        onSaved={() => router.refresh()}
      />

      <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} />
    </>
  )
}
