import 'server-only'
import type { IntegrationAccount } from '@prisma/client'
import { ProviderError } from '../types'
import { getAccessToken } from './oauth'

/**
 * HTTP client for the Google APIs.
 *
 * Written against `fetch` rather than the `googleapis` package: this app calls a
 * dozen endpoints, and the package is tens of megabytes of generated code for
 * hundreds it will never touch. What we do need — auth refresh, retry on
 * throttling, and errors phrased for a person — is the code below.
 */

const MAX_ATTEMPTS = 3
const BASE_BACKOFF_MS = 400

export interface GoogleRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  query?: Record<string, string | number | boolean | undefined | null>
  body?: unknown
  /** Overrides the default JSON accept header (used for .ics downloads). */
  accept?: string
}

export async function googleFetch<T>(
  account: IntegrationAccount,
  url: string,
  options: GoogleRequestOptions = {},
): Promise<T> {
  const target = new URL(url)
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value === undefined || value === null || value === '') continue
    target.searchParams.set(key, String(value))
  }

  let lastError: unknown

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // Fetched inside the loop: a 401 on the first try is usually a token that
    // expired mid-flight, and the refresh happens here.
    const token = await getAccessToken(account)

    let response: Response
    try {
      response = await fetch(target, {
        method: options.method ?? 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: options.accept ?? 'application/json',
          ...(options.body !== undefined
            ? { 'Content-Type': 'application/json' }
            : {}),
        },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        // Provider data is never cached by the framework; the sync layer owns
        // freshness through its own tokens.
        cache: 'no-store',
      })
    } catch (cause) {
      lastError = cause
      if (attempt < MAX_ATTEMPTS - 1) {
        await sleep(BASE_BACKOFF_MS * 2 ** attempt)
        continue
      }
      throw new ProviderError(
        'Could not reach Google. Check your connection and try again.',
        'unavailable',
        true,
        cause,
      )
    }

    if (response.status === 204) return undefined as T
    if (response.ok) {
      if (options.accept && !options.accept.includes('json')) {
        return (await response.text()) as T
      }
      return (await response.json()) as T
    }

    const detail = await response.text().catch(() => '')

    // 410 means "your sync token is too old" — an expected part of incremental
    // sync, not an error. The caller turns it into a full resync.
    if (response.status === 410) {
      throw new ProviderError('Sync token expired', 'conflict', false, detail)
    }

    if (response.status === 401) {
      throw new ProviderError(
        'Your Google connection needs to be renewed.',
        'unauthorized',
        false,
        detail,
      )
    }

    if (response.status === 403 && /rateLimitExceeded|userRateLimit/i.test(detail)) {
      if (attempt < MAX_ATTEMPTS - 1) {
        await sleep(BASE_BACKOFF_MS * 2 ** attempt + jitter())
        continue
      }
      throw new ProviderError(
        'Google is rate-limiting this account. Try again in a minute.',
        'rate_limited',
        true,
        detail,
      )
    }

    if (response.status === 403) {
      throw new ProviderError(
        'Google refused that request. The account may not have granted this permission.',
        'unauthorized',
        false,
        detail,
      )
    }

    if (response.status === 404) {
      throw new ProviderError('That item no longer exists in Google.', 'not_found', false, detail)
    }

    if (response.status === 429 || response.status >= 500) {
      if (attempt < MAX_ATTEMPTS - 1) {
        await sleep(BASE_BACKOFF_MS * 2 ** attempt + jitter())
        continue
      }
      throw new ProviderError(
        'Google is having trouble right now. The sync will retry shortly.',
        response.status === 429 ? 'rate_limited' : 'unavailable',
        true,
        detail,
      )
    }

    console.error('[google] request failed', response.status, target.pathname, detail)
    throw new ProviderError(
      'Google rejected that request.',
      'unknown',
      false,
      detail,
    )
  }

  throw new ProviderError('Google request failed', 'unknown', false, lastError)
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Spreads retries so several syncs do not stampede the same second. */
function jitter() {
  return Math.floor(Math.random() * 250)
}

export const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3'
export const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1'
export const PEOPLE_API = 'https://people.googleapis.com/v1'
