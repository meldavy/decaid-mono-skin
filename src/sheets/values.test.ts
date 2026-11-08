import { describe, expect, it } from 'vitest'
import type { Workflow } from '../state/workflow'
import { readValue, shiftProfileTemperature, snap, VALUES, workflowPatch } from './values'

const wf = {
  id: 'w', name: 'w',
  profile: { title: 'P', steps: [{ name: 'a', pump: 'pressure', pressure: 9, flow: null, seconds: 5, transition: 'fast', temperature: 92 }, { name: 'b', pump: 'pressure', pressure: 9, flow: null, seconds: 5, transition: 'fast', temperature: 90 }] },
  context: { targetDoseWeight: 18, targetYield: 36 },
  steamSettings: { targetTemperature: 150, duration: 50, flow: 0.8 },
  hotWaterData: { targetTemperature: 75, duration: 30, volume: 50, flow: 10 },
  rinseData: { targetTemperature: 90, duration: 10, flow: 6 },
} as Workflow

describe('SHEET-05 value limits', () => {
  it('clamp to min / max and snap to the step', () => {
    expect(snap(170, VALUES.steamTemp)).toBe(160)
    expect(snap(100, VALUES.steamTemp)).toBe(135)
    expect(snap(18.04, VALUES.dose)).toBe(18)
    expect(snap(18.06, VALUES.dose)).toBe(18.1)
    expect(snap(92.3, VALUES.espressoTemp)).toBe(92.5)
    expect(snap(7, VALUES.hotWaterAmount)).toBe(10)
    expect(snap(203, VALUES.hotWaterAmount)).toBe(205)
  })

  it('keep steam off (0) as a real value', () => {
    expect(snap(0, VALUES.steamTemp)).toBe(0)
  })
})

describe('workflow patch', () => {
  it('sends only changed fields, grouped per section', () => {
    expect(workflowPatch({ steamTemp: 155, steamMax: 40, flushTime: 5, dose: 18.5 }, wf)).toEqual({
      steamSettings: { targetTemperature: 155, duration: 40 },
      rinseData: { duration: 5 },
      context: { targetDoseWeight: 18.5 },
    })
  })

  it('never puts the shot target into the workflow', () => {
    expect(workflowPatch({ shotTarget: 30 }, wf)).toEqual({})
  })

  it('moves every step temperature by the same amount', () => {
    expect(shiftProfileTemperature(wf.profile, 94).steps.map((s) => s.temperature)).toEqual([94, 92])
  })
})

describe('SHEET-18 °F', () => {
  it('shows and steps temperatures in whole °F, stores °C', async () => {
    const { inUnits, toShown, fromShown } = await import('./values')
    const f = inUnits(VALUES.espressoTemp, 'f')
    expect([f.min, f.max, f.step, f.decimals]).toEqual([176, 212, 1, 0])
    expect(toShown(VALUES.espressoTemp, 'f', 93)).toBe(199)
    expect(fromShown(VALUES.espressoTemp, 'f', 199)).toBe(92.8)
    expect(toShown(VALUES.steamTemp, 'f', 0)).toBe(0) // off stays off
    expect(inUnits(VALUES.dose, 'f')).toBe(VALUES.dose)
  })
})

describe('SHEET-12 ratio', () => {
  it('is yield divided by dose to one decimal; no dose shows a dash', async () => {
    const { ratio } = await import('./values')
    expect(ratio(36, 18)).toBe('1:2.0')
    expect(ratio(40, 18)).toBe('1:2.2')
    expect(ratio(45.5, 17)).toBe('1:2.7')
    expect(ratio(36, 0)).toBe('—')
  })
})

describe('milk stop temperature', () => {
  it('SHEET-20 reads stopAtTemperature, 0 (or anything under 40) as off, and writes it with the other steam fields', () => {
    expect(readValue('milkTemp', wf, 0)).toBe(0) // not set
    expect(readValue('milkTemp', { ...wf, steamSettings: { ...wf.steamSettings, stopAtTemperature: 60 } }, 0)).toBe(60)
    expect(readValue('milkTemp', { ...wf, steamSettings: { ...wf.steamSettings, stopAtTemperature: 5 } }, 0)).toBe(0)
    expect(snap(0, VALUES.milkTemp)).toBe(0)
    expect(snap(95, VALUES.milkTemp)).toBe(80)
    expect(workflowPatch({ milkTemp: 62, steamTemp: 155 }, wf)).toEqual({ steamSettings: { stopAtTemperature: 62, targetTemperature: 155 } })
    expect(workflowPatch({ milkTemp: 0 }, wf)).toEqual({ steamSettings: { stopAtTemperature: 0 } })
  })
})
