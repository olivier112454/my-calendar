import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { ensureSettings, requireUserPage } from '@/lib/auth'
import { getWorkingHours } from '@/server/services/settings'
import { googleConfigured } from '@/server/providers/google/oauth'
import { accountsFor, grantedCapabilities } from '@/server/providers/registry'
import { OnboardingFlow } from '@/components/onboarding/onboarding-flow'

export const metadata: Metadata = { title: 'Welcome' }

/**
 * First-run setup.
 *
 * Rendered outside the app shell: the point is to get four decisions made and
 * get out of the way, and a sidebar full of pages nobody has data for yet is a
 * distraction. Every step after the first can be skipped.
 */
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string }>
}) {
  const user = await requireUserPage('/onboarding')

  // Someone who has already been through this should not be sent back.
  if (user.onboardedAt) redirect('/today')

  const [settings, workingHours, accounts] = await Promise.all([
    ensureSettings(user.id),
    getWorkingHours(user.id),
    accountsFor(user.id),
  ])

  const params = await searchParams

  return (
    <OnboardingFlow
      initialStep={Number(params.step ?? 0) || 0}
      user={{ name: user.name, email: user.email, timezone: user.timezone }}
      settings={{
        defaultReminders: settings.defaultReminders,
        weekStartsOn: settings.weekStartsOn,
        timeFormat24h: settings.timeFormat24h,
      }}
      workingHours={workingHours.map((row) => ({
        weekday: row.weekday,
        startMinute: row.startMinute,
        endMinute: row.endMinute,
        enabled: row.enabled,
      }))}
      googleConfigured={googleConfigured()}
      connected={{
        calendar: accounts.some((account) => grantedCapabilities(account).calendar),
        mail: accounts.some((account) => grantedCapabilities(account).mail),
      }}
    />
  )
}
