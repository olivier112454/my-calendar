import 'server-only'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { NotFoundError } from '@/lib/api'
import { recordAudit } from '@/server/audit'
import { nextOccurrences } from '@/lib/recurrence'
import {
  addDaysToKey,
  endOfDayUtc,
  startOfDayUtc,
  todayKey,
} from '@/lib/datetime'
import type { TaskSummary } from '@/types/domain'
import type {
  CreateTaskInput,
  UpdateTaskInput,
} from '@/lib/validation/task'
import { defaultCalendarId } from './calendars'

/**
 * Tasks.
 *
 * The one structural idea worth knowing: a task that has been scheduled owns a
 * calendar event through `timeBlockId`, one-to-one. That is what makes "drag a
 * task onto Tuesday afternoon" produce a real block you can move, resize and
 * see next to your meetings — rather than a second, parallel notion of time.
 * Completing the task leaves the block; deleting the block unschedules the task.
 */

const taskInclude = {
  project: { select: { id: true, name: true, color: true } },
  tags: { include: { tag: true } },
  timeBlock: { select: { id: true, startAt: true, endAt: true } },
  _count: { select: { subtasks: true } },
} satisfies Prisma.TaskInclude

type TaskRow = Prisma.TaskGetPayload<{ include: typeof taskInclude }>

export interface ListTasksOptions {
  status?: string[]
  projectId?: string
  /** "today" | "week" | "overdue" | "unscheduled" | a YYYY-MM-DD key */
  due?: string
  search?: string
  includeCompleted?: boolean
  parentTaskId?: string | null
  timezone: string
}

export async function listTasks(
  userId: string,
  options: ListTasksOptions,
): Promise<TaskSummary[]> {
  const where: Prisma.TaskWhereInput = {
    userId,
    ...(options.projectId ? { projectId: options.projectId } : {}),
    ...(options.status?.length ? { status: { in: options.status as never } } : {}),
    ...(options.includeCompleted ? {} : { status: { not: 'DONE' } }),
    ...(options.search
      ? {
          OR: [
            { title: { contains: options.search, mode: 'insensitive' } },
            { description: { contains: options.search, mode: 'insensitive' } },
          ],
        }
      : {}),
    // Subtasks are nested under their parent, never listed alongside it.
    ...(options.parentTaskId === undefined
      ? { parentTaskId: null }
      : { parentTaskId: options.parentTaskId }),
    ...dueFilter(options.due, options.timezone),
  }

  const rows = await prisma.task.findMany({
    where,
    include: taskInclude,
    orderBy: [
      { status: 'asc' },
      { sortOrder: 'asc' },
      // Undated tasks sort last rather than first.
      { dueAt: { sort: 'asc', nulls: 'last' } },
      { createdAt: 'asc' },
    ],
  })

  // One extra query resolves completed-subtask counts for every parent at once,
  // instead of a count per row.
  const parentIds = rows.filter((row) => row._count.subtasks > 0).map((row) => row.id)
  const completedByParent = new Map<string, number>()
  if (parentIds.length > 0) {
    const grouped = await prisma.task.groupBy({
      by: ['parentTaskId'],
      where: { userId, parentTaskId: { in: parentIds }, status: 'DONE' },
      _count: { _all: true },
    })
    for (const entry of grouped) {
      if (entry.parentTaskId) completedByParent.set(entry.parentTaskId, entry._count._all)
    }
  }

  return rows.map((row) => toSummary(row, completedByParent.get(row.id) ?? 0))
}

function dueFilter(due: string | undefined, timezone: string): Prisma.TaskWhereInput {
  if (!due) return {}
  const today = todayKey(timezone)

  switch (due) {
    case 'today':
      return { dueAt: { lt: endOfDayUtc(today, timezone) } }
    case 'week':
      return { dueAt: { lt: endOfDayUtc(addDaysToKey(today, 7), timezone) } }
    case 'overdue':
      return { dueAt: { lt: startOfDayUtc(today, timezone) }, status: { not: 'DONE' } }
    case 'unscheduled':
      return { dueAt: null }
    default:
      if (/^\d{4}-\d{2}-\d{2}$/.test(due)) {
        return {
          dueAt: {
            gte: startOfDayUtc(due, timezone),
            lt: endOfDayUtc(due, timezone),
          },
        }
      }
      return {}
  }
}

