import 'server-only'
import { prisma } from '@/lib/db'
import { NotFoundError, AppError } from '@/lib/api'
import { recordAudit } from '@/server/audit'
import type { CalendarSummary } from '@/types/domain'

/**
 * Calendars — the containers events live in, whether created here or mirrored
 * from a connected account. The distinction is a field, not a separate model,
 * so the sidebar, the colour picker and the event editor all treat them alike.
 */

export async function listCalendars(userId: string): Promise<CalendarSummary[]> {
  const rows = await prisma.calendar.findMany({
    where: { userId },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: {
      integrationAccount: { select: { id: true, email: true } },
    },
  })

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    color: row.color,
    description: row.description,
    kind: row.kind,
    isDefault: row.isDefault,
    isVisible: row.isVisible,
    isReadOnly: row.isReadOnly,
    sortOrder: row.sortOrder,
    provider: row.externalProvider,
    accountId: row.integrationAccount?.id ?? null,
    accountEmail: row.integrationAccount?.email ?? null,
  }))
}

export async function createCalendar(
  userId: string,
  input: { name: string; color: string; description?: string | null },
): Promise<CalendarSummary> {
  const count = await prisma.calendar.count({ where: { userId } })
  if (count >= 100) {
    throw new AppError('You have reached the maximum number of calendars.', 'limit', 400)
  }

  const created = await prisma.calendar.create({
    data: {
      userId,
      name: input.name,
      color: input.color,
      description: input.description ?? null,
      sortOrder: count,
    },
    include: { integrationAccount: { select: { id: true, email: true } } },
  })

  await recordAudit({
    userId,
    action: 'calendar.created',
    entityType: 'Calendar',
    entityId: created.id,
    metadata: { name: created.name },
  })

  return {
    id: created.id,
    name: created.name,
    color: created.color,
    description: created.description,
    kind: created.kind,
    isDefault: created.isDefault,
    isVisible: created.isVisible,
    isReadOnly: created.isReadOnly,
    sortOrder: created.sortOrder,
    provider: created.externalProvider,
    accountId: null,
    accountEmail: null,
  }
}

export async function updateCalendar(
  userId: string,
  calendarId: string,
  patch: {
    name?: string
    color?: string
    description?: string | null
    isVisible?: boolean
    sortOrder?: number
    isDefault?: boolean
  },
): Promise<void> {
  const existing = await prisma.calendar.findFirst({
    where: { id: calendarId, userId },
    select: { id: true, externalProvider: true },
  })
  if (!existing) throw new NotFoundError('That calendar')

  // Renaming a mirrored calendar locally would drift from the provider on the
  // next sync, so only presentation is editable there.
  if (existing.externalProvider && (patch.name !== undefined)) {
    throw new AppError(
      'Rename this calendar in the account it comes from.',
      'provider_managed',
      400,
    )
  }

  if (patch.isDefault) {
    await prisma.calendar.updateMany({
      where: { userId, isDefault: true },
      data: { isDefault: false },
    })
  }

  await prisma.calendar.update({ where: { id: calendarId }, data: patch })

  if (patch.isDefault) {
    await prisma.userSettings.updateMany({
      where: { userId },
      data: { defaultCalendarId: calendarId },
    })
  }
}

/** Replaces the whole visibility set — used by "Show only this calendar". */
export async function setVisibility(
  userId: string,
  visibleIds: string[],
): Promise<void> {
  const owned = await prisma.calendar.findMany({
    where: { userId },
    select: { id: true },
  })
  const allowed = new Set(owned.map((c) => c.id))
  const targets = visibleIds.filter((id) => allowed.has(id))

  await prisma.$transaction([
    prisma.calendar.updateMany({ where: { userId }, data: { isVisible: false } }),
    prisma.calendar.updateMany({
      where: { userId, id: { in: targets } },
      data: { isVisible: true },
    }),
  ])
}

export async function deleteCalendar(userId: string, calendarId: string): Promise<void> {
  const calendar = await prisma.calendar.findFirst({
    where: { id: calendarId, userId },
    select: { id: true, isDefault: true, name: true, _count: { select: { events: true } } },
  })
  if (!calendar) throw new NotFoundError('That calendar')
  if (calendar.isDefault) {
    throw new AppError(
      'This is your default calendar. Make another one the default first.',
      'default_calendar',
      400,
    )
  }

  // Events cascade with the calendar; the count goes into the audit entry so
  // the deletion is at least explicable afterwards.
  await prisma.calendar.delete({ where: { id: calendarId } })

  await recordAudit({
    userId,
    action: 'calendar.deleted',
    entityType: 'Calendar',
    entityId: calendarId,
    metadata: { name: calendar.name, eventsRemoved: calendar._count.events },
  })
}

export async function reorderCalendars(
  userId: string,
  orderedIds: string[],
): Promise<void> {
  const owned = await prisma.calendar.findMany({
    where: { userId },
    select: { id: true },
  })
  const allowed = new Set(owned.map((c) => c.id))

  await prisma.$transaction(
    orderedIds
      .filter((id) => allowed.has(id))
      .map((id, index) =>
        prisma.calendar.update({ where: { id }, data: { sortOrder: index } }),
      ),
  )
}

/** The calendar new events land in when the composer has no explicit choice. */
export async function defaultCalendarId(userId: string): Promise<string | null> {
  const settings = await prisma.userSettings.findUnique({
    where: { userId },
    select: { defaultCalendarId: true },
  })
  if (settings?.defaultCalendarId) return settings.defaultCalendarId

  const fallback = await prisma.calendar.findFirst({
    where: { userId, isReadOnly: false },
    orderBy: [{ isDefault: 'desc' }, { sortOrder: 'asc' }],
    select: { id: true },
  })
  return fallback?.id ?? null
}
