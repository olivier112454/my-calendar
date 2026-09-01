import type { Metadata } from 'next'
import { ensureSettings, requireUserPage } from '@/lib/auth'
import { getDayOverview, greeting } from '@/server/services/overview'
import { TodayView } from '@/components/today/today-view'

export const metadata: Metadata = { title: 'Today' }

export default async function TodayPage() {
  const user = await requireUserPage('/today')
  const settings = await ensureSettings(user.id)
  const overview = await getDayOverview(user.id, user.email, user.timezone)

  return (
    <TodayView
      overview={overview}
      greetingText={greeting(user.timezone)}
      userName={user.name}
      use24h={settings.timeFormat24h}
    />
  )
}
