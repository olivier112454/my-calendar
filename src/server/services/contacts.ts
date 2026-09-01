import 'server-only'
import { prisma } from '@/lib/db'
import { NotFoundError } from '@/lib/api'
import type { ContactSummary, EventOccurrence } from '@/types/domain'
import { contactsProviderFor, accountsFor, grantedCapabilities } from '../providers/registry'
import { listOccurrences } from './events'

/**
 * Contacts.
 *
 * The list is local, whether the rows came from a provider or were typed in.
 * What makes the page worth opening is the second half: for each person, when
 * you last met and when you next will — which needs the calendar, not the
 * address book.
 */

export interface ListContactsOptions {
  search?: string
  favouritesFirst?: boolean
  limit?: number
}

export async function listContacts(
  userId: string,
  options: ListContactsOptions = {},
): Promise<ContactSummary[]> {
  const contacts = await prisma.contact.findMany({
    where: {
      userId,
      ...(options.search
        ? {
            OR: [
              { name: { contains: options.search, mode: 'insensitive' } },
              { email: { contains: options.search, mode: 'insensitive' } },
              { organization: { contains: options.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    orderBy: [
      ...(options.favouritesFirst === false ? [] : [{ isFavorite: 'desc' as const }]),
      { name: 'asc' },
    ],
    take: options.limit ?? 500,
  })

  // Meeting counts come from one grouped query rather than one per contact.
  const emails = contacts
    .map((contact) => contact.email?.toLowerCase())
    .filter((email): email is string => Boolean(email))

  const counts = emails.length
    ? await prisma.eventAttendee.groupBy({
        by: ['email'],
        where: { email: { in: emails }, event: { userId } },
        _count: { _all: true },
      })
    : []
  const countByEmail = new Map(counts.map((row) => [row.email, row._count._all]))

  return contacts.map((contact) => ({
    id: contact.id,
    name: contact.name,
    email: contact.email,
    phone: contact.phone,
    organization: contact.organization,
    jobTitle: contact.jobTitle,
    avatarUrl: contact.avatarUrl,
    notes: contact.notes,
    isFavorite: contact.isFavorite,
    birthday: contact.birthday,
    provider: contact.externalProvider,
    meetingCount: contact.email
      ? (countByEmail.get(contact.email.toLowerCase()) ?? 0)
      : 0,
  }))
}

export interface ContactDetail extends ContactSummary {
  upcoming: EventOccurrence[]
  previous: EventOccurrence[]
  emails: {
    id: string
    subject: string | null
    receivedAt: string
    snippet: string | null
  }[]
}

export async function getContact(
  userId: string,
  contactId: string,
): Promise<ContactDetail> {
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, userId },
  })
  if (!contact) throw new NotFoundError('That contact')

  const email = contact.email?.toLowerCase() ?? null
  const now = new Date()

  const [upcoming, previous, emails] = await Promise.all([
    email
      ? listOccurrences(userId, {
          from: now,
          to: new Date(now.getTime() + 120 * 86_400_000),
          includeDeclined: true,
        }).then((events) =>
          events.filter((event) => event.attendeeCount > 0).slice(0, 50),
        )
      : Promise.resolve([]),
    email
      ? listOccurrences(userId, {
          from: new Date(now.getTime() - 180 * 86_400_000),
          to: now,
          includeDeclined: true,
        }).then((events) =>
          events.filter((event) => event.attendeeCount > 0).reverse().slice(0, 50),
        )
      : Promise.resolve([]),
    email
      ? prisma.emailReference.findMany({
          where: { userId, fromEmail: email },
          orderBy: { receivedAt: 'desc' },
          take: 10,
          select: { id: true, subject: true, receivedAt: true, snippet: true },
        })
      : Promise.resolve([]),
  ])

  // The occurrence list does not carry attendee addresses, so narrow to the
  // events this person is actually on with one extra query.
  const sharedEventIds = email
    ? new Set(
        (
          await prisma.eventAttendee.findMany({
            where: {
              email,
              eventId: { in: [...upcoming, ...previous].map((event) => event.eventId) },
            },
            select: { eventId: true },
          })
        ).map((row) => row.eventId),
      )
    : new Set<string>()

  const counts = email
    ? await prisma.eventAttendee.count({ where: { email, event: { userId } } })
    : 0

  const upcomingShared = upcoming.filter((event) => sharedEventIds.has(event.eventId))
  const previousShared = previous.filter((event) => sharedEventIds.has(event.eventId))

  return {
    id: contact.id,
    name: contact.name,
    email: contact.email,
    phone: contact.phone,
    organization: contact.organization,
    jobTitle: contact.jobTitle,
    avatarUrl: contact.avatarUrl,
    notes: contact.notes,
    isFavorite: contact.isFavorite,
    birthday: contact.birthday,
    provider: contact.externalProvider,
    meetingCount: counts,
    lastMetAt: previousShared[0]?.start ?? null,
    nextMeetingAt: upcomingShared[0]?.start ?? null,
    upcoming: upcomingShared.slice(0, 10),
    previous: previousShared.slice(0, 10),
    emails: emails.map((entry) => ({
      id: entry.id,
      subject: entry.subject,
      receivedAt: entry.receivedAt.toISOString(),
      snippet: entry.snippet,
    })),
  }
}

export async function createContact(
  userId: string,
  input: {
    name: string
    email?: string | null
    phone?: string | null
    organization?: string | null
    jobTitle?: string | null
    notes?: string | null
  },
) {
  return prisma.contact.create({
    data: {
      userId,
      name: input.name,
      email: input.email?.toLowerCase() ?? null,
      phone: input.phone ?? null,
      organization: input.organization ?? null,
      jobTitle: input.jobTitle ?? null,
      notes: input.notes ?? null,
    },
  })
}

export async function updateContact(
  userId: string,
  contactId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { count } = await prisma.contact.updateMany({
    where: { id: contactId, userId },
    data: patch,
  })
  if (count === 0) throw new NotFoundError('That contact')
}

export async function deleteContact(userId: string, contactId: string): Promise<void> {
  const { count } = await prisma.contact.deleteMany({ where: { id: contactId, userId } })
  if (count === 0) throw new NotFoundError('That contact')
}

/**
 * Imports contacts from every connected account that granted access. Matching
 * is on `externalId`, so re-importing updates rather than duplicating.
 */
export async function syncContacts(userId: string): Promise<{ imported: number }> {
  const accounts = (await accountsFor(userId)).filter(
    (account) => grantedCapabilities(account).contacts,
  )

  let imported = 0
  for (const account of accounts) {
    const provider = contactsProviderFor(account)
    let pageToken: string | null = null
    let guard = 0

    do {
      const page = await provider.listContacts(pageToken)
      for (const contact of page.contacts) {
        await prisma.contact.upsert({
          where: {
            integrationAccountId_externalId: {
              integrationAccountId: account.id,
              externalId: contact.externalId,
            },
          },
          create: {
            userId,
            integrationAccountId: account.id,
            externalProvider: account.provider,
            externalId: contact.externalId,
            name: contact.name,
            email: contact.email,
            phone: contact.phone,
            organization: contact.organization,
            jobTitle: contact.jobTitle,
            avatarUrl: contact.avatarUrl,
            birthday: contact.birthday,
          },
          update: {
            name: contact.name,
            email: contact.email,
            phone: contact.phone,
            organization: contact.organization,
            jobTitle: contact.jobTitle,
            avatarUrl: contact.avatarUrl,
            birthday: contact.birthday,
            // Notes and favourites are the user's, not the provider's.
          },
        })
        imported += 1
      }
      pageToken = page.nextPageToken
      guard += 1
    } while (pageToken && guard < 20)
  }

  return { imported }
}

/** Guest suggestions for the composer: people you actually meet, first. */
export async function suggestGuests(userId: string, query: string, limit = 8) {
  const contacts = await prisma.contact.findMany({
    where: {
      userId,
      email: { not: null },
      ...(query
        ? {
            OR: [
              { name: { contains: query, mode: 'insensitive' } },
              { email: { contains: query, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    orderBy: [{ isFavorite: 'desc' }, { name: 'asc' }],
    take: limit,
    select: { name: true, email: true, avatarUrl: true },
  })

  return contacts.map((contact) => ({
    name: contact.name,
    email: contact.email!,
    avatarUrl: contact.avatarUrl,
  }))
}
