import 'server-only'

/**
 * The single boundary between "real integration" and "sample data".
 *
 * Nothing outside this file and the mock providers knows demo data exists. The
 * UI asks a provider for calendars or messages and renders whatever comes back;
 * whether that came from Google or from the sample set is decided here, once.
 */

export const DEMO_EMAIL = 'demo@dayflow.local'

export function devLoginEnabled(): boolean {
  return (
    process.env.NODE_ENV !== 'production' && process.env.ALLOW_DEV_LOGIN === 'true'
  )
}

/**
 * True when a provider should fall back to sample data instead of erroring:
 * the environment allows it and no real credentials are configured.
 */
export function sampleProvidersEnabled(): boolean {
  if (process.env.NODE_ENV === 'production') return false
  if (process.env.ALLOW_DEV_LOGIN !== 'true') return false
  return !(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
}
