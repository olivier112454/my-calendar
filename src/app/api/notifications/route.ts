import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { ok, parseBody, parseQuery, route } from '@/lib/api'
import { assertSameOrigin, requireUser } from '@/lib/auth'
import {
  dismissAll,
  listNotifications,
  markRead,
} from '@/server/services/notifications'

const querySchema = z.object({
  unreadOnly: z.enum(['true', 'false']).optional(),
})

const patchSchema = z.object({
  /** Omit to mark everything read. */
  ids: z.array(z.string().uuid()).max(200).optional(),
})

export const GET = route(async (request: NextRequest) => {
  const user = await requireUser()
  const query = parseQuery(request, querySchema)

  const notifications = await listNotifications(user.id, {
    unreadOnly: query.unreadOnly === 'true',
  })
  return ok({
    notifications,
    unread: notifications.filter((entry) => entry.readAt === null).length,
  })
})

export const PATCH = route(async (request: NextRequest) => {
  await assertSameOrigin()
  const user = await requireUser()

  let ids: string[] | undefined
  try {
    ids = (await parseBody(request, patchSchema)).ids
  } catch {
    /* no body means "all" */
  }

  return ok({ read: await markRead(user.id, ids) })
})

export const DELETE = route(async () => {
  await assertSameOrigin()
  const user = await requireUser()
  return ok({ removed: await dismissAll(user.id) })
})
