import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { created, ok, parseBody, route } from '@/lib/api'
import { assertSameOrigin, requireUser } from '@/lib/auth'
import { createCalendar, listCalendars } from '@/server/services/calendars'

const createSchema = z.object({
  name: z.string().trim().min(1, 'Give the calendar a name').max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Pick a colour'),
  description: z.string().max(500).nullish(),
})

export const GET = route(async () => {
  const user = await requireUser()
  return ok(await listCalendars(user.id))
})

export const POST = route(async (request: NextRequest) => {
  await assertSameOrigin()
  const user = await requireUser()
  const input = await parseBody(request, createSchema)
  return created(await createCalendar(user.id, input))
})
