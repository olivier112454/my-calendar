'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { api } from '@/lib/client/api'

/**
 * Saving in Settings.
 *
 * Changes apply immediately and optimistically — a settings page with a Save
 * button that people forget to press is worse than one that just works. A
 * failure reverts the control and says so.
 */
export function useSettingsSave() {
  const router = useRouter()
  const [saving, setSaving] = React.useState(false)

  const save = React.useCallback(
    async (
      payload: {
        settings?: Record<string, unknown>
        profile?: Record<string, unknown>
        workingHours?: unknown[]
      },
      options?: { revert?: () => void; message?: string; refresh?: boolean },
    ) => {
      setSaving(true)
      try {
        await api.patch('/api/settings', payload)
        if (options?.message) toast.success(options.message)
        if (options?.refresh !== false) router.refresh()
        return true
      } catch (cause) {
        options?.revert?.()
        toast.error(
          cause instanceof Error ? cause.message : 'That setting could not be saved.',
        )
        return false
      } finally {
        setSaving(false)
      }
    },
    [router],
  )

  return { save, saving }
}

/** Common IANA zones offered before falling back to the full list. */
export const COMMON_TIMEZONES = [
  'Europe/Amsterdam',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Madrid',
  'Europe/Rome',
  'Europe/Lisbon',
  'Europe/Warsaw',
  'Europe/Athens',
  'Europe/Moscow',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Hong_Kong',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Pacific/Auckland',
  'UTC',
]

/** Every zone the runtime knows, when the common list is not enough. */
export function allTimeZones(): string[] {
  try {
    const supported = (
      Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] }
    ).supportedValuesOf?.('timeZone')
    return supported && supported.length > 0 ? supported : COMMON_TIMEZONES
  } catch {
    return COMMON_TIMEZONES
  }
}
