import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { route, fail } from '@/lib/api'
import { assertSameOrigin } from '@/lib/auth'
import { createSession } from '@/lib/session'
import { bootstrapUser } from '@/server/services/bootstrap'
import { devLoginEnabled, DEMO_EMAIL } from '@/server/demo'

/**
 * Password-less sign-in for local development and demos.
 *
 * Refuses to run in production and refuses to run unless ALLOW_DEV_LOGIN is
 * explicitly "true" — two independent switches, because an accidental
 * authentication bypass is the worst bug this codebase could ship.
 */
export const POST = route(async (request: NextRequest) => {
  await assertSameOrigin()

  if (!devLoginEnabled()) {
    return fail('Demo sign-in is disabled on this server.', 'forbidden', 403)
  }

  let user = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } })
  if (!user) {
    user = await prisma.user.create({
      data: {
        email: DEMO_EMAIL,
        name: 'Olivier Pinkster',
        timezone: 'Europe/Amsterdam',
      },
    })
    await bootstrapUser(user.id)
  }

  await createSession(user.id)

  return NextResponse.redirect(new URL('/today', request.url), { status: 303 })
})
