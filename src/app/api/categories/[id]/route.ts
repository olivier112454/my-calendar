import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { ok, parseBody, route } from '@/lib/api'
import { assertSameOrigin, requireUser } from '@/lib/auth'
import { deleteCategory, updateCategory } from '@/server/services/categories'

type Params = { params: Promise<{ id: string }> }

const patchSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
})

export const PATCH = route(async (request: NextRequest, { params }: Params) => {
  await assertSameOrigin()
  const user = await requireUser()
  const { id } = await params
  const patch = await parseBody(request, patchSchema)

  await updateCategory(user.id, id, patch)
  return ok({ id })
})

// Returns the number of events that lost their label rather than 204, so the
// UI can tell the user what the deletion actually did.
export const DELETE = route(async (_request: NextRequest, { params }: Params) => {
  await assertSameOrigin()
  const user = await requireUser()
  const { id } = await params

  return ok(await deleteCategory(user.id, id))
})
