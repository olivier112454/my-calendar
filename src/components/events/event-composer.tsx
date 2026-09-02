'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { AlertTriangle, ChevronDown, Eye, Scissors, Video, Wand2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { api, qs } from '@/lib/client/api'
import { describeRule, customToRule, presetToRule } from '@/lib/recurrence'
import { parseEventText } from '@/lib/nlp/parse-event'
import type { Impact } from '@/server/services/impact'
import type {
  CalendarSummary,
  CategorySummary,
  ConflictWarning,
  EventDetail,
  EventDraft,
} from '@/types/domain'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { Dialog, DialogContent } from '@/components/ui/overlay'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/controls'
import { Field } from '@/components/ui/primitives'
import {
  CalendarSelect,
  CategorySelect,
  ColorField,
  DateTimeFields,
  GuestsField,
  RecurrenceField,
  RemindersField,
} from './event-fields'
import {
  applyDraft,
  blankForm,
  formFromEvent,
  shiftEndWithStart,
  toCreateInput,
  toInstants,
  toUpdateInput,
  validate,
  type EventFormSeed,
  type EventFormState,
  type FormErrors,
} from './use-event-form'
import { RecurrenceScopeDialog } from './recurrence-scope-dialog'

/**
 * Create and edit dialog.
 *
 * Progressive disclosure rather than two separate screens: the quick form is
 * what most events need, and "More options" reveals the rest in place. Nothing
 * is hidden behind a second modal, so the mental model stays "one event, one
 * form".
 */

export interface EventComposerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  calendars: CalendarSummary[]
  categories?: CategorySummary[]
  timezone: string
  use24h: boolean
  defaultCalendarId?: string | null
  defaultReminders?: number[]
  /** Prefilled values for a new event. */
  seed?: EventFormSeed
  /** Set to edit an existing event instead of creating one. */
  editing?: EventDetail | null
  /** A parsed draft to preload, from quick create or an email. */
  draft?: EventDraft | null
  onSaved?: () => void
  contactSuggestions?: { name: string; email: string; avatarUrl?: string | null }[]
}

