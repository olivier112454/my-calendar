import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { ok, parseBody, route } from '@/lib/api'
import { assertSameOrigin, requireUser } from '@/lib/auth'
import { setVisibility, reorderCalendars } from '@/server/services/calendars'

const schema = z.object({
  visibleIds: z.array(z.string().uuid()).max(200).optional(),
  orderedIds: z.array(z.string().uuid()).max(200).optional(),
})

/** Bulk visibility and ordering — one round trip for "show only this calendar". */
export const POST = route(async (request: NextRequest) => {
  await assertSameOrigin()
  const user = await requireUser()
  const input = await parseBody(request, schema)

  if (input.visibleIds) await setVisibility(user.id, input.visibleIds)
  if (input.orderedIds) await reorderCalendars(user.id, input.orderedIds)

  return ok({ updated: true })
})
