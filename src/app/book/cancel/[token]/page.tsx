import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import { appConfig } from '@/config/app'
import { CancelBooking } from '@/components/booking/cancel-booking'

export const metadata: Metadata = {
  title: `Cancel booking · ${appConfig.name}`,
  robots: { index: false, follow: false },
}

/**
 * Cancellation by token.
 *
 * The invitee has no account, so the token in the link is the credential. It is
 * long and random, single-purpose, and reveals only the meeting's own details —
 * nothing else about the host's calendar.
 */
export default async function CancelBookingPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  const booking = await prisma.booking.findUnique({
    where: { cancelToken: token },
    include: {
      meetingType: { select: { title: true, durationMinutes: true } },
      user: { select: { name: true, email: true, timezone: true } },
    },
  })
  if (!booking) notFound()

  return (
    <CancelBooking
      token={token}
      booking={{
        title: booking.meetingType.title,
        hostName: booking.user.name ?? booking.user.email,
        start: booking.startAt.toISOString(),
        end: booking.endAt.toISOString(),
        inviteeName: booking.inviteeName,
        inviteeTimezone: booking.inviteeTimezone,
        status: booking.status,
      }}
    />
  )
}
