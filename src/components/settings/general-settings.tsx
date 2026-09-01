'use client'

import * as React from 'react'
import type { UserSettings } from '@prisma/client'
import { timeZoneAbbreviation } from '@/lib/datetime'
import { defaultDurations } from '@/config/app'
import type { CalendarSummary } from '@/types/domain'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from '@/components/ui/controls'
import { ColorDot } from '@/components/ui/primitives'
import { TimeSelect } from '@/components/ui/time-select'
import { SettingsRow, SettingsSection } from './settings-nav'
import { allTimeZones, useSettingsSave } from './use-settings-save'

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export interface WorkingHoursRow {
  weekday: number
  startMinute: number
  endMinute: number
  enabled: boolean
}

export function GeneralSettings({
  settings,
  calendars,
  profile,
  workingHours,
}: {
  settings: UserSettings
  calendars: CalendarSummary[]
  profile: { name: string | null; timezone: string }
  workingHours: WorkingHoursRow[]
}) {
  const { save } = useSettingsSave()
  const [local, setLocal] = React.useState(settings)
  const [zone, setZone] = React.useState(profile.timezone)
  const [hours, setHours] = React.useState(workingHours)
  const zones = React.useMemo(() => allTimeZones(), [])

  const patch = (changes: Partial<UserSettings>) => {
    const previous = local
    setLocal({ ...local, ...changes })
    void save({ settings: changes as Record<string, unknown> }, {
      revert: () => setLocal(previous),
    })
  }

  const patchHours = (next: WorkingHoursRow[]) => {
    const previous = hours
    setHours(next)
    void save({ workingHours: next }, { revert: () => setHours(previous) })
  }

  const writable = calendars.filter((calendar) => !calendar.isReadOnly)

  return (
    <>
      <SettingsSection
        title="General"
        description="How dates and times are shown, and where new events go."
      >
        <SettingsRow
          label="Time zone"
          description="Everything is displayed in this zone. Events keep the zone they were created in."
          htmlFor="timezone"
        >
          <Select
            value={zone}
            onValueChange={(next) => {
              const previous = zone
              setZone(next)
              void save(
                { profile: { timezone: next } },
                { revert: () => setZone(previous), message: 'Time zone updated' },
              )
            }}
          >
            <SelectTrigger id="timezone" className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {zones.map((entry) => (
                <SelectItem key={entry} value={entry}>
                  {entry.replace(/_/g, ' ')}{' '}
                  <span className="text-fg-subtle">{timeZoneAbbreviation(entry)}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>

        <SettingsRow label="Time format" htmlFor="time-format">
          <Select
            value={local.timeFormat24h ? '24' : '12'}
            onValueChange={(value) => patch({ timeFormat24h: value === '24' })}
          >
            <SelectTrigger id="time-format" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="24">24 hour · 14:30</SelectItem>
              <SelectItem value="12">12 hour · 2:30 PM</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>

        <SettingsRow label="Week starts on" htmlFor="week-start">
          <Select
            value={String(local.weekStartsOn)}
            onValueChange={(value) => patch({ weekStartsOn: Number(value) })}
          >
            <SelectTrigger id="week-start" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Monday</SelectItem>
              <SelectItem value="0">Sunday</SelectItem>
              <SelectItem value="6">Saturday</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>

        <SettingsRow label="Date format" htmlFor="date-format">
          <Select
            value={local.dateFormat}
            onValueChange={(value) => patch({ dateFormat: value })}
          >
            <SelectTrigger id="date-format" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="dd MMM yyyy">31 Aug 2026</SelectItem>
              <SelectItem value="dd/MM/yyyy">31/08/2026</SelectItem>
              <SelectItem value="MM/dd/yyyy">08/31/2026</SelectItem>
              <SelectItem value="yyyy-MM-dd">2026-08-31</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>

        <SettingsRow
          label="Default calendar"
          description="Where new events go unless you pick another."
          htmlFor="default-calendar"
        >
          <Select
            value={local.defaultCalendarId ?? ''}
            onValueChange={(value) => patch({ defaultCalendarId: value })}
          >
            <SelectTrigger id="default-calendar" className="w-52">
              <SelectValue placeholder="Pick a calendar" />
            </SelectTrigger>
            <SelectContent>
              {writable.map((calendar) => (
                <SelectItem key={calendar.id} value={calendar.id}>
                  <span className="flex items-center gap-2">
                    <ColorDot color={calendar.color} />
                    {calendar.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>

        <SettingsRow label="Default event length" htmlFor="default-duration">
          <Select
            value={String(local.defaultDuration)}
            onValueChange={(value) => patch({ defaultDuration: Number(value) })}
          >
            <SelectTrigger id="default-duration" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {defaultDurations.map((minutes) => (
                <SelectItem key={minutes} value={String(minutes)}>
                  {minutes < 60 ? `${minutes} minutes` : `${minutes / 60} hour${minutes === 60 ? '' : 's'}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection
        title="Working hours"
        description="Used for scheduling, focus time and the times you offer for meetings."
      >
        {hours.map((row) => (
          <SettingsRow
            key={row.weekday}
            label={WEEKDAYS[row.weekday]!}
            htmlFor={`working-${row.weekday}`}
          >
            <div className="flex items-center gap-2">
              {row.enabled ? (
                <>
                  <TimeSelect
                    value={clock(row.startMinute)}
                    use24h={local.timeFormat24h}
                    onChange={(next) =>
                      patchHours(
                        hours.map((entry) =>
                          entry.weekday === row.weekday
                            ? {
                                ...entry,
                                startMinute: clockToMinutes(next),
                                // Keep the day coherent: a start pushed past the
                                // end would otherwise save an impossible day.
                                endMinute: Math.max(
                                  entry.endMinute,
                                  clockToMinutes(next) + 15,
                                ),
                              }
                            : entry,
                        ),
                      )
                    }
                    aria-label={`${WEEKDAYS[row.weekday]} start`}
                  />
                  <span className="text-fg-subtle">–</span>
                  <TimeSelect
                    value={clock(row.endMinute)}
                    use24h={local.timeFormat24h}
                    minTime={clock(row.startMinute)}
                    onChange={(next) =>
                      patchHours(
                        hours.map((entry) =>
                          entry.weekday === row.weekday
                            ? { ...entry, endMinute: clockToMinutes(next) }
                            : entry,
                        ),
                      )
                    }
                    aria-label={`${WEEKDAYS[row.weekday]} end`}
                  />
                </>
              ) : (
                <span className="text-[13px] text-fg-subtle">Not working</span>
              )}
              <Switch
                id={`working-${row.weekday}`}
                checked={row.enabled}
                onCheckedChange={(enabled) =>
                  patchHours(
                    hours.map((entry) =>
                      entry.weekday === row.weekday ? { ...entry, enabled } : entry,
                    ),
                  )
                }
                aria-label={`${WEEKDAYS[row.weekday]} enabled`}
              />
            </div>
          </SettingsRow>
        ))}
      </SettingsSection>

      <SettingsSection
        title="Scheduling"
        description="How much room to leave around meetings, and how travel time is estimated."
      >
        <SettingsRow
          label="Minimum gap between events"
          description="Below this, the composer warns you that things are tight."
          htmlFor="buffer"
        >
          <Select
            value={String(local.bufferMinutes)}
            onValueChange={(value) => patch({ bufferMinutes: Number(value) })}
          >
            <SelectTrigger id="buffer" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[0, 5, 10, 15, 30, 45, 60].map((minutes) => (
                <SelectItem key={minutes} value={String(minutes)}>
                  {minutes === 0 ? 'No gap' : `${minutes} minutes`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>

        <SettingsRow
          label="Average travel speed"
          description="Travel time is a rough estimate from the straight-line distance, not a route."
          htmlFor="speed"
        >
          <div className="flex items-center gap-2">
            <Input
              id="speed"
              type="number"
              min={5}
              max={200}
              value={local.travelSpeedKmh}
              onChange={(nativeEvent) =>
                setLocal({ ...local, travelSpeedKmh: Number(nativeEvent.target.value) })
              }
              onBlur={() => patch({ travelSpeedKmh: local.travelSpeedKmh })}
              className="w-20"
            />
            <span className="text-[13px] text-fg-muted">km/h</span>
          </div>
        </SettingsRow>
      </SettingsSection>
    </>
  )
}

/** Minutes since midnight -> "HH:mm". */
function clock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(
    minutes % 60,
  ).padStart(2, '0')}`
}

function clockToMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number)
  return (hours ?? 0) * 60 + (minutes ?? 0)
}
