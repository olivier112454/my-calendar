'use client'

import * as React from 'react'
import { toast } from 'sonner'
import {
  Bell,
  CalendarDays,
  Check,
  Copy,
  Link2,
  Lock,
  MapPin,
  Paperclip,
  Pencil,
  Repeat,
  Tag,
  Trash2,
  Users,
  Video,
  X,
} from 'lucide-react'
import { cn, initials } from '@/lib/utils'
import { api } from '@/lib/client/api'
import { formatDuration, formatEventRange, formatRelative } from '@/lib/datetime'
import { reminderPresets } from '@/config/app'
import type { AttendeeResponse, EventDetail } from '@/types/domain'
import { Button } from '@/components/ui/button'
import { Badge, ColorDot, Separator } from '@/components/ui/primitives'
import { SegmentedControl, Tooltip } from '@/components/ui/controls'
import { ListSkeleton } from '@/components/ui/states'
import { RecurrenceScopeDialog } from './recurrence-scope-dialog'
import { useNow } from '@/hooks/use-now'

/**
 * Details for one event, rendered inside the right panel or a bottom sheet.
 *
 * Opening an event never navigates: the calendar stays on screen behind this,
 * so you keep the context you clicked from. Only editing moves to a dialog.
 */

export function EventDetailsPanel({
  eventId,
  occurrenceStart,
  timezone,
  use24h,
  onEdit,
  onClose,
  onChanged,
}: {
  eventId: string
  occurrenceStart?: string | null
  timezone: string
  use24h: boolean
  onEdit: (event: EventDetail) => void
  onClose: () => void
  onChanged: () => void
}) {
  const [event, setEvent] = React.useState<EventDetail | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [deletePrompt, setDeletePrompt] = React.useState(false)
  const now = useNow()

  React.useEffect(() => {
    let active = true
    // eslint-disable-next-line react-hooks/set-state-in-effect -- flags the in-flight load for the selected event
    setLoading(true)
    setError(null)

    const query = occurrenceStart
      ? `?occurrenceStart=${encodeURIComponent(occurrenceStart)}`
      : ''

    api
      .get<EventDetail>(`/api/events/${eventId}${query}`)
      .then((data) => {
        if (active) setEvent(data)
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : 'Could not load this event.')
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [eventId, occurrenceStart])

  const remove = async (scope: 'this' | 'following' | 'all') => {
    if (!event) return
    try {
      await api.delete(`/api/events/${event.eventId}`, {
        scope,
        occurrenceStart: event.occurrenceStart ?? undefined,
      })
      toast.success('Event deleted')
      onChanged()
      onClose()
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : 'That event could not be deleted.',
      )
    }
  }

  const duplicate = async () => {
    if (!event) return
    try {
      await api.post(`/api/events/${event.eventId}/duplicate`)
      toast.success('Event duplicated')
      onChanged()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Could not duplicate.')
    }
  }

  const setRsvp = async (response: AttendeeResponse) => {
    if (!event) return
    const previous = event.myResponse
    setEvent({ ...event, myResponse: response })
    try {
      await api.post(`/api/events/${event.eventId}/rsvp`, { response })
      onChanged()
    } catch {
      setEvent({ ...event, myResponse: previous })
      toast.error('Could not save your response.')
    }
  }

  const copyLink = async () => {
    if (!event) return
    const url = `${window.location.origin}/calendar?event=${event.eventId}`
    try {
      await navigator.clipboard.writeText(url)
      toast.success('Link copied')
    } catch {
      toast.error('Could not copy the link.')
    }
  }

  if (loading) return <ListSkeleton rows={6} className="p-4" />

  if (error || !event) {
    return (
      <div className="p-4">
        <p className="text-[13px] text-fg-muted">{error ?? 'Event not found.'}</p>
        <Button variant="ghost" size="sm" className="mt-2" onClick={onClose}>
          Close
        </Button>
      </div>
    )
  }

  const start = new Date(event.start)
  const end = new Date(event.end)
  const durationMinutes = Math.round((end.getTime() - start.getTime()) / 60_000)
  const isPast = now > 0 && end.getTime() < now
  const isUpcoming = now > 0 && start.getTime() > now

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start gap-2 px-4 pt-4">
        <span
          aria-hidden="true"
          className="mt-1.5 size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: event.color }}
        />
        <h2 className="min-w-0 flex-1 break-user-text text-[15px] font-semibold leading-snug text-fg">
          {event.title}
        </h2>
        <Button variant="ghost" size="iconSm" onClick={onClose} aria-label="Close details">
          <X />
        </Button>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
        <section className="space-y-2">
          <Row icon={<CalendarDays />}>
            <span className="text-[13px] text-fg">
              {formatEventRange(start, end, timezone, use24h, event.allDay)}
            </span>
            <span className="block text-xs text-fg-subtle">
              {event.allDay ? 'All day' : formatDuration(durationMinutes)}
              {isUpcoming ? ` · starts ${formatRelative(start)}` : null}
              {isPast ? ' · ended' : null}
            </span>
          </Row>

          {event.isRecurring && event.recurrenceSummary ? (
            <Row icon={<Repeat />}>
              <span className="text-[13px] text-fg">{event.recurrenceSummary}</span>
              {event.isException ? (
                <span className="block text-xs text-fg-subtle">
                  This occurrence differs from the series.
                </span>
              ) : null}
            </Row>
          ) : null}

          <Row icon={<ColorDot color={event.calendarColor} size={12} />}>
            <span className="text-[13px] text-fg">{event.calendarName}</span>
            {event.accountEmail ? (
              <span className="block text-xs text-fg-subtle">{event.accountEmail}</span>
            ) : null}
          </Row>

          {event.categoryName ? (
            <Row icon={<Tag />}>
              <span className="text-[13px] text-fg">{event.categoryName}</span>
            </Row>
          ) : null}

          {event.location ? (
            <Row icon={<MapPin />}>
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                  event.location,
                )}`}
                target="_blank"
                rel="noreferrer noopener"
                className="text-[13px] text-fg underline-offset-2 hover:underline"
              >
                {event.location}
              </a>
              {event.travelTimeMinutes ? (
                <span className="block text-xs text-fg-subtle">
                  About {formatDuration(event.travelTimeMinutes)} of travel
                </span>
              ) : null}
            </Row>
          ) : null}

          {event.meetingUrl ? (
            <Row icon={<Video />}>
              <a
                href={event.meetingUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="text-[13px] text-accent underline-offset-2 hover:underline"
              >
                Join {providerLabel(event.meetingProvider)}
              </a>
            </Row>
          ) : null}

          {event.visibility === 'PRIVATE' ? (
            <Row icon={<Lock />}>
              <span className="text-[13px] text-fg">Private event</span>
            </Row>
          ) : null}
        </section>

        {event.attendees.length > 0 ? (
          <>
            <Separator />
            <section className="space-y-2">
              <h3 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
                <Users className="size-3" aria-hidden="true" />
                {event.attendees.length} guest
                {event.attendees.length === 1 ? '' : 's'}
                <span className="ml-auto font-normal normal-case tracking-normal">
                  {summariseResponses(event)}
                </span>
              </h3>
              <ul className="space-y-1">
                {event.attendees.map((attendee) => (
                  <li key={attendee.id} className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[10px] font-medium text-fg-muted"
                    >
                      {initials(attendee.name ?? attendee.email)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-fg">
                        {attendee.name ?? attendee.email}
                      </span>
                      {attendee.isOrganizer ? (
                        <span className="text-[11px] text-fg-subtle">Organiser</span>
                      ) : null}
                    </span>
                    <ResponseBadge response={attendee.response} />
                  </li>
                ))}
              </ul>

              {event.myResponse ? (
                <div className="pt-1">
                  <p className="pb-1 text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
                    Going?
                  </p>
                  <SegmentedControl
                    size="sm"
                    label="Your response"
                    value={event.myResponse}
                    onValueChange={(response) => void setRsvp(response as AttendeeResponse)}
                    options={[
                      { value: 'ACCEPTED', label: 'Yes' },
                      { value: 'TENTATIVE', label: 'Maybe' },
                      { value: 'DECLINED', label: 'No' },
                    ]}
                  />
                </div>
              ) : null}
            </section>
          </>
        ) : null}

        {event.description ? (
          <>
            <Separator />
            <section>
              <p className="whitespace-pre-wrap break-user-text text-[13px] leading-relaxed text-fg-muted">
                {event.description}
              </p>
            </section>
          </>
        ) : null}

        {event.reminders.length > 0 ? (
          <>
            <Separator />
            <section className="space-y-1">
              <h3 className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
                Reminders
              </h3>
              <ul className="space-y-0.5">
                {event.reminders.map((reminder) => (
                  <li
                    key={reminder.id}
                    className="flex items-center gap-2 text-[13px] text-fg-muted"
                  >
                    <Bell className="size-3.5 text-fg-subtle" aria-hidden="true" />
                    {reminderLabel(reminder.minutesBefore)}
                    <span className="text-fg-subtle">
                      · {reminder.method.toLowerCase()}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </>
        ) : null}

        {event.attachments.length > 0 ? (
          <>
            <Separator />
            <section className="space-y-1">
              <h3 className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
                Attachments
              </h3>
              <ul className="space-y-0.5">
                {event.attachments.map((attachment) => (
                  <li key={attachment.id}>
                    <a
                      href={attachment.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="flex items-center gap-2 rounded-md px-1 py-1 text-[13px] text-fg transition-colors hover:bg-surface-2"
                    >
                      <Paperclip className="size-3.5 shrink-0 text-fg-subtle" aria-hidden="true" />
                      <span className="truncate">{attachment.name}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          </>
        ) : null}
      </div>

      <div className="flex items-center gap-1 border-t border-border px-3 py-2.5">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onEdit(event)}
          disabled={event.readOnly}
        >
          <Pencil />
          Edit
        </Button>
        <Tooltip content="Duplicate">
          <Button
            variant="ghost"
            size="icon"
            onClick={duplicate}
            disabled={event.readOnly}
            aria-label="Duplicate event"
          >
            <Copy />
          </Button>
        </Tooltip>
        <Tooltip content="Copy link">
          <Button variant="ghost" size="icon" onClick={copyLink} aria-label="Copy link">
            <Link2 />
          </Button>
        </Tooltip>
        <div className="flex-1" />
        <Tooltip content={event.readOnly ? 'This calendar is read-only' : 'Delete'}>
          <Button
            variant="dangerGhost"
            size="icon"
            aria-label="Delete event"
            disabled={event.readOnly}
            onClick={() => {
              // A single event deletes straight away — the undo toast is the
              // safety net. A series needs the scope question first.
              if (event.isRecurring) setDeletePrompt(true)
              else void remove('all')
            }}
          >
            <Trash2 />
          </Button>
        </Tooltip>
      </div>

      <RecurrenceScopeDialog
        open={deletePrompt}
        onOpenChange={setDeletePrompt}
        action="delete"
        onChoose={(scope) => {
          setDeletePrompt(false)
          void remove(scope)
        }}
      />
    </div>
  )
}

function Row({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <span
        aria-hidden="true"
        className="mt-0.5 flex size-4 shrink-0 items-center justify-center text-fg-subtle [&_svg]:size-3.5"
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

function ResponseBadge({ response }: { response: AttendeeResponse }) {
  if (response === 'NEEDS_ACTION') {
    return (
      <Badge tone="neutral" className="shrink-0">
        Awaiting
      </Badge>
    )
  }
  const tone = response === 'ACCEPTED' ? 'success' : response === 'DECLINED' ? 'danger' : 'warning'
  const label = response === 'ACCEPTED' ? 'Yes' : response === 'DECLINED' ? 'No' : 'Maybe'
  return (
    <Badge tone={tone} className="shrink-0">
      {response === 'ACCEPTED' ? <Check aria-hidden="true" /> : null}
      {label}
    </Badge>
  )
}

function summariseResponses(event: EventDetail): string {
  const yes = event.attendees.filter((a) => a.response === 'ACCEPTED').length
  const no = event.attendees.filter((a) => a.response === 'DECLINED').length
  const waiting = event.attendees.filter((a) => a.response === 'NEEDS_ACTION').length
  const parts: string[] = []
  if (yes) parts.push(`${yes} yes`)
  if (no) parts.push(`${no} no`)
  if (waiting) parts.push(`${waiting} awaiting`)
  return parts.join(', ')
}

function reminderLabel(minutes: number): string {
  const preset = reminderPresets.find((entry) => entry.minutes === minutes)
  return preset?.label ?? `${formatDuration(minutes)} before`
}

function providerLabel(provider: EventDetail['meetingProvider']): string {
  switch (provider) {
    case 'GOOGLE_MEET':
      return 'Google Meet'
    case 'MICROSOFT_TEAMS':
      return 'Microsoft Teams'
    case 'ZOOM':
      return 'Zoom'
    case 'PHONE':
      return 'call'
    default:
      return 'meeting'
  }
}

export { cn }