function toSummary(row: TaskRow, completedSubtaskCount: number): TaskSummary {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    notes: row.notes,
    status: row.status,
    priority: row.priority,
    dueAt: row.dueAt?.toISOString() ?? null,
    dueAllDay: row.dueAllDay,
    estimatedMinutes: row.estimatedMinutes,
    completedAt: row.completedAt?.toISOString() ?? null,
    sortOrder: row.sortOrder,
    projectId: row.projectId,
    projectName: row.project?.name ?? null,
    projectColor: row.project?.color ?? null,
    parentTaskId: row.parentTaskId,
    subtaskCount: row._count.subtasks,
    completedSubtaskCount,
    tags: row.tags.map(({ tag }) => ({ id: tag.id, name: tag.name, color: tag.color })),
    recurrenceRule: row.recurrenceRule,
    timeBlockId: row.timeBlockId,
    timeBlockStart: row.timeBlock?.startAt.toISOString() ?? null,
    timeBlockEnd: row.timeBlock?.endAt.toISOString() ?? null,
    reminderMinutesBefore: row.reminderMinutesBefore,
    createdAt: row.createdAt.toISOString(),
  }
}

export async function getTask(userId: string, taskId: string): Promise<TaskSummary> {
  const row = await prisma.task.findFirst({
    where: { id: taskId, userId },
    include: taskInclude,
  })
  if (!row) throw new NotFoundError('That task')

  const completed = await prisma.task.count({
    where: { userId, parentTaskId: taskId, status: 'DONE' },
  })
  return toSummary(row, completed)
}

export async function listSubtasks(
  userId: string,
  parentTaskId: string,
): Promise<TaskSummary[]> {
  const rows = await prisma.task.findMany({
    where: { userId, parentTaskId },
    include: taskInclude,
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  })
  return rows.map((row) => toSummary(row, 0))
}

export async function createTask(
  userId: string,
  input: CreateTaskInput,
): Promise<TaskSummary> {
  // New tasks go to the top of their column rather than the bottom: the thing
  // you just typed is the thing you are thinking about.
  const lowest = await prisma.task.aggregate({
    where: { userId, status: input.status },
    _min: { sortOrder: true },
  })

  const created = await prisma.task.create({
    data: {
      userId,
      title: input.title,
      description: input.description ?? null,
      notes: input.notes ?? null,
      status: input.status,
      priority: input.priority,
      dueAt: input.dueAt ? new Date(input.dueAt) : null,
      dueAllDay: input.dueAllDay,
      timezone: input.timezone ?? null,
      estimatedMinutes: input.estimatedMinutes ?? null,
      projectId: input.projectId ?? null,
      parentTaskId: input.parentTaskId ?? null,
      recurrenceRule: input.recurrenceRule ?? null,
      reminderMinutesBefore: input.reminderMinutesBefore ?? null,
      sortOrder: (lowest._min.sortOrder ?? 0) - 1,
      ...(input.tagIds.length
        ? { tags: { create: input.tagIds.map((tagId) => ({ tagId })) } }
        : {}),
    },
    include: taskInclude,
  })

  await recordAudit({
    userId,
    action: 'task.created',
    entityType: 'Task',
    entityId: created.id,
    metadata: { title: created.title },
  })

  return toSummary(created, 0)
}

