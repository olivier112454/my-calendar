import 'server-only'
import { cookies, headers } from 'next/headers'
import { cache } from 'react'
import type { User } from '@prisma/client'
import { prisma } from './db'
import { hashIp, hashToken, randomToken } from './crypto'

/**
 * Session handling.
 *
 * The cookie carries an opaque random token and nothing else — no user id, no
 * claims, nothing an attacker could tamper with. The server stores only the
 * SHA-256 of that token, so a database leak yields no usable sessions, and
 * revoking a session is a single row delete (which a stateless JWT cannot do).
 */

const COOKIE_NAME = 'df_session'
const SESSION_DAYS = 30
/** Skip the lastUsedAt write unless the record is this stale — one UPDATE per
 *  request on every page load is pure write amplification. */
const TOUCH_INTERVAL_MS = 60 * 60 * 1000

export interface SessionContext {
  user: User
  sessionId: string
}

function cookieOptions(expires: Date) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires,
  }
}

export async function createSession(userId: string): Promise<string> {
  const token = randomToken(32)
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000)
  const headerList = await headers()

  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      userAgent: headerList.get('user-agent')?.slice(0, 255) ?? null,
      ipHash: hashIp(clientIp(headerList)),
    },
  })

  const jar = await cookies()
  jar.set(COOKIE_NAME, token, cookieOptions(expiresAt))
  return token
}

/**
 * Resolves the caller. Wrapped in React's `cache` so a request that touches the
 * session from a layout, a page and three server components still runs one query.
 */
export const getSession = cache(async (): Promise<SessionContext | null> => {
  const jar = await cookies()
  const token = jar.get(COOKIE_NAME)?.value
  if (!token) return null

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  })
  if (!session) return null

  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {})
    return null
  }

  if (Date.now() - session.lastUsedAt.getTime() > TOUCH_INTERVAL_MS) {
    await prisma.session
      .update({ where: { id: session.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {})
  }

  return { user: session.user, sessionId: session.id }
})

export async function destroySession(): Promise<void> {
  const jar = await cookies()
  const token = jar.get(COOKIE_NAME)?.value
  if (token) {
    await prisma.session
      .deleteMany({ where: { tokenHash: hashToken(token) } })
      .catch(() => {})
  }
  jar.delete(COOKIE_NAME)
}

/** Sign the user out everywhere — used by "revoke all sessions" in Settings. */
export async function destroyAllSessions(userId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { userId } })
}

export async function clearExpiredSessions(): Promise<number> {
  const { count } = await prisma.session.deleteMany({
    where: { expiresAt: { lte: new Date() } },
  })
  return count
}

function clientIp(headerList: Headers): string | null {
  const forwarded = headerList.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]!.trim()
  return headerList.get('x-real-ip')
}

export { COOKIE_NAME as SESSION_COOKIE }
