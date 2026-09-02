import 'server-only'
import { prisma } from '@/lib/db'

/**
 * What your estimates are actually worth.
 *
 * Every planner in this category schedules on the number the user typed, and
 * keeps scheduling on it however wrong it turns out to be. The estimate is
 * treated as a fact about the task when it is really a habit of the person: an
 * hour on your calendar might reliably be ninety minutes of your life.
 *
 * So once a task is finished with both an estimate and a recorded time, the two
 * are kept side by side and the ratio between them is learned. Then the next
 * estimate can be answered with evidence rather than optimism.
 *
 * Three rules keep this honest:
 *
 *  1. It is a ratio, not an average. "Two hours" and "fifteen minutes" are
 *     wrong in the same proportion, not by the same number of minutes, so the
 *     median of actual÷estimated is what generalises.
 *  2. The median, never the mean. One task abandoned and finished a fortnight
 *     later would drag a mean far enough to make every later suggestion absurd.
 *  3. Below MIN_SAMPLES it says nothing at all. A confident correction drawn
 *     from two tasks is worse than no correction, because the user believes it.
 */

/** Under this many finished tasks there is nothing worth telling anyone. */
const MIN_SAMPLES = 5

/**
 * Ratios outside this range are treated as a different task rather than a bad
 * estimate — a five-minute job that took a day was almost certainly rewritten
 * along the way, and including it teaches the wrong lesson.
 */
const MIN_RATIO = 0.2
const MAX_RATIO = 5

/** Ignore corrections this small; nobody needs telling they are 4% optimistic. */
const MEANINGFUL_DRIFT = 0.15

export interface Calibration {
  /** Median of actual ÷ estimated. Above 1 means the work runs long. */
  ratio: number
  /** How many completed tasks it is drawn from. */
  samples: number
  /** True once there is enough evidence to show the user. */
  confident: boolean
}

export interface EstimateAdvice extends Calibration {
  /** The estimate as typed, in minutes. */
  estimatedMinutes: number
  /** What the same estimate has historically turned into, rounded to 5 minutes. */
  suggestedMinutes: number
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!
}

/**
 * The judgement itself, separated from the query that feeds it.
 *
 * Pure and exported precisely so it can be tested without a database: if this
 * is wrong every suggestion is wrong, and the failure reads as bad advice
 * rather than as a bug.
 */
export function calibrationFrom(
  pairs: { estimatedMinutes: number; actualMinutes: number }[],
): Calibration {
  const ratios = pairs
    .filter((pair) => pair.estimatedMinutes > 0 && pair.actualMinutes > 0)
    .map((pair) => pair.actualMinutes / pair.estimatedMinutes)
    .filter((ratio) => ratio >= MIN_RATIO && ratio <= MAX_RATIO)

  if (ratios.length < MIN_SAMPLES) {
    return { ratio: 1, samples: ratios.length, confident: false }
  }
  return { ratio: median(ratios), samples: ratios.length, confident: true }
}

/** What to say about one estimate, given what the history says. */
export function adviceFrom(
  calibration: Calibration,
  estimatedMinutes: number,
): EstimateAdvice | null {
  if (!Number.isFinite(estimatedMinutes) || estimatedMinutes <= 0) return null
  if (!calibration.confident) return null
  if (Math.abs(calibration.ratio - 1) < MEANINGFUL_DRIFT) return null

  const suggested = Math.max(5, Math.round((estimatedMinutes * calibration.ratio) / 5) * 5)
  if (suggested === estimatedMinutes) return null

  return { ...calibration, estimatedMinutes, suggestedMinutes: suggested }
}

/**
 * How this user's finished work compares with what they said it would take.
 *
 * `projectId` narrows it to one project when there is enough history there —
 * writing and admin drift differently, and a single number across both is a
 * number about neither. It falls back to the overall figure rather than
 * reporting nothing.
 */
export async function getCalibration(
  userId: string,
  projectId?: string | null,
): Promise<Calibration> {
  const rows = await prisma.task.findMany({
    where: {
      userId,
      status: 'DONE',
      estimatedMinutes: { not: null, gt: 0 },
      actualMinutes: { not: null, gt: 0 },
      ...(projectId ? { projectId } : {}),
    },
    select: { estimatedMinutes: true, actualMinutes: true },
    orderBy: { completedAt: 'desc' },
    // Recent history only: an estimate you have since learned from should not
    // be held against you for ever.
    take: 60,
  })

  const calibration = calibrationFrom(
    rows.map((row) => ({
      estimatedMinutes: row.estimatedMinutes!,
      actualMinutes: row.actualMinutes!,
    })),
  )

  // Narrowed to a project and came up short: the overall figure is a better
  // answer than silence, so long as it was not already the overall figure.
  if (!calibration.confident && projectId) return getCalibration(userId, null)
  return calibration
}

/**
 * What to say about an estimate the user has just typed, or null when there is
 * nothing worth saying — too little history, or a drift too small to matter.
 */
export async function adviseEstimate(
  userId: string,
  estimatedMinutes: number,
  projectId?: string | null,
): Promise<EstimateAdvice | null> {
  if (!Number.isFinite(estimatedMinutes) || estimatedMinutes <= 0) return null
  return adviceFrom(await getCalibration(userId, projectId), estimatedMinutes)
}

/**
 * Record how long a finished task really took.
 *
 * Scoped by userId in the same statement as the id, so a task belonging to
 * someone else simply is not found rather than being updated.
 */
export async function recordActualMinutes(
  userId: string,
  taskId: string,
  actualMinutes: number | null,
): Promise<void> {
  const minutes =
    actualMinutes === null ? null : Math.max(1, Math.round(actualMinutes))

  await prisma.task.updateMany({
    where: { id: taskId, userId },
    data: { actualMinutes: minutes },
  })
}
