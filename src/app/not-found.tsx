import Link from 'next/link'
import type { Metadata } from 'next'
import { CalendarDays, Compass, Sun } from 'lucide-react'
import { Wordmark } from '@/components/brand'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/states'

/**
 * The 404 for the whole app.
 *
 * A root `not-found` catches every unmatched URL, so this is what a mistyped
 * address lands on — including for someone who is already signed in. It has to
 * look like the product rather than like a server had a bad day, and it has to
 * offer a way back: the two places anyone actually wants are Today and the
 * calendar.
 *
 * It renders inside the root layout, so the theme script has already run and
 * the chosen theme applies without a flash.
 */

export const metadata: Metadata = {
  title: 'Page not found',
}

export default function NotFound() {
  return (
    <main
      id="main"
      className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 py-16"
    >
      <Link
        href="/today"
        aria-label="Go to Today"
        className="rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
      >
        <Wordmark />
      </Link>

      <EmptyState
        icon={<Compass />}
        title="This page does not exist"
        description="The address may have changed, or it was never here. Nothing in your calendar has been affected."
        className="py-0"
        action={
          <Button asChild variant="primary" size="lg">
            <Link href="/today">
              <Sun aria-hidden="true" />
              Go to Today
            </Link>
          </Button>
        }
        secondaryAction={
          <Button asChild variant="secondary" size="lg">
            <Link href="/calendar">
              <CalendarDays aria-hidden="true" />
              Open the calendar
            </Link>
          </Button>
        }
      />
    </main>
  )
}
