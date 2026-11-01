import { describe, expect, it } from 'vitest'
import { planStages, type ProfileStep } from '../domain/profile'
import { fitLegend, legendName } from './legend'

const steps = (names: string[]): ProfileStep[] => names.map((name) => ({ name, pump: 'pressure', pressure: 9, flow: null, seconds: 5, transition: 'fast' }))

describe('GLB-26 stage legend', () => {
  it('names unnamed stages and keeps full names (truncation is done by the column width)', () => {
    expect(legendName('Extraction start', 0)).toBe('Extraction start')
    expect(legendName('  ', 2)).toBe('Stage 3')
  })

  it('shows every stage when they fit the cells', () => {
    const l = fitLegend(planStages({ steps: steps(['Fill', 'Soak', 'Rise', 'Peak']) }), 2, 2)
    expect(l.items.map((i) => i.no)).toEqual(['01', '02', '03', '04'])
    expect(l.more).toBe(0)
  })

  it('turns the last cell into "+N more" when there are more stages than cells', () => {
    const l = fitLegend(planStages({ steps: steps(['a', 'b', 'c', 'd', 'e', 'f', 'g']) }), 2, 2)
    expect(l.items.map((i) => i.no)).toEqual(['01', '02', '03'])
    expect(l.more).toBe(4)
  })
})
