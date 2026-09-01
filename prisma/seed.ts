/**
 * Development seed.
 *
 * Produces a week that looks like a real working life — recurring stand-ups, a
 * multi-day trip, an all-day birthday, overlapping meetings, a couple of
 * conflicts — because a calendar that only ever holds three tidy events hides
 * exactly the layout bugs worth finding.
 *
 * Dates are generated relative to today, so the seed stays useful whenever it
 * is run. Safe to re-run: it clears the demo user's data first and never
 * touches any other account.
 */
import { PrismaClient, type Prisma } from '@prisma/client'
import { randomUUID } from 'node:crypto'

const prisma = new PrismaClient()

const DEMO_EMAIL = 'demo@dayflow.local'
const TZ = 'Europe/Amsterdam'

/** Local wall clock -> UTC instant, matching the app's own conversion. */
function at(dayOffset: number, hours: number, minutes = 0): Date {
  const base = new Date()
  base.setHours(0, 0, 0, 0)
  base.setDate(base.getDate() + dayOffset)
  base.setHours(hours, minutes, 0, 0)
  return base
}

function dayKey(dayOffset: number): string {
  const date = new Date()
  date.setDate(date.getDate() + dayOffset)
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

/** Offset to the coming Monday (0 if today is Monday). */
function mondayOffset(): number {
  const day = new Date().getDay()
  return day === 1 ? 0 : ((8 - day) % 7)
}

async function main() {
  console.log('Seeding development data…')

  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: {},
    create: {
      email: DEMO_EMAIL,
      name: 'Olivier Pinkster',
      username: 'olivier',
      timezone: TZ,
      onboardedAt: new Date(),
    },
  })

  // Start from a clean slate for this user only.
  await prisma.$transaction([
    prisma.event.deleteMany({ where: { userId: user.id } }),
    prisma.task.deleteMany({ where: { userId: user.id } }),
    prisma.contact.deleteMany({ where: { userId: user.id } }),
    prisma.notification.deleteMany({ where: { userId: user.id } }),
    prisma.emailReference.deleteMany({ where: { userId: user.id } }),
    prisma.booking.deleteMany({ where: { userId: user.id } }),
    prisma.meetingType.deleteMany({ where: { userId: user.id } }),
    prisma.calendar.deleteMany({ where: { userId: user.id } }),
    prisma.taskProject.deleteMany({ where: { userId: user.id } }),
    prisma.category.deleteMany({ where: { userId: user.id } }),
  ])

  /* ------------------------------------------------------------ settings */

  await prisma.userSettings.upsert({
    where: { userId: user.id },
    update: {},
    create: {
      userId: user.id,
      weekStartsOn: 1,
      timeFormat24h: true,
      secondaryTimezones: ['America/New_York'],
      showWeekNumbers: true,
    },
  })

  await prisma.workingHours.deleteMany({ where: { userId: user.id } })
  await prisma.workingHours.createMany({
    data: Array.from({ length: 7 }, (_, weekday) => ({
      userId: user.id,
      weekday,
      startMinute: 9 * 60,
      endMinute: 17 * 60 + 30,
      enabled: weekday >= 1 && weekday <= 5,
    })),
  })

  /* ----------------------------------------------------------- calendars */

  const calendarSpecs = [
    { name: 'Personal', color: '#4f46e5', kind: 'PRIMARY' as const, isDefault: true },
    { name: 'Work', color: '#0369a1', kind: 'SECONDARY' as const },
    { name: 'Family', color: '#15803d', kind: 'SECONDARY' as const },
    {
      name: 'Birthdays',
      color: '#be123c',
      kind: 'BIRTHDAYS' as const,
      isReadOnly: true,
    },
    { name: 'Holidays', color: '#b45309', kind: 'HOLIDAYS' as const, isReadOnly: true },
  ]

  const calendars: Record<string, string> = {}
  for (const [index, spec] of calendarSpecs.entries()) {
    const calendar = await prisma.calendar.create({
      data: { ...spec, userId: user.id, sortOrder: index, timezone: TZ },
    })
    calendars[spec.name] = calendar.id
  }

  await prisma.userSettings.update({
    where: { userId: user.id },
    data: { defaultCalendarId: calendars.Personal },
  })

  /* ---------------------------------------------------------- categories */

  const categorySpecs = [
    { name: 'Work', color: '#0369a1', icon: 'Briefcase' },
    { name: 'Personal', color: '#4f46e5', icon: 'User' },
    { name: 'Family', color: '#15803d', icon: 'Home' },
    { name: 'Travel', color: '#0d7d74', icon: 'Plane' },
    { name: 'Sport', color: '#4d7c0f', icon: 'Dumbbell' },
    { name: 'Study', color: '#7c3aed', icon: 'GraduationCap' },
    { name: 'Meeting', color: '#c2410c', icon: 'Users' },
    { name: 'Focus', color: '#475569', icon: 'Target' },
  ]
  const categories: Record<string, string> = {}
  for (const spec of categorySpecs) {
    const category = await prisma.category.create({
      data: { ...spec, userId: user.id, isSystem: true },
    })
    categories[spec.name] = category.id
  }

  /* ------------------------------------------------------------ contacts */

  const contactSpecs = [
    {
      name: 'Emma de Vries',
      email: 'emma.devries@example.com',
      organization: 'Northwind Maritime',
      jobTitle: 'Operations Lead',
      phone: '+31 6 1234 5678',
      isFavorite: true,
    },
    {
      name: 'James Whitfield',
      email: 'james@harbourworks.example',
      organization: 'Harbourworks',
      jobTitle: 'Technical Director',
    },
    {
      name: 'Sofia Marchetti',
      email: 'sofia.marchetti@example.it',
      organization: 'Porto Consulting',
      jobTitle: 'Naval Architect',
      isFavorite: true,
    },
    {
      name: 'Daan Bakker',
      email: 'daan.bakker@example.nl',
      organization: 'Bakker & Zn',
      jobTitle: 'Owner',
    },
    {
      name: 'Priya Nair',
      email: 'priya.nair@example.com',
      organization: 'Meridian Shipping',
      jobTitle: 'Fleet Manager',
    },
    {
      name: 'Lars Andersen',
      email: 'lars@nordport.example',
      organization: 'Nordport',
      jobTitle: 'Harbour Master',
    },
  ]

  const contacts: Record<string, string> = {}
  for (const spec of contactSpecs) {
    const contact = await prisma.contact.create({ data: { ...spec, userId: user.id } })
    contacts[spec.email] = contact.id
  }

  /* -------------------------------------------------------------- events */

  const monday = mondayOffset() - 7 // start in the previous week for history

  interface EventSpec {
    title: string
    calendar: string
    day: number
    start?: [number, number]
    end?: [number, number]
    allDay?: boolean
    days?: number
    category?: string
    location?: string
    description?: string
    rrule?: string
    guests?: string[]
    meeting?: 'GOOGLE_MEET' | 'ZOOM' | 'MICROSOFT_TEAMS'
    status?: 'CONFIRMED' | 'TENTATIVE'
    transparency?: 'BUSY' | 'FREE'
    kind?: 'EVENT' | 'FOCUS' | 'OUT_OF_OFFICE' | 'BIRTHDAY' | 'HOLIDAY'
    reminders?: number[]
  }

  const specs: EventSpec[] = [
    // --- recurring backbone -------------------------------------------
    {
      title: 'Team stand-up',
      calendar: 'Work',
      day: monday,
      start: [9, 30],
      end: [9, 45],
      rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
      category: 'Meeting',
      meeting: 'GOOGLE_MEET',
      guests: ['emma.devries@example.com', 'james@harbourworks.example'],
      reminders: [5],
    },
    {
      title: 'Focus block — deep work',
      calendar: 'Work',
      day: monday,
      start: [10, 0],
      end: [12, 0],
      rrule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR',
      kind: 'FOCUS',
      category: 'Focus',
      transparency: 'BUSY',
    },
    {
      title: 'Weekly review',
      calendar: 'Work',
      day: monday + 4,
      start: [16, 0],
      end: [17, 0],
      rrule: 'FREQ=WEEKLY;BYDAY=FR',
      category: 'Work',
    },
    {
      title: 'Padel',
      calendar: 'Personal',
      day: monday + 1,
      start: [19, 30],
      end: [21, 0],
      rrule: 'FREQ=WEEKLY;BYDAY=TU',
      category: 'Sport',
      location: 'Padel Arnhem, Meander 601, Arnhem',
    },

    // --- this week ------------------------------------------------------
    {
      title: 'Quarterly planning',
      calendar: 'Work',
      day: 0,
      start: [11, 0],
      end: [12, 30],
      category: 'Meeting',
      location: 'Boardroom',
      guests: [
        'emma.devries@example.com',
        'priya.nair@example.com',
        'james@harbourworks.example',
      ],
      description:
        'Agenda:\n• Q3 results\n• Roadmap for the mooring analysis module\n• Hiring plan',
      reminders: [10, 60],
    },
    {
      // Deliberately overlaps the planning meeting, to exercise the layout and
      // the conflict warning.
      title: 'Call with Sofia',
      calendar: 'Work',
      day: 0,
      start: [11, 30],
      end: [12, 0],
      category: 'Meeting',
      meeting: 'ZOOM',
      guests: ['sofia.marchetti@example.it'],
    },
    {
      title: 'Lunch',
      calendar: 'Personal',
      day: 0,
      start: [12, 30],
      end: [13, 15],
      transparency: 'FREE',
    },
    {
      title: 'Site visit — Nordport',
      calendar: 'Work',
      day: 0,
      start: [14, 0],
      end: [16, 0],
      category: 'Work',
      location: 'Nordport terminal, Rotterdam',
      guests: ['lars@nordport.example'],
    },
    {
      title: 'Dentist',
      calendar: 'Personal',
      day: 1,
      start: [8, 30],
      end: [9, 15],
      location: 'Tandartspraktijk Oosterbeek',
      reminders: [1440],
    },
    {
      title: 'Design review',
      calendar: 'Work',
      day: 1,
      start: [14, 0],
      end: [15, 30],
      category: 'Meeting',
      meeting: 'MICROSOFT_TEAMS',
      guests: ['james@harbourworks.example', 'sofia.marchetti@example.it'],
      status: 'TENTATIVE',
    },
    {
      title: 'Dinner with the family',
      calendar: 'Family',
      day: 2,
      start: [18, 30],
      end: [21, 0],
      category: 'Family',
      location: 'Oma & opa',
    },
    {
      title: 'Client workshop',
      calendar: 'Work',
      day: 3,
      start: [9, 0],
      end: [16, 0],
      category: 'Work',
      location: 'Meridian Shipping, Amsterdam',
      guests: ['priya.nair@example.com'],
      description: 'Full-day workshop. Bring the mooring case studies.',
    },
    {
      title: 'Gym',
      calendar: 'Personal',
      day: 4,
      start: [7, 0],
      end: [8, 0],
      category: 'Sport',
    },
    {
      title: 'Coffee with Daan',
      calendar: 'Personal',
      day: 4,
      start: [10, 30],
      end: [11, 0],
      location: 'Caffè Bocca, Arnhem',
      guests: ['daan.bakker@example.nl'],
    },

    // --- multi-day and all-day -----------------------------------------
    {
      title: 'Rotterdam maritime conference',
      calendar: 'Work',
      day: 8,
      allDay: true,
      days: 3,
      category: 'Travel',
      location: 'Ahoy Rotterdam',
    },
    {
      title: "Emma's birthday",
      calendar: 'Birthdays',
      day: 5,
      allDay: true,
      kind: 'BIRTHDAY',
    },
    {
      title: 'Public holiday',
      calendar: 'Holidays',
      day: 12,
      allDay: true,
      kind: 'HOLIDAY',
      transparency: 'FREE',
    },
    {
      title: 'Out of office — afternoon',
      calendar: 'Work',
      day: 6,
      start: [13, 0],
      end: [18, 0],
      kind: 'OUT_OF_OFFICE',
    },

    // --- across midnight, and last week --------------------------------
    {
      title: 'Night shift handover',
      calendar: 'Work',
      day: 2,
      start: [23, 30],
      end: [24, 30],
      category: 'Work',
    },
    {
      title: 'Retrospective',
      calendar: 'Work',
      day: -3,
      start: [15, 0],
      end: [16, 0],
      category: 'Meeting',
      guests: ['emma.devries@example.com'],
    },
    {
      title: 'Contract signing',
      calendar: 'Work',
      day: -5,
      start: [10, 0],
      end: [11, 0],
      category: 'Work',
      location: 'Notaris, Arnhem',
    },
  ]

  for (const spec of specs) {
    const start = spec.allDay
      ? at(spec.day, 0)
      : at(spec.day, spec.start![0], spec.start![1])
    const end = spec.allDay
      ? at(spec.day + (spec.days ?? 1), 0)
      : at(
          spec.end![0] >= 24 ? spec.day + 1 : spec.day,
          spec.end![0] % 24,
          spec.end![1],
        )

    const data: Prisma.EventCreateInput = {
      id: randomUUID(),
      user: { connect: { id: user.id } },
      calendar: { connect: { id: calendars[spec.calendar]! } },
      title: spec.title,
      description: spec.description ?? null,
      location: spec.location ?? null,
      startAt: start,
      endAt: end,
      timezone: TZ,
      allDay: spec.allDay ?? false,
      startDate: spec.allDay ? dayKey(spec.day) : null,
      endDate: spec.allDay ? dayKey(spec.day + (spec.days ?? 1)) : null,
      kind: spec.kind ?? 'EVENT',
      status: spec.status ?? 'CONFIRMED',
      transparency: spec.transparency ?? 'BUSY',
      recurrenceRule: spec.rrule ?? null,
      meetingProvider: spec.meeting ?? 'NONE',
      meetingUrl: spec.meeting
        ? `https://meet.example.com/${spec.title.toLowerCase().replace(/\W+/g, '-')}`
        : null,
      ...(spec.category ? { category: { connect: { id: categories[spec.category]! } } } : {}),
    }

    const event = await prisma.event.create({ data })

    if (spec.guests?.length) {
      await prisma.eventAttendee.createMany({
        data: [
          {
            eventId: event.id,
            email: user.email,
            name: user.name,
            isOrganizer: true,
            response: 'ACCEPTED',
          },
          ...spec.guests.map((email, index) => ({
            eventId: event.id,
            email,
            name: contactSpecs.find((c) => c.email === email)?.name ?? null,
            contactId: contacts[email] ?? null,
            // A spread of responses, so the RSVP UI has something to show.
            response: (['ACCEPTED', 'NEEDS_ACTION', 'TENTATIVE', 'DECLINED'] as const)[
              index % 4
            ],
          })),
        ],
      })
    }

    if (spec.reminders?.length) {
      await prisma.eventReminder.createMany({
        data: spec.reminders.map((minutesBefore) => ({
          eventId: event.id,
          minutesBefore,
          method: 'APP' as const,
        })),
      })
    }
  }

  /* --------------------------------------------------------------- tasks */

  const projectSpecs = [
    { name: 'Inbox', color: '#64748b' },
    { name: 'ROPES launch', color: '#0369a1' },
    { name: 'Personal', color: '#4f46e5' },
  ]
  const projects: Record<string, string> = {}
  for (const [index, spec] of projectSpecs.entries()) {
    const project = await prisma.taskProject.create({
      data: { ...spec, userId: user.id, sortOrder: index },
    })
    projects[spec.name] = project.id
  }

  const taskSpecs = [
    {
      title: 'Prepare the quarterly deck',
      project: 'ROPES launch',
      priority: 'P1' as const,
      due: 1,
      estimate: 120,
      status: 'TODO' as const,
      description: 'Pull the Q3 numbers and the three case studies.',
    },
    {
      title: 'Send the workshop follow-up',
      project: 'ROPES launch',
      priority: 'P2' as const,
      due: 4,
      estimate: 45,
      status: 'TODO' as const,
    },
    {
      title: 'Review the mooring analysis draft',
      project: 'ROPES launch',
      priority: 'P2' as const,
      due: 2,
      estimate: 90,
      status: 'IN_PROGRESS' as const,
    },
    {
      title: 'Book the Rotterdam hotel',
      project: 'Personal',
      priority: 'P1' as const,
      due: 3,
      estimate: 20,
      status: 'TODO' as const,
    },
    {
      title: 'Renew the car insurance',
      project: 'Personal',
      priority: 'P3' as const,
      due: 9,
      estimate: 30,
      status: 'TODO' as const,
    },
    {
      title: 'Reply to Lars about the terminal visit',
      project: 'Inbox',
      priority: 'P2' as const,
      due: 0,
      estimate: 15,
      status: 'TODO' as const,
    },
    {
      title: 'Update the pricing page',
      project: 'ROPES launch',
      priority: 'P3' as const,
      due: 11,
      estimate: 60,
      status: 'TODO' as const,
    },
    {
      title: 'Order new business cards',
      project: 'Inbox',
      priority: 'P4' as const,
      due: null,
      estimate: 15,
      status: 'INBOX' as const,
    },
    {
      title: 'File the expense claims',
      project: 'Personal',
      priority: 'P3' as const,
      due: -1,
      estimate: 25,
      status: 'DONE' as const,
    },
    {
      title: 'Draft the conference abstract',
      project: 'ROPES launch',
      priority: 'P2' as const,
      due: -2,
      estimate: 75,
      status: 'DONE' as const,
    },
  ]

  for (const [index, spec] of taskSpecs.entries()) {
    const task = await prisma.task.create({
      data: {
        userId: user.id,
        title: spec.title,
        description: spec.description ?? null,
        projectId: projects[spec.project]!,
        priority: spec.priority,
        status: spec.status,
        estimatedMinutes: spec.estimate,
        dueAt: spec.due === null ? null : at(spec.due, 17, 0),
        dueAllDay: true,
        timezone: TZ,
        sortOrder: index,
        completedAt: spec.status === 'DONE' ? at(spec.due ?? 0, 12) : null,
      },
    })

    // One task already has a block on the calendar, to show the link.
    if (spec.title === 'Prepare the quarterly deck') {
      const block = await prisma.event.create({
        data: {
          userId: user.id,
          calendarId: calendars.Work!,
          title: spec.title,
          startAt: at(1, 10, 0),
          endAt: at(1, 12, 0),
          timezone: TZ,
          kind: 'TASK_BLOCK',
          categoryId: categories.Focus!,
        },
      })
      await prisma.task.update({
        where: { id: task.id },
        data: { timeBlockId: block.id },
      })
    }
  }

  /* ------------------------------------------------------- meeting type */

  const meetingType = await prisma.meetingType.create({
    data: {
      userId: user.id,
      slug: '30min',
      title: '30 minute meeting',
      description: 'A half hour to talk things through.',
      durationMinutes: 30,
      bufferAfterMinutes: 10,
      minimumNoticeMinutes: 240,
      targetCalendarId: calendars.Work!,
      meetingProvider: 'GOOGLE_MEET',
    },
  })
  await prisma.meetingTypeAvailability.createMany({
    data: [1, 2, 3, 4, 5].map((weekday) => ({
      meetingTypeId: meetingType.id,
      weekday,
      startMinute: 9 * 60,
      endMinute: 17 * 60,
    })),
  })

  await prisma.meetingType.create({
    data: {
      userId: user.id,
      slug: 'intro-15',
      title: 'Quick intro',
      description: 'Fifteen minutes to see whether we should talk properly.',
      durationMinutes: 15,
      targetCalendarId: calendars.Work!,
      availability: {
        create: [2, 4].map((weekday) => ({
          weekday,
          startMinute: 13 * 60,
          endMinute: 17 * 60,
        })),
      },
    },
  })

  /* -------------------------------------------------- sample connection */

  /**
   * A stand-in mail connection so the Inbox and the extractor can be used
   * without Google credentials. It carries only the Gmail scope, so the rest of
   * the app correctly reports that this account cannot sync calendars — the
   * sample data never pretends to be a working Google connection.
   */
  await prisma.integrationAccount.deleteMany({ where: { userId: user.id } })
  await prisma.integrationAccount.create({
    data: {
      userId: user.id,
      provider: 'GOOGLE',
      providerAccountId: 'sample-account',
      email: DEMO_EMAIL,
      displayName: 'Sample mailbox',
      scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
      status: 'ACTIVE',
      isPrimary: true,
    },
  })

  /* ------------------------------------------------------ notifications */

  await prisma.notification.createMany({
    data: [
      {
        userId: user.id,
        type: 'RSVP_RESPONSE',
        title: 'Emma accepted your invitation',
        body: 'Quarterly planning',
        link: '/calendar',
        createdAt: new Date(Date.now() - 25 * 60_000),
      },
      {
        userId: user.id,
        type: 'TASK_DUE',
        title: 'Task due today',
        body: 'Reply to Lars about the terminal visit',
        link: '/tasks',
        createdAt: new Date(Date.now() - 3 * 60 * 60_000),
      },
      {
        userId: user.id,
        type: 'CONFLICT',
        title: 'Two events overlap',
        body: 'Quarterly planning and Call with Sofia',
        link: '/calendar',
        createdAt: new Date(Date.now() - 5 * 60 * 60_000),
        readAt: new Date(Date.now() - 4 * 60 * 60_000),
      },
    ],
  })

  console.log(`Seeded ${specs.length} event definitions, ${taskSpecs.length} tasks,`)
  console.log(`${contactSpecs.length} contacts and 2 meeting types for ${DEMO_EMAIL}.`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
