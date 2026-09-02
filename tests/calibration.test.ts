import { describe, expect, it } from 'vitest'
import { adviceFrom, calibrationFrom } from '@/server/services/calibration'

/**
 * What the app is willing to tell someone about their own estimates.
 *
 * The risk here is not being slightly wrong, it is being confidently wrong:
 * the user is told "this usually takes you longer" and believes it, so a figure
 * drawn from too little history, or dragged by one abandoned task, does more
 * damage than saying nothing. These tests pin the cases where it must stay
 * quiet as firmly as the ones where it must speak.
 */

const pair = (estimatedMinutes: number, actualMinutes: number) => ({
  estimatedMinutes,
  actualMinutes,
})

/** n tasks that each ran `ratio` times longer than estimated. */
const consistently = (ratio: number, count: number) =>
  Array.from({ length: count }, () => pair(60, 60 * ratio))

describe('calibration', () => {
  it('says nothing until there is enough history', () => {
    const four = calibrationFrom(consistently(1.5, 4))
    expect(four.confident).toBe(false)
    expect(four.samples).toBe(4)

    expect(calibrationFrom(consistently(1.5, 5)).confident).toBe(true)
  })

  it('learns a consistent overrun', () => {
    const calibration = calibrationFrom(consistently(1.5, 8))
    expect(calibration.ratio).toBeCloseTo(1.5, 5)
  })

  it('learns that someone overestimates too', () => {
    expect(calibrationFrom(consistently(0.7, 6)).ratio).toBeCloseTo(0.7, 5)
  })

  it('takes the median, so one runaway task cannot skew it', () => {
    // Six honest hours and one task left open for a fortnight.
    const rows = [...consistently(1.2, 6), pair(60, 60 * 4.9)]
    const calibration = calibrationFrom(rows)
    expect(calibration.ratio).toBeCloseTo(1.2, 5)
    // The mean would have been dragged past 1.7.
    const mean =
      rows.reduce((sum, r) => sum + r.actualMinutes / r.estimatedMinutes, 0) / rows.length
    expect(mean).toBeGreaterThan(1.7)
  })

  it('discards ratios that describe a different task, not a bad estimate', () => {
    // A ten-minute job that took two days was rewritten along the way.
    const calibration = calibrationFrom([...consistently(1.3, 5), pair(10, 2880)])
    expect(calibration.samples).toBe(5)
    expect(calibration.ratio).toBeCloseTo(1.3, 5)
  })

  it('ignores rows with nothing to compare', () => {
    const calibration = calibrationFrom([
      ...consistently(1.4, 5),
      pair(0, 30),
      pair(30, 0),
    ])
    expect(calibration.samples).toBe(5)
  })
})

describe('estimate advice', () => {
  const settled = calibrationFrom(consistently(1.5, 10))

  it('offers the corrected estimate, rounded to something sayable', () => {
    const advice = adviceFrom(settled, 60)
    expect(advice?.suggestedMinutes).toBe(90)
    expect(adviceFrom(settled, 25)?.suggestedMinutes).toBe(40)
  })

  it('stays quiet without enough history', () => {
    expect(adviceFrom(calibrationFrom(consistently(1.5, 3)), 60)).toBeNull()
  })

  it('stays quiet about a drift too small to act on', () => {
    // 8% out is not worth interrupting anyone over.
    expect(adviceFrom(calibrationFrom(consistently(1.08, 10)), 60)).toBeNull()
  })

  it('stays quiet when the correction lands back on the same number', () => {
    // 1.02 clears nothing and would round 60 straight back to 60 anyway.
    expect(adviceFrom(calibrationFrom(consistently(1.02, 10)), 60)).toBeNull()
  })

  it('shortens an estimate when the history says so', () => {
    const advice = adviceFrom(calibrationFrom(consistently(0.5, 10)), 60)
    expect(advice?.suggestedMinutes).toBe(30)
  })

  it('never suggests less than five minutes', () => {
    // 15 × 0.25 is under four minutes, which is not a length anyone plans in.
    const brisk = calibrationFrom(consistently(0.25, 10))
    expect(adviceFrom(brisk, 15)?.suggestedMinutes).toBe(5)
    // And at five minutes the floor is already the estimate, so there is
    // nothing left to say rather than a suggestion to repeat it back.
    expect(adviceFrom(brisk, 5)).toBeNull()
  })

  it('rejects a nonsense estimate', () => {
    expect(adviceFrom(settled, 0)).toBeNull()
    expect(adviceFrom(settled, Number.NaN)).toBeNull()
  })
})
