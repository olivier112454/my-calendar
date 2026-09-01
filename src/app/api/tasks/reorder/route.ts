import type { NextRequest } from 'next/server'
import { ok, parseBody, route } from '@/lib/api'
import { assertSameOrigin, requireUser } from '@/lib/auth'
import { reorderTasksSchema } from '@/lib/validation/task'
import { reorderTasks } from '@/server/services/tasks'

export const POST = route(async (request: NextRequest) => {
  await assertSameOrigin()
  const user = await requireUser()

  const input = await parseBody(request, reorderTasksSchema)
  await reorderTasks(user.id, input.orderedIds, {
    status: input.status,
    projectId: input.projectId,
  })

  return ok({ updated: input.orderedIds.length })
})
