import type { NextRequest } from 'next/server'
import { ok, route } from '@/lib/api'
import { requireUser } from '@/lib/auth'
import { adviseEstimate, getCalibration } from '@/server/services/calibration'

/**
 * What this user's finished work says about their estimates.
 *
 * With `?estimate=60` it answers for one estimate — null when there is not
 * enough history, or when the correction is too small to be worth showing.
 * Without it, the standing figure, for the Analytics headline.
 *
 * `projectId` narrows it: writing and admin drift differently, and one number
 * across both describes neither.
 */
export const GET = route(async (request: NextRequest) => {
  const user = await requireUser()
  const params = request.nextUrl.searchParams

  const projectId = params.get('projectId')
  const estimate = params.get('estimate')

  if (estimate !== null) {
    const minutes = Number(estimate)
    return ok(await adviseEstimate(user.id, minutes, projectId))
  }

  return ok(await getCalibration(user.id, projectId))
})
