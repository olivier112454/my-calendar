'use client'

import * as React from 'react'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import * as SelectPrimitive from '@radix-ui/react-select'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { Check, ChevronDown, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'

/* ================================================================= Switch */

export const Switch = React.forwardRef<
  React.ComponentRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      'peer inline-flex h-[18px] w-8 shrink-0 items-center rounded-full border border-transparent',
      'transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50',
      'data-[state=checked]:bg-accent data-[state=unchecked]:bg-surface-3',
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb
      className={cn(
        'pointer-events-none block size-3.5 rounded-full bg-white shadow-sm ring-0',
        'transition-transform duration-150',
        'data-[state=checked]:translate-x-[15px] data-[state=unchecked]:translate-x-0.5',
      )}
    />
  </SwitchPrimitive.Root>
))
Switch.displayName = 'Switch'

/** Switch with its own label and description — the shape Settings uses. */
export function SwitchRow({
  id,
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
}: {
  id: string
  label: string
  description?: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
}) {
  return (
    <div className="flex items-start justify-between gap-6 py-2.5">
      <div className="min-w-0 space-y-0.5">
        <label
          htmlFor={id}
          className={cn(
            'block text-[13px] font-medium text-fg',
            disabled ? 'opacity-60' : 'cursor-pointer',
          )}
        >
          {label}
        </label>
        {description ? (
          <p className="text-xs leading-relaxed text-fg-muted">{description}</p>
        ) : null}
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className="mt-0.5"
      />
    </div>
  )
}

/* =============================================================== Checkbox */

export const Checkbox = React.forwardRef<
  React.ComponentRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> & {
    /** Renders the dash state used for "some children selected". */
    indeterminate?: boolean
  }
>(({ className, indeterminate, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    checked={indeterminate ? 'indeterminate' : props.checked}
    className={cn(
      'peer size-4 shrink-0 rounded-[4px] border border-border-strong bg-surface',
      'transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50',
      'data-[state=checked]:border-accent data-[state=checked]:bg-accent',
      'data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent',
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="flex items-center justify-center text-accent-fg">
      {indeterminate ? <Minus className="size-3" /> : <Check className="size-3" />}
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
))
Checkbox.displayName = 'Checkbox'

/* ================================================================= Select */

export const Select = SelectPrimitive.Root
export const SelectValue = SelectPrimitive.Value
export const SelectGroup = SelectPrimitive.Group

export const SelectTrigger = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      'flex h-8 w-full items-center justify-between gap-2 rounded-md border border-border',
      'bg-surface px-2.5 text-sm text-fg transition-colors duration-150',
      'hover:border-border-strong',
      'focus:outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent-soft',
      'disabled:cursor-not-allowed disabled:opacity-60',
      'data-[placeholder]:text-fg-subtle',
      '[&>span]:truncate',
      className,
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="size-3.5 shrink-0 text-fg-subtle" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
))
SelectTrigger.displayName = 'SelectTrigger'

export const SelectContent = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = 'popper', ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      position={position}
      sideOffset={4}
      className={cn(
        'relative z-50 max-h-72 min-w-[8rem] overflow-hidden rounded-lg border border-border',
        'bg-surface shadow-lg data-[state=open]:animate-scale-in',
        position === 'popper' && 'w-[var(--radix-select-trigger-width)]',
        className,
      )}
      {...props}
    >
      <SelectPrimitive.Viewport className="scrollbar-thin max-h-72 overflow-y-auto p-1">
        {children}
      </SelectPrimitive.Viewport>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
))
SelectContent.displayName = 'SelectContent'

export const SelectItem = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      'relative flex cursor-pointer select-none items-center gap-2 rounded-md py-1.5 pl-7 pr-2',
      'text-[13px] text-fg outline-none transition-colors',
      'data-[highlighted]:bg-surface-2',
      'data-[disabled]:pointer-events-none data-[disabled]:opacity-45',
      className,
    )}
    {...props}
  >
    <span className="absolute left-2 flex size-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="size-3.5 text-accent" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
))
SelectItem.displayName = 'SelectItem'

export function SelectLabel({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      className={cn(
        'px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide text-fg-subtle',
        className,
      )}
      {...props}
    />
  )
}

/* =================================================================== Tabs */

export const Tabs = TabsPrimitive.Root

export const TabsList = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn('flex items-center gap-1 border-b border-border', className)}
    {...props}
  />
))
TabsList.displayName = 'TabsList'

export const TabsTrigger = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'relative -mb-px border-b-2 border-transparent px-2.5 py-2 text-[13px] font-medium',
      'text-fg-muted transition-colors duration-150 hover:text-fg',
      'data-[state=active]:border-accent data-[state=active]:text-fg',
      className,
    )}
    {...props}
  />
))
TabsTrigger.displayName = 'TabsTrigger'

export const TabsContent = TabsPrimitive.Content

/* ================================================== Segmented control */

/**
 * Compact single-choice control used for the calendar view switcher. A radio
 * group rather than a row of buttons, so arrow keys move between options and
 * screen readers announce "3 of 7".
 */
export function SegmentedControl<T extends string>({
  value,
  onValueChange,
  options,
  label,
  className,
  size = 'md',
}: {
  value: T
  onValueChange: (value: T) => void
  options: { value: T; label: string; icon?: React.ReactNode; hint?: string }[]
  label: string
  className?: string
  size?: 'sm' | 'md'
}) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([])

  const move = (from: number, delta: number) => {
    const next = (from + delta + options.length) % options.length
    onValueChange(options[next].value)
    refs.current[next]?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        'inline-flex items-center gap-0.5 rounded-md border border-border bg-surface-2 p-0.5',
        className,
      )}
    >
      {options.map((option, index) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[index] = el
            }}
            type="button"
            role="radio"
            aria-checked={active}
            title={option.hint}
            tabIndex={active ? 0 : -1}
            onClick={() => onValueChange(option.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                event.preventDefault()
                move(index, 1)
              } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                event.preventDefault()
                move(index, -1)
              }
            }}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-[5px] font-medium transition-colors duration-150',
              size === 'sm' ? 'h-6 px-2 text-xs' : 'h-7 px-2.5 text-[13px]',
              active
                ? 'bg-surface text-fg shadow-sm'
                : 'text-fg-muted hover:text-fg',
              '[&_svg]:size-3.5',
            )}
          >
            {option.icon}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

/* ================================================================ Tooltip */

export const TooltipProvider = TooltipPrimitive.Provider

/**
 * Tooltips carry hints only, never the sole label of a control — every icon
 * button also has an aria-label, because a tooltip is unreachable by touch.
 */
export function Tooltip({
  children,
  content,
  shortcut,
  side = 'bottom',
  delay = 400,
}: {
  children: React.ReactNode
  content: React.ReactNode
  shortcut?: string
  side?: 'top' | 'right' | 'bottom' | 'left'
  delay?: number
}) {
  if (!content) return <>{children}</>
  return (
    <TooltipPrimitive.Root delayDuration={delay}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className={cn(
            'z-50 flex items-center gap-1.5 rounded-md border border-border bg-surface',
            'px-2 py-1 text-xs text-fg shadow-md',
            'data-[state=delayed-open]:animate-fade-in',
          )}
        >
          {content}
          {shortcut ? (
            <span className="text-fg-subtle">{shortcut}</span>
          ) : null}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}
