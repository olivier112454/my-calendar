import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { noContent, ok, parseBody, parseQuery, route } from '@/lib/api'
import { assertSameOrigin, requireUser } from '@/lib/auth'
import { enforce, limits } from '@/lib/rate-limit'
import { deleteEventSchema, updateEventSchema } from '@/lib/validation/event'
import {
  deleteEvent,
  getEventDetail,
  updateEvent,
} from '@/server/services/events'

type Params = { params: Promise<{ id: string }> }

const detailQuerySchema = z.object({ occurrenceStart: z.string().optional() })

export const GET = route(async (request: NextRequest, { params }: Params) => {
  const user = await requireUser()
  const { id } = await params
  const { occurrenceStart } = parseQuery(request, detailQuerySchema)

  return ok(await getEventDetail(user.id, id, occurrenceStart))
})

export const PATCH = route(async (request: NextRequest, { params }: Params) => {
  await assertSameOrigin()
  const user = await requireUser()
  await enforce('events-write', limits.write, user.id)

  const { id } = await params
  const input = await parseBody(request, updateEventSchema)

  return ok(await updateEvent(user.id, id, input))
})

export const DELETE = route(async (request: NextRequest, { params }: Params) => {
  await assertSameOrigin()
  const user = await requireUser()
  await enforce('events-write', limits.write, user.id)

  const { id } = await params

  // Delete carries a body (which part of a series to remove); tolerate its
  // absence so a plain DELETE still means "all of it".
  let scope: 'this' | 'following' | 'all' = 'all'
  let occurrenceStart: string | undefined
  try {
    const body = await parseBody(request, deleteEventSchema)
    scope = body.scope
    occurrenceStart = body.occurrenceStart
  } catch {
    /* no body — fall through with the defaults */
  }

  await deleteEvent(user.id, id, scope, occurrenceStart)
  return noContent()
})
