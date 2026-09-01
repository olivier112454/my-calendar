import 'server-only'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { AppError } from '@/lib/api'
import { isValidTimeZone } from '@/lib/datetime'
import { recordAudit } from '@/server/audit'
import { destroyAllSessions } from '@/lib/session'
import { revokeAccount } from '../providers/google/oauth'
import type { IntegrationSummary } from '@/types/domain'

/**
 * Settings, working hours and connected accounts.
 *
 * Everything here is per-user and scoped by `userId`; there is no global
 * configuration a user can reach.
 */

export type SettingsPatch = Partial<
  Omit<Prisma.UserSettingsUncheckedUpdateInput, 'id' | 'userId' | 'createdAt' | 'updatedAt'>
>

export async function updateSettings(
  userId: string,
  patch: SettingsPatch,
): Promise<void> {
  if (patch.defaultCalendarId) {
    const calendar = await prisma.calendar.findFirst({
      where: { id: String(patch.defaultCalendarId), userId },
      select: { id: true, isReadOnly: true },
    })
    if (!calendar) throw new AppError('That calendar does not exist.', 'not_found', 404)
    if (calendar.isReadOnly) {
      throw new AppError('A read-only calendar cannot be the default.', 'read_only', 400)
    }
  }

  if (Array.isArray(patch.secondaryTimezones)) {
    const invalid = patch.secondaryTimezones.find(
      (zone) => typeof zone !== 'string' || !isValidTimeZone(zone),
    )
    if (invalid) {
      throw new AppError(`"${String(invalid)}" is not a time zone.`, 'invalid_timezone', 400)
    }
  }

  await prisma.userSettings.upsert({
    where: { userId },
    create: { ...(patch as Prisma.UserSettingsUncheckedCreateInput), userId },
    update: patch,
  })

  await recordAudit({
    userId,
    action: 'settings.updated',
    entityType: 'UserSettings',
    metadata: { fields: Object.keys(patch) },
  })
}

export async function updateProfile(
  userId: string,
  patch: { name?: string; timezone?: string; username?: string; locale?: string },
): Promise<void> {
  if (patch.timezone && !isValidTimeZone(patch.timezone)) {
    throw new AppError('That is not a recognised time zone.', 'invalid_timezone', 400)
  }

  if (patch.username) {
    const taken = await prisma.user.findFirst({
      where: { username: patch.username, NOT: { id: userId } },
      select: { id: true },
    })
    if (taken) {
      throw new AppError('That booking name is already taken.', 'username_taken', 409)
    }
  }

  await prisma.user.update({ where: { id: userId }, data: patch })
}

/* -------------------------------------------------------- working hours */

export interface WorkingHoursInput {
  weekday: number
  startMinute: number
  endMinute: number
  enabled: boolean
}

export async function updateWorkingHours(
  userId: string,
  entries: WorkingHoursInput[],
): Promise<void> {
  for (const entry of entries) {
    if (entry.enabled && entry.endMinute <= entry.startMinute) {
      throw new AppError(
        'A working day has to end after it starts.',
        'invalid_hours',
        400,
      )
    }
  }

  await prisma.$transaction(
    entries.map((entry) =>
      prisma.workingHours.upsert({
        where: { userId_weekday: { userId, weekday: entry.weekday } },
        create: { userId, ...entry },
        update: {
          startMinute: entry.startMinute,
          endMinute: entry.endMinute,
          enabled: entry.enabled,
        },
      }),
    ),
  )
}

export async function getWorkingHours(userId: string) {
  const rows = await prisma.workingHours.findMany({
    where: { userId },
    orderBy: { weekday: 'asc' },
  })
  if (rows.length === 7) return rows

  // Fill in any missing days so the settings form always has seven rows.
  const byWeekday = new Map(rows.map((row) => [row.weekday, row]))
  return Array.from({ length: 7 }, (_, weekday) => {
    const existing = byWeekday.get(weekday)
    return (
      existing ?? {
        id: `default-${weekday}`,
        userId,
        weekday,
        startMinute: 9 * 60,
        endMinute: 17 * 60,
        enabled: weekday >= 1 && weekday <= 5,
      }
    )
  })
}

/* --------------------------------------------------------- integrations */

