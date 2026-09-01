import type { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { AppError, ok, route } from '@/lib/api'
import { assertSameOrigin, requireUser } from '@/lib/auth'
import { enforce } from '@/lib/rate-limit'
import { parseIcs } from '@/lib/ics'
import { dayKeyOf } from '@/lib/datetime'
import { recordAudit } from '@/server/audit'

/** Refuse anything larger than this — an .ics is text, and this is generous. */
const MAX_BYTES = 5 * 1024 * 1024
const MAX_EVENTS = 5000

/**
 * Imports an .ics file into a calendar.
 *
 * Existing events are matched on their UID so re-importing the same file
 * updates rather than duplicates — which is what happens in practice when
 * someone re-exports from another app after making a change.
 */
export const POST = route(async (request: NextRequest) => {
  await assertSameOrigin()
  const user = await requireUser()
  await enforce('import', { limit: 10, windowMs: 60 * 60 * 1000 }, user.id)

  const form = await request.formData()
  const file = form.get('file')
  const calendarId = String(form.get('calendarId') ?? '')

  if (!(file instanceof File)) {
    throw new AppError('Choose an .ics file to import.', 'missing_file', 400)
  }
  if (file.size > MAX_BYTES) {
    throw new AppError('That file is too large to import.', 'file_too_large', 413)
  }

  const calendar = await prisma.calendar.findFirst({
    where: { id: calendarId, userId: user.id },
    select: { id: true, isReadOnly: true, timezone: true },
  })
  if (!calendar) throw new AppError('Pick a calendar to import into.', 'not_found', 404)
  if (calendar.isReadOnly) {
    throw new AppError('That calendar is read-only.', 'read_only', 400)
  }

  const text = await file.text()
  const parsed = parseIcs(text)

  if (parsed.events.length === 0) {
    throw new AppError(
      'No events were found in that file.',
      'no_events',
      422,
    )
  }
  if (parsed.events.length > MAX_EVENTS) {
    throw new AppError(
      `That file holds ${parsed.events.length} events, which is more than one import can take.`,
      'too_many_events',
      413,
    )
  }

  const timezone = calendar.timezone ?? user.timezone
  let created = 0
  let updated = 0

  for (const event of parsed.events) {
    const externalId = `ics:${event.uid}`

    const existing = await prisma.event.findFirst({
      where: { userId: user.id, calendarId: calendar.id, externalId },
      select: { id: true },
    })

    const data = {
      userId: user.id,
      calendarId: calendar.id,
      title: event.summary,
      description: event.description,
      location: event.location,
      startAt: event.start,
      endAt: event.end,
      timezone: event.timezone ?? timezone,
      allDay: event.allDay,
      startDate: event.allDay ? dayKeyOf(event.start, event.timezone ?? timezone) : null,
      endDate: event.allDay ? dayKeyOf(event.end, event.timezone ?? timezone) : null,
      status: event.status,
      transparency: event.transparency,
      recurrenceRule: event.recurrenceRule,
      recurrenceExDates: event.exDates,
      meetingUrl: event.url,
      // Marked as imported so a later sync does not mistake it for a local
      // event that still needs pushing to a provider.
      externalId,
      externalProvider: null,
    }

    if (existing) {
      await prisma.event.update({ where: { id: existing.id }, data })
      updated += 1
    } else {
      const row = await prisma.event.create({ data })
      if (event.attendees.length > 0) {
        await prisma.eventAttendee.createMany({
          data: event.attendees.map((attendee) => ({
            eventId: row.id,
            email: attendee.email,
            name: attendee.name,
          })),
          skipDuplicates: true,
        })
      }
      created += 1
    }
  }

  await recordAudit({
    userId: user.id,
    action: 'calendar.imported',
    entityType: 'Calendar',
    entityId: calendar.id,
    metadata: { created, updated, file: file.name },
  })

  return ok({ created, updated, skipped: parsed.skipped })
})
