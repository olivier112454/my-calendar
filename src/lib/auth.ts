import 'server-only'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import type { User, UserSettings } from '@prisma/client'
import { prisma } from './db'
import { getSession } from './session'

/**
 * Authorisation helpers.
 *
 * Every server action and route handler starts by calling one of these. There
 * is no ambient "current user" that a query can accidentally forget: the user id
 * is passed explicitly into each service call, and every service scopes its
 * queries by it. That is what keeps user A out of user B's data.
 */

export class UnauthorizedError extends Error {
  constructor(message = 'You must be signed in') {
    super(message)
    this.name = 'UnauthorizedError'
  }
}

export class ForbiddenError extends Error {
  constructor(message = 'You do not have access to this') {
    super(message)
    this.name = 'ForbiddenError'
  }
}

export async function currentUser(): Promise<User | null> {
  const session = await getSession()
  return session?.user ?? null
}

/** Throws for API routes and server actions. */
export async function requireUser(): Promise<User> {
  const session = await getSession()
  if (!session) throw new UnauthorizedError()
  return session.user
}

/** Redirects for pages — a signed-out visitor lands on the sign-in screen. */
export async function requireUserPage(returnTo?: string): Promise<User> {
  const session = await getSession()
  if (!session) {
    const target = returnTo ? `/?next=${encodeURIComponent(returnTo)}` : '/'
    redirect(target)
  }
  return session.user
}

export type UserWithSettings = User & { settings: UserSettings }

/**
 * The user plus their settings, creating the settings row on first access so no
 * caller has to deal with a null.
 */
export async function requireUserWithSettings(): Promise<UserWithSettings> {
  const user = await requireUser()
  const settings = await ensureSettings(user.id)
  return { ...user, settings }
}

export async function ensureSettings(userId: string): Promise<UserSettings> {
  const existing = await prisma.userSettings.findUnique({ where: { userId } })
  if (existing) return existing
  return prisma.userSettings.create({ data: { userId } })
}

/**
 * Confirms a record belongs to the caller before it is read or written.
 * Used for every id that arrives from the client — the defence against IDOR.
 */
export function assertOwnership(
  record: { userId: string } | null | undefined,
  userId: string,
  what = 'record',
): asserts record is { userId: string } {
  if (!record) throw new ForbiddenError(`That ${what} does not exist`)
  if (record.userId !== userId) throw new ForbiddenError(`That ${what} does not exist`)
}

/**
 * Rejects cross-site state changes. SameSite=Lax already blocks the common
 * cases; this closes the gap for top-level POST navigations, which Lax allows.
 */
export async function assertSameOrigin(): Promise<void> {
  const headerList = await headers()
  const origin = headerList.get('origin')
  if (!origin) return // same-origin fetches from the app omit Origin on GET
  const host = headerList.get('host')
  const allowed = new Set<string>()
  if (host) {
    allowed.add(`http://${host}`)
    allowed.add(`https://${host}`)
  }
  if (process.env.APP_URL) allowed.add(process.env.APP_URL.replace(/\/$/, ''))
  if (!allowed.has(origin)) {
    throw new ForbiddenError('Cross-origin request rejected')
  }
}

export { getSession }
