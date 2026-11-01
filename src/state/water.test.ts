import { describe, expect, it } from 'vitest'
import { needsRefill, tankMmForPercent, tankPercent } from './water'

describe('GLB-09 water tank', () => {
  it('shows the level as a share of the tank volume, by the DE1 calibration table', () => {
    expect(tankPercent(67)).toBe(100) // 2058 ml, the top of the table
    expect(tankPercent(80)).toBe(100)
    expect(tankPercent(40)).toBe(54) // 1104 ml
    expect(tankPercent(40.9)).toBe(54) // whole mm, like the table
    expect(tankPercent(5)).toBe(6) // 124 ml
    expect(tankPercent(-3)).toBe(0)
    expect(tankPercent(undefined)).toBeUndefined()
  })

  it('turns a percentage back into the closest sensor height', () => {
    expect(tankMmForPercent(20)).toBe(15) // 398 ml is closest to 412 ml
    expect(tankMmForPercent(100)).toBe(67)
    expect(tankMmForPercent(0)).toBe(0)
    for (const mm of [5, 16, 40, 60]) expect(tankMmForPercent(tankPercent(mm)!)).toBe(mm)
  })

  it('asks for a refill only when the machine says it needs water, whatever the level', () => {
    expect(needsRefill('needsWater')).toBe(true)
    expect(needsRefill('idle')).toBe(false)
    expect(needsRefill('espresso')).toBe(false)
    expect(needsRefill(undefined)).toBe(false)
  })
})
