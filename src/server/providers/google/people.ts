import 'server-only'
import type { IntegrationAccount } from '@prisma/client'
import type { ContactsProvider, RemoteContact } from '../types'
import { PEOPLE_API, googleFetch } from './client'

/**
 * Google Contacts through the People API. Read-only: the app suggests guests
 * and shows who you meet, but it is not an address-book editor, so it never
 * writes back.
 */

interface GooglePerson {
  resourceName?: string
  names?: { displayName?: string; metadata?: { primary?: boolean } }[]
  emailAddresses?: { value?: string; metadata?: { primary?: boolean } }[]
  phoneNumbers?: { value?: string; metadata?: { primary?: boolean } }[]
  organizations?: { name?: string; title?: string }[]
  photos?: { url?: string; metadata?: { primary?: boolean } }[]
  birthdays?: { date?: { year?: number; month?: number; day?: number } }[]
}

const PERSON_FIELDS =
  'names,emailAddresses,phoneNumbers,organizations,photos,birthdays'

export class GoogleContactsProvider implements ContactsProvider {
  readonly provider = 'GOOGLE' as const

  constructor(readonly account: IntegrationAccount) {}

  async listContacts(pageToken?: string | null): Promise<{
    contacts: RemoteContact[]
    nextPageToken: string | null
  }> {
    const response = await googleFetch<{
      connections?: GooglePerson[]
      nextPageToken?: string
    }>(this.account, `${PEOPLE_API}/people/me/connections`, {
      query: {
        personFields: PERSON_FIELDS,
        pageSize: 200,
        sortOrder: 'LAST_MODIFIED_DESCENDING',
        pageToken: pageToken ?? undefined,
      },
    })

    const contacts = (response.connections ?? [])
      .map((person) => this.toRemoteContact(person))
      // A contact with neither a name nor an address is not useful to anyone.
      .filter((contact): contact is RemoteContact => contact !== null)

    return { contacts, nextPageToken: response.nextPageToken ?? null }
  }

  private toRemoteContact(person: GooglePerson): RemoteContact | null {
    const externalId = person.resourceName
    if (!externalId) return null

    const primary = <T extends { metadata?: { primary?: boolean } }>(
      list: T[] | undefined,
    ): T | undefined => list?.find((entry) => entry.metadata?.primary) ?? list?.[0]

    const name = primary(person.names)?.displayName ?? null
    const email = primary(person.emailAddresses)?.value?.toLowerCase() ?? null
    if (!name && !email) return null

    const organization = person.organizations?.[0]
    const birthday = person.birthdays?.find((entry) => entry.date?.month && entry.date.day)
      ?.date

    return {
      externalId,
      name: name ?? email!,
      email,
      phone: primary(person.phoneNumbers)?.value ?? null,
      organization: organization?.name ?? null,
      jobTitle: organization?.title ?? null,
      avatarUrl: primary(person.photos)?.url ?? null,
      // Contacts often record a birthday without a year; store what we have.
      birthday: birthday
        ? `${birthday.year ?? '0000'}-${String(birthday.month).padStart(2, '0')}-${String(
            birthday.day,
          ).padStart(2, '0')}`
        : null,
    }
  }
}
