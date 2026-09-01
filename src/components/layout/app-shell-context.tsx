'use client'

import * as React from 'react'
import type {
  CalendarSummary,
  CategorySummary,
  EventOccurrence,
  NotificationSummary,
  TaskSummary,
} from '@/types/domain'

/**
 * Shell-level state: which columns are open, and what the right panel is
 * currently showing. Kept apart from calendar state so pages that have nothing
 * to do with the calendar (Tasks, Contacts, Settings) can still use the frame.
 */

export interface ShellUser {
  id: string
  name: string | null
  email: string
  avatarUrl: string | null
  username: string | null
  timezone: string
}

export interface AppShellData {
  user: ShellUser
  calendars: CalendarSummary[]
  /** Available on every page, because the composer is mounted on every page. */
  categories: CategorySummary[]
  notifications: NotificationSummary[]
  unreadCount: number
  /**
   * Today's events and the tasks still without a time block, resolved by the
   * layout rather than fetched by the context panel. Doing it server-side is
   * what keeps the panel in step with the page: a `router.refresh()` after any
   * change re-renders both, so the two can never disagree about the day.
   */
  todayEvents: EventOccurrence[]
  looseTasks: TaskSummary[]
  weekStartsOn: number
  timezone: string
  use24h: boolean
  showWeekNumbers: boolean
  hasIntegrations: boolean
}

export type RightPanelContent =
  | null
  | { kind: 'event'; eventId: string; occurrenceStart?: string | null }
  | { kind: 'task'; taskId: string }
  | { kind: 'contact'; contactId: string }
  | { kind: 'agenda' }

interface AppShellContextValue extends AppShellData {
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
  toggleSidebar: () => void

  rightPanelOpen: boolean
  setRightPanelOpen: (open: boolean) => void
  toggleRightPanel: () => void

  rightPanelContent: RightPanelContent
  /** Opens the context column on whatever was selected. */
  showInPanel: (content: RightPanelContent) => void
  closePanel: () => void

  /** Opens the global command palette. */
  commandOpen: boolean
  setCommandOpen: (open: boolean) => void

  /** Opens the event composer with no prefilled values. */
  requestCreate: (seed?: { start?: Date; end?: Date; allDay?: boolean }) => void
  createRequest: { start?: Date; end?: Date; allDay?: boolean; nonce: number } | null
  clearCreateRequest: () => void
}

const AppShellContext = React.createContext<AppShellContextValue | null>(null)

const SIDEBAR_KEY = 'dayflow.sidebar'
const PANEL_KEY = 'dayflow.rightpanel'

export function AppShellProvider({
  data,
  children,
}: {
  data: AppShellData
  children: React.ReactNode
}) {
  // Default open, which is right for the desktop column; the shell decides
  // separately whether a narrow viewport should show the drawer at all. The
  // stored preference takes over after mount so SSR and hydration agree.
  const [sidebarOpen, setSidebarOpenState] = React.useState(true)
  const [rightPanelOpen, setRightPanelOpenState] = React.useState(true)
  const [rightPanelContent, setRightPanelContent] = React.useState<RightPanelContent>({
    kind: 'agenda',
  })
  const [commandOpen, setCommandOpen] = React.useState(false)
  const [createRequest, setCreateRequest] = React.useState<
    { start?: Date; end?: Date; allDay?: boolean; nonce: number } | null
  >(null)

  React.useEffect(() => {
    try {
      const storedSidebar = localStorage.getItem(SIDEBAR_KEY)
      const storedPanel = localStorage.getItem(PANEL_KEY)
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reads the stored panel layout after mount, which cannot run during SSR
      setSidebarOpenState(storedSidebar !== 'closed')
      setRightPanelOpenState(storedPanel !== 'closed')
    } catch {
      /* private mode — keep the defaults */
    }
  }, [])

  const setSidebarOpen = React.useCallback((open: boolean) => {
    setSidebarOpenState(open)
    try {
      localStorage.setItem(SIDEBAR_KEY, open ? 'open' : 'closed')
    } catch {
      /* ignore */
    }
  }, [])

  const setRightPanelOpen = React.useCallback((open: boolean) => {
    setRightPanelOpenState(open)
    try {
      localStorage.setItem(PANEL_KEY, open ? 'open' : 'closed')
    } catch {
      /* ignore */
    }
  }, [])

  const showInPanel = React.useCallback(
    (content: RightPanelContent) => {
      setRightPanelContent(content)
      if (content) setRightPanelOpen(true)
    },
    [setRightPanelOpen],
  )

  const closePanel = React.useCallback(() => {
    // Falls back to the day's agenda rather than an empty column.
    setRightPanelContent({ kind: 'agenda' })
  }, [])

  const requestCreate = React.useCallback(
    (seed?: { start?: Date; end?: Date; allDay?: boolean }) => {
      // The nonce makes repeated identical requests distinct, so pressing "C"
      // twice reopens the composer instead of doing nothing.
      setCreateRequest({ ...seed, nonce: Date.now() })
    },
    [],
  )

  const value = React.useMemo<AppShellContextValue>(
    () => ({
      ...data,
      sidebarOpen,
      setSidebarOpen,
      toggleSidebar: () => setSidebarOpen(!sidebarOpen),
      rightPanelOpen,
      setRightPanelOpen,
      toggleRightPanel: () => setRightPanelOpen(!rightPanelOpen),
      rightPanelContent,
      showInPanel,
      closePanel,
      commandOpen,
      setCommandOpen,
      requestCreate,
      createRequest,
      clearCreateRequest: () => setCreateRequest(null),
    }),
    [
      data,
      sidebarOpen,
      setSidebarOpen,
      rightPanelOpen,
      setRightPanelOpen,
      rightPanelContent,
      showInPanel,
      closePanel,
      commandOpen,
      requestCreate,
      createRequest,
    ],
  )

  return <AppShellContext.Provider value={value}>{children}</AppShellContext.Provider>
}

export function useAppShell() {
  const ctx = React.useContext(AppShellContext)
  if (!ctx) throw new Error('useAppShell must be used inside <AppShell>')
  return ctx
}
