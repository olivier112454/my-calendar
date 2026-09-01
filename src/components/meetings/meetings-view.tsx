'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Check,
  Clock,
  Copy,
  ExternalLink,
  Link2,
  Plus,
  Trash2,
  Users,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/lib/client/api'
import { appUrl } from '@/config/app'
import { formatEventRange, formatRelative } from '@/lib/datetime'
import type { CalendarSummary } from '@/types/domain'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { Badge, Field } from '@/components/ui/primitives'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/controls'
import { ConfirmDialog, Dialog, DialogContent } from '@/components/ui/overlay'
import { EmptyState } from '@/components/ui/states'
import { TimeSelect } from '@/components/ui/time-select'
import { NotificationBell } from '@/components/layout/notification-bell'
import { useNow } from '@/hooks/use-now'

/**
 * Meeting types and their bookings.
 *
 * A meeting type is a public promise about your time: this long, on these days,
 * with this much notice. The page keeps that promise visible next to the link
 * people will actually use.
 */

interface MeetingType {
  id: string
  slug: string
  title: string
  description: string | null
  durationMinutes: number
  bufferAfterMinutes: number
  minimumNoticeMinutes: number
  bookingWindowDays: number
  meetingProvider: string
  location: string | null
  color: string
  isActive: boolean
  bookingCount: number
  availability: { weekday: number; startMinute: number; endMinute: number }[]
}

interface Booking {
  id: string
  title: string
  color: string
  inviteeName: string
  inviteeEmail: string
  inviteeNotes: string | null
  inviteeTimezone: string
  start: string
  end: string
  status: string
}

const DAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function MeetingsView({
  meetingTypes,
  bookings,
  calendars,
  username,
  timezone,
  use24h,
}: {
  meetingTypes: MeetingType[]
  bookings: Booking[]
  calendars: CalendarSummary[]
  username: string | null
  timezone: string
  use24h: boolean
}) {
  const router = useRouter()
  const [createOpen, setCreateOpen] = React.useState(false)
  const [copiedId, setCopiedId] = React.useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = React.useState<MeetingType | null>(null)
  const now = useNow()

  const upcoming = bookings.filter(
    (booking) => booking.status === 'CONFIRMED' && Date.parse(booking.start) > now,
  )
  const past = bookings.filter(
    (booking) => booking.status !== 'CONFIRMED' || Date.parse(booking.start) <= now,
  )

  const linkFor = (meetingType: MeetingType) =>
    `${appUrl()}/book/${username ?? 'you'}/${meetingType.slug}`

  const copyLink = async (meetingType: MeetingType) => {
    try {
      await navigator.clipboard.writeText(linkFor(meetingType))
      setCopiedId(meetingType.id)
      setTimeout(() => setCopiedId(null), 1500)
    } catch {
      toast.error('Could not copy the link.')
    }
  }

  const toggleActive = async (meetingType: MeetingType, isActive: boolean) => {
    try {
      await api.patch(`/api/meeting-types/${meetingType.id}`, { isActive })
      router.refresh()
    } catch {
      toast.error('Could not update that meeting type.')
    }
  }

  const remove = async (meetingType: MeetingType) => {
    try {
      await api.delete(`/api/meeting-types/${meetingType.id}`)
      toast.success('Meeting type deleted')
      router.refresh()
    } catch {
      toast.error('Could not delete that meeting type.')
    }
  }

  return (
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
        <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-fg">
              Meetings
            </h1>
            <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-fg-muted">
              Share a link and let people pick a time that is genuinely free.
              Your calendar decides what is offered.
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <NotificationBell />
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              <Plus />
              New meeting type
            </Button>
          </div>
        </header>

        {!username ? (
          <div className="mb-5 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2.5">
            <p className="text-[13px] font-medium text-fg">
              Set a booking name before sharing a link
            </p>
            <p className="mt-0.5 text-xs text-fg-muted">
              Your links need a handle, like /book/olivier. Choose one on the
              account page.
            </p>
          </div>
        ) : null}

        <Tabs defaultValue="types">
          <TabsList className="mb-4">
            <TabsTrigger value="types">Meeting types</TabsTrigger>
            <TabsTrigger value="upcoming">
              Upcoming
              {upcoming.length > 0 ? (
                <span className="ml-1.5 text-fg-subtle">{upcoming.length}</span>
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="past">Past</TabsTrigger>
          </TabsList>

          <TabsContent value="types">
            {meetingTypes.length === 0 ? (
              <div className="rounded-lg border border-border bg-surface">
                <EmptyState
                  icon={<Users />}
                  title="No meeting types yet"
                  description="Create one and share the link. People see only your free slots."
                  action={
                    <Button variant="secondary" size="sm" onClick={() => setCreateOpen(true)}>
                      Create one
                    </Button>
                  }
                />
              </div>
            ) : (
              <ul className="space-y-2">
                {meetingTypes.map((meetingType) => (
                  <li
                    key={meetingType.id}
                    className={cn(
                      'rounded-lg border border-border bg-surface px-4 py-3',
                      !meetingType.isActive && 'opacity-60',
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <span
                        aria-hidden="true"
                        className="mt-1 h-9 w-[3px] shrink-0 rounded-full"
                        style={{ backgroundColor: meetingType.color }}
                      />

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-[14px] font-medium text-fg">
                            {meetingType.title}
                          </h3>
                          <Badge tone="neutral">
                            <Clock aria-hidden="true" />
                            {meetingType.durationMinutes} min
                          </Badge>
                          {meetingType.bookingCount > 0 ? (
                            <Badge tone="accent">
                              {meetingType.bookingCount} booked
                            </Badge>
                          ) : null}
                        </div>

                        {meetingType.description ? (
                          <p className="mt-0.5 text-[13px] leading-relaxed text-fg-muted">
                            {meetingType.description}
                          </p>
                        ) : null}

                        <div className="mt-2 flex flex-wrap items-center gap-3">
                          <span
                            className="flex items-center gap-0.5"
                            aria-label={availabilityLabel(meetingType.availability)}
                            title={availabilityLabel(meetingType.availability)}
                          >
                            {DAY_INITIALS.map((initial, weekday) => {
                              const open = meetingType.availability.some(
                                (entry) => entry.weekday === weekday,
                              )
                              return (
                                <span
                                  key={weekday}
                                  aria-hidden="true"
                                  className={cn(
                                    'flex size-4 items-center justify-center rounded text-[9px] font-medium',
                                    open
                                      ? 'bg-accent-soft text-accent'
                                      : 'bg-surface-2 text-fg-subtle',
                                  )}
                                >
                                  {initial}
                                </span>
                              )
                            })}
                          </span>
                          <span className="text-[11px] text-fg-subtle">
                            {meetingType.minimumNoticeMinutes >= 60
                              ? `${Math.round(meetingType.minimumNoticeMinutes / 60)}h notice`
                              : `${meetingType.minimumNoticeMinutes}m notice`}
                            {' · '}
                            {meetingType.bookingWindowDays} days ahead
                          </span>
                        </div>

                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <code className="truncate rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-fg-muted">
                            /book/{username ?? 'you'}/{meetingType.slug}
                          </code>
                          <Button
                            variant="ghost"
                            size="iconSm"
                            onClick={() => copyLink(meetingType)}
                            aria-label={`Copy link for ${meetingType.title}`}
                            disabled={!username}
                          >
                            {copiedId === meetingType.id ? <Check /> : <Copy />}
                          </Button>
                          <Button
                            variant="ghost"
                            size="iconSm"
                            asChild
                            aria-label={`Open ${meetingType.title} booking page`}
                            disabled={!username}
                          >
                            <a
                              href={`/book/${username ?? 'you'}/${meetingType.slug}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <ExternalLink />
                            </a>
                          </Button>
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-1">
                        <Switch
                          checked={meetingType.isActive}
                          onCheckedChange={(isActive) => toggleActive(meetingType, isActive)}
                          aria-label={`${meetingType.title} accepting bookings`}
                        />
                        <Button
                          variant="dangerGhost"
                          size="iconSm"
                          onClick={() => setPendingDelete(meetingType)}
                          aria-label={`Delete ${meetingType.title}`}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>

          <TabsContent value="upcoming">
            <BookingList
              bookings={upcoming}
              timezone={timezone}
              use24h={use24h}
              emptyTitle="No bookings yet"
              emptyDescription="When someone books a time, it appears here and on your calendar."
            />
          </TabsContent>

          <TabsContent value="past">
            <BookingList
              bookings={past}
              timezone={timezone}
              use24h={use24h}
              emptyTitle="Nothing in the past"
              emptyDescription="Completed and cancelled bookings collect here."
            />
          </TabsContent>
        </Tabs>
      </div>

      <CreateMeetingTypeDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        calendars={calendars}
        onCreated={() => router.refresh()}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title={`Delete "${pendingDelete?.title}"?`}
        description="The link stops working. Bookings already made keep their place on your calendar."
        confirmLabel="Delete"
        onConfirm={async () => {
          if (pendingDelete) await remove(pendingDelete)
        }}
      />
    </div>
  )
}

function BookingList({
  bookings,
  timezone,
  use24h,
  emptyTitle,
  emptyDescription,
}: {
  bookings: Booking[]
  timezone: string
  use24h: boolean
  emptyTitle: string
  emptyDescription: string
}) {
  if (bookings.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface">
        <EmptyState
          compact
          icon={<Link2 />}
          title={emptyTitle}
          description={emptyDescription}
        />
      </div>
    )
  }

  return (
    <ul className="space-y-1.5">
      {bookings.map((booking) => (
        <li
          key={booking.id}
          className="flex items-start gap-3 rounded-lg border border-border bg-surface px-3 py-2.5"
        >
          <span
            aria-hidden="true"
            className="mt-1 h-8 w-[3px] shrink-0 rounded-full"
            style={{ backgroundColor: booking.color }}
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-medium text-fg">
                {booking.inviteeName}
              </span>
              <span className="text-[11px] text-fg-subtle">{booking.inviteeEmail}</span>
              {booking.status === 'CANCELLED' ? (
                <Badge tone="danger">Cancelled</Badge>
              ) : null}
            </div>
            <p className="text-[13px] text-fg-muted">{booking.title}</p>
            <p className="text-[11px] text-fg-subtle">
              {formatEventRange(
                new Date(booking.start),
                new Date(booking.end),
                timezone,
                use24h,
              )}
              {booking.inviteeTimezone !== timezone
                ? ` · their time zone: ${booking.inviteeTimezone.replace(/_/g, ' ')}`
                : ''}
            </p>
            {booking.inviteeNotes ? (
              <p className="mt-1 rounded bg-surface-2 px-2 py-1 text-xs text-fg-muted">
                {booking.inviteeNotes}
              </p>
            ) : null}
          </div>
          <span className="shrink-0 text-[11px] text-fg-subtle">
            {formatRelative(new Date(booking.start))}
          </span>
        </li>
      ))}
    </ul>
  )
}

function availabilityLabel(
  availability: { weekday: number; startMinute: number; endMinute: number }[],
): string {
  if (availability.length === 0) return 'No availability set'
  const clock = (minutes: number) =>
    `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
  return availability
    .map((entry) => `${DAY_NAMES[entry.weekday]} ${clock(entry.startMinute)}–${clock(entry.endMinute)}`)
    .join(', ')
}

function CreateMeetingTypeDialog({
  open,
  onOpenChange,
  calendars,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  calendars: CalendarSummary[]
  onCreated: () => void
}) {
  const writable = calendars.filter((calendar) => !calendar.isReadOnly)
  const [title, setTitle] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [duration, setDuration] = React.useState('30')
  const [notice, setNotice] = React.useState('240')
  const [calendarId, setCalendarId] = React.useState(writable[0]?.id ?? '')
  const [days, setDays] = React.useState<Set<number>>(() => new Set([1, 2, 3, 4, 5]))
  const [startTime, setStartTime] = React.useState('09:00')
  const [endTime, setEndTime] = React.useState('17:00')
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets the form when the dialog opens
    setTitle('')
    setDescription('')
    setDuration('30')
    setError(null)
  }, [open])

  const submit = async () => {
    if (!title.trim()) {
      setError('Give the meeting type a name')
      return
    }
    if (days.size === 0) {
      setError('Pick at least one day')
      return
    }

    setSaving(true)
    try {
      await api.post('/api/meeting-types', {
        title: title.trim(),
        description: description.trim() || null,
        durationMinutes: Number(duration),
        minimumNoticeMinutes: Number(notice),
        targetCalendarId: calendarId || null,
        availability: [...days].map((weekday) => ({
          weekday,
          startMinute: toMinutes(startTime),
          endMinute: toMinutes(endTime),
        })),
      })
      toast.success('Meeting type created')
      onOpenChange(false)
      onCreated()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create that.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="New meeting type"
        description="What you are offering, and when."
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={saving} onClick={submit}>
              Create
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Name" htmlFor="mt-title" error={error ?? undefined} required>
            <Input
              id="mt-title"
              value={title}
              onChange={(nativeEvent) => {
                setTitle(nativeEvent.target.value)
                setError(null)
              }}
              placeholder="30 minute meeting"
              autoFocus
            />
          </Field>

          <Field label="Description" htmlFor="mt-description">
            <Textarea
              id="mt-description"
              value={description}
              onChange={(nativeEvent) => setDescription(nativeEvent.target.value)}
              placeholder="What people should expect."
              rows={2}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Length" htmlFor="mt-duration">
              <Select value={duration} onValueChange={setDuration}>
                <SelectTrigger id="mt-duration">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[15, 30, 45, 60, 90].map((minutes) => (
                    <SelectItem key={minutes} value={String(minutes)}>
                      {minutes} minutes
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Minimum notice" htmlFor="mt-notice">
              <Select value={notice} onValueChange={setNotice}>
                <SelectTrigger id="mt-notice">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">None</SelectItem>
                  <SelectItem value="60">1 hour</SelectItem>
                  <SelectItem value="240">4 hours</SelectItem>
                  <SelectItem value="1440">1 day</SelectItem>
                  <SelectItem value="2880">2 days</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field label="Available on">
            <div className="flex flex-wrap gap-1">
              {DAY_NAMES.map((name, weekday) => {
                const active = days.has(weekday)
                return (
                  <button
                    key={weekday}
                    type="button"
                    aria-pressed={active}
                    onClick={() =>
                      setDays((current) => {
                        const next = new Set(current)
                        if (next.has(weekday)) next.delete(weekday)
                        else next.add(weekday)
                        return next
                      })
                    }
                    className={cn(
                      'h-7 rounded-md px-2 text-[11px] font-medium transition-colors',
                      active
                        ? 'bg-accent text-accent-fg'
                        : 'bg-surface-2 text-fg-muted hover:bg-surface-3',
                    )}
                  >
                    {name}
                  </button>
                )
              })}
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="From" htmlFor="mt-start">
              <TimeSelect
                id="mt-start"
                value={startTime}
                className="w-full"
                onChange={(next) => {
                  setStartTime(next)
                  if (toMinutes(next) >= toMinutes(endTime)) {
                    setEndTime(clockOf(toMinutes(next) + 60))
                  }
                }}
              />
            </Field>
            <Field label="Until" htmlFor="mt-end">
              <TimeSelect
                id="mt-end"
                value={endTime}
                minTime={startTime}
                className="w-full"
                onChange={setEndTime}
              />
            </Field>
          </div>

          <Field
            label="Add bookings to"
            htmlFor="mt-calendar"
            hint="Confirmed bookings appear on this calendar."
          >
            <Select value={calendarId} onValueChange={setCalendarId}>
              <SelectTrigger id="mt-calendar">
                <SelectValue placeholder="Pick a calendar" />
              </SelectTrigger>
              <SelectContent>
                {writable.map((calendar) => (
                  <SelectItem key={calendar.id} value={calendar.id}>
                    {calendar.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function clockOf(minutes: number): string {
  const capped = Math.min(minutes, 23 * 60 + 45)
  return `${String(Math.floor(capped / 60)).padStart(2, '0')}:${String(
    capped % 60,
  ).padStart(2, '0')}`
}

function toMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number)
  return (hours ?? 0) * 60 + (minutes ?? 0)
}
