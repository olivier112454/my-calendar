import type { NextRequest } from 'next/server'
import { created, route } from '@/lib/api'
import { assertSameOrigin, requireUser } from '@/lib/auth'
import { enforce, limits } from '@/lib/rate-limit'
import { duplicateEvent } from '@/server/services/events'

export const POST = route(
  async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    await assertSameOrigin()
    const user = await requireUser()
    await enforce('events-write', limits.write, user.id)

    const { id } = await params
    return created(await duplicateEvent(user.id, id))
  },
)
