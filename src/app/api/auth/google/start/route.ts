import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { route, parseQuery } from '@/lib/api'
import { enforce, limits } from '@/lib/rate-limit'
import { getSession } from '@/lib/session'
import {
  createAuthUrl,
  googleConfigured,
  type GoogleScopeGroup,
} from '@/server/providers/google/oauth'

const querySchema = z.object({
  /** Comma-separated permission groups, e.g. "calendar,gmail". */
  scopes: z.string().optional(),
  next: z.string().optional(),
  /** "1" forces the Google account chooser — needed to add a second account. */
  chooser: z.string().optional(),
})

const VALID_GROUPS: GoogleScopeGroup[] = ['calendar', 'gmail', 'contacts']

/**
 * Kicks off the Google handshake. Works for two cases with one route:
 *   - signed out -> sign in (identity scopes only)
 *   - signed in  -> connect a service, or an additional Google account
 */
export const GET = route(async (request: NextRequest) => {
  await enforce('oauth-start', limits.oauth)

  if (!googleConfigured()) {
    return NextResponse.redirect(
      new URL('/?error=google_not_configured', request.url),
    )
  }

  const { scopes, next, chooser } = parseQuery(request, querySchema)
  const session = await getSession()

  const scopeGroups = (scopes?.split(',').filter(Boolean) ?? []).filter(
    (group): group is GoogleScopeGroup =>
      (VALID_GROUPS as string[]).includes(group),
  )

  // Only ever redirect to a path on this app — an open redirect here would let
  // an attacker bounce a freshly authenticated user to their own site.
  const redirectTo = next && next.startsWith('/') && !next.startsWith('//') ? next : null

  const url = await createAuthUrl({
    scopeGroups,
    userId: session?.user.id,
    redirectTo: redirectTo ?? undefined,
    forceAccountPicker: chooser === '1' || Boolean(session),
  })

  return NextResponse.redirect(url)
})
