import { describe, expect, it } from 'vitest'
import { MAX_PLANNED_STEP, MIN_PLANNED_STEP, planStages, plannedValueAt, stageWidths, type ProfileStep } from './profile'

const step = (over: Partial<ProfileStep>): ProfileStep => ({
  name: 'S', pump: 'pressure', pressure: 9, flow: null, seconds: 10, transition: 'fast', ...over,
})

describe('planStages', () => {
  it('lays steps end to end, capping long steps and widening zero-length ones', () => {
    const stages = planStages({ steps: [step({ seconds: 5 }), step({ seconds: 0 }), step({ seconds: 60 })] })
    expect(stages.map((s) => [s.t0, s.t1])).toEqual([[0, 5], [5, 5 + MIN_PLANNED_STEP], [6, 6 + MAX_PLANNED_STEP]])
  })

  it('ramps smooth steps from the previous value of the same pump kind, otherwise jumps', () => {
    const stages = planStages({ steps: [
      step({ pressure: 3 }),
      step({ pressure: 9, transition: 'smooth' }),
      step({ pump: 'flow', flow: 2, pressure: null, transition: 'smooth' }),
    ] })
    expect(stages.map((s) => [s.from, s.to])).toEqual([[3, 3], [3, 9], [2, 2]])
  })

  it('interpolates within a stage and clamps past the end', () => {
    const stages = planStages({ steps: [step({ pressure: 0 }), step({ pressure: 10, transition: 'smooth' })] })
    expect(plannedValueAt(stages, 15)?.value).toBe(5)
    expect(plannedValueAt(stages, 99)?.value).toBe(10)
  })
})

describe('LIVE-03 stage widths', () => {
  it('are proportional to planned duration and sum to 1', () => {
    const widths = stageWidths(planStages({ steps: [step({ seconds: 5 }), step({ seconds: 15 })] }))
    expect(widths).toEqual([0.25, 0.75])
  })

  it('are empty for a profile with no steps', () => {
    expect(stageWidths(planStages({ steps: [] }))).toEqual([])
  })
})

describe('plannedSeriesAt', () => {
  it('pairs the controlled value with the step limit for the other quantity', async () => {
    const { plannedSeriesAt } = await import('./profile')
    const stages = planStages({ steps: [
      step({ pump: 'flow', flow: 4, pressure: null, limiter: { value: 3, range: 0.6 } }),
      step({ pressure: 9, limiter: { value: 0, range: 0.6 } }),
    ] })
    expect(plannedSeriesAt(stages, 2)).toMatchObject({ pressure: 3, flow: 4 })
    expect(plannedSeriesAt(stages, 12)).toMatchObject({ pressure: 9, flow: null })
  })
})
