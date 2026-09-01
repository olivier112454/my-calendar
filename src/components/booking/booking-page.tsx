'use client'

import * as React from 'react'
import {
  ArrowLeft,
  CalendarCheck,
  Clock,
  Globe,
  MapPin,
  Video,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { api, qs } from '@/lib/client/api'
import {
  addDaysToKey,
  formatDayLabel,
  formatTime,
  systemTimeZone,
  todayKey,
  timeZoneAbbreviation,
} from '@/lib/datetime'
import { appConfig } from '@/config/app'
import type { DaySlots, PublicMeetingType } from '@/server/services/booking'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { Avatar, Field } from '@/components/ui/primitives'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/controls'
import { MiniCalendar } from '@/components/calendar/mini-calendar'
import { ErrorBanner, ListSkeleton } from '@/components/ui/states'
import { Wordmark } from '@/components/brand'
import { allTimeZones } from '@/components/settings/use-settings-save'

/**
 * Three steps: pick a day, pick a time, leave your details.
 *
 * The invitee's own time zone is detected and shown prominently, and can be
 * changed — a booking page that quietly shows the host's zone is how people end
 * up on a call at four in the morning.
 */
export function BookingPage({
  username,
  slug,
  meetingType,
}: {
  username: string
  slug: string
  meetingType: PublicMeetingType
}) {
  const [zone, setZone] = React.useState(meetingType.hostTimezone)
  const [monthKey, setMonthKey] = React.useState(() => `${todayKey(meetingType.hostTimezone).slice(0, 7)}-01`)
  const [selectedDay, setSelectedDay] = React.useState<string | null>(null)
  const [selectedSlot, setSelectedSlot] = React.useState<{ start: string; end: string } | null>(
    null,
  )
  const [days, setDays] = React.useState<DaySlots[] | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const [name, setName] = React.useState('')
  const [email, setEmail] = React.useState('')
  const [notes, setNotes] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)
  const [confirmed, setConfirmed] = React.useState<{
    start: string
    cancelToken: string
  } | null>(null)

  const zones = React.useMemo(() => allTimeZones(), [])

  // Detect the visitor's zone after mount so the server render stays stable.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- reading the visitor's own time zone and loading availability are external syncs
  React.useEffect(() => setZone(systemTimeZone()), [])

  const from = `${monthKey.slice(0, 7)}-01`

  React.useEffect(() => {
    let active = true
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading the visitor's own time zone and loading availability are external syncs
    setLoading(true)

    api
      .get<{ days: DaySlots[] }>(
        `/api/bookings${qs({ username, slug, from, days: 31 })}`,
      )
      .then((data) => {
        if (!active) return
        setDays(data.days)
        setError(null)
        // Land on the first day that actually has time available.
        const firstOpen = data.days.find((day) => day.slots.length > 0)
        setSelectedDay((current) => current ?? firstOpen?.dayKey ?? null)
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(
            cause instanceof Error ? cause.message : 'Could not load available times.',
          )
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [username, slug, from])

  const slotsForDay = days?.find((day) => day.dayKey === selectedDay)?.slots ?? []
  const openDays = React.useMemo(
    () => new Set((days ?? []).filter((day) => day.slots.length > 0).map((day) => day.dayKey)),
    [days],
  )

  const submit = async () => {
    if (!selectedSlot) return
    setSubmitting(true)
    try {
      const booking = await api.post<{ start: string; cancelToken: string }>(
        '/api/bookings',
        {
          username,
          slug,
          start: selectedSlot.start,
          inviteeName: name.trim(),
          inviteeEmail: email.trim(),
          inviteeNotes: notes.trim() || undefined,
          inviteeTimezone: zone,
        },
      )
      setConfirmed(booking)
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'That booking could not be completed.',
      )
      // A taken slot means the list is stale; reload it.
      setSelectedSlot(null)
      setDays(null)
      setLoading(true)
      api
        .get<{ days: DaySlots[] }>(`/api/bookings${qs({ username, slug, from, days: 31 })}`)
        .then((data) => setDays(data.days))
        .catch(() => undefined)
        .finally(() => setLoading(false))
    } finally {
      setSubmitting(false)
    }
  }

  if (confirmed) {
    return (
      <main className="flex min-h-dvh items-center justify-center px-4 py-10">
        <div className="w-full max-w-md text-center">
          <span
            aria-hidden="true"
            className="mx-auto flex size-11 items-center justify-center rounded-full bg-accent-soft text-accent"
          >
            <CalendarCheck className="size-5" />
          </span>
          <h1 className="mt-4 text-[22px] font-semibold tracking-[-0.02em] text-fg">
            You are booked in
          </h1>
          <p className="mt-1.5 text-[13px] leading-relaxed text-fg-muted">
            {meetingType.title} with {meetingType.hostName}
          </p>
          <p className="mt-3 rounded-lg border border-border bg-surface px-4 py-3 text-[14px] font-medium text-fg">
            {formatDayLabel(
              new Date(confirmed.start).toISOString().slice(0, 10),
              'EEEE d MMMM',
            )}
            {' · '}
            {formatTime(new Date(confirmed.start), zone, true)}
            <span className="mt-0.5 block text-[11px] font-normal text-fg-subtle">
              {zone.replace(/_/g, ' ')} ({timeZoneAbbreviation(zone)})
            </span>
          </p>
          <p className="mt-3 text-xs leading-relaxed text-fg-muted">
            A confirmation has been recorded. Keep this link if you need to cancel:
          </p>
          <code className="mt-1 block break-all rounded bg-surface-2 px-2 py-1.5 text-[11px] text-fg-muted">
            {typeof window !== 'undefined' ? window.location.origin : ''}/book/cancel/
            {confirmed.cancelToken}
          </code>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-dvh px-4 py-8 sm:py-12">
      <div className="mx-auto w-full max-w-4xl">
        <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
          <div className="grid md:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
            {/* ------------------------------------------------- summary */}
            <aside className="border-b border-border p-5 md:border-b-0 md:border-r">
              <Avatar
                name={meetingType.hostName}
                src={meetingType.hostAvatarUrl}
                size="lg"
              />
              <p className="mt-3 text-[13px] text-fg-muted">{meetingType.hostName}</p>
              <h1 className="mt-0.5 text-[19px] font-semibold tracking-[-0.01em] text-fg">
                {meetingType.title}
              </h1>

              <ul className="mt-3 space-y-1.5 text-[13px] text-fg-muted">
                <li className="flex items-center gap-2">
                  <Clock className="size-3.5 shrink-0 text-fg-subtle" aria-hidden="true" />
                  {meetingType.durationMinutes} minutes
                </li>
                {meetingType.meetingProvider !== 'NONE' &&
                meetingType.meetingProvider !== 'IN_PERSON' ? (
                  <li className="flex items-center gap-2">
                    <Video className="size-3.5 shrink-0 text-fg-subtle" aria-hidden="true" />
                    Video call
                  </li>
                ) : null}
                {meetingType.location ? (
                  <li className="flex items-center gap-2">
                    <MapPin className="size-3.5 shrink-0 text-fg-subtle" aria-hidden="true" />
                    {meetingType.location}
                  </li>
                ) : null}
                <li className="flex items-start gap-2">
                  <Globe className="mt-0.5 size-3.5 shrink-0 text-fg-subtle" aria-hidden="true" />
                  <span className="min-w-0">
                    <Select value={zone} onValueChange={setZone}>
                      <SelectTrigger
                        className="h-7 border-0 bg-transparent px-0 text-[13px] hover:bg-transparent"
                        aria-label="Your time zone"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {zones.map((entry) => (
                          <SelectItem key={entry} value={entry}>
                            {entry.replace(/_/g, ' ')}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span className="block text-[11px] text-fg-subtle">
                      Times shown in your zone
                    </span>
                  </span>
                </li>
              </ul>

              {meetingType.description ? (
                <p className="mt-4 whitespace-pre-wrap border-t border-border pt-4 text-[13px] leading-relaxed text-fg-muted">
                  {meetingType.description}
                </p>
              ) : null}
            </aside>

            {/* -------------------------------------------------- picker */}
            <div className="p-5">
              {error ? (
                <ErrorBanner
                  className="mb-4"
                  title="Something went wrong"
                  description={error}
                />
              ) : null}

              {!selectedSlot ? (
                <div className="grid gap-5 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
                  <div>
                    <h2 className="mb-2 text-[13px] font-medium text-fg">Select a date</h2>
                    <MiniCalendar
                      monthKey={monthKey}
                      selectedKey={selectedDay}
                      weekStartsOn={1}
                      timezone={zone}
                      busyKeys={openDays}
                      onSelect={(dayKey) => {
                        if (!openDays.has(dayKey)) return
                        setSelectedDay(dayKey)
                      }}
                      onMonthChange={setMonthKey}
                    />
                    <p className="mt-2 text-[11px] text-fg-subtle">
                      Days with a dot have times available.
                    </p>
                  </div>

                  <div className="min-w-0">
                    <h2 className="mb-2 text-[13px] font-medium text-fg">
                      {selectedDay
                        ? formatDayLabel(selectedDay, 'EEEE d MMMM')
                        : 'Pick a day'}
                    </h2>

                    {loading ? (
                      <ListSkeleton rows={6} />
                    ) : slotsForDay.length === 0 ? (
                      <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-[13px] text-fg-muted">
                        {selectedDay
                          ? 'Nothing free on this day.'
                          : 'Choose a date to see the available times.'}
                      </p>
                    ) : (
                      <ul className="scrollbar-thin grid max-h-[22rem] gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2">
                        {slotsForDay.map((slot) => (
                          <li key={slot.start}>
                            <button
                              type="button"
                              onClick={() => setSelectedSlot(slot)}
                              className={cn(
                                'w-full rounded-md border border-border bg-surface px-3 py-2',
                                'text-[13px] font-medium tabular-nums text-fg transition-colors',
                                'hover:border-accent hover:bg-accent-soft',
                              )}
                            >
                              {formatTime(new Date(slot.start), zone, true)}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              ) : (
                <form
                  onSubmit={(nativeEvent) => {
                    nativeEvent.preventDefault()
                    void submit()
                  }}
                  className="max-w-md space-y-4"
                >
                  <button
                    type="button"
                    onClick={() => setSelectedSlot(null)}
                    className="flex items-center gap-1.5 text-[13px] text-fg-muted transition-colors hover:text-fg"
                  >
                    <ArrowLeft className="size-3.5" aria-hidden="true" />
                    Change time
                  </button>

                  <p className="rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-[13px] font-medium text-fg">
                    {formatDayLabel(
                      new Date(selectedSlot.start).toISOString().slice(0, 10),
                      'EEEE d MMMM',
                    )}
                    {' · '}
                    {formatTime(new Date(selectedSlot.start), zone, true)} –{' '}
                    {formatTime(new Date(selectedSlot.end), zone, true)}
                    <span className="mt-0.5 block text-[11px] font-normal text-fg-subtle">
                      {zone.replace(/_/g, ' ')}
                    </span>
                  </p>

                  <Field label="Your name" htmlFor="booking-name" required>
                    <Input
                      id="booking-name"
                      value={name}
                      onChange={(nativeEvent) => setName(nativeEvent.target.value)}
                      required
                      autoComplete="name"
                      autoFocus
                    />
                  </Field>

                  <Field label="Your email" htmlFor="booking-email" required>
                    <Input
                      id="booking-email"
                      type="email"
                      value={email}
                      onChange={(nativeEvent) => setEmail(nativeEvent.target.value)}
                      required
                      autoComplete="email"
                    />
                  </Field>

                  <Field
                    label="Anything to add?"
                    htmlFor="booking-notes"
                    hint="Optional — what you would like to cover."
                  >
                    <Textarea
                      id="booking-notes"
                      value={notes}
                      onChange={(nativeEvent) => setNotes(nativeEvent.target.value)}
                      rows={3}
                    />
                  </Field>

                  <Button
                    type="submit"
                    variant="primary"
                    size="lg"
                    block
                    loading={submitting}
                    disabled={!name.trim() || !email.trim()}
                  >
                    Confirm booking
                  </Button>
                </form>
              )}
            </div>
          </div>
        </div>

        <p className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-fg-subtle">
          Scheduled with <Wordmark className="scale-90" />
        </p>
      </div>
    </main>
  )
}

export { appConfig, addDaysToKey }
