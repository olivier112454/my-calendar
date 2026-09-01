import { ok, route } from '@/lib/api'
import { assertSameOrigin, requireUser } from '@/lib/auth'
import { enforce, limits } from '@/lib/rate-limit'
import { syncContacts } from '@/server/services/contacts'

export const POST = route(async () => {
  await assertSameOrigin()
  const user = await requireUser()
  await enforce('sync', limits.sync, user.id)

  return ok(await syncContacts(user.id))
})
