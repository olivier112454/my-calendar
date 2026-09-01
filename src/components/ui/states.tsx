'use client'

import * as React from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from './button'
import { Skeleton } from './primitives'

/**
 * Empty, error and loading presentations. Every list and page in the app uses
 * these three rather than inventing its own, so "nothing here yet" always looks
 * like the same deliberate state instead of a broken screen.
 */

export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  className,
  compact,
}: {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
  secondaryAction?: React.ReactNode
  className?: string
  compact?: boolean
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'gap-2 px-4 py-8' : 'gap-3 px-6 py-16',
        className,
      )}
    >
      {icon ? (
        <div
          aria-hidden="true"
          className={cn(
            'flex items-center justify-center rounded-lg border border-border bg-surface-2 text-fg-subtle',
            compact ? 'size-8 [&_svg]:size-4' : 'size-11 [&_svg]:size-5',
          )}
        >
          {icon}
        </div>
      ) : null}
      <div className="space-y-1">
        <p className={cn('font-medium text-fg', compact ? 'text-[13px]' : 'text-sm')}>
          {title}
        </p>
        {description ? (
          <p className="mx-auto max-w-xs text-xs leading-relaxed text-fg-muted text-balance">
            {description}
          </p>
        ) : null}
      </div>
      {action || secondaryAction ? (
        <div className="mt-1 flex items-center gap-2">
          {action}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  )
}

/**
 * Failure presentation. Takes a human message; the raw error is logged, never
 * shown — a stack trace tells the user nothing they can act on.
 */
export function ErrorState({
  title = 'Something went wrong',
  description,
  onRetry,
  retryLabel = 'Try again',
  action,
  className,
  compact,
}: {
  title?: string
  description?: string
  onRetry?: () => void
  retryLabel?: string
  action?: React.ReactNode
  className?: string
  compact?: boolean
}) {
  return (
    <EmptyState
      className={className}
      compact={compact}
      icon={<AlertTriangle />}
      title={title}
      description={description}
      action={
        onRetry ? (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            <RefreshCw />
            {retryLabel}
          </Button>
        ) : undefined
      }
      secondaryAction={action}
    />
  )
}

/** Inline banner for a recoverable failure inside an otherwise working screen. */
export function ErrorBanner({
  title,
  description,
  actions,
  className,
}: {
  title: string
  description?: string
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-2.5 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5',
        className,
      )}
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-[13px] font-medium text-fg">{title}</p>
        {description ? (
          <p className="text-xs leading-relaxed text-fg-muted">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </div>
  )
}

/** Row-shaped skeletons for list loading. Matches the real row height exactly. */
export function ListSkeleton({
  rows = 5,
  className,
}: {
  rows?: number
  className?: string
}) {
  return (
    <div className={cn('space-y-1', className)} aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-md px-2 py-2.5">
          <Skeleton className="size-4 rounded" />
          <Skeleton className="h-3.5 flex-1" style={{ maxWidth: `${55 + ((i * 13) % 35)}%` }} />
          <Skeleton className="h-3 w-12" />
        </div>
      ))}
    </div>
  )
}
