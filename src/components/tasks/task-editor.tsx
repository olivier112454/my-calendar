'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { CalendarX2, Plus, Trash2 } from 'lucide-react'
import { api } from '@/lib/client/api'
import { formatEventRange, wallToUtc, utcToWall } from '@/lib/datetime'
import type { TaskPriority, TaskStatus, TaskSummary } from '@/types/domain'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { Sheet, SheetContent } from '@/components/ui/overlay'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/controls'
import { Field } from '@/components/ui/primitives'
import { ListSkeleton } from '@/components/ui/states'
import { TaskRow } from './task-row'

/**
 * Full task editor, presented as a side sheet so the list stays visible behind
 * it. Subtasks are edited inline here rather than in a nested dialog.
 */

export interface TaskEditorProps {
  taskId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  projects: { id: string; name: string; color: string }[]
  timezone: string
  use24h: boolean
  onChanged: () => void
}

const PRIORITIES: { value: TaskPriority; label: string }[] = [
  { value: 'P1', label: 'P1 · Urgent' },
  { value: 'P2', label: 'P2 · High' },
  { value: 'P3', label: 'P3 · Normal' },
  { value: 'P4', label: 'P4 · Low' },
]

const STATUSES: { value: TaskStatus; label: string }[] = [
  { value: 'INBOX', label: 'Inbox' },
  { value: 'TODO', label: 'To do' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'DONE', label: 'Done' },
]

const ESTIMATES = [15, 25, 30, 45, 60, 90, 120, 180, 240]

