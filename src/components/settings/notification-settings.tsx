'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { Bell, BellOff, BellRing } from 'lucide-react'
import type { UserSettings } from '@prisma/client'
import { appConfig } from '@/config/app'
import {
  describeDevice,
  disablePush,
  enablePush,
  isSubscribed,
  pushSupport,
  type PushSupport,
} from '@/lib/client/push'
import { ReminderPicker } from './reminder-picker'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from '@/components/ui/controls'
import { SettingsRow, SettingsSection } from './settings-nav'
import { useSettingsSave } from './use-settings-save'

/**
 * Notification preferences.
 *
 * Browser notifications need the browser's own permission as well as this
 * switch, so the two are shown together — a toggle that silently does nothing
 * because permission was denied is worse than no toggle.
 */
export function NotificationSettings({ settings }: { settings: UserSettings }) {
  const { save } = useSettingsSave()
  const [local, setLocal] = React.useState(settings)
  const [permission, setPermission] = React.useState<NotificationPermission | 'unsupported'>(
    'default',
  )
  const [support, setSupport] = React.useState<PushSupport>({ kind: 'unsupported' })
  const [subscribed, setSubscribed] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads browser capabilities, none of which exist during SSR
    setPermission(
      typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
    )
    setSupport(pushSupport())
    void isSubscribed().then((value) => setSubscribed(value))
  }, [])

  const patch = (changes: Partial<UserSettings>) => {
    const previous = local
    setLocal({ ...local, ...changes })
    void save({ settings: changes as Record<string, unknown> }, {
      revert: () => setLocal(previous),
    })
  }

  const turnOn = async () => {
    setBusy(true)
    try {
      const result = await enablePush()
      setPermission(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission)

      if (result === 'granted') {
        setSubscribed(true)
        patch({ browserNotifications: true })
        toast.success(`Reminders will reach ${describeDevice()}.`)
      } else if (result === 'denied') {
        toast.error(
          'Your browser blocked notifications. You can change that in the site settings.',
        )
      } else {
        toast.error('This device could not be registered. Try again in a moment.')
      }
    } finally {
      setBusy(false)
    }
  }

  const turnOff = async () => {
    setBusy(true)
    try {
      await disablePush()
      setSubscribed(false)
      patch({ browserNotifications: false })
    } catch {
      toast.error('Could not switch that off. Try again in a moment.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <SettingsSection
        title="Reminders"
        description="What happens before an event starts."
      >
        <SettingsRow
          label="Default reminders"
          description="Tick as many as you want — they are all added to new events."
          stacked
        >
          <ReminderPicker
            value={local.defaultReminders}
            onChange={(defaultReminders) => patch({ defaultReminders })}
          />
        </SettingsRow>

        <SettingsRow
          label="Notifications on this device"
          description={
            support.kind === 'not-configured'
              ? 'Push notifications are not configured on this server yet.'
              : support.kind === 'needs-install'
                ? 'On iPhone and iPad, add the app to your Home Screen first — Safari only allows notifications for an installed app.'
                : support.kind === 'unsupported'
                  ? 'This browser cannot receive notifications.'
                  : permission === 'denied'
                    ? 'Blocked by your browser. Allow notifications for this site to switch them on.'
                    : subscribed
                      ? `Reminders reach ${describeDevice()} even when the app is closed.`
                      : 'Reminders reach you even when the app is closed.'
          }
          htmlFor="browser-notifications"
        >
          {subscribed ? (
            <Switch
              id="browser-notifications"
              checked
              disabled={busy}
              onCheckedChange={() => void turnOff()}
            />
          ) : (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void turnOn()}
              loading={busy}
              disabled={
                support.kind !== 'ready' || permission === 'denied' || busy
              }
            >
              {permission === 'denied' ? <BellOff /> : <BellRing />}
              {permission === 'denied' ? 'Blocked' : 'Allow'}
            </Button>
          )}
        </SettingsRow>

        <SettingsRow
          label="Email notifications"
          description="Invitations, responses and reminders by email."
          htmlFor="email-notifications"
        >
          <Switch
            id="email-notifications"
            checked={local.emailNotifications}
            onCheckedChange={(emailNotifications) => patch({ emailNotifications })}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection
        title="Daily agenda"
        description="A short summary of the day, sent each morning."
      >
        <SettingsRow
          label="Send me my daily agenda"
          htmlFor="daily-agenda"
          description="Your events and anything due, in one message."
        >
          <Switch
            id="daily-agenda"
            checked={local.dailyAgendaEmail}
            onCheckedChange={(dailyAgendaEmail) => patch({ dailyAgendaEmail })}
          />
        </SettingsRow>

        {local.dailyAgendaEmail ? (
          <SettingsRow label="Send at" htmlFor="agenda-hour">
            <Select
              value={String(local.dailyAgendaHour)}
              onValueChange={(value) => patch({ dailyAgendaHour: Number(value) })}
            >
              <SelectTrigger id="agenda-hour" className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 12 }, (_, index) => index + 5).map((hour) => (
                  <SelectItem key={hour} value={String(hour)}>
                    {String(hour).padStart(2, '0')}:00
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingsRow>
        ) : null}
      </SettingsSection>

      <div className="rounded-lg border border-dashed border-border px-3 py-3">
        <p className="flex items-center gap-1.5 text-[13px] font-medium text-fg">
          <Bell className="size-3.5 text-fg-subtle" aria-hidden="true" />
          How reminders are delivered
        </p>
        <p className="mt-1 text-xs leading-relaxed text-fg-muted">
          Once a device is switched on above, reminders arrive on it even when
          {' '}{appConfig.name} is closed — the server sends them, not the open
          tab. On iPhone that only works for the version added to your Home
          Screen. Email delivery still has no transport wired up; see the README.
        </p>
      </div>
    </>
  )
}
