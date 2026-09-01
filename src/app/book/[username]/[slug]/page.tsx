import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getPublicMeetingType } from '@/server/services/booking'
import { appConfig } from '@/config/app'
import { BookingPage } from '@/components/booking/booking-page'

/**
 * The public booking page.
 *
 * Rendered outside the app shell: whoever lands here is not a user of this app
 * and should not be shown its navigation. It needs to load fast, work without
 * an account, and make the time zone unmistakable.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string; slug: string }>
}): Promise<Metadata> {
  const { username, slug } = await params
  try {
    const meetingType = await getPublicMeetingType(username, slug)
    return {
      title: `${meetingType.title} with ${meetingType.hostName}`,
      description: meetingType.description ?? `Book time with ${meetingType.hostName}.`,
      // A booking page is meant to be shared, unlike the rest of the app.
      robots: { index: false, follow: false },
    }
  } catch {
    return { title: `Not found · ${appConfig.name}` }
  }
}

export default async function PublicBookingPage({
  params,
}: {
  params: Promise<{ username: string; slug: string }>
}) {
  const { username, slug } = await params

  let meetingType
  try {
    meetingType = await getPublicMeetingType(username, slug)
  } catch {
    notFound()
  }

  return <BookingPage username={username} slug={slug} meetingType={meetingType} />
}
