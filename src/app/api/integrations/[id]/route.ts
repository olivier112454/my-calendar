import type { NextRequest } from 'next/server'
import { noContent, route } from '@/lib/api'
import { assertSameOrigin, requireUser } from '@/lib/auth'
import { disconnectAccount } from '@/server/services/settings'

/**
 * Disconnects a connected account. Revokes the token with the provider first,
 * then deletes the local record and everything mirrored through it.
 */
export const DELETE = route(
  async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    await assertSameOrigin()
    const user = await requireUser()
    const { id } = await params

    await disconnectAccount(user.id, id)
    return noContent()
  },
)
