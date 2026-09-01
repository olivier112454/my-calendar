'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  ArrowRight,
  Bell,
  CalendarDays,
  Check,
  Clock,
  Globe,
  Mail,
  Sparkles,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/lib/client/api'
import { appConfig } from '@/config/app'
import { systemTimeZone, timeZoneAbbreviation } from '@/lib/datetime'
import { ReminderPicker } from '@/components/settings/reminder-picker'
import { TimeSelect } from '@/components/ui/time-select'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from '@/components/ui/controls'
import { Wordmark, GoogleMark } from '@/components/brand'
import { allTimeZones } from '@/components/settings/use-settings-save'

/**
 * The first-run flow.
 *
 * Four decisions, in the order they matter: what time zone you are in, whether
 * to bring in an existing calendar, when you work, and how you want to be
 * reminded. Everything after the time zone can be skipped and changed later,
 * and the progress bar says how much is left.
 */

interface WorkingHoursRow {
  weekday: number
  startMinute: number
  endMinute: number
  enabled: boolean
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function OnboardingFlow({
  initialStep,
  user,
  settings,
  workingHours,
  googleConfigured,
  connected,
}: {
  initialStep: number
  user: { name: string | null; email: string; timezone: string }
  settings: {
    defaultReminders: number[]
    weekStartsOn: number
    timeFormat24h: boolean
  }
  workingHours: WorkingHoursRow[]
  googleConfigured: boolean
  connected: { calendar: boolean; mail: boolean }
}) {
  const router = useRouter()
  const [step, setStep] = React.useState(initialStep)
  const [zone, setZone] = React.useState(user.timezone)
  const [hours, setHours] = React.useState(workingHours)
  const [reminders, setReminders] = React.useState(settings.defaultReminders)
  const [browserNotifications, setBrowserNotifications] = React.useState(false)
  const [finishing, setFinishing] = React.useState(false)

  const zones = React.useMemo(() => allTimeZones(), [])
  const detected = React.useMemo(() => systemTimeZone(), [])

  // Offer the detected zone on arrival rather than making it a question.
  React.useEffect(() => {
    if (user.timezone === 'Europe/Amsterdam' && detected !== user.timezone) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- adopts the time zone detected from the device after mount
      setZone(detected)
    }
  }, [detected, user.timezone])

  const steps = [
    { key: 'welcome', label: 'Welcome' },
    { key: 'timezone', label: 'Time zone' },
    { key: 'connect', label: 'Connect' },
    { key: 'hours', label: 'Working hours' },
    { key: 'notifications', label: 'Reminders' },
  ]

