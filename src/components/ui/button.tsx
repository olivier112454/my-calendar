import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium ' +
    'transition-colors duration-150 select-none ' +
    'disabled:pointer-events-none disabled:opacity-50 ' +
    '[&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary:
          'bg-accent text-accent-fg hover:bg-accent-hover shadow-sm',
        secondary:
          'bg-surface text-fg border border-border hover:bg-surface-2 shadow-sm',
        ghost: 'text-fg-muted hover:bg-surface-2 hover:text-fg',
        subtle: 'bg-surface-2 text-fg hover:bg-surface-3',
        danger: 'bg-danger text-danger-fg hover:opacity-90 shadow-sm',
        dangerGhost: 'text-danger hover:bg-danger-soft',
        link: 'text-accent underline-offset-4 hover:underline',
      },
      size: {
        // Every interactive size keeps a 44px touch target on coarse pointers
        // via the min-h utility, even when the visual box is smaller.
        sm: 'h-7 px-2.5 text-xs [&_svg]:size-3.5',
        md: 'h-8 px-3 text-sm [&_svg]:size-4',
        lg: 'h-10 px-4 text-sm [&_svg]:size-4',
        iconSm: 'h-7 w-7 [&_svg]:size-3.5',
        icon: 'h-8 w-8 [&_svg]:size-4',
        iconLg: 'h-10 w-10 [&_svg]:size-[18px]',
      },
      block: { true: 'w-full', false: '' },
    },
    defaultVariants: { variant: 'secondary', size: 'md', block: false },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  loading?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant, size, block, asChild, loading, children, disabled, ...props },
    ref,
  ) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size, block }), className)}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? (
          <>
            <Loader2 className="animate-spin" aria-hidden="true" />
            <span className="sr-only">Loading</span>
            {!asChild && children}
          </>
        ) : (
          children
        )}
      </Comp>
    )
  },
)
Button.displayName = 'Button'

export { buttonVariants }
