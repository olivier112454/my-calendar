import type { NextRequest } from 'next/server'
import { noContent, ok, parseBody, route } from '@/lib/api'
import { assertSameOrigin, requireUser } from '@/lib/auth'
import { enforce, limits } from '@/lib/rate-limit'
import { scheduleTaskSchema } from '@/lib/validation/task'
import { scheduleTask, unscheduleTask } from '@/server/services/tasks'

type Params = { params: Promise<{ id: string }> }

/** POST schedules (or moves) the task's calendar block; DELETE removes it. */
export const POST = route(async (request: NextRequest, { params }: Params) => {
  await assertSameOrigin()
  const user = await requireUser()
  await enforce('tasks-write', limits.write, user.id)

  const { id } = await params
  const input = await parseBody(request, scheduleTaskSchema)

  return ok(
    await scheduleTask(user.id, id, {
      start: new Date(input.start),
      end: new Date(input.end),
      calendarId: input.calendarId,
      timezone: input.timezone,
    }),
  )
})

export const DELETE = route(async (_request: NextRequest, { params }: Params) => {
  await assertSameOrigin()
  const user = await requireUser()
  const { id } = await params

  await unscheduleTask(user.id, id)
  return noContent()
})
