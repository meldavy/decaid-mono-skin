import { describe, expect, it } from 'vitest'
import { bridge, colFor, join, quantize, rowFor } from './grid'

describe('grid snapping', () => {
  it('maps values to rows and clamps', () => {
    const spec = { rows: 11, max: 10 }
    expect(rowFor(0, spec)).toBe(0)
    expect(rowFor(10, spec)).toBe(10)
    expect(rowFor(4.96, spec)).toBe(5)
    expect(rowFor(14, spec)).toBe(10)
    expect(rowFor(-1, spec)).toBe(0)
    expect(rowFor(Number.NaN, spec)).toBe(0)
  })

  it('maps time to columns within the axis', () => {
    expect(colFor(0, 30, 60)).toBe(0)
    expect(colFor(15, 30, 60)).toBe(30)
    expect(colFor(30, 30, 60)).toBe(59)
    expect(colFor(5, 0, 60)).toBe(0)
  })

  it('bridges steep changes with the rows in between', () => {
    expect(bridge(2, 6)).toEqual([3, 4, 5])
    expect(bridge(6, 2)).toEqual([3, 4, 5])
    expect(bridge(3, 4)).toEqual([])
  })

  it('quantizes samples into each column\'s span; gaps stay empty', () => {
    const cells = quantize([{ t: 0, v: 2 }, { t: 0.4, v: 4 }, { t: 3.5, v: 10 }], 4, { cols: 4, rows: 11, max: 10 })
    expect(cells).toEqual([{ lo: 2, hi: 4, last: 4 }, null, null, { lo: 10, hi: 10, last: 10 }])
  })

  it('a peak keeps its height wherever the column boundaries fall (the chart compacting)', () => {
    const spike = [0, 0, 0, 0, 9, 0, 0, 0, 0, 0].map((v, i) => ({ t: i, v }))
    for (const cols of [10, 7, 5, 4, 3]) {
      const cells = quantize(spike, 10, { cols, rows: 11, max: 10 })
      expect(Math.max(...cells.map((c) => c?.hi ?? 0)), `${cols} columns`).toBe(9)
    }
  })

  it('a spike narrower than a column is one column wide, however the columns fall', () => {
    // 10 samples a second; a 0.3 s spike at 4.0–4.3 s, slid across the column boundaries by stretching the chart.
    const spike = Array.from({ length: 100 }, (_, i) => ({ t: i / 10, v: i >= 40 && i <= 43 ? [3, 9, 9, 3][i - 40] : 0 }))
    for (const duration of [10, 11, 12.5, 13, 14.2, 15, 16.7, 18]) {
      const cells = quantize(spike, duration, { cols: 20, rows: 11, max: 10 })
      const tall = cells.filter((c) => c && c.hi > 0)
      expect(tall.length, `${duration} s on 20 columns`).toBe(1)
      expect(tall[0]!.hi).toBe(9)
    }
  })

  it('every spike in a series is one column wide, not just the first', () => {
    const v = (i: number) => (i >= 40 && i <= 42 ? [4, 9, 4][i - 40] : i >= 70 && i <= 72 ? [4, 9, 4][i - 70] : 0)
    const two = Array.from({ length: 100 }, (_, i) => ({ t: i / 10, v: v(i) }))
    for (const duration of [10, 11.3, 12.8, 14.6, 17]) {
      const cells = quantize(two, duration, { cols: 20, rows: 11, max: 10 })
      expect(cells.filter((c) => c && c.hi > 0).length, `${duration} s`).toBe(2)
    }
  })

  it('a wide flat top is not squeezed into one column', () => {
    const block = Array.from({ length: 100 }, (_, i) => ({ t: i / 10, v: i >= 40 && i < 70 ? 8 : 0 }))
    const cells = quantize(block, 10, { cols: 20, rows: 11, max: 10 })
    expect(cells.filter((c) => c && c.hi === 8).length).toBeGreaterThan(4)
  })

  it('a slow ramp still spreads over its columns', () => {
    const ramp = Array.from({ length: 50 }, (_, i) => ({ t: i / 10, v: i / 5 }))
    const cells = quantize(ramp, 5, { cols: 10, rows: 11, max: 10 })
    expect(cells.filter((c) => c && c.hi > c.lo).length).toBeGreaterThan(5)
    expect(cells.every((c) => c !== null)).toBe(true)
  })

  it('ignores samples that are not numbers', () => {
    expect(quantize([{ t: 0, v: Number.NaN }, { t: 1.5, v: 3 }], 2, { cols: 2, rows: 11, max: 10 })).toEqual([null, { lo: 3, hi: 3, last: 3 }])
  })

  it('joins neighbouring spans with the rows between them, none when they touch', () => {
    expect(join({ lo: 2, hi: 2, last: 2 }, { lo: 6, hi: 7, last: 7 })).toEqual([3, 4, 5])
    expect(join({ lo: 6, hi: 8, last: 6 }, { lo: 1, hi: 2, last: 1 })).toEqual([3, 4, 5])
    expect(join({ lo: 2, hi: 5, last: 5 }, { lo: 4, hi: 6, last: 6 })).toEqual([])
  })
})
