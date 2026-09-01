import type { NextRequest } from 'next/server'
import { ok, parseBody, route } from '@/lib/api'
import { assertSameOrigin, requireUser } from '@/lib/auth'
import { rsvpSchema } from '@/lib/validation/event'
import { setRsvp } from '@/server/services/events'

export const POST = route(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    await assertSameOrigin()
    const user = await requireUser()

    const { id } = await params
    const { response, comment } = await parseBody(request, rsvpSchema)

    await setRsvp(user.id, id, response, comment)
    return ok({ response })
  },
)
