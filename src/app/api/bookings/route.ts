import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { created, ok, parseBody, parseQuery, route } from '@/lib/api'
import { enforce, limits } from '@/lib/rate-limit'
import {
  availableSlots,
  cancelBooking,
  createBooking,
  getPublicMeetingType,
} from '@/server/services/booking'

/**
 * The public booking endpoint. Unauthenticated by necessity: an invitee has no
 * account. Everything here is therefore rate-limited and validated tightly, and
 * it exposes availability only — never event contents.
 */

const slotsQuerySchema = z.object({
  username: z.string().max(40),
  slug: z.string().max(60),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  days: z.coerce.number().int().min(1).max(31).default(7),
})

const createSchema = z.object({
  username: z.string().max(40),
  slug: z.string().max(60),
  start: z.string(),
  inviteeName: z.string().trim().min(1, 'Enter your name').max(120),
  inviteeEmail: z.string().email('Enter a valid email address'),
  inviteeNotes: z.string().max(2000).optional(),
  inviteeTimezone: z.string().max(60).default('UTC'),
})

const cancelSchema = z.object({ cancelToken: z.string().min(10).max(200) })

export const GET = route(async (request: NextRequest) => {
  await enforce('booking-slots', limits.bookingAvailability)

  const query = parseQuery(request, slotsQuerySchema)
  const meetingType = await getPublicMeetingType(query.username, query.slug)
  const days = await availableSlots(meetingType.id, query.from, query.days)

  return ok({ meetingType, days })
})

export const POST = route(async (request: NextRequest) => {
  await enforce('booking-create', limits.booking)

  const input = await parseBody(request, createSchema)
  const meetingType = await getPublicMeetingType(input.username, input.slug)

  const booking = await createBooking({
    meetingTypeId: meetingType.id,
    start: input.start,
    inviteeName: input.inviteeName,
    inviteeEmail: input.inviteeEmail,
    inviteeNotes: input.inviteeNotes,
    inviteeTimezone: input.inviteeTimezone,
  })

  return created(booking)
})

export const DELETE = route(async (request: NextRequest) => {
  await enforce('booking-cancel', limits.booking)

  const { cancelToken } = await parseBody(request, cancelSchema)
  await cancelBooking(cancelToken)

  return ok({ cancelled: true })
})
