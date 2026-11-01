import { describe, expect, it } from 'vitest'
import { foldTtr, ttrSeconds } from './timeToReady'

describe('HOME-02 heating countdown', () => {
  it('counts down from the latest estimate between frames', () => {
    const e = foldTtr({ status: 'heating', remainingTimeMs: 42_000 }, 1_000, null)
    expect(ttrSeconds(e, 1_000)).toBe(42)
    expect(ttrSeconds({ ...e!, at: 4_000 }, 4_000)).toBe(39)
  })

  it('ignores frames without a number but keeps the stream fresh', () => {
    const e = foldTtr({ status: 'heating', remainingTimeMs: 30_000 }, 0, null)
    const kept = foldTtr({ status: 'ready', remainingTimeMs: 0 }, 5_000, e)
    expect(kept).toEqual({ deadline: 30_000, at: 5_000 })
  })

  it('shows no number when the stream is quiet, when there is no estimate, or long after the deadline', () => {
    const e = foldTtr({ status: 'heating', remainingTimeMs: 10_000 }, 0, null)
    expect(ttrSeconds(e, 7_000)).toBe(0)
    expect(ttrSeconds(null, 0)).toBe(0)
    expect(ttrSeconds({ deadline: 0, at: 20_000 }, 20_000)).toBe(0)
  })

  it('caps very long estimates at 5 minutes', () => {
    expect(ttrSeconds(foldTtr({ status: 'heating', remainingTimeMs: 1_200_000 }, 0, null), 0)).toBe(300)
  })
})
