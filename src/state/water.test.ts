import { describe, expect, it } from 'vitest'
import { needsRefill, tankMmForPercent, tankPercent } from './water'

describe('GLB-09 water tank', () => {
  it('shows the level as a share of a full tank, read the way the DE1 app reads the sensor', () => {
    expect(tankPercent(45)).toBe(100) // +5 mm = 50 mm, full: 1453 ml
    expect(tankPercent(40)).toBe(88) // 45 mm: 1277 ml
    expect(tankPercent(40.9)).toBe(88) // whole mm, like the table
    expect(tankPercent(0)).toBe(9) // 5 mm: 124 ml
    expect(tankPercent(-3)).toBe(3) // 2 mm: 43 ml
    expect(tankPercent(-10)).toBe(0)
    expect(tankPercent(undefined)).toBeUndefined()
  })

  it('never shows more than 100%, however high the reading', () => {
    for (const mm of [46, 50, 62, 80, 500]) expect(tankPercent(mm)).toBe(100)
  })

  it('turns a percentage back into the sensor height the machine compares against', () => {
    expect(tankMmForPercent(100)).toBe(45)
    expect(tankMmForPercent(150)).toBe(45)
    expect(tankMmForPercent(0)).toBe(0)
    expect(tankMmForPercent(7)).toBe(0) // 102 ml: 4 mm corrected, below the sensor's zero
    for (const mm of [3, 11, 20, 35, 45]) expect(tankMmForPercent(tankPercent(mm)!)).toBe(mm)
  })

  it('asks for a refill only when the machine says it needs water, whatever the level', () => {
    expect(needsRefill('needsWater')).toBe(true)
    expect(needsRefill('idle')).toBe(false)
    expect(needsRefill('espresso')).toBe(false)
    expect(needsRefill(undefined)).toBe(false)
  })
})