  const finish = async () => {
    setFinishing(true)
    try {
      await api.patch('/api/settings', {
        profile: { timezone: zone },
        settings: {
          defaultReminders: reminders,
          browserNotifications,
        },
        workingHours: hours,
      })
      await api.post('/api/onboarding/complete')
      router.push('/today')
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : 'Could not save your setup.',
      )
      setFinishing(false)
    }
  }

  const next = () => setStep((current) => Math.min(current + 1, steps.length - 1))
  const back = () => setStep((current) => Math.max(current - 1, 0))

  const requestNotificationPermission = async () => {
    if (typeof Notification === 'undefined') return
    const result = await Notification.requestPermission()
    setBrowserNotifications(result === 'granted')
    if (result !== 'granted') {
      toast.error('Your browser blocked notifications. You can turn them on later.')
    }
  }

  return (
    <main className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-lg items-center justify-between px-6 py-6">
        <Wordmark />
        {step > 0 ? (
          <button
            type="button"
            onClick={finish}
            className="text-xs text-fg-subtle transition-colors hover:text-fg-muted"
          >
            Skip setup
          </button>
        ) : null}
      </header>

      <div className="mx-auto flex w-full max-w-lg flex-1 flex-col px-6 pb-10">
        {/* Progress: a bar plus "step 3 of 5", so it is legible either way. */}
        {step > 0 ? (
          <div className="mb-8">
            <div
              className="flex gap-1"
              role="progressbar"
              aria-valuemin={1}
              aria-valuemax={steps.length - 1}
              aria-valuenow={step}
              aria-label={`Step ${step} of ${steps.length - 1}: ${steps[step]?.label}`}
            >
              {steps.slice(1).map((entry, index) => (
                <span
                  key={entry.key}
                  className={cn(
                    'h-1 flex-1 rounded-full transition-colors',
                    index + 1 <= step ? 'bg-accent' : 'bg-surface-3',
                  )}
                />
              ))}
            </div>
            <p className="mt-2 text-[11px] text-fg-subtle">
              Step {step} of {steps.length - 1} · {steps[step]?.label}
            </p>
          </div>
        ) : null}

        <div className="flex flex-1 flex-col justify-center">
          {step === 0 ? (
            <Step
              icon={<Sparkles />}
              title={`Welcome${user.name ? `, ${user.name.split(' ')[0]}` : ''}`}
              description={`${appConfig.name} keeps your calendar, your tasks and the appointments hiding in your mail in one place. Four quick questions and you are set up.`}
            >
              <Button variant="primary" size="lg" block onClick={next}>
                Get started
                <ArrowRight />
              </Button>
              <p className="text-center text-xs text-fg-subtle">
                Takes about a minute. Everything can be changed later.
              </p>
            </Step>
          ) : null}

          {step === 1 ? (
            <Step
              icon={<Globe />}
              title="Which time zone are you in?"
              description="Everything is shown in this zone. Events keep the zone they were created in, so travelling never shifts your calendar."
            >
              <Select value={zone} onValueChange={setZone}>
                <SelectTrigger className="h-10" aria-label="Your time zone">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {zones.map((entry) => (
                    <SelectItem key={entry} value={entry}>
                      {entry.replace(/_/g, ' ')}{' '}
                      <span className="text-fg-subtle">
                        {timeZoneAbbreviation(entry)}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {detected && detected !== zone ? (
                <button
                  type="button"
                  onClick={() => setZone(detected)}
                  className="text-left text-xs text-accent underline-offset-2 hover:underline"
                >
                  Use {detected.replace(/_/g, ' ')}, detected from this device
                </button>
              ) : null}

              <StepButtons onBack={back} onNext={next} />
            </Step>
          ) : null}

          {step === 2 ? (
            <Step
              icon={<CalendarDays />}
              title="Bring in what you already use"
              description="Connect Google and your existing events appear here, with changes flowing both ways. Each permission is asked for separately — take only what you want."
            >
              <div className="space-y-2">
                <ConnectRow
                  icon={<CalendarDays />}
                  title="Google Calendar"
                  description="Read and write your events. Two-way sync."
                  connected={connected.calendar}
                  disabled={!googleConfigured}
                  href="/api/auth/google/start?scopes=calendar&next=/onboarding?step=2"
                />
                <ConnectRow
                  icon={<Mail />}
                  title="Gmail"
                  description="Spot meetings, reservations and flights. Message bodies are never stored."
                  connected={connected.mail}
                  disabled={!googleConfigured}
                  href="/api/auth/google/start?scopes=gmail&next=/onboarding?step=2"
                />
              </div>

              {!googleConfigured ? (
                <p className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs leading-relaxed text-fg-muted">
                  Google is not configured on this server yet, so these are
                  unavailable. Everything else works without it — you can connect
                  later from Settings.
                </p>
              ) : null}

              <StepButtons
                onBack={back}
                onNext={next}
                nextLabel={
                  connected.calendar || connected.mail ? 'Continue' : 'Skip for now'
                }
              />
            </Step>
          ) : null}

          {step === 3 ? (
            <Step
              icon={<Clock />}
              title="When do you work?"
              description="Used to suggest times for tasks, protect focus time, and decide what to offer when someone books a meeting with you."
            >
              <ul className="space-y-1.5">
                {hours.map((row) => (
                  <li
                    key={row.weekday}
                    className="flex items-center justify-between gap-3 rounded-md px-1 py-1"
                  >
                    <span className="w-20 shrink-0 text-[13px] text-fg">
                      {DAY_SHORT[row.weekday]}
                    </span>
                    <div className="flex flex-1 items-center gap-2">
                      {row.enabled ? (
                        <>
                          <TimeSelect
                            value={clock(row.startMinute)}
                            use24h={settings.timeFormat24h}
                            onChange={(next) =>
                              setHours(
                                hours.map((entry) =>
                                  entry.weekday === row.weekday
                                    ? {
                                        ...entry,
                                        startMinute: toMinutes(next),
                                        endMinute: Math.max(
                                          entry.endMinute,
                                          toMinutes(next) + 15,
                                        ),
                                      }
                                    : entry,
                                ),
                              )
                            }
                            aria-label={`${DAY_NAMES[row.weekday]} start`}
                          />
                          <span className="text-fg-subtle">–</span>
                          <TimeSelect
                            value={clock(row.endMinute)}
                            use24h={settings.timeFormat24h}
                            minTime={clock(row.startMinute)}
                            onChange={(next) =>
                              setHours(
                                hours.map((entry) =>
                                  entry.weekday === row.weekday
                                    ? { ...entry, endMinute: toMinutes(next) }
                                    : entry,
                                ),
                              )
                            }
                            aria-label={`${DAY_NAMES[row.weekday]} end`}
                          />
                        </>
                      ) : (
                        <span className="text-[13px] text-fg-subtle">Not working</span>
                      )}
                    </div>
                    <Switch
                      checked={row.enabled}
                      onCheckedChange={(enabled) =>
                        setHours(
                          hours.map((entry) =>
                            entry.weekday === row.weekday ? { ...entry, enabled } : entry,
                          ),
                        )
                      }
                      aria-label={`${DAY_NAMES[row.weekday]} enabled`}
                    />
                  </li>
                ))}
              </ul>

              <StepButtons onBack={back} onNext={next} />
            </Step>
          ) : null}

          {step === 4 ? (
            <Step
              icon={<Bell />}
              title="How should we remind you?"
              description="A default reminder is added to new events. You can change it per event, and turn all of this off later."
            >
              <div className="space-y-1.5">
                <span className="block text-xs font-medium text-fg-muted">
                  Default reminders
                </span>
                <ReminderPicker
                  value={reminders}
                  onChange={setReminders}
                  idPrefix="onboarding-reminder"
                />
              </div>

              <div className="flex items-start justify-between gap-4 rounded-lg border border-border px-3 py-2.5">
                <div>
                  <p className="text-[13px] font-medium text-fg">
                    Browser notifications
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-fg-muted">
                    A desktop notification when a reminder is due, even when the
                    tab is in the background.
                  </p>
                </div>
                {browserNotifications ? (
                  <span className="flex items-center gap-1 text-xs font-medium text-success">
                    <Check className="size-3.5" aria-hidden="true" />
                    On
                  </span>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={requestNotificationPermission}
                  >
                    Allow
                  </Button>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Button variant="ghost" onClick={back}>
                  Back
                </Button>
                <Button
                  variant="primary"
                  block
                  loading={finishing}
                  onClick={finish}
                >
                  Open my calendar
                  <ArrowRight />
                </Button>
              </div>
            </Step>
          ) : null}
        </div>
      </div>
    </main>
  )
}

function Step({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-4">
      <span
        aria-hidden="true"
        className="flex size-10 items-center justify-center rounded-lg bg-accent-soft text-accent [&_svg]:size-5"
      >
        {icon}
      </span>
      <div className="space-y-1.5">
        <h1 className="text-balance text-[22px] font-semibold tracking-[-0.02em] text-fg">
          {title}
        </h1>
        <p className="text-[13px] leading-relaxed text-fg-muted">{description}</p>
      </div>
      <div className="space-y-3 pt-1">{children}</div>
    </section>
  )
}

function StepButtons({
  onBack,
  onNext,
  nextLabel = 'Continue',
}: {
  onBack: () => void
  onNext: () => void
  nextLabel?: string
}) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <Button variant="ghost" onClick={onBack}>
        Back
      </Button>
      <Button variant="primary" block onClick={onNext}>
        {nextLabel}
        <ArrowRight />
      </Button>
    </div>
  )
}

function ConnectRow({
  icon,
  title,
  description,
  connected,
  disabled,
  href,
}: {
  icon: React.ReactNode
  title: string
  description: string
  connected: boolean
  disabled: boolean
  href: string
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border px-3 py-2.5">
      <span
        aria-hidden="true"
        className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-surface-2 text-fg-subtle [&_svg]:size-4"
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-fg">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-fg-muted">{description}</p>
      </div>
      {connected ? (
        <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-success">
          <Check className="size-3.5" aria-hidden="true" />
          Connected
        </span>
      ) : (
        <Button variant="secondary" size="sm" disabled={disabled} asChild={!disabled}>
          {disabled ? (
            <>
              <GoogleMark />
              Connect
            </>
          ) : (
            <a href={href}>
              <GoogleMark />
              Connect
            </a>
          )}
        </Button>
      )}
    </div>
  )
}

function clock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

function toMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number)
  return (hours ?? 0) * 60 + (minutes ?? 0)
}
