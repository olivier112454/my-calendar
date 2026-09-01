import * as React from 'react'
import { cn } from '@/lib/utils'

const fieldBase =
  'w-full rounded-md border border-border bg-surface text-fg placeholder:text-fg-subtle ' +
  'transition-colors duration-150 ' +
  'hover:border-border-strong ' +
  'focus:outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent-soft ' +
  'disabled:cursor-not-allowed disabled:opacity-60 disabled:bg-surface-2 ' +
  'aria-[invalid=true]:border-danger aria-[invalid=true]:ring-danger-soft'

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(fieldBase, 'h-8 px-2.5 text-sm', className)}
    {...props}
  />
))
Input.displayName = 'Input'

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(fieldBase, 'min-h-[72px] px-2.5 py-2 text-sm resize-y', className)}
    {...props}
  />
))
Textarea.displayName = 'Textarea'

/**
 * Text field with a leading icon. The icon is decorative and hidden from
 * assistive technology; the field itself carries the accessible name.
 */
export const InputWithIcon = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & {
    icon: React.ReactNode
    trailing?: React.ReactNode
  }
>(({ className, icon, trailing, ...props }, ref) => (
  <div className="relative flex items-center">
    <span
      aria-hidden="true"
      className="pointer-events-none absolute left-2.5 flex items-center text-fg-subtle [&_svg]:size-4"
    >
      {icon}
    </span>
    <input
      ref={ref}
      className={cn(
        fieldBase,
        'h-8 pl-8 text-sm',
        trailing ? 'pr-16' : 'pr-2.5',
        className,
      )}
      {...props}
    />
    {trailing ? (
      <span className="absolute right-2 flex items-center gap-1">{trailing}</span>
    ) : null}
  </div>
))
InputWithIcon.displayName = 'InputWithIcon'

export { fieldBase }
