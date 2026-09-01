import 'server-only'
import { prisma } from '@/lib/db'
import { AppError, NotFoundError } from '@/lib/api'
import {
  addDaysToKey,
  dayKeyOf,
  endOfDayUtc,
  startOfDayUtc,
  todayKey,
  wallToUtc,
} from '@/lib/datetime'
import { randomToken } from '@/lib/crypto'
import { recordAudit } from '@/server/audit'
import { listOccurrences } from './events'

/**
 * Meeting types and public booking.
 *
 * The public side runs unauthenticated, which shapes two decisions:
 *
 *  - It reveals availability, never content. An invitee sees that 14:00 is
 *    taken, not what is in it.
 *  - It is the only place in the app that accepts a write without a session, so
 *    it is rate-limited, validated hard, and every booking is tied to a
 *    single-use cancellation token rather than a guessable id.
 */

export interface PublicMeetingType {
  id: string
  slug: string
  title: string
  description: string | null
  durationMinutes: number
  color: string
  location: string | null
  meetingProvider: string
  hostName: string
  hostAvatarUrl: string | null
  hostTimezone: string
  bookingWindowDays: number
  minimumNoticeMinutes: number
}

export interface DaySlots {
  dayKey: string
  slots: { start: string; end: string }[]
}

export async function getPublicMeetingType(
  username: string,
  slug: string,
): Promise<PublicMeetingType> {
  const meetingType = await prisma.meetingType.findFirst({
    where: { slug, isActive: true, user: { username } },
    include: {
      user: { select: { name: true, email: true, avatarUrl: true, timezone: true } },
    },
  })
  if (!meetingType) throw new NotFoundError('That booking page')

  return {
    id: meetingType.id,
    slug: meetingType.slug,
    title: meetingType.title,
    description: meetingType.description,
    durationMinutes: meetingType.durationMinutes,
    color: meetingType.color,
    location: meetingType.location,
    meetingProvider: meetingType.meetingProvider,
    hostName: meetingType.user.name ?? meetingType.user.email.split('@')[0]!,
    hostAvatarUrl: meetingType.user.avatarUrl,
    hostTimezone: meetingType.user.timezone,
    bookingWindowDays: meetingType.bookingWindowDays,
    minimumNoticeMinutes: meetingType.minimumNoticeMinutes,
  }
}

/**
 * Free slots for a stretch of days.
 *
 * Availability is the intersection of the meeting type's own hours and the
 * host's actual calendar, minus buffers, minimum notice, and any day already at
 * its cap.
 */
