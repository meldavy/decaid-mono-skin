import { describe, expect, it } from 'vitest'
import { fitDots, fitGrid } from './fit'

describe('fitGrid', () => {
  it('fills the box with whole dots and axis-friendly rows', () => {
    expect(fitGrid(711, 270, 9, { axis: true, extraRows: 1 })).toEqual({ cols: 76, rows: 29 })
    expect(fitGrid(500, 200, 9, { axis: true, extraRows: 1 })).toEqual({ cols: 52, rows: 21 })
    const { rows } = fitGrid(900, 333, 9, { axis: true, extraRows: 1 })
    expect((rows - 1) % 4).toBe(0)
  })

  it('never goes below a minimum', () => {
    expect(fitGrid(10, 10, 9)).toEqual({ cols: 4, rows: 5 })
  })

  it('fits dots across a width', () => {
    expect(fitDots(1050, 9)).toBe(116)
  })
})
