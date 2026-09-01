import type { Metadata } from 'next'
import { requireUserPage } from '@/lib/auth'
import { ensureUsername } from '@/server/services/bootstrap'
import { AccountSettings } from '@/components/settings/account-settings'

export const metadata: Metadata = { title: 'Account' }

export default async function AccountSettingsPage() {
  const user = await requireUserPage('/settings/account')
  // Older accounts predate booking links; give them one on first visit.
  const username = user.username ?? (await ensureUsername(user.id))

  return (
    <AccountSettings
      user={{
        name: user.name,
        email: user.email,
        avatarUrl: user.avatarUrl,
        username,
        timezone: user.timezone,
      }}
    />
  )
}
