import { describe, expect, it } from 'vitest'
import { assessImpact } from '@/server/services/impact'

/**
 * What an event costs the day it lands in.
 *
 * The failure mode to guard against is not missing a cost — it is inventing
 * one. A calendar that objects to every slot is a calendar people click past,
 * and then it is silent about the move that actually mattered. So most of these
 * tests are about staying quiet.
 */

const impact = (input: Partial<Parameters<typeof assessImpact>[0]> = {}) =>
  assessImpact({
    freeBeforeMinutes: [],
    freeAfterMinutes: [],
    brokenBlocks: [],
    focusBlocksThatDay: 0,
    ...input,
  })

describe('cost of a slot', () => {
  it('says nothing about a slot that costs nothing', () => {
    // A full working day, an hour taken off one end.
    const result = impact({
      freeBeforeMinutes: [480],
      freeAfterMinutes: [420],
    })
    expect(result.messages).toEqual([])
  })

  it('names the quiet damage: a clear afternoon left in stubs', () => {
    // Four clear hours, an hour dropped in the middle of it.
    const result = impact({
      freeBeforeMinutes: [240],
      freeAfterMinutes: [90, 90],
    })
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0]).toContain('4h')
    expect(result.messages[0]).toContain('1h 30m')
  })

  it('is loudest when nothing usable is left', () => {
    const result = impact({
      freeBeforeMinutes: [180],
      freeAfterMinutes: [60, 60],
    })
    expect(result.messages[0]).toContain('no stretch longer than')
  })

  it('ignores a loss too small to matter', () => {
    // Ten minutes off the longest run is not worth a sentence.
    expect(impact({ freeBeforeMinutes: [240], freeAfterMinutes: [230] }).messages)
      .toEqual([])
  })

  it('ignores a big day losing a little', () => {
    // Six hours down to five is a loss, but not one that changes anything.
    expect(impact({ freeBeforeMinutes: [360], freeAfterMinutes: [300] }).messages)
      .toEqual([])
  })

  it('calls out the only focus block of the day by name', () => {
    const result = impact({
      brokenBlocks: [{ title: 'Deep work', minutes: 120 }],
      focusBlocksThatDay: 1,
      freeBeforeMinutes: [240],
      freeAfterMinutes: [240],
    })
    expect(result.removesOnlyFocus).toBe(true)
    expect(result.messages[0]).toBe(
      'Runs through "Deep work" — the only focus time you have that day.',
    )
  })

  it('is more measured when there is other focus time left', () => {
    const result = impact({
      brokenBlocks: [{ title: 'Deep work', minutes: 120 }],
      focusBlocksThatDay: 3,
      freeBeforeMinutes: [240],
      freeAfterMinutes: [240],
    })
    expect(result.removesOnlyFocus).toBe(false)
    expect(result.messages[0]).toBe('Runs through "Deep work" (2h).')
  })

  it('leads with the broken block, then the shape of the day', () => {
    const result = impact({
      brokenBlocks: [{ title: 'Deep work', minutes: 120 }],
      focusBlocksThatDay: 1,
      freeBeforeMinutes: [240],
      freeAfterMinutes: [45, 45],
    })
    expect(result.messages).toHaveLength(2)
    expect(result.messages[0]).toContain('Deep work')
    expect(result.messages[1]).toContain('no stretch longer than')
  })

  it('copes with a day that had no free time to lose', () => {
    const result = impact({ freeBeforeMinutes: [], freeAfterMinutes: [] })
    expect(result.longestBeforeMinutes).toBe(0)
    expect(result.messages).toEqual([])
  })

  it('reports the totals it was asked about', () => {
    const result = impact({
      freeBeforeMinutes: [120, 60],
      freeAfterMinutes: [60, 60],
    })
    expect(result.freeBeforeMinutes).toBe(180)
    expect(result.freeAfterMinutes).toBe(120)
    expect(result.longestBeforeMinutes).toBe(120)
    expect(result.longestAfterMinutes).toBe(60)
  })
})
