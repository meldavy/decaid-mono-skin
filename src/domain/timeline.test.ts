import { describe, expect, it } from 'vitest'
import { lanes, replan, stageAtColumn, stageColumns, timeAtColumn } from './timeline'
import type { PlannedStage } from './profile'

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0)
const planned = (seconds: number[]): PlannedStage[] => {
  let t = 0
  return seconds.map((s, index) => { const st = { index, name: `S${index}`, pump: 'flow' as const, t0: t, t1: t + s, from: 0, to: 0, limit: null }; t += s; return st })
}

describe('stageColumns', () => {
  it('fills the row in proportion when every stage fits', () => {
    const cols = stageColumns([10, 20, 30], 120, 16)
    expect(sum(cols)).toBe(120)
    expect(cols).toEqual([20, 40, 60])
  })
  it('a short stage gets the minimum; the rest share what is left, still filling the row', () => {
    const cols = stageColumns([1, 30, 60], 120, 16)
    expect(cols[0]).toBe(16)
    expect(sum(cols)).toBe(120)
    expect(cols[2]).toBeGreaterThan(cols[1])
  })
  it('too many stages: each keeps the minimum and the total runs past the row', () => {
    const cols = stageColumns(new Array(15).fill(10), 120, 16)
    expect(cols.every((c) => c >= 16)).toBe(true)
    expect(sum(cols)).toBeGreaterThan(120)
  })
  it('zero-length and no stages', () => {
    expect(stageColumns([0, 0], 100, 16)).toEqual([50, 50])
    expect(stageColumns([], 100, 16)).toEqual([])
  })
})

describe('lanes', () => {
  const ls = lanes(planned([10, 20]), [20, 40])
  it('maps columns to stages and planned times', () => {
    expect(stageAtColumn(ls, 0)).toBe(0)
    expect(stageAtColumn(ls, 19)).toBe(0)
    expect(stageAtColumn(ls, 20)).toBe(1)
    expect(stageAtColumn(ls, 999)).toBe(1)
    expect(timeAtColumn(ls, 0)).toBeCloseTo(0.25)
    expect(timeAtColumn(ls, 59)).toBeCloseTo(29.75)
  })
})

describe('replan', () => {
  const plan = planned([10, 20, 30]) // 0–10, 10–30, 30–60
  it('an early stage end pulls the rest of the plan forward', () => {
    // Stage 0 ended at 4 s; 2 s into stage 1.
    const r = replan(plan, [{ t: 0, frame: 0 }, { t: 4, frame: 1 }, { t: 6, frame: 1 }])
    expect(r.map((s) => [s.t0, s.t1])).toEqual([[0, 4], [4, 24], [24, 54]])
  })
  it('a stage running long pushes the rest out from now', () => {
    const r = replan(plan, [{ t: 0, frame: 0 }, { t: 15, frame: 0 }])
    expect(r.map((s) => [s.t0, s.t1])).toEqual([[0, 15], [15, 35], [35, 65]])
  })
  it('a skipped stage takes no time', () => {
    const r = replan(plan, [{ t: 0, frame: 0 }, { t: 5, frame: 2 }])
    expect(r.map((s) => [s.t0, s.t1])).toEqual([[0, 5], [5, 5], [5, 35]])
  })
  it('without stage numbers, or before the shot, the plan is unchanged', () => {
    expect(replan(plan, [])).toBe(plan)
    expect(replan(plan, [{ t: 3 }])).toBe(plan)
  })
})
