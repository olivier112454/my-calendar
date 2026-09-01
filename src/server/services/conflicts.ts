import 'server-only'
import { prisma } from '@/lib/db'
import { formatTime } from '@/lib/datetime'
import { listOccurrences } from './events'
import type { ConflictWarning, LocationData } from '@/types/domain'

/**
 * Conflict detection.
 *
 * Three kinds of warning, in decreasing severity:
 *
 *   overlap  two events run through each other
 *   travel   there is not enough time to get from one address to the other
 *   buffer   the gap is below the user's preferred minimum
 *
 * None of them block a save. People double-book deliberately — the job here is
 * to make sure it is never accidental.
 *
 * Travel time is an estimate, not a route: straight-line distance times a
 * detour factor, divided by an average speed. Deliberately conservative, and
 * clearly labelled as approximate in the UI. A real routing service can replace
 * `estimateTravelMinutes` without touching anything else.
 */

const EARTH_RADIUS_KM = 6371

export function distanceKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function estimateTravelMinutes(
  from: LocationData | null,
  to: LocationData | null,
  options: { detourFactor: number; speedKmh: number },
): number | null {
  if (
    from?.lat == null ||
    from.lon == null ||
    to?.lat == null ||
    to.lon == null
  ) {
    return null
  }
  const km = distanceKm({ lat: from.lat, lon: from.lon }, { lat: to.lat, lon: to.lon }) *
    options.detourFactor
  // Same building: allow a few minutes to walk between rooms.
  if (km < 0.3) return 5
  return Math.max(5, Math.round((km / options.speedKmh) * 60))
}

export interface ConflictCheckInput {
  start: Date
  end: Date
  /** Exclude the event being edited from its own conflict check. */
  excludeEventId?: string
  location?: LocationData | null
  /** Only warn about events the user is actually committed to. */
  ignoreFree?: boolean
}

export async function findConflicts(
  userId: string,
  input: ConflictCheckInput,
): Promise<ConflictWarning[]> {
  const settings = await prisma.userSettings.findUnique({ where: { userId } })
  const bufferMinutes = settings?.bufferMinutes ?? 15
  const detourFactor = settings?.travelDetourFactor ?? 1.3
  const speedKmh = settings?.travelSpeedKmh ?? 50
  const timezone = settings ? undefined : undefined

  // Look a buffer's worth either side, plus room for a plausible journey.
  const padding = Math.max(bufferMinutes, 120) * 60_000
  const neighbours = await listOccurrences(userId, {
    from: new Date(input.start.getTime() - padding),
    to: new Date(input.end.getTime() + padding),
    onlyVisibleCalendars: false,
    includeDeclined: false,
  })

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { timezone: true },
  })
  const zone = timezone ?? user.timezone

  const warnings: ConflictWarning[] = []

  for (const other of neighbours) {
    if (other.eventId === input.excludeEventId) continue
    if (other.status === 'CANCELLED') continue
    if (other.transparency === 'FREE') continue
    if (other.kind === 'BIRTHDAY' || other.kind === 'HOLIDAY') continue
    if (other.allDay) continue

    const otherStart = Date.parse(other.start)
    const otherEnd = Date.parse(other.end)
    const start = input.start.getTime()
    const end = input.end.getTime()

    const range = `${formatTime(new Date(otherStart), zone, true)}–${formatTime(
      new Date(otherEnd),
      zone,
      true,
    )}`

    if (start < otherEnd && end > otherStart) {
      warnings.push({
        kind: 'overlap',
        severity: 'blocking',
        message: `Overlaps "${other.title}" (${range}).`,
        otherEventId: other.eventId,
        otherTitle: other.title,
        otherStart: other.start,
        otherEnd: other.end,
      })
      // An overlap already says everything; a travel warning on top is noise.
      continue
    }

    const gapMinutes =
      start >= otherEnd
        ? Math.round((start - otherEnd) / 60_000)
        : Math.round((otherStart - end) / 60_000)

    const otherIsFirst = start >= otherEnd
    const travel = estimateTravelMinutes(
      otherIsFirst ? other.locationData : (input.location ?? null),
      otherIsFirst ? (input.location ?? null) : other.locationData,
      { detourFactor, speedKmh },
    )

    if (travel !== null) {
      if (gapMinutes < travel) {
        warnings.push({
          kind: 'travel',
          severity: 'warning',
          message: `Only ${gapMinutes} min after "${other.title}". Getting there takes roughly ${travel} min.`,
          otherEventId: other.eventId,
          otherTitle: other.title,
          otherStart: other.start,
          otherEnd: other.end,
        })
      }
    } else if (gapMinutes >= 0 && gapMinutes < bufferMinutes) {
      warnings.push({
        kind: 'buffer',
        severity: 'warning',
        message: `Only ${gapMinutes} min between this and "${other.title}".`,
        otherEventId: other.eventId,
        otherTitle: other.title,
        otherStart: other.start,
        otherEnd: other.end,
      })
    }
  }

  const rank = { blocking: 0, warning: 1 } as const
  return warnings
    .sort((a, b) => rank[a.severity] - rank[b.severity])
    .slice(0, 5)
}
