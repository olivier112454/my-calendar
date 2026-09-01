'use client'

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from './button'

/* ================================================================== Dialog */

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close

const overlayClass =
  'fixed inset-0 z-50 bg-black/25 dark:bg-black/55 backdrop-blur-[2px] ' +
  'data-[state=open]:animate-fade-in'

export const DialogContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    /** Visible heading. Required — a dialog without a name is unusable by screen readers. */
    title: string
    description?: string
    /** Hide the heading visually while keeping it announced. */
    hideHeader?: boolean
    footer?: React.ReactNode
    width?: 'sm' | 'md' | 'lg'
  }
>(
  (
    { className, children, title, description, hideHeader, footer, width = 'md', ...props },
    ref,
  ) => (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={overlayClass} />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
          'flex max-h-[min(90dvh,44rem)] w-[calc(100vw-2rem)] flex-col',
          'rounded-xl border border-border bg-surface shadow-lg',
          'data-[state=open]:animate-scale-in',
          { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-3xl' }[width],
          className,
        )}
        {...props}
      >
        <div
          className={cn(
            'flex items-start justify-between gap-4 px-5 pt-4',
            hideHeader && 'sr-only',
          )}
        >
          <div className="min-w-0 space-y-0.5">
            <DialogPrimitive.Title className="text-sm font-semibold text-fg">
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="text-xs text-fg-muted">
                {description}
              </DialogPrimitive.Description>
            ) : (
              <DialogPrimitive.Description className="sr-only">
                {title}
              </DialogPrimitive.Description>
            )}
          </div>
          {!hideHeader ? (
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="iconSm" aria-label="Close">
                <X />
              </Button>
            </DialogPrimitive.Close>
          ) : null}
        </div>

        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {children}
        </div>

        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
            {footer}
          </div>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  ),
)
DialogContent.displayName = 'DialogContent'

/* =================================================================== Sheet */

/**
 * Edge-anchored panel. Preferred over a modal dialog for detail views: it keeps
 * the calendar visible behind it, which is the whole point of a side panel.
 */
export const Sheet = DialogPrimitive.Root
export const SheetTrigger = DialogPrimitive.Trigger
export const SheetClose = DialogPrimitive.Close

export const SheetContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    title: string
    description?: string
    side?: 'right' | 'left' | 'bottom'
    headerActions?: React.ReactNode
    footer?: React.ReactNode
  }
>(
  (
    { className, children, title, description, side = 'right', headerActions, footer, ...props },
    ref,
  ) => (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={overlayClass} />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'fixed z-50 flex flex-col border-border bg-surface shadow-lg',
          side === 'right' &&
            'inset-y-0 right-0 w-[min(26rem,100vw)] border-l data-[state=open]:animate-slide-from-right',
          side === 'left' &&
            'inset-y-0 left-0 w-[min(20rem,85vw)] border-r data-[state=open]:animate-slide-from-right',
          side === 'bottom' &&
            'inset-x-0 bottom-0 max-h-[88dvh] rounded-t-xl border-t pb-safe data-[state=open]:animate-slide-from-bottom',
          className,
        )}
        {...props}
      >
        {side === 'bottom' ? (
          <div className="flex justify-center pt-2" aria-hidden="true">
            <span className="h-1 w-9 rounded-full bg-border-strong" />
          </div>
        ) : null}

        <div className="flex items-start justify-between gap-2 px-4 py-3">
          <div className="min-w-0 space-y-0.5">
            <DialogPrimitive.Title className="truncate text-sm font-semibold text-fg">
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="text-xs text-fg-muted">
                {description}
              </DialogPrimitive.Description>
            ) : (
              <DialogPrimitive.Description className="sr-only">
                {title}
              </DialogPrimitive.Description>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {headerActions}
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="iconSm" aria-label="Close">
                <X />
              </Button>
            </DialogPrimitive.Close>
          </div>
        </div>

        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          {children}
        </div>

        {footer ? (
          <div className="flex items-center gap-2 border-t border-border px-4 py-3">
            {footer}
          </div>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  ),
)
SheetContent.displayName = 'SheetContent'

/* ================================================================= Popover */

export const Popover = PopoverPrimitive.Root
export const PopoverTrigger = PopoverPrimitive.Trigger
export const PopoverAnchor = PopoverPrimitive.Anchor

export const PopoverContent = React.forwardRef<
  React.ComponentRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = 'start', sideOffset = 6, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      collisionPadding={12}
      className={cn(
        'z-50 rounded-lg border border-border bg-surface p-3 shadow-lg outline-none',
        'data-[state=open]:animate-scale-in',
        'max-h-[var(--radix-popover-content-available-height)] overflow-y-auto scrollbar-thin',
        className,
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
))
PopoverContent.displayName = 'PopoverContent'

/* ========================================================= Confirm dialog */

/**
 * Confirmation used for genuinely destructive, non-undoable actions only.
 * Ordinary deletes are optimistic with an undo toast instead — a dialog for
 * every delete trains people to dismiss dialogs without reading them.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  destructive = true,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  onConfirm: () => void | Promise<void>
}) {
  const [busy, setBusy] = React.useState(false)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={title}
        description={description}
        width="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              {cancelLabel}
            </Button>
            <Button
              variant={destructive ? 'danger' : 'primary'}
              loading={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  await onConfirm()
                  onOpenChange(false)
                } finally {
                  setBusy(false)
                }
              }}
            >
              {confirmLabel}
            </Button>
          </>
        }
      >
        <span className="sr-only">{description ?? title}</span>
      </DialogContent>
    </Dialog>
  )
}
