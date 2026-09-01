'use client'

import * as React from 'react'
import Link from 'next/link'
import { Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/ui/states'

/**
 * Last-resort boundary for an unexpected render error anywhere in the app.
 *
 * `retry()` re-fetches and re-renders the segment, which is the right first
 * move for the usual cause here — a request that failed once. If that does not
 * help there is still a way out of the broken screen, so the user is never
 * stranded on it.
 *
 * The raw error is logged rather than shown: a digest or a stack trace is not
 * something anyone can act on.
 */

export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  React.useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <main
      id="main"
      className="flex min-h-dvh flex-col items-center justify-center px-6 py-16"
    >
      <ErrorState
        title="Something went wrong"
        description="This screen failed to load. Your calendar and tasks are unaffected — trying again usually settles it."
        onRetry={retry}
        action={
          <Button asChild variant="ghost" size="sm">
            <Link href="/today">
              <Sun aria-hidden="true" />
              Go to Today
            </Link>
          </Button>
        }
      />
    </main>
  )
}
