/**
 * The models the UI works with.
 *
 * These are plain, serialisable shapes — instants are ISO strings, not `Date`s,
 * so they cross the server/client boundary unchanged. No provider-specific
 * field ever appears here: a Google event, an Outlook event and a locally
 * created one all arrive as the same `EventOccurrence`.
 */

export type EventKind =
  | 'EVENT'
  | 'FOCUS'
  | 'OUT_OF_OFFICE'
  | 'TASK_BLOCK'
  | 'BIRTHDAY'
  | 'HOLIDAY'
  | 'REMINDER'

export type EventStatus = 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED'
export type EventVisibility = 'DEFAULT' | 'PUBLIC' | 'PRIVATE'
export type Transparency = 'BUSY' | 'FREE'
export type AttendeeResponse = 'NEEDS_ACTION' | 'ACCEPTED' | 'DECLINED' | 'TENTATIVE'
export type ReminderMethod = 'APP' | 'EMAIL' | 'PUSH'
export type MeetingProviderId =
  | 'NONE'
  | 'GOOGLE_MEET'
  | 'MICROSOFT_TEAMS'
  | 'ZOOM'
  | 'CUSTOM'
  | 'PHONE'
  | 'IN_PERSON'
export type WorkingLocation = 'UNSPECIFIED' | 'OFFICE' | 'HOME' | 'ELSEWHERE'
export type TaskPriority = 'P1' | 'P2' | 'P3' | 'P4'
export type TaskStatus = 'INBOX' | 'TODO' | 'IN_PROGRESS' | 'DONE'

export interface LocationData {
  address?: string
  lat?: number
  lon?: number
  placeId?: string
}

export interface CalendarSummary {
  id: string
  name: string
  color: string
  description: string | null
  kind: string
  isDefault: boolean
  isVisible: boolean
  isReadOnly: boolean
  sortOrder: number
  /** Null for calendars that live only in this app. */
  provider: string | null
  /** Which connected account it came from, for the "Personal / Work" label. */
  accountId: string | null
  accountEmail: string | null
  eventCount?: number
}

/**
 * A label for what an event *is*, independent of which calendar it sits in.
 *
 * A dentist appointment and a five-a-side match both live in Personal, and the
 * difference between them is the category — which is what Analytics groups by.
 */
export interface CategorySummary {
  id: string
  name: string
  color: string
  /** Lucide icon name; never an emoji. */
  icon: string | null
  /** True for the starting set, which may still be renamed or deleted. */
  isSystem: boolean
}

export interface AttendeeSummary {
  id: string
  email: string
  name: string | null
  response: AttendeeResponse
  isOrganizer: boolean
  isOptional: boolean
  avatarUrl?: string | null
  contactId?: string | null
}

export interface ReminderSummary {
  id: string
  minutesBefore: number
  method: ReminderMethod
}

export interface AttachmentSummary {
  id: string
  name: string
  url: string
  mimeType: string | null
  sizeBytes: number | null
}

/**
 * One thing drawn on the calendar.
 *
 * For a non-repeating event this is the row itself. For a series it is a
 * generated instance: `eventId` points at the master and `occurrenceStart`
 * identifies which instance, which is what "this event / this and following /
 * all events" needs in order to edit the right thing.
 */
export interface EventOccurrence {
  /** Unique per rendered instance. `eventId` alone is not, for a series. */
  occurrenceId: string
  eventId: string
  /** ISO instant of the unmodified occurrence start; absent for single events. */
  occurrenceStart: string | null

  title: string
  description: string | null
  location: string | null
  locationData: LocationData | null

  start: string
  end: string
  timezone: string
  allDay: boolean

  kind: EventKind
  status: EventStatus
  visibility: EventVisibility
  transparency: Transparency

  calendarId: string
  calendarName: string
  calendarColor: string
  /** Calendar colour unless the event overrides it. */
  color: string

  categoryId: string | null
  categoryName: string | null

  meetingProvider: MeetingProviderId
  meetingUrl: string | null
  workingLocation: WorkingLocation
  travelTimeMinutes: number | null

  isRecurring: boolean
  /** True when this instance was edited away from the series. */
  isException: boolean
  recurrenceRule: string | null
  recurrenceSummary: string | null

  attendeeCount: number
  /** The signed-in user's own RSVP, when they are an attendee. */
  myResponse: AttendeeResponse | null
  hasReminders: boolean
  hasAttachments: boolean

  /** Set when this block was created from a task. */
  taskId: string | null

  provider: string | null
  accountEmail: string | null
  /** True for provider calendars we may not write to, and for holidays. */
  readOnly: boolean
}

