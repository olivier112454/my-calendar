import { z } from 'zod'
import { isValidTimeZone } from '../datetime'
import { isValidRule } from '../recurrence'

/**
 * Input contracts for events. Shared by the API routes and the forms, so the
 * client and the server agree on what is valid and the same message appears in
 * both places.
 */

const iso = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Not a valid date and time')

const timezone = z
  .string()
  .refine(isValidTimeZone, 'Not a recognised time zone')

const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #4f46e5')

export const eventKindSchema = z.enum([
  'EVENT',
  'FOCUS',
  'OUT_OF_OFFICE',
  'TASK_BLOCK',
  'BIRTHDAY',
  'HOLIDAY',
  'REMINDER',
])

export const attendeeInputSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  name: z.string().trim().max(120).optional(),
  isOptional: z.boolean().optional(),
  contactId: z.string().uuid().optional(),
})

export const reminderInputSchema = z.object({
  minutesBefore: z
    .number()
    .int()
    .min(0, 'A reminder cannot be after the event')
    .max(40320, 'Reminders can be at most four weeks early'),
  method: z.enum(['APP', 'EMAIL', 'PUSH']).default('APP'),
})

export const locationDataSchema = z.object({
  address: z.string().max(300).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lon: z.number().min(-180).max(180).optional(),
  placeId: z.string().max(200).optional(),
})

export const createEventSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, 'Give the event a title')
      .max(300, 'That title is too long'),
    description: z.string().max(20_000).nullish(),
    location: z.string().max(500).nullish(),
    locationData: locationDataSchema.nullish(),

    calendarId: z.string().uuid('Pick a calendar'),
    start: iso,
    end: iso,
    timezone,
    allDay: z.boolean().default(false),

    kind: eventKindSchema.default('EVENT'),
    status: z.enum(['CONFIRMED', 'TENTATIVE', 'CANCELLED']).default('CONFIRMED'),
    visibility: z.enum(['DEFAULT', 'PUBLIC', 'PRIVATE']).default('DEFAULT'),
    transparency: z.enum(['BUSY', 'FREE']).default('BUSY'),

    meetingProvider: z
      .enum([
        'NONE',
        'GOOGLE_MEET',
        'MICROSOFT_TEAMS',
        'ZOOM',
        'CUSTOM',
        'PHONE',
        'IN_PERSON',
      ])
      .default('NONE'),
    meetingUrl: z.string().url('Enter a valid link').max(2000).nullish(),

    color: hexColor.nullish(),
    categoryId: z.string().uuid().nullish(),
    workingLocation: z
      .enum(['UNSPECIFIED', 'OFFICE', 'HOME', 'ELSEWHERE'])
      .default('UNSPECIFIED'),
    travelTimeMinutes: z.number().int().min(0).max(600).nullish(),

    recurrenceRule: z
      .string()
      .max(500)
      .refine((rule) => !rule || isValidRule(rule), 'That repeat rule is not valid')
      .nullish(),

    attendees: z.array(attendeeInputSchema).max(200).default([]),
    reminders: z.array(reminderInputSchema).max(10).default([]),

    /** Set when the event is a scheduled block for a task. */
    taskId: z.string().uuid().nullish(),
  })
  .refine((value) => new Date(value.end) > new Date(value.start), {
    message: 'The end time must be after the start time',
    path: ['end'],
  })

export type CreateEventInput = z.infer<typeof createEventSchema>

/**
 * Which part of a series an edit applies to. Mirrors the three choices every
 * calendar offers, and the reason the API cannot just take an event id.
 */
export const recurrenceScopeSchema = z.enum(['this', 'following', 'all'])
export type RecurrenceScope = z.infer<typeof recurrenceScopeSchema>

export const updateEventSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  description: z.string().max(20_000).nullish(),
  location: z.string().max(500).nullish(),
  locationData: locationDataSchema.nullish(),
  calendarId: z.string().uuid().optional(),
  start: iso.optional(),
  end: iso.optional(),
  timezone: timezone.optional(),
  allDay: z.boolean().optional(),
  kind: eventKindSchema.optional(),
  status: z.enum(['CONFIRMED', 'TENTATIVE', 'CANCELLED']).optional(),
  visibility: z.enum(['DEFAULT', 'PUBLIC', 'PRIVATE']).optional(),
  transparency: z.enum(['BUSY', 'FREE']).optional(),
  meetingProvider: z
    .enum(['NONE', 'GOOGLE_MEET', 'MICROSOFT_TEAMS', 'ZOOM', 'CUSTOM', 'PHONE', 'IN_PERSON'])
    .optional(),
  meetingUrl: z.string().url().max(2000).nullish(),
  color: hexColor.nullish(),
  categoryId: z.string().uuid().nullish(),
  workingLocation: z.enum(['UNSPECIFIED', 'OFFICE', 'HOME', 'ELSEWHERE']).optional(),
  travelTimeMinutes: z.number().int().min(0).max(600).nullish(),
  recurrenceRule: z
    .string()
    .max(500)
    .refine((rule) => !rule || isValidRule(rule), 'That repeat rule is not valid')
    .nullish(),
  attendees: z.array(attendeeInputSchema).max(200).optional(),
  reminders: z.array(reminderInputSchema).max(10).optional(),

  /** Required when editing one instance of a series. */
  occurrenceStart: iso.optional(),
  scope: recurrenceScopeSchema.default('all'),
})

export type UpdateEventInput = z.infer<typeof updateEventSchema>

export const deleteEventSchema = z.object({
  occurrenceStart: iso.optional(),
  scope: recurrenceScopeSchema.default('all'),
})

/** Drag and resize send only what moved — cheaper and safer than a full update. */
export const moveEventSchema = z.object({
  start: iso,
  end: iso,
  calendarId: z.string().uuid().optional(),
  allDay: z.boolean().optional(),
  occurrenceStart: iso.optional(),
  scope: recurrenceScopeSchema.default('this'),
})

export const listEventsQuerySchema = z.object({
  /** Inclusive ISO instant. */
  from: iso,
  /** Exclusive ISO instant. */
  to: iso,
  /** Comma-separated calendar ids; omitted means "all visible calendars". */
  calendarIds: z.string().optional(),
  kinds: z.string().optional(),
  includeDeclined: z.enum(['true', 'false']).optional(),
  search: z.string().max(200).optional(),
})

export const rsvpSchema = z.object({
  response: z.enum(['ACCEPTED', 'DECLINED', 'TENTATIVE', 'NEEDS_ACTION']),
  comment: z.string().max(500).optional(),
})
