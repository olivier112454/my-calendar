import { wallToUtc } from '@/lib/datetime'
import type { EventOccurrence } from '@/types/domain'

export const AMS = 'Europe/Amsterdam'

/** Minimal but complete occurrence, so tests only state what they care about. */
export function makeEvent(
  overrides: Partial<EventOccurrence> & { start: string; end: string },
): EventOccurrence {
  const start = overrides.start.includes('T') && overrides.start.length === 16
    ? wallToUtc(overrides.start, AMS).toISOString()
    : overrides.start
  const end = overrides.end.includes('T') && overrides.end.length === 16
    ? wallToUtc(overrides.end, AMS).toISOString()
    : overrides.end

  return {
    occurrenceId: overrides.occurrenceId ?? `occ-${start}`,
    eventId: overrides.eventId ?? `evt-${start}`,
    occurrenceStart: null,
    title: 'Event',
    description: null,
    location: null,
    locationData: null,
    timezone: AMS,
    allDay: false,
    kind: 'EVENT',
    status: 'CONFIRMED',
    visibility: 'DEFAULT',
    transparency: 'BUSY',
    calendarId: 'cal-1',
    calendarName: 'Work',
    calendarColor: '#4f46e5',
    color: '#4f46e5',
    categoryId: null,
    categoryName: null,
    meetingProvider: 'NONE',
    meetingUrl: null,
    workingLocation: 'UNSPECIFIED',
    travelTimeMinutes: null,
    isRecurring: false,
    isException: false,
    recurrenceRule: null,
    recurrenceSummary: null,
    attendeeCount: 0,
    myResponse: null,
    hasReminders: false,
    hasAttachments: false,
    taskId: null,
    provider: null,
    accountEmail: null,
    readOnly: false,
    ...overrides,
    start,
    end,
  }
}
