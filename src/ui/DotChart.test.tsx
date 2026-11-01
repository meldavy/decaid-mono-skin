import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { planStages, type ProfileStep } from '../domain/profile'
import { DotChart, timeSpan, timeTicks } from './DotChart'

const steps: ProfileStep[] = [
  { name: 'Fill', pump: 'flow', flow: 4, pressure: null, seconds: 5, transition: 'fast' },
  { name: 'Pour', pump: 'pressure', pressure: 9, flow: null, seconds: 15, transition: 'fast' },
]
const stages = planStages({ steps })
const series = (container: HTMLElement, name: string) => container.querySelectorAll(`[data-series="${name}"] circle`)

describe('DotChart', () => {
  it('without a live shot draws the plan solid: pressure in ink, flow in the accent, limits as the second curve', () => {
    const limited: ProfileStep[] = [
      { name: 'Fill', pump: 'flow', flow: 4, pressure: null, seconds: 5, transition: 'fast', limiter: { value: 3, range: 0.6 } },
      { name: 'Pour', pump: 'pressure', pressure: 9, flow: null, seconds: 15, transition: 'fast', limiter: { value: 2.5, range: 0.6 } },
    ]
    const { container } = render(<DotChart stages={planStages({ steps: limited })} cols={20} rows={13} label="plan" />)
    expect(series(container, 'plan')).toHaveLength(0)
    expect(series(container, 'pressure').length).toBeGreaterThanOrEqual(20)
    expect(series(container, 'flow').length).toBeGreaterThanOrEqual(20)
  })

  it('leaves a gap where a step sets no limit', () => {
    const { container } = render(<DotChart stages={stages} cols={20} rows={13} label="plan" />)
    // Fill is a flow step with no pressure limit: no pressure dots in its 5 columns
    const pressureCols = new Set([...series(container, 'pressure')].map((c) => c.getAttribute('cx')))
    expect(pressureCols.size).toBe(15)
  })

  it('LIVE-04 fills in the live shot and ghosts only the rest of the plan', () => {
    const samples = Array.from({ length: 11 }, (_, i) => ({ t: i, pressure: i < 5 ? 1 : 9, flow: 2 }))
    const { container } = render(<DotChart stages={stages} samples={samples} live cols={20} rows={13} label="live" />)
    expect(series(container, 'plan').length).toBe(20 - 11)
    expect(series(container, 'pressure').length).toBeGreaterThan(0)
    // trail mode: the top dot of each column is solid, the trail below fades
    const opacities = new Set([...series(container, 'pressure')].map((c) => c.getAttribute('opacity')))
    expect(opacities).toEqual(new Set(['1', '0.18', '0.08', '0.03']))
  })

  it('every dot sits on the grid', () => {
    const samples = [{ t: 0, pressure: 0, flow: 0 }, { t: 7.3, pressure: 11.2, flow: 3.3 }]
    const { container } = render(<DotChart stages={stages} samples={samples} live cols={20} rows={13} pitch={10} label="g" />)
    for (const c of container.querySelectorAll('circle')) {
      expect((Number(c.getAttribute('cx')) - 5) % 10).toBe(0)
      expect((Number(c.getAttribute('cy')) - 5) % 10).toBe(0)
    }
  })
})

describe('axis and rail', () => {
  it('labels pressure 0–12 bar in its own grid columns and keeps every dot on the grid', () => {
    const { container } = render(<DotChart stages={stages} theme="dark" axis rail cols={20} rows={13} label="a" />)
    const labels = [...container.querySelectorAll('[data-series="axis"] text')].map((t) => t.textContent)
    expect(labels).toEqual(['0', '3', '6', '9', '12'])
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('width')).toBe(String((20 + 3) * 9))
    for (const c of container.querySelectorAll('circle')) {
      expect((Number(c.getAttribute('cx')) - 4.5) % 9).toBe(0)
      expect((Number(c.getAttribute('cy')) - 4.5) % 9).toBe(0)
    }
    expect(container.querySelectorAll('[data-series="rail"] circle')).toHaveLength(20)
    for (const c of container.querySelectorAll('[data-series="pressure"] circle, [data-series="flow"] circle')) expect(Number(c.getAttribute('cx'))).toBeGreaterThan(27)
  })
})

describe('axis spacing', () => {
  it('labels only values that sit exactly on a row, evenly spaced', async () => {
    const { axisValues } = await import('./DotChart')
    expect(axisValues(9)).toEqual([0, 3, 6, 9, 12])
    expect(axisValues(29)).toEqual([0, 3, 6, 9, 12])
    expect(axisValues(10)).toEqual([0, 12])
    const { container } = render(<DotChart stages={stages} axis cols={10} rows={9} label="s" />)
    const ys = [...container.querySelectorAll('[data-series="axis"] text')].slice(0, 5).map((t) => Number(t.getAttribute('y')))
    const gaps = ys.slice(1).map((y, i) => ys[i] - y)
    expect(new Set(gaps).size).toBe(1)
  })
})

describe('finished shot', () => {
  it('DONE-01 keeps the unreached plan ghosted and shows no "now" column', () => {
    const samples = Array.from({ length: 6 }, (_, i) => ({ t: i, pressure: 9, flow: 2 }))
    const { container } = render(<DotChart stages={stages} samples={samples} cols={20} rows={13} label="done" />)
    expect(series(container, 'plan').length).toBeGreaterThan(0)
    const nowCol = [...container.querySelectorAll('circle')].filter((c) => c.getAttribute('fill') === '#D9C8AE')
    expect(nowCol).toHaveLength(0)
  })
})

describe('one dot pitch on the display', () => {
  it('dark (display) charts use the display grid pitch and carry their own grid patch', () => {
    const { container } = render(<DotChart stages={stages} theme="dark" cols={10} rows={5} label="d" />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('data-pitch')).toBe('9')
    expect(svg.classList.contains('grid-patch')).toBe(true)
    for (const c of container.querySelectorAll('circle')) expect((Number(c.getAttribute('cx')) - 4.5) % 9).toBe(0)
  })
})

describe('charts on white', () => {
  it('use the same 9 px pitch as the display', () => {
    const { container } = render(<DotChart stages={stages} cols={10} rows={5} label="w" />)
    expect(container.querySelector('svg')!.getAttribute('data-pitch')).toBe('9')
  })
})

describe('LIVE-16 chart time axis', () => {
  it('shows the window until the shot outgrows it, then widens it a whole step at a time', () => {
    expect(timeSpan(40, 10, 0)).toBe(40)
    expect(timeSpan(40, 10, 39)).toBe(40)
    expect(timeSpan(40, 10, 39.2)).toBe(50) // a second early, so the now line keeps a column
    expect(timeSpan(40, 10, 49)).toBe(50)
    expect(timeSpan(40, 10, 57)).toBe(60)
    expect(timeSpan(40, undefined, 57)).toBe(57) // no step: follows the shot exactly
  })
})

describe('LIVE-17 chart time labels', () => {
  it('numbers every 10 s across the span, without a 0', () => {
    expect(timeTicks(40)).toEqual([10, 20, 30, 40])
    expect(timeTicks(60)).toEqual([10, 20, 30, 40, 50, 60])
    expect(timeTicks(57)).toEqual([10, 20, 30, 40, 50])
  })
})
