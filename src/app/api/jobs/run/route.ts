import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { fail, ok, parseQuery, route } from '@/lib/api'
import { safeEqual } from '@/lib/crypto'
import { runJobs, type JobName } from '@/server/jobs'

/**
 * The entry point for scheduled work.
 *
 * Not a user endpoint: it is authenticated with a shared secret in the
 * `Authorization` header, compared in constant time. Without `JOBS_SECRET` set
 * it refuses to run at all rather than defaulting to open — an unauthenticated
 * job runner is a way to make a server do unbounded work on request.
 *
 * Call it from whatever scheduler the host provides:
 *   curl -X POST -H "Authorization: Bearer $JOBS_SECRET" \
 *        "https://example.com/api/jobs/run?job=reminders"
 */

const querySchema = z.object({
  job: z
    .enum(['reminders', 'tasks', 'agenda', 'sync', 'maintenance', 'all'])
    .default('all'),
})

export const POST = route(async (request: NextRequest) => {
  const secret = process.env.JOBS_SECRET
  if (!secret) {
    return fail(
      'Scheduled jobs are not configured on this server.',
      'jobs_disabled',
      503,
    )
  }

  const header = request.headers.get('authorization') ?? ''
  const provided = header.replace(/^Bearer\s+/i, '')
  if (!provided || !safeEqual(provided, secret)) {
    return fail('Not authorised.', 'unauthorized', 401)
  }

  const { job } = parseQuery(request, querySchema)
  const results = await runJobs(job as JobName)

  return ok({
    ran: results.map((result) => result.job),
    results,
    at: new Date().toISOString(),
  })
})
