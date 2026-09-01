import type { Metadata } from 'next'
import { ensureSettings, requireUserPage } from '@/lib/auth'
import { listCalendars } from '@/server/services/calendars'
import { getWorkingHours } from '@/server/services/settings'
import { GeneralSettings } from '@/components/settings/general-settings'

export const metadata: Metadata = { title: 'General settings' }

export default async function GeneralSettingsPage() {
  const user = await requireUserPage('/settings/general')
  const [settings, calendars, workingHours] = await Promise.all([
    ensureSettings(user.id),
    listCalendars(user.id),
    getWorkingHours(user.id),
  ])

  return (
    <GeneralSettings
      settings={settings}
      calendars={calendars}
      profile={{ name: user.name, timezone: user.timezone }}
      workingHours={workingHours.map((row) => ({
        weekday: row.weekday,
        startMinute: row.startMinute,
        endMinute: row.endMinute,
        enabled: row.enabled,
      }))}
    />
  )
}
