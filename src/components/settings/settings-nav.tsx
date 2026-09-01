'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { settingsSections } from '@/components/layout/nav-items'

export function SettingsNav({
  orientation,
}: {
  orientation: 'vertical' | 'horizontal'
}) {
  const pathname = usePathname()

  return (
    <ul
      className={cn(
        orientation === 'vertical'
          ? 'space-y-px'
          : 'no-scrollbar -mx-4 flex gap-1 overflow-x-auto px-4 pb-2',
      )}
    >
      {settingsSections.map((section) => {
        const active = pathname === section.href
        return (
          <li key={section.href} className={orientation === 'horizontal' ? 'shrink-0' : ''}>
            <Link
              href={section.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'block rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors',
                orientation === 'horizontal' && 'whitespace-nowrap',
                active
                  ? 'bg-surface-2 text-fg'
                  : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
              )}
            >
              {section.label}
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

/** Shared page heading so every settings section reads the same. */
export function SettingsSection({
  title,
  description,
  children,
  actions,
}: {
  title: string
  description?: string
  children: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <section className="mb-8 last:mb-0">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[15px] font-semibold text-fg">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-[13px] leading-relaxed text-fg-muted">
              {description}
            </p>
          ) : null}
        </div>
        {actions}
      </div>
      <div className="rounded-lg border border-border bg-surface px-4 py-1">{children}</div>
    </section>
  )
}

/** A labelled row inside a settings card. */
export function SettingsRow({
  label,
  description,
  htmlFor,
  children,
  stacked,
}: {
  label: string
  description?: string
  htmlFor?: string
  children: React.ReactNode
  stacked?: boolean
}) {
  return (
    <div
      className={cn(
        'border-b border-border py-3 last:border-b-0',
        stacked ? 'space-y-2' : 'flex items-center justify-between gap-6',
      )}
    >
      <div className="min-w-0">
        <label
          htmlFor={htmlFor}
          className={cn('block text-[13px] font-medium text-fg', htmlFor && 'cursor-pointer')}
        >
          {label}
        </label>
        {description ? (
          <p className="mt-0.5 text-xs leading-relaxed text-fg-muted">{description}</p>
        ) : null}
      </div>
      <div className={cn(stacked ? '' : 'shrink-0')}>{children}</div>
    </div>
  )
}