export function TaskEditor({
  taskId,
  open,
  onOpenChange,
  projects,
  timezone,
  use24h,
  onChanged,
}: TaskEditorProps) {
  const [task, setTask] = React.useState<TaskSummary | null>(null)
  const [subtasks, setSubtasks] = React.useState<TaskSummary[]>([])
  const [loading, setLoading] = React.useState(false)
  const [newSubtask, setNewSubtask] = React.useState('')

  const load = React.useCallback(async () => {
    if (!taskId) return
    setLoading(true)
    try {
      const [detail, children] = await Promise.all([
        api.get<TaskSummary>(`/api/tasks/${taskId}`),
        api.get<TaskSummary[]>(`/api/tasks?parentTaskId=${taskId}&includeCompleted=true`),
      ])
      setTask(detail)
      setSubtasks(children)
    } catch {
      toast.error('Could not open that task.')
      onOpenChange(false)
    } finally {
      setLoading(false)
    }
  }, [taskId, onOpenChange])

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- flags the in-flight load for the selected task
    if (open && taskId) void load()
  }, [open, taskId, load])

  /**
   * Field edits save as they happen rather than behind a Save button: a task is
   * a small thing, and an unsaved-changes prompt for a priority change would be
   * disproportionate.
   */
  const patch = async (changes: Partial<TaskSummary> & Record<string, unknown>) => {
    if (!task) return
    const previous = task
    setTask({ ...task, ...changes } as TaskSummary)
    try {
      const updated = await api.patch<TaskSummary>(`/api/tasks/${task.id}`, changes)
      setTask(updated)
      onChanged()
    } catch (cause) {
      setTask(previous)
      toast.error(cause instanceof Error ? cause.message : 'That change was not saved.')
    }
  }

  const addSubtask = async () => {
    if (!task || !newSubtask.trim()) return
    try {
      const child = await api.post<TaskSummary>('/api/tasks', {
        title: newSubtask.trim(),
        parentTaskId: task.id,
        projectId: task.projectId,
        status: 'TODO',
        priority: task.priority,
      })
      setSubtasks((current) => [...current, child])
      setNewSubtask('')
      onChanged()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Could not add the subtask.')
    }
  }

  const remove = async () => {
    if (!task) return
    try {
      await api.delete(`/api/tasks/${task.id}`)
      toast.success('Task deleted')
      onOpenChange(false)
      onChanged()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Could not delete the task.')
    }
  }

  const unschedule = async () => {
    if (!task) return
    try {
      await api.delete(`/api/tasks/${task.id}/schedule`)
      toast.success('Removed from the calendar')
      void load()
      onChanged()
    } catch {
      toast.error('Could not unschedule the task.')
    }
  }

  const dueValue = task?.dueAt ? utcToWall(new Date(task.dueAt), timezone).slice(0, 10) : ''

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        title={task?.title ?? 'Task'}
        footer={
          task ? (
            <>
              <Button variant="dangerGhost" size="sm" onClick={remove}>
                <Trash2 />
                Delete
              </Button>
              <div className="flex-1" />
              <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </>
          ) : undefined
        }
      >
        {loading || !task ? (
          <ListSkeleton rows={6} />
        ) : (
          <div className="space-y-4">
            <Field label="Title" htmlFor="task-title">
              <Input
                id="task-title"
                value={task.title}
                onChange={(nativeEvent) =>
                  setTask({ ...task, title: nativeEvent.target.value })
                }
                onBlur={(nativeEvent) => {
                  if (nativeEvent.target.value.trim() !== '') {
                    void patch({ title: nativeEvent.target.value.trim() })
                  }
                }}
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Status" htmlFor="task-status">
                <Select
                  value={task.status}
                  onValueChange={(status) => void patch({ status: status as TaskStatus })}
                >
                  <SelectTrigger id="task-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((entry) => (
                      <SelectItem key={entry.value} value={entry.value}>
                        {entry.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field label="Priority" htmlFor="task-priority">
                <Select
                  value={task.priority}
                  onValueChange={(priority) => void patch({ priority: priority as TaskPriority })}
                >
                  <SelectTrigger id="task-priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((entry) => (
                      <SelectItem key={entry.value} value={entry.value}>
                        {entry.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Due date" htmlFor="task-due">
                <Input
                  id="task-due"
                  type="date"
                  value={dueValue}
                  onChange={(nativeEvent) =>
                    void patch({
                      dueAt: nativeEvent.target.value
                        ? wallToUtc(`${nativeEvent.target.value}T17:00`, timezone).toISOString()
                        : null,
                    })
                  }
                />
              </Field>

              <Field
                label="Estimate"
                htmlFor="task-estimate"
                hint="Used when scheduling"
              >
                <Select
                  value={task.estimatedMinutes ? String(task.estimatedMinutes) : 'none'}
                  onValueChange={(value) =>
                    void patch({
                      estimatedMinutes: value === 'none' ? null : Number(value),
                    })
                  }
                >
                  <SelectTrigger id="task-estimate">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No estimate</SelectItem>
                    {ESTIMATES.map((minutes) => (
                      <SelectItem key={minutes} value={String(minutes)}>
                        {minutes < 60
                          ? `${minutes} min`
                          : `${minutes / 60} hour${minutes === 60 ? '' : 's'}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <Field label="Project" htmlFor="task-project">
              <Select
                value={task.projectId ?? 'none'}
                onValueChange={(value) =>
                  void patch({ projectId: value === 'none' ? null : value })
                }
              >
                <SelectTrigger id="task-project">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No project</SelectItem>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      <span className="flex items-center gap-2">
                        <span
                          aria-hidden="true"
                          className="size-2 rounded-full"
                          style={{ backgroundColor: project.color }}
                        />
                        {project.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            {task.timeBlockStart && task.timeBlockEnd ? (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
                    Scheduled
                  </p>
                  <p className="truncate text-[13px] text-fg">
                    {formatEventRange(
                      new Date(task.timeBlockStart),
                      new Date(task.timeBlockEnd),
                      timezone,
                      use24h,
                    )}
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={unschedule}>
                  <CalendarX2 />
                  Remove
                </Button>
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-fg-muted">
                Drag this task onto the calendar to give it a time block, or use
                Schedule to have one suggested.
              </p>
            )}

            <Field label="Notes" htmlFor="task-notes">
              <Textarea
                id="task-notes"
                value={task.notes ?? ''}
                onChange={(nativeEvent) =>
                  setTask({ ...task, notes: nativeEvent.target.value })
                }
                onBlur={(nativeEvent) => void patch({ notes: nativeEvent.target.value })}
                rows={4}
                placeholder="Anything worth remembering"
              />
            </Field>

            <div className="space-y-1.5">
              <p className="text-xs font-medium text-fg-muted">
                Subtasks
                {subtasks.length > 0 ? (
                  <span className="ml-1 text-fg-subtle">
                    {subtasks.filter((child) => child.status === 'DONE').length}/
                    {subtasks.length}
                  </span>
                ) : null}
              </p>

              <ul className="-mx-2 space-y-px">
                {subtasks.map((child) => (
                  <li key={child.id}>
                    <TaskRow
                      task={child}
                      timezone={timezone}
                      draggable={false}
                      showProject={false}
                      onToggle={async (done) => {
                        setSubtasks((current) =>
                          current.map((entry) =>
                            entry.id === child.id
                              ? { ...entry, status: done ? 'DONE' : 'TODO' }
                              : entry,
                          ),
                        )
                        await api
                          .patch(`/api/tasks/${child.id}`, {
                            status: done ? 'DONE' : 'TODO',
                          })
                          .catch(() => {
                            void load()
                            toast.error('Could not update the subtask.')
                          })
                        onChanged()
                      }}
                      onOpen={() => {
                        /* Subtasks are edited in place; opening one would nest
                           sheets without adding anything. */
                      }}
                    />
                  </li>
                ))}
              </ul>

              <div className="flex items-center gap-1.5">
                <Input
                  value={newSubtask}
                  onChange={(nativeEvent) => setNewSubtask(nativeEvent.target.value)}
                  onKeyDown={(nativeEvent) => {
                    if (nativeEvent.key === 'Enter') {
                      nativeEvent.preventDefault()
                      void addSubtask()
                    }
                  }}
                  placeholder="Add a subtask"
                  aria-label="New subtask"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={addSubtask}
                  disabled={!newSubtask.trim()}
                  aria-label="Add subtask"
                >
                  <Plus />
                </Button>
              </div>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
