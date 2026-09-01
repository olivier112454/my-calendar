'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  ChevronDown,
  CircleHelp,
  LogOut,
  Palette,
  Pencil,
  Plus,
  Search,
  Settings,
  Share2,
  Trash2,
  Eye,
  EyeOff,
  PanelLeftClose,
  PanelLeftOpen,
  Link2,
} from 'lucide-react'
import { cn, initials } from '@/lib/utils'
import { api } from '@/lib/client/api'
import { calendarPalette } from '@/config/app'
import { Wordmark, Logo } from '@/components/brand'
import { Button } from '@/components/ui/button'
import { Checkbox, Tooltip } from '@/components/ui/controls'
import { Avatar, ColorDot, Kbd, Separator } from '@/components/ui/primitives'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/menu'
import { ConfirmDialog } from '@/components/ui/overlay'
import { navItems } from './nav-items'
import { useAppShell } from './app-shell-context'
import { CalendarCreateDialog } from './calendar-create-dialog'

/**
 * Left sidebar: brand, search, create, navigation, calendars, account.
 *
 * Collapsed it becomes an icon rail — still fully usable, with names moved into
 * tooltips and `aria-label`s, never dropped.
 */

export function Sidebar({
  collapsed,
  onNavigate,
}: {
  collapsed: boolean
  onNavigate?: () => void
}) {
  const pathname = usePathname()
  const router = useRouter()
  const {
    user,
    calendars,
    setCommandOpen,
    requestCreate,
    toggleSidebar,
  } = useAppShell()

  const [localCalendars, setLocalCalendars] = React.useState(calendars)
  const [syncedCalendars, setSyncedCalendars] = React.useState(calendars)
  if (syncedCalendars !== calendars) {
    setSyncedCalendars(calendars)
    setLocalCalendars(calendars)
  }

  const [createOpen, setCreateOpen] = React.useState(false)
  const [pendingDelete, setPendingDelete] = React.useState<string | null>(null)

  const owned = localCalendars.filter((calendar) => !calendar.provider)
  const connected = localCalendars.filter((calendar) => calendar.provider)

  const setVisible = async (calendarId: string, isVisible: boolean) => {
    setLocalCalendars((current) =>
      current.map((calendar) =>
        calendar.id === calendarId ? { ...calendar, isVisible } : calendar,
      ),
    )
    try {
      await api.patch(`/api/calendars/${calendarId}`, { isVisible })
      router.refresh()
    } catch {
      setLocalCalendars(calendars)
    }
  }

  const showOnly = async (calendarId: string) => {
    setLocalCalendars((current) =>
      current.map((calendar) => ({
        ...calendar,
        isVisible: calendar.id === calendarId,
      })),
    )
    try {
      await api.post('/api/calendars/visibility', { visibleIds: [calendarId] })
      router.refresh()
    } catch {
      setLocalCalendars(calendars)
    }
  }

  const changeColor = async (calendarId: string, color: string) => {
    setLocalCalendars((current) =>
      current.map((calendar) =>
        calendar.id === calendarId ? { ...calendar, color } : calendar,
      ),
    )
    try {
      await api.patch(`/api/calendars/${calendarId}`, { color })
      router.refresh()
    } catch {
      setLocalCalendars(calendars)
      toast.error('Could not change the colour.')
    }
  }

  const rename = async (calendarId: string, currentName: string) => {
    const name = window.prompt('Calendar name', currentName)
    if (!name || name === currentName) return
    try {
      await api.patch(`/api/calendars/${calendarId}`, { name })
      router.refresh()
      toast.success('Calendar renamed')
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Could not rename.')
    }
  }

  const remove = async (calendarId: string) => {
    try {
      await api.delete(`/api/calendars/${calendarId}`)
      toast.success('Calendar deleted')
      router.refresh()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Could not delete.')
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* --------------------------------------------------------- header */}
      <div
        className={cn(
          'flex h-13 shrink-0 items-center gap-1 px-2',
          collapsed ? 'justify-center' : 'justify-between pl-3',
        )}
      >
        <Link
          href="/today"
          onClick={onNavigate}
          className="flex min-w-0 items-center rounded-md"
          aria-label="Go to Today"
        >
          {collapsed ? <Logo /> : <Wordmark />}
        </Link>
        {!collapsed ? (
          <Tooltip content="Collapse sidebar" shortcut="[">
            <Button
              variant="ghost"
              size="iconSm"
              onClick={toggleSidebar}
              aria-label="Collapse sidebar"
              className="hidden md:inline-flex"
            >
              <PanelLeftClose />
            </Button>
          </Tooltip>
        ) : null}
      </div>

      {collapsed ? (
        <div className="flex justify-center pb-1">
          <Tooltip content="Expand sidebar" shortcut="[">
            <Button
              variant="ghost"
              size="iconSm"
              onClick={toggleSidebar}
              aria-label="Expand sidebar"
            >
              <PanelLeftOpen />
            </Button>
          </Tooltip>
        </div>
      ) : null}

      {/* ------------------------------------------------ search + create */}
      <div className={cn('space-y-1.5 px-2 pb-2', collapsed && 'px-1.5')}>
        {collapsed ? (
          <>
            <Tooltip content="Search" shortcut="/">
              <Button
                variant="ghost"
                size="icon"
                block
                onClick={() => setCommandOpen(true)}
                aria-label="Search"
              >
                <Search />
              </Button>
            </Tooltip>
            <Tooltip content="Create" shortcut="C">
              <Button
                variant="primary"
                size="icon"
                block
                onClick={() => requestCreate()}
                aria-label="Create event"
              >
                <Plus />
              </Button>
            </Tooltip>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setCommandOpen(true)}
              className={cn(
                'flex h-8 w-full items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5',
                'text-[13px] text-fg-subtle transition-colors hover:border-border-strong hover:bg-surface',
              )}
            >
              <Search className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="flex-1 text-left">Search</span>
              <Kbd>⌘K</Kbd>
            </button>
            <Button variant="primary" size="md" block onClick={() => requestCreate()}>
              <Plus />
              Create
            </Button>
          </>
        )}
      </div>

      {/* ----------------------------------------------------- navigation */}
      <nav className={cn('px-2', collapsed && 'px-1.5')} aria-label="Sections">
        <ul className="space-y-px">
          {navItems.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(`${item.href}/`)
            const Icon = item.icon
            const link = (
              <Link
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-8 items-center gap-2.5 rounded-md text-[13px] font-medium transition-colors',
                  collapsed ? 'justify-center px-0' : 'px-2.5',
                  active
                    ? 'bg-surface-2 text-fg'
                    : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden="true" />
                {collapsed ? (
                  <span className="sr-only">{item.label}</span>
                ) : (
                  <span className="truncate">{item.label}</span>
                )}
              </Link>
            )
            return (
              <li key={item.href}>
                {collapsed ? (
                  <Tooltip content={item.label} side="right">
                    {link}
                  </Tooltip>
                ) : (
                  link
                )}
              </li>
            )
          })}
        </ul>
      </nav>

      {/* ------------------------------------------------------ calendars */}
      {!collapsed ? (
        <div className="scrollbar-thin mt-3 min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          <SidebarSection
            title="My calendars"
            action={
              <Tooltip content="New calendar">
                <Button
                  variant="ghost"
                  size="iconSm"
                  onClick={() => setCreateOpen(true)}
                  aria-label="New calendar"
                >
                  <Plus />
                </Button>
              </Tooltip>
            }
          >
            {owned.map((calendar) => (
              <CalendarRow
                key={calendar.id}
                calendar={calendar}
                onToggle={(visible) => void setVisible(calendar.id, visible)}
                onShowOnly={() => void showOnly(calendar.id)}
                onColor={(color) => void changeColor(calendar.id, color)}
                onRename={() => void rename(calendar.id, calendar.name)}
                onDelete={() => setPendingDelete(calendar.id)}
              />
            ))}
          </SidebarSection>

          {connected.length > 0 ? (
            <SidebarSection title="Connected calendars" className="mt-3">
              {connected.map((calendar) => (
                <CalendarRow
                  key={calendar.id}
                  calendar={calendar}
                  onToggle={(visible) => void setVisible(calendar.id, visible)}
                  onShowOnly={() => void showOnly(calendar.id)}
                  onColor={(color) => void changeColor(calendar.id, color)}
                />
              ))}
            </SidebarSection>
          ) : (
            <div className="mt-3 rounded-lg border border-dashed border-border px-3 py-3">
              <p className="text-[13px] font-medium text-fg">Connect a calendar</p>
              <p className="mt-0.5 text-xs leading-relaxed text-fg-muted">
                Bring in Google Calendar to see everything in one place.
              </p>
              <Button
                variant="secondary"
                size="sm"
                className="mt-2"
                asChild
              >
                <Link href="/settings/integrations">
                  <Link2 />
                  Connect
                </Link>
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1" />
      )}

      {/* -------------------------------------------------------- account */}
      <div className={cn('border-t border-border p-2', collapsed && 'px-1.5')}>
        {!collapsed ? (
          <div className="mb-1 flex items-center gap-0.5">
            <Button variant="ghost" size="sm" asChild className="flex-1 justify-start">
              <Link href="/settings/general" onClick={onNavigate}>
                <Settings />
                Settings
              </Link>
            </Button>
            <Tooltip content="Keyboard shortcuts" shortcut="?">
              <Button variant="ghost" size="iconSm" asChild aria-label="Help">
                <Link href="/settings/shortcuts" onClick={onNavigate}>
                  <CircleHelp />
                </Link>
              </Button>
            </Tooltip>
          </div>
        ) : null}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                'flex w-full items-center gap-2 rounded-md p-1 transition-colors hover:bg-surface-2',
                collapsed && 'justify-center',
              )}
              aria-label="Account menu"
            >
              <Avatar name={user.name ?? user.email} src={user.avatarUrl} size="sm" />
              {!collapsed ? (
                <>
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-[13px] font-medium text-fg">
                      {user.name ?? user.email}
                    </span>
                    <span className="block truncate text-[11px] text-fg-subtle">
                      {user.email}
                    </span>
                  </span>
                  <ChevronDown className="size-3.5 shrink-0 text-fg-subtle" aria-hidden="true" />
                </>
              ) : null}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-56">
            <DropdownMenuLabel>{user.email}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/settings/account">
                <Settings />
                Account settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/settings/integrations">
                <Link2 />
                Connected accounts
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              danger
              onSelect={() => {
                // A real form post, so sign-out works without JavaScript too.
                const form = document.createElement('form')
                form.method = 'POST'
                form.action = '/api/auth/signout'
                document.body.appendChild(form)
                form.submit()
              }}
            >
              <LogOut />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <CalendarCreateDialog open={createOpen} onOpenChange={setCreateOpen} />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title="Delete this calendar?"
        description="Its events are deleted with it. This cannot be undone."
        confirmLabel="Delete calendar"
        onConfirm={async () => {
          if (pendingDelete) await remove(pendingDelete)
        }}
      />
    </div>
  )
}

