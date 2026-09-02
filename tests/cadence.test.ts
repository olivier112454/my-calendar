import { describe, expect, it } from 'vitest'
import { cadenceFrom } from '@/server/services/cadence'

/**
 * Whether someone has fallen off your rhythm with them.
 *
 * The whole point is that "eight weeks" means nothing on its own — it is
 * alarming for a weekly colleague and unremarkable for a twice-a-year supplier.
 * So these tests care most about two things: that the same absence is read
 * differently for different people, and that the app keeps quiet when it does
 * not really know someone's rhythm.
 */

const TODAY = '2026-09-02'

/** `count` meetings, `gap` days apart, the last one `daysAgo` before TODAY. */
function every(gap: number, count: number, daysAgo: number): string[] {
  const end = Date.parse(`${TODAY}T00:00:00Z`) - daysAgo * 86_400_000
  return Array.from({ length: count }, (_, index) =>
    new Date(end - (count - 1 - index) * gap * 86_400_000).toISOString().slice(0, 10),
  )
}

describe('cadence', () => {
  it('says nothing from too few meetings', () => {
    const three = cadenceFrom(every(7, 3, 60), TODAY)
    expect(three.confident).toBe(false)
    expect(three.typicalGapDays).toBeNull()
    expect(three.overdueByDays).toBeNull()
    // It still reports what it does know.
    expect(three.meetings).toBe(3)
    expect(three.daysSince).toBe(60)
  })

  it('learns a weekly rhythm', () => {
    const cadence = cadenceFrom(every(7, 8, 3), TODAY)
    expect(cadence.confident).toBe(true)
    expect(cadence.typicalGapDays).toBe(7)
    // Three days after a weekly meeting is not overdue.
    expect(cadence.overdueByDays).toBeNull()
  })

  it('reads the same absence differently for different people', () => {
    const weekly = cadenceFrom(every(7, 8, 56), TODAY)
    const quarterly = cadenceFrom(every(90, 8, 56), TODAY)

    // Eight weeks without the weekly colleague is well past the rhythm.
    expect(weekly.overdueByDays).not.toBeNull()
    // The same eight weeks is nothing for someone seen every quarter.
    expect(quarterly.overdueByDays).toBeNull()
  })

  it('waits until clearly past the gap, not the first day over', () => {
    // Nine days into a weekly rhythm: late, but not worth a word.
    expect(cadenceFrom(every(7, 8, 9), TODAY).overdueByDays).toBeNull()
    // Three weeks is.
    expect(cadenceFrom(every(7, 8, 21), TODAY).overdueByDays).toBe(14)
  })

  it('takes the median, so one long absence does not reset the norm', () => {
    // Monthly throughout, with a single half-year break in the middle.
    const days = [
      '2025-09-01', '2025-10-01', '2025-11-01',
      '2026-05-01', // the break
      '2026-06-01', '2026-07-01', '2026-08-01',
    ]
    const cadence = cadenceFrom(days, TODAY)
    expect(cadence.confident).toBe(true)
    // Around a month, not the ~7 weeks a mean would have produced.
    expect(cadence.typicalGapDays).toBeLessThanOrEqual(31)
  })

  it('ignores a gap too long to be part of a rhythm', () => {
    // Weekly, a three-year silence, then weekly again.
    const recent = every(7, 4, 7)
    const ancient = ['2022-01-03', '2022-01-10', '2022-01-17']
    const cadence = cadenceFrom([...ancient, ...recent], TODAY)
    expect(cadence.typicalGapDays).toBe(7)
  })

  it('does not count meetings that have not happened yet', () => {
    const cadence = cadenceFrom([...every(7, 8, 30), '2026-09-09', '2026-10-01'], TODAY)
    expect(cadence.meetings).toBe(8)
    expect(cadence.daysSince).toBe(30)
    // A meeting in the diary is not a meeting you have had.
    expect(cadence.overdueByDays).not.toBeNull()
  })

  it('treats several meetings on one day as one', () => {
    // Four events, all last Tuesday: a busy day, not a rhythm.
    const cadence = cadenceFrom(['2026-08-25', '2026-08-25', '2026-08-25', '2026-08-25'], TODAY)
    expect(cadence.meetings).toBe(1)
    expect(cadence.confident).toBe(false)
  })

  it('handles someone never met at all', () => {
    const cadence = cadenceFrom([], TODAY)
    expect(cadence.meetings).toBe(0)
    expect(cadence.lastMetDayKey).toBeNull()
    expect(cadence.daysSince).toBeNull()
    expect(cadence.overdueByDays).toBeNull()
  })
})
