import type { Metadata } from 'next'
import { ensureSettings, requireUserPage } from '@/lib/auth'
import { listCalendars } from '@/server/services/calendars'
import { listInbox } from '@/server/services/inbox'
import { mailAccountsFor } from '@/server/providers/registry'
import { sampleProvidersEnabled } from '@/server/demo'
import { InboxView } from '@/components/inbox/inbox-view'

export const metadata: Metadata = { title: 'Inbox' }

export default async function InboxPage() {
  const user = await requireUserPage('/inbox')

  const [settings, calendars, mailAccounts, messages] = await Promise.all([
    ensureSettings(user.id),
    listCalendars(user.id),
    mailAccountsFor(user.id),
    listInbox(user.id, { suggestionsOnly: true }),
  ])

  return (
    <InboxView
      initialMessages={messages}
      calendars={calendars}
      timezone={user.timezone}
      use24h={settings.timeFormat24h}
      hasMailAccount={mailAccounts.length > 0}
      usingSampleData={sampleProvidersEnabled() && mailAccounts.length > 0}
      defaultCalendarId={settings.defaultCalendarId}
    />
  )
}
