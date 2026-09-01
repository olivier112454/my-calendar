import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { noContent, ok, parseBody, route } from '@/lib/api'
import { assertSameOrigin, requireUser } from '@/lib/auth'
import {
  countSubscriptions,
  pushConfigured,
  removeSubscription,
  saveSubscription,
} from '@/server/services/push'

/**
 * Registering and removing this device for push notifications.
 *
 * The browser produces the endpoint and keys; the server only stores them
 * against the signed-in account. Nothing here trusts a user id from the body —
 * it comes from the session, so one account cannot subscribe on another's
 * behalf.
 */

const subscribeSchema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({
    p256dh: z.string().min(1).max(200),
    auth: z.string().min(1).max(200),
  }),
  /** A human hint like "Chrome on macOS", so a device can be recognised. */
  label: z.string().max(120).nullish(),
})

const unsubscribeSchema = z.object({
  endpoint: z.string().url().max(1000),
})

export const GET = route(async () => {
  const user = await requireUser()
  return ok({
    configured: pushConfigured(),
    devices: await countSubscriptions(user.id),
  })
})

export const POST = route(async (request: NextRequest) => {
  await assertSameOrigin()
  const user = await requireUser()
  const input = await parseBody(request, subscribeSchema)

  await saveSubscription(user.id, {
    endpoint: input.endpoint,
    p256dh: input.keys.p256dh,
    auth: input.keys.auth,
    label: input.label ?? null,
  })

  return ok({ devices: await countSubscriptions(user.id) })
})

export const DELETE = route(async (request: NextRequest) => {
  await assertSameOrigin()
  const user = await requireUser()
  const input = await parseBody(request, unsubscribeSchema)

  await removeSubscription(user.id, input.endpoint)
  return noContent()
})
