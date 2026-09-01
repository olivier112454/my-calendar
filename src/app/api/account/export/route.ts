import { route } from '@/lib/api'
import { requireUser } from '@/lib/auth'
import { enforce } from '@/lib/rate-limit'
import { exportUserData } from '@/server/services/settings'
import { recordAudit } from '@/server/audit'

/**
 * Everything the app holds about the signed-in user, as a JSON download.
 * Credentials are deliberately excluded — an export should never carry a token.
 */
export const GET = route(async () => {
  const user = await requireUser()
  await enforce('export', { limit: 5, windowMs: 60 * 60 * 1000 }, user.id)

  const data = await exportUserData(user.id)
  await recordAudit({ userId: user.id, action: 'account.exported' })

  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="dayflow-export-${
        new Date().toISOString().slice(0, 10)
      }.json"`,
      'Cache-Control': 'no-store',
    },
  })
})
