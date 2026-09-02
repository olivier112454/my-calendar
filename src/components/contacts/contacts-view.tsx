'use client'

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import {
  Building2,
  CalendarPlus,
  Contact as ContactIcon,
  Hourglass,
  Mail,
  Phone,
  Plus,
  RefreshCw,
  Star,
  Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { api, qs } from '@/lib/client/api'
import { debounce } from '@/lib/utils'
import { formatEventRange, formatRelative } from '@/lib/datetime'
import type { CalendarSummary, ContactSummary } from '@/types/domain'
import type { ContactDetail } from '@/server/services/contacts'
import type { OverdueContact } from '@/server/services/cadence'
import { Button } from '@/components/ui/button'
import { Input, InputWithIcon, Textarea } from '@/components/ui/input'
import { Avatar, Badge, Field } from '@/components/ui/primitives'
import { Dialog, DialogContent, Sheet, SheetContent } from '@/components/ui/overlay'
import { EmptyState, ListSkeleton } from '@/components/ui/states'
import { EventComposer } from '@/components/events/event-composer'
import { useAppShell } from '@/components/layout/app-shell-context'
import { NotificationBell } from '@/components/layout/notification-bell'

/**
 * Contacts.
 *
 * An address book is only half of it: the detail panel answers "when did I last
 * see this person and when do I next" from the calendar, which is the reason to
 * open the page at all.
 */
export function ContactsView({
  initialContacts,
  calendars,
  timezone,
  use24h,
  canSync,
  defaultCalendarId,
  overdue,
}: {
  initialContacts: ContactSummary[]
  calendars: CalendarSummary[]
  timezone: string
  use24h: boolean
  canSync: boolean
  defaultCalendarId: string | null
  overdue: OverdueContact[]
}) {
  const router = useRouter()
  const { categories } = useAppShell()
  const searchParams = useSearchParams()

  const [contacts, setContacts] = React.useState(initialContacts)
  const [query, setQuery] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [syncing, setSyncing] = React.useState(false)
  const [openId, setOpenId] = React.useState<string | null>(null)
  const [createOpen, setCreateOpen] = React.useState(
    searchParams.get('new') === '1',
  )
  const [meetingWith, setMeetingWith] = React.useState<ContactDetail | null>(null)

  const search = React.useMemo(
    () =>
      debounce((term: string) => {
        setLoading(true)
        api
          .get<ContactSummary[]>(`/api/contacts${qs({ search: term || undefined })}`)
          .then(setContacts)
          .catch(() => toast.error('Could not search contacts.'))
          .finally(() => setLoading(false))
      }, 250),
    [],
  )

  React.useEffect(() => {
    search(query)
    return () => search.cancel()
  }, [query, search])

  const syncFromProvider = async () => {
    setSyncing(true)
    try {
      const result = await api.post<{ imported: number }>('/api/contacts/sync')
      toast.success(`Imported ${result.imported} contact${result.imported === 1 ? '' : 's'}`)
      router.refresh()
      search(query)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Could not import contacts.')
    } finally {
      setSyncing(false)
    }
  }

  const toggleFavourite = async (contact: ContactSummary) => {
    const next = !contact.isFavorite
    setContacts((current) =>
      current.map((entry) =>
        entry.id === contact.id ? { ...entry, isFavorite: next } : entry,
      ),
    )
    try {
      await api.patch(`/api/contacts/${contact.id}`, { isFavorite: next })
    } catch {
      setContacts(initialContacts)
      toast.error('Could not update that contact.')
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface px-4 py-2">
        <h1 className="text-[15px] font-semibold tracking-[-0.01em] text-fg">Contacts</h1>
        <span className="text-[13px] text-fg-subtle">{contacts.length}</span>

        <div className="ml-auto flex items-center gap-1.5">
          <NotificationBell />
          <InputWithIcon
            icon={<ContactIcon />}
            value={query}
            onChange={(nativeEvent) => setQuery(nativeEvent.target.value)}
            placeholder="Search people"
            className="w-48"
            aria-label="Search contacts"
          />
          {canSync ? (
            <Button
              variant="ghost"
              size="icon"
              onClick={syncFromProvider}
              disabled={syncing}
              aria-label="Import from Google Contacts"
              title="Import from Google Contacts"
            >
              <RefreshCw className={cn(syncing && 'animate-spin')} />
            </Button>
          ) : null}
          <Button variant="primary" size="md" onClick={() => setCreateOpen(true)}>
            <Plus />
            <span className="hidden sm:inline">Add</span>
          </Button>
        </div>
      </header>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-4 py-3">
          {overdue.length > 0 && !query ? (
            <OutOfTouch people={overdue} onOpen={setOpenId} />
          ) : null}
          {loading && contacts.length === 0 ? (
            <ListSkeleton rows={8} />
          ) : contacts.length === 0 ? (
            <EmptyState
              icon={<ContactIcon />}
              title={query ? 'No matches' : 'No contacts yet'}
              description={
                query
                  ? `Nothing matches "${query}".`
                  : 'Add the people you meet, or import them from a connected account.'
              }
              action={
                <Button variant="secondary" size="sm" onClick={() => setCreateOpen(true)}>
                  Add a contact
                </Button>
              }
            />
          ) : (
            <ul className="divide-y divide-border">
              {contacts.map((contact) => (
                <li key={contact.id}>
                  <div className="group flex items-center gap-3 py-2">
                    <button
                      type="button"
                      onClick={() => setOpenId(contact.id)}
                      className="flex min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-1 text-left transition-colors hover:bg-surface-2"
                    >
                      <Avatar
                        name={contact.name}
                        src={contact.avatarUrl}
                        size="md"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-fg">
                          {contact.name}
                        </span>
                        <span className="flex flex-wrap items-center gap-x-2.5 text-[11px] text-fg-muted">
                          {contact.email ? (
                            <span className="truncate">{contact.email}</span>
                          ) : null}
                          {contact.organization ? (
                            <span className="inline-flex items-center gap-1">
                              <Building2 className="size-3" aria-hidden="true" />
                              {contact.organization}
                            </span>
                          ) : null}
                        </span>
                      </span>
                      {contact.meetingCount ? (
                        <Badge tone="neutral">
                          {contact.meetingCount} meeting
                          {contact.meetingCount === 1 ? '' : 's'}
                        </Badge>
                      ) : null}
                    </button>

                    <Button
                      variant="ghost"
                      size="iconSm"
                      onClick={() => toggleFavourite(contact)}
                      aria-label={
                        contact.isFavorite
                          ? `Remove ${contact.name} from favourites`
                          : `Add ${contact.name} to favourites`
                      }
                      aria-pressed={contact.isFavorite}
                    >
                      <Star
                        className={cn(
                          contact.isFavorite
                            ? 'fill-warning text-warning'
                            : 'text-fg-subtle opacity-0 transition-opacity group-hover:opacity-100',
                        )}
                      />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <ContactDetailSheet
        contactId={openId}
        open={openId !== null}
        onOpenChange={(open) => !open && setOpenId(null)}
        timezone={timezone}
        use24h={use24h}
        onChanged={() => {
          search(query)
          router.refresh()
        }}
        onScheduleMeeting={(contact) => {
          setOpenId(null)
          setMeetingWith(contact)
        }}
      />

      <CreateContactDialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open)
          if (!open) router.replace('/contacts', { scroll: false })
        }}
        onCreated={() => {
          search(query)
          router.refresh()
        }}
      />

      <EventComposer
        open={meetingWith !== null}
        onOpenChange={(open) => !open && setMeetingWith(null)}
        calendars={calendars}
        categories={categories}
        timezone={timezone}
        use24h={use24h}
        defaultCalendarId={defaultCalendarId}
        seed={
          meetingWith
            ? {
                title: `Meeting with ${meetingWith.name.split(' ')[0]}`,
                guests: meetingWith.email
                  ? [{ email: meetingWith.email, name: meetingWith.name }]
                  : [],
              }
            : undefined
        }
        onSaved={() => {
          setMeetingWith(null)
          router.refresh()
        }}
      />
    </div>
  )
}

function ContactDetailSheet({
  contactId,
  open,
  onOpenChange,
  timezone,
  use24h,
  onChanged,
  onScheduleMeeting,
}: {
  contactId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  timezone: string
  use24h: boolean
  onChanged: () => void
  onScheduleMeeting: (contact: ContactDetail) => void
}) {
  const [contact, setContact] = React.useState<ContactDetail | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [notes, setNotes] = React.useState('')

  React.useEffect(() => {
    if (!open || !contactId) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads the selected contact, and resets the form when the dialog opens
    setLoading(true)
    api
      .get<ContactDetail>(`/api/contacts/${contactId}`)
      .then((data) => {
        setContact(data)
        setNotes(data.notes ?? '')
      })
      .catch(() => toast.error('Could not open that contact.'))
      .finally(() => setLoading(false))
  }, [open, contactId])

  const remove = async () => {
    if (!contact) return
    try {
      await api.delete(`/api/contacts/${contact.id}`)
      toast.success('Contact deleted')
      onOpenChange(false)
      onChanged()
    } catch {
      toast.error('Could not delete that contact.')
    }
  }

  const saveNotes = async () => {
    if (!contact || notes === (contact.notes ?? '')) return
    try {
      await api.patch(`/api/contacts/${contact.id}`, { notes })
      onChanged()
    } catch {
      toast.error('Could not save the notes.')
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        title={contact?.name ?? 'Contact'}
        footer={
          contact ? (
            <>
              <Button variant="dangerGhost" size="sm" onClick={remove}>
                <Trash2 />
                Delete
              </Button>
              <div className="flex-1" />
              <Button
                variant="primary"
                size="sm"
                onClick={() => onScheduleMeeting(contact)}
              >
                <CalendarPlus />
                Schedule meeting
              </Button>
            </>
          ) : undefined
        }
      >
        {loading || !contact ? (
          <ListSkeleton rows={6} />
        ) : (
          <div className="space-y-5">
            <div className="flex items-center gap-3">
              <Avatar name={contact.name} src={contact.avatarUrl} size="lg" />
              <div className="min-w-0">
                <p className="truncate text-[15px] font-semibold text-fg">
                  {contact.name}
                </p>
                {contact.jobTitle || contact.organization ? (
                  <p className="truncate text-[13px] text-fg-muted">
                    {[contact.jobTitle, contact.organization].filter(Boolean).join(' · ')}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="space-y-1.5">
              {contact.email ? (
                <a
                  href={`mailto:${contact.email}`}
                  className="flex items-center gap-2 rounded-md px-1 py-1 text-[13px] text-fg transition-colors hover:bg-surface-2"
                >
                  <Mail className="size-3.5 text-fg-subtle" aria-hidden="true" />
                  {contact.email}
                </a>
              ) : null}
              {contact.phone ? (
                <a
                  href={`tel:${contact.phone}`}
                  className="flex items-center gap-2 rounded-md px-1 py-1 text-[13px] text-fg transition-colors hover:bg-surface-2"
                >
                  <Phone className="size-3.5 text-fg-subtle" aria-hidden="true" />
                  {contact.phone}
                </a>
              ) : null}
            </div>

            <dl className="grid grid-cols-3 gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2.5">
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-fg-subtle">
                  Meetings
                </dt>
                <dd className="text-[13px] font-medium tabular-nums text-fg">
                  {contact.meetingCount ?? 0}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-fg-subtle">
                  Last met
                </dt>
                <dd className="text-[13px] font-medium text-fg">
                  {contact.lastMetAt
                    ? formatRelative(new Date(contact.lastMetAt))
                    : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-fg-subtle">
                  Next
                </dt>
                <dd className="text-[13px] font-medium text-fg">
                  {contact.nextMeetingAt
                    ? formatRelative(new Date(contact.nextMeetingAt))
                    : '—'}
                </dd>
              </div>
            </dl>

            {contact.upcoming.length > 0 ? (
              <section>
                <h3 className="mb-1 text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
                  Upcoming
                </h3>
                <ul className="space-y-0.5">
                  {contact.upcoming.map((event) => (
                    <li key={event.occurrenceId} className="text-[13px]">
                      <span className="font-medium text-fg">{event.title}</span>
                      <span className="block text-[11px] text-fg-muted">
                        {formatEventRange(
                          new Date(event.start),
                          new Date(event.end),
                          timezone,
                          use24h,
                          event.allDay,
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {contact.previous.length > 0 ? (
              <section>
                <h3 className="mb-1 text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
                  Previous meetings
                </h3>
                <ul className="space-y-0.5">
                  {contact.previous.map((event) => (
                    <li key={event.occurrenceId} className="text-[13px]">
                      <span className="text-fg">{event.title}</span>
                      <span className="block text-[11px] text-fg-muted">
                        {formatEventRange(
                          new Date(event.start),
                          new Date(event.end),
                          timezone,
                          use24h,
                          event.allDay,
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {contact.emails.length > 0 ? (
              <section>
                <h3 className="mb-1 text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
                  Recent mail
                </h3>
                <ul className="space-y-1">
                  {contact.emails.map((entry) => (
                    <li key={entry.id} className="text-[13px]">
                      <span className="block truncate font-medium text-fg">
                        {entry.subject ?? '(no subject)'}
                      </span>
                      <span className="block text-[11px] text-fg-muted">
                        {formatRelative(new Date(entry.receivedAt))}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <Field label="Notes" htmlFor="contact-notes">
              <Textarea
                id="contact-notes"
                value={notes}
                onChange={(nativeEvent) => setNotes(nativeEvent.target.value)}
                onBlur={saveNotes}
                rows={3}
                placeholder="Anything worth remembering about this person"
              />
            </Field>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

function CreateContactDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}) {
  const [form, setForm] = React.useState({
    name: '',
    email: '',
    phone: '',
    organization: '',
    jobTitle: '',
  })
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- loads the selected contact, and resets the form when the dialog opens
      setForm({ name: '', email: '', phone: '', organization: '', jobTitle: '' })
      setError(null)
    }
  }, [open])

  const submit = async () => {
    if (!form.name.trim()) {
      setError('Give the contact a name')
      return
    }
    setSaving(true)
    try {
      await api.post('/api/contacts', {
        name: form.name.trim(),
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        organization: form.organization.trim() || null,
        jobTitle: form.jobTitle.trim() || null,
      })
      toast.success('Contact added')
      onOpenChange(false)
      onCreated()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add the contact.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="New contact"
        width="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={saving} onClick={submit}>
              Add contact
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Name" htmlFor="contact-name" error={error ?? undefined} required>
            <Input
              id="contact-name"
              value={form.name}
              onChange={(nativeEvent) => {
                setForm({ ...form, name: nativeEvent.target.value })
                setError(null)
              }}
              autoFocus
            />
          </Field>
          <Field label="Email" htmlFor="contact-email">
            <Input
              id="contact-email"
              type="email"
              value={form.email}
              onChange={(nativeEvent) => setForm({ ...form, email: nativeEvent.target.value })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Organisation" htmlFor="contact-org">
              <Input
                id="contact-org"
                value={form.organization}
                onChange={(nativeEvent) =>
                  setForm({ ...form, organization: nativeEvent.target.value })
                }
              />
            </Field>
            <Field label="Role" htmlFor="contact-role">
              <Input
                id="contact-role"
                value={form.jobTitle}
                onChange={(nativeEvent) =>
                  setForm({ ...form, jobTitle: nativeEvent.target.value })
                }
              />
            </Field>
          </div>
          <Field label="Phone" htmlFor="contact-phone">
            <Input
              id="contact-phone"
              type="tel"
              value={form.phone}
              onChange={(nativeEvent) => setForm({ ...form, phone: nativeEvent.target.value })}
            />
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The people who have quietly slipped.
 *
 * Deliberately phrased against each person's own rhythm rather than in bare
 * elapsed time: "usually every 2 weeks" is what makes eight weeks mean
 * something, and without it this would be the same useless "last contacted"
 * column every CRM already has.
 *
 * It is a short list, and it says nothing at all when there is not enough
 * history — a nagging list of everyone you have ever emailed gets ignored, and
 * then so does the one entry that mattered.
 */
function OutOfTouch({
  people,
  onOpen,
}: {
  people: OverdueContact[]
  onOpen: (contactId: string) => void
}) {
  return (
    <section
      aria-labelledby="out-of-touch"
      className="mb-4 rounded-lg border border-border bg-surface-2 px-3 py-2.5"
    >
      <h2
        id="out-of-touch"
        className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-fg-subtle"
      >
        <Hourglass className="size-3.5" aria-hidden="true" />
        Out of touch
      </h2>

      <ul className="space-y-0.5">
        {people.map((person) => (
          <li key={person.contactId}>
            <button
              type="button"
              onClick={() => onOpen(person.contactId)}
              className="flex w-full items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-surface"
            >
              <Avatar name={person.name ?? person.email} src={person.avatarUrl} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-fg">
                  {person.name ?? person.email}
                </span>
                <span className="block truncate text-[11px] text-fg-muted">
                  {describeGap(person.cadence.daysSince!)} — you usually meet{' '}
                  {describeCadence(person.cadence.typicalGapDays!)}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** "8 weeks ago", "5 months ago" — rounded to the unit a person would say. */
function describeGap(days: number): string {
  if (days < 14) return `Last met ${days} days ago`
  if (days < 70) return `Last met ${Math.round(days / 7)} weeks ago`
  return `Last met ${Math.round(days / 30)} months ago`
}

/** "every 2 weeks", "about every 3 months". */
function describeCadence(gapDays: number): string {
  if (gapDays <= 10) return `every ${Math.max(1, Math.round(gapDays))} days`
  if (gapDays < 60) return `every ${Math.round(gapDays / 7)} weeks`
  return `about every ${Math.round(gapDays / 30)} months`
}
