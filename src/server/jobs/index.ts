import 'server-only'
import { prisma } from '@/lib/db'
import { addMinutes, dayKeyOf, endOfDayUtc, startOfDayUtc, todayKey } from '@/lib/datetime'
import { expandOccurrences } from '@/lib/recurrence'
import { clearExpiredSessions } from '@/lib/session'
import { notify, pruneNotifications } from '@/server/services/notifications'
import { syncAccount } from '@/server/services/sync'
import { refreshInbox } from '@/server/services/inbox'
import { accountsFor, grantedCapabilities } from '@/server/providers/registry'

/**
 * Background work.
 *
 * These are plain async functions with no scheduler of their own, driven by
 * `POST /api/jobs/run`. That keeps them portable: a Vercel cron, a systemd
 * timer, a GitHub Action or a container sidecar can all call the same endpoint,
 * and nothing here assumes a particular host.
 *
 * Nothing in this file runs inside a user request. A reminder that fires
 * because someone happened to open a page is not a reminder.
 */

export interface JobResult {
  job: string
  processed: number
  errors: string[]
  ms: number
}

async function timed(
  job: string,
  run: () => Promise<{ processed: number; errors?: string[] }>,
): Promise<JobResult> {
  const started = Date.now()
  try {
    const result = await run()
    return {
      job,
      processed: result.processed,
      errors: result.errors ?? [],
      ms: Date.now() - started,
    }
  } catch (error) {
    return {
      job,
      processed: 0,
      errors: [error instanceof Error ? error.message : String(error)],
      ms: Date.now() - started,
    }
  }
}

/* -------------------------------------------------------------- reminders */

/**
 * Fires reminders that have come due.
 *
 * Looks a short window ahead rather than at an exact instant, so a job that
 * runs every few minutes never misses one. `sentAt` on the reminder is what
 * stops it firing twice — the window overlapping between runs is expected.
 */
export async function runReminders(windowMinutes = 10): Promise<JobResult> {
  return timed('reminders', async () => {
    const now = new Date()
    const horizon = addMinutes(now, windowMinutes)
    let processed = 0

    // Single events first: the common case, and a cheap query.
    const dueReminders = await prisma.eventReminder.findMany({
      where: {
        sentAt: null,
        event: {
          recurrenceRule: null,
          status: { not: 'CANCELLED' },
          startAt: { gte: now, lte: addMinutes(horizon, 10080) },
        },
      },
      include: {
        event: {
          select: {
            id: true,
            userId: true,
            title: true,
            startAt: true,
            timezone: true,
            calendarId: true,
          },
        },
      },
      take: 500,
    })

    for (const reminder of dueReminders) {
      const fireAt = addMinutes(reminder.event.startAt, -reminder.minutesBefore)
      if (fireAt > horizon) continue
      // More than an hour late means the job was down; skip rather than send a
      // reminder for something that already happened.
      if (fireAt < addMinutes(now, -60)) {
        await prisma.eventReminder.update({
          where: { id: reminder.id },
          data: { sentAt: now },
        })
        continue
      }

      await notify({
        userId: reminder.event.userId,
        type: 'EVENT_REMINDER',
        title: reminder.event.title,
        body: describeLeadTime(reminder.minutesBefore),
        link: `/calendar?event=${reminder.event.id}`,
        entityType: 'Event',
        entityId: reminder.event.id,
        dedupe: true,
      })

      await prisma.eventReminder.update({
        where: { id: reminder.id },
        data: { sentAt: now },
      })
      processed += 1
    }

    processed += await remindersForSeries(now, horizon)
    return { processed }
  })
}

/**
 * Reminders for repeating events.
 *
 * A series has one reminder row for the whole rule, so `sentAt` cannot be used
 * to track individual occurrences. Instead the notification itself is the
 * record: `dedupe` on the occurrence key means the same instance can never
 * produce two.
 */
async function remindersForSeries(now: Date, horizon: Date): Promise<number> {
  const series = await prisma.event.findMany({
    where: {
      recurrenceRule: { not: null },
      status: { not: 'CANCELLED' },
      reminders: { some: {} },
    },
    include: { reminders: true },
    take: 500,
  })

  let processed = 0

  for (const master of series) {
    const durationMs = master.endAt.getTime() - master.startAt.getTime()
    const maxLead = Math.max(...master.reminders.map((r) => r.minutesBefore))

    const occurrences = expandOccurrences(
      {
        rule: master.recurrenceRule!,
        dtStart: master.startAt,
        durationMs,
        timezone: master.timezone,
        exDates: master.recurrenceExDates,
      },
      now,
      addMinutes(horizon, maxLead + 1),
      50,
    )

    for (const occurrence of occurrences) {
      for (const reminder of master.reminders) {
        const fireAt = addMinutes(occurrence.start, -reminder.minutesBefore)
        if (fireAt < now || fireAt > horizon) continue

        await notify({
          userId: master.userId,
          type: 'EVENT_REMINDER',
          title: master.title,
          body: describeLeadTime(reminder.minutesBefore),
          link: `/calendar?event=${master.id}`,
          entityType: 'EventOccurrence',
          // The occurrence key is what makes deduplication per-instance.
          entityId: `${master.id}:${occurrence.start.toISOString()}`,
          dedupe: true,
        })
        processed += 1
      }
    }
  }

  return processed
}

function describeLeadTime(minutes: number): string {
  if (minutes === 0) return 'Starting now'
  if (minutes < 60) return `Starts in ${minutes} minutes`
  if (minutes < 1440) return `Starts in ${Math.round(minutes / 60)} hours`
  return `Starts in ${Math.round(minutes / 1440)} days`
}

/* ------------------------------------------------------------ tasks due */

