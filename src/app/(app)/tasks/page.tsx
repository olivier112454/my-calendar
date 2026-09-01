import type { Metadata } from 'next'
import { ensureSettings, requireUserPage } from '@/lib/auth'
import { listProjects, listTasks } from '@/server/services/tasks'
import { TasksView } from '@/components/tasks/tasks-view'

export const metadata: Metadata = { title: 'Tasks' }

export default async function TasksPage() {
  const user = await requireUserPage('/tasks')
  const [settings, tasks, projects] = await Promise.all([
    ensureSettings(user.id),
    listTasks(user.id, { timezone: user.timezone }),
    listProjects(user.id),
  ])

  return (
    <TasksView
      initialTasks={tasks}
      projects={projects}
      timezone={user.timezone}
      use24h={settings.timeFormat24h}
    />
  )
}
