import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { created, ok, parseBody, route } from '@/lib/api'
import { assertSameOrigin, requireUser } from '@/lib/auth'
import { createCategory, listCategories } from '@/server/services/categories'

const createSchema = z.object({
  name: z.string().trim().min(1, 'Give the category a name').max(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Pick a colour'),
})

export const GET = route(async () => {
  const user = await requireUser()
  return ok(await listCategories(user.id))
})

export const POST = route(async (request: NextRequest) => {
  await assertSameOrigin()
  const user = await requireUser()
  const input = await parseBody(request, createSchema)
  return created(await createCategory(user.id, input))
})
