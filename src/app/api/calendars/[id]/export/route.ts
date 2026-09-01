import type { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { NotFoundError, route } from '@/lib/api'
import { requireUser } from '@/lib/auth'
import { toIcs, type IcsEvent } from '@/lib/ics'
import { slugify } from '@/lib/utils'

/**
 * Exports one calendar as an .ics file.
 *
 * Series are exported as their master plus RRULE rather than expanded, so the
 * file stays small and re-importing it anywhere reconstructs the same series.
 */
export const GET = route(
  async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const user = await requireUser()
    const { id } = await params

    const calendar = await prisma.calendar.findFirst({
      where: { id, userId: user.id },
      select: { id: true, name: true, timezone: true },
    })
    if (!calendar) throw new NotFoundError('That calendar')

    const events = await prisma.event.findMany({
      where: {
        calendarId: calendar.id,
        userId: user.id,
        // Overrides travel with their master through RRULE/EXDATE.
        recurringEventId: null,
      },
      include: {
        attendees: { select: { email: true, name: true, isOrganizer: true } },
      },
      orderBy: { startAt: 'asc' },
    })

    const payload: IcsEvent[] = events.map((event) => ({
      uid: `${event.id}@dayflow`,
      summary: event.title,
      description: event.description,
      location: event.location,
      start: event.startAt,
      end: event.endAt,
      allDay: event.allDay,
      timezone: event.timezone,
      recurrenceRule: event.recurrenceRule,
      exDates: event.recurrenceExDates,
      status: event.status,
      transparency: event.transparency,
      organizer: event.attendees.find((a) => a.isOrganizer)?.email ?? null,
      attendees: event.attendees
        .filter((a) => !a.isOrganizer)
        .map((a) => ({ email: a.email, name: a.name })),
      url: event.meetingUrl,
    }))

    const body = toIcs(payload, { calendarName: calendar.name })
    const filename = `${slugify(calendar.name) || 'calendar'}.ics`

    return new Response(body, {
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  },
)
