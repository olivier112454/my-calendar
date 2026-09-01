'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { LogOut, MoreHorizontal, Plus, Search, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/lib/client/api'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/overlay'
import { Avatar, ColorDot } from '@/components/ui/primitives'
import { Checkbox } from '@/components/ui/controls'
import { mobileNavItems, navItems, settingsSections } from './nav-items'
import { useAppShell } from './app-shell-context'

/**
 * Bottom navigation for phones.
 *
 * Four destinations plus a central create button — the reachable maximum for a
 * thumb. This is the whole navigation on a phone, not a shortcut to a drawer,
 * so "More" carries everything the sidebar would: the remaining pages, the
 * calendar toggles, search and settings.
 */
export function MobileNav() {
  const pathname = usePathname()
  const router = useRouter()
  const { requestCreate, setCommandOpen, calendars, user } = useAppShell()
  const [moreOpen, setMoreOpen] = React.useState(false)
  const [localCalendars, setLocalCalendars] = React.useState(calendars)

  const [syncedFrom, setSyncedFrom] = React.useState(calendars)
  if (syncedFrom !== calendars) {
    setSyncedFrom(calendars)
    setLocalCalendars(calendars)
  }

  const primary = mobileNavItems.slice(0, 2)
  const secondary = mobileNavItems.slice(2, 3)
  const overflow = navItems.filter((item) => !item.mobile)

  const toggleCalendar = async (calendarId: string, isVisible: boolean) => {
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

  return (
    <nav
      className="shrink-0 border-t border-border bg-surface pb-safe md:hidden"
      aria-label="Main navigation"
    >
      <ul className="flex items-stretch">
        {primary.map((item) => (
          <li key={item.href} className="flex-1">
            <NavTab item={item} active={pathname.startsWith(item.href)} />
          </li>
        ))}

        <li className="flex flex-1 items-center justify-center">
          <button
            type="button"
            onClick={() => requestCreate()}
            aria-label="Create event"
            className={cn(
              'flex size-11 items-center justify-center rounded-full bg-accent text-accent-fg',
              'shadow-sm transition-transform active:scale-95',
            )}
          >
            <Plus className="size-5" aria-hidden="true" />
          </button>
        </li>

        {secondary.map((item) => (
          <li key={item.href} className="flex-1">
            <NavTab item={item} active={pathname.startsWith(item.href)} />
          </li>
        ))}

        <li className="flex-1">
          <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
            <SheetTrigger asChild>
              <button
                type="button"
                className="flex h-full w-full flex-col items-center justify-center gap-0.5 py-1.5 text-fg-muted"
              >
                <MoreHorizontal className="size-[18px]" aria-hidden="true" />
                <span className="text-[10px] font-medium">More</span>
              </button>
            </SheetTrigger>

            <SheetContent side="bottom" title="More">
              <div className="space-y-4 pb-2">
                <button
                  type="button"
                  onClick={() => {
                    setMoreOpen(false)
                    setCommandOpen(true)
                  }}
                  className="flex h-10 w-full items-center gap-2.5 rounded-md border border-border bg-surface-2 px-3 text-[14px] text-fg-subtle"
                >
                  <Search className="size-4" aria-hidden="true" />
                  Search
                </button>

                <section>
                  <h3 className="px-1 pb-1 text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
                    Go to
                  </h3>
                  <ul className="space-y-px">
                    {overflow.map((item) => {
                      const Icon = item.icon
                      return (
                        <li key={item.href}>
                          <Link
                            href={item.href}
                            onClick={() => setMoreOpen(false)}
                            className="flex items-center gap-3 rounded-md px-2 py-2.5 text-[14px] text-fg transition-colors hover:bg-surface-2"
                          >
                            <Icon className="size-4 text-fg-subtle" aria-hidden="true" />
                            {item.label}
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                </section>

                <section>
                  <h3 className="px-1 pb-1 text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
                    Calendars
                  </h3>
                  <ul className="space-y-px">
                    {localCalendars.map((calendar) => (
                      <li key={calendar.id}>
                        <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2.5 transition-colors hover:bg-surface-2">
                          <Checkbox
                            checked={calendar.isVisible}
                            onCheckedChange={(checked) =>
                              void toggleCalendar(calendar.id, checked === true)
                            }
                            aria-label={`Show ${calendar.name}`}
                            style={
                              { '--accent': calendar.color } as React.CSSProperties
                            }
                          />
                          <ColorDot color={calendar.color} />
                          <span className="min-w-0 flex-1 truncate text-[14px] text-fg">
                            {calendar.name}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </section>

                <section>
                  <h3 className="px-1 pb-1 text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
                    Settings
                  </h3>
                  <ul className="space-y-px">
                    {settingsSections.map((section) => (
                      <li key={section.href}>
                        <Link
                          href={section.href}
                          onClick={() => setMoreOpen(false)}
                          className="flex items-center gap-3 rounded-md px-2 py-2.5 text-[14px] text-fg transition-colors hover:bg-surface-2"
                        >
                          <Settings className="size-4 text-fg-subtle" aria-hidden="true" />
                          {section.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>

                <section className="border-t border-border pt-3">
                  <div className="flex items-center gap-2.5 px-2 pb-2">
                    <Avatar name={user.name ?? user.email} src={user.avatarUrl} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium text-fg">
                        {user.name ?? user.email}
                      </p>
                      <p className="truncate text-[11px] text-fg-subtle">{user.email}</p>
                    </div>
                  </div>
                  <form action="/api/auth/signout" method="POST">
                    <button
                      type="submit"
                      className="flex w-full items-center gap-3 rounded-md px-2 py-2.5 text-left text-[14px] text-danger transition-colors hover:bg-danger-soft"
                    >
                      <LogOut className="size-4" aria-hidden="true" />
                      Sign out
                    </button>
                  </form>
                </section>
              </div>
            </SheetContent>
          </Sheet>
        </li>
      </ul>
    </nav>
  )
}

function NavTab({
  item,
  active,
}: {
  item: (typeof navItems)[number]
  active: boolean
}) {
  const Icon = item.icon
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex h-full w-full flex-col items-center justify-center gap-0.5 py-1.5 transition-colors',
        active ? 'text-accent' : 'text-fg-muted',
      )}
    >
      <Icon className="size-[18px]" aria-hidden="true" />
      <span className="text-[10px] font-medium">{item.label}</span>
    </Link>
  )
}
