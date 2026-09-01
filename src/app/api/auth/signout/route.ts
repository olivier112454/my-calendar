import { NextResponse, type NextRequest } from 'next/server'
import { route } from '@/lib/api'
import { assertSameOrigin } from '@/lib/auth'
import { destroySession, getSession } from '@/lib/session'
import { recordAudit } from '@/server/audit'

export const POST = route(async (request: NextRequest) => {
  await assertSameOrigin()

  const session = await getSession()
  if (session) {
    await recordAudit({ userId: session.user.id, action: 'auth.signout' })
  }
  await destroySession()

  return NextResponse.redirect(new URL('/', request.url), { status: 303 })
})
