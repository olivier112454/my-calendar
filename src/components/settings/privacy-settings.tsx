'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Download, Laptop, LogOut, ShieldCheck, Trash2 } from 'lucide-react'
import { api } from '@/lib/client/api'
import { formatRelative } from '@/lib/datetime'
import type { SessionSummary } from '@/server/services/settings'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/primitives'
import { Dialog, DialogContent } from '@/components/ui/overlay'
import { SettingsRow, SettingsSection } from './settings-nav'

/**
 * Privacy and data.
 *
 * Everything here is about the user knowing what is held and being able to take
 * it back: what we store from mail, where they are signed in, an export, and a
 * complete deletion.
 */
export function PrivacySettings({
  sessions,
  emailCount,
  connectedCount,
  userEmail,
  assistantName,
}: {
  sessions: SessionSummary[]
  emailCount: number
  connectedCount: number
  userEmail: string
  /** The model reading the Inbox, or null when none is configured. */
  assistantName: string | null
}) {
  const router = useRouter()
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [confirmEmail, setConfirmEmail] = React.useState('')
  const [deleting, setDeleting] = React.useState(false)

  const revoke = async (sessionId?: string) => {
    try {
      const result = await api.delete<{ revoked: number }>(
        '/api/account/sessions',
        sessionId ? { sessionId } : undefined,
      )
      toast.success(
        sessionId
          ? 'Signed out of that device'
          : `Signed out of ${result.revoked} other device${result.revoked === 1 ? '' : 's'}`,
      )
      router.refresh()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Could not sign that out.')
    }
  }

  const removeAccount = async () => {
    setDeleting(true)
    try {
      await api.delete('/api/account', { confirmEmail })
      // The session is gone server-side; a normal navigation renders the
      // signed-out landing page.
      router.replace('/')
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : 'The account could not be deleted.',
      )
      setDeleting(false)
    }
  }

  return (
    <>
      <SettingsSection
        title="What is stored"
        description="A plain account of the data this app keeps."
      >
        <SettingsRow
          label="Mail"
          description={
            connectedCount === 0
              ? 'No mailbox is connected.'
              : 'Message bodies are never fetched or stored. We keep the sender, subject, the snippet the provider already shows, and what the extractor made of it — nothing more.'
          }
        >
          <span className="text-[13px] tabular-nums text-fg-muted">
            {emailCount} reference{emailCount === 1 ? '' : 's'}
          </span>
        </SettingsRow>

        <SettingsRow
          label="Reading mail with a model"
          description={
            assistantName
              ? `Messages the rules cannot read are sent to ${assistantName} to be read: the sender, the subject and the preview line. Never the body — this app does not fetch it. Nothing is sent about a message the rules already understood.`
              : 'Off. Mail is read by pattern matching on this server; nothing leaves it.'
          }
        >
          <Badge tone={assistantName ? 'accent' : 'neutral'}>
            {assistantName ? 'On' : 'Off'}
          </Badge>
        </SettingsRow>

        <SettingsRow
          label="Provider credentials"
          description="OAuth tokens are encrypted with AES-256-GCM before they are written, and are never sent to the browser. Disconnecting an account revokes them with the provider."
        >
          <Badge tone="success">
            <ShieldCheck aria-hidden="true" />
            Encrypted
          </Badge>
        </SettingsRow>

        <SettingsRow
          label="Export your data"
          description="Calendars, events, tasks, contacts and settings as JSON."
        >
          <Button variant="secondary" size="sm" asChild>
            <a href="/api/account/export">
              <Download />
              Download
            </a>
          </Button>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection
        title="Where you are signed in"
        description="Each browser you sign in from gets its own session. Revoking one signs that device out immediately."
        actions={
          sessions.length > 1 ? (
            <Button variant="secondary" size="sm" onClick={() => revoke()}>
              <LogOut />
              Sign out others
            </Button>
          ) : null
        }
      >
        <ul className="divide-y divide-border">
          {sessions.map((session) => (
            <li key={session.id} className="flex items-center gap-3 py-3">
              <Laptop className="size-4 shrink-0 text-fg-subtle" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-[13px] text-fg">
                    {describeAgent(session.userAgent)}
                  </span>
                  {session.isCurrent ? <Badge tone="accent">This device</Badge> : null}
                </div>
                <p className="text-xs text-fg-subtle">
                  Last used {formatRelative(new Date(session.lastUsedAt))} · expires{' '}
                  {formatRelative(new Date(session.expiresAt))}
                </p>
              </div>
              {!session.isCurrent ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => revoke(session.id)}
                >
                  Revoke
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </SettingsSection>

      <section className="mb-8">
        <h2 className="text-[15px] font-semibold text-fg">Delete your account</h2>
        <p className="mt-0.5 text-[13px] leading-relaxed text-fg-muted">
          Removes every calendar, event, task, contact and connection. Provider
          access is revoked first. This cannot be undone.
        </p>
        <div className="mt-3 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3">
          <Button variant="danger" size="sm" onClick={() => setDeleteOpen(true)}>
            <Trash2 />
            Delete account
          </Button>
        </div>
      </section>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent
          title="Delete your account"
          description="Everything goes. There is no way back."
          width="sm"
          footer={
            <>
              <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                loading={deleting}
                disabled={confirmEmail.trim().toLowerCase() !== userEmail.toLowerCase()}
                onClick={removeAccount}
              >
                Delete permanently
              </Button>
            </>
          }
        >
          <label className="space-y-1.5">
            <span className="block text-[13px] text-fg">
              Type <strong className="font-medium">{userEmail}</strong> to confirm.
            </span>
            <Input
              value={confirmEmail}
              onChange={(nativeEvent) => setConfirmEmail(nativeEvent.target.value)}
              placeholder={userEmail}
              autoComplete="off"
            />
          </label>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** A readable device name from a user-agent string. */
function describeAgent(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device'

  const browser =
    /edg\//i.test(userAgent)
      ? 'Edge'
      : /chrome|crios/i.test(userAgent)
        ? 'Chrome'
        : /firefox|fxios/i.test(userAgent)
          ? 'Firefox'
          : /safari/i.test(userAgent)
            ? 'Safari'
            : 'Browser'

  const platform = /iphone/i.test(userAgent)
    ? 'iPhone'
    : /ipad/i.test(userAgent)
      ? 'iPad'
      : /android/i.test(userAgent)
        ? 'Android'
        : /mac os/i.test(userAgent)
          ? 'macOS'
          : /windows/i.test(userAgent)
            ? 'Windows'
            : /linux/i.test(userAgent)
              ? 'Linux'
              : 'Unknown platform'

  return `${browser} on ${platform}`
}