/** Everything the details panel and editor need — one extra query, not in lists. */
export interface EventDetail extends EventOccurrence {
  attendees: AttendeeSummary[]
  reminders: ReminderSummary[]
  attachments: AttachmentSummary[]
  organizerEmail: string | null
  createdAt: string
  updatedAt: string
}

export interface TaskSummary {
  id: string
  title: string
  description: string | null
  notes: string | null
  status: TaskStatus
  priority: TaskPriority
  dueAt: string | null
  dueAllDay: boolean
  estimatedMinutes: number | null
  /** Recorded after the fact; the gap against the estimate is what is learned. */
  actualMinutes: number | null
  completedAt: string | null
  sortOrder: number
  projectId: string | null
  projectName: string | null
  projectColor: string | null
  parentTaskId: string | null
  subtaskCount: number
  completedSubtaskCount: number
  tags: { id: string; name: string; color: string }[]
  recurrenceRule: string | null
  /** The calendar block this task is scheduled into, if any. */
  timeBlockId: string | null
  timeBlockStart: string | null
  timeBlockEnd: string | null
  reminderMinutesBefore: number | null
  createdAt: string
}

export interface ContactSummary {
  id: string
  name: string
  email: string | null
  phone: string | null
  organization: string | null
  jobTitle: string | null
  avatarUrl: string | null
  notes: string | null
  isFavorite: boolean
  birthday: string | null
  provider: string | null
  meetingCount?: number
  lastMetAt?: string | null
  nextMeetingAt?: string | null
}

export interface NotificationSummary {
  id: string
  type: string
  title: string
  body: string | null
  link: string | null
  readAt: string | null
  createdAt: string
  entityType: string | null
  entityId: string | null
}

export interface EmailSummary {
  id: string
  messageId: string
  threadId: string | null
  subject: string | null
  fromName: string | null
  fromEmail: string | null
  snippet: string | null
  receivedAt: string
  isUnread: boolean
  isImportant: boolean
  category: string
  confidence: number
  accountEmail: string | null
  dismissed: boolean
  linkedEventId: string | null
  /** The structured draft the extractor produced, when confident enough. */
  extraction: EventDraft | null
}

/**
 * A proposed event, produced by the natural-language parser or the email
 * extractor. Always shown to the user for confirmation — nothing that reads
 * text ever writes to the calendar on its own.
 */
export interface EventDraft {
  title: string
  start: string | null
  end: string | null
  allDay?: boolean
  location?: string | null
  description?: string | null
  participants?: { name?: string; email?: string }[]
  recurrenceRule?: string | null
  meetingUrl?: string | null
  /** 0–1. Below ~0.4 the UI shows the draft as a hint rather than a suggestion. */
  confidence: number
  /** Which fragments produced the parse, for the "we read this as…" preview. */
  matched?: string[]
}

export interface ConflictWarning {
  kind: 'overlap' | 'travel' | 'buffer'
  severity: 'blocking' | 'warning'
  message: string
  otherEventId: string
  otherTitle: string
  otherStart: string
  otherEnd: string
}

export interface FreeBusySlot {
  start: string
  end: string
  status: 'free' | 'busy' | 'tentative' | 'outside-hours'
}

export interface SchedulingProposal {
  taskId: string
  taskTitle: string
  start: string
  end: string
  /** Why this slot: "before your Friday deadline", "your usual focus window". */
  reason: string
  priority: TaskPriority
  estimatedMinutes: number
}

/**
 * What is already on the calendar, as the Schedule page shows it.
 *
 * A deliberately thin slice of `EventOccurrence`: the planning screen has to
 * show what it is planning around, but it never edits those events, so it has
 * no business carrying attendees, reminders or provider fields.
 */
export interface ScheduleCommitment {
  occurrenceId: string
  eventId: string
  title: string
  start: string
  end: string
  allDay: boolean
  color: string
  calendarName: string
  /** `TASK_BLOCK` marks time this app reserved for a task. */
  kind: EventKind
}

export interface CalendarViewRange {
  /** Inclusive first day rendered, as YYYY-MM-DD in the display zone. */
  startKey: string
  /** Inclusive last day rendered. */
  endKey: string
}

export type CalendarViewMode =
  | 'day'
  | 'three-day'
  | 'work-week'
  | 'week'
  | 'month'
  | 'year'
  | 'agenda'

export interface IntegrationSummary {
  id: string
  provider: string
  email: string | null
  displayName: string | null
  avatarUrl: string | null
  status: string
  isPrimary: boolean
  scopes: string[]
  lastError: string | null
  connectedAt: string
  calendarCount: number
  lastSyncedAt: string | null
  syncStatus: string | null
}
