import 'server-only'
import type { IntegrationAccount } from '@prisma/client'
import { wallToUtc, dayKeyOf } from '@/lib/datetime'
import {
  ProviderError,
  type CalendarProvider,
  type EventPage,
  type ListEventsOptions,
  type RemoteCalendar,
  type RemoteEvent,
  type RemoteEventInput,
} from '../types'
import { GOOGLE_CALENDAR_API, googleFetch } from './client'

/**
 * Google Calendar, mapped onto the app's own model.
 *
 * All the awkwardness of the Google shape is handled here and nowhere else:
 * all-day events arriving as plain dates, `colorId` indirection, the two
 * different ways a Meet link can be attached, and sync tokens that expire.
 */

/** Google's event palette. Their API returns an id; the UI needs a colour. */
const EVENT_COLORS: Record<string, string> = {
  '1': '#7986cb',
  '2': '#33b679',
  '3': '#8e24aa',
  '4': '#e67c73',
  '5': '#f6c026',
  '6': '#f5511d',
  '7': '#039be5',
  '8': '#616161',
  '9': '#3f51b5',
  '10': '#0b8043',
  '11': '#d60000',
}

interface GoogleDateTime {
  date?: string
  dateTime?: string
  timeZone?: string
}

interface GoogleEvent {
  id: string
  etag?: string
  status?: string
  summary?: string
  description?: string
  location?: string
  start?: GoogleDateTime
  end?: GoogleDateTime
  recurrence?: string[]
  recurringEventId?: string
  originalStartTime?: GoogleDateTime
  transparency?: string
  visibility?: string
  colorId?: string
  hangoutLink?: string
  conferenceData?: {
    entryPoints?: { entryPointType?: string; uri?: string }[]
    conferenceSolution?: { name?: string }
  }
  attendees?: {
    email?: string
    displayName?: string
    organizer?: boolean
    optional?: boolean
    responseStatus?: string
    self?: boolean
  }[]
  organizer?: { email?: string; displayName?: string }
  reminders?: {
    useDefault?: boolean
    overrides?: { method?: string; minutes?: number }[]
  }
  updated?: string
}

export class GoogleCalendarProvider implements CalendarProvider {
  readonly provider = 'GOOGLE' as const

  constructor(readonly account: IntegrationAccount) {}

  async listCalendars(): Promise<RemoteCalendar[]> {
    const response = await googleFetch<{
      items?: {
        id: string
        summary?: string
        summaryOverride?: string
        description?: string
        backgroundColor?: string
        timeZone?: string
        primary?: boolean
        accessRole?: string
        deleted?: boolean
      }[]
    }>(this.account, `${GOOGLE_CALENDAR_API}/users/me/calendarList`, {
      query: { maxResults: 250, showHidden: false },
    })

    return (response.items ?? [])
      .filter((item) => !item.deleted)
      .map((item) => ({
        externalId: item.id,
        // summaryOverride is the name the user gave a shared calendar; it is
        // what they see in Google, so it is what they should see here.
        name: item.summaryOverride ?? item.summary ?? item.id,
        description: item.description ?? null,
        color: item.backgroundColor ?? null,
        timezone: item.timeZone ?? null,
        isPrimary: item.primary === true,
        isWritable: item.accessRole === 'owner' || item.accessRole === 'writer',
      }))
  }

  async listEvents(options: ListEventsOptions): Promise<EventPage> {
    try {
      const response = await googleFetch<{
        items?: GoogleEvent[]
        nextPageToken?: string
        nextSyncToken?: string
      }>(
        this.account,
        `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(options.calendarExternalId)}/events`,
        {
          query: {
            maxResults: options.maxResults ?? 250,
            // Series stay as series: expanding them here would multiply a
            // weekly meeting into hundreds of rows and lose the rule.
            singleEvents: false,
            showDeleted: Boolean(options.syncToken),
            pageToken: options.pageToken ?? undefined,
            ...(options.syncToken
              ? { syncToken: options.syncToken }
              : {
                  timeMin: options.timeMin?.toISOString(),
                  timeMax: options.timeMax?.toISOString(),
                }),
          },
        },
      )

      return {
        events: (response.items ?? []).map((item) => this.toRemoteEvent(item)),
        nextPageToken: response.nextPageToken ?? null,
        nextSyncToken: response.nextSyncToken ?? null,
        resyncRequired: false,
      }
    } catch (error) {
      // An expired token is normal after a long gap; ask for a full read.
      if (error instanceof ProviderError && error.code === 'conflict') {
        return {
          events: [],
          nextPageToken: null,
          nextSyncToken: null,
          resyncRequired: true,
        }
      }
      throw error
    }
  }

