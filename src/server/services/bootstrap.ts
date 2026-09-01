import 'server-only'
import type { CalendarKind } from '@prisma/client'
import { prisma } from '@/lib/db'
import { slugify } from '@/lib/utils'

/**
 * Everything a brand-new account needs before the UI can render something
 * meaningful: a default calendar, a small set of categories, a working week and
 * a settings row. Idempotent — safe to call again after a partial failure.
 */

interface DefaultCalendar {
  name: string
  color: string
  kind: CalendarKind
  sortOrder: number
  isDefault?: boolean
  isReadOnly?: boolean
}

const DEFAULT_CALENDARS: DefaultCalendar[] = [
  { name: 'Personal', color: '#4f46e5', kind: 'PRIMARY', isDefault: true, sortOrder: 0 },
  { name: 'Work', color: '#0369a1', kind: 'SECONDARY', sortOrder: 1 },
  { name: 'Family', color: '#15803d', kind: 'SECONDARY', sortOrder: 2 },
  {
    name: 'Birthdays',
    color: '#be123c',
    kind: 'BIRTHDAYS',
    sortOrder: 3,
    isReadOnly: true,
  },
  { name: 'Holidays', color: '#b45309', kind: 'HOLIDAYS', sortOrder: 4, isReadOnly: true },
]

/**
 * Starting categories. Not hard-coded as the only possibilities — they are rows
 * the user can rename, recolour, delete or add to.
 */
const DEFAULT_CATEGORIES = [
  { name: 'Work', color: '#0369a1', icon: 'Briefcase' },
  { name: 'Personal', color: '#4f46e5', icon: 'User' },
  { name: 'Family', color: '#15803d', icon: 'Home' },
  { name: 'Travel', color: '#0d7d74', icon: 'Plane' },
  { name: 'Sport', color: '#4d7c0f', icon: 'Dumbbell' },
  { name: 'Study', color: '#7c3aed', icon: 'GraduationCap' },
  { name: 'Meeting', color: '#c2410c', icon: 'Users' },
  { name: 'Focus', color: '#475569', icon: 'Target' },
]

export async function bootstrapUser(userId: string, timezone?: string) {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.calendar.count({ where: { userId } })

    if (existing === 0) {
      for (const calendar of DEFAULT_CALENDARS) {
        await tx.calendar.create({
          data: { ...calendar, userId, timezone: timezone ?? null },
        })
      }
    }

    const categoryCount = await tx.category.count({ where: { userId } })
    if (categoryCount === 0) {
      await tx.category.createMany({
        data: DEFAULT_CATEGORIES.map((c) => ({ ...c, userId, isSystem: true })),
      })
    }

    const hoursCount = await tx.workingHours.count({ where: { userId } })
    if (hoursCount === 0) {
      await tx.workingHours.createMany({
        data: Array.from({ length: 7 }, (_, weekday) => ({
          userId,
          weekday,
          startMinute: 9 * 60,
          endMinute: 17 * 60,
          // Weekends off by default; the user can switch them on in Settings.
          enabled: weekday !== 0 && weekday !== 6,
        })),
      })
    }

    const settings = await tx.userSettings.findUnique({ where: { userId } })
    if (!settings) {
      const defaultCalendar = await tx.calendar.findFirst({
        where: { userId, isDefault: true },
        select: { id: true },
      })
      await tx.userSettings.create({
        data: { userId, defaultCalendarId: defaultCalendar?.id ?? null },
      })
    }

    const projectCount = await tx.taskProject.count({ where: { userId } })
    if (projectCount === 0) {
      await tx.taskProject.createMany({
        data: [
          { userId, name: 'Inbox', color: '#64748b', sortOrder: 0 },
          { userId, name: 'Work', color: '#0369a1', sortOrder: 1 },
          { userId, name: 'Personal', color: '#4f46e5', sortOrder: 2 },
        ],
      })
    }
  })

  await ensureUsername(userId)
}

/**
 * Booking links need a stable public handle. Derived from the user's name or
 * email, with a numeric suffix on collision.
 */
export async function ensureUsername(userId: string): Promise<string> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { username: true, name: true, email: true },
  })
  if (user.username) return user.username

  const base = slugify(user.name || user.email.split('@')[0]!) || 'user'
  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`
    const taken = await prisma.user.findUnique({
      where: { username: candidate },
      select: { id: true },
    })
    if (!taken) {
      await prisma.user.update({ where: { id: userId }, data: { username: candidate } })
      return candidate
    }
  }

  const fallback = `${base}-${userId.slice(0, 8)}`
  await prisma.user.update({ where: { id: userId }, data: { username: fallback } })
  return fallback
}

/** Creates a default 30-minute meeting type the first time /meetings is opened. */
export async function ensureDefaultMeetingType(userId: string) {
  const count = await prisma.meetingType.count({ where: { userId } })
  if (count > 0) return

  const calendar = await prisma.calendar.findFirst({
    where: { userId, isDefault: true },
    select: { id: true },
  })

  const created = await prisma.meetingType.create({
    data: {
      userId,
      slug: '30min',
      title: '30 minute meeting',
      description: 'A half hour to talk things through.',
      durationMinutes: 30,
      targetCalendarId: calendar?.id ?? null,
    },
  })

  await prisma.meetingTypeAvailability.createMany({
    data: [1, 2, 3, 4, 5].map((weekday) => ({
      meetingTypeId: created.id,
      weekday,
      startMinute: 9 * 60,
      endMinute: 17 * 60,
    })),
  })
}
