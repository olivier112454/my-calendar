import Image from 'next/image'
import { cn } from '@/lib/utils'
import { appConfig } from '@/config/app'

/**
 * The brand marks.
 *
 * These are supplied artwork rather than drawn SVG, so unlike the rest of the
 * interface they do not follow the accent colour — the logo keeps its own
 * blue-to-purple gradient whatever accent is chosen in Settings.
 *
 * Two lockups exist because the wordmark's dark end vanishes on the dark theme;
 * `logo-lockup-dark.png` is the same artwork with its lightness raised. Both are
 * rendered and CSS picks one, so switching theme never flashes an unloaded
 * image. Rebuild them from the source PNG with `scripts/build-logo.py`.
 */

/** Intrinsic sizes of the assets, so Next can reserve the right space. */
const MARK = { width: 128, height: 128 }
const LOCKUP = { width: 395, height: 96 }

/** The icon on its own: collapsed sidebar, and anywhere the name is elsewhere. */
export function Logo({ className }: { className?: string }) {
  return (
    <Image
      src="/logo-mark.png"
      alt=""
      aria-hidden="true"
      {...MARK}
      className={cn('size-6 shrink-0', className)}
    />
  )
}

export function Wordmark({
  className,
  showName = true,
}: {
  className?: string
  showName?: boolean
}) {
  if (!showName) return <Logo className={className} />

  return (
    <span className={cn('inline-flex items-center', className)}>
      {/* The name is part of the artwork, so it is the image's alt text rather
          than a text node beside it. Renaming the app through
          NEXT_PUBLIC_APP_NAME therefore does not change what this picture says
          — the artwork would have to be redrawn too. */}
      <Image
        src="/logo-lockup.png"
        alt={appConfig.name}
        {...LOCKUP}
        className="h-6 w-auto dark:hidden"
      />
      <Image
        src="/logo-lockup-dark.png"
        alt={appConfig.name}
        {...LOCKUP}
        className="hidden h-6 w-auto dark:block"
      />
    </span>
  )
}

/** Google's four-colour G. Fixed brand colours by design — never themed. */
export function GoogleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 18 18" className={cn('size-4', className)} aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.47.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  )
}
