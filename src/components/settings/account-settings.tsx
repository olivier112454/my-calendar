'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { Check, Copy, LogOut } from 'lucide-react'
import { api } from '@/lib/client/api'
import { appUrl } from '@/config/app'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Avatar } from '@/components/ui/primitives'
import { SettingsRow, SettingsSection } from './settings-nav'
import { useSettingsSave } from './use-settings-save'

/**
 * Profile and account. The booking handle lives here because it is the one
 * piece of the profile that is public.
 */
export function AccountSettings({
  user,
}: {
  user: {
    name: string | null
    email: string
    avatarUrl: string | null
    username: string | null
    timezone: string
  }
}) {
  const { save } = useSettingsSave()
  const [name, setName] = React.useState(user.name ?? '')
  const [username, setUsername] = React.useState(user.username ?? '')
  const [usernameError, setUsernameError] = React.useState<string | null>(null)
  const [copied, setCopied] = React.useState(false)

  const bookingUrl = `${appUrl()}/book/${username || 'your-name'}`

  const saveUsername = async () => {
    const trimmed = username.trim().toLowerCase()
    if (trimmed === (user.username ?? '')) return
    if (!/^[a-z0-9-]{3,40}$/.test(trimmed)) {
      setUsernameError('Three or more lower-case letters, numbers or dashes.')
      return
    }
    setUsernameError(null)
    try {
      await api.patch('/api/settings', { profile: { username: trimmed } })
      toast.success('Booking name updated')
    } catch (cause) {
      setUsername(user.username ?? '')
      setUsernameError(
        cause instanceof Error ? cause.message : 'That name could not be saved.',
      )
    }
  }

  const copyBookingUrl = async () => {
    try {
      await navigator.clipboard.writeText(bookingUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Could not copy the link.')
    }
  }

  return (
    <>
      <SettingsSection title="Profile">
        <SettingsRow label="Photo" description="Comes from the account you signed in with.">
          <Avatar name={user.name ?? user.email} src={user.avatarUrl} size="lg" />
        </SettingsRow>

        <SettingsRow label="Name" htmlFor="profile-name">
          <Input
            id="profile-name"
            value={name}
            onChange={(nativeEvent) => setName(nativeEvent.target.value)}
            onBlur={() => {
              if (name.trim() && name.trim() !== user.name) {
                void save(
                  { profile: { name: name.trim() } },
                  { message: 'Name updated' },
                )
              }
            }}
            className="w-56"
          />
        </SettingsRow>

        <SettingsRow
          label="Email"
          description="Your sign-in address. Change it with your identity provider."
        >
          <span className="text-[13px] text-fg-muted">{user.email}</span>
        </SettingsRow>

        <SettingsRow
          label="Time zone"
          description="Set on the General page."
        >
          <span className="text-[13px] text-fg-muted">
            {user.timezone.replace(/_/g, ' ')}
          </span>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection
        title="Booking link"
        description="The public address people use to book time with you."
      >
        <SettingsRow label="Your handle" htmlFor="username" stacked>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-[13px] text-fg-subtle">{appUrl()}/book/</span>
              <Input
                id="username"
                value={username}
                onChange={(nativeEvent) => {
                  setUsername(nativeEvent.target.value)
                  setUsernameError(null)
                }}
                onBlur={saveUsername}
                className="w-40"
                aria-invalid={Boolean(usernameError)}
              />
            </div>
            {usernameError ? (
              <p role="alert" className="text-xs text-danger">
                {usernameError}
              </p>
            ) : (
              <div className="flex items-center gap-2">
                <code className="truncate rounded bg-surface-2 px-1.5 py-0.5 text-xs text-fg-muted">
                  {bookingUrl}
                </code>
                <Button
                  variant="ghost"
                  size="iconSm"
                  onClick={copyBookingUrl}
                  aria-label="Copy booking link"
                >
                  {copied ? <Check /> : <Copy />}
                </Button>
              </div>
            )}
          </div>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Session">
        <SettingsRow
          label="Sign out"
          description="Ends this session on this device."
        >
          <form action="/api/auth/signout" method="POST">
            <Button type="submit" variant="secondary" size="sm">
              <LogOut />
              Sign out
            </Button>
          </form>
        </SettingsRow>
      </SettingsSection>
    </>
  )
}