function SidebarSection({
  title,
  action,
  className,
  children,
}: {
  title: string
  action?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <section className={className}>
      <div className="flex h-6 items-center justify-between pl-2.5 pr-0.5">
        <h2 className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
          {title}
        </h2>
        {action}
      </div>
      <ul className="space-y-px">{children}</ul>
    </section>
  )
}

function CalendarRow({
  calendar,
  onToggle,
  onShowOnly,
  onColor,
  onRename,
  onDelete,
}: {
  calendar: import('@/types/domain').CalendarSummary
  onToggle: (visible: boolean) => void
  onShowOnly: () => void
  onColor: (color: string) => void
  onRename?: () => void
  onDelete?: () => void
}) {
  return (
    <li>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <label
            className={cn(
              'group flex h-7 cursor-pointer items-center gap-2 rounded-md px-2.5 transition-colors',
              'hover:bg-surface-2',
            )}
          >
            <Checkbox
              checked={calendar.isVisible}
              onCheckedChange={(checked) => onToggle(checked === true)}
              aria-label={`Show ${calendar.name}`}
              // The checkbox takes the calendar's own colour, so the control and
              // the events it governs are visibly the same thing.
              style={{ '--accent': calendar.color } as React.CSSProperties}
              className="size-3.5"
            />
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-[13px]',
                calendar.isVisible ? 'text-fg' : 'text-fg-subtle',
              )}
              title={calendar.accountEmail ?? calendar.name}
            >
              {calendar.name}
            </span>
            {calendar.isReadOnly ? (
              <span className="text-[10px] text-fg-subtle" title="Read-only">
                RO
              </span>
            ) : null}
          </label>
        </ContextMenuTrigger>

        <ContextMenuContent>
          <ContextMenuItem onSelect={onShowOnly}>
            <Eye />
            Show only this
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onToggle(!calendar.isVisible)}>
            {calendar.isVisible ? <EyeOff /> : <Eye />}
            {calendar.isVisible ? 'Hide' : 'Show'}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <Palette />
              Change colour
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-auto p-2">
              <div className="grid grid-cols-5 gap-1.5">
                {calendarPalette.map((entry) => (
                  <button
                    key={entry.value}
                    type="button"
                    onClick={() => onColor(entry.value)}
                    aria-label={entry.name}
                    title={entry.name}
                    className={cn(
                      'flex size-6 items-center justify-center rounded-full border-2 transition-transform hover:scale-110',
                      calendar.color === entry.value
                        ? 'border-fg'
                        : 'border-transparent',
                    )}
                  >
                    <ColorDot color={entry.value} size={16} />
                  </button>
                ))}
              </div>
            </ContextMenuSubContent>
          </ContextMenuSub>
          {onRename ? (
            <ContextMenuItem onSelect={onRename}>
              <Pencil />
              Rename
            </ContextMenuItem>
          ) : null}
          <ContextMenuItem disabled>
            <Share2 />
            Share
            <span className="ml-auto text-[10px] text-fg-subtle">Soon</span>
          </ContextMenuItem>
          {onDelete && !calendar.isDefault ? (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem danger onSelect={onDelete}>
                <Trash2 />
                Delete
              </ContextMenuItem>
            </>
          ) : null}
        </ContextMenuContent>
      </ContextMenu>
    </li>
  )
}

export { Separator, initials }