export async function updateTask(
  userId: string,
  taskId: string,
  input: UpdateTaskInput,
): Promise<TaskSummary> {
  const existing = await prisma.task.findFirst({
    where: { id: taskId, userId },
    select: { id: true, status: true, recurrenceRule: true, dueAt: true, timezone: true },
  })
  if (!existing) throw new NotFoundError('That task')

  const data: Prisma.TaskUpdateInput = {}
  if (input.title !== undefined) data.title = input.title
  if (input.description !== undefined) data.description = input.description
  if (input.notes !== undefined) data.notes = input.notes
  if (input.priority !== undefined) data.priority = input.priority
  if (input.dueAt !== undefined) data.dueAt = input.dueAt ? new Date(input.dueAt) : null
  if (input.dueAllDay !== undefined) data.dueAllDay = input.dueAllDay
  if (input.estimatedMinutes !== undefined) data.estimatedMinutes = input.estimatedMinutes
  if (input.recurrenceRule !== undefined) data.recurrenceRule = input.recurrenceRule
  if (input.reminderMinutesBefore !== undefined) {
    data.reminderMinutesBefore = input.reminderMinutesBefore
  }
  if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder
  if (input.projectId !== undefined) {
    data.project = input.projectId
      ? { connect: { id: input.projectId } }
      : { disconnect: true }
  }

  if (input.status !== undefined) {
    data.status = input.status
    // completedAt is derived from status, never set independently, so the two
    // can never disagree.
    data.completedAt =
      input.status === 'DONE'
        ? existing.status === 'DONE'
          ? undefined
          : new Date()
        : null
  }

  if (input.tagIds !== undefined) {
    data.tags = {
      deleteMany: {},
      create: input.tagIds.map((tagId) => ({ tagId })),
    }
  }

  const updated = await prisma.task.update({
    where: { id: taskId },
    data,
    include: taskInclude,
  })

  // Completing a repeating task creates the next one rather than closing the
  // series — the whole point of a repeating task.
  if (input.status === 'DONE' && existing.status !== 'DONE' && existing.recurrenceRule) {
    await rollForward(userId, updated)
  }

  if (input.status === 'DONE' && existing.status !== 'DONE') {
    await recordAudit({
      userId,
      action: 'task.completed',
      entityType: 'Task',
      entityId: taskId,
      metadata: { title: updated.title },
    })
  }

  const completed = await prisma.task.count({
    where: { userId, parentTaskId: taskId, status: 'DONE' },
  })
  return toSummary(updated, completed)
}

/** Spawns the next instance of a repeating task from its due date. */
async function rollForward(userId: string, task: TaskRow): Promise<void> {
  if (!task.recurrenceRule || !task.dueAt) return

  const [next] = nextOccurrences(
    {
      rule: task.recurrenceRule,
      dtStart: task.dueAt,
      durationMs: 0,
      timezone: task.timezone ?? 'UTC',
    },
    task.dueAt,
    1,
  )
  if (!next) return

  await prisma.task.create({
    data: {
      userId,
      title: task.title,
      description: task.description,
      notes: task.notes,
      status: 'TODO',
      priority: task.priority,
      dueAt: next.start,
      dueAllDay: task.dueAllDay,
      timezone: task.timezone,
      estimatedMinutes: task.estimatedMinutes,
      projectId: task.projectId,
      recurrenceRule: task.recurrenceRule,
      reminderMinutesBefore: task.reminderMinutesBefore,
      sortOrder: task.sortOrder,
    },
  })
}

export async function deleteTask(userId: string, taskId: string): Promise<void> {
  const existing = await prisma.task.findFirst({
    where: { id: taskId, userId },
    select: { id: true, title: true, timeBlockId: true },
  })
  if (!existing) throw new NotFoundError('That task')

  // The block belongs to the task; removing one without the other would leave
  // an orphan on the calendar with no way back to it.
  if (existing.timeBlockId) {
    await prisma.event.deleteMany({ where: { id: existing.timeBlockId, userId } })
  }
  await prisma.task.delete({ where: { id: taskId } })

  await recordAudit({
    userId,
    action: 'task.deleted',
    entityType: 'Task',
    entityId: taskId,
    metadata: { title: existing.title },
  })
}

