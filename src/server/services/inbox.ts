import 'server-only'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { NotFoundError } from '@/lib/api'
import type { EmailSummary, EventDraft } from '@/types/domain'
import { mailProviderFor, mailAccountsFor } from '../providers/registry'
import { emailExtractor, SUGGESTION_THRESHOLD } from './email-extractor'

/**
 * The Inbox.
 *
 * Privacy shapes the design here more than anything else. Message bodies are
 * never fetched or stored; what persists is the provider's message id, the
 * handful of header fields needed to render a row, and the extraction result.
 * Disconnecting the account removes all of it, and nothing of substance is left
 * behind in the meantime.
 */

/** How far back the inbox looks. Beyond this, mail is not calendar material. */
const WINDOW_DAYS = 30

export async function refreshInbox(
  userId: string,
  timezone: string,
): Promise<{ imported: number; accounts: number }> {
  const accounts = await mailAccountsFor(userId)
  if (accounts.length === 0) return { imported: 0, accounts: 0 }

  const after = new Date(Date.now() - WINDOW_DAYS * 86_400_000)
  let imported = 0

  for (const account of accounts) {
    const provider = mailProviderFor(account)
    const page = await provider.listMessages({ after, maxResults: 40 })

    for (const message of page.messages) {
      const result = await emailExtractor.extract(message, timezone)

      const data = {
        userId,
        integrationAccountId: account.id,
        provider: account.provider,
        messageId: message.externalId,
        threadId: message.threadId,
        subject: message.subject,
        fromName: message.fromName,
        fromEmail: message.fromEmail,
        snippet: message.snippet,
        receivedAt: message.receivedAt,
        isUnread: message.isUnread,
        isImportant: message.isImportant,
        category: result.category,
        extraction: (result.draft ?? undefined) as Prisma.InputJsonValue | undefined,
        confidence: result.confidence,
      }

      await prisma.emailReference.upsert({
        where: {
          integrationAccountId_messageId: {
            integrationAccountId: account.id,
            messageId: message.externalId,
          },
        },
        create: data,
        update: {
          // Read state and importance can change; a user's dismissal must not.
          isUnread: message.isUnread,
          isImportant: message.isImportant,
          category: result.category,
          extraction: data.extraction,
          confidence: result.confidence,
          // Refreshed too, though a sent message's headers never change: a row
          // stored while the provider was returning them wrongly would keep the
          // gap forever otherwise, and this makes the next sync repair it.
          subject: message.subject,
          fromName: message.fromName,
          fromEmail: message.fromEmail,
          snippet: message.snippet,
        },
      })
      imported += 1
    }
  }

  // Anything older than the window is dropped rather than accumulated.
  await prisma.emailReference.deleteMany({
    where: { userId, receivedAt: { lt: new Date(Date.now() - WINDOW_DAYS * 86_400_000) } },
  })

  return { imported, accounts: accounts.length }
}

export interface ListInboxOptions {
  category?: string
  /** Only rows the extractor is confident enough about to suggest. */
  suggestionsOnly?: boolean
  unreadOnly?: boolean
  includeDismissed?: boolean
  search?: string
  limit?: number
}

export async function listInbox(
  userId: string,
  options: ListInboxOptions = {},
): Promise<EmailSummary[]> {
  const rows = await prisma.emailReference.findMany({
    where: {
      userId,
      ...(options.category ? { category: options.category as never } : {}),
      ...(options.unreadOnly ? { isUnread: true } : {}),
      ...(options.includeDismissed ? {} : { dismissedAt: null }),
      ...(options.suggestionsOnly
        ? { confidence: { gte: SUGGESTION_THRESHOLD }, linkedEventId: null }
        : {}),
      ...(options.search
        ? {
            OR: [
              { subject: { contains: options.search, mode: 'insensitive' } },
              { fromName: { contains: options.search, mode: 'insensitive' } },
              { snippet: { contains: options.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    orderBy: { receivedAt: 'desc' },
    take: options.limit ?? 100,
    include: { integrationAccount: { select: { email: true } } },
  })

  return rows.map((row) => ({
    id: row.id,
    messageId: row.messageId,
    threadId: row.threadId,
    subject: row.subject,
    fromName: row.fromName,
    fromEmail: row.fromEmail,
    snippet: row.snippet,
    receivedAt: row.receivedAt.toISOString(),
    isUnread: row.isUnread,
    isImportant: row.isImportant,
    category: row.category,
    confidence: row.confidence,
    accountEmail: row.integrationAccount.email,
    dismissed: row.dismissedAt !== null,
    linkedEventId: row.linkedEventId,
    extraction:
      row.confidence >= SUGGESTION_THRESHOLD
        ? ((row.extraction as EventDraft | null) ?? null)
        : null,
  }))
}

export async function getInboxItem(
  userId: string,
  id: string,
): Promise<EmailSummary> {
  const [row] = await listInbox(userId, { includeDismissed: true, limit: 1000 })
    .then((rows) => rows.filter((entry) => entry.id === id))
  if (!row) throw new NotFoundError('That message')
  return row
}

/** Hides a suggestion without touching the message in the user's mailbox. */
export async function dismissSuggestion(userId: string, id: string): Promise<void> {
  const { count } = await prisma.emailReference.updateMany({
    where: { id, userId },
    data: { dismissedAt: new Date() },
  })
  if (count === 0) throw new NotFoundError('That message')
}

export async function undismissSuggestion(userId: string, id: string): Promise<void> {
  await prisma.emailReference.updateMany({
    where: { id, userId },
    data: { dismissedAt: null },
  })
}

/** Records that an event was created from a message, so it stops being offered. */
export async function linkToEvent(
  userId: string,
  id: string,
  eventId: string,
): Promise<void> {
  await prisma.emailReference.updateMany({
    where: { id, userId },
    data: { linkedEventId: eventId },
  })
}

/** Counts for the sidebar badge and the Inbox tabs. */
export async function inboxCounts(userId: string) {
  const [suggestions, unread, total] = await Promise.all([
    prisma.emailReference.count({
      where: {
        userId,
        dismissedAt: null,
        linkedEventId: null,
        confidence: { gte: SUGGESTION_THRESHOLD },
      },
    }),
    prisma.emailReference.count({ where: { userId, isUnread: true } }),
    prisma.emailReference.count({ where: { userId } }),
  ])
  return { suggestions, unread, total }
}

export { SUGGESTION_THRESHOLD }
