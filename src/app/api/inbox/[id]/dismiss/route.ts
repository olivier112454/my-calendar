import type { NextRequest } from 'next/server'
import { noContent, route } from '@/lib/api'
import { assertSameOrigin, requireUser } from '@/lib/auth'
import { dismissSuggestion, undismissSuggestion } from '@/server/services/inbox'

type Params = { params: Promise<{ id: string }> }

/** Hides a suggestion. The message itself is untouched in the mailbox. */
export const POST = route(async (_request: NextRequest, { params }: Params) => {
  await assertSameOrigin()
  const user = await requireUser()
  const { id } = await params

  await dismissSuggestion(user.id, id)
  return noContent()
})

export const DELETE = route(async (_request: NextRequest, { params }: Params) => {
  await assertSameOrigin()
  const user = await requireUser()
  const { id } = await params

  await undismissSuggestion(user.id, id)
  return noContent()
})
