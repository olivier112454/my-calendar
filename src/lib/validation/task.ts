import { z } from 'zod'
import { isValidRule } from '../recurrence'

/** Input contracts for tasks, projects and tags. */

const iso = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Not a valid date and time')

export const taskPrioritySchema = z.enum(['P1', 'P2', 'P3', 'P4'])
export const taskStatusSchema = z.enum(['INBOX', 'TODO', 'IN_PROGRESS', 'DONE'])

export const createTaskSchema = z.object({
  title: z.string().trim().min(1, 'Give the task a title').max(300),
  description: z.string().max(10_000).nullish(),
  notes: z.string().max(20_000).nullish(),
  status: taskStatusSchema.default('TODO'),
  priority: taskPrioritySchema.default('P3'),
  dueAt: iso.nullish(),
  dueAllDay: z.boolean().default(true),
  timezone: z.string().nullish(),
  estimatedMinutes: z
    .number()
    .int()
    .min(5, 'Give it at least five minutes')
    .max(1440, 'Split anything longer than a day into smaller tasks')
    .nullish(),
  projectId: z.string().uuid().nullish(),
  parentTaskId: z.string().uuid().nullish(),
  tagIds: z.array(z.string().uuid()).max(20).default([]),
  recurrenceRule: z
    .string()
    .max(500)
    .refine((rule) => !rule || isValidRule(rule), 'That repeat rule is not valid')
    .nullish(),
  reminderMinutesBefore: z.number().int().min(0).max(40320).nullish(),
})

export type CreateTaskInput = z.infer<typeof createTaskSchema>

export const updateTaskSchema = createTaskSchema.partial().extend({
  sortOrder: z.number().int().min(0).max(100000).optional(),
})

export type UpdateTaskInput = z.infer<typeof updateTaskSchema>

export const listTasksQuerySchema = z.object({
  status: z.string().optional(),
  projectId: z.string().uuid().optional(),
  /** "today" | "week" | "overdue" | "unscheduled" | ISO date */
  due: z.string().optional(),
  search: z.string().max(200).optional(),
  includeCompleted: z.enum(['true', 'false']).optional(),
  parentTaskId: z.string().uuid().optional(),
})

/**
 * Dropping a task onto the calendar. The server creates the block and links it,
 * so the two can never drift apart.
 */
export const scheduleTaskSchema = z.object({
  start: iso,
  end: iso,
  calendarId: z.string().uuid().optional(),
  timezone: z.string().optional(),
})

export const reorderTasksSchema = z.object({
  orderedIds: z.array(z.string().uuid()).max(500),
  status: taskStatusSchema.optional(),
  projectId: z.string().uuid().nullish(),
})

export const createProjectSchema = z.object({
  name: z.string().trim().min(1, 'Give the project a name').max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Pick a colour'),
})

export const createTagSchema = z.object({
  name: z.string().trim().min(1).max(40),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#64748b'),
})
