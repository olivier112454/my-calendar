import 'server-only'
import { createHash, randomBytes } from 'node:crypto'
import { prisma } from '@/lib/db'
import { encryptSecret, randomToken, tryDecryptSecret } from '@/lib/crypto'
import { AppError } from '@/lib/api'
import type { IntegrationAccount } from '@prisma/client'

/**
 * Google OAuth 2.0, authorization-code flow with PKCE.
 *
 * Security properties this implementation guarantees:
 *  - `state` is a random token stored server-side and deleted on use, so a
 *    replayed or forged callback cannot be redeemed (CSRF).
 *  - PKCE (S256) means an intercepted authorization code is useless without the
 *    verifier, which never leaves the server.
 *  - Refresh and access tokens are encrypted before they touch the database and
 *    are never serialised into any client payload.
 *  - Scopes are requested incrementally: signing in asks only for identity, and
 *    calendar/mail/contacts access is requested when the user connects that
 *    feature, so nobody is confronted with a wall of permissions up front.
 */

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke'
const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo'

const STATE_TTL_MS = 10 * 60 * 1000
/** Refresh a little early so a long request never starts with a dead token. */
const REFRESH_SKEW_MS = 2 * 60 * 1000

export const GoogleScopes = {
  identity: ['openid', 'email', 'profile'],
  calendar: ['https://www.googleapis.com/auth/calendar'],
  gmail: ['https://www.googleapis.com/auth/gmail.readonly'],
  contacts: ['https://www.googleapis.com/auth/contacts.readonly'],
} as const

export type GoogleScopeGroup = keyof typeof GoogleScopes

/** Human descriptions shown on the consent screen we render before Google's. */
export const scopeDescriptions: Record<
  GoogleScopeGroup,
  { title: string; description: string; required?: boolean }
> = {
  identity: {
    title: 'Your name and email address',
    description: 'Used to create your account and show who you are signed in as.',
    required: true,
  },
  calendar: {
    title: 'Google Calendar',
    description:
      'Read your calendars and events, and create or change events you make here. Two-way sync.',
  },
  gmail: {
    title: 'Gmail (read-only)',
    description:
      'Read message headers and snippets to spot meetings, reservations and travel. Message bodies are never stored.',
  },
  contacts: {
    title: 'Google Contacts (read-only)',
    description: 'Suggest guests by name and show who you meet most.',
  },
}

export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
}

function requireConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI ??
    `${process.env.APP_URL ?? 'http://localhost:3000'}/api/integrations/google/callback`

  if (!clientId || !clientSecret) {
    throw new AppError(
      'Google is not configured on this server yet.',
      'google_not_configured',
      503,
    )
  }
  return { clientId, clientSecret, redirectUri }
}

/* ------------------------------------------------------------------ start */

export interface AuthUrlOptions {
  /** Which permission groups to ask for. `identity` is always included. */
  scopeGroups: GoogleScopeGroup[]
  /** Set when an already-signed-in user connects an extra account. */
  userId?: string
  /** Where to send the browser once the callback finishes. */
  redirectTo?: string
  /** Force the account chooser — needed to connect a *second* Google account. */
  forceAccountPicker?: boolean
}

export async function createAuthUrl(options: AuthUrlOptions): Promise<string> {
  const { clientId, redirectUri } = requireConfig()

  const scopes = Array.from(
    new Set([
      ...GoogleScopes.identity,
      ...options.scopeGroups.flatMap((group) => GoogleScopes[group]),
    ]),
  )

  const state = randomToken(24)
  const codeVerifier = randomBytes(48).toString('base64url')
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')
  const nonce = randomToken(16)

  await prisma.oAuthState.create({
    data: {
      state,
      codeVerifier,
      nonce,
      userId: options.userId ?? null,
      redirectTo: options.redirectTo ?? null,
      scopes,
      expiresAt: new Date(Date.now() + STATE_TTL_MS),
    },
  })

  // Housekeeping: drop stale handshakes so the table cannot grow unbounded.
  await prisma.oAuthState
    .deleteMany({ where: { expiresAt: { lt: new Date() } } })
    .catch(() => {})

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes.join(' '),
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    // offline + consent is what actually yields a refresh token; without it
    // Google returns one only on the very first authorisation ever.
    access_type: 'offline',
    prompt: options.forceAccountPicker ? 'consent select_account' : 'consent',
    include_granted_scopes: 'true',
  })

  return `${AUTH_ENDPOINT}?${params.toString()}`
}

/* --------------------------------------------------------------- callback */

export interface ConsumedState {
  userId: string | null
  redirectTo: string | null
  codeVerifier: string
}

