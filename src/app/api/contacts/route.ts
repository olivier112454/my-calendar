import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { created, ok, parseBody, parseQuery, route } from '@/lib/api'
import { assertSameOrigin, requireUser } from '@/lib/auth'
import { createContact, listContacts, suggestGuests } from '@/server/services/contacts'

const querySchema = z.object({
  search: z.string().max(200).optional(),
  /** "guests" returns the compact shape the composer's autocomplete needs. */
  mode: z.enum(['list', 'guests']).optional(),
})

const createSchema = z.object({
  name: z.string().trim().min(1, 'Give the contact a name').max(200),
  email: z.string().email('Enter a valid email address').nullish(),
  phone: z.string().max(50).nullish(),
  organization: z.string().max(200).nullish(),
  jobTitle: z.string().max(200).nullish(),
  notes: z.string().max(5000).nullish(),
})

export const GET = route(async (request: NextRequest) => {
  const user = await requireUser()
  const query = parseQuery(request, querySchema)

  if (query.mode === 'guests') {
    return ok(await suggestGuests(user.id, query.search ?? ''))
  }
  return ok(await listContacts(user.id, { search: query.search }))
})

export const POST = route(async (request: NextRequest) => {
  await assertSameOrigin()
  const user = await requireUser()
  const input = await parseBody(request, createSchema)
  return created(await createContact(user.id, input))
})
