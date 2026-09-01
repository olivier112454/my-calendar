import 'server-only'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { AppError, NotFoundError } from '@/lib/api'
import { ForbiddenError } from '@/lib/auth'
import { describeRule, expandOccurrences } from '@/lib/recurrence'
import { dayKeyOf, addDaysToKey, startOfDayUtc } from '@/lib/datetime'
import type {
  EventDetail,
  EventOccurrence,
  LocationData,
} from '@/types/domain'
import type {
  CreateEventInput,
  RecurrenceScope,
  UpdateEventInput,
} from '@/lib/validation/event'
import { recordAudit } from '@/server/audit'

/**
 * Event reads and writes.
 *
 * Every query in this file is scoped by `userId`. There is no code path that
 * loads an event by id alone — that is what stops one account reaching another's
 * data, and it is enforced here rather than in each route.
 */

const eventInclude = {
  calendar: {
    select: {
      id: true,
      name: true,
      color: true,
      isReadOnly: true,
      externalProvider: true,
      integrationAccount: { select: { email: true } },
    },
  },
  category: { select: { id: true, name: true } },
  _count: { select: { attendees: true, reminders: true, attachments: true } },
} satisfies Prisma.EventInclude

type EventRow = Prisma.EventGetPayload<{ include: typeof eventInclude }>

export interface ListOccurrencesOptions {
  /** Inclusive lower bound. */
  from: Date
  /** Exclusive upper bound. */
  to: Date
  calendarIds?: string[]
  kinds?: string[]
  /** When false, events the user has declined are hidden. */
  includeDeclined?: boolean
  /** Restrict to visible calendars only (the sidebar toggles). */
  onlyVisibleCalendars?: boolean
  search?: string
  /** The signed-in user's address, used to resolve their own RSVP. */
  userEmail?: string
}

/**
 * All occurrences overlapping the window.
 *
 * Three sets are combined: plain events, generated instances of series, and the
 * override rows that replace individual instances. An instance is suppressed
 * when the series lists it as an EXDATE or when an override exists for it —
 * otherwise a moved occurrence would appear twice.
 */
