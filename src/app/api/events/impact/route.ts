import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { ok, parseQuery, route } from '@/lib/api'
import { requireUser } from '@/lib/auth'
import { assessMove } from '@/server/services/impact'

const querySchema = z.object({
  start: z.string(),
  end: z.string(),
  excludeEventId: z.string().uuid().optional(),
})

/**
 * What placing an event here costs the rest of that day.
 *
 * Kept apart from the conflicts endpoint rather than folded into it: the two
 * answer different questions, and this one is the heavier of the two, so a
 * failure here must never take the conflict warnings down with it.
 */
export const GET = route(async (request: NextRequest) => {
  const user = await requireUser()
  const { start, end, excludeEventId } = parseQuery(request, querySchema)

  const from = new Date(start)
  const to = new Date(end)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
    return ok(null)
  }

  return ok(await assessMove(user.id, { start: from, end: to, excludeEventId }))
})
