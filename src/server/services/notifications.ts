import 'server-only'
import type { NotificationType } from '@prisma/client'
import { prisma } from '@/lib/db'
import { pushToUser } from './push'
import type { NotificationSummary } from '@/types/domain'

/**
 * In-app notifications.
 *
 * One list, whatever the source: a reminder that fired, an RSVP that came back,
 * a booking, a sync that failed. Keeping them in one place is what lets the
 * bell mean "something needs your attention" rather than "some subsystem has
 * news".
 */

export async function listNotifications(
  userId: string,
  options: { unreadOnly?: boolean; limit?: number } = {},
): Promise<NotificationSummary[]> {
  const rows = await prisma.notification.findMany({
    where: { userId, ...(options.unreadOnly ? { readAt: null } : {}) },
    orderBy: { createdAt: 'desc' },
    take: options.limit ?? 50,
  })

  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    link: row.link,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    entityType: row.entityType,
    entityId: row.entityId,
  }))
}

export async function unreadCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } })
}

export async function markRead(userId: string, ids?: string[]): Promise<number> {
  const { count } = await prisma.notification.updateMany({
    where: { userId, readAt: null, ...(ids?.length ? { id: { in: ids } } : {}) },
    data: { readAt: new Date() },
  })
  return count
}

export async function dismissAll(userId: string): Promise<number> {
  const { count } = await prisma.notification.deleteMany({ where: { userId } })
  return count
}

export interface NotifyInput {
  userId: string
  type: NotificationType
  title: string
  body?: string | null
  link?: string | null
  entityType?: string
  entityId?: string
  /**
   * When set, an unread notification of the same type for the same entity is
   * updated rather than duplicated — so a reminder that retries does not stack
   * up five identical rows.
   */
  dedupe?: boolean
}

export async function notify(input: NotifyInput): Promise<void> {
  const created = await record(input)
  // Fire-and-forget: a push that fails must never roll back the notification
  // the user can still see in the app. `pushToUser` swallows its own errors.
  if (created) {
    void pushToUser(input.userId, {
      title: input.title,
      body: input.body ?? null,
      url: input.link ?? null,
      // One tag per entity, so a retried reminder replaces the earlier banner
      // instead of stacking five copies on the lock screen.
      tag: input.entityId ? `${input.type}:${input.entityId}` : undefined,
    })
  }
}

/**
 * Writes the notification row.
 *
 * Returns false when an existing unread one was refreshed instead of a new one
 * created — that is a retry, and a second buzz for the same reminder is noise.
 */
async function record(input: NotifyInput): Promise<boolean> {
  if (input.dedupe && input.entityId) {
    const existing = await prisma.notification.findFirst({
      where: {
        userId: input.userId,
        type: input.type,
        entityId: input.entityId,
        readAt: null,
      },
      select: { id: true },
    })
    if (existing) {
      await prisma.notification.update({
        where: { id: existing.id },
        data: {
          title: input.title,
          body: input.body ?? null,
          createdAt: new Date(),
        },
      })
      return false
    }
  }

  await prisma.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      link: input.link ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
    },
  })
  return true
}

/** Housekeeping: read notifications older than a month are not worth keeping. */
export async function pruneNotifications(userId: string): Promise<number> {
  const { count } = await prisma.notification.deleteMany({
    where: {
      userId,
      readAt: { not: null, lt: new Date(Date.now() - 30 * 86_400_000) },
    },
  })
  return count
}
