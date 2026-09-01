import type { NextRequest } from 'next/server'
import { created, ok, parseBody, parseQuery, route } from '@/lib/api'
import { assertSameOrigin, requireUser } from '@/lib/auth'
import { enforce, limits } from '@/lib/rate-limit'
import { createTaskSchema, listTasksQuerySchema } from '@/lib/validation/task'
import { createTask, listTasks } from '@/server/services/tasks'

export const GET = route(async (request: NextRequest) => {
  const user = await requireUser()
  const query = parseQuery(request, listTasksQuerySchema)

  return ok(
    await listTasks(user.id, {
      status: query.status?.split(',').filter(Boolean),
      projectId: query.projectId,
      due: query.due,
      search: query.search,
      includeCompleted: query.includeCompleted === 'true',
      parentTaskId: query.parentTaskId,
      timezone: user.timezone,
    }),
  )
})

export const POST = route(async (request: NextRequest) => {
  await assertSameOrigin()
  const user = await requireUser()
  await enforce('tasks-write', limits.write, user.id)

  const input = await parseBody(request, createTaskSchema)
  return created(await createTask(user.id, input))
})
