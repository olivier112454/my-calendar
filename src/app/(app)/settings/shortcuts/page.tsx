import type { Metadata } from 'next'
import { requireUserPage } from '@/lib/auth'
import { Kbd } from '@/components/ui/primitives'
import { SettingsSection } from '@/components/settings/settings-nav'

export const metadata: Metadata = { title: 'Keyboard shortcuts' }

/**
 * The shortcut reference.
 *
 * Kept as a page rather than a modal so it can be linked to, printed and read
 * beside the app while you learn it.
 */

const GROUPS: { title: string; items: { keys: string[]; label: string }[] }[] = [
  {
    title: 'Anywhere',
    items: [
      { keys: ['⌘', 'K'], label: 'Open the command palette' },
      { keys: ['/'], label: 'Search' },
      { keys: ['C'], label: 'Create an event' },
      { keys: ['['], label: 'Show or hide the sidebar' },
      { keys: [']'], label: 'Show or hide the details panel' },
      { keys: ['⇧', 'D'], label: 'Switch between light and dark' },
      { keys: ['?'], label: 'Open this page' },
      { keys: ['Esc'], label: 'Close what is open' },
    ],
  },
  {
    title: 'Go to',
    items: [
      { keys: ['G', 'T'], label: 'Today' },
      { keys: ['G', 'C'], label: 'Calendar' },
      { keys: ['G', 'K'], label: 'Tasks' },
      { keys: ['G', 'I'], label: 'Inbox' },
      { keys: ['G', 'S'], label: 'Schedule' },
      { keys: ['G', 'P'], label: 'Contacts' },
      { keys: ['G', 'M'], label: 'Meetings' },
      { keys: ['G', 'A'], label: 'Analytics' },
    ],
  },
  {
    title: 'In the calendar',
    items: [
      { keys: ['D'], label: 'Day view' },
      { keys: ['3'], label: 'Three days' },
      { keys: ['X'], label: 'Work week' },
      { keys: ['W'], label: 'Week view' },
      { keys: ['M'], label: 'Month view' },
      { keys: ['Y'], label: 'Year view' },
      { keys: ['A'], label: 'Agenda view' },
      { keys: ['T'], label: 'Jump to today' },
      { keys: ['←'], label: 'Previous period' },
      { keys: ['→'], label: 'Next period' },
      { keys: ['Del'], label: 'Delete the selected event' },
    ],
  },
  {
    title: 'In the composer',
    items: [
      { keys: ['Enter'], label: 'Save from the title field' },
      { keys: ['Esc'], label: 'Cancel' },
    ],
  },
]

export default async function ShortcutsPage() {
  await requireUserPage('/settings/shortcuts')

  return (
    <>
      <p className="mb-6 text-[13px] leading-relaxed text-fg-muted">
        Single-key shortcuts are ignored while you are typing in a field, so they
        never get in the way of writing a title.
      </p>

      {GROUPS.map((group) => (
        <SettingsSection key={group.title} title={group.title}>
          <ul className="divide-y divide-border">
            {group.items.map((item) => (
              <li
                key={item.label}
                className="flex items-center justify-between gap-4 py-2.5"
              >
                <span className="text-[13px] text-fg">{item.label}</span>
                <span className="flex shrink-0 items-center gap-1">
                  {item.keys.map((key, index) => (
                    <span key={index} className="flex items-center gap-1">
                      {index > 0 ? (
                        <span className="text-[10px] text-fg-subtle">then</span>
                      ) : null}
                      <Kbd>{key}</Kbd>
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </SettingsSection>
      ))}
    </>
  )
}
