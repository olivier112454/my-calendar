'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  AlertTriangle,
  Check,
  Link2,
  Plus,
  RefreshCw,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/lib/client/api'
import { formatRelative } from '@/lib/datetime'
import type { IntegrationSummary } from '@/types/domain'
import { appConfig } from '@/config/app'
import { Button } from '@/components/ui/button'
import { Avatar, Badge } from '@/components/ui/primitives'
import { ConfirmDialog } from '@/components/ui/overlay'
import { ErrorBanner } from '@/components/ui/states'
import { GoogleMark } from '@/components/brand'
import { SettingsSection } from './settings-nav'

/**
 * Connected accounts.
 *
 * A user may connect several accounts of the same provider — a personal and a
 * work Google account is the normal case, not an edge case — so this is a list
 * of connections, not a list of providers with an on/off switch.
 *
 * Permissions are requested per feature. Connecting Google for calendar does not
 * ask for the mailbox; that is a second, explicit step.
 */

interface ScopeGroup {
  key: 'calendar' | 'gmail' | 'contacts'
  label: string
  description: string
  scope: string
}

const SCOPE_GROUPS: ScopeGroup[] = [
  {
    key: 'calendar',
    label: 'Calendar',
    description: 'Read and write events, both ways.',
    scope: 'https://www.googleapis.com/auth/calendar',
  },
  {
    key: 'gmail',
    label: 'Gmail',
    description: 'Read message headers to spot appointments. Bodies are never stored.',
    scope: 'https://www.googleapis.com/auth/gmail.readonly',
  },
  {
    key: 'contacts',
    label: 'Contacts',
    description: 'Suggest guests by name.',
    scope: 'https://www.googleapis.com/auth/contacts.readonly',
  },
]

/** Providers the architecture supports but that are not implemented yet. */
const PLANNED = [
  { name: 'Microsoft Outlook', detail: 'Calendar, mail and Teams' },
  { name: 'Apple iCloud', detail: 'Calendar over CalDAV' },
  { name: 'CalDAV', detail: 'Any standards-compliant server' },
  { name: 'Zoom', detail: 'Meeting links on events' },
  { name: 'Slack', detail: 'Status from your calendar' },
]

