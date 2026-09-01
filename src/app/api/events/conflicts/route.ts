import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { ok, parseQuery, route } from '@/lib/api'
import { requireUser } from '@/lib/auth'
import { findConflicts } from '@/server/services/conflicts'

const querySchema = z.object({
  start: z.string(),
  end: z.string(),
  excludeEventId: z.string().uuid().optional(),
})

/** Called while the composer is open, so it stays a cheap read-only lookup. */
export const GET = route(async (request: NextRequest) => {
  const user = await requireUser()
  const { start, end, excludeEventId } = parseQuery(request, querySchema)

  const from = new Date(start)
  const to = new Date(end)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
    return ok([])
  }

  return ok(await findConflicts(user.id, { start: from, end: to, excludeEventId }))
})
