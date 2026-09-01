import type { Metadata } from 'next'
import { requireUserPage } from '@/lib/auth'
import { listCalendars } from '@/server/services/calendars'
import { listCategories } from '@/server/services/categories'
import { CalendarSettings } from '@/components/settings/calendar-settings'
import { CategorySettings } from '@/components/settings/category-settings'

export const metadata: Metadata = { title: 'Calendars' }

export default async function CalendarSettingsPage() {
  const user = await requireUserPage('/settings/calendars')
  const [calendars, categories] = await Promise.all([
    listCalendars(user.id),
    listCategories(user.id),
  ])

  // Calendars and categories share a page because they are the two things an
  // event is filed under; keeping them apart would mean two screens to answer
  // one question about how your time is organised.
  return (
    <>
      <CalendarSettings calendars={calendars} />
      <CategorySettings categories={categories} />
    </>
  )
}
