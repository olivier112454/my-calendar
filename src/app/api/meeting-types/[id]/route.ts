import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { NotFoundError, noContent, ok, parseBody, route } from '@/lib/api'
import { assertSameOrigin, requireUser } from '@/lib/auth'

type Params = { params: Promise<{ id: string }> }

const patchSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(2000).nullish(),
  durationMinutes: z.number().int().min(5).max(480).optional(),
  bufferAfterMinutes: z.number().int().min(0).max(120).optional(),
  minimumNoticeMinutes: z.number().int().min(0).max(20160).optional(),
  bookingWindowDays: z.number().int().min(1).max(365).optional(),
  location: z.string().max(300).nullish(),
  targetCalendarId: z.string().uuid().nullish(),
  isActive: z.boolean().optional(),
  availability: z
    .array(
      z.object({
        weekday: z.number().int().min(0).max(6),
        startMinute: z.number().int().min(0).max(1440),
        endMinute: z.number().int().min(0).max(1440),
      }),
    )
    .max(35)
    .optional(),
})

export const PATCH = route(async (request: NextRequest, { params }: Params) => {
  await assertSameOrigin()
  const user = await requireUser()
  const { id } = await params
  const input = await parseBody(request, patchSchema)

  const existing = await prisma.meetingType.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  })
  if (!existing) throw new NotFoundError('That meeting type')

  const { availability, ...scalars } = input

  await prisma.meetingType.update({
    where: { id },
    data: {
      ...scalars,
      ...(availability
        ? { availability: { deleteMany: {}, create: availability } }
        : {}),
    },
  })

  return ok({ id })
})

export const DELETE = route(async (_request: NextRequest, { params }: Params) => {
  await assertSameOrigin()
  const user = await requireUser()
  const { id } = await params

  const { count } = await prisma.meetingType.deleteMany({
    where: { id, userId: user.id },
  })
  if (count === 0) throw new NotFoundError('That meeting type')

  return noContent()
})
