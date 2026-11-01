import { describe, expect, it } from 'vitest'
import type { ProfileStep } from './profile'
import { stageProgress } from './stageProgress'

const step = (over: Partial<ProfileStep>): ProfileStep => ({ name: 's', pump: 'flow', flow: 4, pressure: null, seconds: 20, transition: 'fast', ...over })
const ramp = (n: number, f: (t: number) => Partial<{ pressure: number; flow: number; weight: number }>) =>
  Array.from({ length: n }, (_, i) => ({ t: i * 0.1, pressure: 0, flow: 4, ...f(i * 0.1) }))

describe('LIVE-14 stage progress follows the exit most likely to finish first', () => {
  it('uses time when the stage only has a time limit', () => {
    expect(stageProgress(step({}), ramp(30, () => ({})), 3)).toMatchObject({ kind: 'time', label: '3.0 S OF 20' })
  })

  it('switches to a pressure exit that will be reached before the time limit', () => {
    // pressure rising 1 bar/s towards 3 bar: ~2 s left, time has 17 s left
    const p = stageProgress(step({ exit: { type: 'pressure', condition: 'over', value: 3 } }), ramp(11, (t) => ({ pressure: t })), 1)
    expect(p?.kind).toBe('pressure')
    expect(p?.label).toBe('1.0 → 3.0 BAR')
    expect(p!.progress).toBeCloseTo(1 / 3, 2)
  })

  it('keeps time when the pressure is not moving towards its exit', () => {
    const p = stageProgress(step({ exit: { type: 'pressure', condition: 'over', value: 3 } }), ramp(20, () => ({ pressure: 1 })), 2)
    expect(p?.kind).toBe('time')
  })

  it('handles "under" exits (flow falling to a value)', () => {
    const p = stageProgress(step({ seconds: 60, exit: { type: 'flow', condition: 'under', value: 3 } }), ramp(11, (t) => ({ flow: 6 - 2 * t })), 1)
    expect(p?.kind).toBe('flow')
    expect(p!.progress).toBeCloseTo(2 / 3, 2)
  })

  it('tracks a stage weight when it will be reached first', () => {
    const p = stageProgress(step({ seconds: 60, weight: 4 }), ramp(16, (t) => ({ weight: 10 + 2 * t })), 1.5)
    expect(p?.kind).toBe('weight')
    expect(p?.label).toBe('3.0 G OF 4 G')
  })

  it('tracks volume from integrated flow', () => {
    const p = stageProgress(step({ seconds: 60, volume: 20 }), ramp(21, () => ({ flow: 5 })), 2)
    expect(p?.kind).toBe('volume')
    expect(p?.label).toBe('10 ML OF 20 ML')
  })

  it('returns null for a stage with nothing to track', () => {
    expect(stageProgress(step({ seconds: 0 }), [], 0)).toBeNull()
  })
})
