import 'server-only'
import { headers } from 'next/headers'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { hashIp } from '@/lib/crypto'

/**
 * Append-only record of consequential actions: who changed what, and when.
 *
 * Two jobs. It powers the user-facing activity list ("Event moved", "Google
 * calendar synced"), and it gives an operator a trail to follow after a support
 * question or a security incident. It deliberately stores identifiers and small
 * metadata, never full record contents — an audit log that mirrors the data is
 * a second copy to protect.
 *
 * Writes never block or fail the action they describe.
 */

export interface AuditInput {
  userId: string
  action: string
  entityType?: string
  entityId?: string
  metadata?: Prisma.InputJsonValue
}

export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    let ipHash: string | null = null
    try {
      const headerList = await headers()
      const forwarded = headerList.get('x-forwarded-for')
      ipHash = hashIp(forwarded?.split(',')[0]?.trim() ?? headerList.get('x-real-ip'))
    } catch {
      // Called from a background job — there is no request to read headers from.
    }

    await prisma.auditLog.create({
      data: {
        userId: input.userId,
        action: input.action,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        metadata: input.metadata ?? undefined,
        ipHash,
      },
    })
  } catch (error) {
    console.error('[audit] failed to record', input.action, error)
  }
}

/** Recent activity for the user-facing list. */
export async function recentActivity(userId: string, take = 50) {
  return prisma.auditLog.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take,
  })
}

/** Human phrasing for the actions we surface in the UI. */
export const auditLabels: Record<string, string> = {
  'auth.signin': 'Signed in',
  'auth.signout': 'Signed out',
  'event.created': 'Event created',
  'event.updated': 'Event updated',
  'event.moved': 'Event moved',
  'event.deleted': 'Event deleted',
  'task.created': 'Task created',
  'task.completed': 'Task completed',
  'task.scheduled': 'Task scheduled',
  'calendar.created': 'Calendar created',
  'calendar.deleted': 'Calendar deleted',
  'integration.connected': 'Integration connected',
  'integration.disconnected': 'Integration disconnected',
  'sync.completed': 'Calendar synced',
  'sync.failed': 'Sync failed',
  'booking.created': 'Meeting booked',
  'booking.cancelled': 'Booking cancelled',
  'settings.updated': 'Settings updated',
}
