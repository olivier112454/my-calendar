'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  Bell,
  BellOff,
  CalendarClock,
  Check,
  CheckSquare,
  Mail,
  RefreshCw,
  UserCheck,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/lib/client/api'
import { formatRelative } from '@/lib/datetime'
import type { NotificationSummary } from '@/types/domain'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/overlay'
import { EmptyState } from '@/components/ui/states'
import { useAppShell } from './app-shell-context'

/**
 * The notification centre.
 *
 * Opening the list marks it read — the bell is a "something happened" signal,
 * and leaving a count sitting there after someone has looked at it is noise.
 * Rows keep their own read state so the list still reads as a history.
 */

const ICONS: Record<string, React.ElementType> = {
  EVENT_REMINDER: CalendarClock,
  INVITATION: Mail,
  RSVP_RESPONSE: UserCheck,
  TASK_DUE: CheckSquare,
  SCHEDULING_REQUEST: CalendarClock,
  CONFLICT: AlertTriangle,
  SYNC: RefreshCw,
  SYSTEM: Bell,
}

export function NotificationBell({ className }: { className?: string }) {
  const router = useRouter()
  const { notifications: initial, unreadCount: initialUnread } = useAppShell()

  const [open, setOpen] = React.useState(false)
  const [notifications, setNotifications] = React.useState(initial)
  const [unread, setUnread] = React.useState(initialUnread)

  // Adopt a fresh server list without an extra render pass.
  const [syncedFrom, setSyncedFrom] = React.useState(initial)
  if (syncedFrom !== initial) {
    setSyncedFrom(initial)
    setNotifications(initial)
    setUnread(initialUnread)
  }

  const load = React.useCallback(async () => {
    try {
      const data = await api.get<{
        notifications: NotificationSummary[]
        unread: number
      }>('/api/notifications')
      setNotifications(data.notifications)
      setUnread(data.unread)
    } catch {
      // The bell is ambient; a failed refresh should not interrupt anything.
    }
  }, [])

  const handleOpen = (next: boolean) => {
    setOpen(next)
    if (!next) return

    void load()
    if (unread > 0) {
      setUnread(0)
      void api
        .patch('/api/notifications')
        .then(() => router.refresh())
        .catch(() => setUnread(unread))
    }
  }

  const clearAll = async () => {
    const snapshot = notifications
    setNotifications([])
    try {
      await api.delete('/api/notifications')
      router.refresh()
    } catch {
      setNotifications(snapshot)
    }
  }

  return (
    <Popover open={open} onOpenChange={handleOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn('relative', className)}
          aria-label={
            unread > 0
              ? `Notifications, ${unread} unread`
              : 'Notifications'
          }
        >
          <Bell />
          {unread > 0 ? (
            <span
              className={cn(
                'absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full',
                'bg-accent px-1 text-[9px] font-semibold leading-4 text-accent-fg',
              )}
            >
              {unread > 9 ? '9+' : unread}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <h2 className="text-[13px] font-semibold text-fg">Notifications</h2>
          {notifications.length > 0 ? (
            <Button variant="ghost" size="sm" onClick={clearAll}>
              Clear all
            </Button>
          ) : null}
        </div>

        {notifications.length === 0 ? (
          <EmptyState
            compact
            icon={<BellOff />}
            title="Nothing new"
            description="Reminders, replies and sync problems land here."
          />
        ) : (
          <ul className="scrollbar-thin max-h-96 divide-y divide-border overflow-y-auto">
            {notifications.map((notification) => {
              const Icon = ICONS[notification.type] ?? Bell
              const content = (
                <>
                  <span
                    aria-hidden="true"
                    className={cn(
                      'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md',
                      notification.type === 'CONFLICT'
                        ? 'bg-warning-soft text-warning'
                        : 'bg-surface-2 text-fg-subtle',
                    )}
                  >
                    <Icon className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        'block text-[13px] text-fg',
                        notification.readAt === null && 'font-medium',
                      )}
                    >
                      {notification.title}
                    </span>
                    {notification.body ? (
                      <span className="block truncate text-[11px] text-fg-muted">
                        {notification.body}
                      </span>
                    ) : null}
                    <span className="block text-[11px] text-fg-subtle">
                      {formatRelative(new Date(notification.createdAt))}
                    </span>
                  </span>
                  {notification.readAt === null ? (
                    <span
                      aria-hidden="true"
                      className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent"
                    />
                  ) : null}
                </>
              )

              return (
                <li key={notification.id}>
                  {notification.link ? (
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false)
                        router.push(notification.link!)
                      }}
                      className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-surface-2"
                    >
                      {content}
                    </button>
                  ) : (
                    <div className="flex items-start gap-2.5 px-3 py-2.5">{content}</div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}

export { Check }
