'use client'

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { CheckSquare, Filter, Plus, Wand2 } from 'lucide-react'
import { api, qs } from '@/lib/client/api'
import {
  addDaysToKey,
  dayKeyOf,
  todayKey,
  wallToUtc,
} from '@/lib/datetime'
import type { TaskPriority, TaskSummary } from '@/types/domain'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SegmentedControl } from '@/components/ui/controls'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/menu'
import { EmptyState, ErrorBanner, ListSkeleton } from '@/components/ui/states'
import { TaskRow } from './task-row'
import { TaskEditor } from './task-editor'
import { parseTaskLine } from '@/lib/nlp/parse-task'
import { NotificationBell } from '@/components/layout/notification-bell'

/**
 * The Tasks page.
 *
 * Grouping is by due date by default, because "what needs doing next" is the
 * question a task list is usually opened to answer. Status and project
 * groupings are one click away for the times it is not.
 */

type GroupMode = 'due' | 'status' | 'project'

export interface TasksViewProps {
  initialTasks: TaskSummary[]
  projects: { id: string; name: string; color: string; openCount: number }[]
  timezone: string
  use24h: boolean
}

export function TasksView({
  initialTasks,
  projects,
  timezone,
  use24h,
}: TasksViewProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [tasks, setTasks] = React.useState(initialTasks)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [group, setGroup] = React.useState<GroupMode>('due')
  const [showCompleted, setShowCompleted] = React.useState(false)
  const [projectFilter, setProjectFilter] = React.useState<string | null>(null)
  const [draft, setDraft] = React.useState('')
  const [openTaskId, setOpenTaskId] = React.useState<string | null>(
    searchParams.get('task'),
  )
  const quickAddRef = React.useRef<HTMLInputElement>(null)

  // ?new=1 arrives from the command palette; focus the quick-add rather than
  // opening a dialog for something this small.
  React.useEffect(() => {
    if (searchParams.get('new') === '1') quickAddRef.current?.focus()
  }, [searchParams])

  const reload = React.useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get<TaskSummary[]>(
        `/api/tasks${qs({
          includeCompleted: showCompleted ? 'true' : 'false',
          projectId: projectFilter ?? undefined,
        })}`,
      )
      setTasks(data)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load your tasks.')
    } finally {
      setLoading(false)
    }
  }, [showCompleted, projectFilter])

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- flags the in-flight reload after a filter change
    void reload()
  }, [reload])

  const toggle = async (task: TaskSummary, done: boolean) => {
    const snapshot = tasks
    setTasks((current) =>
      current.map((entry) =>
        entry.id === task.id
          ? {
              ...entry,
              status: done ? 'DONE' : 'TODO',
              completedAt: done ? new Date().toISOString() : null,
            }
          : entry,
      ),
    )
    try {
      await api.patch(`/api/tasks/${task.id}`, { status: done ? 'DONE' : 'TODO' })
      if (done && !showCompleted) {
        // Let the strike-through register before the row leaves the list.
        setTimeout(() => setTasks((current) => current.filter((e) => e.id !== task.id)), 450)
      }
      if (task.recurrenceRule && done) void reload()
    } catch (cause) {
      setTasks(snapshot)
      toast.error(cause instanceof Error ? cause.message : 'Could not update the task.')
    }
  }

  /*
   * What the line will become, worked out while it is being typed.
   *
   * The result used to appear in a toast after the task was already created,
   * which is the one moment the reading is no longer useful: by then a misread
   * date is a task on the wrong day rather than something to correct. Showing
   * it under the field costs nothing — the parser is a handful of regular
   * expressions — and makes the interpretation refutable before it is
   * committed.
   */
  const preview = React.useMemo(() => {
    const text = draft.trim()
    if (text.length < 3) return null
    const parsed = parseTaskLine(text, timezone)
    return parsed.matched.length > 0 ? parsed : null
  }, [draft, timezone])

  const quickAdd = async () => {
    const text = draft.trim()
    if (!text) return

    const parsed = parseTaskLine(text, timezone)
    setDraft('')

    try {
      const created = await api.post<TaskSummary>('/api/tasks', {
        title: parsed.title,
        priority: parsed.priority ?? 'P3',
        dueAt: parsed.dueAt,
        estimatedMinutes: parsed.estimatedMinutes,
        projectId:
          projectFilter ??
          (parsed.projectName
            ? (projects.find(
                (project) =>
                  project.name.toLowerCase() === parsed.projectName!.toLowerCase(),
              )?.id ?? null)
            : null),
        status: 'TODO',
      })
      setTasks((current) => [created, ...current])
      toast.success('Task added', {
        description: parsed.matched.length
          ? `Read as: ${parsed.matched.join(' · ')}`
          : undefined,
      })
    } catch (cause) {
      setDraft(text)
      toast.error(cause instanceof Error ? cause.message : 'Could not add the task.')
    }
  }

  const groups = React.useMemo(
    () => groupTasks(tasks, group, timezone, projects),
    [tasks, group, timezone, projects],
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface px-4 py-2">
        <h1 className="text-[15px] font-semibold tracking-[-0.01em] text-fg">Tasks</h1>
        <span className="text-[13px] text-fg-subtle">
          {tasks.filter((task) => task.status !== 'DONE').length} open
        </span>

        <div className="ml-auto flex items-center gap-1.5">
          <NotificationBell />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Filter tasks">
                <Filter />
                {projectFilter || showCompleted ? (
                  <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-accent" />
                ) : null}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel>Projects</DropdownMenuLabel>
              <DropdownMenuCheckboxItem
                checked={projectFilter === null}
                onCheckedChange={() => setProjectFilter(null)}
              >
                All projects
              </DropdownMenuCheckboxItem>
              {projects.map((project) => (
                <DropdownMenuCheckboxItem
                  key={project.id}
                  checked={projectFilter === project.id}
                  onCheckedChange={() =>
                    setProjectFilter(projectFilter === project.id ? null : project.id)
                  }
                >
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="size-2 rounded-full"
                      style={{ backgroundColor: project.color }}
                    />
                    {project.name}
                    <span className="ml-auto text-[11px] text-fg-subtle">
                      {project.openCount}
                    </span>
                  </span>
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={showCompleted}
                onCheckedChange={(checked) => setShowCompleted(checked === true)}
              >
                Show completed
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <SegmentedControl
            label="Group tasks by"
            value={group}
            onValueChange={setGroup}
            options={[
              { value: 'due', label: 'Due' },
              { value: 'status', label: 'Status' },
              { value: 'project', label: 'Project' },
            ]}
          />
        </div>
      </header>

      <div className="shrink-0 border-b border-border bg-surface px-4 py-2">
        <div className="mx-auto flex max-w-3xl flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <Input
            ref={quickAddRef}
            value={draft}
            onChange={(nativeEvent) => setDraft(nativeEvent.target.value)}
            onKeyDown={(nativeEvent) => {
              if (nativeEvent.key === 'Enter') {
                nativeEvent.preventDefault()
                void quickAdd()
              }
            }}
            placeholder="Add a task — try “Send the report tomorrow p1 45m”"
            className="h-9"
            aria-label="Add a task"
          />
          <Button variant="primary" onClick={quickAdd} disabled={!draft.trim()}>
            <Plus />
            Add
          </Button>
        </div>

        {preview ? (
          // Announced politely: someone who cannot see the strip should still
          // learn how their line was read, but not have every keystroke
          // interrupt them.
          <p
            aria-live="polite"
            className="flex flex-wrap items-center gap-1.5 px-0.5 text-xs text-fg-muted"
          >
            <Wand2 className="size-3.5 shrink-0 text-fg-subtle" aria-hidden="true" />
            <span className="font-medium text-fg">{preview.title}</span>
            {preview.matched.map((token) => (
              <span
                key={token}
                className="rounded border border-border bg-surface-2 px-1.5 py-px text-[11px] text-fg-muted"
              >
                {token}
              </span>
            ))}
          </p>
        ) : null}
        </div>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-4 py-3">
          {error ? (
            <ErrorBanner
              className="mb-3"
              title="Could not load your tasks"
              description={error}
              actions={
                <Button variant="secondary" size="sm" onClick={reload}>
                  Try again
                </Button>
              }
            />
          ) : null}

          {loading && tasks.length === 0 ? (
            <ListSkeleton rows={6} />
          ) : tasks.length === 0 ? (
            <EmptyState
              icon={<CheckSquare />}
              title="Your day is clear"
              description="Nothing on the list. Add something above when it comes up."
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => quickAddRef.current?.focus()}
                >
                  Add a task
                </Button>
              }
            />
          ) : (
            <div className="space-y-5">
              {groups.map((section) => (
                <section key={section.key}>
                  <h2 className="flex items-center gap-2 px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
                    {section.color ? (
                      <span
                        aria-hidden="true"
                        className="size-2 rounded-full"
                        style={{ backgroundColor: section.color }}
                      />
                    ) : null}
                    {section.label}
                    <span className="font-normal text-fg-subtle/70">
                      {section.tasks.length}
                    </span>
                  </h2>
                  <ul className="space-y-px">
                    {section.tasks.map((task) => (
                      <li key={task.id}>
                        <TaskRow
                          task={task}
                          timezone={timezone}
                          selected={task.id === openTaskId}
                          showProject={group !== 'project'}
                          onToggle={(done) => void toggle(task, done)}
                          onOpen={() => setOpenTaskId(task.id)}
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>

      <TaskEditor
        taskId={openTaskId}
        open={openTaskId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setOpenTaskId(null)
            router.replace('/tasks', { scroll: false })
          }
        }}
        projects={projects}
        timezone={timezone}
        use24h={use24h}
        onChanged={reload}
      />
    </div>
  )
}

/* ---------------------------------------------------------------- grouping */

interface TaskGroup {
  key: string
  label: string
  color?: string
  tasks: TaskSummary[]
}

function groupTasks(
  tasks: TaskSummary[],
  mode: GroupMode,
  timezone: string,
  projects: { id: string; name: string; color: string }[],
): TaskGroup[] {
  if (mode === 'status') {
    const order: { key: TaskSummary['status']; label: string }[] = [
      { key: 'IN_PROGRESS', label: 'In progress' },
      { key: 'TODO', label: 'To do' },
      { key: 'INBOX', label: 'Inbox' },
      { key: 'DONE', label: 'Done' },
    ]
    return order
      .map(({ key, label }) => ({
        key,
        label,
        tasks: tasks.filter((task) => task.status === key),
      }))
      .filter((section) => section.tasks.length > 0)
  }

  if (mode === 'project') {
    const sections: TaskGroup[] = projects.map((project) => ({
      key: project.id,
      label: project.name,
      color: project.color,
      tasks: tasks.filter((task) => task.projectId === project.id),
    }))
    const orphans = tasks.filter((task) => !task.projectId)
    if (orphans.length > 0) {
      sections.push({ key: 'none', label: 'No project', tasks: orphans })
    }
    return sections.filter((section) => section.tasks.length > 0)
  }

  // Due-date buckets.
  const today = todayKey(timezone)
  const weekEnd = addDaysToKey(today, 7)

  const buckets: TaskGroup[] = [
    { key: 'overdue', label: 'Overdue', tasks: [] },
    { key: 'today', label: 'Today', tasks: [] },
    { key: 'week', label: 'Next 7 days', tasks: [] },
    { key: 'later', label: 'Later', tasks: [] },
    { key: 'none', label: 'No date', tasks: [] },
    { key: 'done', label: 'Completed', tasks: [] },
  ]
  const byKey = new Map(buckets.map((bucket) => [bucket.key, bucket]))

  for (const task of tasks) {
    if (task.status === 'DONE') {
      byKey.get('done')!.tasks.push(task)
      continue
    }
    if (!task.dueAt) {
      byKey.get('none')!.tasks.push(task)
      continue
    }
    const key = dayKeyOf(new Date(task.dueAt), timezone)
    if (key < today) byKey.get('overdue')!.tasks.push(task)
    else if (key === today) byKey.get('today')!.tasks.push(task)
    else if (key < weekEnd) byKey.get('week')!.tasks.push(task)
    else byKey.get('later')!.tasks.push(task)
  }

  return buckets.filter((bucket) => bucket.tasks.length > 0)
}

export { wallToUtc }
export type { TaskPriority }
