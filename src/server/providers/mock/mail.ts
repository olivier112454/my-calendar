import 'server-only'
import type { IntegrationAccount } from '@prisma/client'
import type {
  ListMessagesOptions,
  MailProvider,
  MessagePage,
  RemoteMessage,
} from '../types'

/**
 * Sample mailbox.
 *
 * Used only when the environment explicitly allows demo data and no Google
 * credentials are configured, so the Inbox page and the event extractor can be
 * developed and reviewed without connecting a real account.
 *
 * The messages are chosen to exercise the extractor: a meeting proposal, a
 * flight, a restaurant booking, a deadline, a calendar invitation, and two that
 * contain no appointment at all — because a suggestion engine that fires on
 * everything is worse than none.
 */

interface Template {
  subject: string
  fromName: string
  fromEmail: string
  snippet: string
  hoursAgo: number
  unread?: boolean
  important?: boolean
  invite?: boolean
}

function templates(): Template[] {
  return [
    {
      subject: 'Meeting next Tuesday?',
      fromName: 'John Smith',
      fromEmail: 'john.smith@northwind.example',
      snippet:
        'Could we meet next Tuesday at 14:00 to go through the mooring results? Happy to come to your office in Arnhem. It should take about an hour.',
      hoursAgo: 2,
      unread: true,
      important: true,
    },
    {
      subject: 'Your flight Amsterdam → Rome',
      fromName: 'KLM',
      fromEmail: 'noreply@klm.example',
      snippet:
        'Booking confirmed. KL1601 departs Amsterdam Schiphol on 14 October at 09:25 and arrives Rome Fiumicino at 11:45. Check-in opens 30 hours before departure.',
      hoursAgo: 5,
      unread: true,
    },
    {
      subject: 'Reservation confirmed — Fratelli',
      fromName: 'Fratelli Arnhem',
      fromEmail: 'reservations@fratelli.example',
      snippet:
        'We look forward to seeing you. Table for 4 on Friday at 19:30, Korenmarkt 12, Arnhem. Please let us know if your plans change.',
      hoursAgo: 8,
    },
    {
      subject: 'Invitation: Design review @ Thu 4 Sept 14:00 - 15:30',
      fromName: 'Sofia Marchetti',
      fromEmail: 'sofia.marchetti@porto.example',
      snippet:
        'Sofia Marchetti has invited you to Design review on Thursday 4 September, 14:00 – 15:30 (Europe/Amsterdam). Join with Google Meet.',
      hoursAgo: 20,
      unread: true,
      invite: true,
      important: true,
    },
    {
      subject: 'Tender deadline: 12 September',
      fromName: 'Meridian Shipping',
      fromEmail: 'procurement@meridian.example',
      snippet:
        'A reminder that submissions for the terminal study close on 12 September at 17:00 CET. Late entries cannot be considered.',
      hoursAgo: 26,
      important: true,
    },
    {
      subject: 'Your order has shipped',
      fromName: 'Bol',
      fromEmail: 'noreply@bol.example',
      snippet:
        'Good news — your order is on its way and should arrive within two working days. Track your parcel in your account.',
      hoursAgo: 30,
    },
    {
      subject: 'Re: Terminal visit',
      fromName: 'Lars Andersen',
      fromEmail: 'lars@nordport.example',
      snippet:
        'Thanks for the notes. I will look through them this week and come back to you with anything that stands out.',
      hoursAgo: 34,
    },
    {
      subject: 'Ticket confirmation — Maritime Conference',
      fromName: 'Ahoy Rotterdam',
      fromEmail: 'tickets@ahoy.example',
      snippet:
        'Your ticket for the Rotterdam Maritime Conference is attached. Doors open at 08:30 on 8 September. Ahoyweg 10, Rotterdam.',
      hoursAgo: 48,
    },
  ]
}

export class MockMailProvider implements MailProvider {
  readonly provider = 'GOOGLE' as const

  constructor(readonly account: IntegrationAccount) {}

  async listMessages(options: ListMessagesOptions = {}): Promise<MessagePage> {
    const now = Date.now()
    const messages = templates()
      .map((template, index) => ({
        externalId: `demo-${index + 1}`,
        threadId: `demo-thread-${index + 1}`,
        subject: template.subject,
        fromName: template.fromName,
        fromEmail: template.fromEmail,
        toEmails: [this.account.email ?? 'you@example.com'],
        snippet: template.snippet,
        receivedAt: new Date(now - template.hoursAgo * 60 * 60 * 1000),
        isUnread: template.unread ?? false,
        isImportant: template.important ?? false,
        labels: ['INBOX', ...(template.unread ? ['UNREAD'] : [])],
        hasCalendarAttachment: template.invite ?? false,
      }))
      .filter((message) =>
        options.after ? message.receivedAt >= options.after : true,
      )
      .slice(0, options.maxResults ?? 40)

    return {
      messages,
      nextPageToken: null,
      nextSyncToken: null,
      resyncRequired: false,
    }
  }

  async getMessage(externalId: string): Promise<RemoteMessage | null> {
    const page = await this.listMessages()
    return page.messages.find((message) => message.externalId === externalId) ?? null
  }

  async searchMessages(query: string, maxResults = 20): Promise<RemoteMessage[]> {
    const page = await this.listMessages()
    const needle = query.toLowerCase()
    return page.messages
      .filter(
        (message) =>
          message.subject?.toLowerCase().includes(needle) ||
          message.snippet?.toLowerCase().includes(needle) ||
          message.fromName?.toLowerCase().includes(needle),
      )
      .slice(0, maxResults)
  }

  async getThread(threadId: string): Promise<RemoteMessage[]> {
    const page = await this.listMessages()
    return page.messages.filter((message) => message.threadId === threadId)
  }

  webUrl(): string {
    // No real mailbox to deep-link into.
    return '#'
  }
}
