'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  CalendarPlus,
  ExternalLink,
  Inbox as InboxIcon,
  Link2,
  Mail,
  Plane,
  RefreshCw,
  Ticket,
  Timer,
  Users,
  Utensils,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { api, qs } from '@/lib/client/api'
import { formatEventRange, formatRelative } from '@/lib/datetime'
import { appConfig } from '@/config/app'
import type { CalendarSummary, EmailSummary, EventDraft } from '@/types/domain'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/primitives'
import { SegmentedControl } from '@/components/ui/controls'
import { EmptyState, ErrorBanner, ListSkeleton } from '@/components/ui/states'
import { EventComposer } from '@/components/events/event-composer'
import { useAppShell } from '@/components/layout/app-shell-context'
import { NotificationBell } from '@/components/layout/notification-bell'

/**
 * The Inbox.
 *
 * Mail is shown here for one reason: some of it contains an appointment. Rows
 * the extractor is confident about carry a proposed date and an "Add to
 * calendar" button; everything else is listed plainly.
 *
 * Nothing is ever added automatically. The button opens the composer with the
 * draft filled in, and the user presses Create — a wrongly-read email must not
 * be able to put something in someone's calendar.
 */

const CATEGORY_META: Record<
  string,
  { label: string; icon: React.ElementType; tone: 'accent' | 'neutral' | 'warning' }
> = {
  MEETING: { label: 'Meeting', icon: Users, tone: 'accent' },
  INVITATION: { label: 'Invitation', icon: CalendarPlus, tone: 'accent' },
  TRAVEL: { label: 'Travel', icon: Plane, tone: 'neutral' },
  RESERVATION: { label: 'Reservation', icon: Utensils, tone: 'neutral' },
  DEADLINE: { label: 'Deadline', icon: Timer, tone: 'warning' },
  TICKET: { label: 'Ticket', icon: Ticket, tone: 'neutral' },
  OTHER: { label: 'Mail', icon: Mail, tone: 'neutral' },
}

type Filter = 'suggestions' | 'all' | 'unread'

