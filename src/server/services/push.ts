import 'server-only'
import { prisma } from '@/lib/db'
import { PushGoneError, sendPush, vapidFromEnv } from '@/lib/webpush'
import { appConfig } from '@/config/app'

/**
 * Push subscriptions: one row per device that agreed to receive notifications.
 *
 * Everything here is scoped by `userId`, like the rest of the services — a
 * subscription belongs to the account that created it, and no code path reaches
 * one by endpoint alone.
 */

export interface SubscriptionInput {
  endpoint: string
  p256dh: string
  auth: string
  label?: string | null
}

export function pushConfigured(): boolean {
  return vapidFromEnv() !== null
}

/**
 * Registers a device, or re-attaches one that already exists.
 *
 * Browsers hand back the same endpoint when an install is re-subscribed, and
 * they hand it to whoever is signed in at the time — so an endpoint seen before
 * is moved to the current user rather than rejected. That is what makes signing
 * out and back in on a shared laptop behave.
 */
export async function saveSubscription(
  userId: string,
  input: SubscriptionInput,
): Promise<void> {
  await prisma.pushSubscription.upsert({
    where: { endpoint: input.endpoint },
    create: {
      userId,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      label: input.label ?? null,
    },
    update: {
      userId,
      p256dh: input.p256dh,
      auth: input.auth,
      label: input.label ?? null,
      failedAt: null,
    },
  })
}

export async function removeSubscription(
  userId: string,
  endpoint: string,
): Promise<void> {
  await prisma.pushSubscription.deleteMany({ where: { userId, endpoint } })
}

export async function countSubscriptions(userId: string): Promise<number> {
  return prisma.pushSubscription.count({ where: { userId } })
}

export interface PushMessage {
  title: string
  body?: string | null
  /** Where a tap should land. */
  url?: string | null
  /** Replaces an earlier notification with the same tag instead of stacking. */
  tag?: string
}

/**
 * Sends to every device the user has registered.
 *
 * Never throws: a notification that cannot be delivered must not take down the
 * job that produced it. A subscription the push service reports as gone is
 * deleted, because it will never work again — anything else is left alone and
 * simply retried next time.
 */
export async function pushToUser(userId: string, message: PushMessage): Promise<number> {
  const vapid = vapidFromEnv()
  if (!vapid) return 0

  // Devices that failed last time are still tried: a push service having a bad
  // minute must not silence a phone forever. Only a subscription the service
  // reports as gone is removed, below.
  const subs = await prisma.pushSubscription.findMany({ where: { userId } })
  if (subs.length === 0) return 0

  const payload = {
    title: message.title,
    body: message.body ?? '',
    url: message.url ?? '/today',
    tag: message.tag,
    appName: appConfig.name,
  }

  let delivered = 0
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await sendPush(
          sub.endpoint,
          { p256dh: sub.p256dh, auth: sub.auth },
          payload,
          vapid,
        )
        delivered += 1
        await prisma.pushSubscription.update({
          where: { id: sub.id },
          data: { lastUsedAt: new Date(), failedAt: null },
        })
      } catch (cause) {
        if (cause instanceof PushGoneError) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } })
          return
        }
        // Transient. Recorded so a device that keeps failing is visible in the
        // data, but it stays in the rotation and clears itself on the next win.
        await prisma.pushSubscription.update({
          where: { id: sub.id },
          data: { failedAt: new Date() },
        })
      }
    }),
  )

  return delivered
}