export async function availableSlots(
  meetingTypeId: string,
  fromDayKey: string,
  days: number,
): Promise<DaySlots[]> {
  const meetingType = await prisma.meetingType.findUnique({
    where: { id: meetingTypeId },
    include: {
      availability: true,
      user: { select: { id: true, email: true, timezone: true } },
    },
  })
  if (!meetingType || !meetingType.isActive) throw new NotFoundError('That booking page')

  const zone = meetingType.user.timezone
  const today = todayKey(zone)
  const horizonEnd = addDaysToKey(today, meetingType.bookingWindowDays)

  const start = fromDayKey < today ? today : fromDayKey
  const dayKeys = Array.from({ length: days }, (_, index) =>
    addDaysToKey(start, index),
  ).filter((key) => key <= horizonEnd)

  if (dayKeys.length === 0) return []

  const rangeStart = startOfDayUtc(dayKeys[0]!, zone)
  const rangeEnd = endOfDayUtc(dayKeys[dayKeys.length - 1]!, zone)

  const [busy, bookings] = await Promise.all([
    listOccurrences(meetingType.user.id, {
      from: rangeStart,
      to: rangeEnd,
      onlyVisibleCalendars: false,
      includeDeclined: false,
      userEmail: meetingType.user.email,
    }),
    prisma.booking.findMany({
      where: {
        meetingTypeId,
        status: 'CONFIRMED',
        startAt: { gte: rangeStart, lt: rangeEnd },
      },
      select: { startAt: true },
    }),
  ])

  const blocked = busy
    .filter((event) => event.transparency === 'BUSY')
    .filter((event) => event.status !== 'CANCELLED')
    .filter((event) => !event.allDay)
    .map((event) => ({
      start: Date.parse(event.start) - meetingType.bufferBeforeMinutes * 60_000,
      end: Date.parse(event.end) + meetingType.bufferAfterMinutes * 60_000,
    }))

  const bookingsPerDay = new Map<string, number>()
  for (const booking of bookings) {
    const key = dayKeyOf(booking.startAt, zone)
    bookingsPerDay.set(key, (bookingsPerDay.get(key) ?? 0) + 1)
  }

  const notBefore = Date.now() + meetingType.minimumNoticeMinutes * 60_000
  const stepMinutes = slotStep(meetingType.durationMinutes)
  const out: DaySlots[] = []

  for (const dayKey of dayKeys) {
    const weekday = new Date(`${dayKey}T12:00:00`).getDay()
    const windows = meetingType.availability.filter((entry) => entry.weekday === weekday)
    if (windows.length === 0) {
      out.push({ dayKey, slots: [] })
      continue
    }

    if (
      meetingType.maxPerDay !== null &&
      (bookingsPerDay.get(dayKey) ?? 0) >= meetingType.maxPerDay
    ) {
      out.push({ dayKey, slots: [] })
      continue
    }

    const slots: { start: string; end: string }[] = []

    for (const window of windows) {
      for (
        let minute = window.startMinute;
        minute + meetingType.durationMinutes <= window.endMinute;
        minute += stepMinutes
      ) {
        const slotStart = wallToUtc(
          `${dayKey}T${clock(minute)}`,
          zone,
        ).getTime()
        const slotEnd = slotStart + meetingType.durationMinutes * 60_000

        if (slotStart < notBefore) continue
        const collides = blocked.some(
          (entry) => slotStart < entry.end && slotEnd > entry.start,
        )
        if (collides) continue
        const alreadyBooked = bookings.some(
          (booking) => booking.startAt.getTime() === slotStart,
        )
        if (alreadyBooked) continue

        slots.push({
          start: new Date(slotStart).toISOString(),
          end: new Date(slotEnd).toISOString(),
        })
      }
    }

    out.push({ dayKey, slots })
  }

  return out
}

/** Round slot starts to a tidy grid rather than butting them end to end. */
function slotStep(durationMinutes: number): number {
  if (durationMinutes <= 15) return 15
  if (durationMinutes <= 30) return 30
  return 30
}

function clock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

export interface CreateBookingInput {
  meetingTypeId: string
  start: string
  inviteeName: string
  inviteeEmail: string
  inviteeNotes?: string
  inviteeTimezone: string
}

