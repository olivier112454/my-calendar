import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { ok, parseBody, route } from '@/lib/api'
import { assertSameOrigin, requireUser } from '@/lib/auth'
import { getSession } from '@/lib/session'
import {
  listSessions,
  revokeOtherSessions,
  revokeSession,
} from '@/server/services/settings'
import { recordAudit } from '@/server/audit'

const deleteSchema = z.object({
  /** Omit to revoke every session except the current one. */
  sessionId: z.string().uuid().optional(),
})

export const GET = route(async () => {
  const session = await getSession()
  const user = await requireUser()
  return ok(await listSessions(user.id, session?.sessionId ?? ''))
})

export const DELETE = route(async (request: NextRequest) => {
  await assertSameOrigin()
  const session = await getSession()
  const user = await requireUser()

  let input: { sessionId?: string } = {}
  try {
    input = await parseBody(request, deleteSchema)
  } catch {
    /* no body means "all other sessions" */
  }

  if (input.sessionId) {
    await revokeSession(user.id, input.sessionId)
    await recordAudit({ userId: user.id, action: 'auth.session_revoked' })
    return ok({ revoked: 1 })
  }

  const revoked = await revokeOtherSessions(user.id, session?.sessionId ?? '')
  await recordAudit({
    userId: user.id,
    action: 'auth.sessions_revoked',
    metadata: { count: revoked },
  })
  return ok({ revoked })
})
