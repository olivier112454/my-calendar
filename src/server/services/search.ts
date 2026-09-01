import 'server-only'
import { prisma } from '@/lib/db'
import { dayKeyOf } from '@/lib/datetime'
import type { SearchFilters, SearchResults } from '@/types/search'

/**
 * Global search.
 *
 * Runs in the database, not in the browser: a calendar accumulates years of
 * events and the point of search is to reach the ones that are nowhere near the
 * current view.
 *
 * Matching is currently case-insensitive substring, which PostgreSQL serves
 * from the existing indexes for the leading-anchored cases and by scan
 * otherwise. That is honest for a personal calendar; the shape of this function
 * is what allows a `tsvector` column and a GIN index to be dropped in later
 * without any caller changing.
 */

const PER_TYPE_LIMIT = 6

export async function search(
  userId: string,
  rawQuery: string,
  filters: SearchFilters = {},
): Promise<SearchResults> {
  const query = rawQuery.trim()

  const empty: SearchResults = {
    query,
    events: [],
    tasks: [],
    contacts: [],
    emails: [],
    calendars: [],
    truncated: false,
  }
  if (query.length < 2) return empty

  const wants = (type: string) => !filters.types?.length || filters.types.includes(type as never)
  const contains = { contains: query, mode: 'insensitive' as const }

  const [events, tasks, contacts, emails, calendars] = await Promise.all([
    wants('events')
      ? prisma.event.findMany({
          where: {
            userId,
            OR: [{ title: contains }, { description: contains }, { location: contains }],
            ...(filters.calendarId ? { calendarId: filters.calendarId } : {}),
            ...(filters.from ? { endAt: { gte: new Date(filters.from) } } : {}),
            ...(filters.to ? { startAt: { lte: new Date(filters.to) } } : {}),
            ...(filters.personEmail
              ? { attendees: { some: { email: filters.personEmail.toLowerCase() } } }
              : {}),
          },
          // Most recent first: what you are looking for is usually near now.
          orderBy: { startAt: 'desc' },
          take: PER_TYPE_LIMIT + 1,
          include: {
            calendar: { select: { name: true, color: true } },
          },
        })
      : [],

    wants('tasks')
      ? prisma.task.findMany({
          where: {
            userId,
            OR: [{ title: contains }, { description: contains }, { notes: contains }],
            ...(filters.status ? { status: filters.status as never } : {}),
          },
          orderBy: [{ status: 'asc' }, { dueAt: 'asc' }],
          take: PER_TYPE_LIMIT + 1,
          include: { project: { select: { name: true } } },
        })
      : [],

    wants('contacts')
      ? prisma.contact.findMany({
          where: {
            userId,
            OR: [{ name: contains }, { email: contains }, { organization: contains }],
          },
          orderBy: [{ isFavorite: 'desc' }, { name: 'asc' }],
          take: PER_TYPE_LIMIT + 1,
        })
      : [],

    wants('emails')
      ? prisma.emailReference.findMany({
          where: {
            userId,
            OR: [{ subject: contains }, { fromName: contains }, { fromEmail: contains }],
          },
          orderBy: { receivedAt: 'desc' },
          take: PER_TYPE_LIMIT + 1,
        })
      : [],

    wants('calendars')
      ? prisma.calendar.findMany({
          where: { userId, name: contains },
          orderBy: { sortOrder: 'asc' },
          take: PER_TYPE_LIMIT,
        })
      : [],
  ])

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { timezone: true },
  })

  const truncated =
    events.length > PER_TYPE_LIMIT ||
    tasks.length > PER_TYPE_LIMIT ||
    contacts.length > PER_TYPE_LIMIT ||
    emails.length > PER_TYPE_LIMIT

  return {
    query,
    truncated,
    events: events.slice(0, PER_TYPE_LIMIT).map((event) => ({
      id: event.id,
      title: event.title,
      start: event.startAt.toISOString(),
      end: event.endAt.toISOString(),
      dayKey: dayKeyOf(event.startAt, event.timezone || user.timezone),
      allDay: event.allDay,
      color: event.color ?? event.calendar.color,
      calendarName: event.calendar.name,
      location: event.location,
    })),
    tasks: tasks.slice(0, PER_TYPE_LIMIT).map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      dueAt: task.dueAt?.toISOString() ?? null,
      projectName: task.project?.name ?? null,
    })),
    contacts: contacts.slice(0, PER_TYPE_LIMIT).map((contact) => ({
      id: contact.id,
      name: contact.name,
      email: contact.email,
      organization: contact.organization,
      avatarUrl: contact.avatarUrl,
    })),
    emails: emails.slice(0, PER_TYPE_LIMIT).map((email) => ({
      id: email.id,
      subject: email.subject,
      fromName: email.fromName,
      fromEmail: email.fromEmail,
      receivedAt: email.receivedAt.toISOString(),
      category: email.category,
    })),
    calendars: calendars.map((calendar) => ({
      id: calendar.id,
      name: calendar.name,
      color: calendar.color,
    })),
  }
}
