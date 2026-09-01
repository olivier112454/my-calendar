import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { created, ok, parseBody, route, AppError } from '@/lib/api'
import { assertSameOrigin, requireUser } from '@/lib/auth'
import { slugify } from '@/lib/utils'
import { listMeetingTypes } from '@/server/services/booking'

const availabilitySchema = z.object({
  weekday: z.number().int().min(0).max(6),
  startMinute: z.number().int().min(0).max(1440),
  endMinute: z.number().int().min(0).max(1440),
})

const createSchema = z.object({
  title: z.string().trim().min(1, 'Give it a name').max(120),
  description: z.string().max(2000).nullish(),
  durationMinutes: z.number().int().min(5).max(480),
  bufferAfterMinutes: z.number().int().min(0).max(120).default(10),
  minimumNoticeMinutes: z.number().int().min(0).max(20160).default(240),
  bookingWindowDays: z.number().int().min(1).max(365).default(60),
  meetingProvider: z
    .enum(['NONE', 'GOOGLE_MEET', 'MICROSOFT_TEAMS', 'ZOOM', 'CUSTOM', 'PHONE', 'IN_PERSON'])
    .default('GOOGLE_MEET'),
  location: z.string().max(300).nullish(),
  targetCalendarId: z.string().uuid().nullish(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#4f46e5'),
  availability: z.array(availabilitySchema).max(35).default([]),
})

export const GET = route(async () => {
  const user = await requireUser()
  return ok(await listMeetingTypes(user.id))
})

export const POST = route(async (request: NextRequest) => {
  await assertSameOrigin()
  const user = await requireUser()
  const input = await parseBody(request, createSchema)

  if (!user.username) {
    throw new AppError(
      'Set a booking name on your account page first.',
      'missing_username',
      400,
    )
  }

  // A readable slug, made unique per user rather than globally.
  const base = slugify(input.title) || 'meeting'
  let slug = base
  for (let attempt = 1; attempt < 50; attempt++) {
    const taken = await prisma.meetingType.findFirst({
      where: { userId: user.id, slug },
      select: { id: true },
    })
    if (!taken) break
    slug = `${base}-${attempt + 1}`
  }

  const meetingType = await prisma.meetingType.create({
    data: {
      userId: user.id,
      slug,
      title: input.title,
      description: input.description ?? null,
      durationMinutes: input.durationMinutes,
      bufferAfterMinutes: input.bufferAfterMinutes,
      minimumNoticeMinutes: input.minimumNoticeMinutes,
      bookingWindowDays: input.bookingWindowDays,
      meetingProvider: input.meetingProvider,
      location: input.location ?? null,
      targetCalendarId: input.targetCalendarId ?? null,
      color: input.color,
      availability: {
        create: input.availability.length
          ? input.availability
          : [1, 2, 3, 4, 5].map((weekday) => ({
              weekday,
              startMinute: 9 * 60,
              endMinute: 17 * 60,
            })),
      },
    },
  })

  return created({ id: meetingType.id, slug: meetingType.slug })
})
