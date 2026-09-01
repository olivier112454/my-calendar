import { ok, route } from '@/lib/api'
import { requireUser } from '@/lib/auth'
import { listIntegrations } from '@/server/services/settings'

export const GET = route(async () => {
  const user = await requireUser()
  return ok(await listIntegrations(user.id))
})
