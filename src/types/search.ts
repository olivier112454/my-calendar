/** Shapes returned by the global search endpoint. */

export interface EventSearchHit {
  id: string
  title: string
  start: string
  end: string
  dayKey: string
  allDay: boolean
  color: string
  calendarName: string
  location: string | null
}

export interface TaskSearchHit {
  id: string
  title: string
  status: string
  priority: string
  dueAt: string | null
  projectName: string | null
}

export interface ContactSearchHit {
  id: string
  name: string
  email: string | null
  organization: string | null
  avatarUrl: string | null
}

export interface EmailSearchHit {
  id: string
  subject: string | null
  fromName: string | null
  fromEmail: string | null
  receivedAt: string
  category: string
}

export interface CalendarSearchHit {
  id: string
  name: string
  color: string
}

export interface SearchResults {
  query: string
  events: EventSearchHit[]
  tasks: TaskSearchHit[]
  contacts: ContactSearchHit[]
  emails: EmailSearchHit[]
  calendars: CalendarSearchHit[]
  /** True when results were capped, so the UI can offer "see all". */
  truncated: boolean
}

export type SearchType = 'events' | 'tasks' | 'contacts' | 'emails' | 'calendars'

export interface SearchFilters {
  types?: SearchType[]
  /** ISO instants bounding event and task results. */
  from?: string
  to?: string
  calendarId?: string
  personEmail?: string
  status?: string
}