/** Single-use: the record is deleted as it is read, so a replay finds nothing. */
export async function consumeState(state: string): Promise<ConsumedState> {
  const record = await prisma.oAuthState.findUnique({ where: { state } })
  if (!record) {
    throw new AppError(
      'This sign-in link has already been used or has expired. Please try again.',
      'invalid_state',
      400,
    )
  }
  await prisma.oAuthState.delete({ where: { id: record.id } }).catch(() => {})

  if (record.expiresAt.getTime() < Date.now()) {
    throw new AppError(
      'This sign-in attempt took too long. Please try again.',
      'expired_state',
      400,
    )
  }

  return {
    userId: record.userId,
    redirectTo: record.redirectTo,
    codeVerifier: record.codeVerifier,
  }
}

export interface GoogleTokens {
  accessToken: string
  refreshToken: string | null
  expiresAt: Date
  scopes: string[]
}

export async function exchangeCode(
  code: string,
  codeVerifier: string,
): Promise<GoogleTokens> {
  const { clientId, clientSecret, redirectUri } = requireConfig()

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
    }),
  })

  if (!response.ok) {
    const detail = await response.text()
    console.error('[google-oauth] token exchange failed', response.status, detail)
    throw new AppError(
      'Google refused the sign-in. Please try connecting again.',
      'token_exchange_failed',
      502,
    )
  }

  const payload = (await response.json()) as {
    access_token: string
    refresh_token?: string
    expires_in: number
    scope?: string
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? null,
    expiresAt: new Date(Date.now() + payload.expires_in * 1000),
    scopes: payload.scope?.split(' ') ?? [],
  }
}

export interface GoogleProfile {
  sub: string
  email: string
  name?: string
  picture?: string
}

export async function fetchProfile(accessToken: string): Promise<GoogleProfile> {
  const response = await fetch(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) {
    throw new AppError('Could not read your Google profile.', 'profile_failed', 502)
  }
  const payload = (await response.json()) as {
    sub: string
    email?: string
    name?: string
    picture?: string
  }
  if (!payload.email) {
    throw new AppError(
      'Your Google account did not share an email address.',
      'missing_email',
      400,
    )
  }
  return {
    sub: payload.sub,
    email: payload.email.toLowerCase(),
    name: payload.name,
    picture: payload.picture,
  }
}

/* ---------------------------------------------------------------- refresh */

/**
 * Returns a usable access token for an account, refreshing it if needed.
 *
 * A failed refresh means the user revoked access or changed their password:
 * the account is flagged NEEDS_REAUTH rather than deleted, so the UI can offer
 * "Reconnect" and the user keeps their calendars and their sync history.
 */
export async function getAccessToken(account: IntegrationAccount): Promise<string> {
  const current = tryDecryptSecret(account.accessTokenEnc)
  const expiresAt = account.tokenExpiresAt?.getTime() ?? 0

  if (current && expiresAt - REFRESH_SKEW_MS > Date.now()) return current

  const refreshToken = tryDecryptSecret(account.refreshTokenEnc)
  if (!refreshToken) {
    await markNeedsReauth(account.id, 'No refresh token stored')
    throw new AppError(
      'Your Google connection needs to be renewed.',
      'needs_reauth',
      401,
    )
  }

  const { clientId, clientSecret } = requireConfig()
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })

  if (!response.ok) {
    const detail = await response.text()
    console.error('[google-oauth] refresh failed', response.status, detail)
    await markNeedsReauth(account.id, `Refresh failed (${response.status})`)
    throw new AppError(
      'Your Google connection needs to be renewed.',
      'needs_reauth',
      401,
    )
  }

  const payload = (await response.json()) as {
    access_token: string
    expires_in: number
    refresh_token?: string
  }

  const newExpiry = new Date(Date.now() + payload.expires_in * 1000)
  await prisma.integrationAccount.update({
    where: { id: account.id },
    data: {
      accessTokenEnc: encryptSecret(payload.access_token),
      // Google occasionally rotates the refresh token; keep the old one if not.
      ...(payload.refresh_token
        ? { refreshTokenEnc: encryptSecret(payload.refresh_token) }
        : {}),
      tokenExpiresAt: newExpiry,
      status: 'ACTIVE',
      lastError: null,
    },
  })

  return payload.access_token
}

async function markNeedsReauth(accountId: string, reason: string) {
  await prisma.integrationAccount
    .update({
      where: { id: accountId },
      data: { status: 'NEEDS_REAUTH', lastError: reason },
    })
    .catch(() => {})
}

/** Tells Google to forget us, then removes our copy of the credentials. */
export async function revokeAccount(account: IntegrationAccount): Promise<void> {
  const token =
    tryDecryptSecret(account.refreshTokenEnc) ?? tryDecryptSecret(account.accessTokenEnc)
  if (token) {
    await fetch(REVOKE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
    }).catch(() => {
      // Best effort: if Google is unreachable we still drop our own copy below.
    })
  }
}

export { encryptSecret }
