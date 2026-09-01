import { prisma } from '@/lib/db'
import { ok, route } from '@/lib/api'
import { assertSameOrigin, requireUser } from '@/lib/auth'

/** Marks the first-run flow finished, so it is never shown again. */
export const POST = route(async () => {
  await assertSameOrigin()
  const user = await requireUser()

  await prisma.user.update({
    where: { id: user.id },
    data: { onboardedAt: new Date() },
  })

  return ok({ onboarded: true })
})
