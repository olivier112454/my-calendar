import type { Metadata } from 'next'
import { ensureSettings, requireUserPage } from '@/lib/auth'
import {
  computeAnalytics,
  resolveRange,
  type RangePreset,
} from '@/server/services/analytics'
import { getCalibration } from '@/server/services/calibration'
import { AnalyticsView } from '@/components/analytics/analytics-view'

export const metadata: Metadata = { title: 'Analytics' }

const PRESETS: RangePreset[] = ['week', 'month', 'quarter']

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>
}) {
  const user = await requireUserPage('/analytics')
  const settings = await ensureSettings(user.id)
  const params = await searchParams

  const preset = PRESETS.includes(params.range as RangePreset)
    ? (params.range as RangePreset)
    : 'week'

  const range = resolveRange(preset, user.timezone, settings.weekStartsOn)
  const analytics = await computeAnalytics(user.id, user.email, user.timezone, range)
  // Not scoped to the selected range: this is a standing fact about how the
  // user estimates, and a single week rarely holds enough finished work to say
  // anything about it.
  const calibration = await getCalibration(user.id)

  return (
    <AnalyticsView
      analytics={analytics}
      preset={preset}
      weekStartsOn={settings.weekStartsOn}
      calibration={calibration}
    />
  )
}
