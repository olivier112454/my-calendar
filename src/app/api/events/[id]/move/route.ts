import type { NextRequest } from 'next/server'
import { ok, parseBody, route } from '@/lib/api'
import { assertSameOrigin, requireUser } from '@/lib/auth'
import { enforce, limits } from '@/lib/rate-limit'
import { moveEventSchema } from '@/lib/validation/event'
import { updateEvent } from '@/server/services/events'
import { recordAudit } from '@/server/audit'

/**
 * Dedicated endpoint for drag and resize.
 *
 * Separate from PATCH because it is called on every drop, must be as small as
 * possible, and defaults to `scope: 'this'` — dragging one instance of a weekly
 * meeting should move that instance, not rewrite the series.
 */
export const PATCH = route(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    await assertSameOrigin()
    const user = await requireUser()
    await enforce('events-write', limits.write, user.id)

    const { id } = await params
    const input = await parseBody(request, moveEventSchema)

    const updated = await updateEvent(user.id, id, {
      start: input.start,
      end: input.end,
      calendarId: input.calendarId,
      allDay: input.allDay,
      occurrenceStart: input.occurrenceStart,
      scope: input.scope,
    })

    await recordAudit({
      userId: user.id,
      action: 'event.moved',
      entityType: 'Event',
      entityId: id,
      metadata: { start: input.start, end: input.end },
    })

    return ok(updated)
  },
)
