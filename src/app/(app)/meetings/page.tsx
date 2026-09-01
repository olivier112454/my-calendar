import type { Metadata } from 'next'
import { ensureSettings, requireUserPage } from '@/lib/auth'
import { listBookings, listMeetingTypes } from '@/server/services/booking'
import { listCalendars } from '@/server/services/calendars'
import { ensureDefaultMeetingType } from '@/server/services/bootstrap'
import { MeetingsView } from '@/components/meetings/meetings-view'

export const metadata: Metadata = { title: 'Meetings' }

export default async function MeetingsPage() {
  const user = await requireUserPage('/meetings')

  // First visit gets a working 30-minute type rather than an empty page with a
  // form; it can be renamed or deleted like any other.
  await ensureDefaultMeetingType(user.id)

  const [settings, meetingTypes, bookings, calendars] = await Promise.all([
    ensureSettings(user.id),
    listMeetingTypes(user.id),
    listBookings(user.id),
    listCalendars(user.id),
  ])

  return (
    <MeetingsView
      meetingTypes={meetingTypes}
      bookings={bookings}
      calendars={calendars}
      username={user.username}
      timezone={user.timezone}
      use24h={settings.timeFormat24h}
    />
  )
}