export async function listOccurrences(
  userId: string,
  options: ListOccurrencesOptions,
): Promise<EventOccurrence[]> {
  const { from, to } = options
  if (to <= from) return []

  const calendarFilter = await resolveCalendarFilter(userId, options)
  if (calendarFilter.length === 0) return []

  const baseWhere: Prisma.EventWhereInput = {
    userId,
    calendarId: { in: calendarFilter },
    ...(options.kinds?.length ? { kind: { in: options.kinds as never } } : {}),
    ...(options.search
      ? {
          OR: [
            { title: { contains: options.search, mode: 'insensitive' } },
            { description: { contains: options.search, mode: 'insensitive' } },
            { location: { contains: options.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  }

  const [plain, masters] = await Promise.all([
    // Single events, plus overrides, that overlap the window.
    prisma.event.findMany({
      where: {
        ...baseWhere,
        recurrenceRule: null,
        startAt: { lt: to },
        endAt: { gt: from },
      },
      include: eventInclude,
      orderBy: { startAt: 'asc' },
    }),
    // Series masters that started before the window ends. rrule decides which
    // of them actually produce an occurrence inside it.
    prisma.event.findMany({
      where: { ...baseWhere, recurrenceRule: { not: null }, startAt: { lt: to } },
      include: eventInclude,
    }),
  ])

  const overrides = masters.length
    ? await prisma.event.findMany({
        where: { userId, recurringEventId: { in: masters.map((m) => m.id) } },
        include: eventInclude,
      })
    : []

  // originalStartAt of every override, so the generated instance it replaces is
  // skipped even when the override itself was moved outside the window.
  const replaced = new Set<string>()
  for (const override of overrides) {
    if (override.originalStartAt) {
      replaced.add(`${override.recurringEventId}:${override.originalStartAt.getTime()}`)
    }
  }

  const out: EventOccurrence[] = []

  for (const row of plain) {
    // Overrides were already fetched through their master; skip the duplicate.
    if (row.recurringEventId) continue
    out.push(toOccurrence(row, row.startAt, row.endAt, null))
  }

  for (const master of masters) {
    const durationMs = master.endAt.getTime() - master.startAt.getTime()
    const occurrences = expandOccurrences(
      {
        rule: master.recurrenceRule!,
        dtStart: master.startAt,
        durationMs,
        timezone: master.timezone,
        exDates: master.recurrenceExDates,
      },
      from,
      to,
    )

    for (const occurrence of occurrences) {
      if (replaced.has(`${master.id}:${occurrence.originalStart.getTime()}`)) continue
      out.push(
        toOccurrence(
          master,
          occurrence.start,
          occurrence.end,
          occurrence.originalStart,
        ),
      )
    }
  }

  for (const override of overrides) {
    if (override.startAt < to && override.endAt > from) {
      out.push(
        toOccurrence(
          override,
          override.startAt,
          override.endAt,
          override.originalStartAt,
          true,
        ),
      )
    }
  }

  await attachOwnRsvp(userId, out, options.userEmail)

  const filtered = options.includeDeclined
    ? out
    : out.filter((occurrence) => occurrence.myResponse !== 'DECLINED')

  return filtered.sort(
    (a, b) =>
      Date.parse(a.start) - Date.parse(b.start) ||
      (a.allDay === b.allDay ? 0 : a.allDay ? -1 : 1) ||
      a.title.localeCompare(b.title),
  )
}

/**
 * Fills in the user's own RSVP with a single query over the events that
 * actually have attendees, rather than joining attendees into the main read —
 * most events have none, and the join would cost every row for a few.
 */
async function attachOwnRsvp(
  userId: string,
  occurrences: EventOccurrence[],
  userEmail?: string,
): Promise<void> {
  const withGuests = occurrences.filter((o) => o.attendeeCount > 0)
  if (withGuests.length === 0) return

  const email =
    userEmail ??
    (
      await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { email: true },
      })
    ).email

  const rows = await prisma.eventAttendee.findMany({
    where: {
      email: email.toLowerCase(),
      eventId: { in: Array.from(new Set(withGuests.map((o) => o.eventId))) },
    },
    select: { eventId: true, response: true },
  })
  if (rows.length === 0) return

  const byEvent = new Map(rows.map((r) => [r.eventId, r.response]))
  for (const occurrence of withGuests) {
    occurrence.myResponse = byEvent.get(occurrence.eventId) ?? null
  }
}

async function resolveCalendarFilter(
  userId: string,
  options: ListOccurrencesOptions,
): Promise<string[]> {
  const calendars = await prisma.calendar.findMany({
    where: {
      userId,
      ...(options.onlyVisibleCalendars ? { isVisible: true } : {}),
    },
    select: { id: true },
  })
  const owned = new Set(calendars.map((c) => c.id))

  if (!options.calendarIds?.length) return [...owned]
  // Silently drop ids the caller does not own rather than trusting the input.
  return options.calendarIds.filter((id) => owned.has(id))
}

function toOccurrence(
  row: EventRow,
  start: Date,
  end: Date,
  originalStart: Date | null,
  isException = false,
): EventOccurrence {
  const isRecurring = Boolean(row.recurrenceRule) || Boolean(row.recurringEventId)
  const eventId = row.recurringEventId ?? row.id

  return {
    occurrenceId: originalStart
      ? `${eventId}::${originalStart.toISOString()}`
      : row.id,
    eventId: isException ? row.id : eventId,
    occurrenceStart: originalStart?.toISOString() ?? null,

    title: row.title,
    description: row.description,
    location: row.location,
    locationData: (row.locationData as LocationData | null) ?? null,

    start: start.toISOString(),
    end: end.toISOString(),
    timezone: row.timezone,
    allDay: row.allDay,

    kind: row.kind,
    status: row.status,
    visibility: row.visibility,
    transparency: row.transparency,

    calendarId: row.calendarId,
    calendarName: row.calendar.name,
    calendarColor: row.calendar.color,
    color: row.color ?? row.calendar.color,

    categoryId: row.categoryId,
    categoryName: row.category?.name ?? null,

    meetingProvider: row.meetingProvider,
    meetingUrl: row.meetingUrl,
    workingLocation: row.workingLocation,
    travelTimeMinutes: row.travelTimeMinutes,

    isRecurring,
    isException,
    recurrenceRule: row.recurrenceRule,
    recurrenceSummary: describeRule(row.recurrenceRule),

    attendeeCount: row._count.attendees,
    // Filled in by attachOwnRsvp, which resolves them in one batched query.
    myResponse: null,
    hasReminders: row._count.reminders > 0,
    hasAttachments: row._count.attachments > 0,

    taskId: null,
    provider: row.externalProvider,
    accountEmail: row.calendar.integrationAccount?.email ?? null,
    readOnly: row.calendar.isReadOnly,
  }
}

/* -------------------------------------------------------------- detail */

export async function getEventDetail(
  userId: string,
  eventId: string,
  occurrenceStart?: string,
): Promise<EventDetail> {
  const row = await prisma.event.findFirst({
    where: { id: eventId, userId },
    include: {
      ...eventInclude,
      attendees: {
        include: { contact: { select: { id: true, avatarUrl: true } } },
        orderBy: [{ isOrganizer: 'desc' }, { email: 'asc' }],
      },
      reminders: { orderBy: { minutesBefore: 'asc' } },
      attachments: true,
      task: { select: { id: true } },
    },
  })
  if (!row) throw new NotFoundError('That event')

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { email: true },
  })

  // For a series, show the instance the user actually clicked.
  let start = row.startAt
  let end = row.endAt
  if (occurrenceStart && row.recurrenceRule) {
    const instant = new Date(occurrenceStart)
    if (!Number.isNaN(instant.getTime())) {
      const durationMs = row.endAt.getTime() - row.startAt.getTime()
      start = instant
      end = new Date(instant.getTime() + durationMs)
    }
  }

  const base = toOccurrence(
    row as EventRow,
    start,
    end,
    occurrenceStart ? new Date(occurrenceStart) : null,
    Boolean(row.recurringEventId),
  )

  const mine = row.attendees.find(
    (a) => a.email.toLowerCase() === user.email.toLowerCase(),
  )

  return {
    ...base,
    myResponse: mine?.response ?? null,
    taskId: row.task?.id ?? null,
    organizerEmail: row.attendees.find((a) => a.isOrganizer)?.email ?? null,
    attendees: row.attendees.map((a) => ({
      id: a.id,
      email: a.email,
      name: a.name,
      response: a.response,
      isOrganizer: a.isOrganizer,
      isOptional: a.isOptional,
      avatarUrl: a.contact?.avatarUrl ?? null,
      contactId: a.contactId,
    })),
    reminders: row.reminders.map((r) => ({
      id: r.id,
      minutesBefore: r.minutesBefore,
      method: r.method,
    })),
    attachments: row.attachments.map((a) => ({
      id: a.id,
      name: a.name,
      url: a.url,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
    })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/* --------------------------------------------------------------- create */

export async function createEvent(
  userId: string,
  input: CreateEventInput,
): Promise<EventOccurrence> {
  const calendar = await requireWritableCalendar(userId, input.calendarId)
  const categoryId = await requireOwnCategory(userId, input.categoryId)

  const start = new Date(input.start)
  const end = new Date(input.end)

  const created = await prisma.event.create({
    data: {
      userId,
      calendarId: calendar.id,
      title: input.title,
      description: input.description ?? null,
      location: input.location ?? null,
      locationData: (input.locationData ?? undefined) as Prisma.InputJsonValue | undefined,
      startAt: start,
      endAt: end,
      timezone: input.timezone,
      allDay: input.allDay,
      ...allDayKeys(input.allDay, start, end, input.timezone),
      kind: input.kind,
      status: input.status,
      visibility: input.visibility,
      transparency: input.transparency,
      meetingProvider: input.meetingProvider,
      meetingUrl: input.meetingUrl ?? null,
      color: input.color ?? null,
      categoryId,
      workingLocation: input.workingLocation,
      travelTimeMinutes: input.travelTimeMinutes ?? null,
      recurrenceRule: input.recurrenceRule ?? null,
      attendees: input.attendees.length
        ? {
            create: input.attendees.map((a) => ({
              email: a.email.toLowerCase(),
              name: a.name ?? null,
              isOptional: a.isOptional ?? false,
              contactId: a.contactId ?? null,
            })),
          }
        : undefined,
      reminders: input.reminders.length
        ? { create: input.reminders.map((r) => ({ ...r })) }
        : undefined,
    },
    include: eventInclude,
  })

  if (input.taskId) {
    await prisma.task.updateMany({
      where: { id: input.taskId, userId },
      data: { timeBlockId: created.id },
    })
  }

  await recordAudit({
    userId,
    action: 'event.created',
    entityType: 'Event',
    entityId: created.id,
    metadata: { title: created.title, start: created.startAt.toISOString() },
  })

  return toOccurrence(created, created.startAt, created.endAt, null)
}

/* --------------------------------------------------------------- update */

export async function updateEvent(
  userId: string,
  eventId: string,
  input: UpdateEventInput,
): Promise<EventOccurrence> {
  const existing = await prisma.event.findFirst({
    where: { id: eventId, userId },
    include: eventInclude,
  })
  if (!existing) throw new NotFoundError('That event')
  if (existing.calendar.isReadOnly) {
    throw new ForbiddenError('That calendar is read-only')
  }

  if (input.calendarId && input.calendarId !== existing.calendarId) {
    await requireWritableCalendar(userId, input.calendarId)
  }

  // Checked once here, before any branch below writes it: every update path
  // reads `input.categoryId`, and each of them would otherwise trust it.
  if (input.categoryId) await requireOwnCategory(userId, input.categoryId)

  const isSeries = Boolean(existing.recurrenceRule)
  const scope: RecurrenceScope = isSeries ? input.scope : 'all'

  if (scope === 'this') {
    if (!input.occurrenceStart) {
      throw new AppError(
        'Editing a single occurrence needs to know which one.',
        'missing_occurrence',
        400,
      )
    }
    return updateSingleOccurrence(userId, existing, input)
  }

  if (scope === 'following') {
    if (!input.occurrenceStart) {
      throw new AppError(
        'Splitting a series needs to know where to split it.',
        'missing_occurrence',
        400,
      )
    }
    return splitSeries(userId, existing, input)
  }

  const updated = await prisma.event.update({
    where: { id: existing.id },
    data: {
      ...scalarUpdates(input, existing.timezone),
      sequence: { increment: 1 },
      ...(input.attendees ? { attendees: replaceAttendees(input.attendees) } : {}),
      ...(input.reminders ? { reminders: replaceReminders(input.reminders) } : {}),
    },
    include: eventInclude,
  })

  await recordAudit({
    userId,
    action: 'event.updated',
    entityType: 'Event',
    entityId: updated.id,
    metadata: { scope: 'all' },
  })

  return toOccurrence(updated, updated.startAt, updated.endAt, null)
}

/**
 * Detaches one instance from its series: the master gains an EXDATE and a new
 * standalone row takes the instance's place, linked back through
 * `recurringEventId`. This is exactly how iCalendar models an exception, which
 * is what keeps the behaviour identical after a round-trip through Google.
 */
async function updateSingleOccurrence(
  userId: string,
  master: EventRow,
  input: UpdateEventInput,
): Promise<EventOccurrence> {
  const originalStart = new Date(input.occurrenceStart!)
  const durationMs = master.endAt.getTime() - master.startAt.getTime()

  const existingOverride = await prisma.event.findFirst({
    where: { userId, recurringEventId: master.id, originalStartAt: originalStart },
    include: eventInclude,
  })

  const start = input.start ? new Date(input.start) : originalStart
  const end = input.end
    ? new Date(input.end)
    : new Date(start.getTime() + durationMs)

  if (existingOverride) {
    const updated = await prisma.event.update({
      where: { id: existingOverride.id },
      data: {
        ...scalarUpdates(input, existingOverride.timezone),
        startAt: start,
        endAt: end,
        sequence: { increment: 1 },
        ...(input.attendees ? { attendees: replaceAttendees(input.attendees) } : {}),
        ...(input.reminders ? { reminders: replaceReminders(input.reminders) } : {}),
      },
      include: eventInclude,
    })
    return toOccurrence(updated, updated.startAt, updated.endAt, originalStart, true)
  }

  const [, override] = await prisma.$transaction([
    prisma.event.update({
      where: { id: master.id },
      data: {
        recurrenceExDates: { push: originalStart.toISOString() },
        sequence: { increment: 1 },
      },
    }),
    prisma.event.create({
      data: {
        userId,
        calendarId: input.calendarId ?? master.calendarId,
        recurringEventId: master.id,
        originalStartAt: originalStart,
        title: input.title ?? master.title,
        description: input.description ?? master.description,
        location: input.location ?? master.location,
        locationData: (input.locationData ??
          master.locationData ??
          undefined) as Prisma.InputJsonValue | undefined,
        startAt: start,
        endAt: end,
        timezone: input.timezone ?? master.timezone,
        allDay: input.allDay ?? master.allDay,
        kind: input.kind ?? master.kind,
        status: input.status ?? master.status,
        visibility: input.visibility ?? master.visibility,
        transparency: input.transparency ?? master.transparency,
        meetingProvider: input.meetingProvider ?? master.meetingProvider,
        meetingUrl: input.meetingUrl ?? master.meetingUrl,
        color: input.color ?? master.color,
        categoryId: input.categoryId ?? master.categoryId,
        workingLocation: input.workingLocation ?? master.workingLocation,
        travelTimeMinutes: input.travelTimeMinutes ?? master.travelTimeMinutes,
      },
      include: eventInclude,
    }),
  ])

  await recordAudit({
    userId,
    action: 'event.updated',
    entityType: 'Event',
    entityId: master.id,
    metadata: { scope: 'this', occurrence: originalStart.toISOString() },
  })

  return toOccurrence(override, override.startAt, override.endAt, originalStart, true)
}

/**
 * "This and following": caps the original series just before the chosen
 * occurrence and starts a fresh series from it. Past occurrences keep their
 * history; future ones carry the change.
 */
async function splitSeries(
  userId: string,
  master: EventRow,
  input: UpdateEventInput,
): Promise<EventOccurrence> {
  const splitAt = new Date(input.occurrenceStart!)
  const durationMs = master.endAt.getTime() - master.startAt.getTime()
  const start = input.start ? new Date(input.start) : splitAt
  const end = input.end ? new Date(input.end) : new Date(start.getTime() + durationMs)

  const until = new Date(splitAt.getTime() - 60_000)
  const cappedRule = capRuleUntil(master.recurrenceRule!, until)

  // The tail keeps its own EXDATEs — only those at or after the split point.
  const tailExDates = master.recurrenceExDates.filter(
    (iso) => new Date(iso).getTime() >= splitAt.getTime(),
  )
  const headExDates = master.recurrenceExDates.filter(
    (iso) => new Date(iso).getTime() < splitAt.getTime(),
  )

  const [, tail] = await prisma.$transaction([
    prisma.event.update({
      where: { id: master.id },
      data: {
        recurrenceRule: cappedRule,
        recurrenceExDates: headExDates,
        sequence: { increment: 1 },
      },
    }),
    prisma.event.create({
      data: {
        userId,
        calendarId: input.calendarId ?? master.calendarId,
        title: input.title ?? master.title,
        description: input.description ?? master.description,
        location: input.location ?? master.location,
        locationData: (input.locationData ??
          master.locationData ??
          undefined) as Prisma.InputJsonValue | undefined,
        startAt: start,
        endAt: end,
        timezone: input.timezone ?? master.timezone,
        allDay: input.allDay ?? master.allDay,
        kind: input.kind ?? master.kind,
        status: input.status ?? master.status,
        visibility: input.visibility ?? master.visibility,
        transparency: input.transparency ?? master.transparency,
        meetingProvider: input.meetingProvider ?? master.meetingProvider,
        meetingUrl: input.meetingUrl ?? master.meetingUrl,
        color: input.color ?? master.color,
        categoryId: input.categoryId ?? master.categoryId,
        workingLocation: input.workingLocation ?? master.workingLocation,
        travelTimeMinutes: input.travelTimeMinutes ?? master.travelTimeMinutes,
        recurrenceRule: input.recurrenceRule ?? master.recurrenceRule,
        recurrenceExDates: tailExDates,
      },
      include: eventInclude,
    }),
  ])

  await recordAudit({
    userId,
    action: 'event.updated',
    entityType: 'Event',
    entityId: master.id,
    metadata: { scope: 'following', splitAt: splitAt.toISOString() },
  })

  return toOccurrence(tail, tail.startAt, tail.endAt, null)
}

/* --------------------------------------------------------------- delete */

export async function deleteEvent(
  userId: string,
  eventId: string,
  scope: RecurrenceScope = 'all',
  occurrenceStart?: string,
): Promise<void> {
  const existing = await prisma.event.findFirst({
    where: { id: eventId, userId },
    include: { calendar: { select: { isReadOnly: true } } },
  })
  if (!existing) throw new NotFoundError('That event')
  if (existing.calendar.isReadOnly) {
    throw new ForbiddenError('That calendar is read-only')
  }

  const isSeries = Boolean(existing.recurrenceRule)

  if (isSeries && scope === 'this' && occurrenceStart) {
    // Remember the removal explicitly. Without an EXDATE the next expansion
    // simply regenerates the instance and the delete appears not to have worked.
    await prisma.$transaction([
      prisma.event.update({
        where: { id: existing.id },
        data: {
          recurrenceExDates: { push: new Date(occurrenceStart).toISOString() },
          sequence: { increment: 1 },
        },
      }),
      prisma.event.deleteMany({
        where: {
          userId,
          recurringEventId: existing.id,
          originalStartAt: new Date(occurrenceStart),
        },
      }),
    ])
  } else if (isSeries && scope === 'following' && occurrenceStart) {
    const until = new Date(new Date(occurrenceStart).getTime() - 60_000)
    await prisma.$transaction([
      prisma.event.update({
        where: { id: existing.id },
        data: {
          recurrenceRule: capRuleUntil(existing.recurrenceRule!, until),
          sequence: { increment: 1 },
        },
      }),
      prisma.event.deleteMany({
        where: {
          userId,
          recurringEventId: existing.id,
          originalStartAt: { gte: new Date(occurrenceStart) },
        },
      }),
    ])
  } else {
    // Overrides cascade through recurringEventId.
    await prisma.event.delete({ where: { id: existing.id } })
  }

  await recordAudit({
    userId,
    action: 'event.deleted',
    entityType: 'Event',
    entityId: eventId,
    metadata: { scope, title: existing.title },
  })
}

/* ----------------------------------------------------------------- misc */

export async function duplicateEvent(
  userId: string,
  eventId: string,
): Promise<EventOccurrence> {
  const source = await prisma.event.findFirst({
    where: { id: eventId, userId },
    include: { attendees: true, reminders: true },
  })
  if (!source) throw new NotFoundError('That event')
  await requireWritableCalendar(userId, source.calendarId)

  const copy = await prisma.event.create({
    data: {
      userId,
      calendarId: source.calendarId,
      title: `${source.title} (copy)`,
      description: source.description,
      location: source.location,
      locationData: (source.locationData ?? undefined) as Prisma.InputJsonValue | undefined,
      startAt: source.startAt,
      endAt: source.endAt,
      timezone: source.timezone,
      allDay: source.allDay,
      startDate: source.startDate,
      endDate: source.endDate,
      kind: source.kind,
      status: source.status,
      visibility: source.visibility,
      transparency: source.transparency,
      meetingProvider: source.meetingProvider,
      meetingUrl: source.meetingUrl,
      color: source.color,
      categoryId: source.categoryId,
      workingLocation: source.workingLocation,
      travelTimeMinutes: source.travelTimeMinutes,
      recurrenceRule: source.recurrenceRule,
      // A copy starts clean: the original's cancellations do not apply to it.
      attendees: {
        create: source.attendees.map((a) => ({
          email: a.email,
          name: a.name,
          isOptional: a.isOptional,
          contactId: a.contactId,
        })),
      },
      reminders: {
        create: source.reminders.map((r) => ({
          minutesBefore: r.minutesBefore,
          method: r.method,
        })),
      },
    },
    include: eventInclude,
  })

  return toOccurrence(copy, copy.startAt, copy.endAt, null)
}

export async function setRsvp(
  userId: string,
  eventId: string,
  response: 'ACCEPTED' | 'DECLINED' | 'TENTATIVE' | 'NEEDS_ACTION',
  comment?: string,
): Promise<void> {
  const [event, user] = await Promise.all([
    prisma.event.findFirst({ where: { id: eventId, userId }, select: { id: true } }),
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } }),
  ])
  if (!event) throw new NotFoundError('That event')

  await prisma.eventAttendee.upsert({
    where: { eventId_email: { eventId, email: user.email.toLowerCase() } },
    create: {
      eventId,
      email: user.email.toLowerCase(),
      response,
      comment: comment ?? null,
    },
    update: { response, comment: comment ?? null },
  })
}

/* ------------------------------------------------------------- internals */

/**
 * A category id is only usable if it is this user's own.
 *
 * Without this check a crafted request could attach someone else's category to
 * an event, and its name would then be read back on the event — a small but
 * real leak across accounts. Returns null for "no category", which is valid.
 */
async function requireOwnCategory(
  userId: string,
  categoryId: string | null | undefined,
): Promise<string | null> {
  if (!categoryId) return null
  const category = await prisma.category.findFirst({
    where: { id: categoryId, userId },
    select: { id: true },
  })
  if (!category) throw new NotFoundError('That category')
  return category.id
}

async function requireWritableCalendar(userId: string, calendarId: string) {
  const calendar = await prisma.calendar.findFirst({
    where: { id: calendarId, userId },
    select: { id: true, isReadOnly: true, name: true },
  })
  if (!calendar) throw new NotFoundError('That calendar')
  if (calendar.isReadOnly) {
    throw new ForbiddenError(`"${calendar.name}" is read-only`)
  }
  return calendar
}

function scalarUpdates(
  input: UpdateEventInput,
  fallbackTimezone: string,
): Prisma.EventUpdateInput {
  const data: Prisma.EventUpdateInput = {}
  const set = <K extends keyof Prisma.EventUpdateInput>(
    key: K,
    value: Prisma.EventUpdateInput[K] | undefined,
  ) => {
    if (value !== undefined) data[key] = value
  }

  set('title', input.title)
  set('description', input.description)
  set('location', input.location)
  if (input.locationData !== undefined) {
    data.locationData = (input.locationData ?? Prisma.DbNull) as Prisma.InputJsonValue
  }
  if (input.calendarId) data.calendar = { connect: { id: input.calendarId } }
  if (input.start) data.startAt = new Date(input.start)
  if (input.end) data.endAt = new Date(input.end)
  set('timezone', input.timezone)
  set('allDay', input.allDay)
  set('kind', input.kind)
  set('status', input.status)
  set('visibility', input.visibility)
  set('transparency', input.transparency)
  set('meetingProvider', input.meetingProvider)
  set('meetingUrl', input.meetingUrl)
  set('color', input.color)
  if (input.categoryId !== undefined) {
    data.category = input.categoryId
      ? { connect: { id: input.categoryId } }
      : { disconnect: true }
  }
  set('workingLocation', input.workingLocation)
  set('travelTimeMinutes', input.travelTimeMinutes)
  if (input.recurrenceRule !== undefined) data.recurrenceRule = input.recurrenceRule

  if (input.allDay !== undefined && input.start && input.end) {
    Object.assign(
      data,
      allDayKeys(
        input.allDay,
        new Date(input.start),
        new Date(input.end),
        input.timezone ?? fallbackTimezone,
      ),
    )
  }

  return data
}

/**
 * All-day events also store plain dates. Without them a "31 August" birthday
 * read from a different time zone lands on the 30th or the 1st.
 */
function allDayKeys(allDay: boolean, start: Date, end: Date, timezone: string) {
  if (!allDay) return { startDate: null, endDate: null }
  return {
    startDate: dayKeyOf(start, timezone),
    // Exclusive end, per RFC 5545.
    endDate: addDaysToKey(dayKeyOf(new Date(end.getTime() - 1), timezone), 1),
  }
}

function replaceAttendees(
  attendees: NonNullable<UpdateEventInput['attendees']>,
): Prisma.EventAttendeeUpdateManyWithoutEventNestedInput {
  return {
    deleteMany: {},
    create: attendees.map((a) => ({
      email: a.email.toLowerCase(),
      name: a.name ?? null,
      isOptional: a.isOptional ?? false,
      contactId: a.contactId ?? null,
    })),
  }
}

function replaceReminders(
  reminders: NonNullable<UpdateEventInput['reminders']>,
): Prisma.EventReminderUpdateManyWithoutEventNestedInput {
  return {
    deleteMany: {},
    create: reminders.map((r) => ({ minutesBefore: r.minutesBefore, method: r.method })),
  }
}

/** Adds or replaces UNTIL on an RRULE so a series stops at a given instant. */
export function capRuleUntil(rule: string, until: Date): string {
  const stamp = until.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const parts = rule
    .replace(/^RRULE:/i, '')
    .split(';')
    .filter((part) => !/^UNTIL=/i.test(part) && !/^COUNT=/i.test(part))
  parts.push(`UNTIL=${stamp}`)
  return parts.join(';')
}

export { startOfDayUtc }
