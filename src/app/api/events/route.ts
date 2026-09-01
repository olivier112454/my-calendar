import type { NextRequest } from 'next/server'
import { created, ok, parseBody, parseQuery, route } from '@/lib/api'
import { assertSameOrigin, requireUser } from '@/lib/auth'
import { enforce, limits } from '@/lib/rate-limit'
import {
  createEventSchema,
  listEventsQuerySchema,
} from '@/lib/validation/event'
import { createEvent, listOccurrences } from '@/server/services/events'
import { ensureSettings } from '@/lib/auth'

/**
 * GET  /api/events?from=&to=   occurrences overlapping a window
 * POST /api/events             create
 *
 * Reads are always bounded by an explicit window. There is deliberately no way
 * to ask for "all events": a calendar that has been in use for years would
 * otherwise be a single query away from an unbounded response.
 */

/** Refuse windows wider than this — roughly the year view plus slack. */
const MAX_RANGE_MS = 400 * 24 * 60 * 60 * 1000

export const GET = route(async (request: NextRequest) => {
  const user = await requireUser()
  const query = parseQuery(request, listEventsQuerySchema)

  const from = new Date(query.from)
  const to = new Date(query.to)

  if (to.getTime() - from.getTime() > MAX_RANGE_MS) {
    return ok([])
  }

  const settings = await ensureSettings(user.id)

  const events = await listOccurrences(user.id, {
    from,
    to,
    calendarIds: query.calendarIds?.split(',').filter(Boolean),
    kinds: query.kinds?.split(',').filter(Boolean),
    includeDeclined:
      query.includeDeclined === 'true' || settings.showDeclinedEvents,
    search: query.search,
    userEmail: user.email,
  })

  return ok(events)
})

export const POST = route(async (request: NextRequest) => {
  await assertSameOrigin()
  const user = await requireUser()
  await enforce('events-write', limits.write, user.id)

  const input = await parseBody(request, createEventSchema)
  const event = await createEvent(user.id, input)

  return created(event)
})
