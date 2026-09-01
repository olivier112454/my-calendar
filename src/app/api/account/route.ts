import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { noContent, parseBody, route, AppError } from '@/lib/api'
import { assertSameOrigin, requireUser } from '@/lib/auth'
import { destroySession } from '@/lib/session'
import { deleteAccount } from '@/server/services/settings'

const deleteSchema = z.object({
  /** The user types their own address to confirm — a checkbox is too easy. */
  confirmEmail: z.string().email(),
})

export const DELETE = route(async (request: NextRequest) => {
  await assertSameOrigin()
  const user = await requireUser()
  const { confirmEmail } = await parseBody(request, deleteSchema)

  if (confirmEmail.trim().toLowerCase() !== user.email.toLowerCase()) {
    throw new AppError(
      'That email address does not match this account.',
      'confirmation_mismatch',
      400,
    )
  }

  await deleteAccount(user.id)
  await destroySession()

  return noContent()
})
