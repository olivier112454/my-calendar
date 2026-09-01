import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { route } from '@/lib/api'
import { enforce, limits } from '@/lib/rate-limit'
import { createSession, getSession } from '@/lib/session'
import { encryptSecret } from '@/lib/crypto'
import { recordAudit } from '@/server/audit'
import { bootstrapUser } from '@/server/services/bootstrap'
import {
  consumeState,
  exchangeCode,
  fetchProfile,
} from '@/server/providers/google/oauth'

/**
 * The single Google redirect URI. It finishes three different journeys:
 *
 *   1. Signing in for the first time    -> create user + session
 *   2. Signing in again                 -> reuse user + new session
 *   3. Connecting another account/scope -> attach to the signed-in user
 *
 * Which one applies is decided by the server-side state record, never by a
 * query parameter the browser could tamper with.
 */
export const GET = route(async (request: NextRequest) => {
  await enforce('oauth-callback', limits.oauth)

  const url = new URL(request.url)
  const error = url.searchParams.get('error')
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')

  if (error) {
    // The user pressed "Cancel" on Google's consent screen — not a failure.
    const target = error === 'access_denied' ? '/?notice=google_cancelled' : '/?error=google_failed'
    return NextResponse.redirect(new URL(target, url.origin))
  }
  if (!code || !state) {
    return NextResponse.redirect(new URL('/?error=google_failed', url.origin))
  }

  const { userId: stateUserId, redirectTo, codeVerifier } = await consumeState(state)

  const tokens = await exchangeCode(code, codeVerifier)
  const profile = await fetchProfile(tokens.accessToken)

  const session = await getSession()
  // A state record created while signed in wins; otherwise fall back to the
  // live session so a re-consent from an open tab still attaches correctly.
  const connectingUserId = stateUserId ?? session?.user.id ?? null

  let userId: string
  let isNewUser = false

  if (connectingUserId) {
    userId = connectingUserId
  } else {
    const existing = await prisma.user.findUnique({
      where: { email: profile.email },
      select: { id: true },
    })
    if (existing) {
      userId = existing.id
    } else {
      const created = await prisma.user.create({
        data: {
          email: profile.email,
          name: profile.name ?? null,
          avatarUrl: profile.picture ?? null,
        },
        select: { id: true },
      })
      userId = created.id
      isNewUser = true
    }
  }

  const isPrimary = !connectingUserId

  await prisma.integrationAccount.upsert({
    where: {
      userId_provider_providerAccountId: {
        userId,
        provider: 'GOOGLE',
        providerAccountId: profile.sub,
      },
    },
    create: {
      userId,
      provider: 'GOOGLE',
      providerAccountId: profile.sub,
      email: profile.email,
      displayName: profile.name ?? profile.email,
      avatarUrl: profile.picture ?? null,
      accessTokenEnc: encryptSecret(tokens.accessToken),
      refreshTokenEnc: tokens.refreshToken ? encryptSecret(tokens.refreshToken) : null,
      tokenExpiresAt: tokens.expiresAt,
      scopes: tokens.scopes,
      status: 'ACTIVE',
      isPrimary,
    },
    update: {
      email: profile.email,
      displayName: profile.name ?? profile.email,
      avatarUrl: profile.picture ?? null,
      accessTokenEnc: encryptSecret(tokens.accessToken),
      // Google omits the refresh token on re-consent when it has not rotated;
      // overwriting with null there would silently break background sync.
      ...(tokens.refreshToken
        ? { refreshTokenEnc: encryptSecret(tokens.refreshToken) }
        : {}),
      tokenExpiresAt: tokens.expiresAt,
      // Scopes accumulate across incremental consents.
      scopes: tokens.scopes,
      status: 'ACTIVE',
      lastError: null,
    },
  })

  if (isNewUser) {
    await bootstrapUser(userId)
  }

  if (!session) {
    await createSession(userId)
  }

  await recordAudit({
    userId,
    action: connectingUserId ? 'integration.connected' : 'auth.signin',
    entityType: 'IntegrationAccount',
    metadata: { provider: 'GOOGLE', email: profile.email, scopes: tokens.scopes },
  })

  const destination = isNewUser
    ? '/onboarding'
    : (redirectTo ?? (connectingUserId ? '/settings/integrations' : '/today'))

  return NextResponse.redirect(new URL(destination, url.origin))
})
