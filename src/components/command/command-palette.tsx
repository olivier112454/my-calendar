'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Command } from 'cmdk'
import {
  ArrowRight,
  CalendarPlus,
  CheckSquare,
  Contact,
  CornerDownLeft,
  Loader2,
  Monitor,
  Moon,
  Search,
  Settings,
  Sun,
  SunMoon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { api, qs } from '@/lib/client/api'
import { debounce } from '@/lib/utils'
import { formatDayLabel, formatTimeCompact } from '@/lib/datetime'
import { navItems, settingsSections } from '@/components/layout/nav-items'
import { useAppShell } from '@/components/layout/app-shell-context'
import { useAppearance } from '@/components/theme-provider'
import { Dialog, DialogContent } from '@/components/ui/overlay'
import { Kbd } from '@/components/ui/primitives'
import type { SearchResults } from '@/types/search'

/**
 * Command palette and global search in one surface.
 *
 * Typing filters the static commands immediately and, in parallel, queries the
 * server for matching events, tasks, contacts and mail. Search is server-side
 * because a calendar of any age does not fit in the browser — and because the
 * user should be able to find a meeting from three years ago.
 */

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const { requestCreate, timezone, use24h, showInPanel } = useAppShell()
  const { theme, setAppearance } = useAppearance()

  const [query, setQuery] = React.useState('')
  const [results, setResults] = React.useState<SearchResults | null>(null)
  const [searching, setSearching] = React.useState(false)

  React.useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clears the palette when it closes and tracks the in-flight search
      setQuery('')
      setResults(null)
    }
  }, [open])

  const search = React.useMemo(
    () =>
      debounce((term: string) => {
        if (term.trim().length < 2) {
          setResults(null)
          setSearching(false)
          return
        }
        api
          .get<SearchResults>(`/api/search${qs({ q: term })}`)
          .then(setResults)
          .catch(() => setResults(null))
          .finally(() => setSearching(false))
      }, 220),
    [],
  )

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clears the palette when it closes and tracks the in-flight search
    setSearching(query.trim().length >= 2)
    search(query)
    return () => search.cancel()
  }, [query, search])

  const run = (action: () => void) => {
    onOpenChange(false)
    // Let the dialog close before navigating, so focus returns cleanly.
    requestAnimationFrame(action)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Command palette"
        hideHeader
        width="md"
        className="max-h-[min(32rem,80dvh)] p-0"
      >
        <Command
          shouldFilter
          loop
          label="Command palette"
          className="flex max-h-[inherit] flex-col"
        >
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search className="size-4 shrink-0 text-fg-subtle" aria-hidden="true" />
            <Command.Input
              value={query}
              onValueChange={setQuery}
              placeholder="Search or type a command…"
              className="h-11 flex-1 bg-transparent text-[14px] text-fg outline-none placeholder:text-fg-subtle"
            />
            {searching ? (
              <Loader2 className="size-3.5 animate-spin text-fg-subtle" aria-hidden="true" />
            ) : (
              <Kbd>Esc</Kbd>
            )}
          </div>

          <Command.List className="scrollbar-thin max-h-[24rem] overflow-y-auto p-1.5">
            <Command.Empty className="px-3 py-8 text-center text-[13px] text-fg-muted">
              {query.trim().length >= 2
                ? `Nothing matches “${query}”.`
                : 'Start typing to search.'}
            </Command.Empty>

            <Group heading="Create">
              <Item
                icon={<CalendarPlus />}
                label="New event"
                shortcut="C"
                onSelect={() => run(() => requestCreate())}
              />
              <Item
                icon={<CheckSquare />}
                label="New task"
                onSelect={() => run(() => router.push('/tasks?new=1'))}
              />
              <Item
                icon={<Contact />}
                label="New contact"
                onSelect={() => run(() => router.push('/contacts?new=1'))}
              />
            </Group>

            <Group heading="Go to">
              {navItems.map((item) => (
                <Item
                  key={item.href}
                  icon={<item.icon />}
                  label={item.label}
                  hint={item.description}
                  shortcut={item.shortcut}
                  onSelect={() => run(() => router.push(item.href))}
                />
              ))}
            </Group>

            {results ? (
              <>
                {results.events.length > 0 ? (
                  <Group heading="Events">
                    {results.events.map((event) => (
                      <Item
                        key={event.id}
                        icon={
                          <span
                            className="size-2 rounded-full"
                            style={{ backgroundColor: event.color }}
                          />
                        }
                        label={event.title}
                        hint={`${formatDayLabel(event.dayKey, 'EEE d MMM')}${
                          event.allDay
                            ? ''
                            : ` · ${formatTimeCompact(new Date(event.start), timezone, use24h)}`
                        }`}
                        onSelect={() =>
                          run(() => {
                            router.push(`/calendar?date=${event.dayKey}&view=day`)
                            showInPanel({ kind: 'event', eventId: event.id })
                          })
                        }
                      />
                    ))}
                  </Group>
                ) : null}

                {results.tasks.length > 0 ? (
                  <Group heading="Tasks">
                    {results.tasks.map((task) => (
                      <Item
                        key={task.id}
                        icon={<CheckSquare />}
                        label={task.title}
                        hint={task.projectName ?? undefined}
                        onSelect={() => run(() => router.push(`/tasks?task=${task.id}`))}
                      />
                    ))}
                  </Group>
                ) : null}

                {results.contacts.length > 0 ? (
                  <Group heading="People">
                    {results.contacts.map((contact) => (
                      <Item
                        key={contact.id}
                        icon={<Contact />}
                        label={contact.name}
                        hint={contact.email ?? undefined}
                        onSelect={() =>
                          run(() => router.push(`/contacts/${contact.id}`))
                        }
                      />
                    ))}
                  </Group>
                ) : null}

                {results.emails.length > 0 ? (
                  <Group heading="Mail">
                    {results.emails.map((email) => (
                      <Item
                        key={email.id}
                        icon={<ArrowRight />}
                        label={email.subject ?? '(no subject)'}
                        hint={email.fromName ?? email.fromEmail ?? undefined}
                        onSelect={() => run(() => router.push(`/inbox?message=${email.id}`))}
                      />
                    ))}
                  </Group>
                ) : null}
              </>
            ) : null}

            <Group heading="Appearance">
              <Item
                icon={<Sun />}
                label="Light theme"
                selected={theme === 'LIGHT'}
                onSelect={() => run(() => setAppearance({ theme: 'LIGHT' }))}
              />
              <Item
                icon={<Moon />}
                label="Dark theme"
                selected={theme === 'DARK'}
                onSelect={() => run(() => setAppearance({ theme: 'DARK' }))}
              />
              <Item
                icon={<Monitor />}
                label="Match system"
                selected={theme === 'SYSTEM'}
                onSelect={() => run(() => setAppearance({ theme: 'SYSTEM' }))}
              />
              <Item
                icon={<SunMoon />}
                label="Toggle dark mode"
                shortcut="⇧D"
                onSelect={() =>
                  run(() =>
                    setAppearance({ theme: theme === 'DARK' ? 'LIGHT' : 'DARK' }),
                  )
                }
              />
            </Group>

            <Group heading="Settings">
              {settingsSections.map((section) => (
                <Item
                  key={section.href}
                  icon={<Settings />}
                  label={section.label}
                  onSelect={() => run(() => router.push(section.href))}
                />
              ))}
            </Group>
          </Command.List>

          <div className="flex items-center gap-3 border-t border-border px-3 py-2 text-[11px] text-fg-subtle">
            <span className="flex items-center gap-1">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
              to navigate
            </span>
            <span className="flex items-center gap-1">
              <CornerDownLeft className="size-3" aria-hidden="true" />
              to select
            </span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  )
}

function Group({
  heading,
  children,
}: {
  heading: string
  children: React.ReactNode
}) {
  return (
    <Command.Group
      heading={heading}
      className={cn(
        '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5',
        '[&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium',
        '[&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide',
        '[&_[cmdk-group-heading]]:text-fg-subtle',
      )}
    >
      {children}
    </Command.Group>
  )
}

function Item({
  icon,
  label,
  hint,
  shortcut,
  selected,
  onSelect,
}: {
  icon: React.ReactNode
  label: string
  hint?: string
  shortcut?: string
  selected?: boolean
  onSelect: () => void
}) {
  return (
    <Command.Item
      value={`${label} ${hint ?? ''}`}
      onSelect={onSelect}
      className={cn(
        'flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-[13px] text-fg',
        'data-[selected=true]:bg-surface-2',
        '[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-fg-subtle',
      )}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">
        {label}
        {hint ? <span className="ml-2 text-fg-subtle">{hint}</span> : null}
      </span>
      {selected ? <span className="text-[11px] text-accent">Active</span> : null}
      {shortcut ? <Kbd>{shortcut}</Kbd> : null}
    </Command.Item>
  )
}