export async function runTaskReminders(): Promise<JobResult> {
  return timed('task-reminders', async () => {
    const users = await prisma.user.findMany({ select: { id: true, timezone: true } })
    let processed = 0

    for (const user of users) {
      const today = todayKey(user.timezone)
      const dueToday = await prisma.task.findMany({
        where: {
          userId: user.id,
          status: { not: 'DONE' },
          dueAt: {
            gte: startOfDayUtc(today, user.timezone),
            lt: endOfDayUtc(today, user.timezone),
          },
        },
        select: { id: true, title: true },
        take: 25,
      })

      for (const task of dueToday) {
        await notify({
          userId: user.id,
          type: 'TASK_DUE',
          title: 'Task due today',
          body: task.title,
          link: `/tasks?task=${task.id}`,
          entityType: 'Task',
          entityId: task.id,
          dedupe: true,
        })
        processed += 1
      }
    }

    return { processed }
  })
}

/* --------------------------------------------------------- daily agenda */

/**
 * The morning summary. Delivery is left to the host's mail transport — this
 * job composes the message and records that it is ready, so wiring up an
 * email provider is one function away rather than a redesign.
 */
export async function runDailyAgenda(): Promise<JobResult> {
  return timed('daily-agenda', async () => {
    const settings = await prisma.userSettings.findMany({
      where: { dailyAgendaEmail: true },
      include: { user: { select: { id: true, email: true, timezone: true, name: true } } },
    })

    let processed = 0

    for (const entry of settings) {
      // Send when the user's configured hour has arrived in their own zone.
      const localHour = Number(
        new Intl.DateTimeFormat('en-GB', {
          timeZone: entry.user.timezone,
          hour: '2-digit',
          hour12: false,
        }).format(new Date()),
      )
      if (localHour !== entry.dailyAgendaHour) continue

      const today = todayKey(entry.user.timezone)
      const [events, tasks] = await Promise.all([
        prisma.event.findMany({
          where: {
            userId: entry.user.id,
            startAt: {
              gte: startOfDayUtc(today, entry.user.timezone),
              lt: endOfDayUtc(today, entry.user.timezone),
            },
            status: { not: 'CANCELLED' },
          },
          orderBy: { startAt: 'asc' },
          select: { title: true, startAt: true, allDay: true, timezone: true },
          take: 30,
        }),
        prisma.task.count({
          where: {
            userId: entry.user.id,
            status: { not: 'DONE' },
            dueAt: { lt: endOfDayUtc(today, entry.user.timezone) },
          },
        }),
      ])

      if (events.length === 0 && tasks === 0) continue

      const body = [
        ...events.map((event) =>
          event.allDay
            ? `All day — ${event.title}`
            : `${new Intl.DateTimeFormat('en-GB', {
                timeZone: entry.user.timezone,
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
              }).format(event.startAt)} ${event.title}`,
        ),
        tasks > 0 ? `${tasks} task${tasks === 1 ? '' : 's'} due today` : null,
      ]
        .filter(Boolean)
        .join('\n')

      await notify({
        userId: entry.user.id,
        type: 'SYSTEM',
        title: `Your ${new Intl.DateTimeFormat('en-GB', {
          timeZone: entry.user.timezone,
          weekday: 'long',
        }).format(new Date())}`,
        body,
        link: '/today',
        entityType: 'DailyAgenda',
        entityId: `${entry.user.id}:${today}`,
        dedupe: true,
      })
      processed += 1
    }

    return { processed }
  })
}

/* ---------------------------------------------------------------- sync */

/** Refreshes every connected calendar and mailbox. */
export async function runSync(): Promise<JobResult> {
  return timed('sync', async () => {
    const users = await prisma.user.findMany({ select: { id: true, timezone: true } })
    const errors: string[] = []
    let processed = 0

    for (const user of users) {
      const accounts = await accountsFor(user.id)

      for (const account of accounts) {
        if (account.status !== 'ACTIVE') continue
        const capabilities = grantedCapabilities(account)

        if (capabilities.calendar) {
          const result = await syncAccount(account)
          processed += result.eventsPulled + result.eventsPushed
          errors.push(...result.errors.map((entry) => `${entry.calendar}: ${entry.message}`))
        }
      }

      if (accounts.some((account) => grantedCapabilities(account).mail)) {
        try {
          const result = await refreshInbox(user.id, user.timezone)
          processed += result.imported
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error))
        }
      }
    }

    return { processed, errors }
  })
}

/* ---------------------------------------------------------- maintenance */

export async function runMaintenance(): Promise<JobResult> {
  return timed('maintenance', async () => {
    const sessions = await clearExpiredSessions()

    const states = await prisma.oAuthState.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    })

    const users = await prisma.user.findMany({ select: { id: true } })
    let notifications = 0
    for (const user of users) {
      notifications += await pruneNotifications(user.id)
    }

    // Audit entries older than a year are not worth the storage.
    const audits = await prisma.auditLog.deleteMany({
      where: { createdAt: { lt: new Date(Date.now() - 365 * 86_400_000) } },
    })

    return { processed: sessions + states.count + notifications + audits.count }
  })
}

/* ---------------------------------------------------------------- runner */

export type JobName = 'reminders' | 'tasks' | 'agenda' | 'sync' | 'maintenance' | 'all'

export async function runJobs(name: JobName): Promise<JobResult[]> {
  switch (name) {
    case 'reminders':
      return [await runReminders()]
    case 'tasks':
      return [await runTaskReminders()]
    case 'agenda':
      return [await runDailyAgenda()]
    case 'sync':
      return [await runSync()]
    case 'maintenance':
      return [await runMaintenance()]
    case 'all':
      return [
        await runReminders(),
        await runTaskReminders(),
        await runDailyAgenda(),
        await runMaintenance(),
      ]
  }
}

export { dayKeyOf }
