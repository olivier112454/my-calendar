import { prisma } from '@/lib/db'
import { ensureSettings, requireUserPage } from '@/lib/auth'
import { listCalendars } from '@/server/services/calendars'
import { listCategories } from '@/server/services/categories'
import { listOccurrences } from '@/server/services/events'
import { listTasks } from '@/server/services/tasks'
import { endOfDayUtc, startOfDayUtc, todayKey } from '@/lib/datetime'
import { AppShell } from '@/components/layout/app-shell'
import { AppChrome } from '@/components/layout/app-chrome'
import { AppearanceProvider } from '@/components/theme-provider'

/**
 * Shared frame for every signed-in page.
 *
 * Loads the handful of things the shell itself needs — user, calendars,
 * settings, unread count — once per navigation. Page-specific data is fetched
 * by the pages themselves, so a slow Analytics query never delays the sidebar.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await requireUserPage()
  const settings = await ensureSettings(user.id)

  const today = todayKey(user.timezone)

  const [
    calendars,
    categories,
    notifications,
    unreadCount,
    integrationCount,
    todayEvents,
    tasks,
  ] = await Promise.all([
    listCalendars(user.id),
    listCategories(user.id),
    prisma.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    prisma.notification.count({ where: { userId: user.id, readAt: null } }),
    prisma.integrationAccount.count({ where: { userId: user.id } }),
    listOccurrences(user.id, {
      from: startOfDayUtc(today, user.timezone),
      to: endOfDayUtc(today, user.timezone),
      onlyVisibleCalendars: true,
      userEmail: user.email,
    }),
    listTasks(user.id, { timezone: user.timezone }),
  ])

  return (
    <AppearanceProvider
      initial={{
        theme: settings.theme,
        accentColor: settings.accentColor,
        reduceMotion: settings.reduceMotion,
        compactMode: settings.compactMode,
      }}
    >
      <AppShell
        data={{
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            avatarUrl: user.avatarUrl,
            username: user.username,
            timezone: user.timezone,
          },
          calendars,
          categories,
          notifications: notifications.map((notification) => ({
            id: notification.id,
            type: notification.type,
            title: notification.title,
            body: notification.body,
            link: notification.link,
            readAt: notification.readAt?.toISOString() ?? null,
            createdAt: notification.createdAt.toISOString(),
            entityType: notification.entityType,
            entityId: notification.entityId,
          })),
          unreadCount,
          todayEvents,
          looseTasks: tasks.filter(
            (task) => task.timeBlockId === null && task.status !== 'DONE',
          ),
          weekStartsOn: settings.weekStartsOn,
          timezone: user.timezone,
          use24h: settings.timeFormat24h,
          showWeekNumbers: settings.showWeekNumbers,
          hasIntegrations: integrationCount > 0,
        }}
      >
        {children}
        <AppChrome
          defaultCalendarId={settings.defaultCalendarId}
          defaultReminders={settings.defaultReminders}
        />
      </AppShell>
    </AppearanceProvider>
  )
}
