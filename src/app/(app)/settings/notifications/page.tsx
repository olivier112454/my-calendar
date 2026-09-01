import type { Metadata } from 'next'
import { ensureSettings, requireUserPage } from '@/lib/auth'
import { NotificationSettings } from '@/components/settings/notification-settings'

export const metadata: Metadata = { title: 'Notifications' }

export default async function NotificationSettingsPage() {
  const user = await requireUserPage('/settings/notifications')
  const settings = await ensureSettings(user.id)

  return <NotificationSettings settings={settings} />
}
