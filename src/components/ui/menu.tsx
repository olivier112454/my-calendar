'use client'

import * as React from 'react'
import * as DropdownPrimitive from '@radix-ui/react-dropdown-menu'
import * as ContextPrimitive from '@radix-ui/react-context-menu'
import { Check, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Dropdown and context menus share one visual language. Radix ships them as two
 * packages with identical APIs, so the class strings live here once and each
 * wrapper applies them.
 */

const contentClass =
  'z-50 min-w-[11rem] overflow-hidden rounded-lg border border-border bg-surface p-1 shadow-lg ' +
  'data-[state=open]:animate-scale-in'

const itemClass =
  'relative flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5 ' +
  'text-[13px] text-fg outline-none transition-colors ' +
  'focus:bg-surface-2 data-[highlighted]:bg-surface-2 ' +
  'data-[disabled]:pointer-events-none data-[disabled]:opacity-45 ' +
  '[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-fg-subtle'

const dangerItemClass =
  'text-danger focus:bg-danger-soft data-[highlighted]:bg-danger-soft [&_svg]:text-danger'

const labelClass = 'px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide text-fg-subtle'
const separatorClass = '-mx-1 my-1 h-px bg-border'

/* ============================================================== Dropdown */

export const DropdownMenu = DropdownPrimitive.Root
export const DropdownMenuTrigger = DropdownPrimitive.Trigger
export const DropdownMenuGroup = DropdownPrimitive.Group
export const DropdownMenuSub = DropdownPrimitive.Sub
export const DropdownMenuRadioGroup = DropdownPrimitive.RadioGroup

export const DropdownMenuContent = React.forwardRef<
  React.ComponentRef<typeof DropdownPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Content>
>(({ className, sideOffset = 6, align = 'start', ...props }, ref) => (
  <DropdownPrimitive.Portal>
    <DropdownPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      align={align}
      collisionPadding={12}
      className={cn(contentClass, className)}
      {...props}
    />
  </DropdownPrimitive.Portal>
))
DropdownMenuContent.displayName = 'DropdownMenuContent'

export const DropdownMenuItem = React.forwardRef<
  React.ComponentRef<typeof DropdownPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Item> & {
    danger?: boolean
    shortcut?: string
  }
>(({ className, danger, shortcut, children, asChild, ...props }, ref) => (
  <DropdownPrimitive.Item
    ref={ref}
    asChild={asChild}
    className={cn(itemClass, danger && dangerItemClass, className)}
    {...props}
  >
    {/* With `asChild`, Radix slots its props onto the child and requires
        exactly one element. Rendering the shortcut alongside would make two,
        which fails at runtime — so an `asChild` item carries its own trailing
        content instead. */}
    {asChild ? (
      children
    ) : (
      <>
        {children}
        {shortcut ? (
          <span className="ml-auto pl-4 text-[11px] text-fg-subtle">{shortcut}</span>
        ) : null}
      </>
    )}
  </DropdownPrimitive.Item>
))
DropdownMenuItem.displayName = 'DropdownMenuItem'

export const DropdownMenuCheckboxItem = React.forwardRef<
  React.ComponentRef<typeof DropdownPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof DropdownPrimitive.CheckboxItem>
>(({ className, children, ...props }, ref) => (
  <DropdownPrimitive.CheckboxItem
    ref={ref}
    className={cn(itemClass, 'pl-7', className)}
    {...props}
  >
    <span className="absolute left-2 flex size-3.5 items-center justify-center">
      <DropdownPrimitive.ItemIndicator>
        <Check className="!size-3.5 !text-accent" />
      </DropdownPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownPrimitive.CheckboxItem>
))
DropdownMenuCheckboxItem.displayName = 'DropdownMenuCheckboxItem'

export const DropdownMenuRadioItem = React.forwardRef<
  React.ComponentRef<typeof DropdownPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof DropdownPrimitive.RadioItem>
>(({ className, children, ...props }, ref) => (
  <DropdownPrimitive.RadioItem
    ref={ref}
    className={cn(itemClass, 'pl-7', className)}
    {...props}
  >
    <span className="absolute left-2 flex size-3.5 items-center justify-center">
      <DropdownPrimitive.ItemIndicator>
        <Check className="!size-3.5 !text-accent" />
      </DropdownPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownPrimitive.RadioItem>
))
DropdownMenuRadioItem.displayName = 'DropdownMenuRadioItem'

export const DropdownMenuSubTrigger = React.forwardRef<
  React.ComponentRef<typeof DropdownPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof DropdownPrimitive.SubTrigger>
>(({ className, children, ...props }, ref) => (
  <DropdownPrimitive.SubTrigger ref={ref} className={cn(itemClass, className)} {...props}>
    {children}
    <ChevronRight className="ml-auto" />
  </DropdownPrimitive.SubTrigger>
))
DropdownMenuSubTrigger.displayName = 'DropdownMenuSubTrigger'

export const DropdownMenuSubContent = React.forwardRef<
  React.ComponentRef<typeof DropdownPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof DropdownPrimitive.SubContent>
>(({ className, ...props }, ref) => (
  <DropdownPrimitive.Portal>
    <DropdownPrimitive.SubContent
      ref={ref}
      className={cn(contentClass, className)}
      {...props}
    />
  </DropdownPrimitive.Portal>
))
DropdownMenuSubContent.displayName = 'DropdownMenuSubContent'

export function DropdownMenuLabel({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Label>) {
  return <DropdownPrimitive.Label className={cn(labelClass, className)} {...props} />
}

export function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Separator>) {
  return (
    <DropdownPrimitive.Separator className={cn(separatorClass, className)} {...props} />
  )
}

/* =========================================================== Context menu */

export const ContextMenu = ContextPrimitive.Root
export const ContextMenuTrigger = ContextPrimitive.Trigger
export const ContextMenuSub = ContextPrimitive.Sub

export const ContextMenuContent = React.forwardRef<
  React.ComponentRef<typeof ContextPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof ContextPrimitive.Content>
>(({ className, ...props }, ref) => (
  <ContextPrimitive.Portal>
    <ContextPrimitive.Content
      ref={ref}
      collisionPadding={12}
      className={cn(contentClass, className)}
      {...props}
    />
  </ContextPrimitive.Portal>
))
ContextMenuContent.displayName = 'ContextMenuContent'

export const ContextMenuItem = React.forwardRef<
  React.ComponentRef<typeof ContextPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ContextPrimitive.Item> & {
    danger?: boolean
    shortcut?: string
  }
>(({ className, danger, shortcut, children, asChild, ...props }, ref) => (
  <ContextPrimitive.Item
    ref={ref}
    asChild={asChild}
    className={cn(itemClass, danger && dangerItemClass, className)}
    {...props}
  >
    {/* Same single-child rule as the dropdown item above. */}
    {asChild ? (
      children
    ) : (
      <>
        {children}
        {shortcut ? (
          <span className="ml-auto pl-4 text-[11px] text-fg-subtle">{shortcut}</span>
        ) : null}
      </>
    )}
  </ContextPrimitive.Item>
))
ContextMenuItem.displayName = 'ContextMenuItem'

export const ContextMenuSubTrigger = React.forwardRef<
  React.ComponentRef<typeof ContextPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof ContextPrimitive.SubTrigger>
>(({ className, children, ...props }, ref) => (
  <ContextPrimitive.SubTrigger ref={ref} className={cn(itemClass, className)} {...props}>
    {children}
    <ChevronRight className="ml-auto" />
  </ContextPrimitive.SubTrigger>
))
ContextMenuSubTrigger.displayName = 'ContextMenuSubTrigger'

export const ContextMenuSubContent = React.forwardRef<
  React.ComponentRef<typeof ContextPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof ContextPrimitive.SubContent>
>(({ className, ...props }, ref) => (
  <ContextPrimitive.Portal>
    <ContextPrimitive.SubContent
      ref={ref}
      className={cn(contentClass, className)}
      {...props}
    />
  </ContextPrimitive.Portal>
))
ContextMenuSubContent.displayName = 'ContextMenuSubContent'

export function ContextMenuLabel({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof ContextPrimitive.Label>) {
  return <ContextPrimitive.Label className={cn(labelClass, className)} {...props} />
}

export function ContextMenuSeparator({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof ContextPrimitive.Separator>) {
  return (
    <ContextPrimitive.Separator className={cn(separatorClass, className)} {...props} />
  )
}