export function IntegrationsSettings({
  integrations,
  googleConfigured,
  usingSampleData,
}: {
  integrations: IntegrationSummary[]
  googleConfigured: boolean
  usingSampleData: boolean
}) {
  const router = useRouter()
  const [syncing, setSyncing] = React.useState<string | null>(null)
  const [pendingDisconnect, setPendingDisconnect] = React.useState<IntegrationSummary | null>(
    null,
  )

  const sync = async (accountId: string) => {
    setSyncing(accountId)
    try {
      const result = await api.post<{
        pulled: number
        pushed: number
        errors: { calendar: string; message: string }[]
      }>('/api/sync/google', { accountId })

      if (result.errors.length > 0) {
        toast.error(result.errors[0]!.message)
      } else {
        toast.success(
          `Synced — ${result.pulled} in, ${result.pushed} out`,
        )
      }
      router.refresh()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Sync failed.')
    } finally {
      setSyncing(null)
    }
  }

  const disconnect = async (account: IntegrationSummary) => {
    try {
      await api.delete(`/api/integrations/${account.id}`)
      toast.success(`Disconnected ${account.email ?? account.provider}`)
      router.refresh()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Could not disconnect.')
    }
  }

  return (
    <>
      {!googleConfigured ? (
        <ErrorBanner
          className="mb-6"
          title="Google is not configured on this server"
          description="Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to the environment and restart. The README has the Google Cloud steps."
        />
      ) : null}

      {usingSampleData ? (
        <div className="mb-6 rounded-lg border border-border bg-surface-2 px-3 py-2.5">
          <p className="text-[13px] font-medium text-fg">Sample data is in use</p>
          <p className="mt-0.5 text-xs leading-relaxed text-fg-muted">
            The Inbox is showing example messages so the feature can be tried
            without a mailbox. Connect Google to replace them with your own.
          </p>
        </div>
      ) : null}

      <SettingsSection
        title="Connected accounts"
        description="Connect more than one — a personal and a work account can both be live at once."
        actions={
          googleConfigured ? (
            <Button variant="secondary" size="sm" asChild>
              <a href="/api/auth/google/start?scopes=calendar&chooser=1&next=/settings/integrations">
                <Plus />
                Add account
              </a>
            </Button>
          ) : null
        }
      >
        {integrations.length === 0 ? (
          <div className="py-6 text-center">
            <p className="text-[13px] text-fg-muted">No accounts connected yet.</p>
            <Button
              variant="primary"
              size="sm"
              className="mt-2"
              disabled={!googleConfigured}
              asChild={googleConfigured}
            >
              {googleConfigured ? (
                <a href="/api/auth/google/start?scopes=calendar&next=/settings/integrations">
                  <GoogleMark />
                  Connect Google Calendar
                </a>
              ) : (
                <>
                  <GoogleMark />
                  Connect Google Calendar
                </>
              )}
            </Button>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {integrations.map((account) => (
              <li key={account.id} className="py-3">
                <div className="flex items-start gap-3">
                  <Avatar
                    name={account.displayName ?? account.email}
                    src={account.avatarUrl}
                    size="md"
                  />

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-medium text-fg">
                        {account.email ?? account.displayName ?? account.provider}
                      </span>
                      {account.isPrimary ? <Badge tone="neutral">Sign-in</Badge> : null}
                      {account.status === 'ACTIVE' ? (
                        <Badge tone="success">
                          <Check aria-hidden="true" />
                          Connected
                        </Badge>
                      ) : (
                        <Badge tone="danger">
                          <AlertTriangle aria-hidden="true" />
                          Needs reconnecting
                        </Badge>
                      )}
                    </div>

                    <p className="mt-0.5 text-xs text-fg-muted">
                      {account.calendarCount} calendar
                      {account.calendarCount === 1 ? '' : 's'}
                      {account.lastSyncedAt
                        ? ` · Last synced ${formatRelative(new Date(account.lastSyncedAt))}`
                        : ' · Not synced yet'}
                    </p>

                    {account.lastError ? (
                      <p className="mt-1 flex items-start gap-1.5 text-xs text-danger">
                        <TriangleAlert className="mt-px size-3 shrink-0" aria-hidden="true" />
                        {account.lastError}
                      </p>
                    ) : null}

                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {SCOPE_GROUPS.map((group) => {
                        const granted = account.scopes.includes(group.scope)
                        return (
                          <li key={group.key}>
                            {granted ? (
                              <span
                                className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] text-fg-muted"
                                title={group.description}
                              >
                                <Check className="size-3 text-success" aria-hidden="true" />
                                {group.label}
                              </span>
                            ) : (
                              <a
                                href={`/api/auth/google/start?scopes=${group.key}&next=/settings/integrations`}
                                className={cn(
                                  'inline-flex items-center gap-1 rounded-md border border-dashed border-border px-1.5 py-0.5',
                                  'text-[11px] text-fg-subtle transition-colors hover:border-border-strong hover:text-fg',
                                  !googleConfigured && 'pointer-events-none opacity-50',
                                )}
                                title={group.description}
                              >
                                <Plus className="size-3" aria-hidden="true" />
                                {group.label}
                              </a>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    {account.status === 'NEEDS_REAUTH' ? (
                      <Button variant="secondary" size="sm" asChild>
                        <a href="/api/auth/google/start?scopes=calendar&chooser=1&next=/settings/integrations">
                          <Link2 />
                          Reconnect
                        </a>
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => sync(account.id)}
                        disabled={syncing === account.id}
                        aria-label={`Sync ${account.email ?? 'account'}`}
                      >
                        <RefreshCw className={cn(syncing === account.id && 'animate-spin')} />
                      </Button>
                    )}
                    <Button
                      variant="dangerGhost"
                      size="icon"
                      onClick={() => setPendingDisconnect(account)}
                      aria-label={`Disconnect ${account.email ?? 'account'}`}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SettingsSection>

      <SettingsSection
        title="Not available yet"
        description="These fit the same provider interface — they need an implementation, not a redesign."
      >
        <ul className="divide-y divide-border">
          {PLANNED.map((entry) => (
            <li key={entry.name} className="flex items-center justify-between gap-4 py-3">
              <div>
                <p className="text-[13px] font-medium text-fg">{entry.name}</p>
                <p className="text-xs text-fg-muted">{entry.detail}</p>
              </div>
              <Button variant="secondary" size="sm" disabled>
                Connect
              </Button>
            </li>
          ))}
        </ul>
      </SettingsSection>

      <ConfirmDialog
        open={pendingDisconnect !== null}
        onOpenChange={(open) => !open && setPendingDisconnect(null)}
        title={`Disconnect ${pendingDisconnect?.email ?? 'this account'}?`}
        description={`Access is revoked with the provider, and the calendars and mail brought in through this account are removed from ${appConfig.name}. Events you created here stay.`}
        confirmLabel="Disconnect"
        onConfirm={async () => {
          if (pendingDisconnect) await disconnect(pendingDisconnect)
        }}
      />
    </>
  )
}
