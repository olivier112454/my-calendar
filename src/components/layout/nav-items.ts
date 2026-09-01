import {
  BarChart3,
  CalendarDays,
  CheckSquare,
  Contact,
  Inbox,
  LayoutGrid,
  Sun,
  Users,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/**
 * The navigation model, defined once and consumed by the sidebar, the mobile
 * bar and the command palette — so a new destination cannot appear in one place
 * and go missing in another.
 */

export interface NavItem {
  href: string
  label: string
  icon: LucideIcon
  /** Single-key shortcut, shown in the palette and handled globally. */
  shortcut?: string
  /** Shown in the mobile bottom bar (which holds at most five). */
  mobile?: boolean
  description: string
}

export const navItems: NavItem[] = [
  {
    href: '/today',
    label: 'Today',
    icon: Sun,
    shortcut: 'G T',
    mobile: true,
    description: 'Your day at a glance',
  },
  {
    href: '/calendar',
    label: 'Calendar',
    icon: CalendarDays,
    shortcut: 'G C',
    mobile: true,
    description: 'Day, week, month and year views',
  },
  {
    href: '/tasks',
    label: 'Tasks',
    icon: CheckSquare,
    shortcut: 'G K',
    mobile: true,
    description: 'Everything you need to do',
  },
  {
    href: '/inbox',
    label: 'Inbox',
    icon: Inbox,
    shortcut: 'G I',
    description: 'Mail and invitations that need a decision',
  },
  {
    href: '/schedule',
    label: 'Schedule',
    icon: LayoutGrid,
    shortcut: 'G S',
    description: 'Fit your tasks into the week',
  },
  {
    href: '/contacts',
    label: 'Contacts',
    icon: Contact,
    shortcut: 'G P',
    description: 'People you meet with',
  },
  {
    href: '/meetings',
    label: 'Meetings',
    icon: Users,
    shortcut: 'G M',
    description: 'Booking links others can use',
  },
  {
    href: '/analytics',
    label: 'Analytics',
    icon: BarChart3,
    shortcut: 'G A',
    description: 'Where your time actually goes',
  },
]

export const mobileNavItems = navItems.filter((item) => item.mobile)

export const settingsSections = [
  { href: '/settings/general', label: 'General' },
  { href: '/settings/appearance', label: 'Appearance' },
  { href: '/settings/calendars', label: 'Calendars' },
  { href: '/settings/notifications', label: 'Notifications' },
  { href: '/settings/integrations', label: 'Integrations' },
  { href: '/settings/shortcuts', label: 'Keyboard shortcuts' },
  { href: '/settings/privacy', label: 'Privacy & data' },
  { href: '/settings/account', label: 'Account' },
] as const
