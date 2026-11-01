import { describe, expect, it } from 'vitest'
import { MAIN_TITLE, SIDE_TITLE, titleStyle } from './title'

describe('titleStyle', () => {
  it('keeps short names at full size and drops long ones to the single smaller size', () => {
    expect(titleStyle('Adaptive v3', MAIN_TITLE).fontSize).toBe(44)
    expect(titleStyle('Easy blooming - active pressure decline', MAIN_TITLE).fontSize).toBe(32)
    expect(titleStyle('Turbo shot', SIDE_TITLE).fontSize).toBe(26)
    expect(titleStyle('Blooming espresso', SIDE_TITLE).fontSize).toBe(20)
  })

  it('caps the number of lines', () => {
    expect(titleStyle('x', MAIN_TITLE).WebkitLineClamp).toBe(2)
    expect(titleStyle('x', SIDE_TITLE).WebkitLineClamp).toBe(3)
  })
})
