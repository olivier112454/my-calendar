import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { ok, parseBody, route } from '@/lib/api'
import { assertSameOrigin, ensureSettings, requireUser } from '@/lib/auth'
import {
  updateProfile,
  updateSettings,
  updateWorkingHours,
} from '@/server/services/settings'
import { syncDutchHolidays } from '@/server/services/holidays'
import { todayKey } from '@/lib/datetime'

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #4f46e5')

const patchSchema = z.object({
  settings: z
    .object({
      dateFormat: z.string().max(40).optional(),
      timeFormat24h: z.boolean().optional(),
      weekStartsOn: z.number().int().min(0).max(6).optional(),
      defaultCalendarId: z.string().uuid().nullish(),
      defaultDuration: z.number().int().min(5).max(480).optional(),
      defaultEventColor: hexColor.nullish(),

      theme: z.enum(['LIGHT', 'DARK', 'SYSTEM']).optional(),
      accentColor: hexColor.optional(),
      eventDensity: z.enum(['COMFORTABLE', 'COMPACT']).optional(),
      compactMode: z.boolean().optional(),
      reduceMotion: z.boolean().optional(),

      showWeekends: z.boolean().optional(),
      showWeekNumbers: z.boolean().optional(),
      showDeclinedEvents: z.boolean().optional(),
      showBirthdays: z.boolean().optional(),
      showHolidays: z.boolean().optional(),
      /** Null turns school holidays off and removes the ones already placed. */
      schoolHolidayRegion: z.enum(['NOORD', 'MIDDEN', 'ZUID']).nullish(),
      showCompletedTasks: z.boolean().optional(),
      secondaryTimezones: z.array(z.string()).max(4).optional(),
      dayStartHour: z.number().int().min(0).max(23).optional(),
      dayEndHour: z.number().int().min(1).max(24).optional(),

      bufferMinutes: z.number().int().min(0).max(120).optional(),
      travelDetourFactor: z.number().min(1).max(3).optional(),
      travelSpeedKmh: z.number().int().min(5).max(200).optional(),
      autoDeclineOnFocus: z.boolean().optional(),
      focusBlockMinutes: z.number().int().min(15).max(480).optional(),

      browserNotifications: z.boolean().optional(),
      emailNotifications: z.boolean().optional(),
      defaultReminders: z
        .array(z.number().int().min(0).max(40320))
        .max(5, 'Five reminders on one event is already a lot')
        .optional(),
      dailyAgendaEmail: z.boolean().optional(),
      dailyAgendaHour: z.number().int().min(0).max(23).optional(),
    })
    .optional(),

  profile: z
    .object({
      name: z.string().trim().min(1).max(120).optional(),
      timezone: z.string().max(60).optional(),
      locale: z.string().max(10).optional(),
      username: z
        .string()
        .trim()
        .min(3, 'At least three characters')
        .max(40)
        .regex(/^[a-z0-9-]+$/, 'Lower-case letters, numbers and dashes only')
        .optional(),
    })
    .optional(),

  workingHours: z
    .array(
      z.object({
        weekday: z.number().int().min(0).max(6),
        startMinute: z.number().int().min(0).max(1440),
        endMinute: z.number().int().min(0).max(1440),
        enabled: z.boolean(),
      }),
    )
    .max(7)
    .optional(),
})

export const GET = route(async () => {
  const user = await requireUser()
  const settings = await ensureSettings(user.id)
  return ok({ settings, profile: { name: user.name, timezone: user.timezone } })
})

export const PATCH = route(async (request: NextRequest) => {
  await assertSameOrigin()
  const user = await requireUser()
  const input = await parseBody(request, patchSchema)

  if (input.settings) await updateSettings(user.id, input.settings)

  // Changing the region has to move events, not just a flag, so the sync runs
  // here rather than lazily on the next calendar read: the user who just chose
  // "Zuid" is looking at the calendar a second later.
  if (input.settings && 'schoolHolidayRegion' in input.settings) {
    const thisYear = Number(todayKey(user.timezone).slice(0, 4))
    await syncDutchHolidays(user.id, {
      region: input.settings.schoolHolidayRegion ?? null,
      // This year and the next two: far enough to plan a summer around,
      // near enough that the published table still covers it.
      fromYear: thisYear,
      toYear: thisYear + 2,
      timezone: user.timezone,
    })
  }
  if (input.profile) await updateProfile(user.id, input.profile)
  if (input.workingHours) await updateWorkingHours(user.id, input.workingHours)

  return ok({ updated: true })
})
