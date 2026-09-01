import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { ok, parseBody, route } from '@/lib/api'
import { assertSameOrigin, requireUser } from '@/lib/auth'
import { enforce, limits } from '@/lib/rate-limit'
import { applyProposals, proposeSchedule } from '@/server/services/scheduling'

const proposeSchema = z.object({
  fromDayKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  horizonDays: z.number().int().min(1).max(60).optional(),
  maxBlockMinutes: z.number().int().min(15).max(480).optional(),
  minBlockMinutes: z.number().int().min(5).max(240).optional(),
  taskIds: z.array(z.string().uuid()).max(200).optional(),
})

const applySchema = z.object({
  calendarId: z.string().uuid().optional(),
  proposals: z
    .array(
      z.object({
        taskId: z.string().uuid(),
        start: z.string(),
        end: z.string(),
      }),
    )
    .min(1)
    .max(200),
})

/** Produces a plan. Read-only by design — nothing is written until Apply. */
export const POST = route(async (request: NextRequest) => {
  await assertSameOrigin()
  const user = await requireUser()
  await enforce('schedule', limits.write, user.id)

  const input = await parseBody(request, proposeSchema)
  const result = await proposeSchedule(user.id, user.email, user.timezone, input)

  return ok(result)
})

/** Commits the proposals the user accepted. */
export const PUT = route(async (request: NextRequest) => {
  await assertSameOrigin()
  const user = await requireUser()
  await enforce('schedule', limits.write, user.id)

  const input = await parseBody(request, applySchema)
  const applied = await applyProposals(user.id, input.proposals, input.calendarId)

  return ok({ applied, requested: input.proposals.length })
})
