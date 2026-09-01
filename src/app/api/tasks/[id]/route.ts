import type { NextRequest } from 'next/server'
import { noContent, ok, parseBody, route } from '@/lib/api'
import { assertSameOrigin, requireUser } from '@/lib/auth'
import { enforce, limits } from '@/lib/rate-limit'
import { updateTaskSchema } from '@/lib/validation/task'
import { deleteTask, getTask, updateTask } from '@/server/services/tasks'

type Params = { params: Promise<{ id: string }> }

export const GET = route(async (_request: NextRequest, { params }: Params) => {
  const user = await requireUser()
  const { id } = await params
  return ok(await getTask(user.id, id))
})

export const PATCH = route(async (request: NextRequest, { params }: Params) => {
  await assertSameOrigin()
  const user = await requireUser()
  await enforce('tasks-write', limits.write, user.id)

  const { id } = await params
  const input = await parseBody(request, updateTaskSchema)
  return ok(await updateTask(user.id, id, input))
})

export const DELETE = route(async (_request: NextRequest, { params }: Params) => {
  await assertSameOrigin()
  const user = await requireUser()
  const { id } = await params

  await deleteTask(user.id, id)
  return noContent()
})
