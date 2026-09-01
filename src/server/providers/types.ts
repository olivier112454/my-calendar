import type { IntegrationAccount, Provider } from '@prisma/client'
import { appConfig } from '@/config/app'

/**
 * The provider contract.
 *
 * Every external calendar, mailbox and address book is reached through these
 * three interfaces, and everything they return is already in the app's own
 * shape. Nothing above this layer knows that Google exists — which is what
 * makes adding Outlook or CalDAV a new file rather than a rewrite.
 *
 * Two rules hold for every implementation:
 *
 *  - It returns normalized types, never provider payloads.
 *  - It throws `ProviderError` with a message a person can act on. "Google
 *    returned 403" is not that; "Your Google connection needs renewing" is.
 */

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'unauthorized'
      | 'rate_limited'
      | 'not_found'
      | 'conflict'
      | 'unavailable'
      | 'unknown' = 'unknown',
    readonly retryable = false,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}

/* ------------------------------------------------------------- calendars */

export interface RemoteCalendar {
  externalId: string
  name: string
  description: string | null
  color: string | null
  timezone: string | null
  /** True for the account's own default calendar. */
  isPrimary: boolean
  /** False when the account may only read this calendar. */
  isWritable: boolean
}

export interface RemoteAttendee {
  email: string
  name: string | null
  isOrganizer: boolean
  isOptional: boolean
  response: 'NEEDS_ACTION' | 'ACCEPTED' | 'DECLINED' | 'TENTATIVE'
}

export interface RemoteReminder {
  minutesBefore: number
  method: 'APP' | 'EMAIL' | 'PUSH'
}

export interface RemoteEvent {
  externalId: string
  /** Provider version marker, used to detect remote changes cheaply. */
  etag: string | null
  title: string
  description: string | null
  location: string | null
  /** UTC instants. */
  start: Date
  end: Date
  timezone: string
  allDay: boolean
  status: 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED'
  visibility: 'DEFAULT' | 'PUBLIC' | 'PRIVATE'
  transparency: 'BUSY' | 'FREE'
  meetingUrl: string | null
  meetingProvider: 'NONE' | 'GOOGLE_MEET' | 'MICROSOFT_TEAMS' | 'ZOOM' | 'CUSTOM'
  /** Provider colour, already mapped to a hex value we can render. */
  color: string | null
  /** RRULE text without the prefix, when the event repeats. */
  recurrenceRule: string | null
  recurrenceExDates: string[]
  /** Set on a modified occurrence: the series it belongs to. */
  recurringEventExternalId: string | null
  originalStart: Date | null
  attendees: RemoteAttendee[]
  reminders: RemoteReminder[]
  organizerEmail: string | null
  /** True when the provider says this row was deleted. */
  deleted: boolean
  updatedAt: Date | null
}

/** What we send when creating or updating an event remotely. */
export interface RemoteEventInput {
  title: string
  description: string | null
  location: string | null
  start: Date
  end: Date
  timezone: string
  allDay: boolean
  status: 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED'
  visibility: 'DEFAULT' | 'PUBLIC' | 'PRIVATE'
  transparency: 'BUSY' | 'FREE'
  recurrenceRule: string | null
  attendees: { email: string; name: string | null; isOptional: boolean }[]
  reminders: RemoteReminder[]
  meetingProvider: 'NONE' | 'GOOGLE_MEET' | 'MICROSOFT_TEAMS' | 'ZOOM' | 'CUSTOM'
  meetingUrl: string | null
  color: string | null
}

export interface EventPage {
  events: RemoteEvent[]
  /** Opaque token for the next incremental read. */
  nextSyncToken: string | null
  /** Set when the provider has more pages of the current read. */
  nextPageToken: string | null
  /**
   * True when the provider rejected our sync token and a full read is needed.
   * Callers must clear their local mirror for the calendar when they see this.
   */
  resyncRequired: boolean
}

export interface ListEventsOptions {
  calendarExternalId: string
  /** Incremental read; omit for a full read of the window. */
  syncToken?: string | null
  pageToken?: string | null
  timeMin?: Date
  timeMax?: Date
  maxResults?: number
}

export interface CalendarProvider {
  readonly provider: Provider
  readonly account: IntegrationAccount

  listCalendars(): Promise<RemoteCalendar[]>
  listEvents(options: ListEventsOptions): Promise<EventPage>
  createEvent(calendarExternalId: string, input: RemoteEventInput): Promise<RemoteEvent>
  updateEvent(
    calendarExternalId: string,
    externalId: string,
    input: RemoteEventInput,
  ): Promise<RemoteEvent>
  deleteEvent(calendarExternalId: string, externalId: string): Promise<void>
  /** Free/busy for a set of addresses — used by the meeting scheduler. */
  freeBusy?(
    emails: string[],
    from: Date,
    to: Date,
  ): Promise<Record<string, { start: Date; end: Date }[]>>
}

/* ------------------------------------------------------------------ mail */

/**
 * Message metadata only. Bodies are deliberately absent from this interface:
 * the app never stores them, so it never asks for them beyond the snippet the
 * provider already exposes for its own list views.
 */
export interface RemoteMessage {
  externalId: string
  threadId: string | null
  subject: string | null
  fromName: string | null
  fromEmail: string | null
  toEmails: string[]
  snippet: string | null
  receivedAt: Date
  isUnread: boolean
  isImportant: boolean
  /** Provider labels, kept for filtering only. */
  labels: string[]
  /** Present when the message carries a calendar invitation. */
  hasCalendarAttachment: boolean
}

export interface MessagePage {
  messages: RemoteMessage[]
  nextPageToken: string | null
  /** History marker for the next incremental read. */
  nextSyncToken: string | null
  resyncRequired: boolean
}

export interface ListMessagesOptions {
  maxResults?: number
  pageToken?: string | null
  syncToken?: string | null
  /** Provider query string, e.g. Gmail's search syntax. */
  query?: string
  /** Only messages newer than this. */
  after?: Date
}

export interface MailProvider {
  readonly provider: Provider
  readonly account: IntegrationAccount

  listMessages(options?: ListMessagesOptions): Promise<MessagePage>
  getMessage(externalId: string): Promise<RemoteMessage | null>
  searchMessages(query: string, maxResults?: number): Promise<RemoteMessage[]>
  getThread(threadId: string): Promise<RemoteMessage[]>
  /** Deep link into the provider's own web client. */
  webUrl(externalId: string): string
}

/* -------------------------------------------------------------- contacts */

export interface RemoteContact {
  externalId: string
  name: string
  email: string | null
  phone: string | null
  organization: string | null
  jobTitle: string | null
  avatarUrl: string | null
  birthday: string | null
}

export interface ContactsProvider {
  readonly provider: Provider
  readonly account: IntegrationAccount

  listContacts(pageToken?: string | null): Promise<{
    contacts: RemoteContact[]
    nextPageToken: string | null
  }>
}

/* ------------------------------------------------------------ capability */

export interface ProviderCapabilities {
  calendar: boolean
  mail: boolean
  contacts: boolean
  /** Whether events created here can carry a generated video-meeting link. */
  createsMeetingLinks: boolean
  /** Whether the provider supports incremental sync tokens. */
  incrementalSync: boolean
}

export const providerLabels: Record<Provider, string> = {
  LOCAL: appConfig.name,
  GOOGLE: 'Google',
  MICROSOFT: 'Microsoft',
  APPLE: 'Apple',
  CALDAV: 'CalDAV',
  ZOOM: 'Zoom',
  SLACK: 'Slack',
  TODOIST: 'Todoist',
  NOTION: 'Notion',
}
