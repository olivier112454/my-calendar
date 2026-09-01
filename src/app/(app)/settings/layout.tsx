import { requireUserPage } from '@/lib/auth'
import { SettingsNav } from '@/components/settings/settings-nav'

/**
 * Settings shell: a persistent section list beside the active page. On a phone
 * the list becomes a horizontal scroller above the content rather than a
 * separate screen, so switching sections stays one tap.
 */
export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await requireUserPage('/settings')

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="shrink-0 border-b border-border bg-surface px-4 pt-3 sm:px-6">
        <h1 className="text-[15px] font-semibold tracking-[-0.01em] text-fg">Settings</h1>
        <div className="mt-2 lg:hidden">
          <SettingsNav orientation="horizontal" />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav
          className="hidden w-52 shrink-0 border-r border-border bg-surface p-2 lg:block"
          aria-label="Settings sections"
        >
          <SettingsNav orientation="vertical" />
        </nav>

        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6">{children}</div>
        </div>
      </div>
    </div>
  )
}
