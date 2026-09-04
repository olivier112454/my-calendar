import 'server-only'
import type { IntegrationAccount } from '@prisma/client'
import {
  ProviderError,
  type ListMessagesOptions,
  type MailProvider,
  type MessagePage,
  type RemoteMessage,
} from '../types'
import { GMAIL_API, googleFetch } from './client'

/**
 * Gmail, read-only and metadata-first.
 *
 * Every read uses `format=metadata` with an explicit header allow-list, so the
 * message body is never transferred, never held in memory, and never stored.
 * The snippet Gmail returns alongside is enough to recognise a reservation or a
 * flight, and that is the whole purpose here.
 *
 * The default query is narrow for the same reason: the app looks at recent mail
 * in the primary inbox, not at an entire mailbox.
 */

const METADATA_HEADERS = ['Subject', 'From', 'To', 'Date']

/**
 * What we ask Gmail for by default: recent, in the inbox, and skipping the
 * categories that never contain an appointment.
 */
const DEFAULT_QUERY =
  'in:inbox newer_than:30d -category:promotions -category:social -category:forums'

interface GmailMessage {
  id: string
  threadId?: string
  labelIds?: string[]
  snippet?: string
  internalDate?: string
  payload?: {
    headers?: { name?: string; value?: string }[]
    parts?: { mimeType?: string; filename?: string }[]
    mimeType?: string
  }
}

export class GmailProvider implements MailProvider {
  readonly provider = 'GOOGLE' as const

  constructor(readonly account: IntegrationAccount) {}

  async listMessages(options: ListMessagesOptions = {}): Promise<MessagePage> {
    const query = options.query ?? DEFAULT_QUERY

    const list = await googleFetch<{
      messages?: { id: string; threadId: string }[]
      nextPageToken?: string
    }>(this.account, `${GMAIL_API}/users/me/messages`, {
      query: {
        q: options.after
          ? `${query} after:${Math.floor(options.after.getTime() / 1000)}`
          : query,
        maxResults: options.maxResults ?? 40,
        pageToken: options.pageToken ?? undefined,
      },
    })

    const ids = (list.messages ?? []).map((entry) => entry.id)
    const messages = await this.hydrate(ids)

    return {
      messages,
      nextPageToken: list.nextPageToken ?? null,
      // Gmail's incremental API is history-based and needs a stored historyId;
      // for a 30-day window a bounded re-read is simpler and just as cheap.
      nextSyncToken: null,
      resyncRequired: false,
    }
  }

  async getMessage(externalId: string): Promise<RemoteMessage | null> {
    try {
      const message = await googleFetch<GmailMessage>(
        this.account,
        `${GMAIL_API}/users/me/messages/${encodeURIComponent(externalId)}`,
        { query: { format: 'metadata', metadataHeaders: METADATA_HEADERS } },
      )
      return this.toRemoteMessage(message)
    } catch (error) {
      if (error instanceof ProviderError && error.code === 'not_found') return null
      throw error
    }
  }

  async searchMessages(query: string, maxResults = 20): Promise<RemoteMessage[]> {
    const page = await this.listMessages({ query, maxResults })
    return page.messages
  }

  async getThread(threadId: string): Promise<RemoteMessage[]> {
    const thread = await googleFetch<{ messages?: GmailMessage[] }>(
      this.account,
      `${GMAIL_API}/users/me/threads/${encodeURIComponent(threadId)}`,
      { query: { format: 'metadata' } },
    )
    return (thread.messages ?? []).map((message) => this.toRemoteMessage(message))
  }

  webUrl(externalId: string): string {
    const account = this.account.email ? `?authuser=${encodeURIComponent(this.account.email)}` : ''
    return `https://mail.google.com/mail/u/0/#inbox/${externalId}${account}`
  }

  /* ------------------------------------------------------------ helpers */

  /**
   * Fetches metadata for a batch of ids. Gmail has no metadata list endpoint,
   * so this is one request per message — bounded by the page size and run with
   * limited concurrency so a page does not open forty sockets at once.
   */
  private async hydrate(ids: string[]): Promise<RemoteMessage[]> {
    const out: RemoteMessage[] = []
    const CONCURRENCY = 6

    for (let index = 0; index < ids.length; index += CONCURRENCY) {
      const batch = ids.slice(index, index + CONCURRENCY)
      const results = await Promise.all(
        batch.map((id) =>
          googleFetch<GmailMessage>(
            this.account,
            `${GMAIL_API}/users/me/messages/${encodeURIComponent(id)}`,
            {
              query: {
                format: 'metadata',
                metadataHeaders: METADATA_HEADERS,
              },
            },
          ).catch(() => null),
        ),
      )
      for (const message of results) {
        if (message) out.push(this.toRemoteMessage(message))
      }
    }

    return out
  }

  private toRemoteMessage(message: GmailMessage): RemoteMessage {
    const headers = new Map(
      (message.payload?.headers ?? []).map((header) => [
        (header.name ?? '').toLowerCase(),
        header.value ?? '',
      ]),
    )

    const from = parseAddress(headers.get('from') ?? '')
    const to = (headers.get('to') ?? '')
      .split(',')
      .map((entry) => parseAddress(entry).email)
      .filter((email): email is string => Boolean(email))

    const labels = message.labelIds ?? []

    return {
      externalId: message.id,
      threadId: message.threadId ?? null,
      subject: headers.get('subject') || null,
      fromName: from.name,
      fromEmail: from.email,
      toEmails: to,
      snippet: decodeEntities(message.snippet ?? '') || null,
      receivedAt: message.internalDate
        ? new Date(Number(message.internalDate))
        : new Date(headers.get('date') ?? Date.now()),
      isUnread: labels.includes('UNREAD'),
      isImportant: labels.includes('IMPORTANT') || labels.includes('STARRED'),
      labels,
      hasCalendarAttachment: (message.payload?.parts ?? []).some(
        (part) =>
          part.mimeType === 'text/calendar' ||
          (part.filename ?? '').toLowerCase().endsWith('.ics'),
      ),
    }
  }
}

/** `"Emma de Vries" <emma@example.com>` -> name and address. */
function parseAddress(raw: string): { name: string | null; email: string | null } {
  const angled = raw.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/)
  if (angled) {
    return {
      name: angled[1]?.trim() || null,
      email: angled[2]?.trim().toLowerCase() || null,
    }
  }
  const bare = raw.trim().toLowerCase()
  return { name: null, email: /@/.test(bare) ? bare : null }
}

/** Gmail snippets arrive HTML-escaped. */
function decodeEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

export { DEFAULT_QUERY }
