import 'server-only'
import type { IntegrationAccount, Provider } from '@prisma/client'
import { prisma } from '@/lib/db'
import { AppError } from '@/lib/api'
import { sampleProvidersEnabled } from '@/server/demo'
import type {
  CalendarProvider,
  ContactsProvider,
  MailProvider,
  ProviderCapabilities,
} from './types'
import { GoogleCalendarProvider } from './google/calendar'
import { GmailProvider } from './google/gmail'
import { GoogleContactsProvider } from './google/people'
import { MockMailProvider } from './mock/mail'
import { GoogleScopes } from './google/oauth'

/**
 * Resolves the right implementation for a connected account.
 *
 * This is the only place that maps a provider enum to a class. Adding Microsoft
 * means writing the three classes and extending the switches here; nothing in
 * the services or the UI changes.
 */

export function calendarProviderFor(account: IntegrationAccount): CalendarProvider {
  switch (account.provider) {
    case 'GOOGLE':
      return new GoogleCalendarProvider(account)
    default:
      throw new AppError(
        `Calendar sync for ${account.provider} is not available yet.`,
        'provider_unsupported',
        400,
      )
  }
}

export function mailProviderFor(account: IntegrationAccount): MailProvider {
  if (sampleProvidersEnabled()) return new MockMailProvider(account)

  switch (account.provider) {
    case 'GOOGLE':
      return new GmailProvider(account)
    default:
      throw new AppError(
        `Mail for ${account.provider} is not available yet.`,
        'provider_unsupported',
        400,
      )
  }
}

export function contactsProviderFor(account: IntegrationAccount): ContactsProvider {
  switch (account.provider) {
    case 'GOOGLE':
      return new GoogleContactsProvider(account)
    default:
      throw new AppError(
        `Contacts for ${account.provider} are not available yet.`,
        'provider_unsupported',
        400,
      )
  }
}

/** What a provider can do at all, before considering granted scopes. */
export function capabilitiesOf(provider: Provider): ProviderCapabilities {
  switch (provider) {
    case 'GOOGLE':
      return {
        calendar: true,
        mail: true,
        contacts: true,
        createsMeetingLinks: true,
        incrementalSync: true,
      }
    case 'MICROSOFT':
    case 'APPLE':
    case 'CALDAV':
      return {
        calendar: false,
        mail: false,
        contacts: false,
        createsMeetingLinks: false,
        incrementalSync: false,
      }
    default:
      return {
        calendar: false,
        mail: false,
        contacts: false,
        createsMeetingLinks: false,
        incrementalSync: false,
      }
  }
}

/** What this particular connection is actually allowed to do right now. */
export function grantedCapabilities(account: IntegrationAccount): ProviderCapabilities {
  const base = capabilitiesOf(account.provider)
  if (account.provider !== 'GOOGLE') return base

  const has = (scopes: readonly string[]) =>
    scopes.some((scope) => account.scopes.includes(scope))

  return {
    ...base,
    calendar: base.calendar && has(GoogleScopes.calendar),
    mail: (base.mail && has(GoogleScopes.gmail)) || sampleProvidersEnabled(),
    contacts: base.contacts && has(GoogleScopes.contacts),
  }
}

/* -------------------------------------------------------------- lookups */

export async function accountsFor(
  userId: string,
  provider?: Provider,
): Promise<IntegrationAccount[]> {
  return prisma.integrationAccount.findMany({
    where: {
      userId,
      ...(provider ? { provider } : {}),
      status: { in: ['ACTIVE', 'NEEDS_REAUTH'] },
    },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
  })
}

export async function accountFor(
  userId: string,
  accountId: string,
): Promise<IntegrationAccount> {
  const account = await prisma.integrationAccount.findFirst({
    where: { id: accountId, userId },
  })
  if (!account) {
    throw new AppError('That connected account no longer exists.', 'not_found', 404)
  }
  return account
}

/** Accounts that can currently serve mail — used by the Inbox page. */
export async function mailAccountsFor(userId: string): Promise<IntegrationAccount[]> {
  const accounts = await accountsFor(userId)
  return accounts.filter((account) => grantedCapabilities(account).mail)
}

export async function calendarAccountsFor(userId: string): Promise<IntegrationAccount[]> {
  const accounts = await accountsFor(userId)
  return accounts.filter((account) => grantedCapabilities(account).calendar)
}