/* ---------------------------------------------------------- scheduling */

/**
 * Puts a task on the calendar as a linked block. Re-scheduling an already
 * scheduled task moves its existing block instead of creating a second one.
 */
export async function scheduleTask(
  userId: string,
  taskId: string,
  input: { start: Date; end: Date; calendarId?: string; timezone?: string },
): Promise<TaskSummary> {
  const task = await prisma.task.findFirst({
    where: { id: taskId, userId },
    include: taskInclude,
  })
  if (!task) throw new NotFoundError('That task')

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { timezone: true },
  })
  const timezone = input.timezone ?? task.timezone ?? user.timezone

  if (task.timeBlockId) {
    await prisma.event.update({
      where: { id: task.timeBlockId },
      data: {
        startAt: input.start,
        endAt: input.end,
        timezone,
        ...(input.calendarId ? { calendarId: input.calendarId } : {}),
      },
    })
  } else {
    const calendarId = input.calendarId ?? (await defaultCalendarId(userId))
    if (!calendarId) throw new NotFoundError('A calendar to schedule into')

    const block = await prisma.event.create({
      data: {
        userId,
        calendarId,
        title: task.title,
        description: task.description,
        startAt: input.start,
        endAt: input.end,
        timezone,
        kind: 'TASK_BLOCK',
      },
    })
    await prisma.task.update({
      where: { id: taskId },
      data: { timeBlockId: block.id, status: task.status === 'INBOX' ? 'TODO' : task.status },
    })
  }

  await recordAudit({
    userId,
    action: 'task.scheduled',
    entityType: 'Task',
    entityId: taskId,
    metadata: { start: input.start.toISOString() },
  })

  return getTask(userId, taskId)
}

export async function unscheduleTask(userId: string, taskId: string): Promise<void> {
  const task = await prisma.task.findFirst({
    where: { id: taskId, userId },
    select: { timeBlockId: true },
  })
  if (!task?.timeBlockId) return

  await prisma.$transaction([
    prisma.task.update({ where: { id: taskId }, data: { timeBlockId: null } }),
    prisma.event.deleteMany({ where: { id: task.timeBlockId, userId } }),
  ])
}

export async function reorderTasks(
  userId: string,
  orderedIds: string[],
  patch?: { status?: string; projectId?: string | null },
): Promise<void> {
  const owned = await prisma.task.findMany({
    where: { userId, id: { in: orderedIds } },
    select: { id: true },
  })
  const allowed = new Set(owned.map((task) => task.id))

  await prisma.$transaction(
    orderedIds
      .filter((id) => allowed.has(id))
      .map((id, index) =>
        prisma.task.update({
          where: { id },
          data: {
            sortOrder: index,
            ...(patch?.status ? { status: patch.status as never } : {}),
            ...(patch?.projectId !== undefined ? { projectId: patch.projectId } : {}),
          },
        }),
      ),
  )
}

/* ------------------------------------------------------ projects & tags */

export async function listProjects(userId: string) {
  const rows = await prisma.taskProject.findMany({
    where: { userId, archivedAt: null },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: {
      _count: { select: { tasks: { where: { status: { not: 'DONE' } } } } },
    },
  })
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    color: row.color,
    sortOrder: row.sortOrder,
    openCount: row._count.tasks,
  }))
}

export async function createProject(
  userId: string,
  input: { name: string; color: string },
) {
  const count = await prisma.taskProject.count({ where: { userId } })
  return prisma.taskProject.create({
    data: { ...input, userId, sortOrder: count },
  })
}

export async function listTags(userId: string) {
  return prisma.taskTag.findMany({
    where: { userId },
    orderBy: { name: 'asc' },
  })
}

export async function createTag(
  userId: string,
  input: { name: string; color: string },
) {
  return prisma.taskTag.create({ data: { ...input, userId } })
}
