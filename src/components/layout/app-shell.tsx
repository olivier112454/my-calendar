'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import { Sidebar } from './sidebar'
import { MobileNav } from './mobile-nav'
import { RightPanel } from './right-panel'
import { AppShellProvider, useAppShell } from './app-shell-context'
import type { AppShellData } from './app-shell-context'

/**
 * The three-column frame.
 *
 * Desktop: navigation, work area, context. Both side columns collapse, and the
 * collapsed state is remembered per device.
 *
 * Below `lg` the context column disappears — 20rem of detail beside a 390px
 * calendar leaves nothing for the calendar — and the same content is presented
 * as a bottom sheet by whichever page opened it.
 *
 * Below `md` the sidebar is replaced outright by the bottom bar rather than
 * hidden behind a drawer. A drawer would need a hamburger competing with the
 * page's own controls, and everything in the sidebar fits comfortably in the
 * bar plus its "More" sheet.
 */

export function AppShell({
  data,
  children,
}: {
  data: AppShellData
  children: React.ReactNode
}) {
  return (
    <AppShellProvider data={data}>
      <ShellFrame>{children}</ShellFrame>
    </AppShellProvider>
  )
}

function ShellFrame({ children }: { children: React.ReactNode }) {
  const { sidebarOpen, rightPanelOpen, rightPanelContent } = useAppShell()

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-bg">
      {/* Desktop sidebar: part of the layout, not an overlay. */}
      <aside
        className={cn(
          'hidden shrink-0 border-r border-border bg-surface transition-[width] duration-200 md:block',
          sidebarOpen ? 'w-[15.5rem]' : 'w-[3.25rem]',
        )}
        aria-label="Main navigation"
      >
        <Sidebar collapsed={!sidebarOpen} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <main id="main" className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {children}
        </main>
        <MobileNav />
      </div>

      {/* Context column. Present on large screens only; elsewhere the same
          content is presented as a sheet by whichever page opened it. */}
      {rightPanelContent ? (
        <aside
          className={cn(
            'hidden shrink-0 border-l border-border bg-surface lg:block',
            rightPanelOpen ? 'w-[20rem] xl:w-[22rem]' : 'w-0 overflow-hidden border-l-0',
          )}
          aria-label="Details"
        >
          {rightPanelOpen ? <RightPanel /> : null}
        </aside>
      ) : null}
    </div>
  )
}

export { useAppShell }
export type { AppShellData }
