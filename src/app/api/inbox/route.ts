import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { ok, parseQuery, route } from '@/lib/api'
import { assertSameOrigin, requireUser } from '@/lib/auth'
import { enforce, limits } from '@/lib/rate-limit'
import { listInbox, refreshInbox } from '@/server/services/inbox'

const querySchema = z.object({
  category: z.string().optional(),
  suggestionsOnly: z.enum(['true', 'false']).optional(),
  unreadOnly: z.enum(['true', 'false']).optional(),
  includeDismissed: z.enum(['true', 'false']).optional(),
  search: z.string().max(200).optional(),
})

export const GET = route(async (request: NextRequest) => {
  const user = await requireUser()
  const query = parseQuery(request, querySchema)

  return ok(
    await listInbox(user.id, {
      category: query.category,
      suggestionsOnly: query.suggestionsOnly === 'true',
      unreadOnly: query.unreadOnly === 'true',
      includeDismissed: query.includeDismissed === 'true',
      search: query.search,
    }),
  )
})

/** Pulls fresh message metadata from the connected mailboxes. */
export const POST = route(async () => {
  await assertSameOrigin()
  const user = await requireUser()
  await enforce('sync', limits.sync, user.id)

  const result = await refreshInbox(user.id, user.timezone)
  return ok(result)
})
