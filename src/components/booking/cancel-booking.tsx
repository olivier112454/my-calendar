'use client'

import * as React from 'react'
import { CalendarX2, Check } from 'lucide-react'
import { api } from '@/lib/client/api'
import { formatEventRange } from '@/lib/datetime'
import { Button } from '@/components/ui/button'
import { ErrorBanner } from '@/components/ui/states'
import { Wordmark } from '@/components/brand'

export function CancelBooking({
  token,
  booking,
}: {
  token: string
  booking: {
    title: string
    hostName: string
    start: string
    end: string
    inviteeName: string
    inviteeTimezone: string
    status: string
  }
}) {
  const [cancelled, setCancelled] = React.useState(booking.status === 'CANCELLED')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const cancel = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.delete('/api/bookings', { cancelToken: token })
      setCancelled(true)
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'That booking could not be cancelled.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="rounded-xl border border-border bg-surface p-6 text-center">
          <span
            aria-hidden="true"
            className="mx-auto flex size-11 items-center justify-center rounded-full bg-surface-2 text-fg-muted"
          >
            {cancelled ? <Check className="size-5" /> : <CalendarX2 className="size-5" />}
          </span>

          <h1 className="mt-4 text-[19px] font-semibold tracking-[-0.01em] text-fg">
            {cancelled ? 'Booking cancelled' : 'Cancel this booking?'}
          </h1>

          <p className="mt-1.5 text-[13px] leading-relaxed text-fg-muted">
            {booking.title} with {booking.hostName}
          </p>

          <p className="mt-3 rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-[13px] font-medium text-fg">
            {formatEventRange(
              new Date(booking.start),
              new Date(booking.end),
              booking.inviteeTimezone,
              true,
            )}
          </p>

          {error ? <ErrorBanner className="mt-3 text-left" title="Could not cancel" description={error} /> : null}

          {cancelled ? (
            <p className="mt-4 text-[13px] text-fg-muted">
              {booking.hostName} has been notified. Nothing else is needed.
            </p>
          ) : (
            <Button
              variant="danger"
              size="lg"
              block
              className="mt-4"
              loading={busy}
              onClick={cancel}
            >
              Cancel booking
            </Button>
          )}
        </div>

        <p className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-fg-subtle">
          Scheduled with <Wordmark className="scale-90" />
        </p>
      </div>
    </main>
  )
}
