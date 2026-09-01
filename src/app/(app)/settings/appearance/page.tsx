import type { Metadata } from 'next'
import { ensureSettings, requireUserPage } from '@/lib/auth'
import { AppearanceSettings } from '@/components/settings/appearance-settings'

export const metadata: Metadata = { title: 'Appearance' }

export default async function AppearanceSettingsPage() {
  const user = await requireUserPage('/settings/appearance')
  const settings = await ensureSettings(user.id)

  return <AppearanceSettings settings={settings} />
}
