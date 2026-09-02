import type { Metadata } from 'next'
import { ensureSettings, requireUserPage } from '@/lib/auth'
import { listContacts } from '@/server/services/contacts'
import { listCalendars } from '@/server/services/calendars'
import { accountsFor, grantedCapabilities } from '@/server/providers/registry'
import { overdueContacts } from '@/server/services/cadence'
import { ContactsView } from '@/components/contacts/contacts-view'

export const metadata: Metadata = { title: 'Contacts' }

export default async function ContactsPage() {
  const user = await requireUserPage('/contacts')

  const [settings, contacts, calendars, accounts, overdue] = await Promise.all([
    ensureSettings(user.id),
    listContacts(user.id),
    listCalendars(user.id),
    accountsFor(user.id),
    overdueContacts(user.id, user.timezone),
  ])

  return (
    <ContactsView
      initialContacts={contacts}
      calendars={calendars}
      timezone={user.timezone}
      use24h={settings.timeFormat24h}
      canSync={accounts.some((account) => grantedCapabilities(account).contacts)}
      defaultCalendarId={settings.defaultCalendarId}
      overdue={overdue}
    />
  )
}
