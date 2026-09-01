import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { noContent, ok, parseBody, route } from '@/lib/api'
import { assertSameOrigin, requireUser } from '@/lib/auth'
import { deleteCalendar, updateCalendar } from '@/server/services/calendars'

type Params = { params: Promise<{ id: string }> }

const patchSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  description: z.string().max(500).nullish(),
  isVisible: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
})

export const PATCH = route(async (request: NextRequest, { params }: Params) => {
  await assertSameOrigin()
  const user = await requireUser()
  const { id } = await params
  const patch = await parseBody(request, patchSchema)

  await updateCalendar(user.id, id, patch)
  return ok({ id })
})

export const DELETE = route(async (_request: NextRequest, { params }: Params) => {
  await assertSameOrigin()
  const user = await requireUser()
  const { id } = await params

  await deleteCalendar(user.id, id)
  return noContent()
})
