import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { ok, parseBody, route } from '@/lib/api'
import { assertSameOrigin, requireUser } from '@/lib/auth'
import { enforce, limits } from '@/lib/rate-limit'
import { accountsFor, accountFor } from '@/server/providers/registry'
import { syncAccount, syncStatusFor } from '@/server/services/sync'

const bodySchema = z.object({
  /** Sync one account; omit to sync every connected Google account. */
  accountId: z.string().uuid().optional(),
})

/** Manual sync, triggered by the button in the toolbar or on Integrations. */
export const POST = route(async (request: NextRequest) => {
  await assertSameOrigin()
  const user = await requireUser()
  await enforce('sync', limits.sync, user.id)

  let input: { accountId?: string } = {}
  try {
    input = await parseBody(request, bodySchema)
  } catch {
    /* an empty body means "all accounts" */
  }

  const accounts = input.accountId
    ? [await accountFor(user.id, input.accountId)]
    : await accountsFor(user.id, 'GOOGLE')

  const results = []
  for (const account of accounts) {
    results.push(await syncAccount(account))
  }

  return ok({
    results,
    pulled: results.reduce((total, entry) => total + entry.eventsPulled, 0),
    pushed: results.reduce((total, entry) => total + entry.eventsPushed, 0),
    errors: results.flatMap((entry) => entry.errors),
  })
})

/** Current sync state per account, for the "Last synced …" line. */
export const GET = route(async () => {
  const user = await requireUser()
  return ok(await syncStatusFor(user.id))
})