export async function createBooking(input: CreateBookingInput) {
  const meetingType = await prisma.meetingType.findUnique({
    where: { id: input.meetingTypeId },
    include: {
      user: { select: { id: true, name: true, email: true, timezone: true } },
    },
  })
  if (!meetingType || !meetingType.isActive) throw new NotFoundError('That booking page')

  const start = new Date(input.start)
  if (Number.isNaN(start.getTime())) {
    throw new AppError('That is not a valid time.', 'invalid_time', 400)
  }
  const end = new Date(start.getTime() + meetingType.durationMinutes * 60_000)

  // Re-check availability at the moment of booking: the page may have been open
  // for a while, and two people can reach the same slot.
  const slots = await availableSlots(
    meetingType.id,
    dayKeyOf(start, meetingType.user.timezone),
    1,
  )
  const stillFree = slots
    .flatMap((day) => day.slots)
    .some((slot) => Date.parse(slot.start) === start.getTime())

  if (!stillFree) {
    throw new AppError(
      'That time has just been taken. Please choose another.',
      'slot_taken',
      409,
    )
  }

  const cancelToken = randomToken(24)

  const booking = await prisma.$transaction(async (tx) => {
    const event = meetingType.targetCalendarId
      ? await tx.event.create({
          data: {
            userId: meetingType.userId,
            calendarId: meetingType.targetCalendarId,
            title: `${meetingType.title} — ${input.inviteeName}`,
            description: input.inviteeNotes ?? null,
            location: meetingType.location,
            startAt: start,
            endAt: end,
            timezone: meetingType.user.timezone,
            meetingProvider: meetingType.meetingProvider,
            attendees: {
              create: [
                {
                  email: meetingType.user.email,
                  name: meetingType.user.name,
                  isOrganizer: true,
                  response: 'ACCEPTED',
                },
                {
                  email: input.inviteeEmail.toLowerCase(),
                  name: input.inviteeName,
                  response: 'ACCEPTED',
                },
              ],
            },
          },
        })
      : null

    return tx.booking.create({
      data: {
        meetingTypeId: meetingType.id,
        userId: meetingType.userId,
        eventId: event?.id ?? null,
        inviteeName: input.inviteeName,
        inviteeEmail: input.inviteeEmail.toLowerCase(),
        inviteeNotes: input.inviteeNotes ?? null,
        inviteeTimezone: input.inviteeTimezone,
        startAt: start,
        endAt: end,
        cancelToken,
      },
    })
  })

  await prisma.notification.create({
    data: {
      userId: meetingType.userId,
      type: 'SCHEDULING_REQUEST',
      title: `${input.inviteeName} booked ${meetingType.title}`,
      body: start.toISOString(),
      link: '/meetings',
      entityType: 'Booking',
      entityId: booking.id,
    },
  })

  await recordAudit({
    userId: meetingType.userId,
    action: 'booking.created',
    entityType: 'Booking',
    entityId: booking.id,
    metadata: { invitee: input.inviteeEmail, start: start.toISOString() },
  })

  return {
    id: booking.id,
    cancelToken,
    start: booking.startAt.toISOString(),
    end: booking.endAt.toISOString(),
    hostName: meetingType.user.name ?? meetingType.user.email,
    title: meetingType.title,
  }
}

export async function cancelBooking(cancelToken: string): Promise<void> {
  const booking = await prisma.booking.findUnique({
    where: { cancelToken },
    select: { id: true, eventId: true, userId: true, status: true, inviteeName: true },
  })
  if (!booking) throw new NotFoundError('That booking')
  if (booking.status === 'CANCELLED') return

  await prisma.$transaction([
    prisma.booking.update({
      where: { id: booking.id },
      data: { status: 'CANCELLED' },
    }),
    ...(booking.eventId
      ? [prisma.event.deleteMany({ where: { id: booking.eventId } })]
      : []),
  ])

  await prisma.notification.create({
    data: {
      userId: booking.userId,
      type: 'SCHEDULING_REQUEST',
      title: `${booking.inviteeName} cancelled a booking`,
      link: '/meetings',
    },
  })

  await recordAudit({
    userId: booking.userId,
    action: 'booking.cancelled',
    entityType: 'Booking',
    entityId: booking.id,
  })
}

/* ------------------------------------------------------- host-side reads */

export async function listMeetingTypes(userId: string) {
  const rows = await prisma.meetingType.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
    include: {
      availability: { orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }] },
      _count: { select: { bookings: { where: { status: 'CONFIRMED' } } } },
    },
  })

  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    durationMinutes: row.durationMinutes,
    bufferAfterMinutes: row.bufferAfterMinutes,
    minimumNoticeMinutes: row.minimumNoticeMinutes,
    bookingWindowDays: row.bookingWindowDays,
    meetingProvider: row.meetingProvider,
    location: row.location,
    color: row.color,
    isActive: row.isActive,
    bookingCount: row._count.bookings,
    availability: row.availability.map((entry) => ({
      weekday: entry.weekday,
      startMinute: entry.startMinute,
      endMinute: entry.endMinute,
    })),
  }))
}

export async function listBookings(userId: string) {
  const rows = await prisma.booking.findMany({
    where: { userId },
    orderBy: { startAt: 'desc' },
    take: 100,
    include: { meetingType: { select: { title: true, color: true } } },
  })

  return rows.map((row) => ({
    id: row.id,
    title: row.meetingType.title,
    color: row.meetingType.color,
    inviteeName: row.inviteeName,
    inviteeEmail: row.inviteeEmail,
    inviteeNotes: row.inviteeNotes,
    inviteeTimezone: row.inviteeTimezone,
    start: row.startAt.toISOString(),
    end: row.endAt.toISOString(),
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  }))
}
