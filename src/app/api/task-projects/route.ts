import type { NextRequest } from 'next/server'
import { created, ok, parseBody, route } from '@/lib/api'
import { assertSameOrigin, requireUser } from '@/lib/auth'
import { createProjectSchema } from '@/lib/validation/task'
import { createProject, listProjects } from '@/server/services/tasks'

export const GET = route(async () => {
  const user = await requireUser()
  return ok(await listProjects(user.id))
})

export const POST = route(async (request: NextRequest) => {
  await assertSameOrigin()
  const user = await requireUser()
  const input = await parseBody(request, createProjectSchema)
  return created(await createProject(user.id, input))
})
