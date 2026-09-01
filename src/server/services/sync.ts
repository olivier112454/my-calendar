import 'server-only'
import type { IntegrationAccount, Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { dayKeyOf, addDaysToKey } from '@/lib/datetime'
import { recordAudit } from '@/server/audit'
import { ProviderError, type RemoteEvent, type RemoteEventInput } from '../providers/types'
import { calendarProviderFor, grantedCapabilities } from '../providers/registry'

/**
 * Calendar synchronisation.
 *
 * Direction of truth: the provider owns events that came from it, and this app
 * owns events created here. `externalId` decides which is which. A local event
 * is pushed once and then mirrors back; a remote event is pulled and only
 * pushed again when the user edits it here.
 *
 * Incremental where possible. Google hands back a sync token; we store it per
 * calendar in `SyncState` and pass it next time, so a routine sync transfers
 * only what changed. When the token expires the provider says so and we fall
 * back to a full read of the window — that path is normal, not exceptional.
 *
 * Deliberately bounded: sync covers a window around today rather than all of
 * history. A calendar with fifteen years in it should not cost fifteen years of
 * traffic to stay current.
 */

/** How far back and forward a full read covers. */
const WINDOW_BACK_DAYS = 60
const WINDOW_FORWARD_DAYS = 365

export interface SyncResult {
  accountId: string
  accountEmail: string | null
  calendarsSynced: number
  eventsPulled: number
  eventsPushed: number
  eventsDeleted: number
  errors: { calendar: string; message: string }[]
  finishedAt: string
}

/* ------------------------------------------------------------ calendars */

/**
 * Mirrors the account's calendar list. New remote calendars appear hidden by
 * default: switching on a Google account should not suddenly bury someone's
 * week under six shared calendars they had forgotten about.
 */
export async function syncCalendarList(account: IntegrationAccount): Promise<number> {
  const provider = calendarProviderFor(account)
  const remote = await provider.listCalendars()

  const existing = await prisma.calendar.findMany({
    where: { integrationAccountId: account.id },
    select: { id: true, externalId: true },
  })
  const known = new Set(existing.map((entry) => entry.externalId))

  let count = 0
  for (const calendar of remote) {
    await prisma.calendar.upsert({
      where: {
        integrationAccountId_externalId: {
          integrationAccountId: account.id,
          externalId: calendar.externalId,
        },
      },
      create: {
        userId: account.userId,
        integrationAccountId: account.id,
        externalProvider: account.provider,
        externalId: calendar.externalId,
        name: calendar.name,
        description: calendar.description,
        color: normaliseColor(calendar.color) ?? '#4f46e5',
        timezone: calendar.timezone,
        kind: calendar.isPrimary ? 'PRIMARY' : 'SECONDARY',
        isReadOnly: !calendar.isWritable,
        isVisible: calendar.isPrimary,
        sortOrder: 100 + count,
      },
      update: {
        name: calendar.name,
        description: calendar.description,
        timezone: calendar.timezone,
        isReadOnly: !calendar.isWritable,
        // Colour and visibility are the user's to change locally; a rename in
        // Google should not undo a colour they picked here.
      },
    })
    known.delete(calendar.externalId)
    count += 1
  }

  // Calendars removed remotely go with their events.
  if (known.size > 0) {
    await prisma.calendar.deleteMany({
      where: {
        integrationAccountId: account.id,
        externalId: { in: [...known].filter((id): id is string => id !== null) },
      },
    })
  }

  return count
}

/* --------------------------------------------------------------- events */

export async function syncAccount(account: IntegrationAccount): Promise<SyncResult> {
  const result: SyncResult = {
    accountId: account.id,
    accountEmail: account.email,
    calendarsSynced: 0,
    eventsPulled: 0,
    eventsPushed: 0,
    eventsDeleted: 0,
    errors: [],
    finishedAt: new Date().toISOString(),
  }

  if (!grantedCapabilities(account).calendar) {
    result.errors.push({
      calendar: '—',
      message: 'This account has not granted calendar access.',
    })
    return result
  }

  await setSyncState(account.id, 'calendars', { status: 'SYNCING' })

  try {
    result.calendarsSynced = await syncCalendarList(account)
    await setSyncState(account.id, 'calendars', {
      status: 'OK',
      lastSyncedAt: new Date(),
      lastError: null,
    })
  } catch (error) {
    const message = describe(error)
    await setSyncState(account.id, 'calendars', { status: 'FAILED', lastError: message })
    result.errors.push({ calendar: 'calendar list', message })
    return result
  }

  const calendars = await prisma.calendar.findMany({
    where: { integrationAccountId: account.id },
  })

  for (const calendar of calendars) {
    if (!calendar.externalId) continue
    try {
      const pushed = await pushLocalChanges(account, calendar)
      const pulled = await pullRemoteChanges(account, calendar)
      result.eventsPushed += pushed
      result.eventsPulled += pulled.upserted
      result.eventsDeleted += pulled.deleted
    } catch (error) {
      result.errors.push({ calendar: calendar.name, message: describe(error) })
    }
  }

  await prisma.integrationAccount.update({
    where: { id: account.id },
    data: {
      status: result.errors.length > 0 ? account.status : 'ACTIVE',
      lastError: result.errors[0]?.message ?? null,
    },
  })

  await recordAudit({
    userId: account.userId,
    action: result.errors.length > 0 ? 'sync.failed' : 'sync.completed',
    entityType: 'IntegrationAccount',
    entityId: account.id,
    metadata: {
      pulled: result.eventsPulled,
      pushed: result.eventsPushed,
      deleted: result.eventsDeleted,
      errors: result.errors.length,
    },
  })

  result.finishedAt = new Date().toISOString()
  return result
}

/** Pulls remote changes into the local mirror. */
async function pullRemoteChanges(
  account: IntegrationAccount,
  calendar: { id: string; externalId: string | null; name: string; timezone: string | null },
): Promise<{ upserted: number; deleted: number }> {
  const provider = calendarProviderFor(account)
  const resource = `calendar:${calendar.externalId}`
  const state = await prisma.syncState.findUnique({
    where: { integrationAccountId_resource: { integrationAccountId: account.id, resource } },
  })

  await setSyncState(account.id, resource, { status: 'SYNCING' })

  const today = dayKeyOf(new Date(), calendar.timezone ?? 'UTC')
  const timeMin = new Date(`${addDaysToKey(today, -WINDOW_BACK_DAYS)}T00:00:00Z`)
  const timeMax = new Date(`${addDaysToKey(today, WINDOW_FORWARD_DAYS)}T00:00:00Z`)

  let syncToken = state?.syncToken ?? null
  let pageToken: string | null = null
  let upserted = 0
  let deleted = 0
  let guard = 0

  try {
    do {
      const page = await provider.listEvents({
        calendarExternalId: calendar.externalId!,
        syncToken,
        pageToken,
        timeMin,
        timeMax,
      })

      if (page.resyncRequired) {
        // The token was too old. Drop it, clear what we mirrored for this
        // calendar, and start again from a full window read.
        await prisma.event.deleteMany({
          where: {
            calendarId: calendar.id,
            externalId: { not: null },
          },
        })
        syncToken = null
        pageToken = null
        guard += 1
        if (guard > 2) break
        continue
      }

      for (const remote of page.events) {
        if (remote.deleted) {
          const { count } = await prisma.event.deleteMany({
            where: { integrationAccountId: account.id, externalId: remote.externalId },
          })
          deleted += count
        } else {
          await upsertRemoteEvent(account, calendar.id, remote)
          upserted += 1
        }
      }

      pageToken = page.nextPageToken
      if (page.nextSyncToken) {
        await setSyncState(account.id, resource, {
          syncToken: page.nextSyncToken,
          status: 'OK',
          lastSyncedAt: new Date(),
          lastError: null,
          itemsSynced: upserted,
        })
      }
      guard += 1
    } while (pageToken && guard < 25)

    await setSyncState(account.id, resource, {
      status: 'OK',
      lastSyncedAt: new Date(),
      lastError: null,
    })
  } catch (error) {
    const message = describe(error)
    await setSyncState(account.id, resource, { status: 'FAILED', lastError: message })
    throw error
  }

  return { upserted, deleted }
}

async function upsertRemoteEvent(
  account: IntegrationAccount,
  calendarId: string,
  remote: RemoteEvent,
): Promise<void> {
  // A modified occurrence needs its master's local id, not the provider's.
  let recurringEventId: string | null = null
  if (remote.recurringEventExternalId) {
    const master = await prisma.event.findFirst({
      where: {
        integrationAccountId: account.id,
        externalId: remote.recurringEventExternalId,
      },
      select: { id: true },
    })
    recurringEventId = master?.id ?? null
  }

  const data = {
    userId: account.userId,
    calendarId,
    title: remote.title,
    description: remote.description,
    location: remote.location,
    startAt: remote.start,
    endAt: remote.end,
    timezone: remote.timezone,
    allDay: remote.allDay,
    startDate: remote.allDay ? dayKeyOf(remote.start, remote.timezone) : null,
    endDate: remote.allDay ? dayKeyOf(remote.end, remote.timezone) : null,
    status: remote.status,
    visibility: remote.visibility,
    transparency: remote.transparency,
    meetingUrl: remote.meetingUrl,
    meetingProvider: remote.meetingProvider,
    color: remote.color,
    recurrenceRule: remote.recurrenceRule,
    recurrenceExDates: remote.recurrenceExDates,
    recurringEventId,
    originalStartAt: remote.originalStart,
    externalProvider: account.provider,
    externalId: remote.externalId,
    externalEtag: remote.etag,
    integrationAccountId: account.id,
  } satisfies Prisma.EventUncheckedCreateInput

  const event = await prisma.event.upsert({
    where: {
      integrationAccountId_externalId: {
        integrationAccountId: account.id,
        externalId: remote.externalId,
      },
    },
    create: data,
    update: data,
    select: { id: true },
  })

  // Attendees and reminders are replaced wholesale: they are small, and
  // diffing them would be more code than it saves.
  await prisma.$transaction([
    prisma.eventAttendee.deleteMany({ where: { eventId: event.id } }),
    prisma.eventReminder.deleteMany({ where: { eventId: event.id } }),
    ...(remote.attendees.length
      ? [
          prisma.eventAttendee.createMany({
            data: remote.attendees
              .filter((attendee) => attendee.email)
              .map((attendee) => ({
                eventId: event.id,
                email: attendee.email,
                name: attendee.name,
                isOrganizer: attendee.isOrganizer,
                isOptional: attendee.isOptional,
                response: attendee.response,
              })),
            skipDuplicates: true,
          }),
        ]
      : []),
    ...(remote.reminders.length
      ? [
          prisma.eventReminder.createMany({
            data: remote.reminders.map((reminder) => ({
              eventId: event.id,
              minutesBefore: reminder.minutesBefore,
              method: reminder.method,
            })),
            skipDuplicates: true,
          }),
        ]
      : []),
  ])
}

/**
 * Pushes events created or edited here into the provider.
 *
 * A local event is one with no `externalId` on a provider-backed calendar; once
 * pushed it gains one and behaves like any other mirrored event afterwards.
 */
async function pushLocalChanges(
  account: IntegrationAccount,
  calendar: { id: string; externalId: string | null; isReadOnly: boolean },
): Promise<number> {
  if (calendar.isReadOnly || !calendar.externalId) return 0

  const provider = calendarProviderFor(account)
  const pending = await prisma.event.findMany({
    where: { calendarId: calendar.id, externalId: null },
    include: { attendees: true, reminders: true },
    take: 100,
  })

  let pushed = 0
  for (const event of pending) {
    try {
      const remote = await provider.createEvent(
        calendar.externalId,
        toRemoteInput(event),
      )
      await prisma.event.update({
        where: { id: event.id },
        data: {
          externalId: remote.externalId,
          externalEtag: remote.etag,
          externalProvider: account.provider,
          integrationAccountId: account.id,
          // Google mints the Meet link; take it back so the UI can show it.
          meetingUrl: remote.meetingUrl ?? event.meetingUrl,
          meetingProvider: remote.meetingUrl
            ? remote.meetingProvider
            : event.meetingProvider,
        },
      })
      pushed += 1
    } catch (error) {
      console.error('[sync] could not push event', event.id, describe(error))
      // One rejected event must not stop the rest of the batch.
    }
  }

  return pushed
}

type PushableEvent = Prisma.EventGetPayload<{
  include: { attendees: true; reminders: true }
}>

function toRemoteInput(event: PushableEvent): RemoteEventInput {
  return {
    title: event.title,
    description: event.description,
    location: event.location,
    start: event.startAt,
    end: event.endAt,
    timezone: event.timezone,
    allDay: event.allDay,
    status: event.status,
    visibility: event.visibility,
    transparency: event.transparency,
    recurrenceRule: event.recurrenceRule,
    attendees: event.attendees.map((attendee) => ({
      email: attendee.email,
      name: attendee.name,
      isOptional: attendee.isOptional,
    })),
    reminders: event.reminders.map((reminder) => ({
      minutesBefore: reminder.minutesBefore,
      method: reminder.method,
    })),
    meetingProvider:
      event.meetingProvider === 'PHONE' || event.meetingProvider === 'IN_PERSON'
        ? 'NONE'
        : event.meetingProvider,
    meetingUrl: event.meetingUrl,
    color: event.color,
  }
}

/**
 * Propagates a local edit to the provider. Called after a user change rather
 * than during a sync pass, so an edit shows up in Google immediately instead of
 * waiting for the next run.
 */
export async function pushEventUpdate(userId: string, eventId: string): Promise<void> {
  const event = await prisma.event.findFirst({
    where: { id: eventId, userId, externalId: { not: null } },
    include: {
      attendees: true,
      reminders: true,
      calendar: { select: { externalId: true, isReadOnly: true } },
      integrationAccount: true,
    },
  })
  if (!event?.integrationAccount || !event.calendar.externalId) return
  if (event.calendar.isReadOnly) return

  try {
    const provider = calendarProviderFor(event.integrationAccount)
    const remote = await provider.updateEvent(
      event.calendar.externalId,
      event.externalId!,
      toRemoteInput(event),
    )
    await prisma.event.update({
      where: { id: event.id },
      data: { externalEtag: remote.etag },
    })
  } catch (error) {
    // A failed push is logged but never fails the user's edit: their change is
    // saved locally and the next full sync reconciles it.
    console.error('[sync] could not push update', eventId, describe(error))
  }
}

export async function pushEventDelete(
  account: IntegrationAccount,
  calendarExternalId: string,
  externalId: string,
): Promise<void> {
  try {
    await calendarProviderFor(account).deleteEvent(calendarExternalId, externalId)
  } catch (error) {
    console.error('[sync] could not push delete', externalId, describe(error))
  }
}

/* ---------------------------------------------------------------- state */

async function setSyncState(
  integrationAccountId: string,
  resource: string,
  patch: Partial<{
    syncToken: string | null
    status: 'IDLE' | 'SYNCING' | 'OK' | 'FAILED'
    lastSyncedAt: Date
    lastError: string | null
    itemsSynced: number
  }>,
): Promise<void> {
  await prisma.syncState.upsert({
    where: { integrationAccountId_resource: { integrationAccountId, resource } },
    create: { integrationAccountId, resource, ...patch },
    update: patch,
  })
}

export async function syncStatusFor(userId: string) {
  const rows = await prisma.syncState.findMany({
    where: { integrationAccount: { userId } },
    include: { integrationAccount: { select: { id: true, email: true, provider: true } } },
    orderBy: { updatedAt: 'desc' },
  })

  return rows.map((row) => ({
    accountId: row.integrationAccountId,
    accountEmail: row.integrationAccount.email,
    provider: row.integrationAccount.provider,
    resource: row.resource,
    status: row.status,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    lastError: row.lastError,
  }))
}

function describe(error: unknown): string {
  if (error instanceof ProviderError) return error.message
  if (error instanceof Error) return error.message
  return 'Something went wrong during sync.'
}

export { normaliseColor }

/** Providers hand back colours in several formats; the UI wants one. */
function normaliseColor(value: string | null | undefined): string | null {
  if (!value) return null
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase()
  if (/^#[0-9a-f]{3}$/i.test(value)) {
    const [, r, g, b] = value.match(/^#(.)(.)(.)$/i)!
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase()
  }
  return null
}
