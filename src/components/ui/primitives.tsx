'use client'

import * as React from 'react'
import * as LabelPrimitive from '@radix-ui/react-label'
import * as SeparatorPrimitive from '@radix-ui/react-separator'
import * as AvatarPrimitive from '@radix-ui/react-avatar'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn, initials } from '@/lib/utils'

/* ------------------------------------------------------------------ Label */

export const Label = React.forwardRef<
  React.ComponentRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(
      'text-xs font-medium text-fg-muted select-none',
      'peer-disabled:cursor-not-allowed peer-disabled:opacity-60',
      className,
    )}
    {...props}
  />
))
Label.displayName = 'Label'

/** Label + control + optional helper/error text, wired up for screen readers. */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  className,
  children,
}: {
  label?: React.ReactNode
  htmlFor?: string
  hint?: React.ReactNode
  error?: React.ReactNode
  required?: boolean
  className?: string
  children: React.ReactNode
}) {
  const hintId = hint && htmlFor ? `${htmlFor}-hint` : undefined
  const errorId = error && htmlFor ? `${htmlFor}-error` : undefined
  return (
    <div className={cn('space-y-1.5', className)}>
      {label ? (
        <Label htmlFor={htmlFor}>
          {label}
          {required ? (
            <span className="text-danger ml-0.5" aria-hidden="true">
              *
            </span>
          ) : null}
        </Label>
      ) : null}
      {children}
      {hint && !error ? (
        <p id={hintId} className="text-xs text-fg-subtle">
          {hint}
        </p>
      ) : null}
      {/* Errors sit next to the field they belong to, never only at the top. */}
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/* -------------------------------------------------------------- Separator */

export const Separator = React.forwardRef<
  React.ComponentRef<typeof SeparatorPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>
>(({ className, orientation = 'horizontal', decorative = true, ...props }, ref) => (
  <SeparatorPrimitive.Root
    ref={ref}
    decorative={decorative}
    orientation={orientation}
    className={cn(
      'shrink-0 bg-border',
      orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
      className,
    )}
    {...props}
  />
))
Separator.displayName = 'Separator'

/* ------------------------------------------------------------------ Badge */

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium ' +
    // A badge never breaks its own label onto a second line inside a chip row.
    'whitespace-nowrap leading-4 [&_svg]:size-3',
  {
    variants: {
      tone: {
        neutral: 'border-border bg-surface-2 text-fg-muted',
        accent: 'border-transparent bg-accent-soft text-accent',
        success:
          'border-transparent bg-[color-mix(in_oklab,var(--success)_14%,transparent)] text-success',
        warning: 'border-transparent bg-warning-soft text-warning',
        danger: 'border-transparent bg-danger-soft text-danger',
        outline: 'border-border text-fg-muted',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
)

export function Badge({
  className,
  tone,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />
}

/* ----------------------------------------------------------------- Avatar */

export function Avatar({
  name,
  src,
  size = 'md',
  className,
}: {
  name?: string | null
  src?: string | null
  size?: 'xs' | 'sm' | 'md' | 'lg'
  className?: string
}) {
  const sizes = {
    xs: 'size-5 text-[9px]',
    sm: 'size-6 text-[10px]',
    md: 'size-8 text-xs',
    lg: 'size-12 text-sm',
  }
  return (
    <AvatarPrimitive.Root
      className={cn(
        'relative flex shrink-0 overflow-hidden rounded-full bg-surface-2',
        sizes[size],
        className,
      )}
    >
      {src ? (
        <AvatarPrimitive.Image
          src={src}
          alt=""
          className="aspect-square size-full object-cover"
        />
      ) : null}
      <AvatarPrimitive.Fallback
        delayMs={src ? 300 : 0}
        className="flex size-full items-center justify-center font-medium text-fg-muted"
      >
        {initials(name)}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  )
}

/* --------------------------------------------------------------- Skeleton */

/**
 * Placeholder block. Always given explicit dimensions by the caller so the real
 * content lands in the same box — a skeleton that changes size on load is just
 * a slower layout shift.
 */
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-surface-2', className)}
      {...props}
    />
  )
}

/* --------------------------------------------------------------- Kbd hint */

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-4.5 min-w-4.5 items-center justify-center rounded border border-border',
        'bg-surface-2 px-1 font-sans text-[10px] font-medium text-fg-subtle',
      )}
    >
      {children}
    </kbd>
  )
}

/* ------------------------------------------------------------ Colour dot */

export function ColorDot({
  color,
  size = 10,
  className,
}: {
  color: string
  size?: number
  className?: string
}) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-block shrink-0 rounded-full', className)}
      style={{ width: size, height: size, backgroundColor: color }}
    />
  )
}