  async createEvent(
    calendarExternalId: string,
    input: RemoteEventInput,
  ): Promise<RemoteEvent> {
    const wantsMeet = input.meetingProvider === 'GOOGLE_MEET'

    const created = await googleFetch<GoogleEvent>(
      this.account,
      `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarExternalId)}/events`,
      {
        method: 'POST',
        query: {
          // Required for Google to mint a Meet link.
          conferenceDataVersion: wantsMeet ? 1 : 0,
          sendUpdates: input.attendees.length > 0 ? 'all' : 'none',
        },
        body: this.toGooglePayload(input, wantsMeet),
      },
    )

    return this.toRemoteEvent(created)
  }

  async updateEvent(
    calendarExternalId: string,
    externalId: string,
    input: RemoteEventInput,
  ): Promise<RemoteEvent> {
    const updated = await googleFetch<GoogleEvent>(
      this.account,
      `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(
        calendarExternalId,
      )}/events/${encodeURIComponent(externalId)}`,
      {
        method: 'PATCH',
        query: { sendUpdates: input.attendees.length > 0 ? 'all' : 'none' },
        body: this.toGooglePayload(input, false),
      },
    )
    return this.toRemoteEvent(updated)
  }

  async deleteEvent(calendarExternalId: string, externalId: string): Promise<void> {
    try {
      await googleFetch<void>(
        this.account,
        `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(
          calendarExternalId,
        )}/events/${encodeURIComponent(externalId)}`,
        { method: 'DELETE', query: { sendUpdates: 'all' } },
      )
    } catch (error) {
      // Already gone remotely is the outcome we wanted.
      if (error instanceof ProviderError && error.code === 'not_found') return
      throw error
    }
  }

  async freeBusy(
    emails: string[],
    from: Date,
    to: Date,
  ): Promise<Record<string, { start: Date; end: Date }[]>> {
    const response = await googleFetch<{
      calendars?: Record<
        string,
        { busy?: { start: string; end: string }[]; errors?: { reason: string }[] }
      >
    }>(this.account, `${GOOGLE_CALENDAR_API}/freeBusy`, {
      method: 'POST',
      body: {
        timeMin: from.toISOString(),
        timeMax: to.toISOString(),
        items: emails.map((email) => ({ id: email })),
      },
    })

    const out: Record<string, { start: Date; end: Date }[]> = {}
    for (const [email, entry] of Object.entries(response.calendars ?? {})) {
      // An address we cannot see returns errors rather than busy blocks; an
      // empty list would wrongly read as "completely free".
      if (entry.errors?.length) continue
      out[email] = (entry.busy ?? []).map((slot) => ({
        start: new Date(slot.start),
        end: new Date(slot.end),
      }))
    }
    return out
  }

  /* ------------------------------------------------------------ mapping */