export async function listIntegrations(userId: string): Promise<IntegrationSummary[]> {
  const accounts = await prisma.integrationAccount.findMany({
    where: { userId },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    include: {
      _count: { select: { calendars: true } },
      syncStates: {
        orderBy: { lastSyncedAt: 'desc' },
        take: 1,
      },
    },
  })

  return accounts.map((account) => ({
    id: account.id,
    provider: account.provider,
    email: account.email,
    displayName: account.displayName,
    avatarUrl: account.avatarUrl,
    status: account.status,
    isPrimary: account.isPrimary,
    scopes: account.scopes,
    lastError: account.lastError,
    connectedAt: account.createdAt.toISOString(),
    calendarCount: account._count.calendars,
    lastSyncedAt: account.syncStates[0]?.lastSyncedAt?.toISOString() ?? null,
    syncStatus: account.syncStates[0]?.status ?? null,
  }))
}

/**
 * Disconnects an account: tells the provider to forget us, then removes the
 * local credentials and everything mirrored through them.
 */
export async function disconnectAccount(
  userId: string,
  accountId: string,
): Promise<void> {
  const account = await prisma.integrationAccount.findFirst({
    where: { id: accountId, userId },
  })
  if (!account) throw new AppError('That account is not connected.', 'not_found', 404)

  if (account.provider === 'GOOGLE') {
    await revokeAccount(account)
  }

  // Cascades take the mirrored calendars, their events, the mail references and
  // the sync state with it — disconnecting really does leave nothing behind.
  await prisma.integrationAccount.delete({ where: { id: accountId } })

  await recordAudit({
    userId,
    action: 'integration.disconnected',
    entityType: 'IntegrationAccount',
    entityId: accountId,
    metadata: { provider: account.provider, email: account.email },
  })
}

/* -------------------------------------------------------------- account */

export interface SessionSummary {
  id: string
  userAgent: string | null
  createdAt: string
  lastUsedAt: string
  expiresAt: string
  isCurrent: boolean
}

export async function listSessions(
  userId: string,
  currentSessionId: string,
): Promise<SessionSummary[]> {
  const sessions = await prisma.session.findMany({
    where: { userId },
    orderBy: { lastUsedAt: 'desc' },
  })

  return sessions.map((session) => ({
    id: session.id,
    userAgent: session.userAgent,
    createdAt: session.createdAt.toISOString(),
    lastUsedAt: session.lastUsedAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    isCurrent: session.id === currentSessionId,
  }))
}

export async function revokeSession(userId: string, sessionId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { id: sessionId, userId } })
}

export async function revokeOtherSessions(
  userId: string,
  keepSessionId: string,
): Promise<number> {
  const { count } = await prisma.session.deleteMany({
    where: { userId, NOT: { id: keepSessionId } },
  })
  return count
}

/**
 * Full account deletion. Every table hangs off User with `onDelete: Cascade`,
 * so one delete really does remove everything — and provider access is revoked
 * first, so nothing keeps working after the account is gone.
 */
export async function deleteAccount(userId: string): Promise<void> {
  const accounts = await prisma.integrationAccount.findMany({ where: { userId } })
  for (const account of accounts) {
    if (account.provider === 'GOOGLE') await revokeAccount(account)
  }

  await destroyAllSessions(userId)
  await prisma.user.delete({ where: { id: userId } })
}

/** Everything we hold about a user, as JSON. */
export async function exportUserData(userId: string) {
  const [user, calendars, events, tasks, contacts, meetingTypes, bookings, settings] =
    await Promise.all([
      prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          name: true,
          username: true,
          timezone: true,
          locale: true,
          createdAt: true,
        },
      }),
      prisma.calendar.findMany({ where: { userId } }),
      prisma.event.findMany({
        where: { userId },
        include: { attendees: true, reminders: true, attachments: true },
      }),
      prisma.task.findMany({ where: { userId }, include: { tags: true } }),
      prisma.contact.findMany({ where: { userId } }),
      prisma.meetingType.findMany({ where: { userId }, include: { availability: true } }),
      prisma.booking.findMany({ where: { userId } }),
      prisma.userSettings.findUnique({ where: { userId } }),
    ])

  return {
    exportedAt: new Date().toISOString(),
    user,
    settings,
    calendars,
    events,
    tasks,
    contacts,
    meetingTypes,
    bookings,
    // Credentials are deliberately absent: an export should never carry a token.
    note: 'OAuth tokens are excluded from exports by design.',
  }
}
