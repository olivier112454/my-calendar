import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { ok, parseQuery, route } from '@/lib/api'
import { requireUser } from '@/lib/auth'
import { enforce, limits } from '@/lib/rate-limit'
import { search } from '@/server/services/search'
import type { SearchType } from '@/types/search'

const querySchema = z.object({
  q: z.string().max(200),
  types: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  calendarId: z.string().uuid().optional(),
  personEmail: z.string().email().optional(),
  status: z.string().optional(),
})

export const GET = route(async (request: NextRequest) => {
  const user = await requireUser()
  await enforce('search', limits.search, user.id)

  const query = parseQuery(request, querySchema)

  return ok(
    await search(user.id, query.q, {
      types: query.types?.split(',').filter(Boolean) as SearchType[] | undefined,
      from: query.from,
      to: query.to,
      calendarId: query.calendarId,
      personEmail: query.personEmail,
      status: query.status,
    }),
  )
})
