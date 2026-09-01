'use client'

import * as React from 'react'
import {
  CalendarClock,
  ChevronRight,
  Clock,
  GripVertical,
  ListTree,
  Repeat,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatDuration, formatDayLabel, dayKeyOf, todayKey } from '@/lib/datetime'
import type { TaskPriority, TaskSummary } from '@/types/domain'
import { Checkbox } from '@/components/ui/controls'
import { Badge } from '@/components/ui/primitives'

/**
 * One task row.
 *
 * Priority is shown as a coloured bar plus a "P1" label rather than colour
 * alone — the distinction has to survive a colour-blind reader and a greyscale
 * screenshot.
 *
 * The row is draggable onto the calendar. The payload is a custom MIME type so
 * dropping a task somewhere that does not understand it simply does nothing.
 */

export const TASK_DRAG_TYPE = 'application/x-dayflow-task'

const PRIORITY_STYLES: Record<
  TaskPriority,
  { bar: string; label: string; title: string }
> = {
  P1: { bar: 'bg-danger', label: 'text-danger', title: 'Urgent' },
  P2: { bar: 'bg-warning', label: 'text-warning', title: 'High' },
  P3: { bar: 'bg-accent', label: 'text-accent', title: 'Normal' },
  P4: { bar: 'bg-fg-subtle', label: 'text-fg-subtle', title: 'Low' },
}

export interface TaskDragPayload {
  taskId: string
  title: string
  estimatedMinutes: number | null
}

export function TaskRow({
  task,
  timezone,
  selected,
  draggable = true,
  showProject = true,
  onToggle,
  onOpen,
  onContextMenu,
}: {
  task: TaskSummary
  timezone: string
  selected?: boolean
  draggable?: boolean
  showProject?: boolean
  onToggle: (done: boolean) => void
  onOpen: () => void
  onContextMenu?: (nativeEvent: React.MouseEvent) => void
}) {
  const done = task.status === 'DONE'
  const priority = PRIORITY_STYLES[task.priority]

  const dueKey = task.dueAt ? dayKeyOf(new Date(task.dueAt), timezone) : null
  const today = todayKey(timezone)
  const overdue = dueKey !== null && dueKey < today && !done
  const dueToday = dueKey === today

  return (
    <div
      draggable={draggable && !done}
      onDragStart={(nativeEvent) => {
        const payload: TaskDragPayload = {
          taskId: task.id,
          title: task.title,
          estimatedMinutes: task.estimatedMinutes,
        }
        nativeEvent.dataTransfer.setData(TASK_DRAG_TYPE, JSON.stringify(payload))
        nativeEvent.dataTransfer.effectAllowed = 'copyMove'
      }}
      onContextMenu={onContextMenu}
      className={cn(
        'group relative flex items-start gap-2.5 rounded-md px-2 py-2 transition-colors',
        'hover:bg-surface-2',
        selected && 'bg-surface-2 ring-1 ring-inset ring-accent',
        done && 'opacity-55',
      )}
    >
      {draggable && !done ? (
        <span
          aria-hidden="true"
          className="absolute -left-3 top-2.5 cursor-grab text-fg-subtle opacity-0 transition-opacity group-hover:opacity-100"
          title="Drag onto the calendar to schedule"
        >
          <GripVertical className="size-3.5" />
        </span>
      ) : null}

      <span
        aria-hidden="true"
        title={priority.title}
        className={cn('mt-1.5 h-3 w-[3px] shrink-0 rounded-full', priority.bar)}
      />

      <Checkbox
        checked={done}
        onCheckedChange={(checked) => onToggle(checked === true)}
        aria-label={done ? `Mark "${task.title}" as not done` : `Complete "${task.title}"`}
        className="mt-0.5"
      />

      <button
        type="button"
        onClick={onOpen}
        className="min-w-0 flex-1 space-y-0.5 text-left"
      >
        <span
          className={cn(
            'block break-user-text text-[13px] text-fg',
            done && 'line-through',
          )}
        >
          {task.title}
        </span>

        <span className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-fg-muted">
          <span className={cn('font-medium', priority.label)}>{task.priority}</span>

          {task.dueAt ? (
            <span
              className={cn(
                'inline-flex items-center gap-1',
                overdue && 'font-medium text-danger',
                dueToday && !overdue && 'font-medium text-accent',
              )}
            >
              <CalendarClock className="size-3" aria-hidden="true" />
              {overdue
                ? `Overdue · ${formatDayLabel(dueKey!, 'd MMM')}`
                : dueToday
                  ? 'Today'
                  : formatDayLabel(dueKey!, 'EEE d MMM')}
            </span>
          ) : null}

          {task.estimatedMinutes ? (
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3" aria-hidden="true" />
              {formatDuration(task.estimatedMinutes)}
            </span>
          ) : null}

          {task.subtaskCount > 0 ? (
            <span className="inline-flex items-center gap-1">
              <ListTree className="size-3" aria-hidden="true" />
              {task.completedSubtaskCount}/{task.subtaskCount}
            </span>
          ) : null}

          {task.recurrenceRule ? (
            <Repeat className="size-3" aria-hidden="true" />
          ) : null}

          {showProject && task.projectName ? (
            <span className="inline-flex items-center gap-1">
              <span
                aria-hidden="true"
                className="size-1.5 rounded-full"
                style={{ backgroundColor: task.projectColor ?? '#64748b' }}
              />
              {task.projectName}
            </span>
          ) : null}

          {task.timeBlockStart ? (
            <Badge tone="accent">
              Scheduled{' '}
              {formatDayLabel(dayKeyOf(new Date(task.timeBlockStart), timezone), 'EEE')}
            </Badge>
          ) : null}

          {task.tags.map((tag) => (
            <span
              key={tag.id}
              className="inline-flex items-center gap-1 whitespace-nowrap rounded px-1 text-[10px]"
              style={{
                backgroundColor: `color-mix(in oklab, ${tag.color} 14%, transparent)`,
                color: tag.color,
              }}
            >
              {tag.name}
            </span>
          ))}
        </span>
      </button>

      <ChevronRight
        aria-hidden="true"
        className="mt-1 size-3.5 shrink-0 text-fg-subtle opacity-0 transition-opacity group-hover:opacity-100"
      />
    </div>
  )
}
