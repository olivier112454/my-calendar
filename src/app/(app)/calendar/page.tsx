import type { Metadata } from 'next'
import { ensureSettings, requireUserPage } from '@/lib/auth'
import { listCalendars } from '@/server/services/calendars'
import { CalendarProvider } from '@/components/calendar/calendar-context'
import { CalendarSurface } from '@/components/calendar/calendar-surface'
import type { CalendarViewMode } from '@/types/domain'

export const metadata: Metadata = { title: 'Calendar' }

/**
 * The calendar page is deliberately thin: it resolves preferences on the server
 * and hands them to the client surface, which owns the interactive grid. The
 * view and date live in the URL, so this component never needs to know them.
 */
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>
}) {
  const user = await requireUserPage('/calendar')
  const [settings, calendars] = await Promise.all([
    ensureSettings(user.id),
    listCalendars(user.id),
  ])

  const params = await searchParams

  return (
    <CalendarProvider
      prefs={{
        timezone: user.timezone,
        secondaryTimezones: settings.secondaryTimezones,
        weekStartsOn: settings.weekStartsOn,
        use24h: settings.timeFormat24h,
        showWeekends: settings.showWeekends,
        showWeekNumbers: settings.showWeekNumbers,
        showDeclinedEvents: settings.showDeclinedEvents,
        dayStartHour: settings.dayStartHour,
        dayEndHour: settings.dayEndHour,
        compact: settings.eventDensity === 'COMPACT',
        defaultCalendarId: settings.defaultCalendarId,
        defaultDuration: settings.defaultDuration,
        defaultReminders: settings.defaultReminders,
      }}
      calendars={calendars}
      defaultView={(params.view as CalendarViewMode) ?? 'week'}
    >
      <CalendarSurface />
    </CalendarProvider>
  )
}