  private toRemoteEvent(item: GoogleEvent): RemoteEvent {
    const allDay = Boolean(item.start?.date)
    // Google omits timeZone on events that follow the calendar's own zone; UTC
    // is only ever used for the instant maths, never shown to the user.
    const timezone = item.start?.timeZone ?? 'UTC'

    const start = this.toInstant(item.start, timezone)
    const end = this.toInstant(item.end, timezone)

    const meetingUrl =
      item.hangoutLink ??
      item.conferenceData?.entryPoints?.find(
        (entry) => entry.entryPointType === 'video',
      )?.uri ??
      null

    const recurrence = item.recurrence ?? []
    const rule = recurrence.find((line) => line.startsWith('RRULE:'))
    const exDates = recurrence
      .filter((line) => line.startsWith('EXDATE'))
      .flatMap((line) => line.split(':')[1]?.split(',') ?? [])
      .map((value) => parseCompactDate(value))
      .filter((value): value is string => value !== null)

    return {
      externalId: item.id,
      etag: item.etag ?? null,
      title: item.summary ?? '(no title)',
      description: item.description ?? null,
      location: item.location ?? null,
      start,
      end,
      timezone: item.start?.timeZone ?? 'UTC',
      allDay,
      status:
        item.status === 'cancelled'
          ? 'CANCELLED'
          : item.status === 'tentative'
            ? 'TENTATIVE'
            : 'CONFIRMED',
      visibility:
        item.visibility === 'private' || item.visibility === 'confidential'
          ? 'PRIVATE'
          : item.visibility === 'public'
            ? 'PUBLIC'
            : 'DEFAULT',
      transparency: item.transparency === 'transparent' ? 'FREE' : 'BUSY',
      meetingUrl,
      meetingProvider: meetingUrl
        ? item.hangoutLink
          ? 'GOOGLE_MEET'
          : 'CUSTOM'
        : 'NONE',
      color: item.colorId ? (EVENT_COLORS[item.colorId] ?? null) : null,
      recurrenceRule: rule ? rule.replace(/^RRULE:/, '') : null,
      recurrenceExDates: exDates,
      recurringEventExternalId: item.recurringEventId ?? null,
      originalStart: item.originalStartTime
        ? this.toInstant(item.originalStartTime, timezone)
        : null,
      attendees: (item.attendees ?? []).map((attendee) => ({
        email: (attendee.email ?? '').toLowerCase(),
        name: attendee.displayName ?? null,
        isOrganizer: attendee.organizer === true,
        isOptional: attendee.optional === true,
        response:
          attendee.responseStatus === 'accepted'
            ? 'ACCEPTED'
            : attendee.responseStatus === 'declined'
              ? 'DECLINED'
              : attendee.responseStatus === 'tentative'
                ? 'TENTATIVE'
                : 'NEEDS_ACTION',
      })),
      reminders: (item.reminders?.overrides ?? []).map((override) => ({
        minutesBefore: override.minutes ?? 0,
        method: override.method === 'email' ? 'EMAIL' : 'PUSH',
      })),
      organizerEmail: item.organizer?.email?.toLowerCase() ?? null,
      deleted: item.status === 'cancelled',
      updatedAt: item.updated ? new Date(item.updated) : null,
    }
  }

  /**
   * Google sends either `dateTime` (an instant) or `date` (a plain day). The
   * second must be resolved through the event's own zone, or an all-day event
   * lands on the wrong day for anyone east or west of UTC.
   */
  private toInstant(value: GoogleDateTime | undefined, timezone: string): Date {
    if (!value) return new Date()
    if (value.dateTime) return new Date(value.dateTime)
    if (value.date) return wallToUtc(`${value.date}T00:00`, value.timeZone ?? timezone)
    return new Date()
  }

  private toGooglePayload(input: RemoteEventInput, withConference: boolean) {
    const dates = input.allDay
      ? {
          start: { date: dayKeyOf(input.start, input.timezone) },
          // Google's all-day end is exclusive, same as ours.
          end: { date: dayKeyOf(input.end, input.timezone) },
        }
      : {
          start: { dateTime: input.start.toISOString(), timeZone: input.timezone },
          end: { dateTime: input.end.toISOString(), timeZone: input.timezone },
        }

    return {
      summary: input.title,
      description: input.description ?? undefined,
      location: input.location ?? undefined,
      ...dates,
      status: input.status.toLowerCase(),
      visibility:
        input.visibility === 'PRIVATE'
          ? 'private'
          : input.visibility === 'PUBLIC'
            ? 'public'
            : 'default',
      transparency: input.transparency === 'FREE' ? 'transparent' : 'opaque',
      recurrence: input.recurrenceRule ? [`RRULE:${input.recurrenceRule}`] : undefined,
      attendees: input.attendees.length
        ? input.attendees.map((attendee) => ({
            email: attendee.email,
            displayName: attendee.name ?? undefined,
            optional: attendee.isOptional || undefined,
          }))
        : undefined,
      reminders: {
        useDefault: input.reminders.length === 0,
        overrides: input.reminders.length
          ? input.reminders.map((reminder) => ({
              method: reminder.method === 'EMAIL' ? 'email' : 'popup',
              minutes: reminder.minutesBefore,
            }))
          : undefined,
      },
      ...(withConference
        ? {
            conferenceData: {
              createRequest: {
                // Any unique id works; Google returns the real link.
                requestId: `dayflow-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
                conferenceSolutionKey: { type: 'hangoutsMeet' },
              },
            },
          }
        : {}),
      ...(input.meetingUrl && !withConference
        ? { description: `${input.description ?? ''}\n\n${input.meetingUrl}`.trim() }
        : {}),
    }
  }
}

/** "20260831T090000Z" -> ISO. Google uses the compact form in EXDATE. */
function parseCompactDate(value: string): string | null {
  const match = value.match(
    /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/,
  )
  if (!match) return null
  const [, y, m, d, hh = '00', mm = '00', ss = '00'] = match
  return new Date(
    Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss)),
  ).toISOString()
}