export function EventComposer({
  open,
  onOpenChange,
  calendars,
  categories = [],
  timezone,
  use24h,
  defaultCalendarId,
  defaultReminders,
  seed,
  editing,
  draft,
  onSaved,
  contactSuggestions = [],
}: EventComposerProps) {
  const [state, setState] = React.useState<EventFormState>(() =>
    blankForm({ ...seed, timezone, defaultReminders }),
  )
  const [errors, setErrors] = React.useState<FormErrors>({})
  const [expanded, setExpanded] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [scopePrompt, setScopePrompt] = React.useState(false)
  const [conflicts, setConflicts] = React.useState<ConflictWarning[]>([])
  // What this slot costs the rest of the day, which is a different question
  // from whether it clashes — and usually the more interesting one.
  const [impact, setImpact] = React.useState<Impact | null>(null)
  const [dismissedParse, setDismissedParse] = React.useState(false)
  const titleRef = React.useRef<HTMLInputElement>(null)

  // Reset whenever the dialog opens, so a previous draft never leaks into a new
  // event and an edit always starts from the saved values.
  React.useEffect(() => {
    if (!open) return
    let next = editing
      ? formFromEvent(editing)
      : blankForm({
          ...seed,
          timezone,
          defaultReminders,
          calendarId: seed?.calendarId ?? defaultCalendarId ?? calendars[0]?.id,
        })
    if (draft) next = applyDraft(next, draft, timezone)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets the form to the event being edited when the dialog opens
    setState(next)
    setErrors({})
    setConflicts([])
    setDismissedParse(false)
    setExpanded(Boolean(editing) || Boolean(draft))
    // Focus lands on the title: the field someone always fills in.
    requestAnimationFrame(() => titleRef.current?.focus())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const update = React.useCallback(
    (patch: Partial<EventFormState>) => setState((prev) => ({ ...prev, ...patch })),
    [],
  )

  /* Conflicts refresh as the times change, debounced so typing a time does not
     fire a request per keystroke. */
  const { start, end } = React.useMemo(() => toInstants(state), [state])
  const startIso = start.toISOString()
  const endIso = end.toISOString()

  React.useEffect(() => {
    if (!open || state.allDay || end <= start) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resets the form to the event being edited when the dialog opens
      setConflicts([])
      setImpact(null)
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(() => {
      api
        .get<ConflictWarning[]>(
          `/api/events/conflicts${qs({
            start: startIso,
            end: endIso,
            excludeEventId: editing?.eventId,
          })}`,
          { signal: controller.signal },
        )
        .then(setConflicts)
        .catch(() => {
          // A failed conflict check must never block saving; stay quiet.
        })

      // Fired alongside rather than after: the two are independent, and the
      // heavier of the two failing must not take the other's warnings with it.
      api
        .get<Impact | null>(
          `/api/events/impact${qs({
            start: startIso,
            end: endIso,
            excludeEventId: editing?.eventId,
          })}`,
          { signal: controller.signal },
        )
        .then(setImpact)
        .catch(() => {})
    }, 400)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, startIso, endIso, state.allDay, editing?.eventId])

  const recurrenceSummary = React.useMemo(() => {
    const rule =
      state.recurrencePreset === 'custom'
        ? customToRule(state.customRecurrence, start, state.timezone)
        : presetToRule(state.recurrencePreset, start, state.timezone)
    return describeRule(rule)
  }, [state.recurrencePreset, state.customRecurrence, start, state.timezone])

  const selectedCalendar = calendars.find((calendar) => calendar.id === state.calendarId)

  // Keeps a parsed event the same length as the one currently in the form.
  const currentDurationMinutes = Math.max(
    15,
    Math.round((end.getTime() - start.getTime()) / 60_000) || 60,
  )

  /*
   * Natural language in the title field.
   *
   * Typing "Lunch with Mark tomorrow at 13" offers to fill in the date, time,
   * location and guests. It is only ever an offer: nothing is applied until the
   * user presses it, and the chip spells out exactly what was understood, so a
   * misread is obvious before it costs anything.
   */
  const parsed = React.useMemo(() => {
    if (editing || dismissedParse) return null
    const text = state.title.trim()
    if (text.length < 6) return null

    const draft = parseEventText(text, {
      timezone: state.timezone,
      defaultDurationMinutes: currentDurationMinutes,
    })
    // Only worth offering when it found something the form does not already have.
    const foundSomething =
      (draft.matched?.length ?? 0) > 0 && draft.title.trim() !== text
    return foundSomething && draft.confidence >= 0.4 ? draft : null
  }, [state.title, state.timezone, currentDurationMinutes, editing, dismissedParse])

  const applyParsed = () => {
    if (!parsed) return
    setState((prev) => applyDraft({ ...prev, title: parsed.title }, parsed, prev.timezone))
    setExpanded(true)
  }

  const save = async (scope: 'this' | 'following' | 'all' = 'all') => {
    const found = validate(state)
    setErrors(found)
    if (Object.keys(found).length > 0) {
      toast.error(Object.values(found)[0])
      return
    }

    setSaving(true)
    try {
      if (editing) {
        await api.patch(
          `/api/events/${editing.eventId}`,
          toUpdateInput(state, scope, editing.occurrenceStart ?? undefined),
        )
        toast.success('Event updated')
      } else {
        await api.post('/api/events', toCreateInput(state))
        toast.success('Event created')
      }
      onOpenChange(false)
      onSaved?.()
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : 'That event could not be saved.',
      )
    } finally {
      setSaving(false)
    }
  }

  const handleSave = () => {
    // Editing one instance of a series needs an explicit choice about scope.
    if (editing?.isRecurring) setScopePrompt(true)
    else void save('all')
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          title={editing ? 'Edit event' : 'New event'}
          description={
            editing
              ? undefined
              : 'Give it a title and a time. Everything else is optional.'
          }
          width={expanded ? 'lg' : 'md'}
          onOpenAutoFocus={(nativeEvent) => nativeEvent.preventDefault()}
          footer={
            <>
              {!editing ? (
                <Button
                  variant="ghost"
                  onClick={() => setExpanded((value) => !value)}
                  aria-expanded={expanded}
                >
                  <ChevronDown
                    className={cn('transition-transform', expanded && 'rotate-180')}
                  />
                  {expanded ? 'Fewer options' : 'More options'}
                </Button>
              ) : null}
              <div className="flex-1" />
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button variant="primary" loading={saving} onClick={handleSave}>
                {editing ? 'Save changes' : 'Create event'}
              </Button>
            </>
          }
        >
          <div className={cn('grid gap-4', expanded && 'sm:grid-cols-2')}>
            <div className="space-y-4">
              <Field label="Title" htmlFor="event-title" error={errors.title} required>
                <Input
                  ref={titleRef}
                  id="event-title"
                  value={state.title}
                  onChange={(nativeEvent) => update({ title: nativeEvent.target.value })}
                  onKeyDown={(nativeEvent) => {
                    // Enter saves from the title field — the fastest possible path.
                    if (nativeEvent.key === 'Enter' && !nativeEvent.shiftKey) {
                      nativeEvent.preventDefault()
                      handleSave()
                    }
                  }}
                  placeholder="Add a title"
                  aria-invalid={Boolean(errors.title)}
                  className="h-9 text-[15px] font-medium"
                />
                {parsed ? (
                  <div className="flex items-start gap-2 rounded-md border border-border bg-surface-2 px-2 py-1.5">
                    <Wand2
                      className="mt-0.5 size-3.5 shrink-0 text-fg-subtle"
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-fg">
                        <span className="font-medium">{parsed.title}</span>
                        <span className="text-fg-muted"> · {parsed.matched?.join(' · ')}</span>
                      </p>
                    </div>
                    <Button variant="secondary" size="sm" onClick={applyParsed}>
                      Use this
                    </Button>
                    <Button
                      variant="ghost"
                      size="iconSm"
                      onClick={() => setDismissedParse(true)}
                      aria-label="Ignore the suggestion"
                    >
                      <X />
                    </Button>
                  </div>
                ) : null}
              </Field>

              <DateTimeFields
                state={state}
                use24h={use24h}
                error={errors.end}
                onChange={(patch) => {
                  if (patch.startDayKey !== undefined || patch.startTime !== undefined) {
                    setState((prev) =>
                      shiftEndWithStart(
                        prev,
                        patch.startDayKey ?? prev.startDayKey,
                        patch.startTime ?? prev.startTime,
                      ),
                    )
                  } else {
                    update(patch)
                  }
                }}
              />

              {/* Which calendar it goes in, and what it is about — two
                  different questions, so they sit side by side rather than one
                  standing in for the other. */}
              <div className="grid gap-4 sm:grid-cols-2">
                <CalendarSelect
                  calendars={calendars}
                  value={state.calendarId}
                  onChange={(calendarId) => update({ calendarId })}
                  error={errors.calendarId}
                />
                <CategorySelect
                  categories={categories}
                  value={state.categoryId}
                  onChange={(categoryId) => update({ categoryId })}
                />
              </div>

              {impact && impact.messages.length > 0 ? (
                <CostNotice impact={impact} />
              ) : null}
              {conflicts.length > 0 ? (
                <ConflictNotice conflicts={conflicts} />
              ) : null}
            </div>

            {expanded ? (
              <div className="space-y-4">
                <Field label="Location" htmlFor="event-location">
                  <Input
                    id="event-location"
                    value={state.location}
                    onChange={(nativeEvent) =>
                      update({ location: nativeEvent.target.value })
                    }
                    placeholder="Add a place or address"
                  />
                </Field>

                <Field label="Video meeting" htmlFor="event-meeting">
                  <Select
                    value={state.meetingProvider}
                    onValueChange={(provider) =>
                      update({
                        meetingProvider: provider as EventFormState['meetingProvider'],
                      })
                    }
                  >
                    <SelectTrigger id="event-meeting">
                      <span className="flex items-center gap-2 truncate">
                        <Video className="size-3.5 shrink-0 text-fg-subtle" aria-hidden="true" />
                        <SelectValue />
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NONE">No video call</SelectItem>
                      <SelectItem value="GOOGLE_MEET">Google Meet</SelectItem>
                      <SelectItem value="MICROSOFT_TEAMS">Microsoft Teams</SelectItem>
                      <SelectItem value="ZOOM">Zoom</SelectItem>
                      <SelectItem value="CUSTOM">Custom link</SelectItem>
                      <SelectItem value="PHONE">Phone call</SelectItem>
                      <SelectItem value="IN_PERSON">In person</SelectItem>
                    </SelectContent>
                  </Select>
                  {state.meetingProvider === 'CUSTOM' ? (
                    <Input
                      className="mt-1.5"
                      value={state.meetingUrl}
                      onChange={(nativeEvent) =>
                        update({ meetingUrl: nativeEvent.target.value })
                      }
                      placeholder="https://…"
                      aria-label="Meeting link"
                      aria-invalid={Boolean(errors.meetingUrl)}
                    />
                  ) : null}
                  {errors.meetingUrl ? (
                    <p role="alert" className="text-xs text-danger">
                      {errors.meetingUrl}
                    </p>
                  ) : null}
                  {state.meetingProvider === 'GOOGLE_MEET' ? (
                    <p className="text-xs text-fg-subtle">
                      A Meet link is added when the event syncs to Google.
                    </p>
                  ) : null}
                </Field>

                <GuestsField
                  guests={state.guests}
                  onChange={(guests) => update({ guests })}
                  suggestions={contactSuggestions}
                  error={errors.guests}
                />

                <RecurrenceField
                  preset={state.recurrencePreset}
                  custom={state.customRecurrence}
                  summary={recurrenceSummary}
                  onPresetChange={(recurrencePreset) => update({ recurrencePreset })}
                  onCustomChange={(customRecurrence) => update({ customRecurrence })}
                />

                <RemindersField
                  reminders={state.reminders}
                  onChange={(reminders) => update({ reminders })}
                />

                <Field label="Description" htmlFor="event-description">
                  <Textarea
                    id="event-description"
                    value={state.description}
                    onChange={(nativeEvent) =>
                      update({ description: nativeEvent.target.value })
                    }
                    placeholder="Notes, agenda, links…"
                    rows={3}
                  />
                </Field>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Shows as" htmlFor="event-transparency">
                    <Select
                      value={state.transparency}
                      onValueChange={(transparency) =>
                        update({ transparency: transparency as 'BUSY' | 'FREE' })
                      }
                    >
                      <SelectTrigger id="event-transparency">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="BUSY">Busy</SelectItem>
                        <SelectItem value="FREE">Free</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>

                  <Field label="Visibility" htmlFor="event-visibility">
                    <Select
                      value={state.visibility}
                      onValueChange={(visibility) =>
                        update({
                          visibility: visibility as EventFormState['visibility'],
                        })
                      }
                    >
                      <SelectTrigger id="event-visibility">
                        <span className="flex items-center gap-2 truncate">
                          <Eye className="size-3.5 shrink-0 text-fg-subtle" aria-hidden="true" />
                          <SelectValue />
                        </span>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="DEFAULT">Calendar default</SelectItem>
                        <SelectItem value="PUBLIC">Public</SelectItem>
                        <SelectItem value="PRIVATE">Private</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>

                <ColorField
                  value={state.color}
                  calendarColor={selectedCalendar?.color ?? '#4f46e5'}
                  onChange={(color) => update({ color })}
                />
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      <RecurrenceScopeDialog
        open={scopePrompt}
        onOpenChange={setScopePrompt}
        action="edit"
        onChoose={(scope) => {
          setScopePrompt(false)
          void save(scope)
        }}
      />
    </>
  )
}

function ConflictNotice({ conflicts }: { conflicts: ConflictWarning[] }) {
  const blocking = conflicts.filter((conflict) => conflict.severity === 'blocking')
  const heading =
    blocking.length > 0
      ? 'You already have something at this time'
      : 'This is a tight fit'

  return (
    <div
      role="status"
      className={cn(
        'space-y-1.5 rounded-lg border px-3 py-2.5',
        blocking.length > 0
          ? 'border-danger/30 bg-danger-soft'
          : 'border-warning/30 bg-warning-soft',
      )}
    >
      <p className="flex items-center gap-1.5 text-[13px] font-medium text-fg">
        <AlertTriangle
          className={cn('size-3.5', blocking.length > 0 ? 'text-danger' : 'text-warning')}
          aria-hidden="true"
        />
        {heading}
      </p>
      <ul className="space-y-0.5">
        {conflicts.map((conflict) => (
          <li key={`${conflict.otherEventId}-${conflict.kind}`} className="text-xs text-fg-muted">
            {conflict.message}
          </li>
        ))}
      </ul>
      <p className="text-xs text-fg-subtle">You can save anyway.</p>
    </div>
  )
}

/**
 * What this slot costs the day around it.
 *
 * Kept visually quieter than a conflict, and above it, because it is the softer
 * of the two claims: nothing here is wrong, it is just worth knowing before you
 * commit. It never argues — there is no "pick another time" button — because
 * the person choosing knows things the calendar does not.
 */
function CostNotice({ impact }: { impact: Impact }) {
  return (
    <div
      role="status"
      className="space-y-1.5 rounded-lg border border-border bg-surface-2 px-3 py-2.5"
    >
      <p className="flex items-center gap-1.5 text-[13px] font-medium text-fg">
        <Scissors className="size-3.5 text-fg-subtle" aria-hidden="true" />
        What this costs your day
      </p>
      <ul className="space-y-0.5">
        {impact.messages.map((message) => (
          <li key={message} className="text-xs leading-relaxed text-fg-muted">
            {message}
          </li>
        ))}
      </ul>
    </div>
  )
}
