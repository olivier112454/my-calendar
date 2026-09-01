import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { noContent, ok, parseBody, route } from '@/lib/api'
import { assertSameOrigin, requireUser } from '@/lib/auth'
import { deleteContact, getContact, updateContact } from '@/server/services/contacts'

type Params = { params: Promise<{ id: string }> }

const patchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  email: z.string().email().nullish(),
  phone: z.string().max(50).nullish(),
  organization: z.string().max(200).nullish(),
  jobTitle: z.string().max(200).nullish(),
  notes: z.string().max(5000).nullish(),
  isFavorite: z.boolean().optional(),
})

export const GET = route(async (_request: NextRequest, { params }: Params) => {
  const user = await requireUser()
  const { id } = await params
  return ok(await getContact(user.id, id))
})

export const PATCH = route(async (request: NextRequest, { params }: Params) => {
  await assertSameOrigin()
  const user = await requireUser()
  const { id } = await params
  const patch = await parseBody(request, patchSchema)

  await updateContact(user.id, id, patch)
  return ok({ id })
})

export const DELETE = route(async (_request: NextRequest, { params }: Params) => {
  await assertSameOrigin()
  const user = await requireUser()
  const { id } = await params

  await deleteContact(user.id, id)
  return noContent()
})