export function InboxView({
  initialMessages,
  calendars,
  timezone,
  use24h,
  hasMailAccount,
  usingSampleData,
  defaultCalendarId,
}: {
  initialMessages: EmailSummary[]
  calendars: CalendarSummary[]
  timezone: string
  use24h: boolean
  hasMailAccount: boolean
  usingSampleData: boolean
  defaultCalendarId: string | null
}) {
  const router = useRouter()
  const { categories } = useAppShell()
  const [messages, setMessages] = React.useState(initialMessages)
  const [filter, setFilter] = React.useState<Filter>('suggestions')
  const [loading, setLoading] = React.useState(false)
  const [refreshing, setRefreshing] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [draft, setDraft] = React.useState<{ draft: EventDraft; messageId: string } | null>(
    null,
  )

  const load = React.useCallback(async (next: Filter) => {
    setLoading(true)
    try {
      const data = await api.get<EmailSummary[]>(
        `/api/inbox${qs({
          suggestionsOnly: next === 'suggestions' ? 'true' : undefined,
          unreadOnly: next === 'unread' ? 'true' : undefined,
        })}`,
      )
      setMessages(data)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load your mail.')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- flags the in-flight load for the selected filter
    void load(filter)
  }, [filter, load])

  const refresh = async () => {
    setRefreshing(true)
    try {
      const result = await api.post<{ imported: number; accounts: number }>('/api/inbox')
      if (result.accounts === 0) {
        toast.info('No mailbox is connected yet.')
      } else {
        toast.success(`Checked ${result.imported} recent message${result.imported === 1 ? '' : 's'}`)
      }
      await load(filter)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Could not check your mail.')
    } finally {
      setRefreshing(false)
    }
  }

  const dismiss = async (message: EmailSummary) => {
    const snapshot = messages
    setMessages((current) => current.filter((entry) => entry.id !== message.id))
    try {
      await api.post(`/api/inbox/${message.id}/dismiss`)
      toast.success('Suggestion hidden', {
        action: {
          label: 'Undo',
          onClick: () => {
            void api
              .delete(`/api/inbox/${message.id}/dismiss`)
              .then(() => load(filter))
              .catch(() => toast.error('Could not undo that.'))
          },
        },
      })
    } catch {
      setMessages(snapshot)
      toast.error('Could not hide that suggestion.')
    }
  }

  if (!hasMailAccount) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <EmptyState
          icon={<Mail />}
          title="No mailbox connected"
          description={`Connect Gmail and ${appConfig.name} will spot the meetings, reservations, flights and deadlines hiding in your mail — and offer to put them on your calendar.`}
          action={
            <Button variant="primary" size="sm" asChild>
              <Link href="/settings/integrations">
                <Link2 />
                Connect Gmail
              </Link>
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface px-4 py-2">
        <h1 className="text-[15px] font-semibold tracking-[-0.01em] text-fg">Inbox</h1>
        {usingSampleData ? (
          <Badge tone="warning">Sample data</Badge>
        ) : null}

        <div className="ml-auto flex items-center gap-1.5">
          <NotificationBell />
          <Button
            variant="ghost"
            size="icon"
            onClick={refresh}
            disabled={refreshing}
            aria-label="Check for new mail"
          >
            <RefreshCw className={cn(refreshing && 'animate-spin')} />
          </Button>
          <SegmentedControl
            label="Filter mail"
            value={filter}
            onValueChange={setFilter}
            options={[
              { value: 'suggestions', label: 'Suggestions' },
              { value: 'unread', label: 'Unread' },
              { value: 'all', label: 'All' },
            ]}
          />
        </div>
      </header>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-4 py-3">
          {error ? (
            <ErrorBanner
              className="mb-3"
              title="Could not load your mail"
              description={error}
              actions={
                <Button variant="secondary" size="sm" onClick={() => load(filter)}>
                  Try again
                </Button>
              }
            />
          ) : null}

          {loading && messages.length === 0 ? (
            <ListSkeleton rows={6} />
          ) : messages.length === 0 ? (
            <EmptyState
              icon={<InboxIcon />}
              title={
                filter === 'suggestions'
                  ? 'Nothing to add'
                  : filter === 'unread'
                    ? 'No unread mail'
                    : 'Nothing here'
              }
              description={
                filter === 'suggestions'
                  ? 'No recent mail looks like it contains an appointment.'
                  : 'Check again to pull in the latest messages.'
              }
              action={
                <Button variant="secondary" size="sm" onClick={refresh}>
                  <RefreshCw />
                  Check now
                </Button>
              }
            />
          ) : (
            <ul className="space-y-1.5">
              {messages.map((message) => (
                <li key={message.id}>
                  <MessageCard
                    message={message}
                    timezone={timezone}
                    use24h={use24h}
                    onAdd={() =>
                      message.extraction &&
                      setDraft({ draft: message.extraction, messageId: message.id })
                    }
                    onDismiss={() => dismiss(message)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <EventComposer
        open={draft !== null}
        onOpenChange={(open) => !open && setDraft(null)}
        calendars={calendars}
        categories={categories}
        timezone={timezone}
        use24h={use24h}
        defaultCalendarId={defaultCalendarId}
        draft={draft?.draft ?? null}
        onSaved={() => {
          setDraft(null)
          void load(filter)
          router.refresh()
        }}
      />
    </div>
  )
}

function MessageCard({
  message,
  timezone,
  use24h,
  onAdd,
  onDismiss,
}: {
  message: EmailSummary
  timezone: string
  use24h: boolean
  onAdd: () => void
  onDismiss: () => void
}) {
  const meta = CATEGORY_META[message.category] ?? CATEGORY_META.OTHER!
  const Icon = meta.icon
  const draft = message.extraction

  return (
    <article
      className={cn(
        'rounded-lg border border-border bg-surface px-3 py-2.5 transition-colors',
        message.isUnread && 'border-l-2 border-l-accent',
      )}
    >
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden="true"
          className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-surface-2 text-fg-subtle"
        >
          <Icon className="size-3.5" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span
              className={cn(
                'text-[13px] text-fg',
                message.isUnread ? 'font-semibold' : 'font-medium',
              )}
            >
              {message.fromName ?? message.fromEmail ?? 'Unknown sender'}
            </span>
            <span className="text-[11px] text-fg-subtle">
              {formatRelative(new Date(message.receivedAt))}
            </span>
            {message.category !== 'OTHER' ? (
              <Badge tone={meta.tone}>{meta.label}</Badge>
            ) : null}
            {message.linkedEventId ? (
              <Badge tone="success">On your calendar</Badge>
            ) : null}
          </div>

          <p className="mt-0.5 break-user-text text-[13px] font-medium text-fg">
            {message.subject ?? '(no subject)'}
          </p>
          {message.snippet ? (
            <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-fg-muted">
              {message.snippet}
            </p>
          ) : null}

          {draft && draft.start && !message.linkedEventId ? (
            <div className="mt-2 rounded-md border border-border bg-surface-2 px-2.5 py-2">
              <p className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
                Looks like an appointment
              </p>
              <p className="mt-0.5 text-[13px] font-medium text-fg">{draft.title}</p>
              <p className="text-xs text-fg-muted">
                {formatEventRange(
                  new Date(draft.start),
                  new Date(draft.end ?? draft.start),
                  timezone,
                  use24h,
                  draft.allDay,
                )}
                {draft.location ? ` · ${draft.location}` : ''}
              </p>
              {draft.matched?.length ? (
                <p className="mt-1 text-[11px] text-fg-subtle">
                  Read from: {draft.matched.join(' · ')}
                </p>
              ) : null}

              <div className="mt-2 flex items-center gap-1.5">
                <Button variant="primary" size="sm" onClick={onAdd}>
                  <CalendarPlus />
                  Add to calendar
                </Button>
                <Button variant="ghost" size="sm" onClick={onDismiss}>
                  <X />
                  Not an event
                </Button>
              </div>
              <p className="mt-1.5 text-[11px] text-fg-subtle">
                {"You'll"} see the details before anything is saved.
              </p>
            </div>
          ) : null}
        </div>

        {message.accountEmail ? (
          <span className="hidden shrink-0 text-[11px] text-fg-subtle sm:block">
            {message.accountEmail}
          </span>
        ) : null}
      </div>
    </article>
  )
}

export { ExternalLink }
